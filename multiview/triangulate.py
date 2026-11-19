"""Multi-view triangulation, residuals, uncertainty and outlier flags."""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from itertools import combinations

import numpy as np

from .camera import Camera


class Flag(enum.Enum):
    EXCLUDED = "excluded"            # user clicked it away
    BEHIND_CAMERA = "behind_camera"  # reconstructed depth <= 0
    SHORT_BASELINE = "short_baseline"  # ray intersection angle too small
    MISMATCH = "mismatch"            # reprojection outlier


class Status(enum.Enum):
    OK = "ok"
    INSUFFICIENT = "insufficient_observations"
    SHORT_BASELINE = "short_baseline"
    BEHIND_CAMERA = "behind_camera"
    MISMATCH = "mismatch"


@dataclass
class Observation:
    camera: int
    uv: np.ndarray
    excluded: bool = False
    flags: set[Flag] = field(default_factory=set)
    residual: float = np.nan  # pixels, filled by evaluate()


@dataclass
class Track:
    """One 3D point hypothesis: a set of 2D observations across cameras."""

    name: str
    observations: list[Observation]
    truth: np.ndarray | None = None  # known 3D ground truth (synthetic data)

    def active(self) -> list[Observation]:
        return [o for o in self.observations if not o.excluded]


@dataclass
class TrackResult:
    track: Track
    status: Status
    point: np.ndarray | None = None
    covariance: np.ndarray | None = None      # 3x3, for pixel_sigma noise
    max_angle_deg: float = 0.0                # largest pairwise ray angle
    angles_deg: dict[tuple[int, int], float] = field(default_factory=dict)


def triangulate_dlt(cameras: list[Camera], obs: list[Observation],
                    ) -> tuple[np.ndarray, np.ndarray]:
    """Linear DLT triangulation. Returns (point, 3x3 covariance / sigma^2)."""
    rows = []
    for o in obs:
        P = cameras[o.camera].P
        u, v = o.uv
        rows.append(u * P[2] - P[0])
        rows.append(v * P[2] - P[1])
    A = np.asarray(rows)
    _, _, Vt = np.linalg.svd(A)
    Xh = Vt[-1]
    X = Xh[:3] / Xh[3]
    # Covariance via Gauss-Newton approximation on the reprojection residual:
    #   C = sigma^2 * (J^T J)^-1, J = d(pixel)/dX at the solution.
    J = []
    for o in obs:
        cam = cameras[o.camera]
        x_cam = cam.R @ X + cam.t
        z = x_cam[2]
        d_proj = np.array([[1 / z, 0, -x_cam[0] / z**2],
                           [0, 1 / z, -x_cam[1] / z**2]])
        J.append(cam.K[:2, :2] @ d_proj @ cam.R)
    J = np.asarray(J).reshape(-1, 3)
    cov = np.linalg.pinv(J.T @ J)  # multiply by sigma^2 for absolute scale
    return X, cov


def ray_angles_deg(cameras: list[Camera], obs: list[Observation],
                   ) -> dict[tuple[int, int], float]:
    """Pairwise ray intersection angles (deg), measured as line angles.

    The angle between two rays as *lines* lies in [0, 90]: cameras on
    opposite sides of a point (rays anti-parallel) are as degenerate as
    co-located cameras, so both extremes map to small angles.
    """
    rays = {}
    for o in obs:
        _, d = cameras[o.camera].ray(o.uv)
        rays[o.camera] = d
    angles = {}
    for ca, cb in combinations(sorted(rays), 2):
        cos = abs(np.clip(rays[ca] @ rays[cb], -1.0, 1.0))
        angles[(ca, cb)] = float(np.degrees(np.arccos(cos)))
    return angles


def evaluate(track: Track, cameras: list[Camera], *,
             pixel_sigma: float = 1.0,
             min_angle_deg: float = 2.0,
             mismatch_px: float = 8.0) -> TrackResult:
    """Triangulate one track and flag bad observations independently.

    Flagging rules (each observation judged on its own):
      - EXCLUDED:       toggled off by the user, never used in the fit.
      - SHORT_BASELINE: every ray pair involving it has a tiny angle.
      - BEHIND_CAMERA:  reconstructed point lies behind that camera.
      - MISMATCH:       reprojection residual far above the inlier level.
    The track itself is never force-fit into a single "valid" point: if the
    active set is degenerate the status says so and no point is produced.
    """
    for o in track.observations:
        o.flags = {Flag.EXCLUDED} if o.excluded else set()
        o.residual = np.nan

    active = track.active()
    if len(active) < 2:
        return TrackResult(track, Status.INSUFFICIENT)

    angles = ray_angles_deg(cameras, active)
    max_angle = max(angles.values())

    # --- short baseline: per-observation, before any fitting -------------
    short_cams = set()
    if max_angle < min_angle_deg:
        short_cams = {o.camera for o in active}
    else:
        for o in active:
            others = [p for p in angles
                      if o.camera in p and angles[p] >= min_angle_deg]
            if not others:
                short_cams.add(o.camera)
    for o in active:
        if o.camera in short_cams:
            o.flags.add(Flag.SHORT_BASELINE)

    # --- robust fit: exhaustive 2-view consensus (deterministic RANSAC).
    #     Every camera pair seeds a hypothesis; the one with the largest
    #     inlier set wins. Observations outside the consensus are flagged
    #     MISMATCH individually and never drag the fit. ------------------
    thresh = max(mismatch_px, 6.0 * pixel_sigma)

    def residuals(X):
        out = {}
        for o in active:
            px = cameras[o.camera].project(X)[0]
            if np.all(np.isfinite(px)):
                out[o.camera] = float(np.linalg.norm(px - o.uv))
        return out

    best = None  # (n_inliers, -residual_sum, inlier_cameras)
    if len(active) > 2:
        for a, b in combinations(active, 2):
            Xp, _ = triangulate_dlt(cameras, [a, b])
            # seed must satisfy cheirality in its own two cameras
            if any(cameras[o.camera].depths(Xp)[0] <= 0 for o in (a, b)):
                continue
            res = residuals(Xp)
            inl = {c for c, r in res.items() if r <= thresh}
            score = (len(inl), -sum(res[c] for c in inl), inl)
            if best is None or score[:2] > best[:2]:
                best = score
    if best is not None and len(best[2]) >= 2:
        fit_obs = [o for o in active if o.camera in best[2]]
    else:
        fit_obs = list(active)
    X, cov = triangulate_dlt(cameras, fit_obs)
    for o in active:
        if o in fit_obs:
            continue
        px = cameras[o.camera].project(X)[0]
        if np.all(np.isfinite(px)):
            if np.linalg.norm(px - o.uv) > thresh:
                o.flags.add(Flag.MISMATCH)

    # --- behind camera ----------------------------------------------------
    behind_cams = set()
    for o in active:
        if cameras[o.camera].depths(X)[0] <= 0:
            o.flags.add(Flag.BEHIND_CAMERA)
            behind_cams.add(o.camera)

    # --- final reprojection residuals for every observation ---------------
    for o in track.observations:
        px = cameras[o.camera].project(X)[0]
        if np.all(np.isfinite(px)):
            o.residual = float(np.linalg.norm(px - o.uv))

    # --- track-level status (flags stay per-observation regardless) -------
    if behind_cams:
        status = Status.BEHIND_CAMERA
    elif max_angle < min_angle_deg:
        status = Status.SHORT_BASELINE
    elif any(Flag.MISMATCH in o.flags for o in active):
        status = Status.MISMATCH
    else:
        status = Status.OK

    return TrackResult(track, status, point=X, covariance=cov,
                       max_angle_deg=max_angle, angles_deg=angles)


def ellipsoid(cov: np.ndarray, sigma: float = 1.0, confidence: float = 0.95,
              ) -> tuple[np.ndarray, np.ndarray]:
    """Confidence ellipsoid of a 3x3 covariance.

    Returns (radii, rotation) where radii are the semi-axis lengths at the
    requested confidence (chi2 with 3 dof) and rotation columns are axes.
    """
    # chi2 quantiles with 3 degrees of freedom (avoids a scipy dependency).
    chi2_3 = {0.90: 6.251, 0.95: 7.815, 0.99: 11.345}
    k2 = chi2_3.get(confidence, 7.815)
    vals, vecs = np.linalg.eigh(cov)
    vals = np.clip(vals, 0.0, None)
    return sigma * np.sqrt(k2 * vals), vecs
