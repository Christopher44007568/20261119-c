import numpy as np

from hatching.curvature import estimate_curvature
from hatching.field import build_fallback_field
from hatching.mesh import make_mesh


def test_fallback_field_is_unit_length_and_tangent_everywhere():
    for name in ("plane", "sphere", "saddle", "cylinder"):
        mesh = make_mesh(name)
        curv = estimate_curvature(mesh)
        directions, source = build_fallback_field(mesh, curv)
        assert np.allclose(np.linalg.norm(directions, axis=1), 1.0, atol=1e-8)
        tangent = np.abs(np.einsum("ij,ij->i", directions, mesh.normals))
        assert tangent.max() < 1e-8
        assert set(np.unique(source)) <= {"principal", "transport", "reference"}


def test_fully_flat_plane_uses_reference_seed_without_unset_vertices():
    mesh = make_mesh("plane")
    curv = estimate_curvature(mesh)
    _, source = build_fallback_field(mesh, curv)
    assert (source == "reference").all()


def test_cylinder_confident_field_uses_principal_directions():
    mesh = make_mesh("cylinder")
    curv = estimate_curvature(mesh)
    _, source = build_fallback_field(mesh, curv)
    assert (source == "principal").all()


def test_sphere_fallback_field_is_smooth_between_neighbours():
    # Parallel transport must avoid arbitrary sign flips: adjacent unit
    # vectors should agree in sign, i.e. |dot| stays close to +1.
    mesh = make_mesh("sphere")
    curv = estimate_curvature(mesh)
    directions, _ = build_fallback_field(mesh, curv)
    edges = np.asarray(list(mesh.edge_faces.keys()))
    dots = np.einsum("ij,ij->i", directions[edges[:, 0]],
                     directions[edges[:, 1]])
    # Allow some spread near the unavoidable transport singularity only.
    assert np.median(dots) > 0.9
    assert (dots > 0.5).mean() > 0.85
