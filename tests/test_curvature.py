import numpy as np

from hatching.analytics import curvature_errors, direction_errors, ground_truth
from hatching.curvature import estimate_curvature
from hatching.mesh import make_mesh


def test_cylinder_curvature_and_direction_exact():
    mesh = make_mesh("cylinder")
    curv = estimate_curvature(mesh)
    mae, cmax = curvature_errors(mesh, curv)
    assert mae < 0.05
    assert cmax < 0.25
    median, p90, _, mask = direction_errors(mesh, curv)
    assert mask.mean() > 0.95
    assert median < 5.0
    assert p90 < 10.0


def test_saddle_directions_track_analytic_principal_field():
    mesh = make_mesh("saddle")
    curv = estimate_curvature(mesh)
    median, p90, dmax, mask = direction_errors(mesh, curv)
    assert mask.mean() > 0.7
    assert median < 8.0
    assert p90 < 20.0
    assert dmax < 30.0


def test_plane_and_sphere_are_fully_degenerate():
    for name in ("plane", "sphere"):
        mesh = make_mesh(name)
        curv = estimate_curvature(mesh)
        assert not curv.confident.any()
        assert np.allclose(curv.k1, curv.k2, atol=0.6)


def test_saddle_has_confident_and_fallback_regions():
    mesh = make_mesh("saddle")
    curv = estimate_curvature(mesh)
    assert curv.confident.mean() > 0.7
    assert (~curv.confident).sum() > 0
