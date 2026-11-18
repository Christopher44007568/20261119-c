"""Tutte/barycentric disk parameterization with uniform or cotangent weights.

Boundary vertices are pinned to the unit circle by arc length; interior
vertices solve the convex-combination Laplace system, which guarantees a
bijective (flip-free) embedding for disk-topology meshes with positive
weights (Tutte's theorem; cotangent weights are clamped to be positive).
"""

from __future__ import annotations

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

from .mesh import Mesh

WEIGHT_KINDS = ("uniform", "cotangent")


def _boundary_angles(mesh: Mesh, loop: list[int]) -> dict[int, float]:
    """Map boundary vertices to circle angles proportional to arc length."""
    pts = mesh.vertices
    seg = []
    total = 0.0
    for i, vid in enumerate(loop):
        nxt = loop[(i + 1) % len(loop)]
        length = float(np.linalg.norm(pts[vid] - pts[nxt]))
        seg.append(length)
        total += length
    angles: dict[int, float] = {}
    acc = 0.0
    for i, vid in enumerate(loop):
        angles[vid] = 2.0 * np.pi * acc / total
        acc += seg[i]
    return angles


def _cotangent_weights(mesh: Mesh) -> dict[tuple[int, int], float]:
    """w_ij = cot(alpha_ij) + cot(beta_ij) summed over incident triangles."""
    weights: dict[tuple[int, int], float] = {}
    v = mesh.vertices
    for a, b, c in mesh.faces:
        for (i, j, k) in ((a, b, c), (b, c, a), (c, a, b)):
            vec1 = v[k] - v[i]
            vec2 = v[k] - v[j]
            cross = np.linalg.norm(np.cross(vec1, vec2))
            if cross < 1e-14:
                cot = 0.0  # degenerate triangle contributes nothing
            else:
                cot = float(np.dot(vec1, vec2) / cross)
            key = (min(i, j), max(i, j))
            weights[key] = weights.get(key, 0.0) + cot
    return weights


def _adjacency(edge_w: dict[tuple[int, int], float]):
    adj: dict[int, list[tuple[int, float]]] = {}
    for (a, b), w in edge_w.items():
        adj.setdefault(a, []).append((b, w))
        adj.setdefault(b, []).append((a, w))
    return adj


def parameterize(mesh: Mesh, weights: str = "cotangent") -> np.ndarray:
    """Compute 2D UVs for a disk-topology mesh. Returns (n, 2) array."""
    if weights not in WEIGHT_KINDS:
        raise ValueError(f"weights must be one of {WEIGHT_KINDS}, got {weights!r}")

    loops = mesh.validate_disk()
    loop = loops[0]
    n = len(mesh.vertices)
    boundary_set = set(loop)
    interior = [i for i in range(n) if i not in boundary_set]
    interior_index = {vid: k for k, vid in enumerate(interior)}

    angles = _boundary_angles(mesh, loop)
    uv = np.zeros((n, 2))
    for vid, theta in angles.items():
        uv[vid] = (np.cos(theta), np.sin(theta))

    if not interior:
        mesh.uvs = uv
        return uv

    if weights == "uniform":
        edge_w = {key: 1.0 for key in mesh.edges()}
    else:
        edge_w = _cotangent_weights(mesh)
        # Clamp to positive weights so Tutte's theorem still applies even
        # when obtuse angles would make raw cotangents negative.
        edge_w = {k: max(w, 1e-6) for k, w in edge_w.items()}

    adj = _adjacency(edge_w)
    m = len(interior)
    rows, cols, vals = [], [], []
    rhs = np.zeros((m, 2))
    for vid in interior:
        row = interior_index[vid]
        diag = 0.0
        for nbr, w in adj.get(vid, ()):
            diag += w
            if nbr in interior_index:
                rows.append(row)
                cols.append(interior_index[nbr])
                vals.append(-w)
            else:
                rhs[row] += w * uv[nbr]
        rows.append(row)
        cols.append(row)
        vals.append(diag)

    lap = sp.csr_matrix((vals, (rows, cols)), shape=(m, m))
    sol_x = spla.spsolve(lap, rhs[:, 0])
    sol_y = spla.spsolve(lap, rhs[:, 1])
    uv[interior, 0] = sol_x
    uv[interior, 1] = sol_y

    mesh.uvs = uv
    return uv
