"""
Architectural units. Inches everywhere internally; user enters and reads
feet/inches notation. Direct port of the desktop app's core/units.py with
no changes other than removing the Qt dependency (there was none here, so
it's literally a copy).
"""
from __future__ import annotations

import math
import re

INCHES_PER_FOOT = 12.0


def parse_length(text: str) -> float | None:
    if text is None:
        return None
    s = text.strip().lower()
    if not s:
        return None

    s = s.replace("\u2032", "'").replace("\u2033", '"')
    s = s.replace("\u2018", "'").replace("\u2019", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("ft", "'").replace("feet", "'")
    s = s.replace("in", '"').replace("inches", '"').replace("inch", '"')
    s = s.strip()

    m = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*'\s*", s)
    if m:
        return float(m.group(1)) * INCHES_PER_FOOT

    m = re.fullmatch(
        r"\s*(-?\d+(?:\.\d+)?)\s*'[\s\-]*"
        r"(\d+(?:\.\d+)?)?\s*"
        r"(?:(\d+)\s*/\s*(\d+))?\s*"
        r"\"?\s*",
        s,
    )
    if m and m.group(1):
        feet = float(m.group(1))
        whole_in = float(m.group(2)) if m.group(2) else 0.0
        if m.group(3) and m.group(4):
            whole_in += float(m.group(3)) / float(m.group(4))
        return feet * INCHES_PER_FOOT + whole_in

    m = re.fullmatch(
        r"\s*(\d+(?:\.\d+)?)?\s*"
        r"(?:(\d+)\s*/\s*(\d+))?\s*\"\s*",
        s,
    )
    if m and (m.group(1) or m.group(2)):
        whole = float(m.group(1)) if m.group(1) else 0.0
        if m.group(2) and m.group(3):
            whole += float(m.group(2)) / float(m.group(3))
        return whole

    m = re.fullmatch(
        r"\s*(-?\d+(?:\.\d+)?)?\s*"
        r"(?:(\d+)\s*/\s*(\d+))?\s*",
        s,
    )
    if m and (m.group(1) or m.group(2)):
        whole = float(m.group(1)) if m.group(1) else 0.0
        if m.group(2) and m.group(3):
            whole += float(m.group(2)) / float(m.group(3))
        return whole

    return None


def format_length(inches: float, precision: str = "1/16") -> str:
    if inches is None or not math.isfinite(inches):
        return "—"

    sign = "-" if inches < 0 else ""
    inches = abs(inches)

    if precision == "0.01":
        feet = int(inches // 12)
        rem = inches - feet * 12
        if feet:
            return f"{sign}{feet}'-{rem:.2f}\""
        return f"{sign}{rem:.2f}\""

    denom_map = {"1/16": 16, "1/8": 8, "1/4": 4, "1/2": 2, "1": 1}
    denom = denom_map.get(precision, 16)

    units = round(inches * denom)
    total_in = units / denom
    feet = int(total_in // 12)
    rem = total_in - feet * 12

    whole = int(rem)
    frac_units = round((rem - whole) * denom)
    if frac_units == denom:
        whole += 1
        frac_units = 0
    if whole == 12:
        feet += 1
        whole = 0

    def gcd(a: int, b: int) -> int:
        while b:
            a, b = b, a % b
        return a

    parts: list[str] = []
    if feet:
        parts.append(f"{feet}'")
    if whole or frac_units == 0:
        if frac_units:
            g = gcd(frac_units, denom)
            parts.append(f"{whole} {frac_units // g}/{denom // g}\"")
        else:
            parts.append(f"{whole}\"")
    elif frac_units:
        g = gcd(frac_units, denom)
        parts.append(f"{frac_units // g}/{denom // g}\"")

    if not parts:
        return f"{sign}0\""
    if len(parts) == 2:
        return f"{sign}{parts[0]}-{parts[1]}"
    return f"{sign}{parts[0]}"


def format_area(square_inches: float) -> str:
    sf = square_inches / 144.0
    return f"{sf:.1f} sq ft"


# --- Bearings (for plot maps) ---------------------------------------------

_BEARING_RE = re.compile(
    r"\s*([nNsS])\s*"
    r"(\d+(?:\.\d+)?)\s*[°d]?\s*"
    r"(?:(\d+(?:\.\d+)?)\s*['m]?\s*)?"
    r"(?:(\d+(?:\.\d+)?)\s*[\"s]?\s*)?"
    r"([eEwW])\s*"
)


def parse_bearing(text: str) -> float | None:
    """Return math angle (radians, CCW from +X, +Y up) or None."""
    m = _BEARING_RE.fullmatch(text.strip())
    if not m:
        return None
    ns, deg, mins, secs, ew = m.groups()
    angle = float(deg)
    if mins:
        angle += float(mins) / 60.0
    if secs:
        angle += float(secs) / 3600.0
    if not (0 <= angle <= 90):
        return None

    if ns.upper() == "N" and ew.upper() == "E":
        az = angle
    elif ns.upper() == "S" and ew.upper() == "E":
        az = 180.0 - angle
    elif ns.upper() == "S" and ew.upper() == "W":
        az = 180.0 + angle
    elif ns.upper() == "N" and ew.upper() == "W":
        az = 360.0 - angle
    else:
        return None

    math_deg = 90.0 - az
    return math.radians(math_deg)


def format_bearing(angle_rad: float) -> str:
    az = (90.0 - math.degrees(angle_rad)) % 360.0
    if az <= 90.0:
        ns, ew, a = "N", "E", az
    elif az < 180.0:
        ns, ew, a = "S", "E", 180.0 - az
    elif az <= 270.0:
        ns, ew, a = "S", "W", az - 180.0
    else:
        ns, ew, a = "N", "W", 360.0 - az

    deg = int(a)
    mins_full = (a - deg) * 60.0
    mins = int(mins_full)
    secs = int(round((mins_full - mins) * 60.0))
    if secs == 60:
        secs = 0
        mins += 1
    if mins == 60:
        mins = 0
        deg += 1
    return f"{ns} {deg}\u00b0{mins:02d}'{secs:02d}\" {ew}"
