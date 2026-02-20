export class VideoManager {
    constructor(videoEl) {
        this.videoEl = videoEl;
    }

    async startWebcam() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
            this.videoEl.srcObject = stream;
            this.videoEl.play();
            return true;
        } catch (err) {
            console.error("Error accessing webcam:", err);
            alert("Could not access webcam.");
            return false;
        }
    }

    loadVideoFile(file) {
        if (file) {
            const url = URL.createObjectURL(file);
            this.videoEl.srcObject = null; // Clear webcam stream if any
            this.videoEl.src = url;
            this.videoEl.play();
            return true;
        }
        return false;
    }

    get isReady() {
        return this.videoEl.videoWidth > 0 && this.videoEl.readyState >= 2;
    }

    get width() {
        return this.videoEl.videoWidth;
    }

    get height() {
        return this.videoEl.videoHeight;
    }
}
