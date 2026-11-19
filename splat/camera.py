"""Pinhole camera with an explicit near clipping plane.

The camera looks down its local +z axis (OpenCV / 3DGS convention).
Screen coordinates are returned in pixels with the origin at the top-left;
the projection Jacobian needed for covariance projection is also exposed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True)
class Camera:
    """Pinhole camera parameters.

    Attributes:
        width, height: image size in pixels.
        fx, fy: focal lengths in pixels.
        cx, cy: principal point in pixels.
        eye: camera center in world coordinates.
        forward: unit viewing direction in world coordinates (+z of camera).
        up: world-up hint used to build the orthonormal frame.
        near: signed camera-space depth of the near clipping plane.
    """

    width: int
    height: int
    fx: float
    fy: float
    cx: float
    cy: float
    eye: np.ndarray
    forward: np.ndarray
    up: np.ndarray = field(default_factory=lambda: np.array([0.0, 0.0, 1.0]))
    near: float = 0.05

    def frame(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Return the (right, up_cam, forward) orthonormal camera axes."""
        forward = np.asarray(self.forward, dtype=float)
        forward = forward / np.linalg.norm(forward)
        up_hint = np.asarray(self.up, dtype=float)
        right = np.cross(up_hint, forward)
        if np.linalg.norm(right) < 1e-9:
            # View direction parallel to the up hint: pick an arbitrary
            # orthogonal reference instead of producing a degenerate frame.
            reference = (
                np.array([1.0, 0.0, 0.0])
                if abs(forward[0]) < 0.9
                else np.array([0.0, 1.0, 0.0])
            )
            right = np.cross(reference, forward)
        right = right / np.linalg.norm(right)
        up_cam = np.cross(forward, right)
        return right, up_cam, forward

    def world_to_camera(self, points: np.ndarray) -> np.ndarray:
        """Transform world-space points into camera coordinates."""
        right, up_cam, forward = self.frame()
        rotation = np.stack([right, up_cam, forward], axis=0)
        return (np.asarray(points, dtype=float) - np.asarray(self.eye)) @ rotation.T

    def project(self, points: np.ndarray):
        """Project world points to pixel coordinates.

        Returns:
            uv: (N, 2) pixel centers, x = column, y = row (top-left origin).
            depth: (N,) signed camera-space depth z.
            valid: (N,) bool mask, False for points at/behind the near plane.
        """
        cam = self.world_to_camera(points)
        depth = cam[:, 2]
        valid = depth > self.near
        safe_depth = np.clip(depth, self.near, None)
        x = self.fx * cam[:, 0] / safe_depth + self.cx
        y = -self.fy * cam[:, 1] / safe_depth + self.cy
        uv = np.stack([x, y], axis=1)
        return uv, depth, valid

    def projection_jacobian(self, cam_points: np.ndarray) -> np.ndarray:
        """Jacobian d(pixel)/d(camera point) for each camera-space point.

        Pixel convention used here: u = fx*x/z + cx, v = -fy*y/z + cy.
        """
        x = cam_points[:, 0]
        y = cam_points[:, 1]
        z = cam_points[:, 2]
        n = x.shape[0]
        jac = np.zeros((n, 2, 3), dtype=float)
        jac[:, 0, 0] = self.fx / z
        jac[:, 0, 2] = -self.fx * x / (z * z)
        jac[:, 1, 1] = -self.fy / z
        jac[:, 1, 2] = self.fy * y / (z * z)
        return jac


def look_at(
    eye: np.ndarray,
    target: np.ndarray,
    up: np.ndarray,
    width: int,
    height: int,
    fov_y_deg: float,
    near: float = 0.05,
) -> Camera:
    """Convenience constructor aiming the camera at ``target``."""
    eye = np.asarray(eye, dtype=float)
    target = np.asarray(target, dtype=float)
    forward = target - eye
    forward = forward / np.linalg.norm(forward)
    fy = 0.5 * height / np.tan(0.5 * np.deg2rad(fov_y_deg))
    fx = fy
    return Camera(
        width=width,
        height=height,
        fx=fx,
        fy=fy,
        cx=0.5 * width,
        cy=0.5 * height,
        eye=eye,
        forward=forward,
        up=np.asarray(up, dtype=float),
        near=near,
    )
