"""Tests for the disk parameterization tool."""

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mesh_param import Mesh, TopologyError, distortion_report, parameterize
from mesh_param.test_meshes import curved_sheet, grid_sheet, holed_sheet


@pytest.mark.parametrize("weights", ["uniform", "cotangent"])
@pytest.mark.parametrize("gen", [grid_sheet, curved_sheet])
def test_disk_meshes_parameterize_without_flips(gen, weights):
    mesh = gen(14)
    uv = parameterize(mesh, weights=weights)
    assert uv.shape == (len(mesh.vertices), 2)
    assert np.isfinite(uv).all()
    report = distortion_report(mesh)
    assert report.flipped.sum() == 0


def test_boundary_maps_to_circle_by_arc_length():
    mesh = grid_sheet(10)
    parameterize(mesh, "uniform")
    loop = mesh.boundary_loops[0]
    pts = mesh.uvs[loop]
    radii = np.linalg.norm(pts, axis=1)
    assert np.allclose(radii, 1.0, atol=1e-9)
    # arc-length parameterization: angle increments proportional to edge
    # lengths; the grid boundary has uniform edge lengths, so consecutive
    # angle steps must be (nearly) equal.
    angles = np.unwrap(np.arctan2(pts[:, 1], pts[:, 0]))
    steps = np.diff(angles)
    assert np.allclose(steps, steps[0], rtol=1e-6)


def test_uniform_and_cotangent_differ_on_curved_sheet():
    m1, m2 = curved_sheet(10), curved_sheet(10)
    u1 = parameterize(m1, "uniform")
    u2 = parameterize(m2, "cotangent")
    assert np.abs(u1 - u2).max() > 1e-3


def test_holed_sheet_rejected_with_reason():
    mesh = holed_sheet(12)
    with pytest.raises(TopologyError, match="boundary loops"):
        parameterize(mesh)


def test_closed_surface_rejected():
    # tetrahedron: closed, no boundary
    verts = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], float)
    faces = np.array([[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]])
    mesh = Mesh(vertices=verts, faces=faces)
    with pytest.raises(TopologyError, match="no boundary"):
        parameterize(mesh)


def test_nonmanifold_edge_rejected():
    # two tetra fans sharing one edge -> edge with 3 incident faces
    verts = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0],
                      [0, -1, 0], [0, 0, 1]], float)
    faces = np.array([[0, 1, 2], [0, 3, 1], [0, 1, 4]])
    mesh = Mesh(vertices=verts, faces=faces)
    with pytest.raises(TopologyError, match="non-manifold"):
        parameterize(mesh)


def test_obj_roundtrip_with_uvs(tmp_path):
    mesh = curved_sheet(8)
    parameterize(mesh, "cotangent")
    path = tmp_path / "out.obj"
    mesh.save_obj(str(path))
    text = path.read_text()
    assert "vt " in text and "/" in [l for l in text.splitlines()
                                     if l.startswith("f ")][0]
    loaded = Mesh.load_obj(str(path))
    assert loaded.vertices.shape == mesh.vertices.shape
    assert loaded.faces.shape == mesh.faces.shape
    # re-parameterizing the loaded mesh still works (topology preserved)
    parameterize(loaded, "uniform")
    assert distortion_report(loaded).flipped.sum() == 0


def test_planar_sheet_low_distortion_with_cotangent():
    # Mapping a square to a circle necessarily distorts boundary angles,
    # but cotangent weights should be no worse than uniform on a plane.
    m_uni, m_cot = grid_sheet(16), grid_sheet(16)
    parameterize(m_uni, "uniform")
    parameterize(m_cot, "cotangent")
    d_uni = distortion_report(m_uni).angle_distortion.mean()
    d_cot = distortion_report(m_cot).angle_distortion.mean()
    assert d_cot <= d_uni + 1e-6
    assert d_cot < 15.0
