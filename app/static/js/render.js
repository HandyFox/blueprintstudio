// SVG renderer.
//
// We render the scene as nested SVG groups inside a single <svg>. The view's
// pan/zoom is achieved by a single transform on the root group:
//   <g transform="translate(panX,panY) scale(zoom)">
// This is fast — pan/zoom doesn't redraw a single element.
//
// Items live in three layer groups (low, items, top) so dimensions and labels
// always render above walls.

import { angleOf, dist } from './geometry.js';
import { formatArea, formatBearing, formatLength } from './units.js';
import { getFixture, primsToPaths } from './symbols.js';

// Draw order: lower numbers first. Placed objects are additionally ordered
// by mounting height so wall cabinets draw over the base cabinets beneath.
export const Z_ORDER = { plot: 5, wall: 10, opening: 11, fixture: 12, cabinet: 13,
                         dimension: 15, room: 20, annotation: 25 };
function zKey(it) {
    const z = Z_ORDER[it.kind] || 0;
    if (it.kind === 'cabinet' || it.kind === 'fixture') {
        return 12 + Math.min(0.9, (it.elevation || 0) / 200);
    }
    return z;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const CABINET_PALETTE = {
    wall:   { fill: 'rgba(147,170,214,0.30)', upperFill: 'rgba(147,170,214,0.22)', stroke: '#1e3a8a' },
    base:   { fill: 'rgba(214,190,150,0.55)', upperFill: 'rgba(214,190,150,0.25)', stroke: '#7c5a2a' },
    corner: { fill: 'rgba(214,190,150,0.55)', upperFill: 'rgba(214,190,150,0.25)', stroke: '#7c5a2a' },
    lazy:   { fill: 'rgba(214,190,150,0.55)', upperFill: 'rgba(214,190,150,0.25)', stroke: '#7c5a2a' },
    tall:   { fill: 'rgba(168,162,158,0.55)', upperFill: 'rgba(168,162,158,0.3)', stroke: '#44403c' },
    vanity: { fill: 'rgba(196,181,214,0.5)', upperFill: 'rgba(196,181,214,0.3)', stroke: '#5b4e7a' },
    ada:    { fill: 'rgba(167,201,180,0.55)', upperFill: 'rgba(167,201,180,0.3)', stroke: '#2d6649' },
    filler: { fill: 'rgba(214,190,150,0.35)', upperFill: 'rgba(147,170,214,0.18)', stroke: '#78716c' },
};

export class Renderer {
    constructor(svgEl, document) {
        this.svg = svgEl;
        this.document = document;

        // Pan / zoom state
        this.panX = 0;
        this.panY = 0;
        this.zoom = 1;

        // Layers
        this.gridG = this._make('g', { id: 'grid' });
        this.itemsG = this._make('g', { id: 'items' });
        this.overlayG = this._make('g', { id: 'overlay' });
        this.viewportG = this._make('g', { id: 'viewport' });
        this.viewportG.appendChild(this.gridG);
        this.viewportG.appendChild(this.itemsG);
        this.viewportG.appendChild(this.overlayG);
        this.svg.appendChild(this.viewportG);

        // Snap indicator (overlay, not affected by item updates)
        this.snapIndicator = null;
        this.toolGhost = null;

        this._updateTransform();
    }

    _make(tag, attrs = {}) {
        const el = document.createElementNS(SVG_NS, tag);
        for (const k in attrs) el.setAttribute(k, attrs[k]);
        return el;
    }

    setView(panX, panY, zoom) {
        this.panX = panX; this.panY = panY; this.zoom = zoom;
        this._updateTransform();
    }
    _updateTransform() {
        this.viewportG.setAttribute('transform',
            `translate(${this.panX},${this.panY}) scale(${this.zoom})`);
        // Stroke widths that should appear pixel-sized must be divided by zoom.
        this.svg.style.setProperty('--zoom', this.zoom);
    }

    // Convert screen (CSS pixel) coordinates to scene coords
    screenToScene(sx, sy) {
        const rect = this.svg.getBoundingClientRect();
        const x = (sx - rect.left - this.panX) / this.zoom;
        const y = (sy - rect.top - this.panY) / this.zoom;
        return { x, y };
    }
    sceneToScreen(p) {
        const rect = this.svg.getBoundingClientRect();
        return {
            x: rect.left + this.panX + p.x * this.zoom,
            y: rect.top + this.panY + p.y * this.zoom,
        };
    }

    // Returns viewBox in scene coordinates (used by ruler)
    sceneViewport() {
        const rect = this.svg.getBoundingClientRect();
        const x0 = -this.panX / this.zoom;
        const y0 = -this.panY / this.zoom;
        const w = rect.width / this.zoom;
        const h = rect.height / this.zoom;
        return { x: x0, y: y0, w, h };
    }

    // ---- Full re-render (called when items change) ---------------------

    render() {
        // Grid
        this._renderGrid();

        // Items
        while (this.itemsG.firstChild) this.itemsG.firstChild.remove();

        const settings = this.document.settings;
        const layerOf = name => this.document.layerByName(name);

        // Sort by item type for stable z-order
        const sorted = this.document.scene.items.slice().sort(
            (a, b) => zKey(a) - zKey(b));

        for (const it of sorted) {
            const layer = layerOf(it.layer_name);
            if (layer && !layer.visible) continue;
            const node = this._renderItem(it);
            if (node) {
                node.dataset.uid = it.uid;
                node.dataset.kind = it.kind;
                if (this.document.scene.selection.has(it.uid)) {
                    node.classList.add('selected');
                }
                this.itemsG.appendChild(node);
            }
        }
    }

    _renderGrid() {
        while (this.gridG.firstChild) this.gridG.firstChild.remove();
        const settings = this.document.settings;
        if (!settings.grid_visible) return;

        const vp = this.sceneViewport();
        const minor = settings.grid_spacing /
            Math.max(1, settings.grid_subdivisions);
        const major = settings.grid_spacing;

        // Don't draw too many lines at very high zoom-out; fade minor grid
        const minorPx = minor * this.zoom;
        const drawMinor = minorPx > 4;

        const x0 = Math.floor(vp.x / minor) * minor;
        const x1 = Math.ceil((vp.x + vp.w) / minor) * minor;
        const y0 = Math.floor(vp.y / minor) * minor;
        const y1 = Math.ceil((vp.y + vp.h) / minor) * minor;

        if (drawMinor) {
            const g = this._make('g', {
                stroke: '#e6e2da',
                'stroke-width': (0.5 / this.zoom).toString(),
                fill: 'none',
            });
            for (let x = x0; x <= x1 + 1e-6; x += minor) {
                if (Math.abs(x % major) < 1e-3) continue;
                const ln = this._make('line',
                    { x1: x, y1: vp.y, x2: x, y2: vp.y + vp.h });
                g.appendChild(ln);
            }
            for (let y = y0; y <= y1 + 1e-6; y += minor) {
                if (Math.abs(y % major) < 1e-3) continue;
                const ln = this._make('line',
                    { x1: vp.x, y1: y, x2: vp.x + vp.w, y2: y });
                g.appendChild(ln);
            }
            this.gridG.appendChild(g);
        }

        const g2 = this._make('g', {
            stroke: '#cfc8b8',
            'stroke-width': (0.6 / this.zoom).toString(),
            fill: 'none',
        });
        const xa = Math.floor(vp.x / major) * major;
        const xb = Math.ceil((vp.x + vp.w) / major) * major;
        const ya = Math.floor(vp.y / major) * major;
        const yb = Math.ceil((vp.y + vp.h) / major) * major;
        for (let x = xa; x <= xb + 1e-6; x += major) {
            const ln = this._make('line',
                { x1: x, y1: vp.y, x2: x, y2: vp.y + vp.h });
            g2.appendChild(ln);
        }
        for (let y = ya; y <= yb + 1e-6; y += major) {
            const ln = this._make('line',
                { x1: vp.x, y1: y, x2: vp.x + vp.w, y2: y });
            g2.appendChild(ln);
        }
        this.gridG.appendChild(g2);
    }

    // ---- Item painters --------------------------------------------------

    _renderItem(it) {
        switch (it.kind) {
            case 'wall': return this._paintWall(it);
            case 'dimension': return this._paintDimension(it);
            case 'room': return this._paintRoom(it);
            case 'plot': return this._paintPlot(it);
            case 'annotation': return this._paintAnnotation(it);
            case 'cabinet':
            case 'fixture': return this.paintPlaced(it);
        }
        return null;
    }

    _paintWall(w) {
        const g = this._make('g', { class: 'wall' });
        const sx = w.start.x, sy = w.start.y;
        const ex = w.end.x, ey = w.end.y;
        const L = w.length;
        if (L < 1e-6) return g;
        const ax = (ex - sx) / L, ay = (ey - sy) / L;
        const px = -ay, py = ax;
        const halfT = w.thickness / 2;

        const extS = w.axialExtensionAt('start', this.document.scene);
        const extE = w.axialExtensionAt('end', this.document.scene);

        // Compute solid spans (corner-cleanup + opening cuts)
        const openSpans = w.openings
            .map(op => op.spanAlongWall())
            .sort((a, b) => a[0] - b[0]);
        const solidSpans = [];
        let cursor = 0;
        for (const [s, e] of openSpans) {
            const ss = Math.max(0, Math.min(L, s));
            const ee = Math.max(0, Math.min(L, e));
            if (ee <= cursor) continue;
            if (ss > cursor) solidSpans.push([cursor, ss]);
            cursor = Math.max(cursor, ee);
        }
        if (cursor < L) solidSpans.push([cursor, L]);
        if (extS > 0 && solidSpans.length) {
            if (Math.abs(solidSpans[0][0]) < 1e-6) {
                solidSpans[0] = [-extS, solidSpans[0][1]];
            } else {
                solidSpans.unshift([-extS, 0]);
            }
        }
        if (extE > 0 && solidSpans.length) {
            const last = solidSpans[solidSpans.length - 1];
            if (Math.abs(last[1] - L) < 1e-6) {
                solidSpans[solidSpans.length - 1] = [last[0], L + extE];
            } else {
                solidSpans.push([L, L + extE]);
            }
        }

        const body = w.is_exterior ? '#222222' : '#2b2b2b';

        // Solid body rectangles (filled polygons)
        for (const [span_s, span_e] of solidSpans) {
            const p1x = sx + ax * span_s + px * halfT;
            const p1y = sy + ay * span_s + py * halfT;
            const p2x = sx + ax * span_e + px * halfT;
            const p2y = sy + ay * span_e + py * halfT;
            const p3x = sx + ax * span_e - px * halfT;
            const p3y = sy + ay * span_e - py * halfT;
            const p4x = sx + ax * span_s - px * halfT;
            const p4y = sy + ay * span_s - py * halfT;
            const poly = this._make('polygon', {
                points: `${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y} ${p4x},${p4y}`,
                fill: body, stroke: 'none',
            });
            g.appendChild(poly);
        }

        // Face lines (cosmetic 1px regardless of zoom)
        const faceColor = '#0d0d0d';
        const cosmetic = `${1 / this.zoom}`;
        const fs1x = sx + ax * (-extS) + px * halfT;
        const fs1y = sy + ay * (-extS) + py * halfT;
        const fs2x = sx + ax * (L + extE) + px * halfT;
        const fs2y = sy + ay * (L + extE) + py * halfT;
        const fb1x = sx + ax * (-extS) - px * halfT;
        const fb1y = sy + ay * (-extS) - py * halfT;
        const fb2x = sx + ax * (L + extE) - px * halfT;
        const fb2y = sy + ay * (L + extE) - py * halfT;
        g.appendChild(this._make('line', {
            x1: fs1x, y1: fs1y, x2: fs2x, y2: fs2y,
            stroke: faceColor, 'stroke-width': cosmetic,
        }));
        g.appendChild(this._make('line', {
            x1: fb1x, y1: fb1y, x2: fb2x, y2: fb2y,
            stroke: faceColor, 'stroke-width': cosmetic,
        }));
        // End caps
        if (extS === 0) {
            const a = { x: sx + px * halfT, y: sy + py * halfT };
            const b = { x: sx - px * halfT, y: sy - py * halfT };
            g.appendChild(this._make('line', {
                x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                stroke: faceColor, 'stroke-width': cosmetic,
            }));
        }
        if (extE === 0) {
            const a = { x: ex + px * halfT, y: ey + py * halfT };
            const b = { x: ex - px * halfT, y: ey - py * halfT };
            g.appendChild(this._make('line', {
                x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                stroke: faceColor, 'stroke-width': cosmetic,
            }));
        }
        // Internal opening caps
        for (const [span_s, span_e] of solidSpans) {
            if (1e-3 < span_s && span_s < L - 1e-3) {
                const a = { x: sx + ax * span_s + px * halfT,
                            y: sy + ay * span_s + py * halfT };
                const b = { x: sx + ax * span_s - px * halfT,
                            y: sy + ay * span_s - py * halfT };
                g.appendChild(this._make('line', {
                    x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                    stroke: faceColor, 'stroke-width': cosmetic,
                }));
            }
            if (1e-3 < span_e && span_e < L - 1e-3) {
                const a = { x: sx + ax * span_e + px * halfT,
                            y: sy + ay * span_e + py * halfT };
                const b = { x: sx + ax * span_e - px * halfT,
                            y: sy + ay * span_e - py * halfT };
                g.appendChild(this._make('line', {
                    x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                    stroke: faceColor, 'stroke-width': cosmetic,
                }));
            }
        }

        // Exterior hatch
        if (w.is_exterior) {
            const hatchG = this._make('g', {
                stroke: '#4b5563',
                'stroke-width': `${0.6 / this.zoom}`, fill: 'none',
            });
            const spacing = 3.0;
            for (const [span_s, span_e] of solidSpans) {
                const rectW = span_e - span_s;
                let d = -w.thickness;
                while (d < rectW) {
                    let x1 = span_s + d, y1 = -halfT;
                    let x2 = span_s + d + w.thickness, y2 = halfT;
                    if (x1 < span_s) { y1 += (span_s - x1); x1 = span_s; }
                    if (x2 > span_e) { y2 -= (x2 - span_e); x2 = span_e; }
                    if (x1 < x2 && y1 < y2) {
                        const a = { x: sx + ax * x1 + px * y1, y: sy + ay * x1 + py * y1 };
                        const b = { x: sx + ax * x2 + px * y2, y: sy + ay * x2 + py * y2 };
                        hatchG.appendChild(this._make('line', {
                            x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                        }));
                    }
                    d += spacing;
                }
            }
            g.appendChild(hatchG);
        }

        // Openings (drawn in wall coords, transformed back to scene)
        for (const op of w.openings) {
            const opG = this._paintOpening(w, op, sx, sy, ax, ay, px, py, halfT);
            if (opG) {
                opG.dataset.uid = op.uid;
                opG.dataset.kind = 'opening';
                if (this.document.scene.selection.has(op.uid)) {
                    opG.classList.add('selected');
                }
                g.appendChild(opG);
            }
        }

        // Selection overlay (last so it draws on top of body)
        if (this.document.scene.selection.has(w.uid)) {
            const haloG = this._make('g', { class: 'wall-halo' });
            const halo = this._make('polygon', {
                points: this._wallPolyPoints(sx, sy, L, ax, ay, px, py, halfT, extS, extE),
                fill: 'rgba(46,134,222,0.12)',
                stroke: '#2e86de',
                'stroke-width': `${1.5 / this.zoom}`,
            });
            haloG.appendChild(halo);
            g.appendChild(haloG);
        }

        return g;
    }

    _wallPolyPoints(sx, sy, L, ax, ay, px, py, halfT, extS, extE) {
        const xs = -extS, xe = L + extE;
        const p1 = { x: sx + ax * xs + px * halfT, y: sy + ay * xs + py * halfT };
        const p2 = { x: sx + ax * xe + px * halfT, y: sy + ay * xe + py * halfT };
        const p3 = { x: sx + ax * xe - px * halfT, y: sy + ay * xe - py * halfT };
        const p4 = { x: sx + ax * xs - px * halfT, y: sy + ay * xs - py * halfT };
        return `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`;
    }

    _paintOpening(w, op, sx, sy, ax, ay, px, py, halfT) {
        const g = this._make('g', { class: 'opening' });
        const sLoc = op.offset - op.width / 2;
        const eLoc = op.offset + op.width / 2;
        const cosmetic = `${1 / this.zoom}`;

        // Clear opening (white rectangle)
        const p1 = { x: sx + ax * sLoc + px * halfT, y: sy + ay * sLoc + py * halfT };
        const p2 = { x: sx + ax * eLoc + px * halfT, y: sy + ay * eLoc + py * halfT };
        const p3 = { x: sx + ax * eLoc - px * halfT, y: sy + ay * eLoc - py * halfT };
        const p4 = { x: sx + ax * sLoc - px * halfT, y: sy + ay * sLoc - py * halfT };
        g.appendChild(this._make('polygon', {
            points: `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`,
            fill: '#ffffff', stroke: 'none',
        }));

        // Jambs
        g.appendChild(this._make('line', {
            x1: p1.x, y1: p1.y, x2: p4.x, y2: p4.y,
            stroke: '#1a1a1a', 'stroke-width': cosmetic,
        }));
        g.appendChild(this._make('line', {
            x1: p2.x, y1: p2.y, x2: p3.x, y2: p3.y,
            stroke: '#1a1a1a', 'stroke-width': cosmetic,
        }));

        if (op.openingKind === 'window') {
            for (const yLoc of [-halfT / 2, 0, halfT / 2]) {
                const a = { x: sx + ax * sLoc + px * yLoc, y: sy + ay * sLoc + py * yLoc };
                const b = { x: sx + ax * eLoc + px * yLoc, y: sy + ay * eLoc + py * yLoc };
                g.appendChild(this._make('line', {
                    x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                    stroke: '#3b82f6', 'stroke-width': cosmetic,
                }));
            }
            return g;
        }

        // Door
        const swing = op.swing || 'right_in';
        let hingeLoc, tipLoc, arcExtentDeg;
        if (swing === 'left_in')   { hingeLoc = [sLoc,  halfT]; tipLoc = [sLoc + op.width,  halfT]; arcExtentDeg = -90; }
        else if (swing === 'right_in') { hingeLoc = [eLoc,  halfT]; tipLoc = [eLoc - op.width,  halfT]; arcExtentDeg = 90; }
        else if (swing === 'left_out')  { hingeLoc = [sLoc, -halfT]; tipLoc = [sLoc + op.width, -halfT]; arcExtentDeg = 90; }
        else                            { hingeLoc = [eLoc, -halfT]; tipLoc = [eLoc - op.width, -halfT]; arcExtentDeg = -90; }

        const hinge = { x: sx + ax * hingeLoc[0] + px * hingeLoc[1],
                        y: sy + ay * hingeLoc[0] + py * hingeLoc[1] };
        const tip = { x: sx + ax * tipLoc[0] + px * tipLoc[1],
                      y: sy + ay * tipLoc[0] + py * tipLoc[1] };

        void tip;

        // Swing arc — sample as polyline.
        // Note on rotation direction: scene Y is +DOWN (screen). Qt's drawArc
        // uses "positive = CCW visual" which on a y-down canvas corresponds to
        // a CW rotation in math. Negate arcExtentDeg to match the desktop app:
        // a 'right_in' door should swing INTO the +halfT side of the wall, not
        // across to the opposite side.
        const vx = tipLoc[0] - hingeLoc[0];
        const vy = tipLoc[1] - hingeLoc[1];
        const extentRad = -arcExtentDeg * Math.PI / 180;
        const n = 20;
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const theta = extentRad * i / n;
            const ct = Math.cos(theta), st = Math.sin(theta);
            const rx = vx * ct - vy * st;
            const ry = vx * st + vy * ct;
            pts.push((sx + ax * (hingeLoc[0] + rx) + px * (hingeLoc[1] + ry)) + ',' +
                     (sy + ay * (hingeLoc[0] + rx) + py * (hingeLoc[1] + ry)));
        }
        g.appendChild(this._make('polyline', {
            points: pts.join(' '),
            fill: 'none', stroke: '#7a7a7a',
            'stroke-width': cosmetic,
            'stroke-dasharray': `${3 / this.zoom},${3 / this.zoom}`,
        }));
        // Door leaf, drawn standing open (hinge → end of the swing arc).
        const open = pts[pts.length - 1].split(',').map(Number);
        g.appendChild(this._make('line', {
            x1: hinge.x, y1: hinge.y, x2: open[0], y2: open[1],
            stroke: '#1a1a1a', 'stroke-width': `${1.6 / this.zoom}`,
        }));

        return g;
    }

    _paintDimension(d) {
        const g = this._make('g', { class: 'dimension' });
        const p1 = d.p1, p2 = d.p2;
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const L = Math.hypot(dx, dy);
        if (L < 1e-6) return g;
        const nx = -dy / L, ny = dx / L;
        const dimEnd1 = { x: p1.x + nx * d.offset, y: p1.y + ny * d.offset };
        const dimEnd2 = { x: p2.x + nx * d.offset, y: p2.y + ny * d.offset };

        const col = this.document.scene.selection.has(d.uid) ? '#2e86de' : '#7a4a00';
        const cosmetic = `${1 / this.zoom}`;

        // Extension lines
        const gap = 4;
        const gp = (a, b) => {
            const ddx = b.x - a.x, ddy = b.y - a.y;
            const ll = Math.hypot(ddx, ddy);
            if (ll <= gap) return a;
            return { x: a.x + ddx / ll * gap, y: a.y + ddy / ll * gap };
        };
        const e1 = gp(p1, dimEnd1);
        const e2 = gp(p2, dimEnd2);
        g.appendChild(this._make('line', {
            x1: e1.x, y1: e1.y, x2: dimEnd1.x, y2: dimEnd1.y,
            stroke: col, 'stroke-width': cosmetic,
        }));
        g.appendChild(this._make('line', {
            x1: e2.x, y1: e2.y, x2: dimEnd2.x, y2: dimEnd2.y,
            stroke: col, 'stroke-width': cosmetic,
        }));
        // Dimension line
        g.appendChild(this._make('line', {
            x1: dimEnd1.x, y1: dimEnd1.y, x2: dimEnd2.x, y2: dimEnd2.y,
            stroke: col, 'stroke-width': cosmetic,
        }));

        // Slash ticks
        const ang = Math.atan2(dimEnd2.y - dimEnd1.y, dimEnd2.x - dimEnd1.x);
        const tick = 6;
        const cosT = Math.cos(ang + Math.PI / 4);
        const sinT = Math.sin(ang + Math.PI / 4);
        for (const dEnd of [dimEnd1, dimEnd2]) {
            g.appendChild(this._make('line', {
                x1: dEnd.x - cosT * tick, y1: dEnd.y - sinT * tick,
                x2: dEnd.x + cosT * tick, y2: dEnd.y + sinT * tick,
                stroke: col, 'stroke-width': cosmetic,
            }));
        }

        // Text — use scene-unit font size
        const text = formatLength(L);
        const mid = { x: (dimEnd1.x + dimEnd2.x) / 2, y: (dimEnd1.y + dimEnd2.y) / 2 };
        const textOffset = d.text_height * 0.6;
        const tx = mid.x + nx * textOffset;
        const ty = mid.y + ny * textOffset;
        let deg = ang * 180 / Math.PI;
        // Keep text upright
        if (!(deg > -90 && deg <= 90)) deg += 180;
        const t = this._make('text', {
            x: tx, y: ty,
            'font-size': d.text_height,
            'font-family': 'Helvetica, Arial, sans-serif',
            fill: col,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            transform: `rotate(${deg} ${tx} ${ty})`,
        });
        t.textContent = text;
        g.appendChild(t);

        return g;
    }

    _paintRoom(r) {
        const g = this._make('g', { class: 'room' });
        const nameH = 12, areaH = 8;
        const t1 = this._make('text', {
            x: r.pos.x, y: r.pos.y - 2,
            'font-size': nameH, 'font-family': 'Helvetica, Arial, sans-serif',
            'font-weight': 'bold', fill: '#111827',
            'text-anchor': 'middle',
        });
        t1.textContent = (r.name || '').toUpperCase();
        const t2 = this._make('text', {
            x: r.pos.x, y: r.pos.y + areaH + 2,
            'font-size': areaH, 'font-family': 'Helvetica, Arial, sans-serif',
            fill: '#374151', 'text-anchor': 'middle',
        });
        t2.textContent = formatArea(r.area_sq_in);
        g.appendChild(t1);
        g.appendChild(t2);

        if (this.document.scene.selection.has(r.uid)) {
            g.appendChild(this._make('rect', {
                x: r.pos.x - 72, y: r.pos.y - 28, width: 144, height: 56,
                fill: 'none', stroke: '#2e86de',
                'stroke-width': `${1 / this.zoom}`,
                'stroke-dasharray': `${4 / this.zoom},${3 / this.zoom}`,
            }));
        }
        return g;
    }

    _paintPlot(p) {
        const g = this._make('g', { class: 'plot' });
        if (!p.points.length) return g;
        const cosmetic = `${1.2 / this.zoom}`;
        const col = this.document.scene.selection.has(p.uid) ? '#2e86de' : '#0e6b3b';

        const ptsStr = p.points.map(pt => `${pt.x},${pt.y}`).join(' ');
        if (p.closed) {
            g.appendChild(this._make('polygon', {
                points: ptsStr,
                fill: 'rgba(14,107,59,0.06)',
                stroke: col, 'stroke-width': cosmetic,
                'stroke-dasharray': `${20 / this.zoom},${4 / this.zoom},${2 / this.zoom},${4 / this.zoom}`,
            }));
        } else {
            g.appendChild(this._make('polyline', {
                points: ptsStr,
                fill: 'none',
                stroke: col, 'stroke-width': cosmetic,
                'stroke-dasharray': `${20 / this.zoom},${4 / this.zoom},${2 / this.zoom},${4 / this.zoom}`,
            }));
        }
        // Vertices
        for (const pt of p.points) {
            g.appendChild(this._make('circle', {
                cx: pt.x, cy: pt.y, r: 3,
                fill: '#ffffff', stroke: col, 'stroke-width': cosmetic,
            }));
        }
        // Bearing+distance labels
        const textH = 10;
        const n = p.points.length;
        const segCount = p.closed ? n : n - 1;
        for (let i = 0; i < segCount; i++) {
            const a = p.points[i], b = p.points[(i + 1) % n];
            const segL = dist(a, b);
            if (segL < 1e-3) continue;
            const ang = angleOf(a, b);
            const nx = -(b.y - a.y) / segL;
            const ny = (b.x - a.x) / segL;
            const offset = textH * 1.6;
            const tx = (a.x + b.x) / 2 + nx * offset;
            const ty = (a.y + b.y) / 2 + ny * offset;
            let deg = ang * 180 / Math.PI;
            if (!(deg > -90 && deg <= 90)) deg += 180;
            const t = this._make('text', {
                x: tx, y: ty,
                'font-size': textH,
                'font-family': 'Helvetica, Arial, sans-serif',
                fill: col,
                'text-anchor': 'middle',
                'dominant-baseline': 'middle',
                transform: `rotate(${deg} ${tx} ${ty})`,
            });
            t.textContent = `${formatBearing(ang)}   ${formatLength(segL)}`;
            g.appendChild(t);
        }
        // Centroid label
        if (p.closed && p.points.length >= 3) {
            const c = p.centroid();
            const sqIn = p.area();
            const sqFt = sqIn / 144;
            const acres = sqFt / 43560;
            const labelH = 14;
            const t1 = this._make('text', {
                x: c.x, y: c.y, 'font-size': labelH,
                'font-family': 'Helvetica, Arial, sans-serif',
                'font-weight': 'bold',
                fill: col, 'text-anchor': 'middle',
            });
            t1.textContent = p.label;
            const t2 = this._make('text', {
                x: c.x, y: c.y + 14, 'font-size': 10,
                'font-family': 'Helvetica, Arial, sans-serif',
                fill: col, 'text-anchor': 'middle',
            });
            t2.textContent = `${sqFt.toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft   (${acres.toFixed(3)} ac)`;
            g.appendChild(t1);
            g.appendChild(t2);
        }
        return g;
    }

    _paintAnnotation(a) {
        const g = this._make('g', { class: 'annotation' });
        const t = this._make('text', {
            x: a.pos.x, y: a.pos.y,
            'font-size': a.font_pt,
            'font-family': 'Helvetica, Arial, sans-serif',
            fill: '#111827',
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
        });
        t.textContent = a.text || '';
        g.appendChild(t);
        return g;
    }

    // ---- Cabinets & fixtures ------------------------------------------
    //
    // Cabinets: filled footprint coloured by type, model code inside. Wall
    // cabinets (hung above the counter) are dashed; tall cabinets get an X;
    // fillers are hatched. Floor cabinets with a counter on top show the
    // countertop's 1" front overhang as a thin line.
    // Fixtures: their library symbol, plus a short label.
    paintPlaced(it, opts = {}) {
        const g = this._make('g', { class: it.kind });
        const selected = !opts.ghost && this.document.scene.selection.has(it.uid);
        const z = this.zoom;
        const hair = `${1 / z}`;
        const ghostCol = opts.bad ? '#dc2626' : '#2563eb';
        const toW = (x, y) => it.toWorld(x, y);
        const ptsStr = (arr) => arr.map(p => `${p.x},${p.y}`).join(' ');

        if (it.kind === 'cabinet') {
            const upper = it.elevation >= 40;
            const pal = CABINET_PALETTE[it.category] || CABINET_PALETTE.base;
            const stroke = opts.ghost ? ghostCol : (selected ? '#2563eb' : pal.stroke);
            const fp = it.footprint();
            const poly = this._make('polygon', {
                points: ptsStr(fp),
                fill: opts.ghost ? (opts.bad ? 'rgba(220,38,38,0.15)' : 'rgba(37,99,235,0.14)')
                                 : (upper ? pal.upperFill : pal.fill),
                stroke, 'stroke-width': `${(upper ? 1.1 : 1.4) / z}`,
            });
            if (upper) poly.setAttribute('stroke-dasharray', `${5 / z},${3 / z}`);
            g.appendChild(poly);

            const hw = it.width / 2, hd = it.depth / 2;
            if (it.category === 'tall') {
                const c = it.corners();
                for (const [a, b] of [[0, 2], [1, 3]]) {
                    g.appendChild(this._make('line', {
                        x1: c[a].x, y1: c[a].y, x2: c[b].x, y2: c[b].y,
                        stroke, 'stroke-width': hair, opacity: 0.6,
                    }));
                }
            }
            if (it.filler) {
                for (let x = -hw + 1.5; x < hw; x += 3) {
                    const a = toW(x, -hd), b = toW(Math.min(hw, x + 3), hd);
                    g.appendChild(this._make('line', {
                        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                        stroke, 'stroke-width': hair, opacity: 0.6,
                    }));
                }
            }
            // Front edge (rect shapes): heavier line where the doors are.
            if (it.shape === 'rect' && !it.filler) {
                const a = toW(-hw + 0.75, hd), b = toW(hw - 0.75, hd);
                g.appendChild(this._make('line', {
                    x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                    stroke, 'stroke-width': `${2.2 / z}`,
                }));
            }
            // Countertop overhang on base-height cabinets.
            const top = it.elevation + it.height;
            if (!upper && it.category !== 'tall' && top > 28 && top < 38 && it.shape === 'rect') {
                const a = toW(-hw, hd + 1), b = toW(hw, hd + 1);
                g.appendChild(this._make('line', {
                    x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                    stroke: '#57534e', 'stroke-width': hair,
                }));
            }
            if (it.shape === 'L') {
                // Put the code in the corner square, clear of the open notch.
                // Label the side leg near its front, clear of any wall cabinet in the corner.
                const at = it.flip ? hw - 12 : -hw + 12;
                this._placedLabel(g, it, it.model, hd - 9, opts.ghost ? ghostCol : '#1c1917', at);
            } else {
                this._placedLabel(g, it, it.model, upper ? 0 : (it.depth >= 18 ? hd * 0.35 : 0),
                                  opts.ghost ? ghostCol : '#1c1917');
            }
        } else {
            const spec = getFixture(it.fixture_id);
            const stroke = opts.ghost ? ghostCol : (selected ? '#2563eb' : '#134e4a');
            const fill = opts.ghost ? (opts.bad ? 'rgba(220,38,38,0.12)' : 'rgba(37,99,235,0.10)')
                                    : (it.collide === false ? 'none' : 'rgba(255,255,255,0.85)');
            const paths = spec ? primsToPaths(spec.plan, it.width, it.depth, 'plan', it.flip)
                               : primsToPaths([{ t: 'rect', x: 0, y: 0, w: 1, h: 1 }],
                                              it.width, it.depth, 'plan');
            let first = true;
            for (const path of paths) {
                const pts = path.pts.map(([x, y]) => toW(x, y));
                const el = this._make(path.closed ? 'polygon' : 'polyline', {
                    points: ptsStr(pts),
                    fill: path.closed && first ? fill : 'none',
                    stroke, 'stroke-width': `${1.1 / z}`,
                });
                if (path.dash) el.setAttribute('stroke-dasharray', `${4 / z},${3 / z}`);
                g.appendChild(el);
                first = false;
            }
            if (it.label) this._placedLabel(g, it, it.label, 0, opts.ghost ? ghostCol : '#134e4a');
        }

        if (selected) {
            const halo = this._make('polygon', {
                points: ptsStr(it.corners()), fill: 'none',
                stroke: '#2563eb', 'stroke-width': `${2 / z}`,
                'stroke-dasharray': `${4 / z},${3 / z}`,
            });
            g.appendChild(halo);
        }
        return g;
    }

    _placedLabel(g, it, text, yOffset, color, xOffset = 0) {
        if (!text) return;
        // Keep the label upright: if the object is upside down on screen,
        // turn the text 180°.
        let deg = it.rotation * 180 / Math.PI;
        deg = ((deg % 360) + 360) % 360;
        if (deg > 90 && deg < 270) deg -= 180;
        const at = it.toWorld(xOffset, yOffset);
        const maxW = Math.max((it.shape === 'L' ? 24 : it.width) - 3, 3);
        const fs = Math.max(2.5, Math.min(7, it.depth * 0.32, maxW / Math.max(text.length * 0.6, 1)));
        const t = this._make('text', {
            x: at.x, y: at.y,
            'font-size': fs,
            'font-family': 'Inter, Helvetica, Arial, sans-serif',
            'font-weight': '600',
            fill: color, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
            transform: `rotate(${deg} ${at.x} ${at.y})`,
        });
        t.textContent = text;
        g.appendChild(t);
    }

    // Live dimensions shown while placing/dragging: distance from the
    // object's ends to whatever is next to it on the wall.
    paintGapDims(res, depth) {
        const g = this._make('g', { class: 'gap-dims' });
        if (!res || !res.run || !res.gaps) return g;
        const { origin, u, n, lo, hi, leftLimit, rightLimit } = res.run;
        const z = this.zoom;
        const off = depth + 8;
        const at = (s) => ({ x: origin.x + u.x * s + n.x * off, y: origin.y + u.y * s + n.y * off });
        const seg = (a, b, val) => {
            if (val == null || val < 0.05 || val > 240) return;
            const p1 = at(a), p2 = at(b);
            const col = '#b45309';
            g.appendChild(this._make('line', {
                x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: col,
                'stroke-width': `${1 / z}`,
            }));
            for (const p of [p1, p2]) {
                const t1 = { x: p.x - n.x * 3, y: p.y - n.y * 3 }, t2 = { x: p.x + n.x * 3, y: p.y + n.y * 3 };
                g.appendChild(this._make('line', {
                    x1: t1.x, y1: t1.y, x2: t2.x, y2: t2.y, stroke: col, 'stroke-width': `${1 / z}`,
                }));
            }
            const mid = { x: (p1.x + p2.x) / 2 + n.x * 2, y: (p1.y + p2.y) / 2 + n.y * 2 };
            const fs = 11 / z;
            const t = this._make('text', {
                x: mid.x, y: mid.y, 'font-size': fs, 'font-weight': '700',
                'font-family': 'Inter, Helvetica, Arial, sans-serif',
                fill: col, 'text-anchor': 'middle', 'dominant-baseline': 'hanging',
                'paint-order': 'stroke', stroke: '#fffdf8', 'stroke-width': fs / 3.5,
            });
            t.textContent = formatLength(val);
            g.appendChild(t);
        };
        if (isFinite(leftLimit)) seg(leftLimit, lo, res.gaps.left);
        if (isFinite(rightLimit)) seg(hi, rightLimit, res.gaps.right);
        return g;
    }

    // ---- Overlay (snap, tool ghost) -------------------------------------

    setSnapIndicator(snap) {
        this.snapIndicator = snap;
        this._renderOverlay();
    }
    setToolGhost(node) {
        this.toolGhost = node;
        this._renderOverlay();
    }

    _renderOverlay() {
        while (this.overlayG.firstChild) this.overlayG.firstChild.remove();
        if (this.toolGhost) this.overlayG.appendChild(this.toolGhost);

        if (this.snapIndicator && this.snapIndicator.kind !== 'free') {
            const colorMap = {
                endpoint: '#10b981',
                midpoint: '#f59e0b',
                wall: '#3b82f6',
                face: '#ef4444',
                perpendicular: '#a855f7',
                grid: '#9ca3af',
            };
            const col = colorMap[this.snapIndicator.kind] || '#10b981';
            const r = 6 / this.zoom;
            const sw = 1.2 / this.zoom;
            const p = this.snapIndicator.point;

            let marker;
            if (this.snapIndicator.kind === 'endpoint') {
                marker = this._make('rect', {
                    x: p.x - r, y: p.y - r, width: r * 2, height: r * 2,
                    fill: 'rgba(255,255,255,0.8)', stroke: col, 'stroke-width': sw,
                });
            } else if (this.snapIndicator.kind === 'midpoint') {
                const pts = `${p.x},${p.y - r} ${p.x + r},${p.y + r} ${p.x - r},${p.y + r}`;
                marker = this._make('polygon', {
                    points: pts,
                    fill: 'rgba(255,255,255,0.8)', stroke: col, 'stroke-width': sw,
                });
            } else if (this.snapIndicator.kind === 'face') {
                const rr = r + 1 / this.zoom;
                const pts = `${p.x},${p.y - rr} ${p.x + rr},${p.y} ${p.x},${p.y + rr} ${p.x - rr},${p.y}`;
                marker = this._make('polygon', {
                    points: pts,
                    fill: 'rgba(255,255,255,0.8)', stroke: col, 'stroke-width': sw,
                });
            } else if (this.snapIndicator.kind === 'perpendicular') {
                marker = this._make('g', {});
                const rr = r + 1 / this.zoom;
                marker.appendChild(this._make('rect', {
                    x: p.x - rr, y: p.y - rr, width: rr * 2, height: rr * 2,
                    fill: 'rgba(255,255,255,0.8)', stroke: col, 'stroke-width': sw,
                }));
                marker.appendChild(this._make('line', {
                    x1: p.x - rr, y1: p.y, x2: p.x, y2: p.y,
                    stroke: col, 'stroke-width': sw,
                }));
                marker.appendChild(this._make('line', {
                    x1: p.x, y1: p.y, x2: p.x, y2: p.y + rr,
                    stroke: col, 'stroke-width': sw,
                }));
            } else {
                marker = this._make('circle', {
                    cx: p.x, cy: p.y, r: r,
                    fill: 'rgba(255,255,255,0.8)', stroke: col, 'stroke-width': sw,
                });
            }
            this.overlayG.appendChild(marker);
        }
    }
}
