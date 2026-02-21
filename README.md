# PEWDS FOCUS 🎯

PEWDS FOCUS is a high-performance, real-time smart auto-focus and subject tracking application built natively for the web. Running entirely client-side, it leverages Machine Learning to detect subjects, applies a highly robust tracking algorithm to prevent focus shifting, and dynamically adds a cinematic depth-of-field (bokeh) effect directly via the GPU.

## Features
*   **Zero-Server Architecture**: 100% of the ML inference runs locally in your browser.
*   **Smart Subject Tracking**: A sophisticated cost-function tracker maintains a lock on your selected subject, preventing "focus hop" when objects cross paths.
*   **Cinematic WebGPU Blur**: Real-time rendering of focus areas and background bokeh blur running flawlessly at 60fps.
*   **Dual Input Support**: Processes live webcam feeds and pre-recorded video file uploads.
*   **Unblocked UI**: ML processing runs asynchronously inside dedicated Web Workers, ensuring the UI remains perfectly smooth.

---

## 🚀 Setup & Installation

Because PEWDS FOCUS uses modern web features like Web Workers and WebGPU, it relies on ES modules. It cannot be run simply by double-clicking the `index.html` file (due to browser CORS policies). You must run it through a local development server.

### Prerequisites
*   A modern browser with WebGPU support (Chrome/Edge 113+ recommended).
*   [Node.js](https://nodejs.org/) installed, OR Python (for a simple local server).

### Option 1: Using Node.js / `serve`
1. Clone this repository to your local machine.
2. Open a terminal in the project directory.
3. Run using `npx`:
```bash
npx serve .
```
4. Open the `localhost` URL provided in your terminal (usually `http://localhost:3000`).

### Option 2: Using Python
1. Clone this repository to your local machine.
2. Open a terminal in the project directory.
3. Run the Python HTTP server:
```bash
python -m http.server 8000
```
4. Open `http://localhost:8000` in your web browser.

---

## 🧠 Technical Deep-Dive

PEWDS FOCUS is composed of three primary layers to guarantee accuracy and performance.

### 1. The Machine Learning Layer
Object detection is powered by **Google MediaPipe Tasks Vision**.
*   **Model**: EfficientDet-Lite0 (TFLite)
*   **Execution**: WebAssembly (WASM) via Web Workers.
*   **Rationale**: The `EfficientDet` architecture uses a weighted BiFPN and compound scaling to provide near state-of-the-art accuracy at a fraction of the computational cost of YOLO models, making it ideal for edge execution inside a browser.

### 2. The Smart Tracking Algorithm
Standard object detection suffers from "Focus Shift" (ID switching)—if two people cross paths, the detector will easily swap them. PEWDS FOCUS solves this using a custom predictive cost function.

For every new video frame, the system compares the currently tracked subject against *every* newly detected bounding box to find the lowest `Cost`:

*   **Coast Tracking (Momentum)**: A constant-velocity model predicts where the subject *should* be. If a frame drops the subject (occlusion/blur), the tracker applies a `0.95x` friction multiplier to coast the bounding box along its expected path for up to 15 frames.
*   **Normalized Distance**: It measures the Euclidean distance from the predicted location to the new detection, normalized by screen width to prevent fast-moving sports objects from generating huge penalizing costs.
*   **Color Density Tracking (Bhattacharyya Distance)**: The tracker generates an **HSV Color Histogram** of the targeted subject. It uses an **Epanechnikov Kernel** weighting (placing heavier emphasis on pixels in the center of the bounding box and ignoring edges). This creates a highly accurate "color fingerprint" that is compared against candidate boxes. 
*   **Dynamic Search Radius**: If the color density match is extremely high (>85% similarity), the tracker instantly expands its allowed search radius to 80% of the screen width, allowing it to seamlessly catch violently erratic, fast movements without losing lock.

### 3. Rendering Engine
The rendering layer applies the dynamic visual effects, operating entirely independently of the ML polling loop.
*   **Technology**: WebGPU & WGSL Shaders
*   **Implementation**: An offscreen canvas continuously feeds video frames to the GPU as `rgba8unorm` textures.
*   **The Shader**: A fragment shader executes a Box Blur on the background while using GLSL `smoothstep` functions to generate a soft, mathematical alpha mask around the currently tracked bounding box coordinates. The sharp and blurred textures are then smoothly `mix()`'d to emulate camera depth-of-field.
