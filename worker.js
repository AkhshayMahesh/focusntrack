// Because MediaPipe Tasks Vision relies on 'importScripts' internally to load its WASM files,
// and ES module workers strictly forbid 'importScripts()', we must run as a classic worker.
// To use our modular ES6 files, we dynamically import them.

let tracker = null;
let enhanceFn = null;
let utils = null;
let isTracking = false;
let currentTarget = null;
let currentVelocity = { x: 0, y: 0 };
let lostFrames = 0;

async function bootstrapWorker() {
    try {
        console.log("Worker dynamic importing modules...");
        // Dynamically import all modules
        const [trackerModule, enhancerModule, utilsModule] = await Promise.all([
            import('./mediapipe-tracker.js'),
            import('./image-enhancer.js'),
            import('./tracking-utils.js')
        ]);

        tracker = new trackerModule.MediaPipeTracker();
        enhanceFn = enhancerModule.enhanceLowLight;
        utils = utilsModule;

        console.log("Worker initializing MediaPipe...");
        await tracker.init();
        console.log("MediaPipe initialized successfully via Classic Worker with Dynamic Imports.");
        postMessage({ type: 'READY' });
    } catch (err) {
        console.error("Worker Boot or MediaPipe Error:", err);
        postMessage({ type: 'ERROR', payload: err.message || err.toString() });
    }
}

bootstrapWorker();

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (!tracker || !tracker.ready) return;

    if (type === 'INIT_TRACKING') {
        let { imageData, width, height, x, y } = payload;

        imageData = enhanceFn(imageData);
        const predictions = tracker.detect(imageData);

        let closest = null;
        let minDist = Infinity;

        for (const p of predictions) {
            const centerX = p.x + p.width / 2;
            const centerY = p.y + p.height / 2;
            const dSq = utils.distSq({ x, y }, { x: centerX, y: centerY });

            if (dSq < minDist) {
                minDist = dSq;
                closest = p;
            }
        }

        if (closest) {
            isTracking = true;
            currentTarget = closest;
            currentVelocity = { x: 0, y: 0 };
            lostFrames = 0;
            postMessage({ type: 'TRACKING_UPDATE', payload: currentTarget });
        } else {
            isTracking = true;
            currentTarget = {
                x: Math.max(0, x - 50),
                y: Math.max(0, y - 50),
                width: 100,
                height: 100,
                label: 'custom-poi',
                score: 1.0
            };
            currentVelocity = { x: 0, y: 0 };
            postMessage({ type: 'TRACKING_UPDATE', payload: currentTarget });
        }

    } else if (type === 'PROCESS_FRAME') {
        if (!isTracking || !currentTarget) return;

        let { imageData, width, height } = payload;

        try {
            imageData = enhanceFn(imageData);
            const predictions = tracker.detect(imageData);

            let bestMatch = null;
            let minDist = Infinity;

            const predictedTarget = utils.predictPosition(currentTarget, currentVelocity);
            const targetCenter = {
                x: predictedTarget.x + predictedTarget.width / 2,
                y: predictedTarget.y + predictedTarget.height / 2
            };

            for (const p of predictions) {
                if (currentTarget.label !== 'custom-poi' && p.label !== currentTarget.label) {
                    continue;
                }

                const centerX = p.x + p.width / 2;
                const centerY = p.y + p.height / 2;
                const dSq = utils.distSq(targetCenter, { x: centerX, y: centerY });
                const intersectIoU = utils.iou(predictedTarget, p);

                // Add a size difference penalty to prevent jumping to objects that are much larger/smaller
                const sizeRatio = Math.max(
                    (p.width * p.height) / (currentTarget.width * currentTarget.height),
                    (currentTarget.width * currentTarget.height) / (p.width * p.height)
                );
                // If it's a completely different size (>2.5x diff), penalize heavily
                const sizePenalty = (sizeRatio > 2.5) ? 100000 : 0;

                const occlusionScore = dSq - (intersectIoU * 50000) + sizePenalty;

                // Make the max distance tighter for objects with 0 IoU.
                // With velocity prediction, the targetCenter is already moved to where we expect it to be.
                const maxAllowedDistanceSq = (intersectIoU > 0) ? (width * 0.4) ** 2 : (width * 0.15) ** 2;

                if (occlusionScore < minDist && dSq < maxAllowedDistanceSq) {
                    minDist = occlusionScore;
                    bestMatch = p;
                }
            }

            if (bestMatch) {
                currentVelocity = {
                    x: bestMatch.x - currentTarget.x,
                    y: bestMatch.y - currentTarget.y
                };

                currentTarget = utils.applyEMA(currentTarget, bestMatch, 0.75);
                lostFrames = 0;
                postMessage({ type: 'TRACKING_UPDATE', payload: currentTarget });
            } else {
                // Object lost: Coasting logic
                lostFrames++;
                if (lostFrames < 15) {
                    // Assume it continued moving at the same velocity
                    currentTarget = predictedTarget;
                    // Apply a friction to velocity so it doesn't drift forever
                    currentVelocity.x *= 0.8;
                    currentVelocity.y *= 0.8;
                    postMessage({ type: 'TRACKING_UPDATE', payload: currentTarget });
                } else {
                    // Truly lost, stop attempting to predict velocity
                    currentVelocity = { x: 0, y: 0 };
                    postMessage({ type: 'TRACKING_UPDATE', payload: currentTarget });
                }
            }
        } catch (err) {
            console.error("Tracking Error:", err);
        }
    }
};
