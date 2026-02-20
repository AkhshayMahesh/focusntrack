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
        x: current.x * (1 - alpha) + bestMatch.x * alpha,
        y: current.y * (1 - alpha) + bestMatch.y * alpha,
        width: current.width * (1 - alpha) + bestMatch.width * alpha,
        height: current.height * (1 - alpha) + bestMatch.height * alpha,
        label: bestMatch.label,
        score: bestMatch.score
    };
}
