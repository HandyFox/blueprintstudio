// Tool state machines. Each tool responds to mouse/keyboard events from
// the canvas and may push undo commands to the document.
//
// All tools follow the same shape:
//   activate(view)         — called when tool becomes active
//   deactivate()           — called when switching tools
//   mouseDown(p, e)        — p = scene point, e = original event
//   mouseMove(p, e)
//   mouseUp(p, e)
//   keyDown(e)
//   cancel()               — called on ESC
//   drawOverlay()          — returns SVG node group for renderer.setToolGhost
//
// "p" is a scene-coords point ({x, y}) already translated by the renderer.

import {
    AddItemCommand, AddOpeningCommand, AddWallCommand, Cabinet, CompositeCommand,
    Fixture, LinearDimension, MoveItemsCommand, Opening, PlotPolygon,
    RotateCabinetCommand, RoomLabel, SetAttrCommand, SetPoseCommand,
    SetWallEndCommand, TextAnnotation, Wall, isPlaced, normAngle,
} from './model.js';
import { solvePlacement } from './placement.js';
import { getFixture } from './symbols.js';
import { defaultBottom } from './cabinets.js';
import * as ui from './ui.js';
import {
    clonePt, dist, projectPointOnSegment, snapToAngle,
} from './geometry.js';
import { snapPoint, snapForDimension, snapToWall } from './snap.js';
import { formatLength, parseBearing, parseLength } from './units.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
}

// --- Base ----------------------------------------------------------------

export class Tool {
    constructor(doc, app) {
        this.doc = doc;
        this.app = app;
        this.name = 'Tool';
        this.hint = '';
    }
    activate() {}
    deactivate() {
        this.app.renderer.setToolGhost(null);
        this.app.renderer.setSnapIndicator(null);
    }
    mouseDown(p, e) {}
    mouseMove(p, e) {}
    mouseUp(p, e) {}
    keyDown(e) {}
    cancel() {
        this.app.renderer.setToolGhost(null);
    }
    _snap(p) {
        const snap = snapPoint(this.doc.scene, this.doc.settings, p,
                               this.app.renderer.zoom);
        this.app.renderer.setSnapIndicator(snap);
        return snap;
    }
}

// --- Select tool ---------------------------------------------------------

const HIT_Z = { plot: 5, wall: 10, opening: 11, dimension: 15, room: 20, annotation: 25 };
function hitZ(it) {
    if (isPlaced(it)) return 12 + (it.elevation || 0) / 200;
    return HIT_Z[it.kind] || 0;
}

export function protoOf(it) {
    return {
        width: it.width, depth: it.depth, height: it.height,
        elevation: it.elevation, shape: it.shape,
        snap: it.kind === 'fixture' ? ((getFixture(it.fixture_id) || {}).snap || 'wall') : 'wall',
        collide: it.collide !== false,
    };
}

export class SelectTool extends Tool {
    constructor(doc, app) {
        super(doc, app);
        this.name = 'Select';
        this.hint = 'Click to select • Drag to move (snaps to walls & cabinets; hold Shift for free) • R rotates • Arrows nudge';
        this._down = null;
        this._mode = null;            // 'move' | 'marquee' | 'handle' | 'opening' | 'place'
        this._handle = null;
        this._origPositions = null;
        this._opening = null;
        this._openingStart = null;
        this._placeItem = null;       // single placed item being dragged with snapping
        this._placeStart = null;
    }

    _hitTest(p) {
        const items = this.doc.scene.items.slice();
        items.sort((a, b) => hitZ(b) - hitZ(a));
        const tol = 8 / Math.max(this.app.renderer.zoom, 1e-6);
        for (const it of items) {
            const layer = this.doc.layerByName(it.layer_name);
            if (layer && (!layer.visible || layer.locked)) continue;
            const hit = this._hitItem(it, p, tol);
            if (hit) return hit === true ? it : hit;
        }
        return null;
    }

    _hitItem(it, p, tol) {
        switch (it.kind) {
            case 'wall': return this._hitWall(it, p, tol);
            case 'dimension': return this._hitDim(it, p, tol);
            case 'room': return this._hitRoom(it, p);
            case 'plot': return this._hitPlot(it, p, tol);
            case 'annotation': return this._hitText(it, p);
            case 'cabinet':
            case 'fixture': return it.containsPoint(p);
        }
        return false;
    }

    _hitWall(w, p, tol) {
        const openLayer = this.doc.layerByName('Openings');
        if (!openLayer || (openLayer.visible && !openLayer.locked)) {
            for (const op of w.openings) {
                if (this._hitOpening(w, op, p, tol)) return op;
            }
        }
        const r = projectPointOnSegment(p, w.start, w.end);
        return r.dist <= w.thickness / 2 + tol;
    }

    _hitOpening(w, op, p, tol) {
        const r = projectPointOnSegment(p, w.start, w.end);
        const along = r.t * w.length;
        const [s, e] = op.spanAlongWall();
        if (along < s - tol || along > e + tol) return false;
        return r.dist <= w.thickness / 2 + tol;
    }

    _hitDim(d, p, tol) {
        const dx = d.p2.x - d.p1.x, dy = d.p2.y - d.p1.y;
        const L = Math.hypot(dx, dy);
        if (L < 1e-6) return false;
        const nx = -dy / L, ny = dx / L;
        const e1 = { x: d.p1.x + nx * d.offset, y: d.p1.y + ny * d.offset };
        const e2 = { x: d.p2.x + nx * d.offset, y: d.p2.y + ny * d.offset };
        const r = projectPointOnSegment(p, e1, e2);
        if (r.dist <= tol * 1.5) return true;
        // Also allow grabbing the text.
        const mid = { x: (e1.x + e2.x) / 2, y: (e1.y + e2.y) / 2 };
        return dist(p, mid) <= Math.max(tol * 2, d.text_height);
    }

    _hitRoom(r, p) {
        const w = Math.max(48, (r.name || '').length * 8);
        return Math.abs(p.x - r.pos.x) < w / 2 + 4 && p.y > r.pos.y - 14 && p.y < r.pos.y + 14;
    }

    _hitPlot(pl, p, tol) {
        for (let i = 0; i < pl.points.length; i++) {
            if (!pl.closed && i === pl.points.length - 1) break;
            const a = pl.points[i];
            const b = pl.points[(i + 1) % pl.points.length];
            const r = projectPointOnSegment(p, a, b);
            if (r.dist <= tol * 1.2) return true;
        }
        return false;
    }

    _hitText(t, p) {
        const w = (t.text || '').length * t.font_pt * 0.6 + 8;
        const h = t.font_pt * 1.4;
        return Math.abs(p.x - t.pos.x) < w / 2 && Math.abs(p.y - t.pos.y) < h / 2;
    }

    mouseDown(p, e) {
        if (e.button !== 0) return;
        // Wall endpoint handles take priority on selected walls
        const selected = this.doc.scene.selected();
        const handleR = 10 / this.app.renderer.zoom;
        for (const it of selected) {
            if (it.kind !== 'wall') continue;
            for (const which of ['start', 'end']) {
                const ep = it.sceneEndpoint(which);
                if (dist(ep, p) <= handleR) {
                    this._mode = 'handle';
                    this._handle = {
                        wall: it, which,
                        originalPt: clonePt(ep),
                        originalOpenings: it.openings.map(o => o.offset),
                    };
                    this._down = clonePt(p);
                    return;
                }
            }
        }

        const hit = this._hitTest(p);
        this._down = clonePt(p);

        if (hit) {
            if (hit.kind === 'opening') {
                this._mode = 'opening';
                this._opening = hit;
                this._openingStart = hit.offset;
                if (!e.shiftKey) this.doc.scene.setSelection([hit]);
                else this.doc.scene.addToSelection(hit);
                return;
            }
            if (e.shiftKey) {
                if (this.doc.scene.selection.has(hit.uid)) this.doc.scene.selection.delete(hit.uid);
                else this.doc.scene.selection.add(hit.uid);
                this.doc.scene.notify();
                this._mode = null;
                return;
            }
            if (!this.doc.scene.selection.has(hit.uid)) this.doc.scene.setSelection([hit]);
            const sel = this.doc.scene.selected();
            if (sel.length === 1 && isPlaced(sel[0])) {
                this._mode = 'place';
                this._placeItem = sel[0];
                this._placeStart = { pos: clonePt(sel[0].pos), rotation: sel[0].rotation, flip: sel[0].flip };
                this._grabOffset = { x: sel[0].pos.x - p.x, y: sel[0].pos.y - p.y };
                return;
            }
            this._mode = 'move';
            this._origPositions = this._snapshotMove();
        } else {
            if (!e.shiftKey) this.doc.scene.setSelection([]);
            this._mode = 'marquee';
        }
    }

    _snapshotMove() {
        const snap = [];
        for (const it of this.doc.scene.selected()) {
            if (it.kind === 'wall') snap.push({ it, start: clonePt(it.start), end: clonePt(it.end) });
            else if (it.kind === 'dimension') snap.push({ it, p1: clonePt(it.p1), p2: clonePt(it.p2) });
            else if (it.kind === 'plot') snap.push({ it, points: it.points.map(clonePt) });
            else if (it.pos) snap.push({ it, pos: clonePt(it.pos) });
        }
        return snap;
    }

    _restoreSnapshot(snap) {
        for (const s of snap) {
            const it = s.it;
            if (it.kind === 'wall') { it.start = clonePt(s.start); it.end = clonePt(s.end); }
            else if (it.kind === 'dimension') { it.p1 = clonePt(s.p1); it.p2 = clonePt(s.p2); }
            else if (it.kind === 'plot') { it.points = s.points.map(clonePt); }
            else if (s.pos) { it.pos = clonePt(s.pos); }
        }
    }

    _drag(snap, dx, dy) {
        for (const s of snap) {
            const it = s.it;
            if (it.kind === 'wall') {
                it.start = { x: s.start.x + dx, y: s.start.y + dy };
                it.end = { x: s.end.x + dx, y: s.end.y + dy };
            } else if (it.kind === 'dimension') {
                it.p1 = { x: s.p1.x + dx, y: s.p1.y + dy };
                it.p2 = { x: s.p2.x + dx, y: s.p2.y + dy };
            } else if (it.kind === 'plot') {
                it.points = s.points.map(q => ({ x: q.x + dx, y: q.y + dy }));
            } else if (s.pos) {
                it.pos = { x: s.pos.x + dx, y: s.pos.y + dy };
            }
        }
    }

    mouseMove(p, e) {
        if (this._mode === 'handle' && this._handle) {
            const snap = this._snap(p);
            let target = snap.point;
            const w = this._handle.wall;
            const other = w.sceneEndpoint(this._handle.which === 'start' ? 'end' : 'start');
            if (this.doc.settings.ortho_mode) target = snapToAngle(other, target, 90);
            else if (e.shiftKey) target = snapToAngle(other, target, 15);
            w.setSceneEndpoint(this._handle.which, target);
            this.doc.scene.notify();
            return;
        }
        if (this._mode === 'opening' && this._opening) {
            const w = this._opening.wall;
            if (w) {
                const r = projectPointOnSegment(p, w.start, w.end);
                const halfW = this._opening.width / 2;
                this._opening.offset = Math.max(halfW, Math.min(w.length - halfW, r.t * w.length));
                this.doc.scene.notify();
            }
            return;
        }
        if (this._mode === 'place' && this._placeItem) {
            const it = this._placeItem;
            const target = { x: p.x + this._grabOffset.x, y: p.y + this._grabOffset.y };
            if (dist(p, this._down) < 2 / this.app.renderer.zoom) return;
            const res = solvePlacement(this.doc.scene, protoOf(it), target, {
                exclude: new Set([it]), free: e.shiftKey,
                userRotation: this._placeStart.rotation, zoom: this.app.renderer.zoom,
                flip: it.flip,
            });
            it.pos = res.pos; it.rotation = res.rotation; it.flip = res.flip;
            this._lastPlace = res;
            this.doc.scene.notify();
            const g = svg('g');
            g.appendChild(this.app.renderer.paintGapDims(res, it.depth));
            if (res.collides) g.appendChild(this.app.renderer.paintPlaced(it, { ghost: true, bad: true }));
            this.app.renderer.setToolGhost(g);
            return;
        }
        if (this._mode === 'move' && this._origPositions) {
            let dx = p.x - this._down.x, dy = p.y - this._down.y;
            if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
            this._drag(this._origPositions, dx, dy);
            this.doc.scene.notify();
            return;
        }
        if (this._mode === 'marquee') {
            const x0 = Math.min(this._down.x, p.x), y0 = Math.min(this._down.y, p.y);
            const x1 = Math.max(this._down.x, p.x), y1 = Math.max(this._down.y, p.y);
            const z = this.app.renderer.zoom;
            const ghost = svg('g');
            ghost.appendChild(svg('rect', {
                x: x0, y: y0, width: x1 - x0, height: y1 - y0,
                fill: 'rgba(37,99,235,0.08)', stroke: '#2563eb',
                'stroke-width': `${1 / z}`, 'stroke-dasharray': `${4 / z},${3 / z}`,
            }));
            this.app.renderer.setToolGhost(ghost);
            return;
        }
        this.app.renderer.setSnapIndicator(null);
    }

    mouseUp(p, e) {
        if (this._mode === 'handle' && this._handle) {
            const { wall: w, which, originalPt, originalOpenings } = this._handle;
            const finalPt = clonePt(w.sceneEndpoint(which));
            if (which === 'start') w.start = clonePt(originalPt);
            else w.end = clonePt(originalPt);
            for (let i = 0; i < w.openings.length; i++) w.openings[i].offset = originalOpenings[i];
            if (dist(originalPt, finalPt) > 1e-3) {
                this.doc.push(new SetWallEndCommand(w, which, finalPt, 'Resize Wall'));
            } else {
                this.doc.scene.notify();
            }
            this.app.renderer.setSnapIndicator(null);
            this._reset();
            return;
        }
        if (this._mode === 'opening' && this._opening) {
            const newOffset = this._opening.offset, oldOffset = this._openingStart;
            if (Math.abs(newOffset - oldOffset) > 1e-3) {
                this._opening.offset = oldOffset;
                this.doc.push(new SetAttrCommand(this._opening, 'offset', newOffset, 'Move Opening'));
            }
            this._reset();
            return;
        }
        if (this._mode === 'place' && this._placeItem) {
            const it = this._placeItem, st = this._placeStart;
            const to = { pos: clonePt(it.pos), rotation: it.rotation, flip: it.flip };
            const moved = dist(st.pos, to.pos) > 0.01 || Math.abs(st.rotation - to.rotation) > 1e-6 || st.flip !== to.flip;
            it.pos = clonePt(st.pos); it.rotation = st.rotation; it.flip = st.flip;
            if (moved) this.doc.push(new SetPoseCommand([{ item: it, ...to }], 'Move'));
            else this.doc.scene.notify();
            this.app.renderer.setToolGhost(null);
            this._reset();
            return;
        }
        if (this._mode === 'move' && this._origPositions) {
            const items = this._origPositions.map(s => s.it);
            const first = this._origPositions[0];
            let dx = 0, dy = 0;
            if (first) {
                const cur = first.it.kind === 'wall' ? first.it.start : first.it.kind === 'dimension' ? first.it.p1
                    : first.it.kind === 'plot' ? first.it.points[0] : first.it.pos;
                const orig = first.start || first.p1 || (first.points && first.points[0]) || first.pos;
                dx = cur.x - orig.x; dy = cur.y - orig.y;
            }
            this._restoreSnapshot(this._origPositions);
            if (Math.hypot(dx, dy) > 0.01) this.doc.push(new MoveItemsCommand(items, dx, dy, 'Move'));
            else this.doc.scene.notify();
            this._reset();
            return;
        }
        if (this._mode === 'marquee') {
            const x0 = Math.min(this._down.x, p.x), y0 = Math.min(this._down.y, p.y);
            const x1 = Math.max(this._down.x, p.x), y1 = Math.max(this._down.y, p.y);
            const inRect = q => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
            const hit = [];
            if (x1 - x0 > 0.5 || y1 - y0 > 0.5) {
                for (const it of this.doc.scene.items) {
                    const layer = this.doc.layerByName(it.layer_name);
                    if (layer && (!layer.visible || layer.locked)) continue;
                    let ok = false;
                    if (it.kind === 'wall') ok = inRect(it.start) && inRect(it.end);
                    else if (it.kind === 'dimension') ok = inRect(it.p1) && inRect(it.p2);
                    else if (it.kind === 'plot') ok = it.points.every(inRect);
                    else if (isPlaced(it)) ok = it.corners().every(inRect);
                    else if (it.pos) ok = inRect(it.pos);
                    if (ok) hit.push(it);
                }
            }
            if (e.shiftKey) {
                for (const it of hit) this.doc.scene.selection.add(it.uid);
                this.doc.scene.notify();
            } else {
                this.doc.scene.setSelection(hit);
            }
            this.app.renderer.setToolGhost(null);
            this._reset();
        }
    }

    _reset() {
        this._mode = null;
        this._handle = null;
        this._opening = null;
        this._origPositions = null;
        this._placeItem = null;
        this._placeStart = null;
    }

    cancel() {
        if (this._mode === 'move' && this._origPositions) this._restoreSnapshot(this._origPositions);
        if (this._mode === 'place' && this._placeItem) {
            const it = this._placeItem, st = this._placeStart;
            it.pos = clonePt(st.pos); it.rotation = st.rotation; it.flip = st.flip;
        }
        if (this._mode === 'handle' && this._handle) {
            const { wall: w, which, originalPt } = this._handle;
            w.setSceneEndpoint(which, originalPt);
        }
        if (this._mode === 'opening' && this._opening) this._opening.offset = this._openingStart;
        const hadMode = !!this._mode;
        this._reset();
        super.cancel();
        if (hadMode) this.doc.scene.notify();
        else if (this.doc.scene.selection.size) this.doc.scene.setSelection([]);
    }

    keyDown(e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const sel = this.doc.scene.selected();
        const placed = sel.filter(isPlaced);
        if ((e.key === 'r' || e.key === 'R') && placed.length) {
            const step = e.shiftKey ? -Math.PI / 2 : Math.PI / 2;
            this.doc.push(new CompositeCommand(
                placed.map(it => new RotateCabinetCommand(it, it.rotation + step)), 'Rotate'));
            e.preventDefault();
            return;
        }
        const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (arrows[e.key] && sel.length) {
            const step = e.shiftKey ? 12 : 1;
            const [dx, dy] = arrows[e.key];
            this.doc.push(new MoveItemsCommand(sel, dx * step, dy * step, 'Nudge'));
            e.preventDefault();
        }
    }
}

// --- Wall tool ----------------------------------------------------------

export class WallTool extends Tool {
    constructor(doc, app, exterior = false) {
        super(doc, app);
        this.exterior = exterior;
        this.name = exterior ? 'Exterior Wall' : 'Wall';
        this.hint = 'Click to start • Click each corner • Type a length + Enter • Double-click or right-click to finish';
        this._start = null;
        this._cursor = null;
        this._lengthBuffer = '';
    }

    _computeTarget(p, e) {
        const snap = this._snap(p);
        let target = snap.point;
        if (this._start) {
            if (this.doc.settings.ortho_mode) {
                target = snapToAngle(this._start, target, 90);
            } else if (e && e.shiftKey) {
                target = snapToAngle(this._start, target, 15);
            } else if (snap.kind !== 'endpoint' && snap.kind !== 'midpoint') {
                // Soft ortho: within 5° of square or 45°, lock to it so walls
                // don't come out a hair crooked.
                const ang = Math.atan2(target.y - this._start.y, target.x - this._start.x) * 180 / Math.PI;
                const near = Math.round(ang / 45) * 45;
                if (Math.abs(ang - near) < 5) target = snapToAngle(this._start, target, 45);
            }
        }
        return target;
    }

    _placeWall(target, interiorLength = null) {
        if (!this._start || dist(this._start, target) < 1e-3) return;
        const t = this.exterior
            ? this.doc.settings.default_exterior_thickness
            : this.doc.settings.default_wall_thickness;
        const wall = new Wall(this._start, target, {
            thickness: t,
            height: this.doc.settings.default_wall_height,
            is_exterior: this.exterior,
        });
        if (interiorLength != null && interiorLength > 0) {
            wall.interior_length = interiorLength;
        }
        this.doc.push(new AddWallCommand(this.doc.scene, wall,
            this.exterior ? 'Draw Exterior Wall' : 'Draw Wall'));
        // Chain: continue from the wall's actual end (which may have moved
        // if interior recompute extended the centerline).
        this._start = wall.sceneEndpoint('end');
        this._cursor = clonePt(this._start);
    }

    mouseDown(p, e) {
        if (e.button === 2 || (e.detail >= 2 && this._start)) {
            // Right-click or double-click finishes the chain of walls.
            this._start = null; this._cursor = null; this._lengthBuffer = '';
            this._updateGhost();
            return;
        }
        if (e.button !== 0) return;
        const target = this._computeTarget(p, e);
        if (this._start === null) {
            this._start = target;
            this._cursor = target;
            this._lengthBuffer = '';
        } else {
            this._placeWall(target);
            this._lengthBuffer = '';
        }
        this._updateGhost();
    }

    mouseMove(p, e) {
        const target = this._computeTarget(p, e);
        this._cursor = target;
        this._updateGhost();
    }

    keyDown(e) {
        if (this._start && this._cursor) {
            if (e.key === 'Enter') {
                if (this._lengthBuffer.trim()) {
                    const parsed = parseLength(this._lengthBuffer);
                    if (parsed != null && parsed > 1e-3) {
                        const dx = this._cursor.x - this._start.x;
                        const dy = this._cursor.y - this._start.y;
                        const d = Math.hypot(dx, dy);
                        if (d > 1e-6) {
                            const target = {
                                x: this._start.x + dx / d * parsed,
                                y: this._start.y + dy / d * parsed,
                            };
                            this._placeWall(target, parsed);
                        }
                    }
                    this._lengthBuffer = '';
                } else {
                    this._start = null;
                    this._cursor = null;
                }
                this._updateGhost();
                e.preventDefault();
                return;
            }
            if (e.key === 'Backspace') {
                this._lengthBuffer = this._lengthBuffer.slice(0, -1);
                this._updateGhost();
                e.preventDefault();
                return;
            }
            const allowed = "0123456789.'\"-/ ";
            if (e.key.length === 1 && allowed.includes(e.key)) {
                this._lengthBuffer += e.key;
                this._updateGhost();
                e.preventDefault();
                return;
            }
            // While drawing a wall, swallow any other single-character keys
            // (like tool letters) so they don't hijack the active tool.
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                return;
            }
        }
    }

    cancel() {
        this._start = null;
        this._cursor = null;
        this._lengthBuffer = '';
        super.cancel();
    }

    _updateGhost() {
        if (!this._start || !this._cursor) {
            this.app.renderer.setToolGhost(null);
            return;
        }
        const s = this._start, e = this._cursor;
        const L = dist(s, e);
        if (L < 1e-3) { this.app.renderer.setToolGhost(null); return; }
        const ang = Math.atan2(e.y - s.y, e.x - s.x);
        const t = this.exterior ? this.doc.settings.default_exterior_thickness
                                : this.doc.settings.default_wall_thickness;
        const cosA = Math.cos(ang), sinA = Math.sin(ang);
        const nx = -sinA, ny = cosA;
        const ht = t / 2;
        const p1 = `${s.x + nx * ht},${s.y + ny * ht}`;
        const p2 = `${s.x - nx * ht},${s.y - ny * ht}`;
        const p3 = `${e.x - nx * ht},${e.y - ny * ht}`;
        const p4 = `${e.x + nx * ht},${e.y + ny * ht}`;

        const g = svg('g');
        g.appendChild(svg('polygon', {
            points: `${p1} ${p2} ${p3} ${p4}`,
            fill: 'rgba(46,134,222,0.20)',
            stroke: '#2e86de',
            'stroke-width': `${1 / this.app.renderer.zoom}`,
        }));

        // Label at midpoint
        const mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
        const fontSize = 10 / this.app.renderer.zoom;
        const text = this._lengthBuffer ? this._lengthBuffer + '▏' : formatLength(L);
        const label = svg('text', {
            x: mid.x, y: mid.y - t,
            'font-size': fontSize,
            'font-family': 'Helvetica, Arial, sans-serif',
            'font-weight': 'bold',
            fill: this._lengthBuffer ? '#1f6fbf' : '#1f1f1f',
            'text-anchor': 'middle',
            'paint-order': 'stroke',
            stroke: '#ffffff',
            'stroke-width': fontSize / 4,
        });
        label.textContent = text;
        g.appendChild(label);
        this.app.renderer.setToolGhost(g);
    }
}

// --- Opening tool (door / window) ---------------------------------------

export class OpeningTool extends Tool {
    constructor(doc, app, kind = 'door') {
        super(doc, app);
        this.openingKind = kind;
        this.name = kind === 'door' ? 'Door' : 'Window';
        this.hint = `Hover over a wall and click to place a ${kind}`;
        this._hover = null;  // { wall, point, t }
    }

    mouseMove(p, e) {
        const hit = snapToWall(this.doc.scene, p, this.app.renderer.zoom);
        this._hover = hit;
        if (hit) {
            this.app.renderer.setSnapIndicator({ point: hit.point, kind: 'wall', wall: hit.wall });
        } else {
            this.app.renderer.setSnapIndicator(null);
        }
        this._updateGhost();
    }

    _updateGhost() {
        if (!this._hover) {
            this.app.renderer.setToolGhost(null);
            return;
        }
        const { wall: w, t } = this._hover;
        const settings = this.doc.settings;
        const width = this.openingKind === 'door'
            ? settings.default_door_width
            : settings.default_window_width;
        // Build a ghost rectangle along the wall axis
        const L = w.length;
        const off = Math.max(width / 2, Math.min(L - width / 2, t));
        const sLoc = off - width / 2;
        const eLoc = off + width / 2;
        const ax = (w.end.x - w.start.x) / L;
        const ay = (w.end.y - w.start.y) / L;
        const px = -ay, py = ax;
        const halfT = w.thickness / 2;

        const c1 = { x: w.start.x + ax * sLoc + px * halfT, y: w.start.y + ay * sLoc + py * halfT };
        const c2 = { x: w.start.x + ax * eLoc + px * halfT, y: w.start.y + ay * eLoc + py * halfT };
        const c3 = { x: w.start.x + ax * eLoc - px * halfT, y: w.start.y + ay * eLoc - py * halfT };
        const c4 = { x: w.start.x + ax * sLoc - px * halfT, y: w.start.y + ay * sLoc - py * halfT };

        const bad = this._overlaps(w, off, width);
        const g = svg('g');
        g.appendChild(svg('polygon', {
            points: `${c1.x},${c1.y} ${c2.x},${c2.y} ${c3.x},${c3.y} ${c4.x},${c4.y}`,
            fill: bad ? 'rgba(220,38,38,0.3)' : 'rgba(37,99,235,0.30)',
            stroke: bad ? '#dc2626' : '#2563eb',
            'stroke-width': `${1 / this.app.renderer.zoom}`,
        }));
        this.app.renderer.setToolGhost(g);
    }

    _overlaps(w, off, width) {
        return w.openings.some(o => Math.abs(o.offset - off) < (o.width + width) / 2 - 0.01);
    }

    mouseDown(p, e) {
        if (!this._hover) return;
        if (e.button !== 0) return;
        const { wall: w, t } = this._hover;
        const settings = this.doc.settings;
        const width = this.openingKind === 'door'
            ? settings.default_door_width
            : settings.default_window_width;
        const L = w.length;
        if (L < width) { ui.toast('That wall is shorter than the opening.', 'warn'); return; }
        const off = Math.max(width / 2, Math.min(L - width / 2, t));
        if (this._overlaps(w, off, width)) { ui.toast('Overlaps another door or window.', 'warn'); return; }

        const op = new Opening({
            openingKind: this.openingKind,
            offset: off,
            width,
            height: this.openingKind === 'door'
                ? settings.default_door_height
                : settings.default_window_height,
            sill: this.openingKind === 'window' ? settings.default_window_sill : 0,
            swing: this.openingKind === 'door' ? 'right_in' : 'right_in',
        });
        this.doc.push(new AddOpeningCommand(w, op,
            this.openingKind === 'door' ? 'Add Door' : 'Add Window'));
    }

    cancel() {
        this._hover = null;
        super.cancel();
    }
}

// --- Dimension tool ------------------------------------------------------

export class DimensionTool extends Tool {
    constructor(doc, app) {
        super(doc, app);
        this.name = 'Dimension';
        this.hint = 'Click first point • Click second point • Click to set offset';
        this._p1 = null;
        this._p1Wall = null;
        this._p2 = null;
        this._cursor = null;
    }

    _snapDim(p, opts) {
        const snap = snapForDimension(this.doc.scene, this.doc.settings, p,
                                      this.app.renderer.zoom, opts);
        this.app.renderer.setSnapIndicator(snap);
        return snap;
    }

    mouseDown(p, e) {
        if (e.button !== 0) return;
        if (!this._p1) {
            const snap = this._snapDim(p, {});
            this._p1 = snap.point;
            this._p1Wall = snap.wall || null;
        } else if (!this._p2) {
            const snap = this._snapDim(p, {
                fromAnchor: this._p1, fromWall: this._p1Wall,
            });
            this._p2 = snap.point;
        } else {
            // Third click sets offset
            const offset = this._computeOffset(p);
            const dim = new LinearDimension(this._p1, this._p2, offset, {
                text_height: 8.0,
            });
            this.doc.push(new AddItemCommand(this.doc.scene, dim, 'Add Dimension'));
            this._p1 = null;
            this._p1Wall = null;
            this._p2 = null;
            this._cursor = null;
        }
        this._updateGhost();
    }

    _computeOffset(p) {
        const dx = this._p2.x - this._p1.x, dy = this._p2.y - this._p1.y;
        const L = Math.hypot(dx, dy);
        if (L < 1e-6) return 24;
        const nx = -dy / L, ny = dx / L;
        return (p.x - this._p1.x) * nx + (p.y - this._p1.y) * ny;
    }

    mouseMove(p, e) {
        if (!this._p1) {
            this._snapDim(p, {});
        } else if (!this._p2) {
            this._snapDim(p, {
                fromAnchor: this._p1, fromWall: this._p1Wall,
            });
        }
        this._cursor = clonePt(p);
        this._updateGhost();
    }

    _updateGhost() {
        const g = svg('g');
        const cosmetic = `${1 / this.app.renderer.zoom}`;
        if (this._p1) {
            g.appendChild(svg('circle', {
                cx: this._p1.x, cy: this._p1.y, r: 3 / this.app.renderer.zoom,
                fill: '#7a4a00',
            }));
        }
        if (this._p1 && this._p2) {
            g.appendChild(svg('line', {
                x1: this._p1.x, y1: this._p1.y, x2: this._p2.x, y2: this._p2.y,
                stroke: '#7a4a00', 'stroke-width': cosmetic,
                'stroke-dasharray': `${4 / this.app.renderer.zoom},${3 / this.app.renderer.zoom}`,
            }));
            g.appendChild(svg('circle', {
                cx: this._p2.x, cy: this._p2.y, r: 3 / this.app.renderer.zoom,
                fill: '#7a4a00',
            }));
            // Preview offset using current cursor
            if (this._cursor) {
                const offset = this._computeOffset(this._cursor);
                const dx = this._p2.x - this._p1.x, dy = this._p2.y - this._p1.y;
                const L = Math.hypot(dx, dy);
                if (L > 1e-6) {
                    const nx = -dy / L, ny = dx / L;
                    const e1 = { x: this._p1.x + nx * offset, y: this._p1.y + ny * offset };
                    const e2 = { x: this._p2.x + nx * offset, y: this._p2.y + ny * offset };
                    g.appendChild(svg('line', {
                        x1: this._p1.x, y1: this._p1.y, x2: e1.x, y2: e1.y,
                        stroke: '#7a4a00', 'stroke-width': cosmetic,
                    }));
                    g.appendChild(svg('line', {
                        x1: this._p2.x, y1: this._p2.y, x2: e2.x, y2: e2.y,
                        stroke: '#7a4a00', 'stroke-width': cosmetic,
                    }));
                    g.appendChild(svg('line', {
                        x1: e1.x, y1: e1.y, x2: e2.x, y2: e2.y,
                        stroke: '#7a4a00', 'stroke-width': cosmetic,
                    }));
                }
            }
        }
        // Perpendicular guide while picking p2
        if (this._p1 && !this._p2 && this._p1Wall && this._cursor) {
            const w = this._p1Wall;
            const wdx = w.end.x - w.start.x, wdy = w.end.y - w.start.y;
            const wL = Math.hypot(wdx, wdy);
            if (wL > 1e-6) {
                const px = -wdy / wL, py = wdx / wL;
                // Long perpendicular guide line through the anchor
                const ext = 1000;
                g.appendChild(svg('line', {
                    x1: this._p1.x - px * ext, y1: this._p1.y - py * ext,
                    x2: this._p1.x + px * ext, y2: this._p1.y + py * ext,
                    stroke: '#a855f7', 'stroke-width': cosmetic,
                    'stroke-dasharray': `${2 / this.app.renderer.zoom},${3 / this.app.renderer.zoom}`,
                    opacity: 0.5,
                }));
            }
        }
        this.app.renderer.setToolGhost(g);
    }

    cancel() {
        this._p1 = null;
        this._p1Wall = null;
        this._p2 = null;
        this._cursor = null;
        super.cancel();
    }
}

// --- Plot tool (free polyline / polygon) --------------------------------

export class PlotTool extends Tool {
    constructor(doc, app) {
        super(doc, app);
        this.name = 'Lot line';
        this.hint = 'Click corners • Double-click or Enter to close the lot • Esc cancels';
        this._points = [];
        this._cursor = null;
    }

    mouseDown(p, e) {
        if (e.button !== 0) return;
        const snap = this._snap(p);
        // A double-click arrives as two mousedowns; the second one (detail 2)
        // lands on the corner we just added, so close instead of duplicating.
        if (e.detail >= 2) {
            if (this._points.length >= 3) this._commit(true);
            return;
        }
        const last = this._points[this._points.length - 1];
        if (last && dist(last, snap.point) < 1e-3) return;
        // Clicking the first corner closes the lot.
        if (this._points.length >= 3 && dist(this._points[0], snap.point) < 8 / this.app.renderer.zoom) {
            this._commit(true);
            return;
        }
        this._points.push(snap.point);
        this._updateGhost();
    }

    mouseMove(p, e) {
        const snap = this._snap(p);
        this._cursor = snap.point;
        this._updateGhost();
    }

    keyDown(e) {
        if (e.key === 'Enter' && this._points.length >= 2) {
            this._commit(this._points.length >= 3);
            e.preventDefault();
        } else if (e.key === 'Backspace' && this._points.length) {
            this._points.pop();
            this._updateGhost();
            e.preventDefault();
        }
    }

    _commit(closed) {
        const poly = new PlotPolygon(this._points.slice(), closed, 'Lot');
        this.doc.push(new AddItemCommand(this.doc.scene, poly, 'Add Lot'));
        this._points = [];
        this._cursor = null;
        this.app.renderer.setToolGhost(null);
    }

    _updateGhost() {
        if (!this._points.length) { this.app.renderer.setToolGhost(null); return; }
        const z = this.app.renderer.zoom;
        const g = svg('g');
        const pts = this._points.slice();
        if (this._cursor) pts.push(this._cursor);
        if (pts.length >= 2) {
            g.appendChild(svg('polyline', {
                points: pts.map(q => `${q.x},${q.y}`).join(' '),
                fill: 'none', stroke: '#0e6b3b', 'stroke-width': `${1.2 / z}`,
                'stroke-dasharray': `${20 / z},${4 / z}`,
            }));
        }
        for (const q of this._points) {
            g.appendChild(svg('circle', {
                cx: q.x, cy: q.y, r: 3 / z, fill: '#ffffff', stroke: '#0e6b3b', 'stroke-width': `${1.2 / z}`,
            }));
        }
        this.app.renderer.setToolGhost(g);
    }

    cancel() {
        this._points = [];
        this._cursor = null;
        super.cancel();
    }
}

// --- Plot by bearing (survey calls) -----------------------------------------

export class PlotByBearingTool extends Tool {
    constructor(doc, app) {
        super(doc, app);
        this.name = 'Lot by bearings';
        this.hint = 'Click the point of beginning, then enter each call (bearing + distance)';
        this._points = [];
        this._busy = false;
    }

    async mouseDown(p, e) {
        if (e.button !== 0 || this._busy) return;
        const snap = this._snap(p);
        this._points = [clonePt(snap.point)];
        this._busy = true;
        try {
            while (true) {
                this._updateGhost();
                const r = await ui.form(`Call ${this._points.length}`, [
                    { name: 'bearing', label: 'Bearing', placeholder: 'N 45°30\' E', value: '' },
                    { name: 'distance', label: 'Distance', placeholder: "120.5'", value: '' },
                ], {
                    okLabel: 'Add call', cancelLabel: 'Finish',
                    note: 'Leave both blank and press Finish when you are done.',
                    validate: (v) => {
                        if (!v.bearing.trim() && !v.distance.trim()) return null;
                        if (parseBearing(v.bearing) == null) return 'Could not read that bearing (e.g. N 45°30\' E).';
                        const d = parseLength(v.distance);
                        if (d == null || d <= 0) return 'Could not read that distance (e.g. 120.5\').';
                        return null;
                    },
                });
                if (!r || (!r.bearing.trim() && !r.distance.trim())) break;
                const bearing = parseBearing(r.bearing);
                const d = parseLength(r.distance);
                const last = this._points[this._points.length - 1];
                this._points.push({
                    x: last.x + Math.cos(bearing) * d,
                    y: last.y - Math.sin(bearing) * d,
                });
            }
            if (this._points.length >= 2) {
                let closed = false;
                if (this._points.length >= 3) {
                    closed = await ui.confirm('Close the lot?',
                        'Join the last point back to the point of beginning?',
                        { okLabel: 'Close lot', cancelLabel: 'Leave open' });
                }
                this.doc.push(new AddItemCommand(this.doc.scene,
                    new PlotPolygon(this._points.slice(), closed, 'Lot'), 'Add Lot'));
            }
        } finally {
            this._busy = false;
            this._points = [];
            this.app.renderer.setToolGhost(null);
        }
    }

    _updateGhost() {
        if (!this._points.length) return;
        const z = this.app.renderer.zoom;
        const g = svg('g');
        if (this._points.length >= 2) {
            g.appendChild(svg('polyline', {
                points: this._points.map(q => `${q.x},${q.y}`).join(' '),
                fill: 'none', stroke: '#0e6b3b', 'stroke-width': `${1.2 / z}`,
            }));
        }
        for (const q of this._points) {
            g.appendChild(svg('circle', {
                cx: q.x, cy: q.y, r: 3 / z, fill: '#ffffff', stroke: '#0e6b3b', 'stroke-width': `${1.2 / z}`,
            }));
        }
        this.app.renderer.setToolGhost(g);
    }

    cancel() {
        if (this._busy) return;
        this._points = [];
        super.cancel();
    }
}

// --- Room tool ----------------------------------------------------------

// Find the rectangle bounded by the nearest wall faces left/right/up/down
// of a point. Good for the common rectangular room; the user can edit it.
export function detectRoomArea(scene, p) {
    const hits = { left: Infinity, right: Infinity, up: Infinity, down: Infinity };
    const dirs = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
    for (const w of scene.walls()) {
        const L = w.length;
        if (L < 1e-6) continue;
        const ax = (w.end.x - w.start.x) / L, ay = (w.end.y - w.start.y) / L;
        const px = -ay, py = ax, h = w.thickness / 2;
        for (const side of [1, -1]) {
            const a = { x: w.start.x + px * h * side, y: w.start.y + py * h * side };
            const b = { x: w.end.x + px * h * side, y: w.end.y + py * h * side };
            for (const [k, [dx, dy]] of Object.entries(dirs)) {
                // ray p + t·d against segment a-b
                const ex = b.x - a.x, ey = b.y - a.y;
                const den = dx * ey - dy * ex;
                if (Math.abs(den) < 1e-9) continue;
                const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den;
                const u = ((a.x - p.x) * dy - (a.y - p.y) * dx) / den;
                if (t > 0.01 && u >= -0.01 && u <= 1.01 && t < hits[k]) hits[k] = t;
            }
        }
    }
    if (![hits.left, hits.right, hits.up, hits.down].every(isFinite)) return null;
    const w = hits.left + hits.right, h = hits.up + hits.down;
    if (w > 2400 || h > 2400) return null;
    return { width: w, height: h, area: w * h,
             center: { x: p.x + (hits.right - hits.left) / 2, y: p.y + (hits.down - hits.up) / 2 } };
}

export class RoomTool extends Tool {
    constructor(doc, app) {
        super(doc, app);
        this.name = 'Room label';
        this.hint = 'Click inside a room to label it (area is measured from the walls)';
    }

    async mouseDown(p, e) {
        if (e.button !== 0) return;
        const det = detectRoomArea(this.doc.scene, p);
        const r = await ui.form('Room label', [
            { name: 'name', label: 'Name', value: 'Bedroom' },
            { name: 'area', label: 'Area (sq ft)', type: 'number',
              value: det ? (det.area / 144).toFixed(1) : '',
              hint: det ? `Measured ${formatLength(det.width)} × ${formatLength(det.height)} between wall faces.`
                        : 'No enclosing walls found — enter the area or leave blank.' },
            { name: 'center', label: 'Center the label in the room', type: 'checkbox', value: !!det },
        ], { okLabel: 'Add label' });
        if (!r || !r.name.trim()) return;
        const areaSqIn = isFinite(r.area) && r.area > 0 ? r.area * 144 : 0;
        const at = r.center && det ? det.center : this._snap(p).point;
        this.app.renderer.setSnapIndicator(null);
        this.doc.push(new AddItemCommand(this.doc.scene,
            new RoomLabel(r.name.trim(), at, areaSqIn), 'Add Room'));
    }
}

// --- Text annotation tool -----------------------------------------------

export class TextTool extends Tool {
    constructor(doc, app) {
        super(doc, app);
        this.name = 'Text';
        this.hint = 'Click to place a note';
    }

    async mouseDown(p, e) {
        if (e.button !== 0) return;
        const at = this._snap(p).point;
        const r = await ui.form('Add note', [
            { name: 'text', label: 'Text', value: '' },
            { name: 'size', label: 'Text height (in)', type: 'number', value: 10 },
        ], { okLabel: 'Add' });
        this.app.renderer.setSnapIndicator(null);
        if (!r || !r.text.trim()) return;
        this.doc.push(new AddItemCommand(this.doc.scene,
            new TextAnnotation(r.text.trim(), at, r.size > 0 ? r.size : 10), 'Add Text'));
    }
}

// --- Place tool (cabinets & fixtures) ------------------------------------
//
// Pick something from the library, then click to drop copies of it. Near a
// wall it backs up to the wall; it slides along and snaps flush to whatever
// is beside it. The orange dimensions show the space left on each side;
// a red outline means it would run into something.
//   R          rotate 90° (when not against a wall)
//   F          flip hinge side / corner hand
//   Shift      place freely (no snapping)
//   Esc        stop placing

export class PlaceTool extends Tool {
    constructor(doc, app) {
        super(doc, app);
        this.name = 'Place';
        this.hint = 'Click to place • Snaps to walls & neighbours • R rotate • F flip • Shift = no snap • Esc to stop';
        this.entry = null;          // { kind:'cabinet'|'fixture', spec, finish }
        this.rotation = 0;
        this.flip = false;
        this._last = null;
        this._cursor = null;
    }

    setEntry(entry) {
        this.entry = entry;
        this.rotation = 0;
        this.flip = false;
        this.name = entry ? (entry.kind === 'cabinet' ? `Place ${entry.spec.model}` : `Place ${entry.spec.name}`) : 'Place';
        this._updateGhost();
    }

    activate() { this._updateGhost(); }
    deactivate() { super.deactivate(); }

    _proto() {
        const s = this.entry.spec;
        if (this.entry.kind === 'cabinet') {
            return {
                width: s.width, depth: s.depth, height: s.height,
                elevation: defaultBottom(s), shape: s.shape || 'rect', snap: 'wall', collide: true,
            };
        }
        return {
            width: s.width, depth: s.depth, height: s.height, elevation: s.elevation || 0,
            shape: 'rect', snap: s.snap || 'wall', collide: s.collide !== false,
        };
    }

    _makeItem(res) {
        const s = this.entry.spec;
        if (this.entry.kind === 'cabinet') {
            const finish = this.entry.finish;
            return new Cabinet({
                model: s.model, category: s.category,
                width: s.width, depth: s.depth, height: s.height,
                elevation: defaultBottom(s), shape: s.shape || 'rect',
                pos: res.pos, rotation: res.rotation, flip: res.flip,
                finish, price: (s.prices && s.prices[finish]) || 0,
                description: s.description || '', blind: !!s.blind,
                filler: !!s.filler, stock: s.stock || '', front: s.front || '',
                hinge: this.flip ? 'R' : 'L',
            });
        }
        return new Fixture({
            fixture_id: s.id, name: s.name, label: s.label || '',
            width: s.width, depth: s.depth, height: s.height,
            elevation: s.elevation || 0, collide: s.collide !== false,
            pos: res.pos, rotation: res.rotation, flip: res.flip,
            layer_name: s.layer || 'Fixtures',
        });
    }

    _solve(p, e) {
        return solvePlacement(this.doc.scene, this._proto(), p, {
            free: !!(e && e.shiftKey), userRotation: this.rotation,
            zoom: this.app.renderer.zoom, flip: this.flip,
        });
    }

    mouseMove(p, e) {
        if (!this.entry) return;
        this._cursor = p;
        this._last = this._solve(p, e);
        this._updateGhost();
    }

    mouseDown(p, e) {
        if (!this.entry) return;
        if (e.button === 2) { this._rotate(); return; }
        if (e.button !== 0) return;
        const res = this._solve(p, e);
        const item = this._makeItem(res);
        if (this.entry.kind === 'cabinet' && res.mode === 'wall' && item.shape !== 'rect') item.flip = res.flip;
        this.doc.push(new AddItemCommand(this.doc.scene, item,
            this.entry.kind === 'cabinet' ? `Add ${item.model}` : `Add ${item.name}`));
        if (res.collides) ui.toast('Placed — but it overlaps something. Check the red outline.', 'warn');
        this._last = this._solve(p, e);
        this._updateGhost();
    }

    _rotate() {
        this.rotation = normAngle(this.rotation + Math.PI / 2);
        if (this._cursor) this._last = this._solve(this._cursor, null);
        this._updateGhost();
    }

    keyDown(e) {
        if (!this.entry || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'r' || e.key === 'R') { this._rotate(); e.preventDefault(); return; }
        if (e.key === 'f' || e.key === 'F') {
            this.flip = !this.flip;
            if (this._cursor) this._last = this._solve(this._cursor, null);
            this._updateGhost();
            e.preventDefault();
        }
    }

    cancel() {
        super.cancel();
        this._last = null;
        this.app.renderer.setToolGhost(null);
    }

    _updateGhost() {
        if (!this.entry || !this._last) { this.app.renderer.setToolGhost(null); return; }
        const res = this._last;
        const item = this._makeItem(res);
        const g = svg('g', { opacity: '0.9' });
        g.appendChild(this.app.renderer.paintPlaced(item, { ghost: true, bad: res.collides }));
        g.appendChild(this.app.renderer.paintGapDims(res, item.depth));
        this.app.renderer.setToolGhost(g);
    }
}
