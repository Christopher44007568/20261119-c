"""Pinhole camera model with intrinsics and extrinsics."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Camera:
    """Pinhole camera.

    Extrinsics map world -> camera:  x_cam = R @ X + t
    Projection:                      x_img ~ K @ x_cam
    """

    name: str
    K: np.ndarray  # (3, 3) intrinsics
    R: np.ndarray  # (3, 3) world->camera rotation
    t: np.ndarray  # (3,)   world->camera translation

    @property
    def P(self) -> np.ndarray:
        """3x4 projection matrix."""
        return self.K @ np.hstack([self.R, self.t.reshape(3, 1)])

    @property
    def center(self) -> np.ndarray:
        """Camera center in world coordinates."""
        return -self.R.T @ self.t

    def project(self, X: np.ndarray) -> np.ndarray:
        """Project world point(s) (..., 3) to pixels (..., 2).

        Points at or behind the optical plane yield NaN pixels.
        """
        X = np.atleast_2d(np.asarray(X, dtype=float))
        x_cam = X @ self.R.T + self.t
        z = x_cam[:, 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            uv = x_cam[:, :2] / z[:, None]
        uv[~np.isfinite(uv)] = np.nan
        px = uv @ self.K[:2, :2].T + self.K[:2, 2]
        px[z <= 0] = np.nan
        return px

    def depths(self, X: np.ndarray) -> np.ndarray:
        """Signed depth (z in camera frame) of world point(s)."""
        X = np.atleast_2d(np.asarray(X, dtype=float))
        return (X @ self.R.T + self.t)[:, 2]

    def in_front(self, X: np.ndarray) -> np.ndarray:
        """Boolean mask: point is in front of the camera."""
        return self.depths(X) > 0

    def ray(self, uv: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """World-frame ray (origin, unit direction) for a pixel."""
        uv = np.asarray(uv, dtype=float)
        x = np.linalg.solve(self.K, np.array([uv[0], uv[1], 1.0]))
        direction = self.R.T @ x
        direction = direction / np.linalg.norm(direction)
        return self.center, direction
