"""Small-scale CPU reference using exact pixel-area elliptical integrals.

The fast rasterizer in :mod:`splat.rasterize` samples the Gaussian once at
each pixel center.  This reference instead integrates the *full* 2D Gaussian
density over each pixel's square area using tensor-product Gauss-Legendre
quadrature::

    integral(pixel) = |J| * sum_i sum_j w_i w_j
                      * N(x_ij | mean, Sigma)

with the normalized density ``N = (2 pi det Sigma)^-1/2 exp(-0.5 mahal)``.
Increasing the quadrature order makes the result converge to the analytic
integral; the two renderers must agree within the pixel-center sampling
error, which shrinks as the splats get larger relative to a pixel.
"""

from __future__ import annotations

import numpy as np

from .covariance import ProjectedSplats
from .rasterize import RasterConfig, splat_footprint


def gauss_legendre_2d(order: int):
    """Return (nodes, weights) for ``order x order`` quadrature on [-1, 1]^2."""
    nodes_1d, weights_1d = np.polynomial.legendre.leggauss(order)
    gu, gv = np.meshgrid(nodes_1d, nodes_1d, indexing="ij")
    wu, wv = np.meshgrid(weights_1d, weights_1d, indexing="ij")
    points = np.column_stack([gu.ravel(), gv.ravel()])
    weights = (wu * wv).ravel()
    return points, weights


def elliptical_integral(
    mean: np.ndarray,
    cov2d: np.ndarray,
    pixel_boxes: np.ndarray,
    order: int = 8,
) -> np.ndarray:
    """Integrate the normalized 2D Gaussian over pixel square boxes.

    Args:
        mean: (2,) splat center in pixels.
        cov2d: (2, 2) screen-space covariance.
        pixel_boxes: (P, 4) array of (u0, v0, u1, v1) pixel boundaries.
        order: Gauss-Legendre order per axis.

    Returns:
        (P,) probability mass of each box under the Gaussian.
    """
    points, weights = gauss_legendre_2d(order)
    cov2d = 0.5 * (cov2d + cov2d.T)
    precision = np.linalg.inv(cov2d)
    norm = 1.0 / (2.0 * np.pi * np.sqrt(np.linalg.det(cov2d)))

    u0 = pixel_boxes[:, 0]
    v0 = pixel_boxes[:, 1]
    u1 = pixel_boxes[:, 2]
    v1 = pixel_boxes[:, 3]
    half_w = 0.5 * (u1 - u0)
    half_h = 0.5 * (v1 - v0)
    center_u = 0.5 * (u0 + u1)
    center_v = 0.5 * (v0 + v1)

    # Map [-1, 1]^2 quadrature nodes into every pixel box.
    sample_u = center_u[:, None] + half_w[:, None] * points[None, :, 0]
    sample_v = center_v[:, None] + half_h[:, None] * points[None, :, 1]
    delta = np.stack([sample_u - mean[0], sample_v - mean[1]], axis=-1)
    left = delta @ precision
    mahal = np.sum(left * delta, axis=2)                     # (P, Q)
    density = norm * np.exp(-0.5 * mahal)
    # Physical Jacobian of the reference-element mapping; GL weights already
    # account for the [-1, 1]^2 measure of 4.
    area = half_w * half_h
    return area * np.sum(density * weights[None, :], axis=-1)


def reference_render(
    projected: ProjectedSplats,
    colors: np.ndarray,
    width: int,
    height: int,
    config: RasterConfig | None = None,
    order: int = 8,
) -> np.ndarray:
    """Reference RGB image built from exact per-pixel elliptical integrals."""
    config = config or RasterConfig()
    colors = np.asarray(colors, dtype=float)
    keep = ~projected.culled
    local_ids = np.nonzero(keep)[0]
    order_ids = local_ids[np.argsort(projected.depth[local_ids])][::-1]

    image = np.zeros((height, width, 3), dtype=float)
    transmittance = np.ones((height, width), dtype=float)
    cols, rows = np.meshgrid(np.arange(width), np.arange(height))
    all_boxes = np.stack(
        [cols.ravel(), rows.ravel(), cols.ravel() + 1.0, rows.ravel() + 1.0],
        axis=1,
    )

    for local in order_ids:
        mean = projected.uv[local]
        cov2d = projected.cov2d[local]
        min_uv, max_uv, _ = splat_footprint(mean, cov2d, config.cutoff_sigma)
        u0 = max(int(min_uv[0]), 0)
        v0 = max(int(min_uv[1]), 0)
        u1 = min(int(max_uv[0]) + 1, width)
        v1 = min(int(max_uv[1]) + 1, height)
        if u1 <= u0 or v1 <= v0:
            continue
        region = (
            (all_boxes[:, 0] >= u0)
            & (all_boxes[:, 2] <= u1)
            & (all_boxes[:, 1] >= v0)
            & (all_boxes[:, 3] <= v1)
        )
        boxes = all_boxes[region].reshape(-1, 4)
        mass = elliptical_integral(mean, cov2d, boxes, order=order)
        pr = boxes[:, 1].astype(int)
        pc = boxes[:, 0].astype(int)
        color = colors[projected.point_index[local]]
        # Box-averaged Gaussian weight: integral of exp() over the pixel.
        weight_scale = 2.0 * np.pi * np.sqrt(np.linalg.det(cov2d))
        box_weight = mass * weight_scale

        if config.mode == "additive":
            image[pr, pc] += box_weight[:, None] * color
        else:
            alpha = np.clip(config.opacity * box_weight, 0.0, 1.0)
            factor = transmittance[pr, pc] * alpha
            image[pr, pc] += factor[:, None] * color
            transmittance[pr, pc] *= 1.0 - alpha

    if config.mode == "alpha":
        background = np.asarray(config.background, dtype=float)
        image = image + transmittance[:, :, None] * background
    return np.clip(image, 0.0, 1.0)
