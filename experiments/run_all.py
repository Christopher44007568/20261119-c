"""Run every experiment and persist the numeric results as JSON."""

from __future__ import annotations

import json
import os
from dataclasses import asdict

import numpy as np

from splat.analysis import density_metrics, surface_footprint
from splat.covariance import CovarianceConfig, project_covariances
from splat.corrections import CorrectionLog
from splat.rasterize import RasterConfig, render
from splat.reference import elliptical_integral, reference_render
from splat.scene import degenerate_cloud, make_density_pair

from .common import ARTIFACT_DIR, standard_camera
from . import exp1_density, exp2_axes_weights, exp3_near_plane, exp4_reference, exp5_degenerate


def _density_summary():
    width, height = 200, 160
    camera = standard_camera(width, height)
    dense, sparse = make_density_pair(0.08, 0.26, anisotropy=2.2)
    config = RasterConfig(mode="additive")
    proj_d = project_covariances(camera, dense.points, dense.covariances)
    out_d = render(proj_d, dense.colors, width, height, config)
    proj_s = project_covariances(camera, sparse.points, sparse.covariances)
    out_s = render(proj_s, sparse.colors, width, height, config)
    footprint = surface_footprint(proj_d, width, height)
    ref_cov = float(out_d.coverage[footprint].mean())
    shared = np.eye(3) * (0.5 * dense.spacing) ** 2
    proj_fixed = project_covariances(
        camera, sparse.points,
        np.repeat(shared[None], sparse.points.shape[0], axis=0),
    )
    out_fixed = render(
        proj_fixed, sparse.colors, width, height, config
    )
    return {
        "adaptive_dense": asdict(
            density_metrics(out_d, proj_d, width, height, dense.spacing,
                            footprint, ref_cov)
        ),
        "adaptive_sparse": asdict(
            density_metrics(out_s, proj_s, width, height, sparse.spacing,
                            footprint, ref_cov)
        ),
        "fixed_size_sparse": asdict(
            density_metrics(out_fixed, proj_fixed, width, height,
                            sparse.spacing, footprint, ref_cov)
        ),
    }


def _reference_summary():
    width, height = 120, 96
    camera = standard_camera(width, height)
    rng_cloud = make_density_pair()[0]
    config = RasterConfig(mode="additive")
    projected = project_covariances(
        camera, rng_cloud.points, rng_cloud.covariances
    )
    raster = render(projected, rng_cloud.colors, width, height, config)
    orders = {}
    for order in (2, 4, 8, 16):
        ref_image = reference_render(
            projected, rng_cloud.colors, width, height, config, order=order
        )
        footprint = surface_footprint(projected, width, height)
        orders[f"gl_order_{order}"] = float(
            np.abs(raster.color - ref_image)[footprint].mean()
        )
    mean = projected.uv[0]
    cov2d = projected.cov2d[0]
    box = np.array([[np.floor(mean[0]), np.floor(mean[1]),
                     np.floor(mean[0]) + 1, np.floor(mean[1]) + 1]])
    exact = elliptical_integral(mean, cov2d, box, order=24)[0]
    orders["single_pixel_order_convergence"] = {
        str(order): float(
            abs(elliptical_integral(mean, cov2d, box, order=order)[0] - exact)
        )
        for order in (1, 2, 3, 4, 6, 8, 12)
    }
    return orders


def _correction_summary():
    camera = standard_camera(180, 140)
    cloud = degenerate_cloud()
    log = CorrectionLog()
    projected = project_covariances(
        camera, cloud.points, cloud.covariances,
        CovarianceConfig(max_radius_px=400.0), log,
    )
    min_eig = float(min(
        np.linalg.eigvalsh(0.5 * (m + m.T)).min() for m in projected.cov2d
    ))
    return {
        "input_points": int(cloud.points.shape[0]),
        "corrections": len(log),
        "reason_counts": log.summary(),
        "repaired_indices": log.point_index,
        "min_2d_eigenvalue_after_repair": min_eig,
    }


def main():
    print("Running experiment scripts...")
    exp1_density.main()
    exp2_axes_weights.main()
    exp3_near_plane.main()
    exp4_reference.main()
    exp5_degenerate.main()

    metrics = {
        "density_study": _density_summary(),
        "reference_agreement": _reference_summary(),
        "covariance_repair": _correction_summary(),
    }
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    path = os.path.abspath(os.path.join(ARTIFACT_DIR, "metrics.json"))
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(metrics, handle, indent=2)
    print(f"\nwrote metrics to {path}")


if __name__ == "__main__":
    main()
