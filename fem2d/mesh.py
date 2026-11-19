"""Structured triangular mesh generation for rectangular domains."""

from __future__ import annotations

import numpy as np


def make_rect_mesh(length: float, height: float, nx: int, ny: int):
    """Structured mesh of a rectangle [0, L] x [0, H] with 3-node triangles.

    Each (nx x ny) grid cell is split into two triangles; the diagonal
    direction alternates (Union-Jack pattern) to avoid directional bias.

    Returns
    -------
    nodes : (nnode, 2) float array
    elems : (nelem, 3) int array (counter-clockwise connectivity)
    """
    if nx < 1 or ny < 1:
        raise ValueError("nx and ny must be >= 1")
    xs = np.linspace(0.0, length, nx + 1)
    ys = np.linspace(0.0, height, ny + 1)
    nodes = np.array([(x, y) for y in ys for x in xs], dtype=float)

    def nid(i: int, j: int) -> int:
        return j * (nx + 1) + i

    elems = []
    for j in range(ny):
        for i in range(nx):
            n00, n10 = nid(i, j), nid(i + 1, j)
            n01, n11 = nid(i, j + 1), nid(i + 1, j + 1)
            if (i + j) % 2 == 0:
                elems.append((n00, n10, n11))
                elems.append((n00, n11, n01))
            else:
                elems.append((n00, n10, n01))
                elems.append((n10, n11, n01))
    return nodes, np.asarray(elems, dtype=int)


def boundary_nodes(nodes: np.ndarray, side: str, tol: float = 1e-12) -> np.ndarray:
    """Node indices on a side of the axis-aligned bounding box."""
    x0, y0 = nodes.min(axis=0)
    x1, y1 = nodes.max(axis=0)
    scale = max(x1 - x0, y1 - y0, 1.0)
    tol = tol * scale
    if side == "left":
        mask = np.abs(nodes[:, 0] - x0) < tol
    elif side == "right":
        mask = np.abs(nodes[:, 0] - x1) < tol
    elif side == "bottom":
        mask = np.abs(nodes[:, 1] - y0) < tol
    elif side == "top":
        mask = np.abs(nodes[:, 1] - y1) < tol
    else:
        raise ValueError(f"unknown side: {side!r}")
    return np.flatnonzero(mask)
