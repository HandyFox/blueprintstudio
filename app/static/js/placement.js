// Placement engine for cabinets and fixtures.
//
// Given the thing being placed (its size, mounting height and shape) and the
// cursor, work out where it should go:
//
//   1. Near a wall → back against the wall's face, front facing into the
//      room, sliding along the wall. Its ends snap flush to whatever is
//      beside it on that wall: neighbouring cabinets/appliances, a corner
//      wall, a door, or the end of the wall.
//   2. Not near a wall → snap side-by-side or back-to-back with a nearby
//      cabinet (islands and peninsulas), otherwise free placement.
//
// Collisions are 3-D in the simple sense: two objects only conflict when
// their plan footprints overlap AND their height ranges overlap, so wall
// cabinets hang over base cabinets without complaint but a wall cabinet
// running into a tall pantry or a window is flagged.
//
// The result carries the gaps to the nearest obstruction on each side, which
// the placement ghost draws as live dimensions.

import { normAngle } from './model.js';

const EPS = 0.05;
// Overlaps smaller than this are ignored (an install absorbs 1/8").
const OVERLAP_TOL = 0.125;

// ---- small vector helpers -------------------------------------------------

const dot = (a, b) => a.x * b.x + a.y * b.y;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

function wallRect(w) {
    const L = w.length;
    if (L < 1e-6) return null;
    const ax = (w.end.x - w.start.x) / L, ay = (w.end.y - w.start.y) / L;
    const px = -ay, py = ax, h = w.thickness / 2;
    return [
        { x: w.start.x + px * h, y: w.start.y + py * h },
        { x: w.end.x + px * h, y: w.end.y + py * h },
        { x: w.end.x - px * h, y: w.end.y - py * h },
        { x: w.start.x - px * h, y: w.start.y - py * h },
    ];
}

function projectRange(pts, origin, axis) {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) {
        const v = dot(sub(p, origin), axis);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    return [lo, hi];
}

function verticalOverlap(a0, a1, b0, b1) {
    return Math.min(a1, b1) - Math.max(a0, b0) > EPS;
}

// Rotation that makes an object's front (+y local) face along `n`.
function rotationFacing(n) {
    return normAngle(Math.atan2(-n.x, n.y));
}

// ---- main entry ------------------------------------------------------------

/**
 * @param scene     Scene
 * @param proto     { width, depth, height, elevation, shape, snap, collide }
 * @param cursor    scene point
 * @param opts      { exclude:Set<item>, free:boolean, userRotation:number,
 *                    zoom:number, flip:boolean }
 * @returns {{pos, rotation, flip, mode, gaps, collides, run}}
 */
export function solvePlacement(scene, proto, cursor, opts = {}) {
    const exclude = opts.exclude || new Set();
    const userRot = opts.userRotation || 0;
    const zoom = Math.max(opts.zoom || 1, 1e-6);
    const snapTol = Math.max(4, 10 / zoom);

    if (opts.free) {
        const res = {
            pos: { ...cursor }, rotation: normAngle(userRot), flip: !!opts.flip,
            mode: 'free', gaps: null, run: null,
        };
        res.collides = collidesAt(scene, proto, res, exclude);
        return res;
    }

    if ((proto.snap || 'wall') === 'wall') {
        const w = wallPlacement(scene, proto, cursor, exclude, snapTol, opts);
        if (w) return w;
    }

    const n = neighbourPlacement(scene, proto, cursor, exclude, userRot, opts);
    if (n) return n;

    const res = {
        pos: { x: Math.round(cursor.x), y: Math.round(cursor.y) },
        rotation: normAngle(userRot), flip: !!opts.flip,
        mode: 'free', gaps: null, run: null,
    };
    res.collides = collidesAt(scene, proto, res, exclude);
    return res;
}

// ---- wall placement --------------------------------------------------------

function wallPlacement(scene, proto, cursor, exclude, snapTol, opts) {
    const depth = proto.depth;
    const reach = Math.max(18, depth + 6);   // how far from a wall still snaps
    let best = null;

    for (const w of scene.walls()) {
        const L = w.length;
        if (L < 1) continue;
        const a = { x: (w.end.x - w.start.x) / L, y: (w.end.y - w.start.y) / L };
        const p = { x: -a.y, y: a.x };
        const rel = sub(cursor, w.start);
        const along = dot(rel, a);
        const perp = dot(rel, p);
        const halfT = w.thickness / 2;
        if (along < -depth || along > L + depth) continue;
        const fromFace = Math.abs(perp) - halfT;
        if (fromFace < -halfT || fromFace > reach) continue;
        if (!best || fromFace < best.fromFace) {
            best = { wall: w, a, p, along, perp, fromFace, L, halfT };
        }
    }
    if (!best) return null;

    const { wall, a, p, L, halfT } = best;
    const sign = best.perp >= 0 ? 1 : -1;
    const n = { x: p.x * sign, y: p.y * sign };          // into the room
    const rotation = rotationFacing(n);
    const u = { x: Math.cos(rotation), y: Math.sin(rotation) };  // object +x
    // Origin of the run frame: on the wall face, at the wall's start.
    const origin = { x: wall.start.x + n.x * halfT, y: wall.start.y + n.y * halfT };
    // u is ±a; wall-start sits at 0 along u, wall-end at ±L.
    const uSign = dot(u, a) >= 0 ? 1 : -1;
    const wallLo = uSign > 0 ? 0 : -L;
    const wallHi = uSign > 0 ? L : 0;

    const obstacles = runObstacles(scene, proto, wall, origin, u, n, exclude);
    const soft = [wallLo, wallHi];   // wall ends: snap targets, not collisions

    const w2 = proto.width / 2;
    let c = dot(sub(cursor, origin), u);

    // Candidate positions: where the cursor is, plus every position that
    // puts one end flush against a nearby edge. Prefer a flush spot that
    // doesn't hit anything; if the cursor spot collides, also try pushing
    // the object clear of what it hits (up to half its width).
    const edges = [...soft];
    for (const [olo, ohi] of obstacles) edges.push(olo, ohi);
    const hitsAt = (cc) => proto.collide !== false &&
        obstacles.some(([olo, ohi]) => Math.min(cc + w2, ohi) - Math.max(cc - w2, olo) > OVERLAP_TOL);
    const cands = [];
    for (const e of edges) {
        for (const side of [-1, 1]) {
            const shift = e - (c + side * w2);
            if (Math.abs(shift) <= snapTol) cands.push({ cc: c + shift, d: Math.abs(shift), flush: true });
        }
    }
    if (hitsAt(c)) {
        for (const [olo, ohi] of obstacles) {
            for (const cc of [olo - w2, ohi + w2]) {
                const d = Math.abs(cc - c);
                if (d <= Math.max(snapTol, w2)) cands.push({ cc, d, flush: true });
            }
        }
    }
    const ok = cands.filter(k => !hitsAt(k.cc)).sort((a, b) => a.d - b.d);
    if (ok.length) c = ok[0].cc;
    else if (!opts.exact) c = Math.round(c * 4) / 4;   // quarter-inch steps while sliding

    const lo = c - w2, hi = c + w2;

    // Gaps to the nearest hard/soft limit on each side.
    let leftLimit = -Infinity, rightLimit = Infinity, leftSoft = false, rightSoft = false;
    for (const [olo, ohi] of obstacles) {
        if (ohi <= lo + EPS && ohi > leftLimit) { leftLimit = ohi; leftSoft = false; }
        if (olo >= hi - EPS && olo < rightLimit) { rightLimit = olo; rightSoft = false; }
    }
    if (wallLo <= lo + EPS && wallLo > leftLimit) { leftLimit = wallLo; leftSoft = true; }
    if (wallHi >= hi - EPS && wallHi < rightLimit) { rightLimit = wallHi; rightSoft = true; }

    // Corner shapes put their side leg toward the nearer obstruction.
    let flip = !!opts.flip;
    if (proto.shape === 'L' || proto.shape === 'angle') {
        const dl = isFinite(leftLimit) ? lo - leftLimit : Infinity;
        const dr = isFinite(rightLimit) ? rightLimit - hi : Infinity;
        flip = dr < dl;
    }

    const pos = {
        x: origin.x + u.x * c + n.x * proto.depth / 2,
        y: origin.y + u.y * c + n.y * proto.depth / 2,
    };

    let collides = false;
    if (proto.collide !== false) {
        for (const [olo, ohi] of obstacles) {
            if (Math.min(hi, ohi) - Math.max(lo, olo) > OVERLAP_TOL) { collides = true; break; }
        }
    }
    const res = {
        pos, rotation, flip, mode: 'wall', wall,
        gaps: {
            left: isFinite(leftLimit) ? lo - leftLimit : null,
            right: isFinite(rightLimit) ? rightLimit - hi : null,
            leftSoft, rightSoft,
        },
        run: { origin, u, n, lo, hi, leftLimit, rightLimit },
        collides,
    };
    // Anything the strip test can't see (e.g. diagonal items) still counts.
    if (!collides && proto.collide !== false) res.collides = collidesAt(scene, proto, res, exclude);
    return res;
}

// Intervals along `u` (relative to origin) occupied by things that would
// block an object of `proto`'s depth and height standing against the wall.
function runObstacles(scene, proto, wall, origin, u, n, exclude) {
    const out = [];
    const d = proto.depth;
    const z0 = proto.elevation || 0, z1 = z0 + (proto.height || 0);
    const inBand = ([nlo, nhi]) => Math.min(nhi, d - EPS) - Math.max(nlo, EPS) > 0;

    // Other walls (corners, T-walls, stubs). Interior opening jambs don't
    // matter here — only wall bodies.
    for (const w of scene.walls()) {
        if (w === wall) continue;
        const r = wallRect(w);
        if (!r) continue;
        if (!inBand(projectRange(r, origin, n))) continue;
        out.push(projectRange(r, origin, u));
    }

    // Doors and windows in this wall, by their height range.
    const L = wall.length;
    const a = { x: (wall.end.x - wall.start.x) / L, y: (wall.end.y - wall.start.y) / L };
    const uSign = dot(u, a) >= 0 ? 1 : -1;
    for (const op of wall.openings) {
        const oz0 = op.openingKind === 'door' ? 0 : (op.sill || 0);
        const oz1 = oz0 + (op.height || 80);
        if (!verticalOverlap(z0, z1, oz0, oz1)) continue;
        const s = op.offset - op.width / 2, e = op.offset + op.width / 2;
        out.push(uSign > 0 ? [s, e] : [-e, -s]);
    }

    // Placed cabinets and fixtures.
    for (const it of scene.placed()) {
        if (exclude.has(it)) continue;
        if (it.collide === false || proto.collide === false) continue;
        if (!verticalOverlap(z0, z1, it.elevation, it.elevation + it.height)) continue;
        const fp = it.footprint();
        if (!inBand(projectRange(fp, origin, n))) continue;
        out.push(projectRange(fp, origin, u));
    }
    return out;
}

// ---- neighbour placement (islands / peninsulas) -----------------------------

function neighbourPlacement(scene, proto, cursor, exclude, userRot, opts) {
    let best = null;
    const reach = Math.max(12, Math.min(proto.width, proto.depth) * 0.75);
    const z0 = proto.elevation || 0, z1 = z0 + (proto.height || 0);
    for (const it of scene.placed()) {
        if (exclude.has(it)) continue;
        if (!verticalOverlap(z0, z1, it.elevation, it.elevation + it.height)) continue;
        const l = it.toLocal(cursor);
        const nw = it.width / 2, nd = it.depth / 2;
        const w2 = proto.width / 2, d2 = proto.depth / 2;
        const cands = [
            // side by side, backs aligned
            { lx: nw + w2, ly: -nd + d2, rot: it.rotation },
            { lx: -nw - w2, ly: -nd + d2, rot: it.rotation },
            // back to back (island)
            { lx: snapSlide(l.x, nw, w2), ly: -nd - d2, rot: it.rotation + Math.PI },
            // front to back (peninsula end cap seating etc.) is rare; skip
        ];
        for (const c of cands) {
            const dist = Math.hypot(l.x - c.lx, l.y - c.ly);
            if (dist > reach + Math.max(w2, d2)) continue;
            if (!best || dist < best.dist) best = { it, c, dist };
        }
    }
    if (!best) return null;
    const pos = best.it.toWorld(best.c.lx, best.c.ly);
    const res = {
        pos, rotation: normAngle(best.c.rot), flip: !!opts.flip,
        mode: 'neighbour', gaps: null, run: null,
    };
    res.collides = collidesAt(scene, proto, res, exclude);
    return res;
}

// Slide along a neighbour's back but click to flush-left / centre / flush-right.
function snapSlide(x, nw, w2) {
    const targets = [-nw + w2, 0, nw - w2];
    for (const t of targets) if (Math.abs(x - t) < 4) return t;
    return Math.round(x);
}

// ---- generic collision test ------------------------------------------------

export function collidesAt(scene, proto, pose, exclude = new Set()) {
    if (proto.collide === false) return false;
    const z0 = proto.elevation || 0, z1 = z0 + (proto.height || 0);
    const probe = makeProbe(proto, pose);
    const mine = probe.footprint;
    for (const it of scene.placed()) {
        if (exclude.has(it) || it.collide === false) continue;
        if (!verticalOverlap(z0, z1, it.elevation, it.elevation + it.height)) continue;
        if (polygonsOverlap(mine, it.footprint())) return true;
    }
    for (const w of scene.walls()) {
        const r = wallRect(w);
        if (r && polygonsOverlap(mine, r)) return true;
    }
    return false;
}

function makeProbe(proto, pose) {
    const c = Math.cos(pose.rotation), s = Math.sin(pose.rotation);
    const hw = proto.width / 2, hd = proto.depth / 2;
    const footprint = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => ({
        x: pose.pos.x + x * c - y * s, y: pose.pos.y + x * s + y * c,
    }));
    return { footprint };
}

// Separating-axis test for convex polygons, shrunk slightly so objects that
// merely touch don't count as overlapping. (L-shapes are tested by their
// bounding box — close enough for warnings.)
function polygonsOverlap(A, B) {
    const shrink = OVERLAP_TOL;
    for (const poly of [A, B]) {
        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
            const nx = -(p2.y - p1.y), ny = p2.x - p1.x;
            const len = Math.hypot(nx, ny);
            if (len < 1e-9) continue;
            const ax = { x: nx / len, y: ny / len };
            const [a0, a1] = projectRange(A, { x: 0, y: 0 }, ax);
            const [b0, b1] = projectRange(B, { x: 0, y: 0 }, ax);
            if (Math.min(a1, b1) - Math.max(a0, b0) <= shrink) return false;
        }
    }
    return true;
}

// Gaps either side of an object that's already standing against a wall
// (for the properties panel). Returns null if it isn't against a wall.
export function gapsFor(scene, item) {
    const proto = {
        width: item.width, depth: item.depth, height: item.height,
        elevation: item.elevation, shape: item.shape, snap: 'wall',
        collide: item.collide !== false,
    };
    const back = item.toWorld(0, -item.depth / 2 + 0.25);
    const res = wallPlacement(scene, proto, back, new Set([item]), 0.001,
                              { flip: item.flip, exact: true });
    if (!res) return null;
    const off = Math.hypot(res.pos.x - item.pos.x, res.pos.y - item.pos.y);
    const dRot = Math.abs(normAngle(res.rotation - item.rotation));
    if (off > 0.75 || Math.min(dRot, 2 * Math.PI - dRot) > 0.01) return null;
    return { ...res.gaps, run: res.run, wall: res.wall, collides: res.collides };
}
