export function distSq(p1, p2) {
    return (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
}

export function iou(boxA, boxB) {
    const intersectX1 = Math.max(boxA.x, boxB.x);
    const intersectY1 = Math.max(boxA.y, boxB.y);
    const intersectX2 = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
    const intersectY2 = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

    if (intersectX2 > intersectX1 && intersectY2 > intersectY1) {
        const intersectArea = (intersectX2 - intersectX1) * (intersectY2 - intersectY1);
        const areaA = boxA.width * boxA.height;
        const areaB = boxB.width * boxB.height;
        return intersectArea / (areaA + areaB - intersectArea);
    }
    return 0;
}

export function predictPosition(target, velocity) {
    if (!target) return null;
    return {
        ...target,
        x: target.x + (velocity.x || 0),
        y: target.y + (velocity.y || 0)
    };
}

export function applyEMA(current, bestMatch, alpha = 0.75) {
    return {
        ...current,
        x: current.x * (1 - alpha) + bestMatch.x * alpha,
        y: current.y * (1 - alpha) + bestMatch.y * alpha,
        width: current.width * (1 - alpha) + bestMatch.width * alpha,
        height: current.height * (1 - alpha) + bestMatch.height * alpha,
        label: bestMatch.label,
        score: bestMatch.score
    };
}

// Convert RGB to Hue (0-1) and Saturation (0-1)
// We ignore Value (brightness) to be robust against lighting changes
function rgbToHS(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;

    if (max === min) {
        h = 0; // achromatic
    } else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h, s];
}

// Calculate an HSV Color Histogram for a bounding box
// Uses an Epanechnikov kernel to give higher weight to the center of the box
export function calculateHistogram(imageData, box, numBins = 16) {
    const { data, width: imgWidth, height: imgHeight } = imageData;
    const hist = new Float32Array(numBins * numBins);

    // Bounding box integers, clamped to image size
    const x1 = Math.max(0, Math.floor(box.x));
    const y1 = Math.max(0, Math.floor(box.y));
    const x2 = Math.min(imgWidth, Math.floor(box.x + box.width));
    const y2 = Math.min(imgHeight, Math.floor(box.y + box.height));

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const halfW = box.width / 2;
    const halfH = box.height / 2;

    let totalWeight = 0;

    for (let y = y1; y < y2; y++) {
        for (let x = x1; x < x2; x++) {
            const idx = (y * imgWidth + x) * 4;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2];

            const [h, s] = rgbToHS(r, g, b);

            // Epanechnikov Kernel weight (1 at center, 0 at edge)
            const dx = (x - cx) / halfW;
            const dy = (y - cy) / halfH;
            const distSq = dx * dx + dy * dy;

            if (distSq > 1 || s < 0.1) continue; // Ignore very low saturation (grey/white/black) where hue is noisy

            const weight = 1.0 - distSq;

            // Map Hue to numBins and Sat to numBins
            const hBin = Math.min(numBins - 1, Math.floor(h * numBins));
            const sBin = Math.min(numBins - 1, Math.floor(s * numBins));
            const histIdx = hBin * numBins + sBin;

            hist[histIdx] += weight;
            totalWeight += weight;
        }
    }

    // Normalize
    if (totalWeight > 0) {
        for (let i = 0; i < hist.length; i++) {
            hist[i] /= totalWeight;
        }
    }
    return hist;
}

// Calculate Bhattacharyya coefficient (similarity 0 to 1)
export function compareHistograms(hist1, hist2) {
    if (!hist1 || !hist2) return 0;

    let coefficient = 0;
    for (let i = 0; i < hist1.length; i++) {
        coefficient += Math.sqrt(hist1[i] * hist2[i]);
    }
    return coefficient;
}

// EMA blend histograms
export function blendHistograms(currentHist, newHist, alpha = 0.1) {
    if (!currentHist) return newHist;
    const blended = new Float32Array(currentHist.length);
    for (let i = 0; i < currentHist.length; i++) {
        blended[i] = currentHist[i] * (1 - alpha) + newHist[i] * alpha;
    }
    return blended;
}
