export class UIManager {
    constructor(uiElements) {
        this.statusBadge = uiElements.statusBadge;
        this.btnWebcam = uiElements.btnWebcam;
        this.videoUpload = uiElements.videoUpload;
        this.canvasEl = uiElements.canvasEl;
        this.btnPlayAgain = uiElements.btnPlayAgain;
    }

    updateStatus(text, className) {
        this.statusBadge.textContent = text;
        this.statusBadge.className = `badge ${className}`;
    }

    bindWebcamEvent(callback) {
        this.btnWebcam.addEventListener('click', callback);
    }

    bindVideoUploadEvent(callback) {
        this.videoUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) callback(file);
        });
    }

    bindCanvasClickEvent(callback) {
        this.canvasEl.addEventListener('click', (e) => {
            const rect = this.canvasEl.getBoundingClientRect();
            const scaleX = this.canvasEl.width / rect.width;
            const scaleY = this.canvasEl.height / rect.height;

            const clickX = (e.clientX - rect.left) * scaleX;
            const clickY = (e.clientY - rect.top) * scaleY;

            callback(clickX, clickY);
        });
    }

    bindPlayAgainEvent(callback) {
        if (this.btnPlayAgain) {
            this.btnPlayAgain.addEventListener('click', callback);
        }
    }

    showPlayAgain() {
        if (this.btnPlayAgain) {
            this.btnPlayAgain.style.display = 'flex';
        }
    }

    hidePlayAgain() {
        if (this.btnPlayAgain) {
            this.btnPlayAgain.style.display = 'none';
        }
    }
}
