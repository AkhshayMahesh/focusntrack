export class WorkerClient {
    constructor(workerUrl) {
        // Load as a classic worker (removing type: module) so MediaPipe's internal importScripts() works
        this.worker = new Worker(workerUrl);
        this.busy = false;
        this.ready = false;
    }

    init(callbacks) {
        this.worker.onmessage = (e) => {
            const { type, payload } = e.data;

            if (type === 'READY') {
                this.ready = true;
                if (callbacks.onReady) callbacks.onReady();
            } else if (type === 'TRACKING_UPDATE') {
                this.busy = false; // Worker finished processing the frame
                if (callbacks.onUpdate) callbacks.onUpdate(payload);
            } else if (type === 'ERROR') {
                this.busy = false;
                if (callbacks.onError) callbacks.onError(payload);
            }
        };
    }

    processFrame(imageData, width, height) {
        if (this.busy || !this.ready) return;
        this.busy = true;
        this.worker.postMessage({
            type: 'PROCESS_FRAME',
            payload: { imageData, width, height }
        });
    }

    initTracking(imageData, width, height, x, y) {
        if (!this.ready) return;
        this.busy = true;
        this.worker.postMessage({
            type: 'INIT_TRACKING',
            payload: { imageData, width, height, x, y }
        });
    }
}
