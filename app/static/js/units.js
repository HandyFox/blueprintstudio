// Architectural unit handling — JS port of core/units.py.
// Internal scene unit is INCHES.
//
// Public API:
//   parseLength(text) -> Number | null
//   formatLength(inches, precision = '1/16') -> String
//   formatArea(squareInches) -> String
//   parseBearing(text) -> Number | null   (math angle, radians, CCW from +X)
//   formatBearing(angleRad) -> String

const INCHES_PER_FOOT = 12.0;

export function parseLength(text) {
    if (text == null) return null;
    let s = String(text).trim().toLowerCase();
    if (!s) return null;

    // Normalize fancy quotes & unit words
    s = s
        .replace(/\u2032/g, "'").replace(/\u2033/g, '"')
        .replace(/\u2018|\u2019/g, "'")
        .replace(/\u201c|\u201d/g, '"')
        .replace(/\bft\b|\bfeet\b/g, "'")
        .replace(/\binches\b|\binch\b|\bin\b/g, '"')
        .trim();

    let m;
    // Pattern A: feet only — "12'", "12.5'"
    m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*'\s*$/);
    if (m) return parseFloat(m[1]) * INCHES_PER_FOOT;

    // Pattern B: feet + inches — "12'-6\"", "12'6\"", "12'-6 1/2\""
    m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*'[\s\-]*(\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?\s*"?\s*$/);
    if (m && m[1]) {
        let feet = parseFloat(m[1]);
        let wholeIn = m[2] ? parseFloat(m[2]) : 0;
        if (m[3] && m[4]) wholeIn += parseFloat(m[3]) / parseFloat(m[4]);
        return feet * INCHES_PER_FOOT + wholeIn;
    }

    // Pattern C: inches with optional fraction — "6 1/2\""
    m = s.match(/^\s*(\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?\s*"\s*$/);
    if (m && (m[1] || m[2])) {
        let whole = m[1] ? parseFloat(m[1]) : 0;
        if (m[2] && m[3]) whole += parseFloat(m[2]) / parseFloat(m[3]);
        return whole;
    }

    // Pattern D: bare number with optional fraction — "6.5", "6 1/2"
    m = s.match(/^\s*(-?\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?\s*$/);
    if (m && (m[1] || m[2])) {
        let whole = m[1] ? parseFloat(m[1]) : 0;
        if (m[2] && m[3]) whole += parseFloat(m[2]) / parseFloat(m[3]);
        return whole;
    }

    return null;
}

function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { [a, b] = [b, a % b]; }
    return a;
}

export function formatLength(inches, precision = '1/16') {
    if (inches == null || !isFinite(inches)) return '—';
    const sign = inches < 0 ? '-' : '';
    inches = Math.abs(inches);

    if (precision === '0.01') {
        const feet = Math.floor(inches / 12);
        const rem = inches - feet * 12;
        if (feet) return `${sign}${feet}'-${rem.toFixed(2)}"`;
        return `${sign}${rem.toFixed(2)}"`;
    }

    const denomMap = { '1/16': 16, '1/8': 8, '1/4': 4, '1/2': 2, '1': 1 };
    const denom = denomMap[precision] || 16;

    const units = Math.round(inches * denom);
    const totalIn = units / denom;
    let feet = Math.floor(totalIn / 12);
    let rem = totalIn - feet * 12;
    let whole = Math.floor(rem);
    let fracUnits = Math.round((rem - whole) * denom);
    if (fracUnits === denom) { whole += 1; fracUnits = 0; }
    if (whole === 12) { feet += 1; whole = 0; }

    const parts = [];
    if (feet) parts.push(`${feet}'`);
    if (whole || fracUnits === 0) {
        if (fracUnits) {
            const g = gcd(fracUnits, denom);
            parts.push(`${whole} ${fracUnits / g}/${denom / g}"`);
        } else {
            parts.push(`${whole}"`);
        }
    } else if (fracUnits) {
        const g = gcd(fracUnits, denom);
        parts.push(`${fracUnits / g}/${denom / g}"`);
    }

    if (!parts.length) return `${sign}0"`;
    if (parts.length === 2) return `${sign}${parts[0]}-${parts[1]}`;
    return `${sign}${parts[0]}`;
}

export function formatArea(squareInches) {
    return `${(squareInches / 144).toFixed(1)} sq ft`;
}

const BEARING_RE = /^\s*([nNsS])\s*(\d+(?:\.\d+)?)\s*[°d]?\s*(?:(\d+(?:\.\d+)?)\s*['m]?\s*)?(?:(\d+(?:\.\d+)?)\s*["s]?\s*)?([eEwW])\s*$/;

export function parseBearing(text) {
    const m = String(text).trim().match(BEARING_RE);
    if (!m) return null;
    const [, ns, deg, mins, secs, ew] = m;
    let angle = parseFloat(deg);
    if (mins) angle += parseFloat(mins) / 60.0;
    if (secs) angle += parseFloat(secs) / 3600.0;
    if (!(angle >= 0 && angle <= 90)) return null;

    let az;
    const NS = ns.toUpperCase(), EW = ew.toUpperCase();
    if (NS === 'N' && EW === 'E') az = angle;
    else if (NS === 'S' && EW === 'E') az = 180 - angle;
    else if (NS === 'S' && EW === 'W') az = 180 + angle;
    else if (NS === 'N' && EW === 'W') az = 360 - angle;
    else return null;
    const mathDeg = 90 - az;
    return mathDeg * Math.PI / 180;
}

export function formatBearing(angleRad) {
    let az = (90 - angleRad * 180 / Math.PI) % 360;
    if (az < 0) az += 360;
    let ns, ew, a;
    if (az <= 90)        { ns = 'N'; ew = 'E'; a = az; }
    else if (az < 180)   { ns = 'S'; ew = 'E'; a = 180 - az; }
    else if (az <= 270)  { ns = 'S'; ew = 'W'; a = az - 180; }
    else                 { ns = 'N'; ew = 'W'; a = 360 - az; }
    let deg = Math.floor(a);
    let minsFull = (a - deg) * 60;
    let mins = Math.floor(minsFull);
    let secs = Math.round((minsFull - mins) * 60);
    if (secs === 60) { secs = 0; mins += 1; }
    if (mins === 60) { mins = 0; deg += 1; }
    const m = mins.toString().padStart(2, '0');
    const sc = secs.toString().padStart(2, '0');
    return `${ns} ${deg}°${m}'${sc}" ${ew}`;
}
