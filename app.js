// Main Application Logic
// Orchestrates the UI, Video, WebGPU Rendering, and Web Worker communication

import { WebGPURenderer } from './webgpu-renderer.js';
import { VideoManager } from './video-manager.js';
import { UIManager } from './ui-manager.js';
import { WorkerClient } from './worker-client.js';

// DOM Elements
const videoEl = document.getElementById('source-video');
const canvasEl = document.getElementById('render-canvas');
const statusBadge = document.getElementById('status-badge');
const btnWebcam = document.getElementById('btn-webcam');
const videoUpload = document.getElementById('video-upload');
const menuPanel = document.querySelector('.menu-panel'); // For hiding UI
const bgLayer = document.querySelector('.bg-layer'); // For hiding background art

// App State
const state = {
    trackingActive: false,
    selectedSubject: null, // {x, y, width, height}
    renderContext: null, // 'webgpu' or 'webgl' / '2d'
    offscreenCanvas: null,
    offscreenCtx: null,
    renderer: null
};

// Managers
const videoManager = new VideoManager(videoEl);
const uiManager = new UIManager({ statusBadge, btnWebcam, videoUpload, canvasEl });
const trackingWorker = new WorkerClient('worker.js'); // Uses module worker

// Optimization: get imageData directly from a reused offscreen canvas
function setupOffscreenCanvas(width, height) {
    if (!state.offscreenCanvas) {
        state.offscreenCanvas = document.createElement('canvas');
        state.offscreenCtx = state.offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }
    state.offscreenCanvas.width = width;
    state.offscreenCanvas.height = height;
    state.offscreenCtx.drawImage(videoEl, 0, 0, width, height);
    return state.offscreenCtx.getImageData(0, 0, width, height);
}

// 1. Initialize Web Worker
trackingWorker.init({
    onReady: () => uiManager.updateStatus('Ready', 'ready'),
    onUpdate: (subject) => {
        state.selectedSubject = subject;
    },
    onError: (err) => {
        console.error('Worker Error:', err);
        uiManager.updateStatus('Error', 'error');
    }
});

// 2. Setup GPU Rendering
async function initRenderer() {
    state.renderer = new WebGPURenderer();
    try {
        await state.renderer.init(canvasEl);
        state.renderContext = { type: 'webgpu' };
        console.log("WebGPU advanced renderer initialized.");
    } catch (e) {
        console.error("WebGPU failed, falling back to 2D canvas.", e);
        state.renderContext = { type: '2d', context: canvasEl.getContext('2d') };
    }
}

// 3. Render Loop
function renderFrame() {
    // Ensure video has enough data before trying to copy its texture
    if (!videoManager.isReady) {
        requestAnimationFrame(renderFrame);
        return;
    }

    const width = videoManager.width;
    const height = videoManager.height;

    // Set canvas dimensions to match video smoothly
    if (canvasEl.width !== width) {
        canvasEl.width = width;
        canvasEl.height = height;
    }

    // --- RENDER PASS ---
    if (state.renderContext.type === 'webgpu') {
        state.renderer.render(videoEl, canvasEl.width, canvasEl.height, {
            active: state.trackingActive,
            subject: state.selectedSubject
        });
    } else if (state.renderContext.type === '2d') {
        const ctx = state.renderContext.context;

        // 1. Draw blurred background
        ctx.filter = state.trackingActive ? 'blur(25px)' : 'none';
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

        // 2. Draw sharp subject (if tracking)
        if (state.trackingActive && state.selectedSubject) {
            ctx.filter = 'none';
            // Fallback: draw a sharp box over the tracked region
            const { x, y, width: subW, height: subH } = state.selectedSubject;

            // Restrict bounds to the screen
            const bx = Math.max(0, Math.min(x, canvasEl.width - subW));
            const by = Math.max(0, Math.min(y, canvasEl.height - subH));

            // Destination (Draws original sharp video patch cleanly without boxing)
            ctx.drawImage(videoEl,
                bx, by, subW, subH, // Source
                bx, by, subW, subH  // Destination
            );
        }
    }

    // Send frame data to worker if tracking is active
    if (state.trackingActive && trackingWorker.ready && !trackingWorker.busy) {
        // Grab current frame pixels to continue tracking
        const imageData = setupOffscreenCanvas(width, height);
        trackingWorker.processFrame(imageData, width, height);
    }

    requestAnimationFrame(renderFrame);
}

// 4. UI Events Binding
uiManager.bindWebcamEvent(async () => {
    if (await videoManager.startWebcam()) {
        menuPanel.classList.add('hidden-menu');
        if (bgLayer) bgLayer.classList.add('hidden-menu');
        requestAnimationFrame(renderFrame);
    }
});

uiManager.bindVideoUploadEvent((file) => {
    if (videoManager.loadVideoFile(file)) {
        menuPanel.classList.add('hidden-menu');
        if (bgLayer) bgLayer.classList.add('hidden-menu');
        requestAnimationFrame(renderFrame);
    }
});

uiManager.bindCanvasClickEvent((clickX, clickY) => {
    if (!trackingWorker.ready || !videoManager.isReady) return;

    state.trackingActive = true;

    // Create an initial bounding box approximation for immediate feedback
    state.selectedSubject = {
        x: Math.max(0, clickX - 50),
        y: Math.max(0, clickY - 50),
        width: 100,
        height: 100
    };

    const width = videoManager.width;
    const height = videoManager.height;
    const imageData = setupOffscreenCanvas(width, height);

    trackingWorker.initTracking(imageData, width, height, clickX, clickY);
});

// Bootstrap
initRenderer();
