"""Quantitative comparison of samplings and renderer agreement."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .camera import Camera
from .covariance import ProjectedSplats
from .rasterize import RenderOutput


@dataclass
class DensityMetrics:
    num_points: int
    spacing: float
    hole_fraction: float          # share of footprint pixels with ~no weight
    underfilled_fraction: float   # pixels below half of the dense reference
    mean_coverage: float
    coverage_std: float
    brightness_mean: float
    brightness_cv: float          # coefficient of variation = std/mean


def surface_footprint(
    projected: ProjectedSplats,
    width: int,
    height: int,
    dilate_px: int = 6,
) -> np.ndarray:
    """Boolean mask of pixels covered by the projected point cloud.

    Built by rasterizing solid disks around every projected mean.  Pass the
    dense sampling to obtain the true surface domain that sparse samplings
    are compared against.
    """
    mask = np.zeros((height, width), dtype=bool)
    yy, xx = np.ogrid[:height, :width]
    for mean in projected.uv:
        region = (xx - mean[0]) ** 2 + (yy - mean[1]) ** 2 <= dilate_px**2
        mask |= region
    return mask


def density_metrics(
    output: RenderOutput,
    projected: ProjectedSplats,
    width: int,
    height: int,
    spacing: float,
    footprint: np.ndarray | None = None,
    reference_coverage: float | None = None,
) -> DensityMetrics:
    """Compute holes and brightness statistics over the surface footprint."""
    if footprint is None:
        footprint = surface_footprint(projected, width, height)
    coverage = output.coverage[footprint]
    brightness = output.color[footprint].mean(axis=1)
    mean_brightness = float(brightness.mean())
    reference_coverage = (
        reference_coverage if reference_coverage is not None
        else float(coverage.mean())
    )
    underfilled = float(np.mean(coverage < 0.25 * reference_coverage))
    hole = float(np.mean(coverage < 0.05))
    return DensityMetrics(
        num_points=int(projected.uv.shape[0]),
        spacing=float(spacing),
        hole_fraction=hole,
        underfilled_fraction=underfilled,
        mean_coverage=float(coverage.mean()),
        coverage_std=float(coverage.std()),
        brightness_mean=mean_brightness,
        brightness_cv=float(brightness.std() / max(mean_brightness, 1e-9)),
    )


def renderer_agreement(
    raster_image: np.ndarray,
    reference_image: np.ndarray,
    footprint: np.ndarray,
) -> dict[str, float]:
    """Pixel-level agreement between the fast and reference renderers."""
    diff = np.abs(raster_image - reference_image)
    return {
        "mae_footprint": float(diff[footprint].mean()),
        "max_abs_footprint": float(diff[footprint].max()),
        "mae_full_frame": float(diff.mean()),
    }
