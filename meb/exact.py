"""Exact minimum enclosing ball via Welzl's randomized algorithm.

Expected O(n) for fixed dimension; intended for small/medium inputs.
Recursion depth is bounded by n, so the recursion limit is raised
defensively for the small-data regime this solver targets.
"""

from __future__ import annotations

import sys

import numpy as np

from .core import Ball, ball_from_support


def meb_exact(points, rng=None):
    pts = np.asarray(points, dtype=float)
    n = len(pts)
    if n == 0:
        return Ball(np.zeros(3), 0.0, [])
    if n == 1:
        return Ball(pts[0].copy(), 0.0, [0])
    if sys.getrecursionlimit() < n + 100:
        sys.setrecursionlimit(n + 100)
    rng = rng or np.random.default_rng()
    perm = rng.permutation(n)
    return _welzl(pts, perm.tolist(), [])


def _welzl(pts, order, support):
    if not order or len(support) == 4:
        if support:
            return ball_from_support(pts, support)
        return Ball(np.zeros(3), 0.0, [])
    i = order.pop()
    ball = _welzl(pts, order, support)
    if ball.contains(pts[i]):
        order.append(i)
        return ball
    ball = _welzl(pts, order, support + [i])
    order.append(i)
    return ball
