import { ObjectDetector, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs';

export class MediaPipeTracker {
    constructor() {
        this.detector = null;
        this.ready = false;
    }

    async init() {
        try {
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
            );

            this.detector = await ObjectDetector.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
                    delegate: "GPU" // Use GPU for best performance
                },
                scoreThreshold: 0.3,
                runningMode: "IMAGE" // Required when passing ImageData from canvas
            });
            this.ready = true;
            return true;
        } catch (e) {
            console.error("MediaPipe Init Error:", e);
            throw e;
        }
    }

    detect(imageData) {
        if (!this.ready || !this.detector) return [];

        // MediaPipe Tasks Vision JS expects an ImageData directly
        const result = this.detector.detect(imageData);
        if (!result || !result.detections) return [];

        // Standardize output bounds format
        return result.detections.map(det => {
            return {
                x: det.boundingBox.originX,
                y: det.boundingBox.originY,
                width: det.boundingBox.width,
                height: det.boundingBox.height,
                label: det.categories[0].categoryName,
                score: det.categories[0].score
            };
        });
    }
}
