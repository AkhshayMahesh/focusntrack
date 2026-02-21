if (typeof document === 'undefined') {
    self.document = {
        createElement: (type) => {
            if (type === 'canvas') {
                return new OffscreenCanvas(1, 1);
            }
            return {};
        }
    };

    // Some mediapipe bundles also check for window
    if (typeof window === 'undefined') {
        self.window = self;
    }
}
// ----------------------------------------

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
            currentTarget.histogram = utils.calculateHistogram(imageData, currentTarget);
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
            currentTarget.histogram = utils.calculateHistogram(imageData, currentTarget);
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
            let minCost = Infinity;

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
                const distance = Math.sqrt(dSq);
                const normalizedDistance = distance / width;

                const intersectIoU = utils.iou(predictedTarget, p);

                // Add a size difference penalty to prevent jumping to objects that are much larger/smaller
                const sizeRatio = Math.max(
                    (p.width * p.height) / (currentTarget.width * currentTarget.height),
                    (currentTarget.width * currentTarget.height) / (p.width * p.height)
                );
                // If it's a completely different size (>2.5x diff), penalize heavily
                const sizePenalty = (sizeRatio > 2.5) ? 10.0 : ((sizeRatio > 1.5) ? 2.0 : 0.0);

                // Color Density Penalty
                const pHist = utils.calculateHistogram(imageData, p);
                const histSimilarity = utils.compareHistograms(currentTarget.histogram, pHist);

                // For fast motion, color similarity is the strongest feature
                // normalizedDistance: ~0.0 to 1.0 (weighted x2)
                // (1.0 - intersectIoU): 0.0 to 1.0 (weighted x1)
                // (1.0 - histSimilarity): 0.0 to 1.0 (weighted x4)
                const cost = (normalizedDistance * 2.0)
                    + ((1.0 - intersectIoU) * 1.0)
                    + ((1.0 - histSimilarity) * 4.0)
                    + sizePenalty;

                // Make the max distance tighter for objects with 0 IoU.
                // However, if the color density match is extremely high, we allow massive jumps (for fast sports motion).
                let maxAllowedDistance = width * 0.15;
                if (histSimilarity > 0.85) {
                    maxAllowedDistance = width * 0.8;
                } else if (intersectIoU > 0) {
                    maxAllowedDistance = width * 0.4;
                }

                if (cost < minCost && distance < maxAllowedDistance) {
                    minCost = cost;
                    bestMatch = p;
                    bestMatch.histogram = pHist;
                }
            }

            if (bestMatch) {
                currentVelocity = {
                    x: bestMatch.x - currentTarget.x,
                    y: bestMatch.y - currentTarget.y
                };

                currentTarget = utils.applyEMA(currentTarget, bestMatch, 0.75);
                currentTarget.histogram = utils.blendHistograms(currentTarget.histogram, bestMatch.histogram, 0.1);

                lostFrames = 0;
                postMessage({ type: 'TRACKING_UPDATE', payload: currentTarget });
            } else {
                // Object lost: Coasting logic
                lostFrames++;
                if (lostFrames < 15) {
                    // Assume it continued moving at the same velocity
                    currentTarget = predictedTarget;
                    // Apply a softer friction (0.95) to velocity so fast-moving objects don't abruptly stop inside a lost frame
                    currentVelocity.x *= 0.95;
                    currentVelocity.y *= 0.95;
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
