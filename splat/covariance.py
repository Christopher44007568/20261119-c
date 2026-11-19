"""Covariance repair and EWA screen-space projection.

Implements the classic EWA splat projection (Zwicker et al.; also used by
3D Gaussian splatting): the 3D camera-space covariance ``Sigma`` is mapped
through the perspective projection Jacobian ``J`` and a small pixel
low-pass term is added::

    Sigma_2d = J @ Sigma @ J.T + 0.3^2 * I

Degenerate (non-symmetric, rank-deficient, non-positive-definite or
ill-conditioned) covariance matrices are repaired by eigenvalue clamping and
every repair is recorded in a :class:`~splat.corrections.CorrectionLog`.

Near-plane handling: points at or behind the near plane are invalid, and the
depth used inside the Jacobian is clamped to the near distance so that the
1/z divergence of projected covariance stays bounded instead of exploding.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .camera import Camera
from .corrections import CorrectionLog


@dataclass(frozen=True)
class CovarianceConfig:
    """Tunables for covariance repair and projection."""

    low_pass_px: float = 0.3
    rel_eigenvalue_eps_3d: float = 1e-6
    abs_eigenvalue_eps_3d: float = 1e-8
    rel_eigenvalue_eps_2d: float = 1e-6
    abs_eigenvalue_eps_2d: float = 1e-4
    max_radius_px: float = 1024.0
    symmetry_tol: float = 1e-10


def _symmetry_error(matrix: np.ndarray) -> float:
    return float(np.max(np.abs(matrix - np.swapaxes(matrix, -1, -2))))


def repair_covariances_3d(
    covariances: np.ndarray,
    config: CovarianceConfig | None = None,
    log: CorrectionLog | None = None,
) -> np.ndarray:
    """Repair a batch of 3x3 world-space covariance matrices.

    Matrices are symmetrized first; then their eigenvalues are clamped so the
    result is strictly positive definite and not worse conditioned than
    ``rel_eigenvalue_eps_3d``. Every altered matrix is logged.
    """
    config = config or CovarianceConfig()
    cov = np.asarray(covariances, dtype=float).copy()
    if cov.ndim == 2:
        cov = cov[None]
    repaired = np.empty_like(cov)

    for index, matrix in enumerate(cov):
        reasons: list[str] = []
        if _symmetry_error(matrix) > config.symmetry_tol:
            reasons.append("non_symmetric")
        sym = 0.5 * (matrix + matrix.T)
        eigvals, eigvecs = np.linalg.eigh(sym)
        before = eigvals.copy()
        if np.any(eigvals <= 0.0):
            reasons.append("non_positive_definite")
        largest = max(float(np.max(eigvals)), 0.0)
        # Absolute floor guarantees strict positive definiteness even for a
        # fully collapsed (all-zero) covariance; relative floor scales with
        # the dynamic range for merely ill-conditioned matrices.
        floor = max(
            config.rel_eigenvalue_eps_3d * largest,
            config.abs_eigenvalue_eps_3d,
            1e-10,
        )
        if np.min(eigvals) < floor:
            reasons.append("ill_conditioned")
        clamped = np.maximum(eigvals, floor)
        fixed = (eigvecs * clamped) @ eigvecs.T
        fixed = 0.5 * (fixed + fixed.T)
        repaired[index] = fixed
        if reasons and log is not None:
            log.record(index, "3d", "+".join(reasons), before, clamped)
    return repaired


def _repair_covariances_2d(
    cov2d: np.ndarray,
    config: CovarianceConfig,
    log: CorrectionLog,
    point_indices: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Clamp 2D covariance eigenvalues; flag matrices that stay too large."""
    repaired = np.empty_like(cov2d)
    culled = np.zeros(cov2d.shape[0], dtype=bool)
    for row, index in enumerate(point_indices):
        matrix = cov2d[row]
        sym = 0.5 * (matrix + matrix.T)
        eigvals, eigvecs = np.linalg.eigh(sym)
        before = eigvals.copy()
        largest = max(float(np.max(eigvals)), 0.0)
        floor = max(
            config.rel_eigenvalue_eps_2d * largest,
            config.abs_eigenvalue_eps_2d,
        )
        reasons: list[str] = []
        if np.any(eigvals <= 0.0):
            reasons.append("non_positive_definite")
        if np.min(eigvals) < floor:
            reasons.append("ill_conditioned")
        clamped = np.maximum(eigvals, floor)
        fixed = (eigvecs * clamped) @ eigvecs.T
        repaired[row] = 0.5 * (fixed + fixed.T)
        if reasons:
            log.record(int(index), "2d", "+".join(reasons), before, clamped)
        if np.sqrt(float(np.max(clamped))) > config.max_radius_px:
            culled[row] = True
            log.record(
                int(index),
                "2d",
                "radius_exceeds_limit",
                before,
                clamped,
            )
    return repaired, culled


@dataclass
class ProjectedSplats:
    """Per-splat screen-space data ready for rasterization."""

    uv: np.ndarray              # (K, 2) pixel centers (u=col, v=row)
    depth: np.ndarray           # (K,) camera-space depth
    cov2d: np.ndarray           # (K, 2, 2) pixel-space covariance
    point_index: np.ndarray     # (K,) indices into the original point array
    culled: np.ndarray          # (K,) splats dropped because of size/near plane
    valid: np.ndarray           # (N,) original per-point visibility mask

    def ellipses(self) -> np.ndarray:
        """Return (a, b, angle_deg) with 1-sigma half axes in pixels."""
        info = np.empty((self.cov2d.shape[0], 3), dtype=float)
        for row, matrix in enumerate(self.cov2d):
            eigvals, eigvecs = np.linalg.eigh(0.5 * (matrix + matrix.T))
            order = np.argsort(eigvals)[::-1]
            eigvals = eigvals[order]
            eigvecs = eigvecs[:, order]
            info[row, 0] = np.sqrt(max(eigvals[0], 0.0))
            info[row, 1] = np.sqrt(max(eigvals[1], 0.0))
            info[row, 2] = np.rad2deg(np.arctan2(eigvecs[1, 0], eigvecs[0, 0]))
        return info


def project_covariances(
    camera: Camera,
    points: np.ndarray,
    covariances: np.ndarray,
    config: CovarianceConfig | None = None,
    log: CorrectionLog | None = None,
) -> ProjectedSplats:
    """Project 3D Gaussians to screen-space ellipses.

    Args:
        camera: pinhole camera defining projection and near plane.
        points: (N, 3) world-space Gaussian means.
        covariances: (N, 3, 3) world-space covariance matrices; degenerate
            ones are repaired and the repair is recorded in ``log``.
        config: repair/projection tunables.
        log: optional correction recorder.
    """
    config = config or CovarianceConfig()
    log = log if log is not None else CorrectionLog()
    points = np.asarray(points, dtype=float)
    cov3d = repair_covariances_3d(covariances, config, log)

    uv, depth, valid = camera.project(points)
    cam_points = camera.world_to_camera(points)

    right, up_cam, forward = camera.frame()
    rotation = np.stack([right, up_cam, forward], axis=0)
    cov_cam = np.einsum("ij,njk,lk->nil", rotation, cov3d, rotation)

    # Clamp the depth feeding the Jacobian to the near plane. This keeps the
    # 1/z and 1/z^2 terms finite for near-plane points instead of producing
    # arbitrarily large screen covariance (numerical divergence guard).
    # Points at or behind the camera plane (z <= 0) are clamped too so their
    # intermediate covariance stays finite; they are masked out via ``valid``.
    safe_z = np.clip(cam_points[:, 2], camera.near, None)
    clamped_points = cam_points.copy()
    clamped_points[:, 2] = safe_z
    jacobian = camera.projection_jacobian(clamped_points)

    low_pass = config.low_pass_px**2 * np.eye(2)
    cov2d = np.einsum("nij,njl,nkl->nik", jacobian, cov_cam, jacobian) + low_pass

    visible_index = np.nonzero(valid)[0]
    cov_visible, culled = _repair_covariances_2d(
        cov2d[visible_index], config, log, visible_index
    )
    return ProjectedSplats(
        uv=uv[visible_index],
        depth=depth[visible_index],
        cov2d=cov_visible,
        point_index=visible_index,
        culled=culled,
        valid=valid,
    )
