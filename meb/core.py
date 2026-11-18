"""Core geometry: ball type and exact ball-through-support solver.

The minimum enclosing ball of a 3D point set is always determined by a
support set of at most 4 affinely independent points whose circumball has
its center inside their convex hull.  Degenerate inputs (collinear,
coplanar, duplicated points) are handled by enumerating all subsets of
the support set, so a singular circumball system simply falls back to a
smaller affinely independent subset.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations

import numpy as np

TOL = 1e-9


@dataclass
class Ball:
    center: np.ndarray
    radius: float
    support: list = field(default_factory=list)  # point indices

    def contains(self, p: np.ndarray, tol: float = TOL) -> bool:
        scale = max(1.0, self.radius)
        return np.linalg.norm(np.asarray(p, dtype=float) - self.center) <= (
            self.radius + tol * scale
        )

    def max_violation(self, points: np.ndarray) -> float:
        """Largest signed distance outside the ball (<= 0 means all inside)."""
        if len(points) == 0:
            return -self.radius
        d = np.linalg.norm(points - self.center, axis=1)
        return float(d.max() - self.radius)


def containment_error(ball: Ball, points: np.ndarray) -> float:
    """How far the farthest point sticks out of the ball (0 = contained)."""
    return max(0.0, ball.max_violation(points))


def _circumball(sub: np.ndarray):
    """Circumball of affinely independent points, or None if degenerate.

    Center c = p0 + A t with A = [p1-p0, ...]; equal-distance equations
    reduce to A^T A t = |pi - p0|^2 / 2.  Returns (center, radius, weights)
    where weights are the barycentric coordinates of the center.
    """
    p0 = sub[0]
    if len(sub) == 1:
        return p0.copy(), 0.0, np.array([1.0])
    A = (sub[1:] - p0).T  # 3 x (k-1)
    b = 0.5 * np.einsum("ij,ij->j", A, A)
    gram = A.T @ A
    if np.linalg.matrix_rank(gram) < len(sub) - 1:
        return None  # affinely dependent (collinear / coplanar / duplicate)
    t = np.linalg.solve(gram, b)
    center = p0 + A @ t
    weights = np.concatenate([[1.0 - t.sum()], t])
    radius = float(np.linalg.norm(center - p0))
    return center, radius, weights


def ball_from_support(points: np.ndarray, indices) -> Ball:
    """Exact MEB of the (<= 4) support points themselves.

    Enumerates every subset, keeps circumballs whose center lies in the
    convex hull of the subset (non-negative barycentric weights) and that
    cover all support points, then returns the smallest one.
    """
    pts = np.asarray(points, dtype=float)
    idx = list(indices)
    best = None
    for size in range(1, len(idx) + 1):
        for combo in combinations(range(len(idx)), size):
            sub = pts[[idx[i] for i in combo]]
            res = _circumball(sub)
            if res is None:
                continue
            center, radius, weights = res
            if weights.min() < -TOL:  # center outside convex hull
                continue
            rest = pts[[idx[i] for i in range(len(idx)) if i not in combo]]
            if len(rest):
                d = np.linalg.norm(rest - center, axis=1)
                if d.max(initial=0.0) > radius + TOL * max(1.0, radius):
                    continue
            if best is None or radius < best.radius - TOL * max(1.0, best.radius):
                best = Ball(center, radius, [idx[i] for i in combo])
    if best is None:  # all-degenerate fallback: midpoint of widest pair
        best = _widest_pair_ball(pts, idx)
    return best


def _widest_pair_ball(pts: np.ndarray, idx) -> Ball:
    best = Ball(pts[idx[0]].copy(), 0.0, [idx[0]])
    for i, j in combinations(idx, 2):
        d = float(np.linalg.norm(pts[i] - pts[j]))
        if d > 2.0 * best.radius:
            best = Ball(0.5 * (pts[i] + pts[j]), 0.5 * d, [i, j])
    return best
