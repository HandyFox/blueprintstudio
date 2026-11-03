// Properties panel.
//
// Renders an editable inspector for the current selection. When the user
// changes a value, it pushes a SetAttrCommand (or specialised command for
// length/dimension edits) so undo/redo work normally.

import {
    AddItemCommand, Cabinet, CompositeCommand, EditDimensionCommand,
    RotateCabinetCommand, SetAttrCommand, SetInteriorLengthCommand,
    SetPoseCommand, SetWallEndCommand, isPlaced,
} from './model.js';
import { formatLength, parseLength } from './units.js';
import {
    FINISHES, categoryLabel, doorCount, getCabinet, isAvailable, priceFor, sizeVariants,
} from './cabinets.js';
import { formatUSD } from './bom.js';
import { gapsFor } from './placement.js';
import { getFixture } from './symbols.js';
import * as ui from './ui.js';

export class PropertiesPanel {
    constructor(rootEl, doc, app) {
        this.root = rootEl;
        this.doc = doc;
        this.app = app;
    }

    render() {
        const root = this.root;
        root.innerHTML = '';

        const sel = this.doc.scene.selected();
        // Also include any opening if it's selected (openings live on walls,
        // not directly in items list)
        const openings = [];
        for (const w of this.doc.scene.walls()) {
            for (const op of w.openings) {
                if (this.doc.scene.selection.has(op.uid)) openings.push(op);
            }
        }

        if (!sel.length && !openings.length) {
            this._renderProject(root);
            return;
        }

        if (openings.length === 1 && !sel.length) {
            this._renderOpening(root, openings[0]);
            return;
        }

        if (sel.length !== 1) {
            this._renderMulti(root, sel.length + openings.length);
            return;
        }

        const item = sel[0];
        switch (item.kind) {
            case 'wall': this._renderWall(root, item); break;
            case 'dimension': this._renderDimension(root, item); break;
            case 'room': this._renderRoom(root, item); break;
            case 'plot': this._renderPlot(root, item); break;
            case 'annotation': this._renderText(root, item); break;
            case 'cabinet': this._renderCabinet(root, item); break;
            case 'fixture': this._renderFixture(root, item); break;
        }
    }

    // ---- helpers ---------------------------------------------------------

    _h(tag, attrs = {}, children = []) {
        const el = document.createElement(tag);
        for (const k in attrs) {
            if (k === 'on') {
                for (const ev in attrs[k]) el.addEventListener(ev, attrs[k][ev]);
            } else if (k === 'class') {
                el.className = attrs[k];
            } else {
                el.setAttribute(k, attrs[k]);
            }
        }
        for (const c of children) {
            if (c == null) continue;
            el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        }
        return el;
    }

    _section(title) {
        return this._h('div', { class: 'prop-section' }, [
            this._h('h4', {}, [title]),
        ]);
    }

    _row(label, control) {
        return this._h('div', { class: 'prop-row' }, [
            this._h('label', {}, [label]),
            control,
        ]);
    }

    _info(label, text) {
        return this._h('div', { class: 'prop-info' }, [
            this._h('span', { class: 'prop-info-label' }, [label]),
            this._h('span', { class: 'prop-info-value' }, [String(text)]),
        ]);
    }

    _lengthInput(value, onCommit, opts = {}) {
        const input = this._h('input', {
            type: 'text',
            value: value == null ? '' : formatLength(value),
            class: 'prop-input',
        });
        input.addEventListener('change', () => {
            const parsed = parseLength(input.value);
            if (parsed == null || parsed < 0 || (parsed === 0 && !opts.allowZero)) {
                input.value = value == null ? '' : formatLength(value);
                return;
            }
            onCommit(parsed);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            else if (e.key === 'Escape') {
                input.value = value == null ? '' : formatLength(value);
                input.blur();
            }
        });
        return input;
    }

    _numInput(value, onCommit, opts = {}) {
        const input = this._h('input', {
            type: 'number',
            value: value,
            class: 'prop-input',
            step: opts.step || '0.1',
        });
        if (opts.min != null) input.setAttribute('min', opts.min);
        input.addEventListener('change', () => {
            const v = parseFloat(input.value);
            if (!isNaN(v)) onCommit(v);
            else input.value = value;
        });
        return input;
    }

    _textInput(value, onCommit) {
        const input = this._h('input', {
            type: 'text', value: value || '', class: 'prop-input',
        });
        input.addEventListener('change', () => onCommit(input.value));
        return input;
    }

    _checkbox(value, onCommit, label = '') {
        const input = this._h('input', { type: 'checkbox' });
        input.checked = !!value;
        input.addEventListener('change', () => onCommit(input.checked));
        return this._h('label', { class: 'prop-checkbox' }, [
            input, ' ' + (label || ''),
        ]);
    }

    _select(value, options, onCommit) {
        const sel = this._h('select', { class: 'prop-input' });
        for (const o of options) {
            const opt = this._h('option', { value: o.value }, [o.label]);
            if (o.value === value) opt.setAttribute('selected', '');
            sel.appendChild(opt);
        }
        sel.addEventListener('change', () => onCommit(sel.value));
        return sel;
    }

    // ---- panes -----------------------------------------------------------

    _renderProject(root) {
        root.appendChild(this._section('Project'));
        const s = this.doc.settings;

        const set = (k, v, label) =>
            this.doc.push(new SetAttrCommand(s, k, v, `Set ${label}`));

        root.appendChild(this._row('Name',
            this._textInput(s.project_name,
                v => { set('project_name', v, 'name'); this.app.update(); })));
        root.appendChild(this._row('Address',
            this._textInput(s.project_address,
                v => { set('project_address', v, 'address'); this.app.update(); })));
        root.appendChild(this._row('Drawing',
            this._textInput(s.drawing_title,
                v => { set('drawing_title', v, 'drawing'); this.app.update(); })));
        root.appendChild(this._row('Drawing #',
            this._textInput(s.drawing_number,
                v => { set('drawing_number', v, 'drawing #'); this.app.update(); })));
        root.appendChild(this._row('Designer',
            this._textInput(s.designer_name,
                v => { set('designer_name', v, 'designer'); this.app.update(); })));
        root.appendChild(this._row('Revision',
            this._textInput(s.revision,
                v => { set('revision', v, 'revision'); this.app.update(); })));
        root.appendChild(this._info('Items',
            this.doc.scene.items.length));

        root.appendChild(this._section('Drawing defaults'));
        const setNum = (k, label) => (v) => { set(k, v, label); this.app.update(); };
        root.appendChild(this._row('Interior wall', this._lengthInput(s.default_wall_thickness, setNum('default_wall_thickness', 'wall thickness'))));
        root.appendChild(this._row('Exterior wall', this._lengthInput(s.default_exterior_thickness, setNum('default_exterior_thickness', 'exterior thickness'))));
        root.appendChild(this._row('Wall height', this._lengthInput(s.default_wall_height, setNum('default_wall_height', 'wall height'))));
        root.appendChild(this._row('Door width', this._lengthInput(s.default_door_width, setNum('default_door_width', 'door width'))));
        root.appendChild(this._row('Window width', this._lengthInput(s.default_window_width, setNum('default_window_width', 'window width'))));
        root.appendChild(this._h('div', { class: 'prop-hint' }, [
            'Nothing selected. Click an item to edit it, or drag a box to select several.']));
    }

    _renderMulti(root, n) {
        root.appendChild(this._section(`Selection (${n})`));
        const sel = this.doc.scene.selected();
        const counts = {};
        for (const it of sel) counts[it.kind] = (counts[it.kind] || 0) + 1;
        const names = { wall: 'walls', dimension: 'dimensions', room: 'room labels', plot: 'lots',
                        annotation: 'notes', cabinet: 'cabinets', fixture: 'fixtures' };
        for (const [k, v] of Object.entries(counts)) root.appendChild(this._info(names[k] || k, v));
        const placed = sel.filter(isPlaced);
        if (placed.length) {
            root.appendChild(this._buttons([
                ['Rotate 90°', () => this._rotate(placed, Math.PI / 2)],
                ['Rotate −90°', () => this._rotate(placed, -Math.PI / 2)],
            ]));
        }
        root.appendChild(this._h('div', { class: 'prop-hint' },
            ['Drag to move together • Arrow keys nudge 1" (Shift = 1\') • Delete removes']));
    }

    _buttons(list) {
        return this._h('div', { class: 'prop-btnrow' }, list.map(([label, fn, cls]) => {
            const b = this._h('button', { class: 'btn small' + (cls ? ' ' + cls : ''), type: 'button' }, [label]);
            b.addEventListener('click', fn);
            return b;
        }));
    }

    _rotate(items, by) {
        this.doc.push(new CompositeCommand(
            items.map(it => new RotateCabinetCommand(it, it.rotation + by)), 'Rotate'));
    }

    _renderWall(root, w) {
        root.appendChild(this._section('Wall'));

        // Centerline length: read-only display + editable
        const lengthInput = this._lengthInput(w.length, (newLen) => {
            // Set a length by moving end while keeping start. Clear interior_length
            // so subsequent neighbor connections don't overwrite it.
            const dx = w.end.x - w.start.x;
            const dy = w.end.y - w.start.y;
            const cur = Math.hypot(dx, dy);
            if (cur < 1e-6) return;
            const t = newLen / cur;
            const newEnd = {
                x: w.start.x + dx * t,
                y: w.start.y + dy * t,
            };
            // Single composite undo entry: clear interior_length + set end.
            const c1 = new SetAttrCommand(w, 'interior_length', null, '');
            const c2 = new SetWallEndCommand(w, 'end', newEnd, '');
            this.doc.push(new CompositeCommand([c1, c2], 'Set Length'));
            this.app.update();
        });
        root.appendChild(this._row('Length', lengthInput));

        const interiorInput = this._lengthInput(w.interior_length, (newLen) => {
            this.doc.push(new SetInteriorLengthCommand(
                this.doc.scene, w, newLen, 'Set Interior Length'));
            this.app.update();
        });
        root.appendChild(this._row('Interior length', interiorInput));

        root.appendChild(this._row('Thickness',
            this._lengthInput(w.thickness,
                v => { this.doc.push(new SetAttrCommand(w, 'thickness', v, 'Set Thickness')); this.app.update(); })));
        root.appendChild(this._row('Height',
            this._lengthInput(w.height,
                v => { this.doc.push(new SetAttrCommand(w, 'height', v, 'Set Height')); this.app.update(); })));

        root.appendChild(this._row('Exterior',
            this._checkbox(w.is_exterior,
                v => { this.doc.push(new SetAttrCommand(w, 'is_exterior', v, 'Toggle Exterior')); this.app.update(); })));

        const angleDeg = w.angleRad * 180 / Math.PI;
        root.appendChild(this._info('Angle', `${angleDeg.toFixed(2)}°`));
        root.appendChild(this._info('Start', `${w.start.x.toFixed(2)}, ${w.start.y.toFixed(2)}`));
        root.appendChild(this._info('End', `${w.end.x.toFixed(2)}, ${w.end.y.toFixed(2)}`));
        root.appendChild(this._info('Openings', w.openings.length));
    }

    _renderOpening(root, op) {
        root.appendChild(this._section(op.openingKind === 'door' ? 'Door' : 'Window'));

        root.appendChild(this._row('Type',
            this._select(op.openingKind, [
                { value: 'door', label: 'Door' },
                { value: 'window', label: 'Window' },
            ], v => { this.doc.push(new SetAttrCommand(op, 'openingKind', v, 'Change Type')); this.app.update(); })));

        root.appendChild(this._row('Width',
            this._lengthInput(op.width,
                v => { this.doc.push(new SetAttrCommand(op, 'width', v, 'Set Width')); this.app.update(); })));
        root.appendChild(this._row('Height',
            this._lengthInput(op.height,
                v => { this.doc.push(new SetAttrCommand(op, 'height', v, 'Set Height')); this.app.update(); })));
        if (op.openingKind === 'window') {
            root.appendChild(this._row('Sill',
                this._lengthInput(op.sill,
                    v => { this.doc.push(new SetAttrCommand(op, 'sill', v, 'Set Sill')); this.app.update(); })));
        }

        if (op.openingKind === 'door') {
            root.appendChild(this._row('Swing',
                this._select(op.swing, [
                    { value: 'left_in', label: 'Left, swings in' },
                    { value: 'right_in', label: 'Right, swings in' },
                    { value: 'left_out', label: 'Left, swings out' },
                    { value: 'right_out', label: 'Right, swings out' },
                ], v => { this.doc.push(new SetAttrCommand(op, 'swing', v, 'Change Swing')); this.app.update(); })));
        }

        root.appendChild(this._row('Offset',
            this._lengthInput(op.offset,
                v => { this.doc.push(new SetAttrCommand(op, 'offset', v, 'Set Offset')); this.app.update(); })));
    }

    _renderDimension(root, d) {
        root.appendChild(this._section('Dimension'));

        const dx = d.p2.x - d.p1.x, dy = d.p2.y - d.p1.y;
        const cur = Math.hypot(dx, dy);
        const ux = cur > 0 ? dx / cur : 1, uy = cur > 0 ? dy / cur : 0;

        root.appendChild(this._row('Length',
            this._lengthInput(cur, (newLen) => {
                // Choose side via small dialog: by default, 'p2' (move second wall)
                // Provide buttons below for explicit selection
                const cmd = new EditDimensionCommand(this.doc.scene, d, newLen, 'p2', 'Edit Dimension');
                this.doc.push(cmd);
                this.app.update();
            })));

        // Move-side buttons with arrow indicating direction
        const side1Arrow = this._arrowFor(-ux, -uy);
        const side2Arrow = this._arrowFor(ux, uy);

        const moveBtn = (label, side) => {
            const b = this._h('button', { class: 'prop-btn' }, [label]);
            b.addEventListener('click', async () => {
                const txt = await ui.ask('Change dimension', `New length (now ${formatLength(cur)})`,
                                         formatLength(cur));
                const v = parseLength(txt);
                if (v == null || v <= 0) return;
                this.doc.push(new EditDimensionCommand(
                    this.doc.scene, d, v, side, 'Edit Dimension'));
                this.app.update();
            });
            return b;
        };
        root.appendChild(this._h('div', { class: 'prop-row prop-buttons' }, [
            moveBtn(`Move first wall ${side1Arrow}`, 'p1'),
        ]));
        root.appendChild(this._h('div', { class: 'prop-row prop-buttons' }, [
            moveBtn(`Move second wall ${side2Arrow}`, 'p2'),
        ]));

        root.appendChild(this._row('Offset',
            this._lengthInput(d.offset,
                v => { this.doc.push(new SetAttrCommand(d, 'offset', v, 'Set Offset')); this.app.update(); })));
        root.appendChild(this._row('Text height',
            this._lengthInput(d.text_height,
                v => { this.doc.push(new SetAttrCommand(d, 'text_height', v, 'Set Text Height')); this.app.update(); })));
    }

    _arrowFor(dx, dy) {
        if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? '→' : '←';
        return dy > 0 ? '↓' : '↑';
    }

    _renderRoom(root, r) {
        root.appendChild(this._section('Room'));
        root.appendChild(this._row('Name',
            this._textInput(r.name,
                v => { this.doc.push(new SetAttrCommand(r, 'name', v, 'Rename Room')); this.app.update(); })));
        const sf = (r.area_sq_in / 144).toFixed(1);
        const areaInp = this._h('input', { type: 'text', value: sf + ' sq ft', class: 'prop-input' });
        areaInp.addEventListener('change', () => {
            const m = areaInp.value.match(/(\d+(?:\.\d+)?)/);
            if (m) {
                this.doc.push(new SetAttrCommand(r, 'area_sq_in',
                    parseFloat(m[1]) * 144, 'Set Area'));
                this.app.update();
            } else {
                areaInp.value = sf + ' sq ft';
            }
        });
        root.appendChild(this._row('Area', areaInp));
    }

    _renderPlot(root, p) {
        root.appendChild(this._section('Plot Polygon'));
        root.appendChild(this._row('Label',
            this._textInput(p.label,
                v => { this.doc.push(new SetAttrCommand(p, 'label', v, 'Rename Plot')); this.app.update(); })));
        root.appendChild(this._row('Closed',
            this._checkbox(p.closed,
                v => { this.doc.push(new SetAttrCommand(p, 'closed', v, 'Toggle Closed')); this.app.update(); })));
        root.appendChild(this._info('Vertices', p.points.length));
        if (p.closed && p.points.length >= 3) {
            const sqIn = p.area();
            const sqFt = sqIn / 144;
            const acres = sqFt / 43560;
            root.appendChild(this._info('Area', `${sqFt.toFixed(0)} sq ft (${acres.toFixed(3)} ac)`));
        }
    }

    _renderText(root, t) {
        root.appendChild(this._section('Text'));
        root.appendChild(this._row('Text',
            this._textInput(t.text,
                v => { this.doc.push(new SetAttrCommand(t, 'text', v, 'Edit Text')); this.app.update(); })));
        root.appendChild(this._row('Font height',
            this._lengthInput(t.font_pt,
                v => { this.doc.push(new SetAttrCommand(t, 'font_pt', v, 'Set Font')); this.app.update(); })));
    }

    _renderCabinet(root, cab) {
        const spec = getCabinet(cab.model);
        root.appendChild(this._section(cab.filler ? 'Filler' : `Cabinet ${cab.model}`));
        root.appendChild(this._h('div', { class: 'prop-sub' }, [
            `${cab.description || categoryLabel(cab.category)}`]));

        // Size swap within the same series, keeping the left end in place.
        if (!cab.filler && spec) {
            const variants = sizeVariants(cab.model);
            if (variants.length > 1) {
                const sel = this._select(cab.model, variants.map(v => ({
                    value: v.model,
                    label: `${v.model} — ${v.width}"` + (isAvailable(v.model, cab.finish) ? '' : ' (n/a in ' + cab.finish + ')'),
                })), (m) => this._swapModel(cab, m));
                root.appendChild(this._row('Size', sel));
            }
        }
        if (cab.filler) {
            root.appendChild(this._row('Width', this._lengthInput(cab.width, (w) => {
                const dx = (w - cab.width) / 2;
                const pos = cab.toWorld(dx, 0);
                this.doc.push(new CompositeCommand([
                    new SetAttrCommand(cab, 'width', w, ''),
                    new SetPoseCommand([{ item: cab, pos }], ''),
                ], 'Resize Filler'));
            })));
        } else {
            root.appendChild(this._info('Dimensions', `${cab.width}" W × ${cab.depth}" D × ${cab.height}" H`));
        }

        // Finish
        const fin = this._h('select', { class: 'prop-input' });
        for (const f of FINISHES) {
            const o = this._h('option', { value: f }, [f + (isAvailable(cab.model, f) || cab.filler ? '' : ' (n/a)')]);
            if (!isAvailable(cab.model, f) && !cab.filler) o.disabled = true;
            if (f === cab.finish) o.selected = true;
            fin.appendChild(o);
        }
        fin.addEventListener('change', () => {
            const newFinish = fin.value;
            const newPrice = priceFor(cab.model, newFinish) || cab.price;
            this.doc.push(new CompositeCommand([
                new SetAttrCommand(cab, 'finish', newFinish, ''),
                new SetAttrCommand(cab, 'price', newPrice, ''),
            ], 'Change Finish'));
        });
        root.appendChild(this._row('Finish', fin));

        if (!cab.filler && (doorCount(cab) === 1 || cab.blind)) {
            root.appendChild(this._row(cab.blind ? 'Door side' : 'Hinge',
                this._select(cab.hinge || 'L', [
                    { value: 'L', label: cab.blind ? 'Blind on right, door left' : 'Left' },
                    { value: 'R', label: cab.blind ? 'Blind on left, door right' : 'Right' },
                ], v => {
                    const cmds = [new SetAttrCommand(cab, 'hinge', v, '')];
                    if (cab.blind) cmds.push(new SetAttrCommand(cab, 'flip', v === 'R', ''));
                    this.doc.push(new CompositeCommand(cmds, 'Change Hinge'));
                })));
        }

        root.appendChild(this._row('Bottom at',
            this._lengthInput(cab.elevation || 0, v => {
                this.doc.push(new SetAttrCommand(cab, 'elevation', v, 'Set Mounting Height'));
            }, { allowZero: true })));
        if (cab.elevation >= 40) {
            root.appendChild(this._info('Top at', formatLength(cab.elevation + cab.height)));
        }

        this._gapControls(root, cab);
        this._poseButtons(root, cab);
        if (cab.price) {
            root.appendChild(this._h('div', { class: 'prop-foot' },
                [`List price ${formatUSD(cab.price)} (${cab.finish})`]));
        }
    }

    _renderFixture(root, fx) {
        const spec = getFixture(fx.fixture_id);
        root.appendChild(this._section(fx.name || 'Fixture'));
        if (spec) root.appendChild(this._h('div', { class: 'prop-sub' }, [spec.category]));
        const resize = (attr) => (v) => {
            const cmds = [new SetAttrCommand(fx, attr, v, '')];
            if (attr === 'width') cmds.push(new SetPoseCommand([{ item: fx, pos: fx.toWorld((v - fx.width) / 2, 0) }], ''));
            if (attr === 'depth') cmds.push(new SetPoseCommand([{ item: fx, pos: fx.toWorld(0, (v - fx.depth) / 2) }], ''));
            this.doc.push(new CompositeCommand(cmds, 'Resize'));
        };
        root.appendChild(this._row('Width', this._lengthInput(fx.width, resize('width'))));
        root.appendChild(this._row('Depth', this._lengthInput(fx.depth, resize('depth'))));
        root.appendChild(this._row('Height', this._lengthInput(fx.height, resize('height'))));
        root.appendChild(this._row('Bottom at', this._lengthInput(fx.elevation || 0,
            v => this.doc.push(new SetAttrCommand(fx, 'elevation', v, 'Set Mounting Height')),
            { allowZero: true })));
        root.appendChild(this._row('Label', this._textInput(fx.label,
            v => this.doc.push(new SetAttrCommand(fx, 'label', v, 'Set Label')))));
        this._gapControls(root, fx);
        this._poseButtons(root, fx);
    }

    _poseButtons(root, it) {
        root.appendChild(this._buttons([
            ['⟲ 90°', () => this._rotate([it], -Math.PI / 2)],
            ['⟳ 90°', () => this._rotate([it], Math.PI / 2)],
            ['Flip', () => this.doc.push(new SetPoseCommand([{ item: it, flip: !it.flip }], 'Flip'))],
        ]));
    }

    _gapControls(root, it) {
        const g = gapsFor(this.doc.scene, it);
        if (!g) {
            root.appendChild(this._h('div', { class: 'prop-hint' },
                ['Not against a wall — drag it near one to snap.']));
            return;
        }
        root.appendChild(this._section('Space beside it'));
        const row = (label, gap, side) => {
            const val = gap == null ? '—' : gap < 0.03 ? 'flush' : formatLength(gap);
            const kids = [this._h('span', { class: 'gap-label' }, [label]),
                          this._h('span', { class: 'gap-val' + (gap != null && gap > 0.03 && gap < 3 ? ' warn' : '') }, [val])];
            if (gap != null && gap > 0.03) {
                const close = this._h('button', { class: 'btn small', type: 'button', title: 'Slide over to close this gap' }, ['Close']);
                close.addEventListener('click', () =>
                    this.doc.push(new SetPoseCommand([{ item: it, pos: it.toWorld(side * gap, 0) }], 'Close Gap')));
                kids.push(close);
                if (it.kind === 'cabinet' && !it.filler && gap <= 6.01) {
                    const fill = this._h('button', { class: 'btn small', type: 'button', title: 'Add a filler cut to this width' }, ['Filler']);
                    fill.addEventListener('click', () => this._addFiller(it, gap, side));
                    kids.push(fill);
                }
            }
            return this._h('div', { class: 'gap-row' }, kids);
        };
        root.appendChild(row('Left', g.left, -1));
        root.appendChild(row('Right', g.right, 1));
        if (g.collides) root.appendChild(this._h('div', { class: 'prop-warn' }, ['Overlaps something on this wall.']));
    }

    _addFiller(cab, gap, side) {
        const tall = cab.category === 'tall';
        const upper = cab.elevation >= 40;
        const model = tall ? 'F3-T' : `${gap <= 3.01 ? 'F3' : 'F6'}-${upper ? 'W' : 'B'}`;
        const spec = getCabinet(model);
        const f = new Cabinet({
            model, category: 'filler', filler: true, stock: spec ? spec.stock : '',
            description: spec ? spec.description : 'Filler',
            width: gap, depth: cab.depth, height: cab.height, elevation: cab.elevation,
            pos: cab.toWorld(side * (cab.width / 2 + gap / 2), 0),
            rotation: cab.rotation, finish: cab.finish,
            price: spec ? (spec.prices[cab.finish] || 0) : 0,
        });
        this.doc.push(new AddItemCommand(this.doc.scene, f, 'Add Filler'));
    }

    _swapModel(cab, model) {
        const spec = getCabinet(model);
        if (!spec || model === cab.model) return;
        const dw = spec.width - cab.width;
        const pos = cab.toWorld(dw / 2, (spec.depth - cab.depth) / 2);
        const price = priceFor(model, cab.finish) || 0;
        const cmds = [
            new SetAttrCommand(cab, 'model', model, ''),
            new SetAttrCommand(cab, 'width', spec.width, ''),
            new SetAttrCommand(cab, 'depth', spec.depth, ''),
            new SetAttrCommand(cab, 'height', spec.height, ''),
            new SetAttrCommand(cab, 'price', price, ''),
            new SetAttrCommand(cab, 'description', spec.description || '', ''),
            new SetPoseCommand([{ item: cab, pos }], ''),
        ];
        this.doc.push(new CompositeCommand(cmds, `Change to ${model}`));
        if (!isAvailable(model, cab.finish)) ui.toast(`${model} isn't made in ${cab.finish}.`, 'warn');
    }
}
