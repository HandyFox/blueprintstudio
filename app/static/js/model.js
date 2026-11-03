// Domain model: data classes for Walls, Openings, Dimensions, Rooms, Plot
// polygons and Annotations, plus the Document (settings, layers, undo stack)
// and Command classes that mirror the desktop app's QUndoCommands.

import {
    angleOf, clonePt, dist, polygonArea, polygonCentroid, pt, reflectPoint
} from './geometry.js';

let _nextUid = 1;
function uid() {
    return `i${_nextUid++}_${Date.now().toString(36)}` +
        Math.floor(Math.random() * 46656).toString(36);
}

// --- Constants ------------------------------------------------------------

export const WALL_LAYER = 'Walls';
export const OPENING_LAYER = 'Openings';
export const DIMENSION_LAYER = 'Dimensions';
export const ROOM_LAYER = 'Rooms';
export const PLOT_LAYER = 'Plot';
export const ANNOTATION_LAYER = 'Annotations';
export const FURNITURE_LAYER = 'Furniture';
export const CABINET_LAYER = 'Cabinets';
export const FIXTURE_LAYER = 'Fixtures';

export const STANDARD_LAYERS = [
    { name: 'Walls',       color: '#1f1f1f', visible: true, locked: false },
    { name: 'Openings',    color: '#0f3d6e', visible: true, locked: false },
    { name: 'Dimensions',  color: '#7a4a00', visible: true, locked: false },
    { name: 'Rooms',       color: '#374151', visible: true, locked: false },
    { name: 'Annotations', color: '#1f1f1f', visible: true, locked: false },
    { name: 'Plot',        color: '#0e6b3b', visible: true, locked: false },
    { name: 'Furniture',   color: '#4b5563', visible: true, locked: false },
    { name: 'Cabinets',    color: '#1e3a8a', visible: true, locked: false },
    { name: 'Fixtures',    color: '#0f766e', visible: true, locked: false },
];

export const PRINT_SCALES = [
    ['1" = 1\'-0"',     1.0 / 12.0],
    ['3/4" = 1\'-0"',   0.75 / 12.0],
    ['1/2" = 1\'-0"',   0.5 / 12.0],
    ['3/8" = 1\'-0"',   0.375 / 12.0],
    ['1/4" = 1\'-0"',   0.25 / 12.0],
    ['3/16" = 1\'-0"',  0.1875 / 12.0],
    ['1/8" = 1\'-0"',   0.125 / 12.0],
    ['1/16" = 1\'-0"',  0.0625 / 12.0],
    ['1" = 10\'',       1.0 / 120.0],
    ['1" = 20\'',       1.0 / 240.0],
    ['1" = 30\'',       1.0 / 360.0],
    ['1" = 40\'',       1.0 / 480.0],
    ['1" = 50\'',       1.0 / 600.0],
    ['1" = 100\'',      1.0 / 1200.0],
];
export function scaleForLabel(label) {
    const s = PRINT_SCALES.find(([l]) => l === label);
    return s ? s[1] : 1.0 / 48.0;
}

// --- Default settings -----------------------------------------------------

export function defaultSettings() {
    return {
        grid_spacing: 12.0,
        grid_subdivisions: 12,
        grid_visible: true,
        snap_to_grid: true,
        snap_to_endpoints: true,
        snap_to_midpoints: true,
        snap_to_perpendicular: true,
        ortho_mode: false,

        default_wall_thickness: 4.5,
        default_wall_height: 96.0,
        default_exterior_thickness: 6.5,

        default_door_width: 32.0,
        default_door_height: 80.0,
        default_window_width: 36.0,
        default_window_height: 48.0,
        default_window_sill: 36.0,

        print_scale_label: '1/4" = 1\'-0"',
        print_scale: 1.0 / 48.0,

        project_name: 'Untitled Project',
        project_address: '',
        drawing_title: 'Floor Plan',
        drawing_number: 'A-101',
        designer_name: '',
        revision: '—',
    };
}

// --- Wall -----------------------------------------------------------------

export class Wall {
    constructor(start, end, opts = {}) {
        this.uid = opts.uid || uid();
        this.kind = 'wall';
        this.start = clonePt(start);
        this.end = clonePt(end);
        this.thickness = opts.thickness ?? 4.5;
        this.height = opts.height ?? 96.0;
        this.is_exterior = !!opts.is_exterior;
        this.openings = [];
        this.layer_name = WALL_LAYER;
        this.interior_length = opts.interior_length ?? null;
    }
    get length() { return dist(this.start, this.end); }
    get midpoint() {
        return { x: (this.start.x + this.end.x) / 2,
                 y: (this.start.y + this.end.y) / 2 };
    }
    get angleRad() { return angleOf(this.start, this.end); }

    sceneEndpoint(which) {
        return clonePt(which === 'start' ? this.start : this.end);
    }
    setSceneEndpoint(which, p) {
        if (which === 'start') this.start = clonePt(p);
        else this.end = clonePt(p);
    }

    connectedWallsAt(scenePt, scene, tol = 0.5) {
        const out = [];
        for (const it of scene.items) {
            if (it === this || it.kind !== 'wall') continue;
            for (const eName of ['start', 'end']) {
                const e = it.sceneEndpoint(eName);
                if (Math.abs(e.x - scenePt.x) < tol && Math.abs(e.y - scenePt.y) < tol) {
                    out.push(it);
                    break;
                }
            }
        }
        return out;
    }

    axialExtensionAt(which, scene) {
        const p = this.sceneEndpoint(which);
        const others = this.connectedWallsAt(p, scene);
        if (!others.length) return 0;
        return Math.max(...others.map(w => w.thickness)) / 2;
    }

    applyInteriorRecompute(keep, scene) {
        if (this.interior_length == null || this.interior_length <= 0) return false;
        const startExt = this.axialExtensionAt('start', scene);
        const endExt = this.axialExtensionAt('end', scene);
        const target = this.interior_length + startExt + endExt;
        const cur = this.length;
        if (cur < 1e-6) return false;
        if (Math.abs(target - cur) < 0.005) return false;
        const factor = target / cur;
        if (keep === 'start') {
            this.end = {
                x: this.start.x + (this.end.x - this.start.x) * factor,
                y: this.start.y + (this.end.y - this.start.y) * factor,
            };
        } else {
            const oldStart = clonePt(this.start);
            this.start = {
                x: this.end.x + (this.start.x - this.end.x) * factor,
                y: this.end.y + (this.start.y - this.end.y) * factor,
            };
            // Adjust opening offsets so they stay put in scene coords
            const newL = this.length;
            if (newL > 1e-6) {
                const ax = (this.end.x - this.start.x) / newL;
                const ay = (this.end.y - this.start.y) / newL;
                const dAlong = (this.start.x - oldStart.x) * ax +
                               (this.start.y - oldStart.y) * ay;
                for (const op of this.openings) op.offset -= dAlong;
            }
        }
        return true;
    }

    addOpening(op) {
        op.wall = this;
        if (!this.openings.includes(op)) this.openings.push(op);
    }
    removeOpening(op) {
        const i = this.openings.indexOf(op);
        if (i >= 0) this.openings.splice(i, 1);
    }

    mirror(axisP1, axisP2) {
        this.start = reflectPoint(this.start, axisP1, axisP2);
        this.end = reflectPoint(this.end, axisP1, axisP2);
        for (const op of this.openings) {
            const flip = {
                'left_in': 'right_in', 'right_in': 'left_in',
                'left_out': 'right_out', 'right_out': 'left_out',
            };
            op.swing = flip[op.swing] || op.swing;
        }
    }

    toDict() {
        return {
            type: 'wall', uid: this.uid,
            start: [this.start.x, this.start.y],
            end: [this.end.x, this.end.y],
            thickness: this.thickness, height: this.height,
            is_exterior: this.is_exterior,
            interior_length: this.interior_length,
            openings: this.openings.map(o => o.toDict()),
        };
    }
    static fromDict(d) {
        const w = new Wall(
            { x: d.start[0], y: d.start[1] },
            { x: d.end[0],   y: d.end[1] },
            { thickness: d.thickness, height: d.height,
              is_exterior: d.is_exterior,
              interior_length: d.interior_length, uid: d.uid }
        );
        for (const od of (d.openings || [])) {
            const op = Opening.fromDict(od);
            w.addOpening(op);
        }
        return w;
    }
}

// --- Opening (door/window) ------------------------------------------------

export class Opening {
    constructor(opts = {}) {
        this.uid = opts.uid || uid();
        this.kind = 'opening';
        this.openingKind = opts.openingKind || 'door';   // 'door' | 'window'
        this.offset = opts.offset ?? 0;
        this.width = opts.width ?? 32;
        this.height = opts.height ?? 80;
        this.sill = opts.sill ?? 0;
        this.swing = opts.swing || 'right_in';
        this.wall = opts.wall || null;
        this.layer_name = OPENING_LAYER;
    }
    spanAlongWall() { return [this.offset - this.width / 2, this.offset + this.width / 2]; }
    toDict() {
        return {
            type: 'opening', uid: this.uid,
            kind: this.openingKind,
            offset: this.offset, width: this.width,
            height: this.height, sill: this.sill, swing: this.swing,
        };
    }
    static fromDict(d) {
        return new Opening({
            uid: d.uid, openingKind: d.kind, offset: d.offset,
            width: d.width, height: d.height, sill: d.sill,
            swing: d.swing,
        });
    }
}

// --- Linear dimension -----------------------------------------------------

export class LinearDimension {
    constructor(p1, p2, offset = 24, opts = {}) {
        this.uid = opts.uid || uid();
        this.kind = 'dimension';
        this.p1 = clonePt(p1);
        this.p2 = clonePt(p2);
        this.offset = offset;
        this.text_height = opts.text_height ?? 8.0;
        this.layer_name = DIMENSION_LAYER;
    }
    lengthInches() { return dist(this.p1, this.p2); }

    mirror(axisP1, axisP2) {
        this.p1 = reflectPoint(this.p1, axisP1, axisP2);
        this.p2 = reflectPoint(this.p2, axisP1, axisP2);
        this.offset = -this.offset;
    }

    toDict() {
        return {
            type: 'dimension', uid: this.uid,
            p1: [this.p1.x, this.p1.y],
            p2: [this.p2.x, this.p2.y],
            offset: this.offset,
            text_height: this.text_height,
        };
    }
    static fromDict(d) {
        return new LinearDimension(
            { x: d.p1[0], y: d.p1[1] },
            { x: d.p2[0], y: d.p2[1] },
            d.offset ?? 24,
            { uid: d.uid, text_height: d.text_height ?? 8 }
        );
    }
}

// --- Room label -----------------------------------------------------------

export class RoomLabel {
    constructor(name, position, areaSqIn = 0, opts = {}) {
        this.uid = opts.uid || uid();
        this.kind = 'room';
        this.name = name;
        this.pos = clonePt(position);
        this.area_sq_in = areaSqIn;
        this.layer_name = ROOM_LAYER;
    }
    mirror(a, b) { this.pos = reflectPoint(this.pos, a, b); }
    toDict() {
        return { type: 'room', uid: this.uid, name: this.name,
                 area: this.area_sq_in, pos: [this.pos.x, this.pos.y] };
    }
    static fromDict(d) {
        return new RoomLabel(d.name, { x: d.pos[0], y: d.pos[1] },
                             d.area || 0, { uid: d.uid });
    }
}

// --- Plot polygon ---------------------------------------------------------

export class PlotPolygon {
    constructor(points, closed = true, label = 'Lot', opts = {}) {
        this.uid = opts.uid || uid();
        this.kind = 'plot';
        this.points = points.map(clonePt);
        this.closed = closed;
        this.label = label;
        this.layer_name = PLOT_LAYER;
    }
    area() { return Math.abs(polygonArea(this.points)); }
    centroid() { return polygonCentroid(this.points); }
    mirror(a, b) {
        this.points = this.points.map(p => reflectPoint(p, a, b));
        this.points.reverse();
    }
    toDict() {
        return { type: 'plot', uid: this.uid,
                 points: this.points.map(p => [p.x, p.y]),
                 closed: this.closed, label: this.label };
    }
    static fromDict(d) {
        return new PlotPolygon(
            (d.points || []).map(([x, y]) => ({ x, y })),
            d.closed ?? true, d.label || 'Lot',
            { uid: d.uid }
        );
    }
}

// --- Text annotation ------------------------------------------------------

export class TextAnnotation {
    constructor(text, pos, fontPt = 10, opts = {}) {
        this.uid = opts.uid || uid();
        this.kind = 'annotation';
        this.text = text;
        this.pos = clonePt(pos);
        this.font_pt = fontPt;
        this.layer_name = ANNOTATION_LAYER;
    }
    mirror(a, b) { this.pos = reflectPoint(this.pos, a, b); }
    toDict() {
        return { type: 'annotation', uid: this.uid, text: this.text,
                 font_pt: this.font_pt, pos: [this.pos.x, this.pos.y] };
    }
    static fromDict(d) {
        return new TextAnnotation(d.text || '', { x: d.pos[0], y: d.pos[1] },
                                  d.font_pt || 10, { uid: d.uid });
    }
}

// --- Placed objects (cabinets & fixtures) ----------------------------------
//
// Cabinets and fixtures are rectangles (or L / diagonal-corner shapes) placed
// on the plan. `pos` is the centre of the bounding box, `rotation` is in
// radians. In the object's LOCAL frame, +x runs along its width (left → right
// as you stand in front of it) and +y points out of its FRONT, so the back
// (the side that goes against a wall) is the -y edge.
//
// `elevation` is the height of the object's bottom above the floor and
// `height` its overall height, so two objects only collide when their plan
// footprints overlap AND their vertical ranges overlap — a wall cabinet at
// 54" never collides with a base cabinet that tops out at 34½".

function localShape(o) {
    const hw = o.width / 2, hd = o.depth / 2;
    let pts;
    if (o.shape === 'L') {
        // 36" lazy susan: two 24"-deep legs along the back and left walls.
        const leg = Math.min(24, o.depth, o.width);
        pts = [[-hw, -hd], [hw, -hd], [hw, -hd + leg], [-hw + leg, -hd + leg],
               [-hw + leg, hd], [-hw, hd]];
    } else if (o.shape === 'angle') {
        // Diagonal corner wall cabinet: 12"-deep legs, angled front.
        const leg = Math.min(12, o.width / 2);
        pts = [[-hw, -hd], [hw, -hd], [hw, -hd + leg], [-hw + leg, hd], [-hw, hd]];
    } else {
        pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    }
    if (o.flip) pts = pts.map(([x, y]) => [-x, y]).reverse();
    return pts;
}

class PlacedObject {
    _initPlaced(opts, defaults) {
        this.uid = opts.uid || uid();
        this.width = opts.width ?? defaults.width;
        this.depth = opts.depth ?? defaults.depth;
        this.height = opts.height ?? defaults.height;
        this.elevation = opts.elevation ?? defaults.elevation ?? 0;
        this.pos = clonePt(opts.pos || { x: 0, y: 0 });
        this.rotation = opts.rotation || 0;
        this.flip = !!opts.flip;
        this.shape = opts.shape || 'rect';
    }
    get top() { return this.elevation + this.height; }

    toWorld(lx, ly) {
        const c = Math.cos(this.rotation), s = Math.sin(this.rotation);
        return { x: this.pos.x + lx * c - ly * s, y: this.pos.y + lx * s + ly * c };
    }
    toLocal(p) {
        const c = Math.cos(this.rotation), s = Math.sin(this.rotation);
        const dx = p.x - this.pos.x, dy = p.y - this.pos.y;
        return { x: dx * c + dy * s, y: -dx * s + dy * c };
    }
    // Footprint polygon in world coordinates.
    footprint() { return localShape(this).map(([x, y]) => this.toWorld(x, y)); }
    // Bounding-box corners: back-left, back-right, front-right, front-left.
    corners() {
        const hw = this.width / 2, hd = this.depth / 2;
        return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
            .map(([x, y]) => this.toWorld(x, y));
    }
    containsPoint(p) {
        const l = this.toLocal(p);
        if (Math.abs(l.x) > this.width / 2 || Math.abs(l.y) > this.depth / 2) return false;
        if (this.shape === 'rect') return true;
        return pointInPolygon([l.x, l.y], localShape(this));
    }
    mirror(a, b) {
        this.pos = reflectPoint(this.pos, a, b);
        // A reflection reverses handedness. Reflecting the front direction
        // (rotation + 90°) about the axis gives the new front direction, so
        // new rotation = 2·axis − rotation − 180°. Asymmetric shapes flip.
        const axisAng = Math.atan2(b.y - a.y, b.x - a.x);
        this.rotation = normAngle(2 * axisAng - this.rotation - Math.PI);
        if (this.shape !== 'rect') this.flip = !this.flip;
        if (this.hinge) this.hinge = this.hinge === 'L' ? 'R' : 'L';
    }
    _placedDict() {
        return {
            uid: this.uid, width: this.width, depth: this.depth,
            height: this.height, elevation: this.elevation,
            pos: [this.pos.x, this.pos.y], rotation: this.rotation,
            flip: this.flip, shape: this.shape,
        };
    }
}

function pointInPolygon([x, y], pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if (((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

export function normAngle(a) {
    const t = 2 * Math.PI;
    a = ((a % t) + t) % t;
    if (Math.abs(a - t) < 1e-9) a = 0;
    return a;
}

// Cabinet data references the Kitchen Kompact catalog in cabinets.js, but
// stores its own dimensions and price so a saved file doesn't depend on the
// catalog staying the same.
export class Cabinet extends PlacedObject {
    constructor(opts = {}) {
        super();
        this._initPlaced(opts, { width: 24, depth: 24, height: 34.5, elevation: 0 });
        this.kind = 'cabinet';
        this.model = opts.model || '';
        this.category = opts.category || 'base';
        this.finish = opts.finish || 'Glenwood';
        this.price = opts.price || 0;
        this.description = opts.description || '';
        this.hinge = opts.hinge || 'L';           // single-door hinge side
        this.blind = !!opts.blind;
        this.filler = !!opts.filler || this.category === 'filler';
        this.stock = opts.stock || '';
        this.front = opts.front || '';
        // Older files used is_corner / is_angle flags.
        if (opts.is_angle && this.shape === 'rect') this.shape = 'angle';
        this.layer_name = CABINET_LAYER;
    }
    get isUpper() { return this.elevation >= 40; }
    toDict() {
        return {
            type: 'cabinet', ...this._placedDict(),
            model: this.model, category: this.category,
            finish: this.finish, price: this.price,
            description: this.description, hinge: this.hinge,
            blind: this.blind, filler: this.filler, stock: this.stock,
            front: this.front,
        };
    }
    static fromDict(d) {
        const category = d.category || 'base';
        let elevation = d.elevation;
        if (elevation == null) {
            // Files saved before cabinets had a mounting height.
            const h = d.height || 30;
            elevation = category === 'wall' ? (h >= 30 ? 54 : 84 - h) : 0;
        }
        return new Cabinet({
            ...d, category, elevation,
            pos: { x: d.pos[0], y: d.pos[1] },
            width: d.width || 24, depth: d.depth || 24, height: d.height || 34.5,
        });
    }
}

// A fixture is anything from the fixture library (fixtures.json):
// appliances, plumbing fixtures, mechanical equipment, furniture. Its plan
// symbol comes from the library by `fixture_id`; the item stores its own
// size so a saved drawing still renders if the library changes.
export class Fixture extends PlacedObject {
    constructor(opts = {}) {
        super();
        this._initPlaced(opts, { width: 30, depth: 30, height: 36, elevation: 0 });
        this.kind = 'fixture';
        this.fixture_id = opts.fixture_id || '';
        this.name = opts.name || '';
        this.label = opts.label ?? '';
        this.collide = opts.collide ?? true;
        this.layer_name = opts.layer_name || FIXTURE_LAYER;
    }
    toDict() {
        return {
            type: 'fixture', ...this._placedDict(),
            fixture_id: this.fixture_id, name: this.name, label: this.label,
            collide: this.collide, layer: this.layer_name,
        };
    }
    static fromDict(d) {
        return new Fixture({
            ...d, pos: { x: d.pos[0], y: d.pos[1] },
            layer_name: d.layer || FIXTURE_LAYER,
        });
    }
}

export function isPlaced(it) { return it && (it.kind === 'cabinet' || it.kind === 'fixture'); }

// --- Scene -----------------------------------------------------------------

export class Scene {
    constructor() {
        this.items = [];
        this.selection = new Set();   // set of uids
        this.listeners = [];          // (() => void)[]
    }
    onChange(fn) { this.listeners.push(fn); }
    notify() { for (const f of this.listeners) f(); }

    add(item) {
        this.items.push(item);
        this.notify();
    }
    remove(item) {
        const i = this.items.indexOf(item);
        if (i >= 0) this.items.splice(i, 1);
        this.selection.delete(item.uid);
        this.notify();
    }
    findByUid(u) { return this.items.find(i => i.uid === u); }
    selected() { return this.items.filter(i => this.selection.has(i.uid)); }
    setSelection(items) {
        this.selection = new Set(items.map(i => i.uid));
        this.notify();
    }
    addToSelection(item) { this.selection.add(item.uid); this.notify(); }

    clear() { this.items = []; this.selection.clear(); this.notify(); }

    walls() { return this.items.filter(i => i.kind === 'wall'); }
    placed() { return this.items.filter(isPlaced); }
}

export class Document {
    constructor() {
        this.settings = defaultSettings();
        this.layers = STANDARD_LAYERS.map(l => ({ ...l }));
        this.scene = new Scene();
        this.undoStack = new UndoStack();
        this.filePath = null;
        this.modified = false;
        this.listeners = [];
    }
    onChange(fn) { this.listeners.push(fn); }
    notify() { for (const f of this.listeners) f(); }
    layerByName(name) { return this.layers.find(l => l.name === name); }

    layerVisible(name) {
        const l = this.layerByName(name);
        return l ? l.visible : true;
    }
    setLayerVisible(name, vis) {
        const l = this.layerByName(name);
        if (l) { l.visible = vis; this.notify(); this.scene.notify(); }
    }
    setLayerLocked(name, lk) {
        const l = this.layerByName(name);
        if (l) { l.locked = lk; this.notify(); }
    }

    push(cmd) {
        this.undoStack.push(cmd);
        this.modified = true;
        this.notify();
        // Always trigger a scene re-render. Some commands mutate items in-place
        // (e.g. AddOpeningCommand modifies a wall's openings list) and have no
        // way to notify the scene themselves. This makes the contract uniform:
        // every pushed command results in exactly one re-render.
        this.scene.notify();
    }
    undo() {
        if (this.undoStack.canUndo()) {
            this.undoStack.undo();
            this.modified = true;
            this.notify();
            this.scene.notify();
        }
    }
    redo() {
        if (this.undoStack.canRedo()) {
            this.undoStack.redo();
            this.modified = true;
            this.notify();
            this.scene.notify();
        }
    }

    toDict() {
        return {
            version: 1,
            settings: { ...this.settings },
            layers: this.layers.map(l => ({ ...l })),
            items: this.scene.items.map(i => i.toDict()),
        };
    }
    loadDict(d) {
        const settings = { ...defaultSettings(), ...(d.settings || {}) };
        this.settings = settings;
        if (Array.isArray(d.layers) && d.layers.length) {
            this.layers = d.layers.map(l => ({ ...l }));
            // Add any standard layer that's missing from older files (e.g.
            // pre-cabinet projects won't have the Cabinets layer).
            const have = new Set(this.layers.map(l => l.name));
            for (const std of STANDARD_LAYERS) {
                if (!have.has(std.name)) this.layers.push({ ...std });
            }
        } else {
            this.layers = STANDARD_LAYERS.map(l => ({ ...l }));
        }
        this.scene.clear();
        for (const it of (d.items || [])) {
            const item = itemFromDict(it);
            if (item) this.scene.items.push(item);
        }
        this.undoStack = new UndoStack();
        this.modified = false;
        this.notify();
        this.scene.notify();
    }
}

export function itemFromDict(d) {
    switch (d.type) {
        case 'wall': return Wall.fromDict(d);
        case 'dimension': return LinearDimension.fromDict(d);
        case 'room': return RoomLabel.fromDict(d);
        case 'plot': return PlotPolygon.fromDict(d);
        case 'annotation': return TextAnnotation.fromDict(d);
        case 'cabinet': return Cabinet.fromDict(d);
        case 'fixture': return Fixture.fromDict(d);
    }
    return null;
}

// --- Undo Stack -----------------------------------------------------------

export class UndoStack {
    constructor() { this.commands = []; this.cursor = 0; }
    canUndo() { return this.cursor > 0; }
    canRedo() { return this.cursor < this.commands.length; }
    push(cmd) {
        // Drop any redoable commands when a new one is pushed
        this.commands.length = this.cursor;
        cmd.redo();
        this.commands.push(cmd);
        this.cursor = this.commands.length;
    }
    undo() {
        if (!this.canUndo()) return;
        this.cursor--;
        this.commands[this.cursor].undo();
    }
    redo() {
        if (!this.canRedo()) return;
        this.commands[this.cursor].redo();
        this.cursor++;
    }
    clear() { this.commands = []; this.cursor = 0; }
    topText() {
        return this.cursor > 0 ? this.commands[this.cursor - 1].text : '';
    }
    nextRedoText() {
        return this.cursor < this.commands.length
            ? this.commands[this.cursor].text : '';
    }
}

// --- Commands -------------------------------------------------------------

export class Command {
    constructor(text = 'Edit') { this.text = text; }
    redo() { /* abstract */ }
    undo() { /* abstract */ }
}

export class SetAttrCommand extends Command {
    constructor(target, attr, newValue, text = 'Set') {
        super(text);
        this.target = target;
        this.attr = attr;
        this.newValue = newValue;
        this.oldValue = target[attr];
    }
    redo() { this.target[this.attr] = this.newValue; }
    undo() { this.target[this.attr] = this.oldValue; }
}

export class AddItemCommand extends Command {
    constructor(scene, item, text = 'Add Item') {
        super(text);
        this.scene = scene;
        this.item = item;
    }
    redo() { if (!this.scene.items.includes(this.item)) this.scene.items.push(this.item); this.scene.notify(); }
    undo() {
        const i = this.scene.items.indexOf(this.item);
        if (i >= 0) this.scene.items.splice(i, 1);
        this.scene.selection.delete(this.item.uid);
        this.scene.notify();
    }
}

export class RemoveItemsCommand extends Command {
    constructor(scene, items, text = 'Delete') {
        super(text);
        this.scene = scene;
        this.items = items.slice();
        this.indexes = [];
    }
    redo() {
        this.indexes = [];
        // Remove preserving original indexes for undo
        for (const it of this.items) {
            const idx = this.scene.items.indexOf(it);
            if (idx >= 0) {
                this.indexes.push(idx);
                this.scene.items.splice(idx, 1);
            }
        }
        this.scene.notify();
    }
    undo() {
        // Restore in reverse so indexes stay valid
        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];
            const idx = this.indexes[i];
            if (idx != null) this.scene.items.splice(idx, 0, item);
            else this.scene.items.push(item);
        }
        this.scene.notify();
    }
}

// Snapshot all wall/opening geometry that can change as part of a complex op.
function snapshotWalls(walls) {
    const snaps = [];
    for (const w of walls) {
        snaps.push({
            wall: w,
            start: clonePt(w.start),
            end: clonePt(w.end),
            interior_length: w.interior_length,
            openings: w.openings.map(op => ({ op, offset: op.offset })),
        });
    }
    return snaps;
}
function restoreWalls(snaps) {
    for (const s of snaps) {
        s.wall.start = clonePt(s.start);
        s.wall.end = clonePt(s.end);
        s.wall.interior_length = s.interior_length;
        for (const o of s.openings) o.op.offset = o.offset;
    }
}

export class AddWallCommand extends Command {
    constructor(scene, wall, text = 'Draw Wall') {
        super(text);
        this.scene = scene;
        this.wall = wall;
        this._initStart = clonePt(wall.start);
        this._initEnd = clonePt(wall.end);
        this._snaps = [];
    }
    redo() {
        const w = this.wall;
        if (!this.scene.items.includes(w)) this.scene.items.push(w);
        // Reset to as-built so redo is idempotent
        w.start = clonePt(this._initStart);
        w.end = clonePt(this._initEnd);

        // Find neighbors at either endpoint
        const tol = 0.5;
        const neighbors = [];
        for (const epName of ['start', 'end']) {
            const np = w.sceneEndpoint(epName);
            for (const it of this.scene.items) {
                if (it === w || it.kind !== 'wall') continue;
                for (const oep of ['start', 'end']) {
                    const op = it.sceneEndpoint(oep);
                    if (Math.abs(op.x - np.x) < tol && Math.abs(op.y - np.y) < tol) {
                        neighbors.push({ wall: it, otherEp: oep, newEp: epName });
                        break;
                    }
                }
            }
        }
        this._snaps = snapshotWalls(neighbors.map(n => n.wall));

        // Recompute neighbours (walls with a typed interior length grow or
        // shrink so their inside faces keep that length), keeping each
        // neighbour's OPPOSITE end fixed so the shared corner moves.
        //  - Joined at one end (drawing a chain): the new wall translates to
        //    follow the corner, so its direction is preserved.
        //  - Joined at both ends (closing a room): each end follows its own
        //    corner, so both corners stay joined.
        const bothEnds = new Set(neighbors.map(n => n.newEp)).size === 2;
        for (const { wall: other, otherEp, newEp } of neighbors) {
            const keep = otherEp === 'start' ? 'end' : 'start';
            const oldPt = other.sceneEndpoint(otherEp);
            if (other.applyInteriorRecompute(keep, this.scene)) {
                const newPt = other.sceneEndpoint(otherEp);
                const dx = newPt.x - oldPt.x;
                const dy = newPt.y - oldPt.y;
                if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
                    if (bothEnds) {
                        const ep = w.sceneEndpoint(newEp);
                        w.setSceneEndpoint(newEp, { x: ep.x + dx, y: ep.y + dy });
                    } else {
                        w.start = { x: w.start.x + dx, y: w.start.y + dy };
                        w.end = { x: w.end.x + dx, y: w.end.y + dy };
                    }
                }
            }
        }
        // Recompute the new wall itself with start fixed
        w.applyInteriorRecompute('start', this.scene);
        this.scene.notify();
    }
    undo() {
        restoreWalls(this._snaps);
        const i = this.scene.items.indexOf(this.wall);
        if (i >= 0) this.scene.items.splice(i, 1);
        this.scene.selection.delete(this.wall.uid);
        this.scene.notify();
    }
}

// MoveItemsCommand — translate items by (dx, dy). Walls translate both
// endpoints; openings translate by offset (no, openings move with their
// wall). Rooms/annotations move pos. Dimensions move both anchors.
export class MoveItemsCommand extends Command {
    constructor(items, dx, dy, text = 'Move') {
        super(text);
        this.items = items.slice();
        this.dx = dx;
        this.dy = dy;
    }
    _apply(sign) {
        const dx = this.dx * sign, dy = this.dy * sign;
        for (const it of this.items) {
            if (it.kind === 'wall') {
                it.start = { x: it.start.x + dx, y: it.start.y + dy };
                it.end = { x: it.end.x + dx, y: it.end.y + dy };
            } else if (it.kind === 'dimension') {
                it.p1 = { x: it.p1.x + dx, y: it.p1.y + dy };
                it.p2 = { x: it.p2.x + dx, y: it.p2.y + dy };
            } else if (it.kind === 'room' || it.kind === 'annotation' ||
                       it.kind === 'cabinet' || it.kind === 'fixture') {
                it.pos = { x: it.pos.x + dx, y: it.pos.y + dy };
            } else if (it.kind === 'plot') {
                it.points = it.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
            }
        }
    }
    redo() { this._apply(+1); }
    undo() { this._apply(-1); }
}

export class MirrorCommand extends Command {
    constructor(items, axisP1, axisP2, text = 'Mirror') {
        super(text);
        this.items = items.filter(i => typeof i.mirror === 'function');
        this.axisP1 = clonePt(axisP1);
        this.axisP2 = clonePt(axisP2);
    }
    _apply() { for (const it of this.items) it.mirror(this.axisP1, this.axisP2); }
    redo() { this._apply(); }
    undo() { this._apply(); }   // mirror is its own inverse
}

export class AddItemsCommand extends Command {
    constructor(scene, items, text = 'Add Items') {
        super(text);
        this.scene = scene;
        this.items = items.slice();
    }
    redo() {
        for (const it of this.items) {
            if (!this.scene.items.includes(it)) this.scene.items.push(it);
        }
        this.scene.notify();
    }
    undo() {
        for (const it of this.items) {
            const i = this.scene.items.indexOf(it);
            if (i >= 0) this.scene.items.splice(i, 1);
            this.scene.selection.delete(it.uid);
        }
        this.scene.notify();
    }
}

// SetWallEndCommand — set start or end of a wall, with snapshot/restore
// of any openings (offsets need adjusting if start moves).
export class SetWallEndCommand extends Command {
    constructor(wall, which, newPt, text = 'Resize Wall') {
        super(text);
        this.wall = wall;
        this.which = which;
        this._old = which === 'start' ? clonePt(wall.start) : clonePt(wall.end);
        this._new = clonePt(newPt);
        this._oldOpenings = wall.openings.map(o => o.offset);
    }
    _set(p) {
        if (this.which === 'start') {
            // adjust openings' offset so their scene positions stay
            const oldStart = clonePt(this.wall.start);
            this.wall.start = clonePt(p);
            const dx = this.wall.start.x - oldStart.x;
            const dy = this.wall.start.y - oldStart.y;
            const L = this.wall.length;
            if (L > 1e-6) {
                const ax = (this.wall.end.x - this.wall.start.x) / L;
                const ay = (this.wall.end.y - this.wall.start.y) / L;
                const dAlong = dx * ax + dy * ay;
                for (const op of this.wall.openings) op.offset -= dAlong;
            }
        } else {
            this.wall.end = clonePt(p);
        }
    }
    redo() { this._set(this._new); }
    undo() {
        if (this.which === 'start') this.wall.start = clonePt(this._old);
        else this.wall.end = clonePt(this._old);
        // Restore opening offsets exactly
        for (let i = 0; i < this.wall.openings.length; i++) {
            this.wall.openings[i].offset = this._oldOpenings[i];
        }
    }
}

// EditDimensionCommand — change a dimension's length and translate the
// chosen wall side to absorb the delta.
export class EditDimensionCommand extends Command {
    constructor(scene, dim, newValue, side, text = 'Edit Dimension') {
        super(text);
        this.scene = scene;
        this.dim = dim;
        this.newValue = newValue;
        this.side = side;  // 'p1' | 'p2'
        this._wallSnaps = [];
        this._dimSnap = null;
    }

    _findAnchoredWalls(anchor, dimDir) {
        const out = [];
        const faceTol = 0.5;
        const perpTol = 0.2;
        for (const it of this.scene.items) {
            if (it.kind !== 'wall') continue;
            const a = it.start, b = it.end;
            const wdx = b.x - a.x, wdy = b.y - a.y;
            const wL = Math.hypot(wdx, wdy);
            if (wL < 1e-6) continue;
            const wux = wdx / wL, wuy = wdy / wL;
            if (Math.abs(wux * dimDir.x + wuy * dimDir.y) > perpTol) continue;
            const apx = anchor.x - a.x, apy = anchor.y - a.y;
            const t = apx * wux + apy * wuy;
            if (t < -0.5 || t > wL + 0.5) continue;
            const cx = a.x + t * wux, cy = a.y + t * wuy;
            const d = Math.hypot(anchor.x - cx, anchor.y - cy);
            if (Math.abs(d - it.thickness / 2) <= faceTol) out.push(it);
        }
        return out;
    }

    _connectedEndpointTranslations(movingWalls) {
        const eps = [];
        for (const w of movingWalls) {
            eps.push({ wall: w, ep: 'start' });
            eps.push({ wall: w, ep: 'end' });
        }
        const movingSet = new Set(movingWalls);
        const tol = 0.5;
        for (const mw of movingWalls) {
            for (const mep of ['start', 'end']) {
                const mp = mw.sceneEndpoint(mep);
                for (const it of this.scene.items) {
                    if (it.kind !== 'wall' || movingSet.has(it)) continue;
                    for (const oep of ['start', 'end']) {
                        const op = it.sceneEndpoint(oep);
                        if (Math.abs(op.x - mp.x) < tol && Math.abs(op.y - mp.y) < tol) {
                            eps.push({ wall: it, ep: oep });
                            break;
                        }
                    }
                }
            }
        }
        return eps;
    }

    redo() {
        const dim = this.dim;
        const p1 = clonePt(dim.p1), p2 = clonePt(dim.p2);
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const L = Math.hypot(dx, dy);
        if (L < 1e-6) return;
        const ux = dx / L, uy = dy / L;
        const delta = this.newValue - L;
        if (Math.abs(delta) < 1e-6) return;

        let anchor, tx, ty;
        if (this.side === 'p2') {
            anchor = clonePt(p2);
            tx = ux * delta; ty = uy * delta;
        } else {
            anchor = clonePt(p1);
            tx = -ux * delta; ty = -uy * delta;
        }

        const movingWalls = this._findAnchoredWalls(anchor, { x: ux, y: uy });
        const endpoints = this._connectedEndpointTranslations(movingWalls);

        // Snapshot
        const allWalls = new Set(endpoints.map(e => e.wall));
        this._wallSnaps = snapshotWalls([...allWalls]);
        this._dimSnap = { p1: clonePt(dim.p1), p2: clonePt(dim.p2) };

        // Apply
        const movingSet = new Set(movingWalls);
        for (const { wall, ep } of endpoints) {
            if (movingSet.has(wall)) {
                if (ep === 'start') wall.start = { x: wall.start.x + tx, y: wall.start.y + ty };
                else wall.end = { x: wall.end.x + tx, y: wall.end.y + ty };
            } else {
                if (ep === 'start') {
                    const oldStart = clonePt(wall.start);
                    wall.start = { x: wall.start.x + tx, y: wall.start.y + ty };
                    const newL = Math.hypot(wall.end.x - wall.start.x,
                                            wall.end.y - wall.start.y);
                    if (newL > 1e-6) {
                        const ax = (wall.end.x - wall.start.x) / newL;
                        const ay = (wall.end.y - wall.start.y) / newL;
                        const dAlong = (wall.start.x - oldStart.x) * ax +
                                       (wall.start.y - oldStart.y) * ay;
                        for (const op of wall.openings) op.offset -= dAlong;
                    }
                } else {
                    wall.end = { x: wall.end.x + tx, y: wall.end.y + ty };
                }
            }
        }
        // Translate the chosen anchor of the dimension
        if (this.side === 'p2') dim.p2 = { x: p2.x + tx, y: p2.y + ty };
        else dim.p1 = { x: p1.x + tx, y: p1.y + ty };

        this.scene.notify();
    }
    undo() {
        restoreWalls(this._wallSnaps);
        if (this._dimSnap) {
            this.dim.p1 = clonePt(this._dimSnap.p1);
            this.dim.p2 = clonePt(this._dimSnap.p2);
        }
        this.scene.notify();
    }
}

// CompositeCommand — bundle several commands into one undo entry.
export class CompositeCommand extends Command {
    constructor(commands, text = 'Composite') {
        super(text);
        this.commands = commands.slice();
    }
    redo() { for (const c of this.commands) c.redo(); }
    undo() { for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].undo(); }
}

// AddOpeningCommand — adds an opening to a wall.
export class AddOpeningCommand extends Command {
    constructor(wall, opening, text = 'Add Opening') {
        super(text);
        this.wall = wall;
        this.opening = opening;
    }
    redo() { this.wall.addOpening(this.opening); }
    undo() { this.wall.removeOpening(this.opening); }
}

export class RemoveOpeningCommand extends Command {
    constructor(wall, opening, text = 'Delete Opening') {
        super(text);
        this.wall = wall;
        this.opening = opening;
    }
    redo() { this.wall.removeOpening(this.opening); }
    undo() { this.wall.addOpening(this.opening); }
}

// Set interior_length on a wall and recompute its centerline length.
// Captures the wall's pre/post snapshot so undo restores everything.
export class SetInteriorLengthCommand extends Command {
    constructor(scene, wall, newValue, text = 'Set Interior Length') {
        super(text);
        this.scene = scene;
        this.wall = wall;
        this.newValue = newValue;
        this._oldInterior = wall.interior_length;
        this._oldEnd = clonePt(wall.end);
        this._oldStart = clonePt(wall.start);
        this._oldOpenings = wall.openings.map(o => o.offset);
    }
    redo() {
        this.wall.interior_length = this.newValue;
        // Apply recompute keeping start fixed
        this.wall.applyInteriorRecompute('start', this.scene);
        this.scene.notify();
    }
    undo() {
        this.wall.interior_length = this._oldInterior;
        this.wall.start = clonePt(this._oldStart);
        this.wall.end = clonePt(this._oldEnd);
        for (let i = 0; i < this.wall.openings.length; i++) {
            this.wall.openings[i].offset = this._oldOpenings[i];
        }
        this.scene.notify();
    }
}

// Rotate a cabinet / fixture about its centre.
export class RotateCabinetCommand extends Command {
    constructor(item, newRotation, text = 'Rotate') {
        super(text);
        this.item = item;
        this.newRotation = normAngle(newRotation);
        this._oldRotation = item.rotation;
    }
    redo() { this.item.rotation = this.newRotation; }
    undo() { this.item.rotation = this._oldRotation; }
}

// Move a set of placed objects to new poses (position + rotation + flip)
// in one undo step. Used by drag-with-snapping.
export class SetPoseCommand extends Command {
    constructor(poses, text = 'Move') {
        super(text);
        // poses: [{ item, pos, rotation, flip }]
        this.poses = poses.map(p => ({
            item: p.item,
            to: { pos: clonePt(p.pos || p.item.pos), rotation: p.rotation ?? p.item.rotation,
                  flip: p.flip ?? p.item.flip },
            from: { pos: clonePt(p.item.pos), rotation: p.item.rotation,
                    flip: p.item.flip },
        }));
    }
    _set(which) {
        for (const p of this.poses) {
            const v = p[which];
            p.item.pos = clonePt(v.pos);
            p.item.rotation = v.rotation;
            p.item.flip = v.flip;
        }
    }
    redo() { this._set('to'); }
    undo() { this._set('from'); }
}
