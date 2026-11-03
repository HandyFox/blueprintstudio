"""PDF export: true scale, fixtures, cabinets, elevations and the order list."""
import io
import json
import os

from conftest import login

HERE = os.path.dirname(os.path.abspath(__file__))


def kitchen():
    return {
        "settings": {"project_name": "Test Kitchen", "drawing_title": "Kitchen",
                     "print_scale": 1 / 48, "print_scale_label": "1/4\" = 1'-0\""},
        "layers": [],
        "items": [
            {"type": "wall", "start": [0, 0], "end": [144, 0], "thickness": 4.5, "openings": [
                {"kind": "window", "offset": 72, "width": 36, "height": 36, "sill": 42}]},
            {"type": "cabinet", "model": "36LS", "category": "lazy", "shape": "L", "width": 36,
             "depth": 36, "height": 34.5, "elevation": 0, "pos": [18, 20.25], "rotation": 0,
             "finish": "Gray", "price": 544},
            {"type": "cabinet", "model": "30B", "category": "base", "width": 30, "depth": 24,
             "height": 34.5, "elevation": 0, "pos": [51, 14.25], "rotation": 0, "finish": "Gray",
             "price": 586, "hinge": "L"},
            {"type": "cabinet", "model": "30W", "category": "wall", "width": 30, "depth": 12,
             "height": 30, "pos": [51, 8.25], "rotation": 0, "finish": "Gray", "price": 393},
            {"type": "cabinet", "model": "F3-B", "category": "filler", "filler": True, "stock": "3F",
             "width": 2.5, "depth": 24, "height": 34.5, "elevation": 0, "pos": [67.25, 14.25],
             "rotation": 0, "finish": "Gray", "price": 48},
            {"type": "fixture", "fixture_id": "dishwasher24", "name": "Dishwasher 24\"", "label": "DW",
             "width": 24, "depth": 24, "height": 34.5, "elevation": 0, "pos": [80.5, 14.25], "rotation": 0},
            {"type": "fixture", "fixture_id": "toilet", "name": "Toilet", "width": 20, "depth": 30,
             "height": 30, "elevation": 0, "pos": [120, 60], "rotation": 1.5707963},
        ],
    }


def pages(pdf_bytes):
    return pdf_bytes.count(b"/Type /Page") - pdf_bytes.count(b"/Type /Pages")


def test_pdf_with_everything(client):
    login(client)
    elev = {"title": "Elevation A", "letter": "A", "width": 70, "height": 96,
            "bounds": {"x0": -24, "y0": -18, "x1": 84, "y1": 100},
            "marker": {"x": 40, "y": 60, "dir": -1.5708},
            "prims": [{"t": "rect", "x": 0, "y": 0, "w": 30, "h": 34.5, "fill": "#f5efe3"},
                      {"t": "line", "x1": 0, "y1": 0, "x2": 30, "y2": 0, "dash": True},
                      {"t": "poly", "pts": [[0, 0], [10, 10], [20, 0]], "closed": True},
                      {"t": "text", "x": 15, "y": 20, "s": "30B", "size": 3, "bold": True, "halo": True}]}
    r = client.post("/api/export-pdf", json={
        "project": kitchen(), "page_size": "Tabloid", "landscape": True,
        "elevations": [elev], "cabinet_list": {"include": True, "prices": True}})
    assert r.status_code == 200, r.data[:300]
    assert r.data[:5] == b"%PDF-"
    assert pages(r.data) == 3     # plan + elevation + list


def test_pdf_without_extras(client):
    login(client)
    r = client.post("/api/export-pdf", json={
        "project": kitchen(), "elevations": [], "cabinet_list": {"include": False}})
    assert r.status_code == 200 and pages(r.data) == 1


def test_sample_file_still_exports(client):
    login(client)
    with open(os.path.join(HERE, "..", "sample.bpsj")) as f:
        project = json.load(f)
    r = client.post("/api/export-pdf", json={"project": project})
    assert r.status_code == 200 and r.data[:5] == b"%PDF-"


def test_true_scale():
    """A 60" wall at 1/4"=1' must be 1.25" (90 pt) long on paper."""
    from app.lib import pdf_export
    calls = []
    orig = pdf_export._paint_wall

    def spy(c, w, items, state):
        calls.append(state["s"])
        return orig(c, w, items, state)
    pdf_export._paint_wall = spy
    try:
        pdf_export.build_pdf({"settings": {"print_scale": 1 / 48}, "items": [
            {"type": "wall", "start": [0, 0], "end": [60, 0], "thickness": 4.5, "openings": []}]})
    finally:
        pdf_export._paint_wall = orig
    assert abs(calls[0] * 60 - 90) < 1e-6


def test_fixture_library_matches_js_twin():
    """Every fixture in the shared library converts to paths in Python."""
    from app.lib.pdf_export import FIXTURES, prims_to_paths
    assert len(FIXTURES) >= 40
    for f in FIXTURES.values():
        assert prims_to_paths(f["plan"], f["width"], f["depth"], "plan")
        assert prims_to_paths(f["elev"], f["width"], f["height"], "elev")
