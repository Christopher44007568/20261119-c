"""Synthetic scene: known 3D points projected into ring cameras with noise.

The generator deliberately produces tracks that exercise every failure
mode the viewer must flag independently:
  - "short_baseline": point seen only by two neighbouring cameras
  - "behind_camera":  point outside the camera ring (behind some cameras)
  - "mismatch":       one observation replaced by another point's pixel
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .camera import Camera
from .triangulate import Observation, Track


@dataclass
class Scene:
    cameras: list[Camera]
    tracks: list[Track]
    pixel_sigma: float


def _look_at(center: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Rotation R (world->camera) with optical axis pointing at target."""
    forward = target - center
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, [0.0, 0.0, 1.0])
    right /= np.linalg.norm(right)
    down = np.cross(forward, right)
    # camera axes: x=right, y=down, z=forward
    return np.vstack([right, down, forward])


def make_cameras(n: int = 6, radius: float = 8.0, height: float = 2.0,
                 focal: float = 800.0) -> list[Camera]:
    K = np.array([[focal, 0.0, 640.0],
                  [0.0, focal, 360.0],
                  [0.0, 0.0, 1.0]])
    cams = []
    for i in range(n):
        ang = 2 * np.pi * i / n
        c = np.array([radius * np.cos(ang), radius * np.sin(ang), height])
        R = _look_at(c, np.zeros(3))
        cams.append(Camera(f"cam{i}", K, R, -R @ c))
    # Extra camera almost co-located with cam0: the pair forms a
    # deliberately short baseline (~0.15 m at ~8 m depth).
    c = np.array([radius, 0.15, height])
    R = _look_at(c, np.zeros(3))
    cams.append(Camera(f"cam{n}", K, R, -R @ c))
    return cams


def make_scene(seed: int = 0, pixel_sigma: float = 1.0,
               n_points: int = 6) -> Scene:
    rng = np.random.default_rng(seed)
    cameras = make_cameras()

    # Well-conditioned points near the origin, seen by all cameras.
    truth = rng.uniform(-1.5, 1.5, size=(n_points, 3))
    tracks: list[Track] = []
    for i, X in enumerate(truth):
        obs = []
        for ci, cam in enumerate(cameras):
            uv = cam.project(X)[0] + rng.normal(0, pixel_sigma, 2)
            obs.append(Observation(ci, uv))
        tracks.append(Track(f"p{i}", obs, truth=X))

    # --- short baseline: only the nearly co-located cameras 0 and 6 ------
    X = np.array([0.5, -0.5, 1.0])
    obs = [Observation(ci, cameras[ci].project(X)[0]
                       + rng.normal(0, pixel_sigma, 2))
           for ci in (0, len(cameras) - 1)]
    tracks.append(Track("short_baseline", obs, truth=X))

    # --- behind camera: point outside the ring, behind cam0 --------------
    X = np.array([14.0, 0.0, 2.0])
    obs = []
    for ci, cam in enumerate(cameras):
        uv = cam.project(X)[0]
        if np.all(np.isfinite(uv)):  # only "visible" ones get measurements
            obs.append(Observation(ci, uv + rng.normal(0, pixel_sigma, 2)))
    # cam0 cannot see the point (it is behind it) but reports a bogus
    # detection anyway; cheirality must catch it.
    bogus = np.array([640.0, 360.0]) + rng.normal(0, 30.0, 2)
    obs.append(Observation(0, bogus))
    tracks.append(Track("behind_camera", obs, truth=X))

    # --- mismatch: one observation swapped with another point's pixel ----
    X = np.array([-0.8, 0.9, 0.4])
    obs = []
    for ci, cam in enumerate(cameras):
        uv = cam.project(X)[0] + rng.normal(0, pixel_sigma, 2)
        obs.append(Observation(ci, uv))
    wrong = cameras[2].project(np.array([1.2, 1.0, -0.6]))[0]
    obs[2].uv = wrong  # cam2 sees a different physical point
    tracks.append(Track("mismatch", obs, truth=X))

    return Scene(cameras, tracks, pixel_sigma)
