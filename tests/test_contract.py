"""Contract-style checks: surface tracing, never a screen-space texture."""

import inspect

from hatching import streamlines, visualize
from hatching.pipeline import run_surface


def _code_only(module):
    """Module source with docstrings and comments stripped."""
    source = inspect.getsource(module)
    lines = []
    in_doc = False
    for line in source.splitlines():
        stripped = line.strip()
        if '"""' in stripped:
            in_doc = not in_doc if stripped.count('"""') == 1 else in_doc
            continue
        if in_doc or stripped.startswith("#"):
            continue
        lines.append(line)
    return "\n".join(lines).lower()


def test_tracing_uses_object_space_surface_operators_only():
    source = _code_only(streamlines)
    forbidden = ("gl_Position", "uv(", "texture(", "screen", "ndc",
                 "project_to_screen", "raster")
    for token in forbidden:
        assert token not in source.lower()
    # Positive evidence: analytic surface projection is part of integration.
    assert "mesh.project" in source


def test_visualisation_plots_object_space_polylines_not_textures():
    source = _code_only(visualize)
    assert "imshow" not in source
    assert "pcolormesh" not in source
    assert "plot(" in source  # 3D line segments in object coordinates


def test_every_surface_emits_two_breaks_per_line_and_reports():
    for name in ("cylinder", "sphere", "saddle", "plane"):
        art = run_surface(name, verbose=False)
        assert len(art["breaks"]) == 2 * len(art["lines"])
        for record in art["breaks"]:
            assert record["reason"] in {"boundary", "umbilic", "length"}
            assert record["face"] < art["mesh"].n_faces
            assert len(record["xyz"]) == 3
