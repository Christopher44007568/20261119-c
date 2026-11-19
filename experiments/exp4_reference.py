"""Cross-check against the small-scale CPU elliptical integral reference."""

from __future__ import annotations

import matplotlib.pyplot as plt
import numpy as np

from splat.analysis import renderer_agreement, surface_footprint
from splat.covariance import project_covariances
from splat.rasterize import RasterConfig, render
from splat.reference import elliptical_integral, reference_render
from splat.scene import sample_surface

from .common import save_figure, standard_camera


def main():
    width, height = 120, 96
    camera = standard_camera(width, height)
    cloud = sample_surface("reference", 0.22, extent=1.0, anisotropy=2.0)
    config = RasterConfig(mode="additive", cutoff_sigma=3.0)
    projected = project_covariances(camera, cloud.points, cloud.covariances)
    raster = render(projected, cloud.colors, width, height, config)
    footprint = surface_footprint(projected, width, height)

    print("=== reference Gauss-Legendre order convergence ===")
    reference_images = {}
    for order in (2, 4, 8, 16):
        ref_image = reference_render(
            projected, cloud.colors, width, height, config, order=order
        )
        reference_images[order] = ref_image
    for order in (2, 4, 8, 16):
        ref_image = reference_images[order]
        stats = renderer_agreement(raster.color, ref_image, footprint)
        convergence = (
            float(np.abs(ref_image - reference_images[16]).mean())
            if order != 16
            else 0.0
        )
        print(
            f"order={order:2d}  MAE(footprint)={stats['mae_footprint']:.5f} "
            f"max={stats['max_abs_footprint']:.5f} "
            f"delta_vs_order16={convergence:.2e}"
        )

    # Convergence of a single-pixel elliptical integral against order 24.
    cov2d = projected.cov2d[0]
    mean = projected.uv[0]
    base = np.floor(mean)
    boxes = np.array([[base[0], base[1], base[0] + 1, base[1] + 1]])
    exact = elliptical_integral(mean, cov2d, boxes, order=24)[0]
    orders = (1, 2, 3, 4, 6, 8, 12)
    errors = [
        abs(elliptical_integral(mean, cov2d, boxes, order=o)[0] - exact)
        for o in orders
    ]
    print("\nsingle-pixel integral convergence:")
    for order, error in zip(orders, errors):
        print(f"  order={order:2d} error={error:.3e}")

    # Pixel-center sampling error shrinks for larger splats.
    print("\nraster-vs-reference error vs splat size:")
    for scale in (0.5, 1.0, 2.0, 4.0):
        scaled_projection = project_covariances(
            camera, cloud.points, cloud.covariances * scale**2
        )
        fast = render(
            scaled_projection, cloud.colors, width, height, config
        )
        slow = reference_render(
            scaled_projection, cloud.colors, width, height, config, order=8
        )
        mask = surface_footprint(scaled_projection, width, height)
        stats = renderer_agreement(fast.color, slow, mask)
        print(
            f"  splat scale x{scale:3.1f}  MAE={stats['mae_footprint']:.5f} "
            f"max={stats['max_abs_footprint']:.5f}"
        )

    fig, axes = plt.subplots(1, 3, figsize=(14, 4.4))
    axes[0].imshow(raster.color)
    axes[0].set_title("Fast pixel-center rasterizer")
    axes[1].imshow(reference_images[8])
    axes[1].set_title("CPU GL-8 elliptical integral reference")
    diff = np.abs(raster.color - reference_images[8]).mean(axis=2)
    im = axes[2].imshow(diff, cmap="magma")
    axes[2].set_title("Per-pixel absolute difference")
    fig.colorbar(im, ax=axes[2], fraction=0.046)
    for ax in axes:
        ax.set_xticks([])
        ax.set_yticks([])
    fig.tight_layout()
    path = save_figure(fig, "exp4_reference_match.png")
    print(f"saved {path}")


if __name__ == "__main__":
    main()
