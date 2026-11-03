// Snap engine — JS port of ui/scene.snap_point and snap_for_dimension.
// Returns a SnapResult { point, kind, wall?, t? }.
//
// kinds: 'free', 'grid', 'endpoint', 'midpoint', 'perpendicular', 'wall', 'face'

import { dist, projectPointOnSegment } from './geometry.js';

export function snapPoint(scene, settings, p, viewScale, opts = {}) {
    const tolPx = opts.tolerancePixels ?? 16.0;
    const tol = tolPx / Math.max(viewScale, 1e-6);

    const candidates = [];

    const walls = scene.items.filter(i => i.kind === 'wall');

    // Endpoints
    if (settings.snap_to_endpoints) {
        for (const w of walls) {
            for (const ep of ['start', 'end']) {
                const e = w.sceneEndpoint(ep);
                if (dist(p, e) <= tol) {
                    candidates.push({ point: e, kind: 'endpoint', wall: w });
                }
            }
        }
    }

    // Midpoints
    if (settings.snap_to_midpoints) {
        for (const w of walls) {
            const m = w.midpoint;
            if (dist(p, m) <= tol) {
                candidates.push({ point: m, kind: 'midpoint', wall: w });
            }
        }
    }

    // Wall centerline
    for (const w of walls) {
        const r = projectPointOnSegment(p, w.start, w.end);
        if (r.dist <= tol) {
            candidates.push({ point: r.point, kind: 'wall', wall: w, t: r.t * w.length });
        }
    }

    // Grid
    if (settings.snap_to_grid) {
        const g = settings.grid_spacing;
        const sub = Math.max(1, settings.grid_subdivisions);
        const step = g / sub;
        const gp = { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
        if (dist(p, gp) <= tol) candidates.push({ point: gp, kind: 'grid' });
    }

    if (!candidates.length) return { point: { ...p }, kind: 'free' };
    const priority = { endpoint: 0, midpoint: 1, wall: 2, grid: 3, free: 4 };
    candidates.sort((a, b) => {
        const pa = priority[a.kind] ?? 99;
        const pb = priority[b.kind] ?? 99;
        if (pa !== pb) return pa - pb;
        return dist(p, a.point) - dist(p, b.point);
    });
    return candidates[0];
}

// Snap that prefers wall faces, with optional perpendicular snap from a
// previous anchor on a wall.
export function snapForDimension(scene, settings, p, viewScale, opts = {}) {
    const tolPx = opts.tolerancePixels ?? 22.0;
    const tol = tolPx / Math.max(viewScale, 1e-6);
    const fromAnchor = opts.fromAnchor || null;
    const fromWall = opts.fromWall || null;

    const candidates = [];
    const walls = scene.items.filter(i => i.kind === 'wall');

    // Perpendicular candidates (priority 0)
    if (fromAnchor && fromWall) {
        const a1 = fromWall.start, b1 = fromWall.end;
        const wdx = b1.x - a1.x, wdy = b1.y - a1.y;
        const wL = Math.hypot(wdx, wdy);
        if (wL > 1e-6) {
            const perpX = -wdy / wL;
            const perpY = wdx / wL;
            for (const w of walls) {
                if (w === fromWall) continue;
                const a2 = w.start, b2 = w.end;
                const dx2 = b2.x - a2.x, dy2 = b2.y - a2.y;
                const L2 = Math.hypot(dx2, dy2);
                if (L2 < 1e-6) continue;
                const denom = perpX * (-dy2) - perpY * (-dx2);
                if (Math.abs(denom) < 1e-9) continue;
                const rx = a2.x - fromAnchor.x;
                const ry = a2.y - fromAnchor.y;
                const tParam = (rx * (-dy2) - ry * (-dx2)) / denom;
                const uParam = (perpX * ry - perpY * rx) / denom;
                if (uParam < 0 || uParam > 1) continue;
                if (Math.abs(tParam) < 1e-3) continue;
                const cx = fromAnchor.x + tParam * perpX;
                const cy = fromAnchor.y + tParam * perpY;
                const halfT = w.thickness / 2;
                const nx = -dy2 / L2;
                const ny = dx2 / L2;
                const side = (p.x - cx) * nx + (p.y - cy) * ny;
                const sign = side >= 0 ? 1 : -1;
                const fp = { x: cx + nx * sign * halfT, y: cy + ny * sign * halfT };
                if (dist(p, fp) <= tol * 2) {
                    candidates.push({ point: fp, kind: 'perpendicular', wall: w, t: uParam * w.length });
                }
            }
        }
    }

    // Endpoints
    if (settings.snap_to_endpoints) {
        for (const w of walls) {
            for (const ep of ['start', 'end']) {
                const e = w.sceneEndpoint(ep);
                if (dist(p, e) <= tol) {
                    candidates.push({ point: e, kind: 'endpoint', wall: w });
                }
            }
        }
    }

    // Faces
    for (const w of walls) {
        const r = projectPointOnSegment(p, w.start, w.end);
        const halfT = w.thickness / 2;
        const faceDist = Math.max(0, r.dist - halfT);
        if (faceDist > tol) continue;
        const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y;
        const L = Math.hypot(dx, dy);
        if (L <= 0) continue;
        const nx = -dy / L, ny = dx / L;
        const side = (p.x - r.point.x) * nx + (p.y - r.point.y) * ny;
        const sign = side >= 0 ? 1 : -1;
        const fp = { x: r.point.x + nx * sign * halfT, y: r.point.y + ny * sign * halfT };
        candidates.push({ point: fp, kind: 'face', wall: w, t: r.t * L });
    }

    // Midpoints
    if (settings.snap_to_midpoints) {
        for (const w of walls) {
            const m = w.midpoint;
            if (dist(p, m) <= tol) {
                candidates.push({ point: m, kind: 'midpoint', wall: w });
            }
        }
    }

    // Grid
    if (settings.snap_to_grid) {
        const g = settings.grid_spacing;
        const sub = Math.max(1, settings.grid_subdivisions);
        const step = g / sub;
        const gp = { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
        if (dist(p, gp) <= tol) candidates.push({ point: gp, kind: 'grid' });
    }

    if (!candidates.length) return { point: { ...p }, kind: 'free' };
    const priority = { perpendicular: 0, endpoint: 1, face: 2, midpoint: 3, wall: 4, grid: 5, free: 6 };
    candidates.sort((a, b) => {
        const pa = priority[a.kind] ?? 99;
        const pb = priority[b.kind] ?? 99;
        if (pa !== pb) return pa - pb;
        return dist(p, a.point) - dist(p, b.point);
    });
    return candidates[0];
}

// Wall-only snap used by the opening tool: returns null if the cursor isn't
// on a wall, otherwise the position on the wall axis (centerline).
export function snapToWall(scene, p, viewScale, tolPx = 28) {
    const tol = tolPx / Math.max(viewScale, 1e-6);
    let best = null;
    for (const w of scene.items.filter(i => i.kind === 'wall')) {
        const r = projectPointOnSegment(p, w.start, w.end);
        const halfT = w.thickness / 2;
        const eff = Math.max(0, r.dist - halfT);
        if (eff > tol) continue;
        if (best == null || eff < best.eff) {
            best = { point: r.point, wall: w, t: r.t * w.length, eff };
        }
    }
    return best ? { point: best.point, wall: best.wall, t: best.t } : null;
}
