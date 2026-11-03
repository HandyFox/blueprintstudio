"""
PDF generation with ReportLab.

Major change vs. the desktop app: the title block is **compact and along
the bottom edge**, not a full-height 3"-wide right strip. On Letter size
that change alone roughly doubles the usable drawing area. The heading is
a single 0.6" tall band at the bottom of the page, with the project name,
drawing number, scale, and revision packed into it. Scale bar and north
arrow sit on the right end of the same band.

Coordinate convention: scene units are inches. ReportLab uses points (72/in)
with origin at the bottom-left. We convert by multiplying by 72.

PRINT_SCALES is the same set the desktop app supports; "fit to page" is
also offered.
"""
from __future__ import annotations

import copy
import io
import json
import math
import os
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import (A0, A1, A2, A3, A4, LETTER, TABLOID,
                                     landscape as ls, portrait as pt)
from reportlab.pdfgen import canvas as rl_canvas

from .units import format_area, format_bearing, format_length

_FIXTURES_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              "static", "data", "fixtures.json")
try:
    with open(_FIXTURES_PATH, "r", encoding="utf-8") as _f:
        FIXTURES = {f["id"]: f for f in json.load(_f).get("fixtures", [])}
except (OSError, ValueError):  # pragma: no cover
    FIXTURES = {}


# --- Page sizes -----------------------------------------------------------

# Width x height in points (1 pt = 1/72 inch). All in portrait orientation;
# the caller rotates to landscape if requested.
PAGE_SIZES = {
    "Letter":         LETTER,                           # 8.5 x 11
    "Tabloid":        TABLOID,                          # 11 x 17
    "ANSI C (17x22)": (17 * 72, 22 * 72),
    "ANSI D (22x34)": (22 * 72, 34 * 72),
    "ANSI E (34x44)": (34 * 72, 44 * 72),
    "A4":             A4,
    "A3":             A3,
    "A2":             A2,
    "A1":             A1,
    "A0":             A0,
}


# Reuse the desktop app's print scale table. (label, paper_in_per_scene_in)
PRINT_SCALES: list[tuple[str, float]] = [
    ("1\" = 1'-0\"",      1.0 / 12.0),
    ("3/4\" = 1'-0\"",    0.75 / 12.0),
    ("1/2\" = 1'-0\"",    0.5 / 12.0),
    ("3/8\" = 1'-0\"",    0.375 / 12.0),
    ("1/4\" = 1'-0\"",    0.25 / 12.0),
    ("3/16\" = 1'-0\"",   0.1875 / 12.0),
    ("1/8\" = 1'-0\"",    0.125 / 12.0),
    ("1/16\" = 1'-0\"",   0.0625 / 12.0),
    ("1\" = 10'",         1.0 / 120.0),
    ("1\" = 20'",         1.0 / 240.0),
    ("1\" = 30'",         1.0 / 360.0),
    ("1\" = 40'",         1.0 / 480.0),
    ("1\" = 50'",         1.0 / 600.0),
    ("1\" = 100'",        1.0 / 1200.0),
]


def scale_for_label(label: str) -> float:
    for l, s in PRINT_SCALES:
        if l == label:
            return s
    return 1.0 / 48.0


# --- Public entrypoint ----------------------------------------------------

def build_pdf(project: dict, *, page_size: str = "Letter",
              landscape: bool = True, margins_in: float = 0.25,
              fit_to_page: bool = False, elevations: list | None = None,
              cabinet_list: dict | None = None) -> io.BytesIO:
    """Render `project` (the same dict shape we save in .bpsj) to a PDF.

    By default the drawing prints at the project's exact `print_scale`
    (true to scale on the paper). If the drawing doesn't fit the page at
    that scale, it is clipped and a warning is added. Pass
    `fit_to_page=True` to instead auto-fit the drawing to the page (the
    scale bar and label are then updated to reflect the actual scale used,
    so the print is still true-to-scale-as-printed — just not the scale
    the user originally requested).

    Returns an in-memory file. Caller seeks to 0 and ships it.
    """
    raw_size = PAGE_SIZES.get(page_size, LETTER)
    if landscape:
        page_w, page_h = ls(raw_size)
    else:
        page_w, page_h = pt(raw_size)

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(page_w, page_h))
    c.setTitle((project.get("settings") or {}).get(
        "drawing_title") or "Blueprint")
    c.setCreator("Blueprint Studio Web")

    margin = margins_in * 72  # to points

    # ---- Layout: drawing fills most of the page; title block is a thin
    # band at the bottom (0.6") with everything packed horizontally.
    title_band_h = 0.6 * 72  # 0.6" tall

    drawing_rect = (
        margin,
        margin + title_band_h + 4,             # leave 4pt gap above title
        page_w - margin,
        page_h - margin,
    )
    title_rect = (
        margin,
        margin,
        page_w - margin,
        margin + title_band_h,
    )

    # Outer page border (very thin)
    c.setStrokeColor(colors.black)
    c.setLineWidth(0.5)
    c.rect(margin, margin, page_w - 2 * margin, page_h - 2 * margin,
           stroke=1, fill=0)

    project = copy.deepcopy(project)
    elevations = elevations or []
    project["_elevation_markers"] = [
        {"letter": e.get("letter", ""), **(e.get("marker") or {})}
        for e in elevations if e.get("marker")
    ]
    _draw_drawing(c, drawing_rect, project, fit_to_page=fit_to_page)
    _draw_title_band(c, title_rect, project)

    if elevations:
        _draw_elevation_pages(c, elevations, project, (page_w, page_h),
                              margin, title_band_h)

    items = project.get("items") or []
    listed = [it for it in items if it.get("type") in ("cabinet", "fixture")]
    if listed and (cabinet_list or {}).get("include", True):
        c.showPage()
        from reportlab.lib.pagesizes import LETTER as _LETTER
        c.setPageSize(_LETTER)
        _draw_list_page(c, items, project, prices=bool((cabinet_list or {}).get("prices")))

    c.showPage()
    c.save()
    buf.seek(0)
    return buf


# --- Drawing area ---------------------------------------------------------

def _draw_drawing(c: rl_canvas.Canvas, rect: tuple, project: dict,
                  *, fit_to_page: bool = False) -> None:
    """Render the floor plan into rect = (x0, y0, x1, y1) in points.

    The scene units are inches. Print scale is paper_inches / scene_inches.
    Multiplying by 72 gives points per scene-inch.

    When ``fit_to_page`` is False (default), the drawing renders at the
    project's exact print_scale — true to scale on the paper. If the
    drawing doesn't fit at that scale, it is clipped and a warning is
    overlaid; the scale bar still shows the chosen scale.

    When ``fit_to_page`` is True, the drawing is auto-scaled to fit the
    rect (the scale bar and label are updated to match what was actually
    drawn, so the printed page is still true-to-scale-as-printed).
    """
    settings = project.get("settings") or {}
    items = project.get("items") or []
    layers = {l["name"]: l for l in (project.get("layers") or [])}

    print_scale = float(settings.get("print_scale", 1.0 / 48.0))
    requested_label = settings.get("print_scale_label", "")

    # Bounding box of items in scene units (inches).
    bb = _items_bounding_box(items)
    if bb is None:
        bb = (-12.0, -12.0, 144.0, 144.0)
    bx0, by0, bx1, by1 = bb
    margin_in = max(bx1 - bx0, by1 - by0) * 0.05 + 12.0
    bx0 -= margin_in
    by0 -= margin_in
    bx1 += margin_in
    by1 += margin_in
    bw = bx1 - bx0
    bh = by1 - by0

    rx0, ry0, rx1, ry1 = rect
    rw = rx1 - rx0
    rh = ry1 - ry0

    # Points per scene inch at the chosen print scale
    s_print = print_scale * 72.0
    # Points per scene inch if we just fit the bbox in the rect
    s_fit_w = rw / max(bw, 1e-6)
    s_fit_h = rh / max(bh, 1e-6)
    s_fit = min(s_fit_w, s_fit_h)

    overflows = s_print > s_fit + 1e-6  # exact scale would clip
    if fit_to_page:
        # Honor "fit": use whichever is smaller, and update settings so the
        # scale bar reflects the actual scale used. When the drawing is
        # smaller than the page we still fit-up so it fills the area, which
        # is how most "preview"-style exports behave.
        s = s_fit
        # paper-in per scene-in = s/72
        actual_print_scale = s / 72.0
        actual_label = _nearest_scale_label(actual_print_scale)
        settings = dict(settings)
        settings["print_scale"] = actual_print_scale
        settings["print_scale_label"] = actual_label
    else:
        # True-to-scale: always use the user's requested scale exactly.
        # If it doesn't fit, parts get clipped and we add a warning.
        s = s_print

    # Center the rendered box in the rect, with scene Y flipped (PDF Y is up).
    # Exception: in exact-scale mode, when the drawing overflows the rect, we
    # anchor at the bottom-left so the "0,0" corner of the bbox is visible
    # (centering would put empty interior on the page and clip the action at
    # the perimeter).
    out_w = bw * s
    out_h = bh * s
    if (not fit_to_page) and overflows:
        ox = rx0
        oy = ry1 - out_h  # top-left anchor in PDF coords (Y up)
    else:
        ox = rx0 + (rw - out_w) / 2
        oy = ry0 + (rh - out_h) / 2

    # Frame the drawing
    c.setLineWidth(0.4)
    c.setStrokeColor(colors.black)
    c.rect(rx0, ry0, rw, rh, stroke=1, fill=0)

    c.saveState()
    # Clip to drawing rect with a small inset
    c.rect(rx0 + 1, ry0 + 1, rw - 2, rh - 2, stroke=0, fill=0)
    p = c.beginPath()
    p.rect(rx0 + 1, ry0 + 1, rw - 2, rh - 2)
    c.clipPath(p, stroke=0, fill=0)

    # Build a transform from scene coords (x, y) (Y down in screen sense) to
    # PDF coords (x, y) (Y up). We flip Y by translating then scaling -1.
    # scene_to_pdf: (sx, sy) -> (ox + (sx - bx0)*s, oy + out_h - (sy - by0)*s)
    def to_pdf(sx: float, sy: float) -> tuple[float, float]:
        return (ox + (sx - bx0) * s,
                oy + out_h - (sy - by0) * s)

    # Stash effective scale so other helpers can use it (paint thickness etc.)
    state = {"to_pdf": to_pdf, "s": s, "settings": settings, "layers": layers}

    # Layer visibility filter
    def layer_visible(name: str) -> bool:
        l = layers.get(name)
        if l is None:
            return True
        return l.get("visible", True)

    # Sort items by z-order via type so dimensions/labels print on top
    z_for = {
        "plot": 5, "wall": 10, "opening": 11, "fixture": 12, "cabinet": 12,
        "dimension": 15, "room": 20, "annotation": 25,
    }

    def zkey(d):
        z = z_for.get(d.get("type"), 0)
        if d.get("type") in ("cabinet", "fixture"):
            z += min(0.9, float(d.get("elevation") or 0) / 200.0)
        return z
    sorted_items = sorted(items, key=zkey)

    for it in sorted_items:
        kind = it.get("type")
        if kind == "wall":
            if not layer_visible("Walls"):
                continue
            _paint_wall(c, it, items, state)
        elif kind == "dimension":
            if not layer_visible("Dimensions"):
                continue
            _paint_dimension(c, it, state)
        elif kind == "room":
            if not layer_visible("Rooms"):
                continue
            _paint_room(c, it, state)
        elif kind == "plot":
            if not layer_visible("Plot"):
                continue
            _paint_plot(c, it, state)
        elif kind == "annotation":
            if not layer_visible("Annotations"):
                continue
            _paint_annotation(c, it, state)
        elif kind == "cabinet":
            if not layer_visible("Cabinets"):
                continue
            _paint_cabinet(c, it, state)
        elif kind == "fixture":
            if not layer_visible(it.get("layer") or "Fixtures"):
                continue
            _paint_fixture(c, it, state)
        # openings are painted as part of their wall

    for m in project.get("_elevation_markers") or []:
        _paint_elevation_marker(c, m, state)

    c.restoreState()

    # If we were asked to honor the exact scale and the drawing overflows,
    # add a small warning so the user knows the print is partial.
    if not fit_to_page and overflows:
        c.setFillColor(colors.HexColor("#b91c1c"))
        c.setFont("Helvetica-Bold", 7)
        c.drawString(
            rx0 + 4, ry1 - 9,
            "DRAWING EXCEEDS THE SHEET AT THIS SCALE - CLIPPED. "
            "Use a larger sheet, a smaller scale, or 'shrink to fit'.")

    # If we changed the scale to fit, mutate the project dict so the title
    # band's scale bar matches what was actually drawn. (We made a fresh
    # settings dict before mutating, so the caller's data isn't affected
    # beyond this single render.)
    if fit_to_page:
        project["settings"] = settings


def _nearest_scale_label(paper_per_scene: float) -> str:
    """Return the label of the closest standard print scale to the given
    ratio (paper-inches per scene-inch)."""
    best = min(PRINT_SCALES, key=lambda lp: abs(lp[1] - paper_per_scene))
    # Only snap if it's within ~5% of a standard scale
    if abs(best[1] - paper_per_scene) / max(paper_per_scene, 1e-9) < 0.05:
        return best[0]
    # Otherwise fall back to a custom-looking label
    if paper_per_scene >= 1.0 / 12.0:
        # express as fraction of an inch per foot
        in_per_ft = paper_per_scene * 12.0
        return f"{in_per_ft:.3f}\" = 1'-0\""
    # express as feet per inch
    ft_per_in = 1.0 / (paper_per_scene * 12.0)
    return f"1\" = {ft_per_in:.1f}'"


def _items_bounding_box(items: list) -> tuple[float, float, float, float] | None:
    xs: list[float] = []
    ys: list[float] = []
    for it in items:
        kind = it.get("type")
        if kind == "wall":
            sx, sy = it["start"]
            ex, ey = it["end"]
            xs += [sx, ex]
            ys += [sy, ey]
        elif kind == "dimension":
            sx, sy = it["p1"]
            ex, ey = it["p2"]
            xs += [sx, ex]
            ys += [sy, ey]
        elif kind == "plot":
            for px, py in it.get("points", []):
                xs.append(px)
                ys.append(py)
        elif kind in ("room", "annotation"):
            px, py = it["pos"]
            xs.append(px)
            ys.append(py)
        elif kind in ("cabinet", "fixture"):
            # The cabinet occupies a rotated rectangle. Easiest correct
            # bbox: enumerate all 4 rotated corners.
            cx, cy = it["pos"]
            w = it.get("width", 24)
            d = it.get("depth", 24)
            rot = it.get("rotation", 0.0)
            cs, sn = math.cos(rot), math.sin(rot)
            for lx, ly in ((-w/2, -d/2), (w/2, -d/2), (w/2, d/2), (-w/2, d/2)):
                xs.append(cx + lx * cs - ly * sn)
                ys.append(cy + lx * sn + ly * cs)
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


# --- Per-item painters ----------------------------------------------------

def _paint_wall(c: rl_canvas.Canvas, w: dict, all_items: list, state: dict) -> None:
    s = state["s"]
    to_pdf = state["to_pdf"]
    sx, sy = w["start"]
    ex, ey = w["end"]
    thickness = float(w.get("thickness", 4.5))
    is_exterior = bool(w.get("is_exterior", False))

    L = math.hypot(ex - sx, ey - sy)
    if L < 1e-6:
        return

    # Compute axial extensions at each end (corner-cleanup): half the
    # max thickness of any other wall whose endpoint coincides with this end.
    def ext_at(px: float, py: float) -> float:
        best = 0.0
        for o in all_items:
            if o is w or o.get("type") != "wall":
                continue
            for ep in (o["start"], o["end"]):
                if abs(ep[0] - px) < 0.5 and abs(ep[1] - py) < 0.5:
                    t = float(o.get("thickness", 4.5)) / 2.0
                    if t > best:
                        best = t
                    break
        return best

    ext_s = ext_at(sx, sy)
    ext_e = ext_at(ex, ey)

    # Open spans along the wall (door/window cuts)
    open_spans: list[tuple[float, float]] = []
    for op in w.get("openings", []):
        off = float(op["offset"])
        wd = float(op["width"])
        open_spans.append((off - wd / 2, off + wd / 2))
    open_spans.sort()

    solid_spans: list[tuple[float, float]] = []
    cursor = 0.0
    for s_open, e_open in open_spans:
        s_open = max(0.0, min(L, s_open))
        e_open = max(0.0, min(L, e_open))
        if e_open <= cursor:
            continue
        if s_open > cursor:
            solid_spans.append((cursor, s_open))
        cursor = max(cursor, e_open)
    if cursor < L:
        solid_spans.append((cursor, L))

    if ext_s > 0 and solid_spans:
        if abs(solid_spans[0][0]) < 1e-6:
            solid_spans[0] = (-ext_s, solid_spans[0][1])
        else:
            solid_spans.insert(0, (-ext_s, 0.0))
    if ext_e > 0 and solid_spans:
        if abs(solid_spans[-1][1] - L) < 1e-6:
            solid_spans[-1] = (solid_spans[-1][0], L + ext_e)
        else:
            solid_spans.append((L, L + ext_e))

    # Wall axis unit vector and perpendicular
    ax = (ex - sx) / L
    ay = (ey - sy) / L
    px = -ay
    py = ax

    half_t = thickness / 2.0

    body = colors.HexColor("#222222") if is_exterior else colors.HexColor("#2b2b2b")
    face = colors.HexColor("#0d0d0d")

    # Solid spans
    c.setStrokeColor(body)
    c.setFillColor(body)
    c.setLineWidth(0)
    for span_s, span_e in solid_spans:
        # The four corners of the rectangle in scene coords
        p1x = sx + ax * span_s + px * half_t
        p1y = sy + ay * span_s + py * half_t
        p2x = sx + ax * span_e + px * half_t
        p2y = sy + ay * span_e + py * half_t
        p3x = sx + ax * span_e - px * half_t
        p3y = sy + ay * span_e - py * half_t
        p4x = sx + ax * span_s - px * half_t
        p4y = sy + ay * span_s - py * half_t

        path = c.beginPath()
        u1 = to_pdf(p1x, p1y)
        u2 = to_pdf(p2x, p2y)
        u3 = to_pdf(p3x, p3y)
        u4 = to_pdf(p4x, p4y)
        path.moveTo(*u1)
        path.lineTo(*u2)
        path.lineTo(*u3)
        path.lineTo(*u4)
        path.close()
        c.drawPath(path, stroke=0, fill=1)

    # Face lines
    c.setStrokeColor(face)
    c.setLineWidth(0.4)
    fs_x1 = sx + ax * (-ext_s) + px * half_t
    fs_y1 = sy + ay * (-ext_s) + py * half_t
    fs_x2 = sx + ax * (L + ext_e) + px * half_t
    fs_y2 = sy + ay * (L + ext_e) + py * half_t
    fb_x1 = sx + ax * (-ext_s) - px * half_t
    fb_y1 = sy + ay * (-ext_s) - py * half_t
    fb_x2 = sx + ax * (L + ext_e) - px * half_t
    fb_y2 = sy + ay * (L + ext_e) - py * half_t
    c.line(*to_pdf(fs_x1, fs_y1), *to_pdf(fs_x2, fs_y2))
    c.line(*to_pdf(fb_x1, fb_y1), *to_pdf(fb_x2, fb_y2))

    # End caps (only on unconnected ends)
    if ext_s == 0:
        a = (sx + px * half_t, sy + py * half_t)
        b = (sx - px * half_t, sy - py * half_t)
        c.line(*to_pdf(*a), *to_pdf(*b))
    if ext_e == 0:
        a = (ex + px * half_t, ey + py * half_t)
        b = (ex - px * half_t, ey - py * half_t)
        c.line(*to_pdf(*a), *to_pdf(*b))

    # Internal opening caps
    for span_s, span_e in solid_spans:
        if 1e-3 < span_s < L - 1e-3:
            a = (sx + ax * span_s + px * half_t,
                 sy + ay * span_s + py * half_t)
            b = (sx + ax * span_s - px * half_t,
                 sy + ay * span_s - py * half_t)
            c.line(*to_pdf(*a), *to_pdf(*b))
        if 1e-3 < span_e < L - 1e-3:
            a = (sx + ax * span_e + px * half_t,
                 sy + ay * span_e + py * half_t)
            b = (sx + ax * span_e - px * half_t,
                 sy + ay * span_e - py * half_t)
            c.line(*to_pdf(*a), *to_pdf(*b))

    # Exterior hatch — light 45° cross
    if is_exterior:
        hatch = colors.HexColor("#4b5563")
        c.setStrokeColor(hatch)
        c.setLineWidth(0.25)
        spacing = 3.0  # scene inches between hatch lines
        for span_s, span_e in solid_spans:
            rect_w = span_e - span_s
            d = -thickness
            while d < rect_w:
                x1 = span_s + d
                y1 = -half_t
                x2 = span_s + d + thickness
                y2 = half_t
                if x1 < span_s:
                    y1 += (span_s - x1)
                    x1 = span_s
                if x2 > span_e:
                    y2 -= (x2 - span_e)
                    x2 = span_e
                if x1 < x2 and y1 < y2:
                    # Convert from local (axial, perp) to scene (x, y)
                    a = (sx + ax * x1 + px * y1, sy + ay * x1 + py * y1)
                    b = (sx + ax * x2 + px * y2, sy + ay * x2 + py * y2)
                    c.line(*to_pdf(*a), *to_pdf(*b))
                d += spacing

    # Paint the openings (door/window) on top of the cleared spans
    for op in w.get("openings", []):
        _paint_opening(c, op, w, state, ax, ay, px, py, sx, sy)


def _paint_opening(c, op, wall, state, ax, ay, px, py, sx, sy):
    to_pdf = state["to_pdf"]
    kind = op.get("kind", "door")
    offset = float(op["offset"])
    width = float(op["width"])
    t = float(wall.get("thickness", 4.5))
    half_t = t / 2.0

    # Local span
    s_loc = offset - width / 2
    e_loc = offset + width / 2

    # Clear the opening — already cleared by solid_spans logic; here we just
    # add the symbol.
    # Jamb lines
    c.setStrokeColor(colors.HexColor("#1a1a1a"))
    c.setLineWidth(0.4)
    a = (sx + ax * s_loc + px * half_t, sy + ay * s_loc + py * half_t)
    b = (sx + ax * s_loc - px * half_t, sy + ay * s_loc - py * half_t)
    c.line(*to_pdf(*a), *to_pdf(*b))
    a = (sx + ax * e_loc + px * half_t, sy + ay * e_loc + py * half_t)
    b = (sx + ax * e_loc - px * half_t, sy + ay * e_loc - py * half_t)
    c.line(*to_pdf(*a), *to_pdf(*b))

    if kind == "window":
        # Three glazing lines parallel to wall axis, across window width
        c.setStrokeColor(colors.HexColor("#3b82f6"))
        c.setLineWidth(0.3)
        for y_local in (-half_t / 2, 0.0, half_t / 2):
            a = (sx + ax * s_loc + px * y_local,
                 sy + ay * s_loc + py * y_local)
            b = (sx + ax * e_loc + px * y_local,
                 sy + ay * e_loc + py * y_local)
            c.line(*to_pdf(*a), *to_pdf(*b))
        return

    # Door
    swing = op.get("swing", "right_in")
    # Hinge & tip in local coords (along wall, across thickness)
    if swing == "left_in":
        hinge_loc = (s_loc, half_t)
        tip_loc = (s_loc + width, half_t)
        arc_start_deg = 0.0
        arc_extent_deg = -90.0
    elif swing == "right_in":
        hinge_loc = (e_loc, half_t)
        tip_loc = (e_loc - width, half_t)
        arc_start_deg = 180.0
        arc_extent_deg = 90.0
    elif swing == "left_out":
        hinge_loc = (s_loc, -half_t)
        tip_loc = (s_loc + width, -half_t)
        arc_start_deg = 0.0
        arc_extent_deg = 90.0
    else:  # right_out
        hinge_loc = (e_loc, -half_t)
        tip_loc = (e_loc - width, -half_t)
        arc_start_deg = 180.0
        arc_extent_deg = -90.0

    hinge_pdf = to_pdf(sx + ax * hinge_loc[0] + px * hinge_loc[1],
                       sy + ay * hinge_loc[0] + py * hinge_loc[1])

    # Swing arc — approximate with a small polyline.
    # Scene Y is +DOWN (matches the editor). Qt's drawArc uses
    # "positive = CCW visual" which corresponds to CW math on a y-down canvas.
    # Negate arc_extent_deg so a 'right_in' door swings INTO the +halfT side
    # of the wall, not across to the other side.
    c.setStrokeColor(colors.HexColor("#7a7a7a"))
    c.setLineWidth(0.25)
    c.setDash([2, 2])
    cx = sx + ax * hinge_loc[0] + px * hinge_loc[1]
    cy = sy + ay * hinge_loc[0] + py * hinge_loc[1]
    vx = tip_loc[0] - hinge_loc[0]
    vy = tip_loc[1] - hinge_loc[1]
    extent_rad = math.radians(-arc_extent_deg)
    n = 16
    pts_pdf: list[tuple[float, float]] = []
    for i in range(n + 1):
        theta = extent_rad * i / n
        ct = math.cos(theta)
        st = math.sin(theta)
        rx = vx * ct - vy * st
        ry = vx * st + vy * ct
        sxp = cx + ax * rx + px * ry
        syp = cy + ay * rx + py * ry
        pts_pdf.append(to_pdf(sxp, syp))
    if len(pts_pdf) > 1:
        path = c.beginPath()
        path.moveTo(*pts_pdf[0])
        for x, y in pts_pdf[1:]:
            path.lineTo(x, y)
        c.drawPath(path, stroke=1, fill=0)
    c.setDash([])
    # Door leaf standing open: hinge -> end of the swing arc.
    c.setStrokeColor(colors.HexColor("#1a1a1a"))
    c.setLineWidth(0.7)
    c.line(hinge_pdf[0], hinge_pdf[1], pts_pdf[-1][0], pts_pdf[-1][1])


def _paint_dimension(c: rl_canvas.Canvas, d: dict, state: dict) -> None:
    to_pdf = state["to_pdf"]
    p1 = d["p1"]
    p2 = d["p2"]
    offset = float(d.get("offset", 24.0))
    text_h = float(d.get("text_height", 8.0))

    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    L = math.hypot(dx, dy)
    if L < 1e-6:
        return

    nx = -dy / L
    ny = dx / L
    d1 = (p1[0] + nx * offset, p1[1] + ny * offset)
    d2 = (p2[0] + nx * offset, p2[1] + ny * offset)

    col = colors.HexColor("#7a4a00")
    c.setStrokeColor(col)
    c.setFillColor(col)
    c.setLineWidth(0.4)

    # Extension lines (4" gap from anchor toward dimension line)
    gap = 4.0
    def gapped(a, b, gp):
        gx, gy = b[0] - a[0], b[1] - a[1]
        ll = math.hypot(gx, gy)
        if ll <= gp:
            return a
        return (a[0] + gx / ll * gp, a[1] + gy / ll * gp)
    e1 = gapped(p1, d1, gap)
    e2 = gapped(p2, d2, gap)
    c.line(*to_pdf(*e1), *to_pdf(*d1))
    c.line(*to_pdf(*e2), *to_pdf(*d2))

    # Dimension line
    c.line(*to_pdf(*d1), *to_pdf(*d2))

    # Architectural slash ticks
    ang = math.atan2(d2[1] - d1[1], d2[0] - d1[0])
    tick = 6.0
    cos_t = math.cos(ang + math.pi / 4)
    sin_t = math.sin(ang + math.pi / 4)
    for d_pt in (d1, d2):
        a = (d_pt[0] - cos_t * tick, d_pt[1] - sin_t * tick)
        b = (d_pt[0] + cos_t * tick, d_pt[1] + sin_t * tick)
        c.line(*to_pdf(*a), *to_pdf(*b))

    # Text — drawn rotated above the dimension line, font size in points
    # determined by text_height (scene inches) * scale (pts/in)
    text = format_length(L)
    s = state["s"]
    pt_size = max(4.0, text_h * s * 0.85)  # leave a bit of margin
    mid = ((d1[0] + d2[0]) / 2, (d1[1] + d2[1]) / 2)
    # Offset text slightly above the line
    text_offset = text_h * 0.6
    tx = mid[0] + nx * text_offset
    ty = mid[1] + ny * text_offset
    pdf_pt = to_pdf(tx, ty)
    deg = math.degrees(ang)
    # PDF Y is up but our scene Y is down, so the "screen angle" we measured
    # corresponds to a PDF angle of -deg. Keep text upright.
    pdf_deg = -deg
    if not (-90 < pdf_deg <= 90):
        pdf_deg += 180
    c.saveState()
    c.translate(*pdf_pt)
    c.rotate(pdf_deg)
    c.setFont("Helvetica", pt_size)
    text_w = c.stringWidth(text, "Helvetica", pt_size)
    c.drawString(-text_w / 2, 0, text)
    c.restoreState()


def _paint_room(c: rl_canvas.Canvas, r: dict, state: dict) -> None:
    to_pdf = state["to_pdf"]
    s = state["s"]
    name = (r.get("name") or "").upper()
    pos = r.get("pos", [0, 0])
    area = float(r.get("area", 0.0))

    name_h = 12.0  # scene inches
    area_h = 8.0
    pdf_pt = to_pdf(pos[0], pos[1])

    c.setFillColor(colors.HexColor("#111827"))
    c.setFont("Helvetica-Bold", max(4.0, name_h * s * 0.85))
    nw = c.stringWidth(name, "Helvetica-Bold",
                       max(4.0, name_h * s * 0.85))
    c.drawString(pdf_pt[0] - nw / 2, pdf_pt[1] + 2, name)

    c.setFillColor(colors.HexColor("#374151"))
    c.setFont("Helvetica", max(4.0, area_h * s * 0.85))
    area_text = format_area(area)
    aw = c.stringWidth(area_text, "Helvetica",
                       max(4.0, area_h * s * 0.85))
    c.drawString(pdf_pt[0] - aw / 2,
                 pdf_pt[1] - max(4.0, area_h * s * 0.85) - 2,
                 area_text)


def _paint_plot(c: rl_canvas.Canvas, p: dict, state: dict) -> None:
    to_pdf = state["to_pdf"]
    s = state["s"]
    pts = p.get("points") or []
    closed = bool(p.get("closed", True))
    label = p.get("label", "Lot")
    if len(pts) < 2:
        return

    c.setStrokeColor(colors.HexColor("#0e6b3b"))
    c.setLineWidth(0.6)
    c.setDash([8, 2, 1, 2])
    if closed:
        c.setFillColor(colors.Color(14 / 255, 107 / 255, 59 / 255, alpha=0.06))
        path = c.beginPath()
        first = to_pdf(*pts[0])
        path.moveTo(*first)
        for q in pts[1:]:
            path.lineTo(*to_pdf(*q))
        path.close()
        c.drawPath(path, stroke=1, fill=1)
    else:
        path = c.beginPath()
        path.moveTo(*to_pdf(*pts[0]))
        for q in pts[1:]:
            path.lineTo(*to_pdf(*q))
        c.drawPath(path, stroke=1, fill=0)
    c.setDash([])

    # Vertices
    c.setStrokeColor(colors.HexColor("#0e6b3b"))
    c.setFillColor(colors.white)
    for q in pts:
        x, y = to_pdf(*q)
        c.circle(x, y, 1.5, stroke=1, fill=1)

    # Bearing & distance labels per segment
    text_h = 10.0
    pt_size = max(4.0, text_h * s * 0.85)
    n = len(pts)
    seg_count = n if closed else n - 1
    c.setFillColor(colors.HexColor("#0e6b3b"))
    c.setFont("Helvetica", pt_size)
    for i in range(seg_count):
        a = pts[i]
        b = pts[(i + 1) % n]
        dx = b[0] - a[0]
        dy = b[1] - a[1]
        L = math.hypot(dx, dy)
        if L < 1e-3:
            continue
        ang = math.atan2(dy, dx)
        nx = -dy / L
        ny = dx / L
        offset = text_h * 1.6
        mx = (a[0] + b[0]) / 2 + nx * offset
        my = (a[1] + b[1]) / 2 + ny * offset
        pdf_pt = to_pdf(mx, my)
        deg = -math.degrees(ang)
        if not (-90 < deg <= 90):
            deg += 180
        c.saveState()
        c.translate(*pdf_pt)
        c.rotate(deg)
        label_text = f"{format_bearing(ang)}   {format_length(L)}"
        tw = c.stringWidth(label_text, "Helvetica", pt_size)
        c.drawString(-tw / 2, 0, label_text)
        c.restoreState()

    # Lot label and area at centroid
    if closed and len(pts) >= 3:
        # Centroid of polygon
        a = 0.0
        cx = 0.0
        cy = 0.0
        for i in range(n):
            p1 = pts[i]
            p2 = pts[(i + 1) % n]
            cross = p1[0] * p2[1] - p2[0] * p1[1]
            a += cross
            cx += (p1[0] + p2[0]) * cross
            cy += (p1[1] + p2[1]) * cross
        a *= 0.5
        if abs(a) > 1e-6:
            cx /= 6 * a
            cy /= 6 * a
        else:
            cx = sum(p[0] for p in pts) / n
            cy = sum(p[1] for p in pts) / n
        # Area in sf
        sq_in = abs(a)
        sq_ft = sq_in / 144.0
        acres = sq_ft / 43560.0

        pdf_pt = to_pdf(cx, cy)
        label_pt = max(6.0, 14.0 * s * 0.85)
        sub_pt = max(4.0, 10.0 * s * 0.85)
        c.setFillColor(colors.HexColor("#0e6b3b"))
        c.setFont("Helvetica-Bold", label_pt)
        lw = c.stringWidth(label, "Helvetica-Bold", label_pt)
        c.drawString(pdf_pt[0] - lw / 2, pdf_pt[1] + 2, label)
        c.setFont("Helvetica", sub_pt)
        sub = f"{sq_ft:,.0f} sq ft   ({acres:.3f} ac)"
        sw = c.stringWidth(sub, "Helvetica", sub_pt)
        c.drawString(pdf_pt[0] - sw / 2,
                     pdf_pt[1] - sub_pt - 2, sub)


def _paint_annotation(c: rl_canvas.Canvas, t: dict, state: dict) -> None:
    s = state["s"]
    to_pdf = state["to_pdf"]
    text = t.get("text", "")
    pos = t.get("pos", [0, 0])
    font_h = float(t.get("font_pt", 10))  # scene inches
    pt_size = max(4.0, font_h * s * 0.85)
    pdf_pt = to_pdf(pos[0], pos[1])
    c.setFillColor(colors.HexColor("#111827"))
    c.setFont("Helvetica", pt_size)
    tw = c.stringWidth(text, "Helvetica", pt_size)
    c.drawString(pdf_pt[0] - tw / 2, pdf_pt[1] - pt_size / 2, text)


# --- Cabinets & fixtures ------------------------------------------------

_CABINET_STYLE = {   # category -> (fill, upper fill, stroke)
    "wall":   ("#d4dced", "#e3e8f3", "#1e3a8a"),
    "base":   ("#e8dcc4", "#f2ebdd", "#7c5a2a"),
    "corner": ("#e8dcc4", "#f2ebdd", "#7c5a2a"),
    "lazy":   ("#e8dcc4", "#f2ebdd", "#7c5a2a"),
    "tall":   ("#d6d3d1", "#e7e5e4", "#44403c"),
    "vanity": ("#e3dced", "#ece8f3", "#5b4e7a"),
    "ada":    ("#d8e8de", "#e6f0ea", "#2d6649"),
    "filler": ("#efe7d6", "#e8edf6", "#78716c"),
}


def _local_shape(o: dict) -> list[tuple[float, float]]:
    """Footprint polygon in the object's local frame (mirrors model.js)."""
    w = float(o.get("width", 24))
    d = float(o.get("depth", 24))
    hw, hd = w / 2, d / 2
    shape = o.get("shape") or ("angle" if o.get("is_angle") else "rect")
    if shape == "L":
        leg = min(24.0, d, w)
        pts = [(-hw, -hd), (hw, -hd), (hw, -hd + leg), (-hw + leg, -hd + leg),
               (-hw + leg, hd), (-hw, hd)]
    elif shape == "angle":
        leg = min(12.0, w / 2)
        pts = [(-hw, -hd), (hw, -hd), (hw, -hd + leg), (-hw + leg, hd), (-hw, hd)]
    else:
        pts = [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
    if o.get("flip"):
        pts = [(-x, y) for x, y in reversed(pts)]
    return pts


def _to_world(o: dict):
    cx, cy = o.get("pos", [0, 0])
    rot = float(o.get("rotation", 0.0))
    cs, sn = math.cos(rot), math.sin(rot)
    return lambda lx, ly: (cx + lx * cs - ly * sn, cy + lx * sn + ly * cs)


def _poly(c, pts, stroke=True, fill=False, close=True):
    path = c.beginPath()
    path.moveTo(*pts[0])
    for p in pts[1:]:
        path.lineTo(*p)
    if close:
        path.close()
    c.drawPath(path, stroke=1 if stroke else 0, fill=1 if fill else 0)


def _placed_label(c, o, text, y_off, state, color="#1c1917", bold=True, x_off=0.0):
    if not text:
        return
    s = state["s"]
    to_pdf = state["to_pdf"]
    W = _to_world(o)
    w = float(o.get("width", 24))
    d = float(o.get("depth", 24))
    font = "Helvetica-Bold" if bold else "Helvetica"
    size = min(d * s * 0.32, 8.0)
    tw = c.stringWidth(text, font, 1.0)
    room_w = 24.0 if o.get("shape") == "L" else w
    if tw > 0:
        size = min(size, (room_w - 3) * s / tw)
    if size < 2.6:
        return
    deg = math.degrees(float(o.get("rotation", 0.0))) % 360
    if 90 < deg < 270:
        deg -= 180
    px, py = to_pdf(*W(x_off, y_off))
    c.saveState()
    c.translate(px, py)
    c.rotate(-deg)
    c.setFillColor(colors.HexColor(color))
    c.setFont(font, size)
    c.drawCentredString(0, -size / 3, text)
    c.restoreState()


def _paint_cabinet(c: rl_canvas.Canvas, cab: dict, state: dict) -> None:
    """Cabinet footprint: filled by type, dashed when hung on the wall,
    X for tall cabinets, hatched fillers, countertop overhang line, model code."""
    to_pdf = state["to_pdf"]
    W = _to_world(cab)
    w = float(cab.get("width", 24))
    d = float(cab.get("depth", 24))
    h = float(cab.get("height", 34.5))
    cat = cab.get("category", "base")
    elev = cab.get("elevation")
    if elev is None:
        elev = (54.0 if h >= 30 else 84.0 - h) if cat == "wall" else 0.0
    elev = float(elev)
    upper = elev >= 40
    filler = bool(cab.get("filler")) or cat == "filler"
    fill, upper_fill, stroke = _CABINET_STYLE.get(cat, _CABINET_STYLE["base"])
    hw, hd = w / 2, d / 2

    pts = [to_pdf(*W(x, y)) for x, y in _local_shape(cab)]
    c.setFillColor(colors.HexColor(upper_fill if upper else fill))
    c.setStrokeColor(colors.HexColor(stroke))
    c.setLineWidth(0.5 if upper else 0.7)
    c.setDash([3, 2] if upper else [])
    # Wall cabinets are drawn dashed and unfilled so the base cabinets and
    # counter under them stay readable (standard drafting convention).
    _poly(c, pts, stroke=True, fill=not upper)
    c.setDash([])

    shape = cab.get("shape") or "rect"
    c.setLineWidth(0.25)
    if cat == "tall":
        corners = [to_pdf(*W(x, y)) for x, y in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]
        c.line(*corners[0], *corners[2])
        c.line(*corners[1], *corners[3])
    if filler:
        x = -hw + 1.5
        while x < hw:
            a = to_pdf(*W(x, -hd))
            b = to_pdf(*W(min(hw, x + 3), hd))
            c.line(*a, *b)
            x += 3
    if shape == "rect" and not filler:
        c.setLineWidth(1.1)
        c.line(*to_pdf(*W(-hw + 0.75, hd)), *to_pdf(*W(hw - 0.75, hd)))
    top = elev + h
    if not upper and cat != "tall" and 28 < top < 38 and shape == "rect":
        c.setStrokeColor(colors.HexColor("#57534e"))
        c.setLineWidth(0.3)
        c.line(*to_pdf(*W(-hw, hd + 1)), *to_pdf(*W(hw, hd + 1)))

    label = cab.get("model", "")
    if shape == "L":
        _placed_label(c, cab, label, hd - 9, state, x_off=(hw - 12) if cab.get("flip") else (-hw + 12))
    else:
        _placed_label(c, cab, label, 0 if upper else (hd * 0.35 if d >= 18 else 0), state)


def prims_to_paths(prims, W, D, mode="plan", flip=False):
    """Python twin of symbols.js primsToPaths(). Returns
    [(points[(x,y)], closed, dash)] in local inches."""
    def X(u):
        uu = 1 - u if flip else u
        return (uu - 0.5) * W if mode == "plan" else uu * W

    def Y(v):
        return (v - 0.5) * D if mode == "plan" else v * D

    def ellipse(cx, cy, rx, ry):
        return [(cx + math.cos(t) * rx, cy + math.sin(t) * ry)
                for t in (i / 28 * 2 * math.pi for i in range(28))]

    def round_rect(x, y, w, h, r):
        r = max(0.0, min(r, w / 2, h / 2))
        if r < 1e-6:
            return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
        pts = []
        for cx, cy, a0 in ((x + w - r, y + r, -math.pi / 2), (x + w - r, y + h - r, 0.0),
                           (x + r, y + h - r, math.pi / 2), (x + r, y + r, math.pi)):
            for i in range(7):
                t = a0 + i / 6 * (math.pi / 2)
                pts.append((cx + math.cos(t) * r, cy + math.sin(t) * r))
        return pts

    out = []
    for p in prims or []:
        t = p.get("t")
        dash = bool(p.get("dash"))
        if t == "rect":
            x0, x1 = X(p["x"]), X(p["x"] + p["w"])
            y0, y1 = Y(p["y"]), Y(p["y"] + p["h"])
            r = (p.get("rr") or 0) * min(abs(x1 - x0), abs(y1 - y0))
            out.append((round_rect(min(x0, x1), min(y0, y1), abs(x1 - x0), abs(y1 - y0), r), True, dash))
        elif t == "ellipse":
            out.append((ellipse(X(p["cx"]), Y(p["cy"]), p["rx"] * W, p["ry"] * D), True, dash))
        elif t == "circle":
            r = p["r"] * min(W, D)
            out.append((ellipse(X(p["cx"]), Y(p["cy"]), r, r), True, dash))
        elif t == "line":
            out.append(([(X(p["x1"]), Y(p["y1"])), (X(p["x2"]), Y(p["y2"]))], False, dash))
        elif t == "poly":
            out.append(([(X(u), Y(v)) for u, v in p["pts"]], p.get("closed", True) is not False, dash))
    return out


def _paint_fixture(c: rl_canvas.Canvas, fx: dict, state: dict) -> None:
    to_pdf = state["to_pdf"]
    W = _to_world(fx)
    w = float(fx.get("width", 30))
    d = float(fx.get("depth", 30))
    spec = FIXTURES.get(fx.get("fixture_id") or "")
    prims = spec["plan"] if spec else [{"t": "rect", "x": 0, "y": 0, "w": 1, "h": 1}]
    c.setStrokeColor(colors.HexColor("#134e4a"))
    c.setLineWidth(0.5)
    first = fx.get("collide", True) is not False   # counter sinks: no fill
    for pts, closed, dash in prims_to_paths(prims, w, d, "plan", bool(fx.get("flip"))):
        c.setDash([2.5, 1.8] if dash else [])
        c.setFillColor(colors.white)
        _poly(c, [to_pdf(*W(x, y)) for x, y in pts], stroke=True,
              fill=bool(closed and first), close=closed)
        first = False
    c.setDash([])
    _placed_label(c, fx, fx.get("label") or "", 0, state, color="#134e4a")


def _paint_elevation_marker(c, m: dict, state: dict) -> None:
    """Small circular tag on the plan pointing at the cabinets an elevation shows."""
    to_pdf = state["to_pdf"]
    if "x" not in m:
        return
    x, y = to_pdf(m["x"], m["y"])
    r = 7
    ang = -float(m.get("dir", 0.0))   # scene y-down -> PDF y-up
    tip = (x + math.cos(ang) * r * 1.9, y + math.sin(ang) * r * 1.9)
    side1 = (x + math.cos(ang + 1.0) * r, y + math.sin(ang + 1.0) * r)
    side2 = (x + math.cos(ang - 1.0) * r, y + math.sin(ang - 1.0) * r)
    c.setFillColor(colors.HexColor("#1c1917"))
    c.setStrokeColor(colors.HexColor("#1c1917"))
    c.setLineWidth(0.6)
    _poly(c, [tip, side1, side2], stroke=True, fill=True)
    c.setFillColor(colors.white)
    c.circle(x, y, r, stroke=1, fill=1)
    c.setFillColor(colors.HexColor("#1c1917"))
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(x, y - 2.8, str(m.get("letter", "")))


# --- Elevation pages --------------------------------------------------------

_ELEV_SCALES = [("1/2\" = 1'-0\"", 0.5 / 12), ("3/8\" = 1'-0\"", 0.375 / 12),
                ("1/4\" = 1'-0\"", 0.25 / 12), ("3/16\" = 1'-0\"", 0.1875 / 12),
                ("1/8\" = 1'-0\"", 0.125 / 12)]


def _draw_elevation_pages(c, elevations: list, project: dict, page_wh, margin, band_h) -> None:
    """Lay the elevations out on as many sheets as needed, at the largest
    standard elevation scale that lets each one fit the sheet width."""
    page_w, page_h = page_wh
    area_x0, area_x1 = margin + 6, page_w - margin - 6
    area_y0, area_y1 = margin + band_h + 10, page_h - margin - 6
    area_w, area_h = area_x1 - area_x0, area_y1 - area_y0
    title_h = 16

    def fits(e, sc):
        b = e["bounds"]
        return ((b["x1"] - b["x0"]) * sc * 72 <= area_w and
                (b["y1"] - b["y0"]) * sc * 72 + title_h <= area_h)

    # One scale for the whole set keeps them comparable.
    label, sc = _ELEV_SCALES[-1]
    for lbl, cand in _ELEV_SCALES:
        if all(fits(e, cand) for e in elevations):
            label, sc = lbl, cand
            break

    pages: list[list[dict]] = [[]]
    used = 0.0
    for e in elevations:
        b = e["bounds"]
        h = (b["y1"] - b["y0"]) * sc * 72 + title_h + 14
        if pages[-1] and used + h > area_h:
            pages.append([])
            used = 0.0
        pages[-1].append(e)
        used += h

    settings = dict(project.get("settings") or {})
    num = settings.get("drawing_number") or "A-101"
    for i, page in enumerate(pages):
        c.showPage()
        c.setPageSize((page_w, page_h))
        c.setStrokeColor(colors.black)
        c.setLineWidth(0.5)
        c.rect(margin, margin, page_w - 2 * margin, page_h - 2 * margin, stroke=1, fill=0)
        y_top = area_y1
        for e in page:
            b = e["bounds"]
            ew = (b["x1"] - b["x0"]) * sc * 72
            eh = (b["y1"] - b["y0"]) * sc * 72
            ox = area_x0 + (area_w - ew) / 2 - b["x0"] * sc * 72
            oy = y_top - title_h - eh - b["y0"] * sc * 72
            _draw_elevation(c, e, ox, oy, sc * 72)
            # Title under-lined, with scale
            ty = y_top - 11
            c.setFillColor(colors.black)
            c.setFont("Helvetica-Bold", 10)
            tx = area_x0 + (area_w - ew) / 2
            c.drawString(tx, ty, e.get("title", "Elevation"))
            tw = c.stringWidth(e.get("title", "Elevation"), "Helvetica-Bold", 10)
            c.setFont("Helvetica", 7)
            c.drawString(tx + tw + 8, ty, f"SCALE {label}")
            c.setLineWidth(0.6)
            c.line(tx, ty - 3, tx + tw, ty - 3)
            y_top -= eh + title_h + 14
        page_settings = dict(settings, print_scale=sc, print_scale_label=label,
                             drawing_title="Cabinet Elevations",
                             drawing_number=f"{num}.{i + 1}")
        _draw_title_band(c, (margin, margin, page_w - margin, margin + band_h),
                         {**project, "settings": page_settings}, show_north=False)


def _draw_elevation(c, e: dict, ox: float, oy: float, k: float) -> None:
    """Draw one elevation's primitives (inches, y up) at offset/scale."""
    P = lambda x, y: (ox + x * k, oy + y * k)
    for pr in e.get("prims") or []:
        t = pr.get("t")
        col = colors.HexColor(pr.get("color") or "#1c1917")
        lw = float(pr.get("lw", 0.5)) * 0.9
        c.setStrokeColor(col)
        c.setLineWidth(max(lw, 0.15))
        c.setDash([2, 1.5] if pr.get("dash") else [])
        if t == "rect":
            x0, y0 = P(pr["x"], pr["y"])
            fill = pr.get("fill")
            stroke = not (pr.get("lw") == 0 or pr.get("stroke") == "none")
            if fill:
                c.setFillColor(colors.HexColor(fill))
            c.rect(x0, y0, pr["w"] * k, pr["h"] * k, stroke=1 if stroke else 0, fill=1 if fill else 0)
        elif t == "line":
            c.line(*P(pr["x1"], pr["y1"]), *P(pr["x2"], pr["y2"]))
        elif t == "poly":
            pts = [P(x, y) for x, y in pr["pts"]]
            if len(pts) >= 2:
                fill = pr.get("fill")
                if fill:
                    c.setFillColor(colors.HexColor(fill))
                _poly(c, pts, stroke=True, fill=bool(fill), close=pr.get("closed", True) is not False)
        elif t == "text":
            size = max(3.0, float(pr.get("size", 3)) * k)
            size = min(size, 9.0)
            font = "Helvetica-Bold" if pr.get("bold") else "Helvetica"
            x, y = P(pr["x"], pr["y"])
            y -= size / 3
            text = str(pr.get("s", ""))
            if pr.get("halo"):
                tw = c.stringWidth(text, font, size)
                c.setFillColor(colors.HexColor("#f5efe3"))
                bx = x - tw / 2 if pr.get("anchor", "middle") == "middle" else (x - tw if pr.get("anchor") == "end" else x)
                c.rect(bx - 1, y - 1.5, tw + 2, size + 1.5, stroke=0, fill=1)
            c.setFillColor(col)
            c.setFont(font, size)
            a = pr.get("anchor", "middle")
            if a == "end":
                c.drawRightString(x, y, text)
            elif a == "start":
                c.drawString(x, y, text)
            else:
                c.drawCentredString(x, y, text)
    c.setDash([])


# --- Title band (compact, single horizontal strip) ------------------------

def _draw_title_band(c: rl_canvas.Canvas, rect: tuple, project: dict,
                     show_north: bool = True) -> None:
    """Single-line title strip across the bottom of the page.

    Layout (left to right):
      [BLUEPRINT STUDIO]  Project Name | Drawing | DR.NO | REV  ...  [scale bar] [N]
    """
    settings = project.get("settings") or {}
    x0, y0, x1, y1 = rect
    w = x1 - x0
    h = y1 - y0

    # Outer frame
    c.setStrokeColor(colors.black)
    c.setLineWidth(0.4)
    c.rect(x0, y0, w, h, stroke=1, fill=0)

    # Brand block on far left
    brand_w = min(1.5 * 72, w * 0.18)
    c.setFillColor(colors.HexColor("#1c1f24"))
    c.rect(x0, y0, brand_w, h, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#fbfbf7"))
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x0 + 6, y0 + h / 2 - 3, "BLUEPRINT")
    c.setFont("Helvetica", 6)
    c.drawString(x0 + 6, y0 + h / 2 - 11, "STUDIO")

    # Reset
    c.setFillColor(colors.black)
    c.setStrokeColor(colors.black)

    # Right-edge: scale bar + north arrow
    legend_w = min(2.6 * 72, w * 0.30)
    legend_x = x1 - legend_w
    c.line(legend_x, y0, legend_x, y1)
    _draw_scale_bar(c, (legend_x + 4, y0, x1 - 30, y1), settings)
    if show_north:
        _draw_north_arrow(c, (x1 - 28, y0 + 2, x1 - 4, y1 - 2))

    # Middle: project info — packed columns
    info_x0 = x0 + brand_w + 6
    info_x1 = legend_x - 6
    info_w = info_x1 - info_x0

    # Columns: project (largest), drawing, dwg #, rev, designer, address (if room)
    label_h = 5.5  # pt
    val_h = 9      # pt for project
    val_h_sm = 8

    # Internal vertical separators
    columns = [
        ("PROJECT",   settings.get("project_name") or "Untitled",   2.2, "Helvetica-Bold", val_h),
        ("DRAWING",   settings.get("drawing_title") or "Floor Plan", 1.4, "Helvetica",     val_h_sm),
        ("DWG NO.",   settings.get("drawing_number") or "—",         0.7, "Helvetica-Bold", val_h_sm),
        ("REV",       settings.get("revision") or "—",               0.4, "Helvetica",     val_h_sm),
        ("DESIGNER",  settings.get("designer_name") or "",           0.9, "Helvetica",     val_h_sm),
    ]
    total_weight = sum(col[2] for col in columns)
    cx = info_x0
    for i, (lbl, val, weight, font, vh) in enumerate(columns):
        cw = info_w * (weight / total_weight)
        if i > 0:
            c.line(cx, y0, cx, y1)
        # Label
        c.setFillColor(colors.HexColor("#6b7280"))
        c.setFont("Helvetica-Bold", label_h)
        c.drawString(cx + 4, y1 - 7, lbl)
        # Value
        c.setFillColor(colors.black)
        c.setFont(font, vh)
        # Truncate to fit
        max_w = cw - 8
        text = str(val)
        while c.stringWidth(text, font, vh) > max_w and len(text) > 1:
            text = text[:-1]
            if len(text) < len(str(val)):
                text = text[:-1] + "…"
        c.drawString(cx + 4, y0 + 4, text)
        cx += cw


def _draw_scale_bar(c: rl_canvas.Canvas, rect: tuple, settings: dict) -> None:
    x0, y0, x1, y1 = rect
    print_scale = float(settings.get("print_scale", 1.0 / 48.0))
    label = settings.get("print_scale_label", "")

    paper_per_foot = print_scale * 12.0
    if paper_per_foot <= 0:
        return

    # Aim for ~1.5" paper bar
    target_paper_in = 1.5
    raw_total_ft = target_paper_in / paper_per_foot
    nice_options = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]
    total_ft = min(nice_options, key=lambda x: abs(x - raw_total_ft))
    n_segments = 4
    seg_ft = total_ft / n_segments

    bar_w_pt = total_ft * paper_per_foot * 72.0
    avail_w = x1 - x0 - 8
    if bar_w_pt > avail_w:
        # Reduce
        bar_w_pt = avail_w * 0.95
    bar_h_pt = 5.0

    bx = x0 + 4
    by = y0 + (y1 - y0) / 2 - bar_h_pt / 2 - 2

    # Title
    c.setFillColor(colors.HexColor("#6b7280"))
    c.setFont("Helvetica-Bold", 5.5)
    c.drawString(bx, y1 - 6, "SCALE")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 7)
    c.drawString(bx + 24, y1 - 6, label)

    # Segments
    seg_w = bar_w_pt / n_segments
    c.setStrokeColor(colors.black)
    c.setLineWidth(0.3)
    for i in range(n_segments):
        sx = bx + i * seg_w
        if i % 2 == 0:
            c.setFillColor(colors.black)
        else:
            c.setFillColor(colors.white)
        c.rect(sx, by, seg_w, bar_h_pt, stroke=1, fill=1)

    # End labels only (compact)
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 5.5)
    c.drawCentredString(bx, by - 5, "0'")
    end_label = f"{int(total_ft)}'"
    c.drawCentredString(bx + bar_w_pt, by - 5, end_label)


def _draw_north_arrow(c: rl_canvas.Canvas, rect: tuple) -> None:
    x0, y0, x1, y1 = rect
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    r = min(x1 - x0, y1 - y0) / 2 - 1

    c.setStrokeColor(colors.black)
    c.setLineWidth(0.5)
    c.setFillColor(colors.white)
    c.circle(cx, cy, r, stroke=1, fill=1)

    # Solid black north triangle
    c.setFillColor(colors.black)
    p = c.beginPath()
    p.moveTo(cx, cy + r * 0.85)
    p.lineTo(cx + r * 0.45, cy)
    p.lineTo(cx - r * 0.45, cy)
    p.close()
    c.drawPath(p, stroke=1, fill=1)
    # White south
    c.setFillColor(colors.white)
    p = c.beginPath()
    p.moveTo(cx + r * 0.45, cy)
    p.lineTo(cx, cy - r * 0.85)
    p.lineTo(cx - r * 0.45, cy)
    p.close()
    c.drawPath(p, stroke=1, fill=1)

    # N label
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 5.5)
    c.drawCentredString(cx, cy + r + 0.5, "N")


# --- Cabinet & appliance list page -------------------------------------------

_STOCK = {"3F": ('3" Filler', '3" x 42" filler strip'),
          "6F": ('6" Filler', '6" x 42" filler strip'),
          "3F96": ('3" Filler (96")', '3" x 96" filler strip')}
_CAT_ORDER = {"wall": 0, "base": 1, "corner": 2, "lazy": 3, "tall": 4,
              "vanity": 5, "ada": 6, "filler": 7}


def _draw_list_page(c: rl_canvas.Canvas, items: list, project: dict, prices: bool = False) -> None:
    """Portrait Letter order sheet: cabinets grouped by finish (qty, model,
    size, hinge), fillers rolled up into stock strips, then appliances and
    fixtures. Catalog list prices only when asked for."""
    page_w, page_h = (8.5 * 72, 11 * 72)
    margin = 0.6 * 72
    settings = project.get("settings") or {}

    lines: dict = {}
    fixtures: dict = {}
    fillers: list = []
    for it in items:
        if it.get("type") == "fixture":
            key = it.get("fixture_id") or it.get("name")
            f = fixtures.setdefault(key, {"name": it.get("name") or key, "qty": 0,
                                          "size": f'{_fmt_n(it.get("width", 0))} x {_fmt_n(it.get("depth", 0))}'})
            f["qty"] += 1
            continue
        if it.get("type") != "cabinet":
            continue
        model, desc = it.get("model", ""), it.get("description", "")
        is_filler = bool(it.get("filler")) or it.get("category") == "filler"
        if is_filler:
            model, desc = _STOCK.get(it.get("stock", ""), (model or "Filler", desc))
            fillers.append(float(it.get("width", 0)))
        finish = it.get("finish", "")
        ln = lines.setdefault((finish, model), {
            "finish": finish, "model": model, "desc": desc, "qty": 0,
            "size": "" if is_filler else f'{_fmt_n(it.get("width", 0))} x {_fmt_n(it.get("depth", 0))} x {_fmt_n(it.get("height", 0))}',
            "cat": it.get("category", "base"), "price": float(it.get("price") or 0), "L": 0, "R": 0,
        })
        ln["qty"] += 1
        if not is_filler and float(it.get("width", 99)) <= 24:
            ln[it.get("hinge") or "L"] = ln.get(it.get("hinge") or "L", 0) + 1

    def header(first: bool) -> float:
        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 16 if first else 11)
        c.drawString(margin, page_h - margin, "Cabinet & Appliance List" if first else "Cabinet & Appliance List (cont.)")
        y = page_h - margin - 18
        if first:
            c.setFont("Helvetica", 9.5)
            for label, key in (("Project", "project_name"), ("Address", "project_address"),
                               ("Drawing", "drawing_title"), ("Designer", "designer_name")):
                v = settings.get(key)
                if v:
                    c.drawString(margin, y, f"{label}: {v}")
                    y -= 13
            y -= 4
        return y

    y = header(True)
    col_qty = margin + 22
    col_model = margin + 32
    col_desc = margin + 112
    col_size = page_w - margin - (170 if prices else 70)
    col_hinge = page_w - margin - (120 if prices else 10)
    col_each = page_w - margin - 60
    col_ext = page_w - margin

    def need(h):
        nonlocal y
        if y - h < margin + 20:
            c.showPage()
            c.setPageSize((page_w, page_h))
            y = header(False)

    groups: dict = {}
    for ln in sorted(lines.values(), key=lambda l: (l["finish"], _CAT_ORDER.get(l["cat"], 99), l["model"])):
        groups.setdefault(ln["finish"], []).append(ln)

    grand = 0.0
    grand_qty = 0
    for finish, lns in groups.items():
        need(40)
        qty = sum(l["qty"] for l in lns)
        c.setFillColor(colors.HexColor("#1f1f1f"))
        c.rect(margin, y - 14, page_w - 2 * margin, 15, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(margin + 5, y - 10, f"{finish}  -  {qty} piece{'s' if qty != 1 else ''}")
        y -= 26
        c.setFillColor(colors.HexColor("#6b7280"))
        c.setFont("Helvetica-Bold", 6.5)
        c.drawRightString(col_qty, y, "QTY")
        c.drawString(col_model, y, "MODEL")
        c.drawString(col_desc, y, "DESCRIPTION")
        c.drawRightString(col_size, y, "W x D x H (in)")
        c.drawRightString(col_hinge, y, "HINGE")
        if prices:
            c.drawRightString(col_each, y, "LIST EACH")
            c.drawRightString(col_ext, y, "LIST EXT.")
        y -= 12
        for ln in lns:
            need(14)
            c.setFillColor(colors.black)
            c.setFont("Helvetica-Bold", 9)
            c.drawRightString(col_qty, y, str(ln["qty"]))
            c.drawString(col_model, y, ln["model"])
            c.setFont("Helvetica", 8.5)
            desc = ln["desc"] or ""
            maxw = col_size - col_desc - 60
            while desc and c.stringWidth(desc, "Helvetica", 8.5) > maxw:
                desc = desc[:-2] + "."
            c.drawString(col_desc, y, desc)
            c.drawRightString(col_size, y, ln["size"])
            hinge = " / ".join(f"{ln[k]}{k}" for k in ("L", "R") if ln.get(k))
            c.drawRightString(col_hinge, y, hinge)
            if prices:
                c.drawRightString(col_each, y, _money(ln["price"]))
                c.drawRightString(col_ext, y, _money(ln["price"] * ln["qty"]))
            c.setStrokeColor(colors.HexColor("#e5e5e5"))
            c.setLineWidth(0.4)
            c.line(margin, y - 4, page_w - margin, y - 4)
            y -= 14
            grand += ln["price"] * ln["qty"]
            grand_qty += ln["qty"]
        y -= 8

    if prices and groups:
        need(30)
        c.setFillColor(colors.HexColor("#1f1f1f"))
        c.rect(margin, y - 18, page_w - 2 * margin, 20, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(margin + 6, y - 12, f"TOTAL AT CATALOG LIST PRICE  -  {grand_qty} pieces")
        c.drawRightString(page_w - margin - 6, y - 12, _money(grand))
        y -= 32

    if fillers:
        need(20)
        c.setFillColor(colors.HexColor("#44403c"))
        c.setFont("Helvetica-Oblique", 8.5)
        c.drawString(margin, y, "Fillers to cut on site: " + ", ".join(format_length(w) for w in fillers))
        y -= 18

    if fixtures:
        need(40)
        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(margin, y, "Appliances & fixtures")
        y -= 16
        for f in sorted(fixtures.values(), key=lambda f: f["name"]):
            need(14)
            c.setFont("Helvetica-Bold", 9)
            c.drawRightString(col_qty, y, str(f["qty"]))
            c.setFont("Helvetica", 9)
            c.drawString(col_model, y, f["name"])
            c.drawRightString(col_size, y, f["size"])
            y -= 14

    c.setFillColor(colors.HexColor("#6b7280"))
    c.setFont("Helvetica-Oblique", 7)
    note = "Hinge: L/R count for single-door cabinets as seen from the front. "
    if prices:
        note += "Prices are Kitchen Kompact catalog list; confirm with your distributor."
    c.drawString(margin, margin - 14, note)


def _money(n: float) -> str:
    return "$" + f"{n:,.2f}"

def _fmt_n(n) -> str:
    # Numbers like 34.5, 24, 96.0 — render compactly
    if n == int(n):
        return str(int(n))
    return f"{n:g}"
