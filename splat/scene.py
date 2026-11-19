"""Continuous-surface point clouds at controllable sampling densities.

The same implicit surface ``z = f(x, y)`` is sampled on jittered grids at
several densities.  Each point carries a 3D covariance derived from its local
sample spacing (optionally anisotropic along the surface's principal
curvature direction), so a well-resolved surface is covered without holes
while sparse samplings expose gaps -- the setup used by the density study.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def ripple_surface(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Smooth continuous surface shared by every sampling density."""
    return 0.35 * np.sin(1.6 * x) * np.cos(1.3 * y) + 0.15 * (x * x - y * y)


@dataclass
class PointCloud:
    points: np.ndarray
    colors: np.ndarray
    covariances: np.ndarray
    spacing: float
    density_name: str


def _surface_color(points: np.ndarray) -> np.ndarray:
    """Deterministic smooth color field so neighboring splats blend well."""
    x, y, z = points.T
    r = 0.5 + 0.5 * np.sin(2.0 * x + 0.4)
    g = 0.5 + 0.5 * np.sin(2.5 * y + 1.1)
    b = 0.5 + 0.5 * np.cos(1.7 * z)
    return np.clip(np.stack([r, g, b], axis=1), 0.05, 0.95)


def sample_surface(
    density_name: str,
    spacing: float,
    extent: float = 1.5,
    jitter: float = 0.35,
    anisotropy: float = 1.0,
    seed: int = 7,
) -> PointCloud:
    """Sample the shared surface on a jittered regular grid.

    Args:
        density_name: label recorded in the cloud.
        spacing: nominal grid spacing in world units; smaller = denser.
        extent: half side length of the sampled square domain.
        jitter: per-axis jitter as a fraction of ``spacing``.
        anisotropy: covariance stretch along the curvature direction
            (1.0 = isotropic splats).
        seed: reproducible jitter.
    """
    rng = np.random.default_rng(seed)
    coords = np.arange(-extent, extent + 0.5 * spacing, spacing)
    gx, gy = np.meshgrid(coords, coords)
    gx = gx.ravel() + rng.uniform(-jitter, jitter, gx.size) * spacing
    gy = gy.ravel() + rng.uniform(-jitter, jitter, gy.size) * spacing
    gz = ripple_surface(gx, gy)
    points = np.stack([gx, gy, gz], axis=1)

    # Numerical tangent frame of the surface, used to orient anisotropic
    # covariance along the steepest-slope direction.
    eps = 1e-4
    dzdx = (
        ripple_surface(gx + eps, gy) - ripple_surface(gx - eps, gy)
    ) / (2 * eps)
    dzdy = (
        ripple_surface(gx, gy + eps) - ripple_surface(gx, gy - eps)
    ) / (2 * eps)
    tangent_x = np.stack([np.ones_like(gx), np.zeros_like(gx), dzdx], axis=1)
    tangent_y = np.stack([np.zeros_like(gy), np.ones_like(gy), dzdy], axis=1)
    tangent_x /= np.linalg.norm(tangent_x, axis=1, keepdims=True)
    tangent_y /= np.linalg.norm(tangent_y, axis=1, keepdims=True)
    normal = np.cross(tangent_x, tangent_y)
    normal /= np.linalg.norm(normal, axis=1, keepdims=True)

    base = 0.5 * spacing
    covariances = np.zeros((points.shape[0], 3, 3), dtype=float)
    for index in range(points.shape[0]):
        frame = np.stack([tangent_x[index], tangent_y[index], normal[index]])
        scales = np.diag(
            [
                base * anisotropy,
                base / np.sqrt(max(anisotropy, 1e-6)),
                base * 0.6,
            ]
        )
        covariances[index] = frame.T @ scales**2 @ frame

    return PointCloud(
        points=points,
        colors=_surface_color(points),
        covariances=covariances,
        spacing=spacing,
        density_name=density_name,
    )


def make_density_pair(
    dense_spacing: float = 0.09,
    sparse_spacing: float = 0.27,
    extent: float = 1.5,
    anisotropy: float = 1.0,
) -> tuple[PointCloud, PointCloud]:
    """Two samplings of the identical continuous surface."""
    dense = sample_surface(
        "dense", dense_spacing, extent=extent, anisotropy=anisotropy
    )
    sparse = sample_surface(
        "sparse", sparse_spacing, extent=extent, anisotropy=anisotropy
    )
    return dense, sparse


def degenerate_cloud(seed: int = 3) -> PointCloud:
    """Cloud containing deliberately broken covariance matrices.

    Includes rank-deficient, negative-eigenvalue, non-symmetric and
    near-singular matrices so the repair path is exercised end to end.
    """
    rng = np.random.default_rng(seed)
    points = rng.uniform(-1.0, 1.0, size=(8, 3))
    points[:, 2] = ripple_surface(points[:, 0], points[:, 1])
    covariances = np.repeat(np.eye(3)[None] * 0.01, 8, axis=0)
    covariances[1] = np.zeros((3, 3))                                  # rank 0
    covariances[2] = np.diag([0.02, -0.01, 0.005])                     # negative
    bad = covariances[3].copy()
    bad[0, 1] = 0.05                                                   # asymmetric
    covariances[3] = bad
    covariances[4] = np.diag([0.02, 1e-10, 0.01])                      # rank 1
    covariances[5] = np.full((3, 3), 0.02)                             # rank 1
    return PointCloud(
        points=points,
        colors=_surface_color(points),
        covariances=covariances,
        spacing=0.3,
        density_name="degenerate",
    )
