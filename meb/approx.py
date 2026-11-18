"""Approximate minimum enclosing ball: Badoiu-Clarkson core-set algorithm.

Iteratively moves the center toward the farthest point. After the loop
the radius is expanded to the exact farthest-point distance, so the
returned ball ALWAYS contains every input point (containment error 0),
while its radius stays within (1 + eps) of optimal in practice.
"""

from __future__ import annotations

import numpy as np

from .core import Ball, TOL


def meb_approx(points, eps=1e-3, max_iter=None, start_center=None):
    pts = np.asarray(points, dtype=float)
    n = len(pts)
    if n == 0:
        return Ball(np.zeros(3), 0.0, [])
    if n == 1:
        return Ball(pts[0].copy(), 0.0, [0])
    if max_iter is None:
        # Badoiu-Clarkson needs O(1/eps^2) iterations in the worst case;
        # cap so tiny eps cannot explode the runtime on large inputs
        max_iter = min(max(64, int(1.0 / max(eps, 1e-12) ** 2)), 20_000)

    warm = start_center is not None
    if warm:
        center = np.asarray(start_center, dtype=float).copy()
    else:
        # two-pass farthest-point seed: cheap and scale-robust
        a = pts[np.argmax(pts[:, 0])]
        b = pts[np.argmax(np.linalg.norm(pts - a, axis=1))]
        center = pts[np.argmax(np.linalg.norm(pts - b, axis=1))].copy()

    core = []
    radius = 0.0
    best_r = np.inf
    window = 100
    history = []
    it0 = 20 if warm else 0  # warm start: smaller steps toward outliers
    for it in range(1, max_iter + 1):
        dist = np.linalg.norm(pts - center, axis=1)
        far = int(np.argmax(dist))
        radius = float(dist[far])
        best_r = min(best_r, radius)
        history.append(best_r)
        if it > 1 and radius <= (1.0 + eps) * _lower_bound(pts, center):
            core.append(far)
            break
        if it > window and best_r > history[-window] * (1.0 - 0.25 * eps):
            core.append(far)
            break  # converged: no meaningful improvement over the window
        center = center + (pts[far] - center) / (it + it0 + 1.0)
        core.append(far)

    # candidate 1: final BC center; candidate 2: exact MEB of the (small)
    # core set.  Keep whichever expands to the smaller enclosing radius.
    best_center = center
    best_expanded = float(np.linalg.norm(pts - center, axis=1).max())
    support = sorted(set(core[-8:]))
    core_idx = sorted(set(core))
    if 2 <= len(core_idx) <= 500:
        from .exact import meb_exact
        sub = meb_exact(pts[core_idx])
        expanded = float(np.linalg.norm(pts - sub.center, axis=1).max())
        if expanded < best_expanded:
            best_center, best_expanded = sub.center, expanded
            support = [core_idx[i] for i in sub.support]

    # expand to guarantee containment of every point
    center = best_center
    dist = np.linalg.norm(pts - center, axis=1)
    radius = float(dist.max())
    radius += TOL * max(1.0, radius)
    far = int(np.argmax(dist))
    if far not in support:
        support = sorted(support + [far])
    return Ball(center, radius, support)


def _lower_bound(pts, center):
    """Lower bound on r*: half the diameter of the farthest pair found
    around the current center (r* >= d_max / 2 always holds)."""
    dist = np.linalg.norm(pts - center, axis=1)
    far = pts[int(np.argmax(dist))]
    d2 = np.linalg.norm(pts - far, axis=1)
    return 0.5 * float(d2.max())
