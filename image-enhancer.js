export function enhanceLowLight(imageData) {
    const data = imageData.data;
    let totalLuma = 0;
    const numPixels = data.length / 4;
    const samples = numPixels / 16; // sample every 16th pixel for speed

    for (let i = 0; i < data.length; i += 64) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        totalLuma += luma;
    }

    const avgLuma = totalLuma / samples;

    // Enhance if very dark
    if (avgLuma < 80) {
        // Boost factor up to 2.5x to retrieve details
        const multiplier = Math.min(2.5, 120 / (avgLuma + 1));

        for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, data[i] * multiplier);     // R
            data[i + 1] = Math.min(255, data[i + 1] * multiplier); // G
            data[i + 2] = Math.min(255, data[i + 2] * multiplier); // B
            // Alpha stays the same
        }
    }

    return imageData;
}
