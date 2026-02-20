export class WebGPURenderer {
    constructor() {
        this.device = null;
        this.context = null;
        this.format = null;
        this.pipeline = null;
        this.sampler = null;
        this.uniformBuffer = null;
        this.uniformBindGroup = null;
        this.ready = false;
    }

    async init(canvas) {
        if (!navigator.gpu) {
            throw new Error("WebGPU not supported.");
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error("No adapter found.");
        }

        this.device = await adapter.requestDevice();
        this.context = canvas.getContext('webgpu');
        this.format = navigator.gpu.getPreferredCanvasFormat();

        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: 'premultiplied'
        });

        // WGSL Shaders
        const shaderCode = `
            struct Uniforms {
                targetRect: vec4<f32>, // x, y, width, height (normalized 0-1)
                isTracking: f32, // 1.0 = true, 0.0 = false
                resolution: vec2<f32>,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var ourSampler: sampler;
            @group(0) @binding(2) var ourTexture: texture_2d<f32>;

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) uv: vec2<f32>,
            };

            @vertex
            fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
                // Generate a full screen triangle
                var pos = array<vec2<f32>, 3>(
                    vec2<f32>(-1.0, -1.0),
                    vec2<f32>( 3.0, -1.0),
                    vec2<f32>(-1.0,  3.0)
                );
                
                var out: VertexOutput;
                out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
                // Map vertex position to UV (0,0 top-left to 1,1 bottom-right)
                out.uv = pos[vertexIndex] * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
                return out;
            }

            // Simple Box Blur for performance, though Gaussian is better
            fn blur(uv: vec2<f32>, strength: f32) -> vec4<f32> {
                var color = vec4<f32>(0.0);
                var total = 0.0;
                let step = vec2<f32>(strength / uniforms.resolution.x, strength / uniforms.resolution.y);
                
                // 5x5 blur kernel
                for(var x: i32 = -2; x <= 2; x++) {
                    for(var y: i32 = -2; y <= 2; y++) {
                        let offset = vec2<f32>(f32(x), f32(y)) * step;
                        color += textureSample(ourTexture, ourSampler, uv + offset);
                        total += 1.0;
                    }
                }
                return color / total;
            }

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                let colorNorm = textureSample(ourTexture, ourSampler, in.uv);
                
                if (uniforms.isTracking < 0.5) {
                    return colorNorm; // No effect
                }
                
                let blurColor = blur(in.uv, 4.0);
                
                // Check if inside target rect
                let tx = uniforms.targetRect.x;
                let ty = uniforms.targetRect.y;
                let tw = uniforms.targetRect.z;
                let th = uniforms.targetRect.w;
                
                // Add soft edges to the bounding box focus area
                let feather = 0.05;
                
                let inX = smoothstep(tx - feather, tx, in.uv.x) * (1.0 - smoothstep(tx + tw, tx + tw + feather, in.uv.x));
                let inY = smoothstep(ty - feather, ty, in.uv.y) * (1.0 - smoothstep(ty + th, ty + th + feather, in.uv.y));
                
                let mask = inX * inY;
                
                // Mix blurred background with sharp foreground based on mask
                var finalColor = mix(blurColor, colorNorm, mask);
                
                // Add highlight outline loosely based on mask gradient
                // (Very basic outline for the hackathon MVP)
                let edge = mask * (1.0 - mask) * 4.0; 
                let highlightColor = vec4<f32>(0.2, 0.5, 1.0, 1.0);
                
                // Only add highlight explicitly near the edge
                if (edge > 0.1 && mask > 0.01 && mask < 0.99) {
                     finalColor = mix(finalColor, highlightColor, edge * 0.5);
                }

                return finalColor;
            }
        `;

        const module = this.device.createShaderModule({ code: shaderCode });

        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module,
                entryPoint: 'vs_main'
            },
            fragment: {
                module,
                entryPoint: 'fs_main',
                targets: [{ format: this.format }]
            },
            primitive: {
                topology: 'triangle-list' // 3 vertices
            }
        });

        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });

        // float targetRect[4], float isTracking, vec2 padding (8 bytes), vec2 resolution = 32 bytes total
        this.uniformBuffer = this.device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.ready = true;
    }

    render(videoElement, canvasWidth, canvasHeight, trackingData) {
        if (!this.ready) return;

        // 1. Write Uniforms
        const uniformsArray = new Float32Array(8);

        let isTrackingFloat = 0.0;
        let nx = 0, ny = 0, nw = 0, nh = 0;

        if (trackingData && trackingData.active && trackingData.subject) {
            isTrackingFloat = 1.0;
            // Normalize bbox to 0.0 - 1.0 range based on video dimensions
            // Adjust to maintain aspect ratio against canvas if needed, 
            // but for this MVP we scale video to fit canvas exactly mapping.
            nx = trackingData.subject.x / videoElement.videoWidth;
            ny = trackingData.subject.y / videoElement.videoHeight;
            nw = trackingData.subject.width / videoElement.videoWidth;
            nh = trackingData.subject.height / videoElement.videoHeight;
        }

        uniformsArray[0] = nx;
        uniformsArray[1] = ny;
        uniformsArray[2] = nw;
        uniformsArray[3] = nh;
        uniformsArray[4] = isTrackingFloat;
        // 5 is padding
        uniformsArray[6] = canvasWidth;
        uniformsArray[7] = canvasHeight;

        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformsArray);

        // 2. Upload Video Frame to Texture
        const videoTexture = this.device.createTexture({
            size: [videoElement.videoWidth, videoElement.videoHeight, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.device.queue.copyExternalImageToTexture(
            { source: videoElement },
            { texture: videoTexture },
            [videoElement.videoWidth, videoElement.videoHeight]
        );

        // 3. Create Bind Group for this frame
        const bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this.sampler },
                { binding: 2, resource: videoTexture.createView() }
            ]
        });

        // 4. Render Pass
        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();

        const renderPassDescriptor = {
            colorAttachments: [
                {
                    view: textureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(3, 1, 0, 0); // 1 full screen triangle
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);

        // Cleanup texture (critical for memory)
        videoTexture.destroy();
    }
}
