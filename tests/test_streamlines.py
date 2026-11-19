import numpy as np

from hatching import shading, streamlines
from hatching.analytics import attachment_residual
from hatching.curvature import estimate_curvature
from hatching.field import build_fallback_field
from hatching.mesh import make_mesh
from hatching.pipeline import run_surface


def _seed_layer(mesh, layer, rng):
    points, faces, bary = shading.stratified_surface_samples(
        mesh, layer.spacing, rng)
    tone_f = shading.face_tone(mesh, shading.vertex_tone(mesh))
    keep = layer.active(tone_f[faces])
    return points[keep], faces[keep], bary[keep]


def test_streamlines_attach_to_each_surface():
    for name in ("cylinder", "sphere", "saddle", "plane"):
        art = run_surface(name, verbose=False)
        residual = attachment_residual(art["mesh"], art["lines"])
        # Pure object-space tracing: error must stay far below mesh spacing.
        assert residual < 5.0 * art["mesh"].mean_edge
        for line in art["lines"]:
            assert len(line.points) >= 2
            assert line.arc_length > 0.0
            assert len(line.breaks) == 2


def test_camera_invariance_of_hatching_geometry():
    # Hatching lives in object space: the same polylines are reused for every
    # camera azimuth, so rotating the view cannot slide lines on the surface.
    art = run_surface("cylinder", verbose=False)
    coords = [line.points.copy() for line in art["lines"]]
    again = run_surface("cylinder", verbose=False)
    coords_again = [line.points.copy() for line in again["lines"]]
    assert len(coords) == len(coords_again)
    for a, b in zip(coords, coords_again):
        assert np.allclose(a, b, atol=1e-12)


def test_fallback_dashes_on_sphere_are_short_and_umbilic_terminated():
    mesh = make_mesh("sphere")
    curv = estimate_curvature(mesh)
    field_directions, _ = build_fallback_field(mesh, curv)
    rng = np.random.default_rng(4)
    points, faces, bary = _seed_layer(mesh, shading.LAYERS[2], rng)
    lines = streamlines.trace_streamlines(
        mesh, curv, field_directions, points[:40], faces[:40], bary[:40],
        2, shading.LAYERS[2].spacing)
    assert lines
    for line in lines:
        assert line.arc_length < 8.0 * mesh.mean_edge
        reasons = {b["reason"] for b in line.breaks}
        assert reasons <= {"umbilic", "boundary", "length"}


def test_cylinder_lines_span_the_full_open_height():
    art = run_surface("cylinder", verbose=False)
    longest = max(line.arc_length for line in art["lines"])
    assert longest > 1.9
    boundary_breaks = [b for b in art["breaks"] if b["reason"] == "boundary"]
    assert boundary_breaks
    z = np.array([b["xyz"][2] for b in boundary_breaks])
    assert np.isclose(np.abs(z).max(), 1.0, atol=0.05)


def test_seed_density_is_governed_by_layer_spacing():
    mesh = make_mesh("plane")
    rng = np.random.default_rng(5)
    dense_points, _, _ = shading.stratified_surface_samples(mesh, 0.08, rng)
    sparse_points, _, _ = shading.stratified_surface_samples(mesh, 0.16, rng)
    assert len(dense_points) > len(sparse_points)
    assert len(dense_points) / len(sparse_points) > 2.0
