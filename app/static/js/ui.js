// Small UI kit: modal forms, confirmations, toasts, and a fetch wrapper.
//
// Replaces the browser's prompt()/alert()/confirm(), which block the page,
// can't be styled, and get suppressed by some browsers after a few uses.

// ---- Server calls -----------------------------------------------------------
//
// Every URL is relative to the page's <base href>, which the server sets to
// the app's mount point. That lets the app live at https://host/ or at
// https://host/blueprints/ behind a reverse proxy without code changes.

export async function api(path, { method = 'GET', body, raw = false } = {}) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(path.replace(/^\//, ''), opts);
    if (raw) return res;
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401 && !path.includes('login')) {
        window.location.href = 'login';
        throw new Error('Signed out');
    }
    return { ok: res.ok, status: res.status, data: data || {} };
}

export function apiUrl(path) { return path.replace(/^\//, ''); }

// ---- Modal plumbing -----------------------------------------------------------

let _openCount = 0;
export function modalOpen() { return _openCount > 0 || !!document.querySelector('.dialog:not(.hidden)'); }

function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
}
export { el };

function openModal(title, body, buttons, { wide = false, onKey, onOpen, cls } = {}) {
    return new Promise((resolve) => {
        _openCount++;
        const card = el('div', { class: 'dialog-card' + (wide ? ' wide' : '') + (cls ? ' ' + cls : '') });
        const overlay = el('div', { class: 'dialog modal-dynamic' }, [card]);
        card.appendChild(el('h3', { text: title }));
        card.appendChild(body);
        const actions = el('div', { class: 'dialog-actions' });
        const close = (val) => {
            _openCount--;
            overlay.remove();
            document.removeEventListener('keydown', keyHandler, true);
            resolve(val);
        };
        for (const b of buttons) {
            actions.appendChild(el('button', {
                class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
                type: 'button', text: b.label,
                onclick: () => {
                    const v = b.value instanceof Function ? b.value() : b.value;
                    if (v === undefined) return;   // validator kept dialog open
                    close(v);
                },
            }));
        }
        card.appendChild(actions);
        const keyHandler = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
            else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA')) {
                const primary = buttons.find(b => b.primary);
                if (primary) {
                    e.preventDefault(); e.stopPropagation();
                    const v = primary.value instanceof Function ? primary.value() : primary.value;
                    if (v !== undefined) close(v);
                }
            } else if (onKey) onKey(e);
        };
        document.addEventListener('keydown', keyHandler, true);
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
        document.body.appendChild(overlay);
        if (onOpen) onOpen(() => close(null));
        const first = card.querySelector('input, select, textarea, button.primary');
        if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 0);
    });
}

/**
 * Show a form. fields: [{ name, label, type:'text'|'number'|'password'|'select'|'checkbox',
 *                         value, options:[{value,label}], hint, placeholder }]
 * Resolves to an object of values, or null if cancelled.
 * `validate(values)` may return an error string to keep the dialog open.
 */
export function form(title, fields, { okLabel = 'OK', cancelLabel = 'Cancel', note, validate, wide } = {}) {
    const body = el('div', { class: 'form' });
    if (note) body.appendChild(el('p', { class: 'dialog-hint', text: note }));
    const inputs = {};
    for (const f of fields) {
        let input;
        if (f.type === 'select') {
            input = el('select', { class: 'input', name: f.name });
            for (const o of f.options) {
                const opt = el('option', { value: o.value, text: o.label });
                if (String(o.value) === String(f.value)) opt.selected = true;
                input.appendChild(opt);
            }
        } else if (f.type === 'checkbox') {
            input = el('input', { type: 'checkbox', name: f.name });
            input.checked = !!f.value;
        } else {
            input = el('input', {
                class: 'input', name: f.name, type: f.type || 'text',
                placeholder: f.placeholder, autocomplete: f.autocomplete || 'off',
            });
            input.value = f.value ?? '';
        }
        inputs[f.name] = input;
        const row = f.type === 'checkbox'
            ? el('label', { class: 'form-check' }, [input, ' ' + f.label])
            : el('label', { class: 'form-row' }, [el('span', { text: f.label }), input]);
        body.appendChild(row);
        if (f.hint) body.appendChild(el('div', { class: 'form-hint', text: f.hint }));
    }
    const err = el('div', { class: 'dialog-error' });
    body.appendChild(err);
    const read = () => {
        const out = {};
        for (const f of fields) {
            const i = inputs[f.name];
            out[f.name] = f.type === 'checkbox' ? i.checked
                : f.type === 'number' ? parseFloat(i.value) : i.value;
        }
        if (validate) {
            const msg = validate(out);
            if (msg) { err.textContent = msg; return undefined; }
        }
        return out;
    };
    return openModal(title, body, [
        { label: cancelLabel, value: null },
        { label: okLabel, primary: true, value: read },
    ], { wide });
}

export async function ask(title, label, value = '', opts = {}) {
    const r = await form(title, [{ name: 'v', label, value, placeholder: opts.placeholder }], opts);
    return r ? r.v : null;
}

export function confirm(title, message, { okLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
    const body = el('p', { class: 'dialog-text', text: message });
    return openModal(title, body, [
        { label: cancelLabel, value: false },
        { label: okLabel, primary: !danger, danger, value: true },
    ]);
}

/** Choose between several actions. buttons: [{label, value, primary}] */
export function choose(title, message, buttons) {
    const body = el('p', { class: 'dialog-text', text: message });
    return openModal(title, body, buttons);
}

export function alert(title, message) {
    const body = el('p', { class: 'dialog-text', text: message });
    return openModal(title, body, [{ label: 'OK', primary: true, value: true }]);
}

/** A modal showing arbitrary content. Resolves when closed. */
export function panel(title, content, buttons = [{ label: 'Close', primary: true, value: true }], opts = {}) {
    return openModal(title, content, buttons, { wide: true, ...opts });
}

let _toastTimer = null;
export function toast(text, kind = 'info') {
    let t = document.getElementById('toast');
    if (!t) {
        t = el('div', { id: 'toast' });
        document.body.appendChild(t);
    }
    t.textContent = text;
    t.className = 'show ' + kind;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { t.className = ''; }, 2600);
}

export function download(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
