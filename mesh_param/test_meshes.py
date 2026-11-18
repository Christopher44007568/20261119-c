"""Procedural test meshes: planar sheet, curved sheet, sheet with a hole."""

from __future__ import annotations

import numpy as np

from .mesh import Mesh


def grid_sheet(n: int = 20, size: float = 2.0) -> Mesh:
    """Triangulated n x n quad grid on the z=0 plane (disk topology)."""
    xs = np.linspace(-size / 2, size / 2, n + 1)
    verts = np.array([[x, y, 0.0] for y in xs for x in xs])
    faces = []
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            b, c, d = a + 1, a + n + 1, a + n + 2
            faces.append([a, b, d])
            faces.append([a, d, c])
    return Mesh(vertices=verts, faces=np.asarray(faces, dtype=int),
                name="planar_sheet")


def curved_sheet(n: int = 20, size: float = 2.0,
                 height: float = 0.8) -> Mesh:
    """Same grid lifted onto a smooth bump (still disk topology)."""
    mesh = grid_sheet(n, size)
    x, y = mesh.vertices[:, 0], mesh.vertices[:, 1]
    r2 = (x / (size / 2)) ** 2 + (y / (size / 2)) ** 2
    mesh.vertices[:, 2] = height * np.cos(0.5 * np.pi * np.sqrt(np.clip(r2, 0, 2)))
    mesh.name = "curved_sheet"
    return mesh


def holed_sheet(n: int = 20, size: float = 2.0) -> Mesh:
    """Grid with an interior 2x2 quad hole -> two boundary loops."""
    mesh = grid_sheet(n, size)
    cx = n // 2
    drop = set()
    for j in (cx - 1, cx):
        for i in (cx - 1, cx):
            drop.add(2 * (j * n + i))
            drop.add(2 * (j * n + i) + 1)
    keep = [f for k, f in enumerate(mesh.faces) if k not in drop]
    mesh.faces = np.asarray(keep, dtype=int)
    mesh.name = "holed_sheet"
    return mesh
