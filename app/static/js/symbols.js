// Fixture library + symbol geometry.
//
// The fixture library lives in static/data/fixtures.json and is shared with
// the PDF renderer (app/lib/pdf_export.py), so a fixture looks the same on
// screen and on paper. The server inlines it into the page as
// <script id="fixture-data" type="application/json">.
//
// Symbol primitives use normalised coordinates:
//   plan:      u = 0..1 across the width (left → right seen from the front),
//              v = 0 at the back (wall side) .. 1 at the front
//   elevation: u = 0..1 across the width, v = 0 at the bottom .. 1 at the top
//
// primsToPaths() turns them into plain polylines in inches so the renderer
// can transform them like any other geometry. pdf_export.py has a Python
// twin of this function — keep them in step.

let _lib = null;

export function fixtureLibrary() {
    if (_lib) return _lib;
    let data = { fixtures: [] };
    try {
        const el = typeof document !== 'undefined' && document.getElementById('fixture-data');
        if (el) data = JSON.parse(el.textContent);
    } catch (e) {
        console.warn('Fixture library failed to load', e);
    }
    _lib = data.fixtures || [];
    return _lib;
}

export function setFixtureLibrary(list) { _lib = list; }

export function getFixture(id) {
    return fixtureLibrary().find(f => f.id === id) || null;
}

export function fixtureCategories() {
    const seen = [];
    for (const f of fixtureLibrary()) if (!seen.includes(f.category)) seen.push(f.category);
    return seen;
}

const ARC_STEPS = 28;

function ellipsePts(cx, cy, rx, ry) {
    const pts = [];
    for (let i = 0; i < ARC_STEPS; i++) {
        const t = (i / ARC_STEPS) * Math.PI * 2;
        pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
    }
    return pts;
}

function roundRectPts(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (r < 1e-6) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const pts = [];
    const corner = (cx, cy, a0) => {
        for (let i = 0; i <= 6; i++) {
            const t = a0 + (i / 6) * (Math.PI / 2);
            pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
        }
    };
    corner(x + w - r, y + r, -Math.PI / 2);
    corner(x + w - r, y + h - r, 0);
    corner(x + r, y + h - r, Math.PI / 2);
    corner(x + r, y + r, Math.PI);
    return pts;
}

/**
 * Convert symbol primitives to paths in local inches.
 * @param prims   primitive list
 * @param W, D    size in inches (width, depth-or-height)
 * @param mode    'plan'  → (u,v) maps to x = (u-0.5)W, y = (v-0.5)D
 *                'elev'  → x = u·W, y = v·D (y up)
 * @param flip    mirror left/right
 * @returns [{ pts:[[x,y]...], closed, dash }]
 */
export function primsToPaths(prims, W, D, mode = 'plan', flip = false) {
    const X = (u) => {
        const uu = flip ? 1 - u : u;
        return mode === 'plan' ? (uu - 0.5) * W : uu * W;
    };
    const Y = (v) => (mode === 'plan' ? (v - 0.5) * D : v * D);
    const out = [];
    for (const p of prims || []) {
        const dash = !!p.dash;
        switch (p.t) {
            case 'rect': {
                const x0 = X(p.x), x1 = X(p.x + p.w);
                const y0 = Y(p.y), y1 = Y(p.y + p.h);
                const r = (p.rr || 0) * Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0));
                out.push({ pts: roundRectPts(Math.min(x0, x1), Math.min(y0, y1),
                                             Math.abs(x1 - x0), Math.abs(y1 - y0), r),
                           closed: true, dash });
                break;
            }
            case 'ellipse':
                out.push({ pts: ellipsePts(X(p.cx), Y(p.cy), p.rx * W, p.ry * D),
                           closed: true, dash });
                break;
            case 'circle': {
                const r = p.r * Math.min(W, D);
                out.push({ pts: ellipsePts(X(p.cx), Y(p.cy), r, r), closed: true, dash });
                break;
            }
            case 'line':
                out.push({ pts: [[X(p.x1), Y(p.y1)], [X(p.x2), Y(p.y2)]], closed: false, dash });
                break;
            case 'poly':
                out.push({ pts: p.pts.map(([u, v]) => [X(u), Y(v)]),
                           closed: p.closed !== false, dash });
                break;
        }
    }
    return out;
}
