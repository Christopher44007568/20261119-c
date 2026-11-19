"""Mesh container and synthetic mesh generators used by the spectral codec."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np


@dataclass
class Mesh:
    """Triangle mesh with a fixed vertex ordering.

    ``positions`` is (n, 3) float64 and ``faces`` is (m, 3) int64.  The
    ordering of vertices is part of the encoding contract: permuting it
    changes the topology hash and must be rejected by the decoder.
    """

    positions: np.ndarray
    faces: np.ndarray

    def __post_init__(self) -> None:
        self.positions = np.asarray(self.positions, dtype=np.float64)
        self.faces = np.asarray(self.faces, dtype=np.int64)
        if self.positions.ndim != 2 or self.positions.shape[1] != 3:
            raise ValueError("positions must have shape (n, 3)")
        if self.faces.ndim != 2 or self.faces.shape[1] != 3:
            raise ValueError("faces must have shape (m, 3)")
        if self.faces.size and (
            self.faces.min() < 0 or self.faces.max() >= len(self.positions)
        ):
            raise ValueError("face indices out of range")

    @property
    def n_vertices(self) -> int:
        return self.positions.shape[0]

    @property
    def n_faces(self) -> int:
        return self.faces.shape[0]

    def topology_hash(self) -> str:
        """Hash of (vertex count, ordered faces, ordered reference positions)."""
        h = hashlib.sha256()
        h.update(np.int64(self.n_vertices).tobytes())
        h.update(np.ascontiguousarray(self.faces).tobytes())
        h.update(np.ascontiguousarray(self.positions).tobytes())
        return h.hexdigest()

    def permuted(self, permutation: np.ndarray) -> "Mesh":
        """Return an equivalent mesh with vertices reordered (inverse-mapped faces)."""
        permutation = np.asarray(permutation, dtype=np.int64)
        inverse = np.empty_like(permutation)
        inverse[permutation] = np.arange(len(permutation))
        return Mesh(self.positions[permutation], inverse[self.faces])


def uv_sphere(radius: float, n_u: int, n_v: int, center=(0.0, 0.0, 0.0)) -> Mesh:
    """Triangulated UV sphere (poles duplicated per quad strip, no seam merge)."""
    center = np.asarray(center, dtype=np.float64)
    verts = []
    for i in range(n_v + 1):
        theta = np.pi * i / n_v
        for j in range(n_u):
            phi = 2.0 * np.pi * j / n_u
            verts.append(
                radius
                * np.array(
                    [
                        np.sin(theta) * np.cos(phi),
                        np.sin(theta) * np.sin(phi),
                        np.cos(theta),
                    ]
                )
            )
    faces = []
    for i in range(n_v):
        for j in range(n_u):
            a = i * n_u + j
            b = i * n_u + (j + 1) % n_u
            c = (i + 1) * n_u + j
            d = (i + 1) * n_u + (j + 1) % n_u
            faces.append((a, c, b))
            faces.append((b, c, d))
    return Mesh(np.array(verts) + center, np.array(faces, dtype=np.int64))


def two_component_mesh() -> Mesh:
    """A large sphere plus a smaller disjoint sphere (two connected components)."""
    big = uv_sphere(1.0, 28, 20, center=(0.0, 0.0, 0.0))
    small = uv_sphere(0.35, 12, 8, center=(2.5, 0.0, 0.0))
    positions = np.vstack([big.positions, small.positions])
    faces = np.vstack([big.faces, small.faces + big.n_vertices])
    return Mesh(positions, faces)
