// Cabinet list (bill of materials).
//
// Rolls the cabinets on the plan up into an order list: one line per model
// and finish with a quantity. Fillers are cut to fit on site, so they're
// counted as the stock strips to buy (one strip per filler). Appliances and
// fixtures get their own list. Prices are optional — the catalog list price
// is carried along for anyone who wants a rough number.

const CAT_ORDER = { wall: 0, base: 1, corner: 2, lazy: 3, tall: 4, vanity: 5, ada: 6, filler: 7 };

const STOCK = {
    '3F':   { model: '3" Filler', description: '3" × 42" filler strip' },
    '6F':   { model: '6" Filler', description: '6" × 42" filler strip' },
    '3F96': { model: '3" Filler (96")', description: '3" × 96" filler strip' },
};

export function computeBOM(scene) {
    const byKey = new Map();
    const fixtures = new Map();
    let fillerCut = [];
    for (const it of scene.items) {
        if (it.kind === 'fixture') {
            const key = it.fixture_id || it.name;
            const f = fixtures.get(key) || { name: it.name || key, quantity: 0,
                                              size: `${fmt(it.width)}×${fmt(it.depth)}` };
            f.quantity += 1;
            fixtures.set(key, f);
            continue;
        }
        if (it.kind !== 'cabinet') continue;
        let model = it.model, description = it.description || '';
        if (it.filler && STOCK[it.stock]) {
            model = STOCK[it.stock].model;
            description = STOCK[it.stock].description;
            fillerCut.push({ width: it.width, finish: it.finish });
        }
        const key = `${it.finish}|${model}`;
        let line = byKey.get(key);
        if (!line) {
            line = {
                model, description, finish: it.finish,
                unit_price: it.price || 0, quantity: 0,
                width: it.filler ? null : it.width, depth: it.depth, height: it.height,
                category: it.category, hinges: { L: 0, R: 0 },
            };
            byKey.set(key, line);
        }
        line.quantity += 1;
        if (!it.filler && it.width <= 24 && it.category !== 'filler') line.hinges[it.hinge || 'L'] += 1;
    }
    const lines = [...byKey.values()];
    lines.sort((a, b) =>
        a.finish.localeCompare(b.finish) ||
        (CAT_ORDER[a.category] ?? 99) - (CAT_ORDER[b.category] ?? 99) ||
        a.model.localeCompare(b.model, undefined, { numeric: true }));

    const byFinish = new Map();
    for (const l of lines) {
        if (!byFinish.has(l.finish)) byFinish.set(l.finish, []);
        byFinish.get(l.finish).push(l);
    }
    const groups = [];
    let grandTotal = 0, grandQuantity = 0;
    for (const [finish, ls] of byFinish.entries()) {
        let subtotal = 0, qty = 0;
        for (const l of ls) {
            l.extended = l.unit_price * l.quantity;
            subtotal += l.extended;
            qty += l.quantity;
        }
        groups.push({ finish, lines: ls, subtotal, quantity: qty });
        grandTotal += subtotal;
        grandQuantity += qty;
    }
    return {
        groups, grandTotal, grandQuantity,
        cabinetCount: grandQuantity,
        fixtures: [...fixtures.values()].sort((a, b) => a.name.localeCompare(b.name)),
        fillerCut,
    };
}

function fmt(n) { return Number.isInteger(n) ? String(n) : String(+n.toFixed(2)); }

export function sizeText(l) {
    return l.width == null ? `${fmt(l.height)}" long` : `${fmt(l.width)}×${fmt(l.depth)}×${fmt(l.height)}`;
}

export function hingeText(l) {
    const parts = [];
    if (l.hinges.L) parts.push(`${l.hinges.L}L`);
    if (l.hinges.R) parts.push(`${l.hinges.R}R`);
    return parts.join(' / ');
}

export function bomToCSV(bom, { prices = false } = {}) {
    const head = ['Finish', 'Model', 'Description', 'Qty', 'Size W×D×H (in)', 'Hinge'];
    if (prices) head.push('List each', 'List ext.');
    const rows = [head];
    for (const g of bom.groups) {
        for (const l of g.lines) {
            const r = [l.finish, l.model, l.description, String(l.quantity), sizeText(l), hingeText(l)];
            if (prices) r.push(l.unit_price.toFixed(2), l.extended.toFixed(2));
            rows.push(r);
        }
    }
    if (bom.fixtures.length) {
        rows.push([]);
        rows.push(['Appliances & fixtures', '', '', 'Qty', 'Size W×D (in)']);
        for (const f of bom.fixtures) rows.push(['', f.name, '', String(f.quantity), f.size]);
    }
    return rows.map(r => r.map(csvField).join(',')).join('\n');
}

function csvField(v) {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

export function formatUSD(n) {
    return '$' + (n || 0).toLocaleString('en-US',
        { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
