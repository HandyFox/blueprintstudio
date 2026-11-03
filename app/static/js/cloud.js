// Server storage + accounts.
//
// Talks to the backend's auth and storage routes: the open/save dialogs for
// My Files and the shared Team folder, edit locks (one editor at a time,
// others can open read-only or take over), the change-password dialog and
// the admin's user manager.
//
//   const cloud = new Cloud(app);
//   await cloud.boot();
//   cloud.openDialog();  cloud.saveCurrent();  cloud.saveAsDialog();
//   cloud.changePasswordDialog();  cloud.adminUsersDialog();  cloud.logout();

import * as ui from './ui.js';
import { el } from './ui.js';

const HEARTBEAT_INTERVAL_MS = 60_000;   // server lock TTL is 5 min

const fileUrl = (scope, name, action = '') =>
    `api/projects/${scope}/${encodeURIComponent(name)}${action ? '/' + action : ''}`;

export class Cloud {
    constructor(app) {
        this.app = app;
        this.user = null;          // { username, is_admin }
        this.openFile = null;      // { scope: 'me'|'team', filename, readOnly }
        this._heartbeatTimer = null;
    }

    async boot() {
        try {
            const r = await ui.api('api/me');
            this.user = r.data.user || null;
        } catch (e) {
            this.user = null;
        }
        if (!this.user) {
            window.location.href = 'login';
            return;
        }
        this.refresh();
    }

    // ---- Status shown in the top bar ------------------------------------------

    refresh() {
        const user = document.getElementById('user-name');
        if (user && this.user) user.textContent = this.user.username;
        const admin = document.getElementById('menu-manage-users');
        if (admin) admin.classList.toggle('hidden', !(this.user && this.user.is_admin));
        const chip = document.getElementById('file-status');
        if (!chip) return;
        chip.className = 'file-status';
        if (!this.openFile) {
            chip.textContent = 'Not saved to the server';
            chip.title = 'File ▸ Save to save this drawing to My Files or the Team folder';
            chip.classList.add('local');
        } else {
            const folder = this.openFile.scope === 'team' ? 'Team' : 'My Files';
            chip.textContent = `${folder} / ${this.openFile.filename}` +
                (this.openFile.readOnly ? ' · read-only' : (this.app.doc.modified ? ' · unsaved changes' : ''));
            chip.title = this.openFile.readOnly
                ? 'Someone else is editing this file. Use File ▸ Save as… to keep your own copy.'
                : 'You are editing this shared file';
            if (this.openFile.readOnly) chip.classList.add('readonly');
            else if (this.app.doc.modified) chip.classList.add('dirty');
        }
    }

    async logout() {
        await this.release();
        await ui.api('api/logout', { method: 'POST' });
        window.location.href = 'login';
    }

    // ---- Open ---------------------------------------------------------------

    async openDialog() {
        const list = el('div', { class: 'proj-list' }, [el('div', { class: 'prop-hint', text: 'Loading…' })]);
        const content = el('div', {}, [list]);
        const load = async () => {
            const r = await ui.api('api/projects');
            if (!r.ok) {
                list.replaceChildren(el('div', { class: 'dialog-error', text: r.data.error || 'Could not list files' }));
                return;
            }
            this._renderProjectList(list, r.data, async (scope, fname, lockedBy) => {
                closeFn();
                await this._open(scope, fname, lockedBy);
            }, load);
        };
        let closeFn = () => {};
        const done = ui.panel('Open from server', content, [
            { label: 'Cancel', value: null },
        ], { onOpen: (close) => { closeFn = close; } });
        load();
        await done;
    }

    _renderProjectList(listEl, listing, onOpen, reload) {
        listEl.replaceChildren();
        const sections = [
            { label: 'My Files', scope: 'me', files: listing.mine || [] },
            { label: 'Team (shared with everyone)', scope: 'team', files: listing.team || [] },
        ];
        for (const s of sections) {
            listEl.appendChild(el('h4', { text: s.label }));
            if (!s.files.length) {
                listEl.appendChild(el('div', { class: 'prop-hint', text: 'No files yet.' }));
                continue;
            }
            for (const f of s.files) {
                const locked = f.locked_by && f.locked_fresh && f.locked_by !== this.user.username;
                const when = new Date(f.modified_ts * 1000).toLocaleString();
                const row = el('div', { class: 'proj-row' + (locked ? ' locked' : '') }, [
                    el('div', { class: 'proj-main' }, [
                        el('div', { class: 'proj-name', text: f.filename }),
                        el('div', { class: 'proj-meta', text: locked ? `${when} · being edited by ${f.locked_by}` : when }),
                    ]),
                    el('button', { class: 'btn primary small', type: 'button', text: 'Open',
                        onclick: () => onOpen(s.scope, f.filename, locked ? f.locked_by : null) }),
                    el('button', { class: 'btn small danger-ghost', type: 'button', text: 'Delete',
                        onclick: async () => {
                            const ok = await ui.confirm('Delete file', `Delete "${f.filename}" from ${s.label}? This can't be undone.`,
                                                        { okLabel: 'Delete', danger: true });
                            if (!ok) return;
                            const r = await ui.api(fileUrl(s.scope, f.filename), { method: 'DELETE' });
                            if (!r.ok) ui.toast(r.data.error || 'Delete failed', 'error');
                            else {
                                if (this.openFile && this.openFile.scope === s.scope && this.openFile.filename === f.filename) {
                                    this.openFile = null; this._stopHeartbeat(); this.refresh();
                                }
                                reload();
                            }
                        } }),
                ]);
                listEl.appendChild(row);
            }
        }
    }

    async _open(scope, filename, lockedBy) {
        if (this.app.doc.modified && !await this._discardOk()) return;
        if (lockedBy) {
            const choice = await ui.choose('File in use',
                `${lockedBy} is editing "${filename}" right now. You can look at it read-only, ` +
                `or take over editing (their copy becomes read-only).`, [
                    { label: 'Cancel', value: null },
                    { label: 'Open read-only', value: 'ro' },
                    { label: 'Take over editing', value: 'steal', primary: true },
                ]);
            if (!choice) return;
            if (choice === 'ro') return this._loadFile(scope, filename, true);
            const r = await ui.api(fileUrl(scope, filename, 'steal'), { method: 'POST' });
            if (!r.ok) { ui.toast('Could not take over the file.', 'error'); return; }
        } else {
            const r = await ui.api(fileUrl(scope, filename, 'heartbeat'), { method: 'POST' });
            if (r.ok && r.data.ok === false && r.data.owner) {
                return this._open(scope, filename, r.data.owner);
            }
        }
        await this._loadFile(scope, filename, false);
    }

    async _loadFile(scope, filename, readOnly) {
        const r = await ui.api(fileUrl(scope, filename));
        if (!r.ok) { ui.alert('Could not open', r.data.error || 'Open failed'); return; }
        // Release the lock on the PREVIOUS file — but not if it's the one we
        // just opened, or we'd drop the lock we just took.
        const prev = this.openFile;
        if (prev && !prev.readOnly && !(prev.scope === scope && prev.filename === filename)) {
            ui.api(fileUrl(prev.scope, prev.filename, 'release'), { method: 'POST' }).catch(() => {});
        }
        this.app.loadProject(r.data.project);
        this.openFile = { scope, filename, readOnly: !!readOnly };
        this.refresh();
        if (!readOnly) this._startHeartbeat();
        else this._stopHeartbeat();
        ui.toast(readOnly ? `Opened ${filename} (read-only)` : `Opened ${filename}`);
    }

    async _discardOk() {
        return ui.confirm('Unsaved changes', 'The current drawing has unsaved changes. Discard them?',
                          { okLabel: 'Discard changes', danger: true });
    }

    /** After a page reload: pick the server file we were editing back up. */
    async resume(file) {
        this.openFile = { scope: file.scope, filename: file.filename, readOnly: true };
        if (!file.readOnly) {
            try {
                const r = await ui.api(fileUrl(file.scope, file.filename, 'heartbeat'), { method: 'POST' });
                if (r.ok && r.data.ok !== false) {
                    this.openFile.readOnly = false;
                    this._startHeartbeat();
                }
            } catch (e) { /* stay read-only */ }
        }
        this.refresh();
    }

    // ---- Save ---------------------------------------------------------------

    async saveCurrent() {
        if (!this.openFile || this.openFile.readOnly) return this.saveAsDialog();
        return this._save(this.openFile.scope, this.openFile.filename);
    }

    async saveAsDialog() {
        let suggested = (this.openFile && this.openFile.filename) ||
            (this.app.doc.settings.project_name || 'project').replace(/[^\w\-. ]+/g, '_').trim() || 'project';
        if (!suggested.toLowerCase().endsWith('.bpsj')) suggested += '.bpsj';
        if (this.openFile && this.openFile.readOnly) suggested = suggested.replace(/\.bpsj$/i, ' (copy).bpsj');
        const r = await ui.form('Save to server', [
            { name: 'scope', label: 'Folder', type: 'select',
              value: this.openFile && this.openFile.scope === 'team' ? 'team' : 'me',
              options: [{ value: 'me', label: 'My Files (only you)' },
                        { value: 'team', label: 'Team (everyone can open it)' }] },
            { name: 'filename', label: 'File name', value: suggested },
        ], {
            okLabel: 'Save',
            validate: (v) => {
                const n = v.filename.trim();
                if (!n) return 'Enter a file name.';
                if (!/^[\w\-. ]{1,80}$/.test(n.replace(/\.bpsj$/i, '') + '.bpsj')) return 'Use letters, numbers, spaces, - _ and . only.';
                return null;
            },
        });
        if (!r) return false;
        let fn = r.filename.trim();
        if (!fn.toLowerCase().endsWith('.bpsj')) fn += '.bpsj';
        return this._save(r.scope, fn);
    }

    async _save(scope, filename, force = false) {
        let r;
        try {
            r = await ui.api(fileUrl(scope, filename), {
                method: 'POST', body: { project: this.app.doc.toDict(), force },
            });
        } catch (e) {
            ui.alert('Save failed', e.message);
            return false;
        }
        if (r.status === 409 && r.data.locked_by) {
            const ok = await ui.confirm('File in use',
                `${r.data.locked_by} is editing "${filename}". Save over their version and take over editing?`,
                { okLabel: 'Save anyway', danger: true });
            if (!ok) return false;
            return this._save(scope, filename, true);
        }
        if (!r.ok) {
            ui.alert('Save failed', r.data.error || `Server said ${r.status}`);
            return false;
        }
        const prev = this.openFile;
        if (prev && !prev.readOnly && !(prev.scope === scope && prev.filename === filename)) {
            ui.api(fileUrl(prev.scope, prev.filename, 'release'), { method: 'POST' }).catch(() => {});
        }
        this.openFile = { scope, filename, readOnly: false };
        this.app.doc.modified = false;
        this.app.onSaved();
        this.refresh();
        this._startHeartbeat();
        ui.toast(`Saved to ${scope === 'team' ? 'Team' : 'My Files'} / ${filename}`, 'ok');
        return true;
    }

    /** Release our lock (e.g. File ▸ New). */
    async release() {
        const f = this.openFile;
        this._stopHeartbeat();
        this.openFile = null;
        this.refresh();
        if (f && !f.readOnly) {
            try { await ui.api(fileUrl(f.scope, f.filename, 'release'), { method: 'POST' }); } catch (e) { /* ignore */ }
        }
    }

    releaseOnUnload() {
        const f = this.openFile;
        if (!f || f.readOnly) return;
        const url = fileUrl(f.scope, f.filename, 'release');
        try {
            if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([], { type: 'application/json' }));
            else fetch(url, { method: 'POST', credentials: 'same-origin', keepalive: true });
        } catch (e) { /* ignore */ }
    }

    // ---- Heartbeat ------------------------------------------------------------

    _startHeartbeat() {
        this._stopHeartbeat();
        if (!this.openFile || this.openFile.readOnly) return;
        this._heartbeatTimer = setInterval(async () => {
            const f = this.openFile;
            if (!f || f.readOnly) { this._stopHeartbeat(); return; }
            try {
                const r = await ui.api(fileUrl(f.scope, f.filename, 'heartbeat'), { method: 'POST' });
                if (r.ok && r.data.ok === false && r.data.owner) {
                    f.readOnly = true;
                    this._stopHeartbeat();
                    this.refresh();
                    ui.alert('Editing taken over',
                        `${r.data.owner} has taken over editing "${f.filename}". Your copy is now read-only — ` +
                        `use File ▸ Save as… to keep your changes as a separate file.`);
                }
            } catch (e) { /* transient network error: try again next tick */ }
        }, HEARTBEAT_INTERVAL_MS);
    }

    _stopHeartbeat() {
        if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
    }

    // ---- Account ---------------------------------------------------------------

    async changePasswordDialog() {
        const r = await ui.form('Change password', [
            { name: 'current', label: 'Current password', type: 'password', autocomplete: 'current-password' },
            { name: 'new', label: 'New password', type: 'password', autocomplete: 'new-password' },
            { name: 'again', label: 'New password again', type: 'password', autocomplete: 'new-password' },
        ], {
            okLabel: 'Change password',
            validate: (v) => {
                if (!v.current || !v.new) return 'Fill in both passwords.';
                if (v.new.length < 4) return 'Use at least 4 characters.';
                if (v.new !== v.again) return "The new passwords don't match.";
                return null;
            },
        });
        if (!r) return;
        const res = await ui.api('api/account/password', { method: 'POST', body: { current: r.current, new: r.new } });
        if (!res.ok) ui.alert('Password not changed', res.data.error || 'Failed');
        else ui.toast('Password changed', 'ok');
    }

    async adminUsersDialog() {
        if (!this.user || !this.user.is_admin) return;
        const list = el('div', { class: 'users-list' });
        const err = el('div', { class: 'dialog-error' });
        const uIn = el('input', { class: 'input', placeholder: 'Username', autocomplete: 'off' });
        const pIn = el('input', { class: 'input', placeholder: 'Temporary password', autocomplete: 'new-password' });
        const aIn = el('input', { type: 'checkbox' });
        const create = el('button', { class: 'btn primary small', type: 'button', text: 'Add user' });
        const content = el('div', {}, [
            list,
            el('h4', { text: 'Add a user' }),
            el('div', { class: 'user-create' }, [uIn, pIn,
                el('label', { class: 'form-check' }, [aIn, ' Admin']), create]),
            err,
            el('p', { class: 'dialog-hint', text: 'Usernames are 2–32 letters, numbers, - or _. Ask new users to change their password after signing in.' }),
        ]);
        const refresh = async () => {
            const r = await ui.api('api/admin/users');
            if (!r.ok) { list.replaceChildren(el('div', { class: 'dialog-error', text: r.data.error || 'Failed' })); return; }
            list.replaceChildren(...r.data.users.map(u => el('div', { class: 'user-row' }, [
                el('div', { class: 'user-name' }, [u.username,
                    u.is_admin ? el('span', { class: 'badge', text: 'admin' }) : null,
                    u.username === this.user.username ? el('span', { class: 'badge you', text: 'you' }) : null]),
                el('button', { class: 'btn small', type: 'button', text: 'Reset password', onclick: async () => {
                    const np = await ui.ask(`Reset password — ${u.username}`, 'New password', '', { okLabel: 'Set password' });
                    if (!np) return;
                    const res = await ui.api(`api/admin/users/${encodeURIComponent(u.username)}/password`, { method: 'POST', body: { new: np } });
                    if (!res.ok) ui.alert('Not changed', res.data.error || 'Failed');
                    else ui.toast(`Password updated for ${u.username}`, 'ok');
                } }),
                el('button', { class: 'btn small', type: 'button', text: u.is_admin ? 'Remove admin' : 'Make admin', onclick: async () => {
                    const res = await ui.api(`api/admin/users/${encodeURIComponent(u.username)}/admin`, { method: 'POST', body: { is_admin: !u.is_admin } });
                    if (!res.ok) ui.alert('Not changed', res.data.error || 'Failed');
                    refresh();
                } }),
                el('button', { class: 'btn small danger-ghost', type: 'button', text: 'Delete', disabled: u.username === this.user.username, onclick: async () => {
                    const ok = await ui.confirm('Delete user', `Delete "${u.username}"? Their files stay on the server.`, { okLabel: 'Delete user', danger: true });
                    if (!ok) return;
                    const res = await ui.api(`api/admin/users/${encodeURIComponent(u.username)}`, { method: 'DELETE' });
                    if (!res.ok) ui.alert('Not deleted', res.data.error || 'Failed');
                    refresh();
                } }),
            ])));
        };
        create.addEventListener('click', async () => {
            err.textContent = '';
            const username = uIn.value.trim(), password = pIn.value;
            if (!username || !password) { err.textContent = 'Enter a username and password.'; return; }
            const res = await ui.api('api/admin/users', { method: 'POST', body: { username, password, is_admin: aIn.checked } });
            if (!res.ok) { err.textContent = res.data.error || 'Failed'; return; }
            uIn.value = ''; pIn.value = ''; aIn.checked = false;
            ui.toast(`Added ${username}`, 'ok');
            refresh();
        });
        refresh();
        await ui.panel('Manage users', content);
    }
}
