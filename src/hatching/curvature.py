"""Per-vertex principal curvature estimation by local quadratic jet fitting.

For each vertex a local tangent frame (e1, e2, n) is built from the vertex
normal.  One-ring neighbours are expressed as (u, v, w) in that frame and a
Monge-patch quadratic

    w = 0.5 (a u^2 + 2 b u v + c v^2)

is fit with inverse-squared-distance weights.  The shape operator in the
tangent frame is H = [[a, b], [b, c]]; its eigen-decomposition gives the two
principal curvatures and principal directions in 3D.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class CurvatureField:
    k1: np.ndarray            # most positive principal curvature, (V,)
    k2: np.ndarray            # most negative principal curvature, (V,)
    d1: np.ndarray            # unit tangent direction of k1, (V, 3)
    d2: np.ndarray            # unit tangent direction of k2, (V, 3)
    confident: np.ndarray     # bool, (V,); False where the vertex is flat / near-umbilic
    gap: np.ndarray           # |k1 - k2|, (V,)


def _vertex_rings(faces: np.ndarray, n_vertices: int) -> list[np.ndarray]:
    rings: list[list[int]] = [[] for _ in range(n_vertices)]
    for tri in faces:
        for i in range(3):
            v = int(tri[i])
            rings[v].extend((int(tri[(i + 1) % 3]), int(tri[(i + 2) % 3])))
    return [np.unique(np.asarray(r, dtype=np.int64)) for r in rings]


def _tangent_frame(normal: np.ndarray, rng: np.random.Generator):
    helper = np.array([0.0, 0.0, 1.0])
    if abs(normal @ helper) > 0.9:
        helper = np.array([1.0, 0.0, 0.0])
    e1 = helper - normal * (helper @ normal)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(normal, e1)
    return e1, e2


def estimate_curvature(mesh, umbilic_tau: float = 0.5) -> CurvatureField:
    """Estimate principal curvatures/directions at every mesh vertex."""
    v = mesh.vertices
    rings = _vertex_rings(mesh.faces, mesh.n_vertices)
    rng = np.random.default_rng(7)
    k1 = np.zeros(mesh.n_vertices)
    k2 = np.zeros(mesh.n_vertices)
    d1 = np.zeros((mesh.n_vertices, 3))
    d2 = np.zeros((mesh.n_vertices, 3))
    gap = np.zeros(mesh.n_vertices)

    for i in range(mesh.n_vertices):
        nbr = rings[i]
        normal = mesh.normals[i]
        e1, e2 = _tangent_frame(normal, rng)
        delta = v[nbr] - v[i]
        dist = np.linalg.norm(delta, axis=1)
        u = delta @ e1
        vv = delta @ e2
        w = delta @ normal
        weights = 1.0 / np.maximum(dist, 1e-12) ** 2
        # Linear system for (a, b, c): w = 0.5 a u^2 + b u v + 0.5 c v^2
        A = np.column_stack([0.5 * u**2, u * vv, 0.5 * vv**2])
        Aw = A * weights[:, None]
        bw = w * weights
        coef, *_ = np.linalg.lstsq(Aw.T @ Aw, Aw.T @ bw, rcond=None)
        H = np.array([[coef[0], coef[1]], [coef[1], coef[2]]])
        H = 0.5 * (H + H.T)
        vals, vecs = np.linalg.eigh(H)
        order = np.argsort(vals)[::-1]  # descending: k1 >= k2
        vals, vecs = vals[order], vecs[:, order]
        k1[i], k2[i] = vals
        gap[i] = abs(vals[0] - vals[1])
        d1[i] = vecs[0, 0] * e1 + vecs[1, 0] * e2
        d2[i] = vecs[0, 1] * e1 + vecs[1, 1] * e2

    confident = gap > umbilic_tau
    return CurvatureField(k1=k1, k2=k2, d1=d1, d2=d2,
                          confident=confident, gap=gap)
