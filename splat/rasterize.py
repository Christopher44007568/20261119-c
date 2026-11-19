"""Screen-space rasterization of projected elliptical Gaussians.

Each visible splat contributes, at every pixel inside a configurable
Mahalanobis-radius footprint, the 2D Gaussian weight

    w(x) = exp(-0.5 * (x - mu)^T Sigma^-1 (x - mu))

Two accumulation modes are provided:

* ``"alpha"``: front-to-back alpha compositing with a per-splat opacity
  (the 3DGS-style rendering), with depth-ordered splats.
* ``"additive"``: energy-conserving weighted color accumulation used for the
  density/holes experiment, where brightness can be measured directly.

Splats whose eigenvalues were marked degenerate in projection (too large or
behind the near plane) are skipped rather than drawn as generic circles.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .covariance import ProjectedSplats


@dataclass(frozen=True)
class RasterConfig:
    mode: str = "alpha"            # "alpha" or "additive"
    cutoff_sigma: float = 3.0      # footprint radius in standard deviations
    opacity: float = 0.8           # per-splat peak alpha in alpha mode
    background: tuple[float, float, float] = (0.0, 0.0, 0.0)


@dataclass
class RenderOutput:
    color: np.ndarray              # (H, W, 3) in [0, 1]
    coverage: np.ndarray           # (H, W) accumulated Gaussian weight
    weight_maps: np.ndarray        # (K, H, W) per-splat weights (reference use)
    depth_buffer: np.ndarray       # (H, W) front-most contributing depth
    drawn_index: np.ndarray        # original point indices actually drawn


def _pixel_grid(width: int, height: int) -> np.ndarray:
    cols, rows = np.meshgrid(np.arange(width), np.arange(height))
    return np.stack([cols.astype(float) + 0.5, rows.astype(float) + 0.5], axis=-1)


def splat_footprint(mean: np.ndarray, cov2d: np.ndarray, cutoff: float):
    """Bounding box and inverse covariance for one screen-space splat."""
    eigvals, eigvecs = np.linalg.eigh(0.5 * (cov2d + cov2d.T))
    eigvals = np.maximum(eigvals, 0.0)
    axis = eigvecs * np.sqrt(eigvals)
    extent = cutoff * np.linalg.norm(axis, axis=0)
    min_uv = np.floor(mean - extent).astype(int)
    max_uv = np.ceil(mean + extent).astype(int)
    precision = eigvecs @ np.diag(1.0 / np.maximum(eigvals, 1e-12)) @ eigvecs.T
    return min_uv, max_uv, precision


def render(
    projected: ProjectedSplats,
    colors: np.ndarray,
    width: int,
    height: int,
    config: RasterConfig | None = None,
    keep_weight_maps: bool = False,
) -> RenderOutput:
    """Rasterize projected splats into an RGB image plus diagnostics."""
    config = config or RasterConfig()
    if config.mode not in {"alpha", "additive"}:
        raise ValueError(f"unknown raster mode: {config.mode}")
    colors = np.asarray(colors, dtype=float)

    keep = ~projected.culled
    local_ids = np.nonzero(keep)[0]
    order = local_ids[np.argsort(projected.depth[local_ids])][::-1]
    drawn_index = projected.point_index[order]

    image = np.zeros((height, width, 3), dtype=float)
    coverage = np.zeros((height, width), dtype=float)
    depth_buffer = np.full((height, width), np.inf, dtype=float)
    transmittance = np.ones((height, width), dtype=float)
    grid = _pixel_grid(width, height)
    cutoff_sq = config.cutoff_sigma**2

    if keep_weight_maps:
        weight_maps = np.zeros((order.size, height, width), dtype=float)
    else:
        weight_maps = np.empty((0, height, width), dtype=float)

    for slot, local in enumerate(order):
        mean = projected.uv[local]
        cov2d = projected.cov2d[local]
        min_uv, max_uv, precision = splat_footprint(
            mean, cov2d, config.cutoff_sigma
        )
        u0, v0 = np.maximum(min_uv, 0)
        u1, v1 = np.minimum(max_uv + 1, [width, height])
        if u1 <= u0 or v1 <= v0:
            continue

        pixels = grid[v0:v1, u0:u1].reshape(-1, 2)
        delta = pixels - mean
        mahal = np.einsum("ni,ij,nj->n", delta, precision, delta)
        inside = mahal <= cutoff_sq
        if not np.any(inside):
            continue
        pixels = pixels[inside]
        weights = np.exp(-0.5 * mahal[inside])
        rows = pixels[:, 1].astype(int)
        cols = pixels[:, 0].astype(int)
        color = colors[projected.point_index[local]]
        depth = projected.depth[local]

        if keep_weight_maps:
            weight_maps[slot, rows, cols] = weights

        if config.mode == "additive":
            image[rows, cols] += weights[:, None] * color
            coverage[rows, cols] += weights
            depth_buffer[rows, cols] = np.where(
                depth < depth_buffer[rows, cols],
                depth,
                depth_buffer[rows, cols],
            )
        else:
            alpha = config.opacity * weights
            factor = transmittance[rows, cols] * alpha
            image[rows, cols] += factor[:, None] * color
            coverage[rows, cols] += factor
            transmittance[rows, cols] *= 1.0 - alpha
            hit = (depth < depth_buffer[rows, cols]) & (alpha > 1e-6)
            depth_buffer[rows, cols] = np.where(
                hit, depth, depth_buffer[rows, cols]
            )

    background = np.asarray(config.background, dtype=float)
    if config.mode == "alpha":
        image = image + transmittance[:, :, None] * background
    image = np.clip(image, 0.0, 1.0)
    return RenderOutput(
        color=image,
        coverage=coverage,
        weight_maps=weight_maps,
        depth_buffer=np.where(np.isinf(depth_buffer), np.nan, depth_buffer),
        drawn_index=drawn_index,
    )
