import numpy as np
import pytest

from splat.analysis import surface_footprint
from splat.camera import Camera
from splat.covariance import CovarianceConfig, project_covariances
from splat.rasterize import RasterConfig, render
from splat.reference import elliptical_integral, reference_render


def _camera():
    return Camera(
        width=80,
        height=60,
        fx=100.0,
        fy=100.0,
        cx=40.0,
        cy=30.0,
        eye=np.zeros(3),
        forward=np.array([0.0, 0.0, 1.0]),
        near=0.1,
    )


def test_elliptical_integral_normalizes_to_one():
    mean = np.array([40.0, 30.0])
    cov = np.array([[4.0, 1.0], [1.0, 2.5]])
    cols, rows = np.meshgrid(np.arange(20, 60), np.arange(10, 50))
    boxes = np.stack(
        [cols.ravel(), rows.ravel(), cols.ravel() + 1.0, rows.ravel() + 1.0],
        axis=1,
    )
    total = elliptical_integral(mean, cov, boxes, order=10).sum()
    assert total == pytest.approx(1.0, abs=1e-6)


def test_integral_quadrature_orders_converge():
    mean = np.array([40.3, 29.7])
    cov = np.diag([3.0, 1.5])
    boxes = np.array([[39.0, 29.0, 40.0, 30.0]])
    exact = elliptical_integral(mean, cov, boxes, order=24)[0]
    coarse = elliptical_integral(mean, cov, boxes, order=2)[0]
    fine = elliptical_integral(mean, cov, boxes, order=8)[0]
    assert abs(fine - exact) < abs(coarse - exact)
    assert abs(fine - exact) < 1e-8


def test_raster_matches_reference_within_sampling_error():
    camera = _camera()
    points = np.array(
        [[0.0, 0.0, 2.0], [0.2, 0.1, 2.1], [-0.15, -0.1, 1.9]]
    )
    cov = np.array(
        [
            np.diag([0.03, 0.01, 0.02]),
            np.diag([0.01, 0.03, 0.02]),
            np.diag([0.02, 0.02, 0.01]),
        ]
    )
    colors = np.array([[1.0, 0.2, 0.2], [0.2, 1.0, 0.2], [0.2, 0.2, 1.0]])
    projected = project_covariances(camera, points, cov)
    config = RasterConfig(mode="additive")
    raster = render(projected, colors, 80, 60, config).color
    reference = reference_render(
        projected, colors, 80, 60, config, order=8
    )
    footprint = surface_footprint(projected, 80, 60)
    mae = np.abs(raster - reference)[footprint].mean()
    assert mae < 0.01


def test_larger_splats_reduce_reference_disagreement():
    camera = _camera()
    points = np.array([[0.0, 0.0, 2.0]])
    colors = np.ones((1, 3))
    config = RasterConfig(mode="additive")
    errors = []
    for scale in (0.5, 2.0):
        cov = np.array([np.eye(3) * 0.01 * scale**2])
        projected = project_covariances(camera, points, cov)
        raster = render(projected, colors, 80, 60, config).color
        reference = reference_render(
            projected, colors, 80, 60, config, order=8
        )
        mask = surface_footprint(projected, 80, 60)
        errors.append(float(np.abs(raster - reference)[mask].mean()))
    assert errors[1] < errors[0]


def test_alpha_mode_stays_in_unit_interval():
    camera = _camera()
    points = np.random.default_rng(0).uniform(-0.3, 0.3, size=(20, 3))
    points[:, 2] += 2.0
    cov = np.repeat(np.eye(3)[None] * 0.02, 20, axis=0)
    colors = np.ones((20, 3))
    projected = project_covariances(camera, points, cov)
    output = render(
        projected,
        colors,
        80,
        60,
        RasterConfig(mode="alpha", opacity=0.9, background=(1.0, 1.0, 1.0)),
    )
    assert output.color.min() >= 0.0
    assert output.color.max() <= 1.0


def test_culled_splats_are_not_drawn():
    camera = _camera()
    points = np.array([[0.0, 0.0, 0.11]])
    cov = np.array([np.eye(3) * 5.0])
    projected = project_covariances(
        camera,
        points,
        cov,
        CovarianceConfig(max_radius_px=20.0),
    )
    output = render(
        projected, np.ones((1, 3)), 80, 60, RasterConfig(mode="additive")
    )
    assert output.coverage.max() == 0.0
    assert output.drawn_index.size == 0
