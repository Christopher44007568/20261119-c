import numpy as np

from hatching.mesh import make_mesh


def test_meshes_are_watertight_or_have_consistent_boundary():
    for name in ("cylinder", "sphere", "saddle", "plane"):
        mesh = make_mesh(name)
        assert mesh.n_vertices > 100
        assert mesh.faces.shape[1] == 3
        assert np.allclose(np.linalg.norm(mesh.normals, axis=1), 1.0)
        assert np.isfinite(mesh.face_areas).all()
        if name == "sphere":
            assert len(mesh.boundary_edges) == 0
            assert (mesh.face_adj >= 0).all()
        else:
            assert len(mesh.boundary_edges) > 0
            boundary_face_slots = (mesh.face_adj < 0).sum()
            assert boundary_face_slots == len(mesh.boundary_edges)


def test_projection_maps_points_back_onto_surface():
    rng = np.random.default_rng(0)
    for name in ("cylinder", "sphere", "saddle", "plane"):
        mesh = make_mesh(name)
        perturbed = mesh.vertices + rng.normal(0, 0.02, mesh.vertices.shape)
        snapped = mesh.project(perturbed)
        # Re-projecting an already-on-surface point is the identity.
        again = mesh.project(snapped)
        assert np.allclose(snapped, again, atol=1e-10)
        if name == "plane":
            assert np.allclose(snapped[:, 2], 0.0)
        if name == "sphere":
            assert np.allclose(np.linalg.norm(snapped, axis=1), 1.0, atol=1e-10)
