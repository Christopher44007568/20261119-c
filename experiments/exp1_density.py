"""Density study: the same continuous surface at two sampling densities.

Compares holes and brightness variation, and includes a fixed-size-circle
baseline (identical circular splat for every point regardless of its 3D
covariance) to show why per-point elliptical covariance is required.
"""

from __future__ import annotations

import numpy as np
import matplotlib.pyplot as plt

from splat.analysis import density_metrics, surface_footprint
from splat.covariance import project_covariances
from splat.rasterize import RasterConfig, render
from splat.scene import make_density_pair

from .common import save_figure, standard_camera


def fixed_circle_covariances(points: np.ndarray, radius_world: float) -> np.ndarray:
    """Identical isotropic covariance for every point (the naive baseline)."""
    return np.repeat(
        (radius_world**2 * np.eye(3))[None], points.shape[0], axis=0
    )


def main():
    width, height = 200, 160
    camera = standard_camera(width, height)
    dense, sparse = make_density_pair(
        dense_spacing=0.08, sparse_spacing=0.26, anisotropy=2.2
    )
    config = RasterConfig(mode="additive")

    def run_scenario(label: str, dense_cov, sparse_cov):
        proj_d = project_covariances(camera, dense.points, dense_cov)
        out_d = render(proj_d, dense.colors, width, height, config)
        proj_s = project_covariances(camera, sparse.points, sparse_cov)
        out_s = render(proj_s, sparse.colors, width, height, config)
        footprint = surface_footprint(proj_d, width, height)
        ref_cov = float(out_d.coverage[footprint].mean())
        metrics_d = density_metrics(
            out_d, proj_d, width, height, dense.spacing,
            footprint=footprint, reference_coverage=ref_cov,
        )
        metrics_s = density_metrics(
            out_s, proj_s, width, height, sparse.spacing,
            footprint=footprint, reference_coverage=ref_cov,
        )
        print(f"\n=== {label} ===")
        for tag, metrics in (("dense", metrics_d), ("sparse", metrics_s)):
            print(
                f"{tag:7s} n={metrics.num_points:5d} holes={metrics.hole_fraction:.4f} "
                f"underfilled={metrics.underfilled_fraction:.4f} "
                f"brightness={metrics.brightness_mean:.3f} cv={metrics.brightness_cv:.3f}"
            )
        return out_d, out_s, metrics_d, metrics_s

    # Scenario A: covariance follows local spacing (proper EWA behavior).
    adaptive = run_scenario(
        "A. adaptive per-point elliptical covariance",
        dense.covariances, sparse.covariances,
    )
    # Scenario B: keep the true anisotropic shape/orientation but freeze the
    # physical scale at the dense spacing (no per-density adaptation).
    scale_ratio = (dense.spacing / sparse.spacing) ** 2
    fixed_ellipse_d = dense.covariances
    fixed_ellipse_s = sparse.covariances * scale_ratio
    same_size = run_scenario(
        "B. identical physical splat size (density stress test)",
        fixed_ellipse_d, fixed_ellipse_s,
    )
    # Scenario C: naive fixed-size circles, ignoring 3D covariance entirely.
    circle_cov_d = fixed_circle_covariances(dense.points, 0.5 * dense.spacing)
    circle_cov_s = fixed_circle_covariances(sparse.points, 0.5 * dense.spacing)
    circles = run_scenario(
        "C. fixed-size circles (no per-point covariance)",
        circle_cov_d, circle_cov_s,
    )

    fig, axes = plt.subplots(3, 2, figsize=(9.5, 11))
    scenario_rows = [
        ("A. adaptive elliptical covariance", adaptive),
        ("B. same physical splat size", same_size),
        ("C. fixed-size circles", circles),
    ]
    for row, (label, scenario) in enumerate(scenario_rows):
        out_d, out_s = scenario[0], scenario[1]
        axes[row, 0].imshow(out_d.color)
        axes[row, 0].set_title(f"{label}\ndense n={dense.points.shape[0]}")
        axes[row, 1].imshow(out_s.color)
        axes[row, 1].set_title(f"sparse n={sparse.points.shape[0]}")
        for ax in axes[row]:
            ax.set_xticks([])
            ax.set_yticks([])
    fig.tight_layout()
    path = save_figure(fig, "exp1_density_comparison.png")
    print(f"\nsaved {path}")
    return adaptive, same_size, circles


if __name__ == "__main__":
    import matplotlib

    matplotlib.use("Agg")
    main()
