// Geometry helpers — JS port of core/geometry.py.
// Points are plain {x, y} objects throughout the app.

export function pt(x, y) { return { x, y }; }
export function clonePt(p) { return { x: p.x, y: p.y }; }
export function eqPt(a, b, tol = 1e-6) {
    return Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol;
}
export function addPt(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
export function subPt(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function scalePt(a, s) { return { x: a.x * s, y: a.y * s }; }

export function dist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

export function angleOf(a, b) {
    return Math.atan2(b.y - a.y, b.x - a.x);
}

export function projectPointOnSegment(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y;
    const apx = p.x - a.x, apy = p.y - a.y;
    const denom = abx * abx + aby * aby;
    if (denom === 0) return { point: clonePt(a), t: 0, dist: Math.hypot(apx, apy) };
    let t = (apx * abx + apy * aby) / denom;
    const tc = Math.max(0, Math.min(1, t));
    const cx = a.x + abx * tc;
    const cy = a.y + aby * tc;
    return { point: { x: cx, y: cy }, t: tc, dist: Math.hypot(p.x - cx, p.y - cy), tUnclamped: t };
}

export function snapToAngle(start, current, stepDeg = 15) {
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    const L = Math.hypot(dx, dy);
    if (L === 0) return clonePt(current);
    let a = Math.atan2(dy, dx);
    const step = stepDeg * Math.PI / 180;
    a = Math.round(a / step) * step;
    return { x: start.x + Math.cos(a) * L, y: start.y + Math.sin(a) * L };
}

export function polygonArea(points) {
    const n = points.length;
    if (n < 3) return 0;
    let s = 0;
    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        s += a.x * b.y - b.x * a.y;
    }
    return s * 0.5;
}

export function polygonCentroid(points) {
    const n = points.length;
    if (!n) return { x: 0, y: 0 };
    if (n < 3) {
        const cx = points.reduce((s, p) => s + p.x, 0) / n;
        const cy = points.reduce((s, p) => s + p.y, 0) / n;
        return { x: cx, y: cy };
    }
    const a6 = polygonArea(points) * 6;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % n];
        const cross = p1.x * p2.y - p2.x * p1.y;
        cx += (p1.x + p2.x) * cross;
        cy += (p1.y + p2.y) * cross;
    }
    if (a6 === 0) {
        return polygonCentroid(points.slice(0, n));
    }
    return { x: cx / a6, y: cy / a6 };
}

export function reflectPoint(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-12) return clonePt(p);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
    const fx = a.x + t * dx;
    const fy = a.y + t * dy;
    return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}

// Intersect two infinite lines a-b and c-d. Returns a point or null.
export function lineLineIntersection(a, b, c, d) {
    const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
    const x3 = c.x, y3 = c.y, x4 = d.x, y4 = d.y;
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}
