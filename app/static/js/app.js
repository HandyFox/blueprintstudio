// Top-level application: wires the document, renderer, tools, panels,
// menus, library, keyboard/mouse handling, file I/O and PDF export.

import {
    AddItemsCommand, Document, PRINT_SCALES, RemoveItemsCommand,
    RemoveOpeningCommand, CompositeCommand, RotateCabinetCommand, itemFromDict,
    isPlaced, scaleForLabel,
} from './model.js';
import { Renderer } from './render.js';
import { PropertiesPanel } from './properties.js';
import {
    DimensionTool, OpeningTool, PlaceTool, PlotByBearingTool, PlotTool,
    RoomTool, SelectTool, TextTool, WallTool,
} from './tools.js';
import { Cloud } from './cloud.js';
import { formatLength } from './units.js';
import {
    CATALOG, CATEGORIES, FINISHES, categoryLabel, isAvailable,
} from './cabinets.js';
import { fixtureCategories, fixtureLibrary, primsToPaths } from './symbols.js';
import { computeBOM, bomToCSV, formatUSD, sizeText, hingeText } from './bom.js';
import { buildAllElevations, elevationToSVG } from './elevations.js';
import * as ui from './ui.js';
import { el } from './ui.js';

const PAGE_SIZES = [
    ['Letter', 'Letter (8½ × 11)'], ['Tabloid', 'Tabloid (11 × 17)'],
    ['ANSI C (17x22)', 'ANSI C (17 × 22)'], ['ANSI D (22x34)', 'ANSI D (22 × 34)'],
    ['ANSI E (34x44)', 'ANSI E (34 × 44)'], ['A4', 'A4'], ['A3', 'A3'], ['A2', 'A2'],
    ['A1', 'A1'], ['A0', 'A0'],
];

class App {
    constructor() {
        this.doc = new Document();
        this.svg = document.getElementById('canvas');
        this.renderer = new Renderer(this.svg, this.doc);

        this.tools = {
            select: new SelectTool(this.doc, this),
            wall: new WallTool(this.doc, this, false),
            wallExt: new WallTool(this.doc, this, true),
            door: new OpeningTool(this.doc, this, 'door'),
            window: new OpeningTool(this.doc, this, 'window'),
            dimension: new DimensionTool(this.doc, this),
            plot: new PlotTool(this.doc, this),
            plotBearing: new PlotByBearingTool(this.doc, this),
            room: new RoomTool(this.doc, this),
            text: new TextTool(this.doc, this),
            place: new PlaceTool(this.doc, this),
        };
        this.activeTool = this.tools.select;
        this.properties = new PropertiesPanel(document.getElementById('properties'), this.doc, this);
        this.cloud = new Cloud(this);
        this.lib = { tab: 'cabinets', finish: 'Gray', category: '', search: '', active: null };
        this.showPrices = false;

        this.doc.scene.onChange(() => this._sceneChanged());
        this.doc.onChange(() => {
            this._renderLayersPanel();
            this._renderTitle();
            this.cloud.refresh();
        });

        this._wireMenus();
        this._wireToolRail();
        this._wireLibrary();
        this._wireSidebar();
        this._wireMouse();
        this._wireKeyboard();
        this._fillScaleSelect();

        this._centerView();
        this.renderer.render();
        this.properties.render();
        this._renderLayersPanel();
        this._renderTitle();
        this._updateStatus();
        document.getElementById('canvas-help').classList.remove('hidden');

        // Sign-in check first, then restore this user's last drawing.
        this.cloud.boot().then(() => this._loadAutosave());

        window.addEventListener('resize', () => this.renderer.render());
        window.addEventListener('beforeunload', (e) => {
            this.cloud.releaseOnUnload();
            if (this.doc.modified && this.doc.scene.items.length) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    // ---- change propagation --------------------------------------------------

    _sceneChanged() {
        this.renderer.render();
        this.properties.render();
        this._updateStatus();
        this._scheduleAutosave();
        this._renderTitle();
        document.getElementById('canvas-help').classList.toggle('hidden', this.doc.scene.items.length > 0);
        if (this.doc.modified) this.cloud.refresh();
    }

    update() {
        this.renderer.render();
        this.properties.render();
        this._updateStatus();
        this._scheduleAutosave();
    }

    loadProject(dict) {
        this.setTool('select');
        this.doc.loadDict(dict);
        this._fillScaleSelect();
        this.renderer.render();
        this.properties.render();
        this._renderLayersPanel();
        this._renderTitle();
        this.zoomFit();
        this._scheduleAutosave();
    }

    onSaved() {
        this._renderTitle();
        this._scheduleAutosave();
    }

    // ---- tools ----------------------------------------------------------------

    setTool(name) {
        const t = this.tools[name];
        if (!t) return;
        if (this.activeTool && this.activeTool !== t) {
            this.activeTool.cancel();
            this.activeTool.deactivate();
        }
        this.activeTool = t;
        t.activate();
        this._updateStatus();
        const railName = name === 'place' ? (this.lib.tab === 'cabinets' ? 'cabinets' : 'fixtures') : name;
        for (const btn of document.querySelectorAll('#toolrail .tool')) {
            btn.classList.toggle('active', btn.dataset.tool === railName);
        }
        if (name !== 'place') this._markLibActive(null);
    }

    _wireToolRail() {
        for (const btn of document.querySelectorAll('#toolrail .tool')) {
            btn.addEventListener('click', () => {
                const t = btn.dataset.tool;
                if (t === 'cabinets' || t === 'fixtures') this.openLibrary(t);
                else this.setTool(t);
            });
        }
        this.setTool('select');
    }

    // ---- menus & commands ------------------------------------------------------

    _commands() {
        return {
            new: () => this.fileNew(),
            open: () => this.cloud.openDialog(),
            save: () => this.cloud.saveCurrent(),
            saveAs: () => this.cloud.saveAsDialog(),
            importFile: () => this.fileImport(),
            downloadFile: () => this.fileDownload(),
            exportPdf: () => this.exportPdf(),
            undo: () => this.doc.undo(),
            redo: () => this.doc.redo(),
            duplicate: () => this.duplicateSelection(),
            rotate: () => this.rotateSelection(),
            delete: () => this.deleteSelection(),
            selectAll: () => this.doc.scene.setSelection(this.doc.scene.items.slice()),
            zoomFit: () => this.zoomFit(),
            zoomIn: () => this.zoomBy(1.25),
            zoomOut: () => this.zoomBy(1 / 1.25),
            toggleGrid: () => this._toggleSetting('grid_visible'),
            toggleSnap: () => this._toggleSetting('snap_to_grid'),
            toggleOrtho: () => this._toggleSetting('ortho_mode'),
            libCabinets: () => this.openLibrary('cabinets'),
            libFixtures: () => this.openLibrary('fixtures'),
            elevations: () => this.showElevations(),
            cabinetList: () => this.showCabinetList(),
            changePassword: () => this.cloud.changePasswordDialog(),
            manageUsers: () => this.cloud.adminUsersDialog(),
            logout: () => this.cloud.logout(),
        };
    }

    run(cmd) {
        const fn = this._commands()[cmd];
        if (fn) fn();
    }

    _wireMenus() {
        const closeAll = () => document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
        for (const menu of document.querySelectorAll('.menu')) {
            const btn = menu.querySelector('.menu-btn');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasOpen = menu.classList.contains('open');
                closeAll();
                if (!wasOpen) { this._syncMenuChecks(); menu.classList.add('open'); }
            });
            btn.addEventListener('mouseenter', () => {
                if (document.querySelector('.menu.open') && !menu.classList.contains('open')) {
                    closeAll(); this._syncMenuChecks(); menu.classList.add('open');
                }
            });
        }
        document.addEventListener('click', closeAll);
        for (const b of document.querySelectorAll('[data-cmd]')) {
            b.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeAll();
                this.run(b.dataset.cmd);
            });
        }
    }

    _syncMenuChecks() {
        for (const b of document.querySelectorAll('[data-check]')) {
            b.classList.toggle('checked', !!this.doc.settings[b.dataset.check]);
        }
    }

    _toggleSetting(key) {
        this.doc.settings[key] = !this.doc.settings[key];
        this.renderer.render();
        this._updateStatus();
        this._scheduleAutosave();
    }

    _fillScaleSelect() {
        const sel = document.getElementById('scale-select');
        sel.replaceChildren(...PRINT_SCALES.map(([label]) => {
            const o = el('option', { value: label, text: label });
            if (label === this.doc.settings.print_scale_label) o.selected = true;
            return o;
        }));
        sel.onchange = () => {
            this.doc.settings.print_scale_label = sel.value;
            this.doc.settings.print_scale = scaleForLabel(sel.value);
            this.doc.modified = true;
            this._updateStatus();
            this._scheduleAutosave();
            this.cloud.refresh();
        };
    }

    // ---- sidebar ----------------------------------------------------------------

    _wireSidebar() {
        for (const b of document.querySelectorAll('.side-tabs button')) {
            b.addEventListener('click', () => {
                for (const o of document.querySelectorAll('.side-tabs button')) o.classList.toggle('active', o === b);
                document.getElementById('properties').classList.toggle('hidden', b.dataset.side !== 'properties');
                document.getElementById('layers').classList.toggle('hidden', b.dataset.side !== 'layers');
            });
        }
    }

    _renderLayersPanel() {
        const root = document.getElementById('layers');
        root.replaceChildren(el('div', { class: 'prop-hint', text: 'Hide a layer to declutter the view (hidden layers don\'t print). Lock it so clicks pass through.' }));
        for (const layer of this.doc.layers) {
            const count = this.doc.scene.items.filter(i => i.layer_name === layer.name).length +
                (layer.name === 'Openings' ? this.doc.scene.walls().reduce((a, w) => a + w.openings.length, 0) : 0);
            root.appendChild(el('div', { class: 'layer-row' + (layer.visible ? '' : ' off') }, [
                el('button', {
                    class: 'layer-btn', type: 'button', title: layer.visible ? 'Hide' : 'Show',
                    onclick: () => { this.doc.setLayerVisible(layer.name, !layer.visible); },
                }, [eyeIcon(layer.visible)]),
                el('button', {
                    class: 'layer-btn' + (layer.locked ? ' on' : ''), type: 'button', title: layer.locked ? 'Unlock' : 'Lock',
                    onclick: () => { this.doc.setLayerLocked(layer.name, !layer.locked); },
                }, [lockIcon(layer.locked)]),
                el('span', { class: 'layer-swatch', style: `background:${layer.color}` }),
                el('span', { class: 'layer-name', text: layer.name }),
                el('span', { class: 'layer-count', text: count ? String(count) : '' }),
            ]));
        }
    }

    _renderTitle() {
        const s = this.doc.settings;
        document.getElementById('project-title').textContent =
            `${s.project_name || 'Untitled'} — ${s.drawing_title || 'Plan'}`;
        document.title = `${s.project_name || 'Untitled'} · Blueprint Studio`;
    }

    // ---- library (cabinets & fixtures) ---------------------------------------

    _wireLibrary() {
        const finish = document.getElementById('lib-finish');
        finish.replaceChildren(...FINISHES.map(f => el('option', { value: f, text: f })));
        finish.value = this.lib.finish;
        finish.addEventListener('change', () => {
            this.lib.finish = finish.value;
            this._renderLibrary();
            if (this.activeTool === this.tools.place && this.tools.place.entry && this.tools.place.entry.kind === 'cabinet') {
                this.tools.place.entry.finish = finish.value;
            }
        });
        const search = document.getElementById('lib-search');
        search.addEventListener('input', () => { this.lib.search = search.value.trim().toLowerCase(); this._renderLibrary(); });
        for (const b of document.querySelectorAll('.lib-tabs button')) {
            b.addEventListener('click', () => this.openLibrary(b.dataset.lib));
        }
        document.getElementById('lib-close').addEventListener('click', () => this.closeLibrary());
    }

    openLibrary(tab) {
        if (this.lib.tab !== tab) { this.lib.category = ''; }
        this.lib.tab = tab;
        document.getElementById('library').classList.remove('hidden');
        for (const b of document.querySelectorAll('.lib-tabs button')) b.classList.toggle('active', b.dataset.lib === tab);
        document.getElementById('lib-finish').classList.toggle('hidden', tab !== 'cabinets');
        document.getElementById('lib-foot').textContent = tab === 'cabinets'
            ? 'Click a cabinet, then click in the plan. It backs up to the nearest wall and butts against its neighbour. Orange numbers show the space left.'
            : 'Click an item, then click in the plan. R rotates, F flips, Shift places it without snapping.';
        this._renderLibrary();
        for (const btn of document.querySelectorAll('#toolrail .tool')) {
            if (btn.dataset.tool === 'cabinets' || btn.dataset.tool === 'fixtures') {
                btn.classList.toggle('open', btn.dataset.tool === tab);
            }
        }
        setTimeout(() => this.renderer.render(), 0);
    }

    closeLibrary() {
        document.getElementById('library').classList.add('hidden');
        for (const btn of document.querySelectorAll('#toolrail .tool')) btn.classList.remove('open');
        if (this.activeTool === this.tools.place) this.setTool('select');
        setTimeout(() => this.renderer.render(), 0);
    }

    _renderLibrary() {
        const chips = document.getElementById('lib-chips');
        const list = document.getElementById('lib-list');
        const tab = this.lib.tab;
        const cats = tab === 'cabinets' ? CATEGORIES : fixtureCategories();
        chips.replaceChildren(
            el('button', { class: 'chip' + (this.lib.category ? '' : ' active'), type: 'button', text: 'All',
                           onclick: () => { this.lib.category = ''; this._renderLibrary(); } }),
            ...cats.map(c => el('button', {
                class: 'chip' + (this.lib.category === c ? ' active' : ''), type: 'button',
                text: tab === 'cabinets' ? categoryLabel(c).replace(' cabinets', '') : c,
                onclick: () => { this.lib.category = c; this._renderLibrary(); },
            })));
        const q = this.lib.search;
        const groups = new Map();
        if (tab === 'cabinets') {
            for (const c of CATALOG) {
                if (this.lib.category && c.category !== this.lib.category) continue;
                if (q && !(`${c.model} ${c.description} ${categoryLabel(c.category)}`.toLowerCase().includes(q))) continue;
                const k = categoryLabel(c.category);
                if (!groups.has(k)) groups.set(k, []);
                groups.get(k).push({ kind: 'cabinet', spec: c, key: 'c:' + c.model });
            }
        } else {
            for (const f of fixtureLibrary()) {
                if (this.lib.category && f.category !== this.lib.category) continue;
                if (q && !(`${f.name} ${f.category} ${f.label}`.toLowerCase().includes(q))) continue;
                if (!groups.has(f.category)) groups.set(f.category, []);
                groups.get(f.category).push({ kind: 'fixture', spec: f, key: 'f:' + f.id });
            }
        }
        list.replaceChildren();
        if (!groups.size) list.appendChild(el('div', { class: 'prop-hint', text: 'Nothing matches that search.' }));
        for (const [title, entries] of groups) {
            list.appendChild(el('div', { class: 'lib-group', text: title }));
            for (const entry of entries) {
                const s = entry.spec;
                const avail = entry.kind !== 'cabinet' || isAvailable(s.model, this.lib.finish);
                const name = entry.kind === 'cabinet' ? s.model : s.name;
                const sub = entry.kind === 'cabinet'
                    ? `${s.width}" W · ${s.depth}" D · ${s.height}" H`
                    : `${s.width}" × ${s.depth}"`;
                const desc = entry.kind === 'cabinet' ? s.description : '';
                const item = el('button', {
                    class: 'lib-item' + (avail ? '' : ' na') + (this.lib.active === entry.key ? ' active' : ''),
                    type: 'button', 'data-key': entry.key,
                    title: avail ? `Place ${name}` : `${name} isn't made in ${this.lib.finish}`,
                    onclick: () => avail && this._pick(entry),
                }, [
                    libThumb(entry),
                    el('span', { class: 'lib-text' }, [
                        el('span', { class: 'lib-name', text: name }),
                        el('span', { class: 'lib-sub', text: avail ? sub : `Not made in ${this.lib.finish}` }),
                        desc ? el('span', { class: 'lib-desc', text: desc }) : null,
                    ]),
                ]);
                list.appendChild(item);
            }
        }
    }

    _pick(entry) {
        this.tools.place.setEntry({ ...entry, finish: this.lib.finish });
        this.setTool('place');
        this._markLibActive(entry.key);
        this.svg.focus();
    }

    _markLibActive(key) {
        this.lib.active = key;
        for (const b of document.querySelectorAll('.lib-item')) b.classList.toggle('active', b.dataset.key === key);
    }

    // ---- mouse & keyboard ---------------------------------------------------------

    _wireMouse() {
        const svg = this.svg;
        let panning = false, panLast = null, toolDrag = false;
        this._spaceDown = false;

        svg.addEventListener('mousedown', (e) => {
            svg.focus({ preventScroll: true });
            if (e.button === 1 || (e.button === 0 && (e.altKey || this._spaceDown))) {
                panning = true;
                panLast = { x: e.clientX, y: e.clientY };
                svg.classList.add('panning');
                e.preventDefault();
                return;
            }
            toolDrag = true;
            this.activeTool.mouseDown(this.renderer.screenToScene(e.clientX, e.clientY), e);
        });

        // Track moves on the window so drags that leave the canvas still finish.
        window.addEventListener('mousemove', (e) => {
            if (panning && panLast) {
                this.renderer.setView(this.renderer.panX + e.clientX - panLast.x,
                                      this.renderer.panY + e.clientY - panLast.y, this.renderer.zoom);
                panLast = { x: e.clientX, y: e.clientY };
                this.renderer._renderGrid();
                return;
            }
            const overCanvas = e.target === svg || svg.contains(e.target);
            if (!overCanvas && !toolDrag) return;
            const p = this.renderer.screenToScene(e.clientX, e.clientY);
            this.activeTool.mouseMove(p, e);
            if (overCanvas) this._updateCoords(p);
        });
        window.addEventListener('mouseup', (e) => {
            if (panning) {
                panning = false;
                svg.classList.remove('panning');
                return;
            }
            if (!toolDrag) return;
            toolDrag = false;
            this.activeTool.mouseUp(this.renderer.screenToScene(e.clientX, e.clientY), e);
        });
        svg.addEventListener('mouseleave', () => {
            if (this.activeTool === this.tools.place) this.renderer.setToolGhost(null);
        });

        svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.0025);
            const rect = svg.getBoundingClientRect();
            this._zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
        }, { passive: false });
        svg.addEventListener('contextmenu', e => e.preventDefault());
        svg.addEventListener('dblclick', e => e.preventDefault());
    }

    _wireKeyboard() {
        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space') { this._spaceDown = false; this.svg.classList.remove('pan-ready'); }
        });
        document.addEventListener('keydown', (e) => {
            if (ui.modalOpen()) return;
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            const ctrl = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();

            if (e.code === 'Space' && !ctrl) {
                this._spaceDown = true;
                this.svg.classList.add('pan-ready');
                e.preventDefault();
                return;
            }
            if (ctrl) {
                const map = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', s: e.shiftKey ? 'saveAs' : 'save',
                              o: 'open', a: 'selectAll', d: 'duplicate', p: 'exportPdf' };
                if (map[key]) { e.preventDefault(); this.run(map[key]); }
                return;
            }
            // Give the active tool first refusal (length entry, R/F while placing, nudges…)
            if (this.activeTool && this.activeTool.keyDown) {
                this.activeTool.keyDown(e);
                if (e.defaultPrevented) return;
            }
            if (e.key === 'Escape') {
                const wasPlacing = this.activeTool === this.tools.place;
                this.activeTool.cancel();
                if (wasPlacing || this.activeTool !== this.tools.select) this.setTool('select');
                document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
                e.preventDefault();
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') { this.deleteSelection(); e.preventDefault(); return; }
            if (e.key === 'F8') { this._toggleSetting('ortho_mode'); e.preventDefault(); return; }
            if (e.key === '+' || e.key === '=') { this.zoomBy(1.25); return; }
            if (e.key === '-' || e.key === '_') { this.zoomBy(1 / 1.25); return; }
            if (e.altKey) return;
            const tools = { v: 'select', w: 'wall', e: 'wallExt', d: 'door', n: 'window', m: 'dimension',
                            l: 'room', t: 'text', p: 'plot', b: 'plotBearing' };
            if (tools[key]) { this.setTool(tools[key]); e.preventDefault(); return; }
            if (key === 'c') { this.openLibrary('cabinets'); e.preventDefault(); return; }
            if (key === 'x') { this.openLibrary('fixtures'); e.preventDefault(); return; }
            if (key === 'f') { this.zoomFit(); e.preventDefault(); return; }
            if (key === 'r') { this.rotateSelection(); e.preventDefault(); }
        });
    }

    _updateCoords(p) {
        document.getElementById('coords').textContent = `${formatLength(p.x)}, ${formatLength(p.y)}`;
    }

    _updateStatus() {
        document.getElementById('tool-name').textContent = this.activeTool.name;
        document.getElementById('tool-hint').textContent = this.activeTool.hint;
        document.getElementById('mode-ortho').classList.toggle('on', !!this.doc.settings.ortho_mode);
        document.getElementById('mode-snap').classList.toggle('on', !!this.doc.settings.snap_to_grid);
        document.getElementById('mode-zoom').textContent = `${Math.round(this.renderer.zoom * 100)}%`;
    }

    // ---- view --------------------------------------------------------------------

    _centerView() {
        const rect = this.svg.getBoundingClientRect();
        const zoom = Math.max(0.2, (rect.width * 0.85) / (30 * 12));
        this.renderer.setView(rect.width / 2, rect.height / 2, zoom);
    }

    _zoomAt(cx, cy, factor) {
        const old = this.renderer.zoom;
        const z = Math.max(0.05, Math.min(60, old * factor));
        const sx = (cx - this.renderer.panX) / old, sy = (cy - this.renderer.panY) / old;
        this.renderer.setView(cx - sx * z, cy - sy * z, z);
        this.renderer.render();
        this._updateStatus();
    }

    zoomBy(factor) {
        const rect = this.svg.getBoundingClientRect();
        this._zoomAt(rect.width / 2, rect.height / 2, factor);
    }

    zoomFit() {
        const xs = [], ys = [];
        const add = (p) => { xs.push(p.x); ys.push(p.y); };
        for (const it of this.doc.scene.items) {
            if (it.kind === 'wall') { add(it.start); add(it.end); }
            else if (it.kind === 'dimension') { add(it.p1); add(it.p2); }
            else if (it.kind === 'plot') it.points.forEach(add);
            else if (isPlaced(it)) it.corners().forEach(add);
            else if (it.pos) add(it.pos);
        }
        if (!xs.length) { this._centerView(); this.renderer.render(); this._updateStatus(); return; }
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const margin = Math.max(x1 - x0, y1 - y0) * 0.08 + 30;
        const rect = this.svg.getBoundingClientRect();
        const zoom = Math.min(rect.width / (x1 - x0 + 2 * margin), rect.height / (y1 - y0 + 2 * margin));
        this.renderer.setView(rect.width / 2 - (x0 + x1) / 2 * zoom, rect.height / 2 - (y0 + y1) / 2 * zoom, zoom);
        this.renderer.render();
        this._updateStatus();
    }

    // ---- editing -------------------------------------------------------------------

    _selectedOpenings() {
        const out = [];
        for (const w of this.doc.scene.walls()) {
            for (const op of w.openings) if (this.doc.scene.selection.has(op.uid)) out.push({ wall: w, op });
        }
        return out;
    }

    deleteSelection() {
        const sel = this.doc.scene.selected();
        const openings = this._selectedOpenings();
        if (!sel.length && !openings.length) return;
        const cmds = [];
        if (sel.length) cmds.push(new RemoveItemsCommand(this.doc.scene, sel, ''));
        for (const { wall, op } of openings) cmds.push(new RemoveOpeningCommand(wall, op, ''));
        this.doc.push(new CompositeCommand(cmds, 'Delete'));
        this.doc.scene.setSelection([]);
    }

    rotateSelection() {
        const placed = this.doc.scene.selected().filter(isPlaced);
        if (!placed.length) { ui.toast('Select a cabinet or fixture to rotate.'); return; }
        this.doc.push(new CompositeCommand(
            placed.map(it => new RotateCabinetCommand(it, it.rotation + Math.PI / 2)), 'Rotate'));
    }

    duplicateSelection() {
        const sel = this.doc.scene.selected();
        if (!sel.length) return;
        const copies = sel.map(it => {
            const d = it.toDict();
            delete d.uid;
            if (d.openings) d.openings = d.openings.map(o => { const c = { ...o }; delete c.uid; return c; });
            const copy = itemFromDict(d);
            // Placed items step over by their own width so a run can be built by repeating Ctrl+D.
            if (isPlaced(copy)) copy.pos = it.toWorld(it.width, 0);
            else if (copy.kind === 'wall') { copy.start.x += 24; copy.start.y += 24; copy.end.x += 24; copy.end.y += 24; }
            else if (copy.kind === 'dimension') { copy.p1.x += 24; copy.p1.y += 24; copy.p2.x += 24; copy.p2.y += 24; }
            else if (copy.kind === 'plot') copy.points = copy.points.map(p => ({ x: p.x + 24, y: p.y + 24 }));
            else if (copy.pos) copy.pos = { x: copy.pos.x + 24, y: copy.pos.y + 24 };
            return copy;
        });
        this.doc.push(new AddItemsCommand(this.doc.scene, copies, 'Duplicate'));
        this.doc.scene.setSelection(copies);
    }

    // ---- files -----------------------------------------------------------------

    async fileNew() {
        if (this.doc.modified && this.doc.scene.items.length) {
            const ok = await ui.confirm('New drawing', 'Discard the unsaved changes in this drawing?',
                                        { okLabel: 'Discard', danger: true });
            if (!ok) return;
        }
        await this.cloud.release();
        this.loadProject({ version: 1, settings: {}, layers: [], items: [] });
        this._centerView();
        this.renderer.render();
        try { localStorage.removeItem(this._autosaveKey()); } catch (e) { /* ignore */ }
    }

    fileImport() {
        const inp = el('input', { type: 'file', accept: '.bpsj,.json,application/json' });
        inp.addEventListener('change', () => {
            const file = inp.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
                let d;
                try { d = JSON.parse(reader.result); } catch (e) {
                    ui.alert('Could not open file', 'That file isn\'t a Blueprint Studio drawing (.bpsj).');
                    return;
                }
                if (!d || !Array.isArray(d.items)) {
                    ui.alert('Could not open file', 'That file isn\'t a Blueprint Studio drawing (.bpsj).');
                    return;
                }
                if (this.doc.modified && this.doc.scene.items.length) {
                    const ok = await ui.confirm('Open file', 'Discard the unsaved changes in this drawing?',
                                                { okLabel: 'Discard', danger: true });
                    if (!ok) return;
                }
                await this.cloud.release();
                this.loadProject(d);
                this.doc.modified = true;
                this.cloud.refresh();
                ui.toast(`Opened ${file.name} — use File ▸ Save to put it on the server.`);
            };
            reader.readAsText(file);
        });
        inp.click();
    }

    fileDownload() {
        const name = (this.doc.settings.project_name || 'project').replace(/[^\w\-]+/g, '_');
        ui.download(name + '.bpsj', new Blob([JSON.stringify(this.doc.toDict(), null, 1)], { type: 'application/json' }));
    }

    // ---- PDF --------------------------------------------------------------------

    async exportPdf() {
        const elevations = buildAllElevations(this.doc.scene);
        const bom = computeBOM(this.doc.scene);
        const hasCabs = bom.cabinetCount > 0 || bom.fixtures.length > 0;
        const last = this._pdfPrefs || { page_size: 'Letter', landscape: true, fit: false,
                                         elev: true, list: true, prices: false };
        const fields = [
            { name: 'page_size', label: 'Sheet size', type: 'select', value: last.page_size,
              options: PAGE_SIZES.map(([v, l]) => ({ value: v, label: l })) },
            { name: 'landscape', label: 'Landscape', type: 'checkbox', value: last.landscape },
            { name: 'fit', label: 'Shrink plan to fit the sheet (scale bar adjusts)', type: 'checkbox', value: last.fit },
        ];
        if (elevations.length) fields.push({ name: 'elev', label: `Include cabinet elevations (${elevations.length})`, type: 'checkbox', value: last.elev });
        if (hasCabs) {
            fields.push({ name: 'list', label: 'Include cabinet & appliance list', type: 'checkbox', value: last.list });
            fields.push({ name: 'prices', label: 'Show catalog list prices on the cabinet list', type: 'checkbox', value: last.prices });
        }
        const r = await ui.form('Export PDF', fields, {
            okLabel: 'Export',
            note: `The plan prints at ${this.doc.settings.print_scale_label} so a scale rule on the paper matches real dimensions. If it doesn't fit, pick a bigger sheet or a smaller scale (top bar).`,
        });
        if (!r) return;
        this._pdfPrefs = { ...last, ...r };
        ui.toast('Building PDF…');
        try {
            const res = await ui.api('api/export-pdf', {
                method: 'POST', raw: true,
                body: {
                    project: this.doc.toDict(),
                    page_size: r.page_size, landscape: r.landscape, margins_in: 0.25,
                    fit_to_page: r.fit,
                    elevations: r.elev && elevations.length ? elevations : [],
                    cabinet_list: hasCabs && r.list ? { include: true, prices: !!r.prices } : { include: false },
                },
            });
            if (res.status === 401) { window.location.href = 'login'; return; }
            if (!res.ok) {
                let msg = `Server said ${res.status}`;
                try { msg = (await res.json()).error || msg; } catch (e) { /* not json */ }
                ui.alert('PDF export failed', msg);
                return;
            }
            const blob = await res.blob();
            const safe = (this.doc.settings.project_name + ' ' + this.doc.settings.drawing_title)
                .replace(/[^\w\- ]+/g, '_').trim() || 'blueprint';
            ui.download(safe + '.pdf', blob);
            ui.toast('PDF ready', 'ok');
        } catch (e) {
            ui.alert('PDF export failed', e.message);
        }
    }

    // ---- kitchen views --------------------------------------------------------------

    showElevations() {
        const elevs = buildAllElevations(this.doc.scene);
        const content = el('div', { class: 'elev-list' });
        if (!elevs.length) {
            content.appendChild(el('div', { class: 'empty', text: 'Place some cabinets against a wall first — each wall run gets its own elevation.' }));
        }
        for (const e of elevs) {
            content.appendChild(el('div', { class: 'elev-card' }, [
                el('div', { class: 'elev-title' }, [
                    el('b', { text: e.title }),
                    el('span', { text: ` · ${formatLength(e.width)} of cabinets` }),
                ]),
                elevationToSVG(e, Math.max(2, Math.min(5, 1080 / (e.bounds.x1 - e.bounds.x0)))),
            ]));
        }
        ui.panel('Cabinet elevations', content, [
            { label: 'Export PDF…', value: 'pdf' },
            { label: 'Close', primary: true, value: true },
        ], { cls: 'xwide' }).then(v => { if (v === 'pdf') this.exportPdf(); });
    }

    showCabinetList() {
        const bom = computeBOM(this.doc.scene);
        const content = el('div', { class: 'bom' });
        const render = () => {
            content.replaceChildren();
            const toggle = el('label', { class: 'form-check' }, [
                el('input', { type: 'checkbox', checked: this.showPrices, onchange: (e) => { this.showPrices = e.target.checked; render(); } }),
                ' Show catalog list prices',
            ]);
            content.appendChild(toggle);
            if (!bom.cabinetCount && !bom.fixtures.length) {
                content.appendChild(el('div', { class: 'empty', text: 'No cabinets or fixtures in this drawing yet.' }));
                return;
            }
            const table = el('table', { class: 'bom-table' });
            const head = ['Qty', 'Model', 'Description', 'Size W×D×H', 'Hinge'];
            if (this.showPrices) head.push('List each', 'List ext.');
            table.appendChild(el('thead', {}, [el('tr', {}, head.map((h, i) =>
                el('th', { class: i === 0 || i >= 5 ? 'num' : '', text: h })))]));
            const tb = el('tbody');
            for (const g of bom.groups) {
                tb.appendChild(el('tr', { class: 'group' }, [el('td', { colspan: head.length, text: `${g.finish} — ${g.quantity} piece${g.quantity === 1 ? '' : 's'}` })]));
                for (const l of g.lines) {
                    const cells = [
                        el('td', { class: 'num', text: String(l.quantity) }),
                        el('td', { class: 'model', text: l.model }),
                        el('td', { text: l.description }),
                        el('td', { text: sizeText(l) }),
                        el('td', { text: hingeText(l) }),
                    ];
                    if (this.showPrices) {
                        cells.push(el('td', { class: 'num', text: formatUSD(l.unit_price) }));
                        cells.push(el('td', { class: 'num', text: formatUSD(l.extended) }));
                    }
                    tb.appendChild(el('tr', {}, cells));
                }
            }
            if (this.showPrices && bom.groups.length) {
                tb.appendChild(el('tr', { class: 'total' }, [
                    el('td', { class: 'num', text: String(bom.grandQuantity) }),
                    el('td', { colspan: 5, text: 'Total at catalog list price' }),
                    el('td', { class: 'num', text: formatUSD(bom.grandTotal) }),
                ]));
            }
            table.appendChild(tb);
            content.appendChild(table);
            if (bom.fillerCut.length) {
                content.appendChild(el('div', { class: 'prop-hint', text:
                    'Fillers to cut on site: ' + bom.fillerCut.map(f => formatLength(f.width)).join(', ') + '.' }));
            }
            if (bom.fixtures.length) {
                content.appendChild(el('h4', { text: 'Appliances & fixtures' }));
                const ft = el('table', { class: 'bom-table' });
                ft.appendChild(el('tbody', {}, bom.fixtures.map(f => el('tr', {}, [
                    el('td', { class: 'num', text: String(f.quantity) }),
                    el('td', { text: f.name }),
                    el('td', { text: `${f.size}"` }),
                ]))));
                content.appendChild(ft);
            }
        };
        render();
        ui.panel('Cabinet list', content, [
            { label: 'Download CSV', value: 'csv' },
            { label: 'Print', value: 'print' },
            { label: 'Close', primary: true, value: true },
        ]).then(v => {
            if (v === 'csv') {
                ui.download(`${(this.doc.settings.project_name || 'cabinets').replace(/[^\w\- ]+/g, '_')} cabinet list.csv`,
                    new Blob([bomToCSV(bom, { prices: this.showPrices })], { type: 'text/csv' }));
            } else if (v === 'print') {
                const w = window.open('', '_blank');
                if (!w) { ui.toast('Allow pop-ups to print the list.', 'warn'); return; }
                w.document.write(`<!doctype html><title>Cabinet list</title><style>
                    body{font:12px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:24px;color:#111}
                    h2{margin:0 0 4px}table{border-collapse:collapse;width:100%;margin:10px 0}
                    td,th{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left}
                    .num{text-align:right}.group td{background:#f2f2f2;font-weight:700}
                    label{display:none}</style>
                    <h2>${escapeHtml(this.doc.settings.project_name)} — cabinet list</h2>
                    <div>${escapeHtml(this.doc.settings.project_address || '')}</div>${content.innerHTML}`);
                w.document.close();
                w.focus();
                w.print();
            }
        });
    }

    // ---- autosave ------------------------------------------------------------------

    _autosaveKey() {
        const u = this.cloud && this.cloud.user ? this.cloud.user.username : 'anon';
        return `blueprint_studio_autosave_v2:${u}`;
    }

    _scheduleAutosave() {
        clearTimeout(this._autosaveTimer);
        this._autosaveTimer = setTimeout(() => {
            try {
                localStorage.setItem(this._autosaveKey(), JSON.stringify({
                    project: this.doc.toDict(), modified: this.doc.modified, saved_at: Date.now(),
                    file: this.cloud.openFile,
                }));
            } catch (e) { /* storage full or blocked */ }
        }, 800);
    }

    _loadAutosave() {
        if (!this.cloud.user) return;
        try {
            let d = null;
            const raw = localStorage.getItem(this._autosaveKey());
            if (raw) d = JSON.parse(raw);
            if (!d) {
                // One-time pickup of the pre-2.0 browser autosave.
                const old = localStorage.getItem('blueprint_studio_autosave_v1');
                if (old) {
                    d = { project: JSON.parse(old), modified: true };
                    localStorage.removeItem('blueprint_studio_autosave_v1');
                }
            }
            if (d && d.project && Array.isArray(d.project.items) && d.project.items.length) {
                this.loadProject(d.project);
                this.doc.modified = !!d.modified;
                if (d.file && d.file.filename) this.cloud.resume(d.file);
                this.cloud.refresh();
                if (d.modified) ui.toast('Restored your last drawing from this browser.');
            }
        } catch (e) {
            console.warn('Autosave restore failed:', e);
        }
    }
}

// ---- little helpers -------------------------------------------------------------

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
}
function eyeIcon(on) {
    const s = svgEl('svg', { viewBox: '0 0 20 20' });
    s.appendChild(svgEl('path', { d: 'M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z' }));
    if (on) s.appendChild(svgEl('circle', { cx: 10, cy: 10, r: 2.5 }));
    else s.appendChild(svgEl('path', { d: 'M4 16 16 4' }));
    return s;
}
function lockIcon(locked) {
    const s = svgEl('svg', { viewBox: '0 0 20 20' });
    s.appendChild(svgEl('rect', { x: 4.5, y: 9, width: 11, height: 8, rx: 1.5 }));
    s.appendChild(svgEl('path', { d: locked ? 'M7 9V6.5a3 3 0 0 1 6 0V9' : 'M7 9V6.5a3 3 0 0 1 5.8-1' }));
    return s;
}

// Tiny plan-view thumbnail for a library entry, drawn to scale.
function libThumb(entry) {
    const s = entry.spec;
    const box = 34;
    const W = s.width, D = s.depth;
    const k = Math.min(box / Math.max(W, D, 24), 1.1);
    const svg = svgEl('svg', { viewBox: `0 0 ${box} ${box}`, class: 'lib-thumb' });
    const w = W * k, d = D * k, x = (box - w) / 2, y = (box - d) / 2;
    if (entry.kind === 'cabinet') {
        if (s.shape === 'L') {
            const leg = 24 * k;
            svg.appendChild(svgEl('polygon', { points: `${x},${y} ${x + w},${y} ${x + w},${y + leg} ${x + leg},${y + leg} ${x + leg},${y + d} ${x},${y + d}`, class: 'cab' }));
        } else if (s.shape === 'angle') {
            const leg = 12 * k;
            svg.appendChild(svgEl('polygon', { points: `${x},${y} ${x + w},${y} ${x + w},${y + leg} ${x + leg},${y + d} ${x},${y + d}`, class: 'cab upper' }));
        } else {
            const upper = s.category === 'wall';
            svg.appendChild(svgEl('rect', { x, y, width: w, height: d, class: 'cab' + (upper ? ' upper' : '') + (s.filler ? ' filler' : '') }));
            if (!s.filler) svg.appendChild(svgEl('line', { x1: x + 1, y1: y + d, x2: x + w - 1, y2: y + d, class: 'front' }));
        }
    } else {
        svg.appendChild(svgEl('rect', { x, y, width: w, height: d, class: 'fx-bg' }));
        const g = svgEl('g', { transform: `translate(${box / 2},${box / 2}) scale(${k})`, class: 'fx' });
        for (const p of primsToPaths(s.plan, W, D, 'plan')) {
            g.appendChild(svgEl(p.closed ? 'polygon' : 'polyline', {
                points: p.pts.map(q => q.join(',')).join(' '),
                'stroke-dasharray': p.dash ? '3 2' : '',
            }));
        }
        svg.appendChild(g);
    }
    return svg;
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
