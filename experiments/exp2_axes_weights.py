"""Visualize projected principal axes and per-pixel coverage weights."""

from __future__ import annotations

import matplotlib.pyplot as plt
import numpy as np

from splat.covariance import project_covariances
from splat.rasterize import RasterConfig, render
from splat.scene import sample_surface

from .common import draw_ellipse_axes, save_figure, standard_camera


def main():
    width, height = 200, 160
    camera = standard_camera(width, height)
    cloud = sample_surface("medium", 0.16, anisotropy=2.2)
    projected = project_covariances(camera, cloud.points, cloud.covariances)
    output = render(
        projected, cloud.colors, width, height, RasterConfig(mode="additive")
    )

    fig, axes = plt.subplots(1, 3, figsize=(15, 4.6))
    axes[0].imshow(output.color)
    axes[0].set_title("Rendered color (additive elliptical splats)")

    axes[1].imshow(output.color, alpha=0.55)
    draw_ellipse_axes(axes[1], projected, scale=1.0)
    axes[1].set_xlim(0, width)
    axes[1].set_ylim(height, 0)
    axes[1].set_title("Principal axes (red = major, green = minor, 1-sigma)")

    im = axes[2].imshow(output.coverage, cmap="viridis")
    axes[2].set_title("Accumulated coverage weight")
    fig.colorbar(im, ax=axes[2], fraction=0.046)

    for ax in axes:
        ax.set_xticks([])
        ax.set_yticks([])
    fig.tight_layout()
    path = save_figure(fig, "exp2_axes_and_weights.png")

    ellipses = projected.ellipses()
    print("projected ellipse statistics (pixels):")
    print(
        f"  major axis a: min={ellipses[:, 0].min():.2f} "
        f"mean={ellipses[:, 0].mean():.2f} max={ellipses[:, 0].max():.2f}"
    )
    print(
        f"  minor axis b: min={ellipses[:, 1].min():.2f} "
        f"mean={ellipses[:, 1].mean():.2f} max={ellipses[:, 1].max():.2f}"
    )
    print(
        "  axis ratio a/b: "
        f"mean={(ellipses[:, 0] / np.maximum(ellipses[:, 1], 1e-9)).mean():.2f}"
    )
    print(f"saved {path}")


if __name__ == "__main__":
    main()
