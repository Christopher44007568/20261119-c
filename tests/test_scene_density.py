import numpy as np

from splat.analysis import density_metrics, surface_footprint
from splat.covariance import project_covariances
from splat.rasterize import RasterConfig, render
from splat.scene import (
    degenerate_cloud,
    make_density_pair,
    ripple_surface,
    sample_surface,
)

from splat.camera import look_at


def _overview_camera():
    return look_at(
        eye=np.array([0.0, -0.7, 2.7]),
        target=np.array([0.0, 0.0, 0.05]),
        up=np.array([0.0, 0.0, 1.0]),
        width=100,
        height=80,
        fov_y_deg=42.0,
        near=0.1,
    )


def test_samplings_share_one_continuous_surface():
    dense, sparse = make_density_pair()
    # Every sampled point lies exactly on the shared implicit surface.
    for cloud in (dense, sparse):
        z_expected = ripple_surface(cloud.points[:, 0], cloud.points[:, 1])
        np.testing.assert_allclose(cloud.points[:, 2], z_expected, atol=1e-12)
    assert dense.points.shape[0] > sparse.points.shape[0]


def test_adaptive_splats_preserve_coverage_across_density():
    camera = _overview_camera()
    dense, sparse = make_density_pair()
    config = RasterConfig(mode="additive")
    proj_d = project_covariances(camera, dense.points, dense.covariances)
    out_d = render(proj_d, dense.colors, 100, 80, config)
    proj_s = project_covariances(camera, sparse.points, sparse.covariances)
    out_s = render(proj_s, sparse.colors, 100, 80, config)
    footprint = surface_footprint(proj_d, 100, 80)
    metrics_s = density_metrics(
        out_s, proj_s, 100, 80, sparse.spacing, footprint=footprint,
        reference_coverage=float(out_d.coverage[footprint].mean()),
    )
    # Properly scaled elliptical splats keep the sparse surface nearly full.
    assert metrics_s.hole_fraction < 0.05


def test_fixed_splat_size_exposes_sparse_holes():
    camera = _overview_camera()
    dense, sparse = make_density_pair()
    config = RasterConfig(mode="additive")
    shared = np.eye(3) * (0.5 * dense.spacing) ** 2
    proj_d = project_covariances(
        camera, dense.points, np.repeat(shared[None], dense.points.shape[0], 0)
    )
    out_d = render(proj_d, dense.colors, 100, 80, config)
    proj_s = project_covariances(
        camera, sparse.points, np.repeat(shared[None], sparse.points.shape[0], 0)
    )
    out_s = render(proj_s, sparse.colors, 100, 80, config)
    footprint = surface_footprint(proj_d, 100, 80)
    metrics_s = density_metrics(
        out_s, proj_s, 100, 80, sparse.spacing, footprint=footprint,
        reference_coverage=float(out_d.coverage[footprint].mean()),
    )
    assert metrics_s.hole_fraction > 0.2
    assert metrics_s.brightness_mean < 0.5


def test_anisotropic_cloud_has_non_circular_screen_ellipses():
    cloud = sample_surface("aniso", 0.2, anisotropy=3.0)
    camera = _overview_camera()
    projected = project_covariances(camera, cloud.points, cloud.covariances)
    ellipses = projected.ellipses()
    assert np.mean(ellipses[:, 0] / np.maximum(ellipses[:, 1], 1e-9)) > 2.0


def test_degenerate_cloud_repairs_every_bad_matrix():
    cloud = degenerate_cloud()
    camera = _overview_camera()
    projected = project_covariances(camera, cloud.points, cloud.covariances)
    for matrix in projected.cov2d:
        assert np.all(np.linalg.eigvalsh(matrix) > 0.0)
    # The five intentionally broken 3D matrices must all be repaired/recorded.
    from splat.corrections import CorrectionLog

    log = CorrectionLog()
    project_covariances(camera, cloud.points, cloud.covariances, log=log)
    bad_indices = {1, 2, 3, 4, 5}
    assert bad_indices.issubset(set(log.point_index))
