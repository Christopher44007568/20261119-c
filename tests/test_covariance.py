import numpy as np
import pytest

from splat.camera import Camera, look_at
from splat.covariance import (
    CovarianceConfig,
    project_covariances,
    repair_covariances_3d,
)
from splat.corrections import CorrectionLog


def _front_camera(near=0.1):
    return Camera(
        width=100,
        height=80,
        fx=120.0,
        fy=120.0,
        cx=50.0,
        cy=40.0,
        eye=np.zeros(3),
        forward=np.array([0.0, 0.0, 1.0]),
        up=np.array([0.0, 1.0, 0.0]),
        near=near,
    )


def test_projection_center_and_scaling():
    camera = _front_camera()
    points = np.array([[0.0, 0.0, 2.0], [0.1, 0.0, 2.0]])
    cov = np.repeat(np.eye(3)[None] * 0.01, 2, axis=0)
    projected = project_covariances(camera, points, cov)
    # First point lies on the optical axis -> principal point.
    np.testing.assert_allclose(projected.uv[0], [50.0, 40.0], atol=1e-9)
    # 0.1 world units at depth 2 -> fx * 0.1 / 2 = 6 pixels to the right.
    assert projected.uv[1, 0] == pytest.approx(56.0, abs=1e-9)


def test_covariance_shrinks_with_depth():
    camera = _front_camera()
    cov = np.repeat(np.eye(3)[None] * 0.01, 2, axis=0)
    near = project_covariances(
        camera, np.array([[0.0, 0.0, 1.0]]), cov[:1]
    )
    far = project_covariances(
        camera, np.array([[0.0, 0.0, 4.0]]), cov[:1]
    )
    # Screen covariance scales as 1/z^2, so four times farther -> 1/16.
    ratio = near.cov2d[0, 0, 0] / far.cov2d[0, 0, 0]
    assert ratio == pytest.approx(16.0, rel=0.02)


def test_anisotropic_projection_is_not_circle():
    camera = _front_camera()
    points = np.array([[0.0, 0.0, 2.0]])
    cov = np.array([np.diag([0.04, 0.0025, 0.01])])
    projected = project_covariances(camera, points, cov)
    eigvals = np.linalg.eigvalsh(projected.cov2d[0])
    ratio = np.sqrt(eigvals[1] / eigvals[0])
    assert ratio > 3.0


def test_repair_makes_positive_definite_and_logs():
    broken = np.array(
        [
            np.zeros((3, 3)),
            np.diag([0.02, -0.01, 0.005]),
            np.eye(3) * 0.02,
        ]
    )
    log = CorrectionLog()
    repaired = repair_covariances_3d(broken, log=log)
    for matrix in repaired:
        eigvals = np.linalg.eigvalsh(matrix)
        assert np.all(eigvals > 0.0)
    # Two broken matrices recorded, the healthy one untouched.
    assert len(log) == 2
    assert set(log.point_index) == {0, 1}
    assert np.allclose(repaired[2], broken[2])


def test_non_symmetric_covariance_is_symmetrized():
    matrix = np.array([[0.02, 0.01, 0.0], [0.0, 0.02, 0.0], [0.0, 0.0, 0.02]])
    log = CorrectionLog()
    repaired = repair_covariances_3d(matrix[None], log=log)[0]
    np.testing.assert_allclose(repaired, repaired.T, atol=1e-12)
    assert any("non_symmetric" in reason for reason in log.reason)


def test_near_plane_points_are_invalid_and_bounded():
    camera = _front_camera(near=0.1)
    points = np.array(
        [[0.0, 0.0, 0.5], [0.0, 0.0, 0.05], [0.0, 0.0, -1.0]]
    )
    cov = np.repeat(np.eye(3)[None] * 0.01, 3, axis=0)
    projected = project_covariances(camera, points, cov)
    assert projected.valid.tolist() == [True, False, False]
    # Only the valid point survives into the screen splat list.
    assert projected.uv.shape[0] == 1


def test_near_clamp_prevents_covariance_divergence():
    camera = _front_camera(near=0.1)
    cov = np.repeat(np.eye(3)[None] * 0.01, 1, axis=0)
    safe = project_covariances(
        camera, np.array([[0.0, 0.0, 0.11]]), cov,
        CovarianceConfig(max_radius_px=10000.0),
    )
    near = project_covariances(
        camera, np.array([[0.0, 0.0, 0.101]]), cov,
        CovarianceConfig(max_radius_px=10000.0),
    )
    # Moving from z=0.11 to z=0.101 must not produce a runaway increase:
    # the clamped covariance stays close to the near-plane bound.
    growth = np.linalg.eigvalsh(near.cov2d[0])[-1] / np.linalg.eigvalsh(
        safe.cov2d[0]
    )[-1]
    assert growth < 1.5


def test_oversized_splat_is_culled_and_recorded():
    camera = _front_camera()
    points = np.array([[0.0, 0.0, 0.11]])
    cov = np.array([np.eye(3) * 1.0])
    log = CorrectionLog()
    config = CovarianceConfig(max_radius_px=50.0)
    projected = project_covariances(camera, points, cov, config, log)
    assert projected.culled.all()
    assert any("radius_exceeds_limit" in reason for reason in log.reason)


def test_look_at_camera_parallel_up_does_not_crash():
    camera = look_at(
        eye=np.array([0.0, 0.0, 0.0]),
        target=np.array([0.0, 0.0, 1.0]),
        up=np.array([0.0, 0.0, 1.0]),
        width=40,
        height=40,
        fov_y_deg=45.0,
    )
    right, up_cam, forward = camera.frame()
    assert np.linalg.norm(right) == pytest.approx(1.0)
    np.testing.assert_allclose(np.cross(right, up_cam), forward, atol=1e-12)
