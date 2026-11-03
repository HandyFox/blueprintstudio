// Cabinet elevations.
//
// Groups the cabinets and appliances that stand along the same line (a wall,
// or the two faces of an island) into "runs" and draws each run as a front
// elevation: toe kicks, drawers, doors with hinge marks, countertop, wall
// cabinets at their real mounting height, appliance fronts, and dimension
// strings.
//
// The drawing is produced as a list of simple primitives in inches
// (x → along the run, y ↑ from the floor). The same list is rendered to SVG
// for the on-screen preview and sent to the server for the PDF, so both
// always match.

import { getFixture, primsToPaths } from './symbols.js';
import { doorCount } from './cabinets.js';
import { formatLength } from './units.js';
import { isPlaced } from './model.js';

const COUNTER_T = 1.5;     // countertop thickness
const TOE_H = 4;           // toe kick height
const RAIL = 0.75;         // face-frame reveal around doors/drawers

function isElevationItem(it) {
    if (!isPlaced(it)) return false;
    if (it.kind === 'fixture') {
        const spec = getFixture(it.fixture_id);
        // Furniture and in-counter items (sinks, cooktops) don't get fronts.
        if (it.layer_name === 'Furniture') return false;
        if (spec && spec.collide === false) return false;
    }
    return true;
}

// ---- grouping ---------------------------------------------------------------

export function computeRuns(scene) {
    const items = scene.items.filter(isElevationItem);
    const groups = [];
    for (const it of items) {
        const r = it.rotation;
        const u = { x: Math.cos(r), y: Math.sin(r) };
        const n = { x: -Math.sin(r), y: Math.cos(r) };
        const back = it.toWorld(0, -it.depth / 2);
        const line = back.x * n.x + back.y * n.y;
        let g = groups.find(g => angleClose(g.rot, r) && Math.abs(g.line - line) < 2.5);
        if (!g) { g = { rot: r, u, n, line, items: [] }; groups.push(g); }
        g.items.push(it);
    }
    // Biggest runs first, then reading order on the plan.
    const runs = groups.map((g) => {
        let lo = Infinity, hi = -Infinity;
        const entries = g.items.map(it => {
            const c = it.pos.x * g.u.x + it.pos.y * g.u.y;
            const x0 = c - it.width / 2, x1 = c + it.width / 2;
            lo = Math.min(lo, x0); hi = Math.max(hi, x1);
            return { item: it, x0, x1 };
        });
        for (const e of entries) { e.x0 -= lo; e.x1 -= lo; }
        entries.sort((a, b) => a.x0 - b.x0 || a.item.elevation - b.item.elevation);
        const backMid = {
            x: g.n.x * g.line + g.u.x * (lo + hi) / 2,
            y: g.n.y * g.line + g.u.y * (lo + hi) / 2,
        };
        const wallInfo = wallBehind(scene, g, lo);
        return { rot: g.rot, u: g.u, n: g.n, length: hi - lo, entries, backMid, ...wallInfo };
    }).filter(r => r.entries.length);
    runs.sort((a, b) => (a.backMid.y - b.backMid.y) || (a.backMid.x - b.backMid.x));
    runs.forEach((r, i) => {
        r.letter = String.fromCharCode(65 + (i % 26));
        r.title = `Elevation ${r.letter}`;
        // Where to put the elevation tag on the plan: in front of the run.
        const depth = Math.max(...r.entries.map(e => e.item.depth));
        r.marker = {
            x: r.backMid.x + r.n.x * (depth + 30),
            y: r.backMid.y + r.n.y * (depth + 30),
            // the tag's arrow points back at the cabinets
            dir: Math.atan2(-r.n.y, -r.n.x),
        };
    });
    return runs;
}

// The wall a run stands against (if any): its extent along the run and its
// doors/windows, in run coordinates (x from the run's left end).
function wallBehind(scene, g, lo) {
    let best = null;
    for (const w of scene.walls()) {
        const L = w.length;
        if (L < 1) continue;
        const a = { x: (w.end.x - w.start.x) / L, y: (w.end.y - w.start.y) / L };
        if (Math.abs(a.x * g.u.x + a.y * g.u.y) < 0.999) continue;
        const face = (w.start.x * g.n.x + w.start.y * g.n.y) + w.thickness / 2;
        if (Math.abs(face - g.line) > 1.5) continue;
        const s0 = w.start.x * g.u.x + w.start.y * g.u.y - lo;
        const s1 = w.end.x * g.u.x + w.end.y * g.u.y - lo;
        if (!best || Math.abs(face - g.line) < best.err) best = { w, s0, s1, a, err: Math.abs(face - g.line) };
    }
    if (!best) return { wallSpan: null, openings: [] };
    const { w, s0, s1, a } = best;
    const dir = a.x * g.u.x + a.y * g.u.y > 0 ? 1 : -1;
    const openings = w.openings.map(op => {
        const xa = s0 + dir * (op.offset - op.width / 2);
        const xb = s0 + dir * (op.offset + op.width / 2);
        return {
            kind: op.openingKind, x0: Math.min(xa, xb), x1: Math.max(xa, xb),
            sill: op.openingKind === 'door' ? 0 : (op.sill || 0), height: op.height || 80,
        };
    });
    return { wallSpan: [Math.min(s0, s1), Math.max(s0, s1)], openings, wallHeight: w.height || 96 };
}

function angleClose(a, b) {
    let d = Math.abs(a - b) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d < 0.01;
}

// ---- primitive builders -------------------------------------------------------

function P() {
    const out = [];
    return {
        out,
        rect(x, y, w, h, o = {}) { out.push({ t: 'rect', x, y, w, h, ...o }); },
        line(x1, y1, x2, y2, o = {}) { out.push({ t: 'line', x1, y1, x2, y2, ...o }); },
        poly(pts, o = {}) { out.push({ t: 'poly', pts, closed: o.closed !== false, ...o }); },
        text(x, y, s, o = {}) { out.push({ t: 'text', x, y, s, size: o.size || 3, anchor: o.anchor || 'middle', ...o }); },
    };
}

const PAINTED = new Set(['DWhite', 'Gray']);

function drawDoor(p, x, y, w, h, hinge, opts = {}) {
    p.rect(x, y, w, h, { fill: opts.fill, lw: 0.6 });
    // Shaker recessed panel
    const inset = Math.min(2.5, w / 5, h / 5);
    if (w > 6 && h > 6) p.rect(x + inset, y + inset, w - 2 * inset, h - 2 * inset, { lw: 0.3 });
    // Hinge mark: dashed lines from the latch-side corners to the hinge side.
    if (hinge) {
        const hx = hinge === 'L' ? x : x + w;
        const lx = hinge === 'L' ? x + w : x;
        p.line(lx, y, hx, y + h / 2, { dash: true, lw: 0.25 });
        p.line(lx, y + h, hx, y + h / 2, { dash: true, lw: 0.25 });
        // pull on the latch side
        const px = hinge === 'L' ? x + w - 1.5 : x + 1.5;
        const py0 = opts.upper ? y + 2 : y + h - 6;
        p.line(px, py0, px, py0 + 4, { lw: 0.9 });
    }
}

function drawDrawer(p, x, y, w, h) {
    p.rect(x, y, w, h, { lw: 0.6 });
    p.line(x + w / 2 - Math.min(3, w / 6), y + h / 2, x + w / 2 + Math.min(3, w / 6), y + h / 2, { lw: 0.9 });
}

function drawDoors(p, x, y, w, h, n, hinge, opts) {
    if (n <= 1) { drawDoor(p, x, y, w, h, hinge || 'L', opts); return; }
    const dw = (w - RAIL) / 2;
    drawDoor(p, x, y, dw, h, 'L', opts);
    drawDoor(p, x + dw + RAIL, y, dw, h, 'R', opts);
}

function drawCabinetFront(p, cab, x0, x1) {
    const W = x1 - x0, E = cab.elevation, H = cab.height;
    const top = E + H;
    const m = (cab.model || '').toUpperCase();
    p.rect(x0, E, W, H, { fill: '#f5efe3', lw: 0.8 });

    if (cab.filler) {
        for (let y = E + 2; y < top; y += 3) p.line(x0, y, x1, Math.min(top, y + W), { lw: 0.2 });
        return;
    }
    const upper = E >= 40;
    const floorBox = E < 1;
    let fy0 = E, fy1 = top;
    if (floorBox && cab.category !== 'tall') {
        p.rect(x0 + 0.5, 0, W - 1, TOE_H, { fill: '#3f3a36', lw: 0.3 });
        fy0 = TOE_H;
    } else if (floorBox && cab.category === 'tall') {
        p.rect(x0 + 0.5, 0, W - 1, TOE_H, { fill: '#3f3a36', lw: 0.3 });
        fy0 = TOE_H;
    }
    const ix0 = x0 + RAIL, ix1 = x1 - RAIL, iW = ix1 - ix0;
    const iy0 = fy0 + RAIL, iy1 = fy1 - RAIL;
    const doors = doorCount(cab);
    const hinge = cab.hinge || 'L';

    // Blind corners: one blank panel side, door on the other.
    if (cab.blind) {
        const doorW = Math.min(iW - 6, upper ? (cab.width <= 24 ? 9 : cab.width <= 36 ? 21 : 24) : (cab.width >= 42 ? 15 : 12));
        const blankLeft = !cab.flip;
        const dx0 = blankLeft ? ix1 - doorW : ix0;
        p.rect(blankLeft ? ix0 : ix0 + doorW, iy0, iW - doorW, iy1 - iy0, { fill: '#e9e1d1', lw: 0.3 });
        if (!upper) {
            drawDrawer(p, dx0, iy1 - 6, doorW, 6);
            drawDoor(p, dx0, iy0, doorW, iy1 - 6 - RAIL - iy0, blankLeft ? 'R' : 'L');
        } else {
            drawDoor(p, dx0, iy0, doorW, iy1 - iy0, blankLeft ? 'R' : 'L', { upper: true });
        }
        return;
    }

    if (upper) {
        drawDoors(p, ix0, iy0, iW, iy1 - iy0, doors, hinge, { upper: true });
        return;
    }

    if (cab.category === 'tall') {
        const h = iy1 - iy0;
        if (/OU/.test(m)) {
            // Oven cabinet: doors on top, oven opening, two drawers below.
            const topDoor = Math.min(18, h * 0.22);
            drawDoors(p, ix0, iy1 - topDoor, iW, topDoor, 2, hinge, {});
            const ovenTop = iy1 - topDoor - RAIL;
            const ovenH = 29;
            p.rect(ix0 + 1, ovenTop - ovenH, iW - 2, ovenH, { dash: true, lw: 0.5 });
            p.text((x0 + x1) / 2, ovenTop - ovenH / 2, 'OVEN', { size: 2.5 });
            const dTop = ovenTop - ovenH - RAIL;
            const dh = (dTop - iy0 - RAIL) / 2;
            drawDrawer(p, ix0, iy0 + dh + RAIL, iW, dh);
            drawDrawer(p, ix0, iy0, iW, dh);
        } else {
            const upperH = h * 0.32;
            drawDoors(p, ix0, iy1 - upperH, iW, upperH, doors, hinge, {});
            drawDoors(p, ix0, iy0, iW, h - upperH - RAIL, doors, hinge, {});
        }
        return;
    }

    if (cab.shape === 'L' || cab.category === 'lazy') {
        drawDoor(p, ix0, iy0, iW / 2 - RAIL / 2, iy1 - iy0, 'L');
        drawDoor(p, ix0 + iW / 2 + RAIL / 2, iy0, iW / 2 - RAIL / 2, iy1 - iy0, 'R');
        return;
    }

    // Drawer bases: 4 drawers in stained finishes, 3 in painted ones.
    const isDrawerBase = /^(UD|H|V)?\d+D(T)?$/.test(m);
    if (isDrawerBase) {
        const n = PAINTED.has(cab.finish) ? 3 : 4;
        const total = iy1 - iy0;
        const dh = (total - RAIL * (n - 1)) / n;
        for (let i = 0; i < n; i++) drawDrawer(p, ix0, iy0 + i * (dh + RAIL), iW, dh);
        return;
    }
    const isSinkBase = /RBS|SB|^V\d+S|SF/.test(m);
    if (/^(UD)?9T$/.test(m)) {
        drawDoor(p, ix0, iy0, iW, iy1 - iy0, hinge);
        return;
    }
    // Standard base / sink base: drawer (or false front) on top, doors below.
    const dH = 6;
    if (isSinkBase) {
        p.rect(ix0, iy1 - dH, iW, dH, { lw: 0.6, fill: '#efe7d8' });
    } else {
        const drawers = doors > 1 ? 2 : 1;
        const dw = (iW - RAIL * (drawers - 1)) / drawers;
        for (let i = 0; i < drawers; i++) drawDrawer(p, ix0 + i * (dw + RAIL), iy1 - dH, dw, dH);
    }
    drawDoors(p, ix0, iy0, iW, iy1 - dH - RAIL - iy0, doors, hinge, {});
}

function drawFixtureFront(p, fx, x0, x1) {
    const spec = getFixture(fx.fixture_id);
    const W = x1 - x0, E = fx.elevation, H = fx.height;
    const prims = spec ? spec.elev : [{ t: 'rect', x: 0, y: 0, w: 1, h: 1 }];
    const paths = primsToPaths(prims, W, H, 'elev', fx.flip);
    let first = true;
    for (const path of paths) {
        p.poly(path.pts.map(([x, y]) => [x0 + x, E + y]), {
            closed: path.closed, dash: path.dash, lw: 0.6,
            fill: first && path.closed ? '#ffffff' : undefined,
        });
        first = false;
    }
    const label = fx.label || (spec && spec.label) || '';
    if (label) p.text((x0 + x1) / 2, E + H / 2, label, { size: 3, bold: true, color: '#134e4a' });
}

// ---- elevation drawing ----------------------------------------------------

export function buildElevation(run) {
    const p = P();
    const L = run.length;
    const entries = run.entries.slice().sort((a, b) => (a.item.elevation - b.item.elevation));

    // Wall behind the run (clipped to 4' past the cabinets) with its doors
    // and windows, then the floor line.
    const wallH = Math.max(run.wallHeight || 96, ...entries.map(e => e.item.elevation + e.item.height + 6));
    let wx0 = -6, wx1 = L + 6;
    if (run.wallSpan) {
        wx0 = Math.max(run.wallSpan[0], -48);
        wx1 = Math.min(run.wallSpan[1], L + 48);
    }
    p.rect(wx0, 0, wx1 - wx0, wallH, { fill: '#f3f1ea', lw: 0.3, color: '#a8a29e' });
    for (const op of run.openings || []) {
        if (op.x1 < wx0 || op.x0 > wx1) continue;
        const y0 = op.sill, y1 = Math.min(wallH, op.sill + op.height);
        p.rect(op.x0, y0, op.x1 - op.x0, y1 - y0, { fill: '#ffffff', lw: 0.5, color: '#64748b' });
        if (op.kind === 'window') {
            const mid = (op.x0 + op.x1) / 2;
            p.line(mid, y0, mid, y1, { lw: 0.3, color: '#64748b' });
            p.rect(op.x0 + 1.5, y0 + 1.5, op.x1 - op.x0 - 3, y1 - y0 - 3, { lw: 0.25, color: '#94a3b8' });
        } else {
            p.text((op.x0 + op.x1) / 2, y1 - 6, 'DOOR', { size: 2.4, color: '#64748b' });
        }
    }
    p.line(Math.min(wx0, -12), 0, Math.max(wx1, L + 12), 0, { lw: 1.4 });

    // Countertops over contiguous counter-height items.
    const counterSegs = [];
    for (const e of entries) {
        const it = e.item;
        const top = it.elevation + it.height;
        const counterHeight = it.elevation < 1 && top > 28 && top < 37.5;
        const isRange = it.kind === 'fixture' && /^range/.test(it.fixture_id);
        const isLaundry = it.kind === 'fixture' && /^(washer|dryer|stack_wd)/.test(it.fixture_id);
        if (counterHeight && !isRange && !isLaundry) {
            counterSegs.push([e.x0, e.x1, top]);
        }
    }
    counterSegs.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const s of counterSegs) {
        const last = merged[merged.length - 1];
        if (last && s[0] <= last[1] + 0.5 && Math.abs(s[2] - last[2]) < 0.6) last[1] = Math.max(last[1], s[1]);
        else merged.push(s.slice());
    }

    for (const e of entries) {
        if (e.item.kind === 'cabinet') drawCabinetFront(p, e.item, e.x0, e.x1);
        else drawFixtureFront(p, e.item, e.x0, e.x1);
    }
    for (const [a, b, top] of merged) {
        p.rect(a - 0.5, top, b - a + 1, COUNTER_T, { fill: '#a8a29e', lw: 0.6 });
    }

    // Model codes centred under each item (base row) or above (upper row).
    for (const e of entries) {
        const it = e.item;
        const code = it.kind === 'cabinet' ? it.model : (it.label || (getFixture(it.fixture_id) || {}).label || '');
        if (!code || it.kind === 'fixture') continue;
        const upper = it.elevation >= 40;
        const y = upper ? it.elevation + it.height / 2 : Math.max(TOE_H + 3, it.height * 0.45);
        p.text((e.x0 + e.x1) / 2, y, code, { size: Math.min(3.2, (e.x1 - e.x0) / (code.length * 0.62)), bold: true, color: '#44403c', halo: true });
    }

    // Dimension strings: base row below the floor, upper row above the uppers.
    const dimRow = (segs, y, tick) => {
        for (const [a, b] of segs) {
            if (b - a < 0.5) continue;
            p.line(a, y, b, y, { lw: 0.4, color: '#7a4a00' });
            for (const x of [a, b]) p.line(x, y - tick, x, y + tick, { lw: 0.4, color: '#7a4a00' });
            p.text((a + b) / 2, y + (tick > 0 ? 1.2 : -3.2), formatLength(b - a), { size: 2.6, color: '#7a4a00' });
        }
    };
    const lowSegs = entries.filter(e => e.item.elevation < 40).map(e => [e.x0, e.x1]);
    const upSegs = entries.filter(e => e.item.elevation >= 40).map(e => [e.x0, e.x1]);
    dimRow(lowSegs, -6, 1.2);
    dimRow([[0, L]], -13, 1.2);
    const upTop = Math.max(0, ...entries.filter(e => e.item.elevation >= 40).map(e => e.item.elevation + e.item.height));
    if (upSegs.length) dimRow(upSegs, upTop + 5, 1.2);

    // Height marks on the left: counter top, bottom & top of uppers.
    const marks = new Set();
    if (merged.length) marks.add(+(merged[0][2] + COUNTER_T).toFixed(3));
    for (const e of entries) {
        if (e.item.elevation >= 40) { marks.add(e.item.elevation); marks.add(e.item.elevation + e.item.height); }
        else if (e.item.kind === 'cabinet' && e.item.category === 'tall') marks.add(e.item.elevation + e.item.height);
    }
    const hx = -10;
    for (const h of [...marks].sort((a, b) => a - b)) {
        p.line(hx - 1.5, h, hx + 1.5, h, { lw: 0.4, color: '#7a4a00' });
        p.line(hx, 0, hx, h, { lw: 0.25, color: '#7a4a00', dash: true });
        p.text(hx - 2, h - 1, formatLength(h), { size: 2.4, anchor: 'end', color: '#7a4a00' });
    }

    return {
        title: run.title, letter: run.letter,
        width: L, height: wallH,
        bounds: { x0: Math.min(-24, wx0 - 14), y0: -18, x1: Math.max(L + 14, wx1 + 4), y1: wallH + 4 },
        prims: p.out,
    };
}

export function buildAllElevations(scene) {
    return computeRuns(scene).map(r => ({ ...buildElevation(r), marker: r.marker }));
}

// ---- SVG preview ------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    return e;
}

export function elevationToSVG(elev, pxPerInch = 4) {
    const b = elev.bounds;
    const W = b.x1 - b.x0, H = b.y1 - b.y0;
    const svg = s('svg', {
        viewBox: `${b.x0} ${-b.y1} ${W} ${H}`,
        width: Math.round(W * pxPerInch), height: Math.round(H * pxPerInch),
        class: 'elev-svg',
    });
    const g = s('g', { transform: 'scale(1,-1)' });
    svg.appendChild(g);
    for (const pr of elev.prims) {
        const stroke = pr.stroke === 'none' ? 'none' : (pr.color || '#1c1917');
        const sw = (pr.lw ?? 0.5) * 0.35;
        if (pr.t === 'rect') {
            g.appendChild(s('rect', {
                x: pr.x, y: pr.y, width: pr.w, height: pr.h,
                fill: pr.fill || 'none', stroke: pr.lw === 0 ? 'none' : stroke, 'stroke-width': sw,
                'stroke-dasharray': pr.dash ? '1.2,0.9' : undefined,
            }));
        } else if (pr.t === 'line') {
            g.appendChild(s('line', {
                x1: pr.x1, y1: pr.y1, x2: pr.x2, y2: pr.y2, stroke, 'stroke-width': sw,
                'stroke-dasharray': pr.dash ? '1.2,0.9' : undefined,
            }));
        } else if (pr.t === 'poly') {
            g.appendChild(s(pr.closed ? 'polygon' : 'polyline', {
                points: pr.pts.map(q => q.join(',')).join(' '),
                fill: pr.fill || 'none', stroke, 'stroke-width': sw,
                'stroke-dasharray': pr.dash ? '1.2,0.9' : undefined,
            }));
        } else if (pr.t === 'text') {
            const t = s('text', {
                x: pr.x, y: -pr.y, 'font-size': pr.size,
                'text-anchor': pr.anchor === 'end' ? 'end' : pr.anchor === 'start' ? 'start' : 'middle',
                'dominant-baseline': 'middle',
                'font-family': 'Inter, Helvetica, Arial, sans-serif',
                'font-weight': pr.bold ? '700' : '400',
                fill: pr.color || '#1c1917',
                transform: 'scale(1,-1)',
            });
            if (pr.halo) {
                t.setAttribute('paint-order', 'stroke');
                t.setAttribute('stroke', '#f5efe3');
                t.setAttribute('stroke-width', String(pr.size / 3));
            }
            t.textContent = pr.s;
            // text sits in the un-flipped space; cancel the group flip
            t.setAttribute('y', String(-pr.y));
            g.appendChild(t);
        }
    }
    return svg;
}
