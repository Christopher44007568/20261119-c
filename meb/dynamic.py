"""Dynamic maintenance of the MEB of a triangle mesh's vertices.

Users add / move / remove vertices in batches. After each batch,
``update()`` refreshes the ball and its support-point set.

Incremental rules (both modes):
- new points all inside the current ball      -> keep ball (no rebuild)
- removed points contain no support point     -> keep ball (no rebuild)
- moved non-support points stay inside        -> keep ball (no rebuild)
- otherwise                                   -> full rebuild

Guarantees:
- the approx ball (Badoiu-Clarkson, warm-started) is always expanded to
  contain every vertex: containment error is exactly 0
- deleting or moving a support point forces a REBUILD, so the ball
  shrinks to fit the remaining points instead of keeping the stale,
  oversized old ball
"""

from __future__ import annotations

import time

import numpy as np

from .approx import meb_approx
from .core import Ball
from .exact import meb_exact


class UpdateReport:
    def __init__(self, mode, ball, elapsed, rebuilt, n_points):
        self.mode = mode
        self.ball = ball
        self.elapsed = elapsed      # seconds spent in the solver
        self.rebuilt = rebuilt      # False if the old ball was kept
        self.n_points = n_points

    @property
    def support(self):
        return self.ball.support


class DynamicMEB:
    def __init__(self, mode="exact", eps=1e-3, triangles=None):
        assert mode in ("exact", "approx")
        self.mode = mode
        self.eps = eps
        self.triangles = triangles  # mesh connectivity, kept for display
        self._pts = {}              # vertex id -> 3D coords
        self.ball = Ball(np.zeros(3), 0.0, [])
        self._support_ids = []
        self.last_report = None
        self._reset_pending()

    def _reset_pending(self):
        self._added = set()
        self._moved = set()
        self._removed = set()

    # ---------------------------------------------------------- batches
    def add_points(self, points, ids=None):
        """points: (k, 3) array-like. Returns the assigned vertex ids."""
        points = np.asarray(points, dtype=float).reshape(-1, 3)
        if ids is None:
            start = max(self._pts, default=-1) + 1
            ids = list(range(start, start + len(points)))
        for i, p in zip(ids, points):
            self._pts[int(i)] = p
            self._added.add(int(i))
        return [int(i) for i in ids]

    def move_points(self, ids, new_positions):
        new_positions = np.asarray(new_positions, dtype=float).reshape(-1, 3)
        for i in ids:
            if int(i) not in self._pts:
                raise KeyError(f"unknown vertex id {i}")
        for i, p in zip(ids, new_positions):
            self._pts[int(i)] = p
            self._moved.add(int(i))

    def remove_points(self, ids):
        for i in ids:
            self._pts.pop(int(i), None)
            self._removed.add(int(i))

    # ---------------------------------------------------------- solving
    def _arrays(self):
        ids = sorted(self._pts)
        arr = np.array([self._pts[i] for i in ids], dtype=float).reshape(-1, 3)
        return ids, arr

    def _needs_rebuild(self):
        if not self._pts:
            return True
        support = set(self._support_ids)
        if support & self._removed or support & self._moved:
            return True  # support changed: must rebuild, never keep stale ball
        for i in self._added | self._moved:
            if i in self._pts and not self.ball.contains(self._pts[i]):
                return True  # some point now lies outside the ball
        return False

    def update(self):
        """Recompute the ball after a batch; returns an UpdateReport."""
        ids, arr = self._arrays()
        rebuilt = self._needs_rebuild()
        t0 = time.perf_counter()
        if rebuilt:
            if self.mode == "exact":
                ball = meb_exact(arr)
            else:
                warm = self.ball.center if len(arr) else None
                ball = meb_approx(arr, eps=self.eps, start_center=warm)
            self.ball = ball
            self._support_ids = [ids[i] for i in ball.support]
        elapsed = time.perf_counter() - t0
        self._reset_pending()
        self.last_report = UpdateReport(self.mode, self.ball, elapsed, rebuilt,
                                        len(ids))
        return self.last_report

    # ---------------------------------------------------------- queries
    @property
    def support_ids(self):
        """Vertex ids (not row indices) that determine the current ball."""
        return list(self._support_ids)

    def support_points(self):
        return {i: self._pts[i].copy() for i in self._support_ids if i in self._pts}

    def containment_error(self):
        ids, arr = self._arrays()
        if not ids:
            return 0.0
        return max(0.0, self.ball.max_violation(arr))
