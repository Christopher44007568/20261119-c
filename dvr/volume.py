"""Density volume generation on the unit cube [0, 1]^3."""

from __future__ import annotations

import numpy as np


class Volume:
    """Dense float32 scalar field with shape (nz, ny, nx) on [0, 1]^3."""

    def __init__(self, data: np.ndarray, name: str = "volume"):
        data = np.ascontiguousarray(data, dtype=np.float32)
        if data.ndim != 3:
            raise ValueError("volume data must be 3D")
        self.data = data
        self.name = name

    @property
    def shape(self):
        return self.data.shape  # (nz, ny, nx)

    @property
    def voxel_size(self) -> float:
        """World-space size of one voxel (isotropic, unit-cube domain)."""
        return 1.0 / max(self.shape)


def _grid(n: int):
    axis = (np.arange(n, dtype=np.float64) + 0.5) / n
    z, y, x = np.meshgrid(axis, axis, axis, indexing="ij")
    return x, y, z


def make_uniform(n: int = 64, density: float = 1.0) -> Volume:
    """Homogeneous volume, used for analytic transmittance validation."""
    return Volume(np.full((n, n, n), density, dtype=np.float32), name="uniform")


def make_nested_shells(n: int = 96, radii=(0.45, 0.32, 0.18), densities=(0.9, 0.05, 0.9)) -> Volume:
    """Concentric spherical shells, dense outer/inner around a thin gap.

    Used to check occlusion: the dense outer shell must hide the core.
    """
    x, y, z = _grid(n)
    r = np.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2 + (z - 0.5) ** 2)
    data = np.zeros_like(r, dtype=np.float32)
    data[r <= radii[0]] = densities[0]
    data[r <= radii[1]] = densities[1]
    data[r <= radii[2]] = densities[2]
    return Volume(data, name="nested_shells")


def make_sparse_blobs(n: int = 128, blobs: int = 6, seed: int = 7) -> Volume:
    """Gaussian blobs surrounded by large empty regions (for ESS tests)."""
    rng = np.random.default_rng(seed)
    x, y, z = _grid(n)
    data = np.zeros_like(x, dtype=np.float32)
    for _ in range(blobs):
        cx, cy, cz = rng.uniform(0.25, 0.75, size=3)
        sigma = rng.uniform(0.05, 0.1)
        amp = rng.uniform(0.5, 1.0)
        d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2
        data += amp * np.exp(-d2 / (2.0 * sigma * sigma))
    data = np.clip(data, 0.0, 1.0).astype(np.float32)
    data[data < 0.02] = 0.0  # exact zeros so ESS blocks are truly empty
    return Volume(data, name="sparse_blobs")
