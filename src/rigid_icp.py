"""Rigid (rotation + translation only) ICP registration.

The estimated transform is strictly rigid: R in SO(3), t in R^3.  No
scale or shear parameter exists anywhere in the solver, so pose error
can never be absorbed by scaling.  Ground-truth transforms are never
read by the solver; they are only used by the test harness afterwards
to evaluate pose error.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.spatial import cKDTree


def skew(v):
    return np.array([[0.0, -v[2], v[1]],
                     [v[2], 0.0, -v[0]],
                     [-v[1], v[0], 0.0]])


def exp_so3(omega):
    """Rodrigues rotation from a rotation vector."""
    theta = float(np.linalg.norm(omega))
    if theta < 1e-12:
        return np.eye(3) + skew(omega)
    k = omega / theta
    K = skew(k)
    return np.eye(3) + np.sin(theta) * K + (1.0 - np.cos(theta)) * (K @ K)


def log_so3(R):
    cos_theta = (np.trace(R) - 1.0) / 2.0
    cos_theta = float(np.clip(cos_theta, -1.0, 1.0))
    theta = np.arccos(cos_theta)
    if theta < 1e-12:
        return np.zeros(3)
    w = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]])
    return theta * w / (2.0 * np.sin(theta))


@dataclass
class ICPConfig:
    max_iterations: int = 60
    residual: str = "point_to_plane"   # "point_to_point" | "point_to_plane"
    loss: str = "tukey"                # "none" | "huber" | "tukey"
    loss_scale: float = 0.0            # <= 0 -> auto from median residual
    max_correspondence_distance: float = 0.5
    normal_neighbors: int = 12
    tol_rotation: float = 1e-7         # rad, increment convergence
    tol_translation: float = 1e-7      # increment convergence
    min_valid_ratio: float = 0.05      # abort if fewer matches survive
    verbose: bool = False              # print one line per iteration


@dataclass
class IterationRecord:
    iteration: int
    num_correspondences: int
    num_valid: int
    valid_ratio: float
    rms_residual: float
    delta_rotation_deg: float
    delta_translation: float


@dataclass
class RegistrationResult:
    R: np.ndarray
    t: np.ndarray
    converged: bool
    history: list = field(default_factory=list)
    hessian_eigenvalues: np.ndarray = None
    hessian_eigenvectors: np.ndarray = None
    message: str = ""


# ---------------------------------------------------------------------------
# Normals and robust weights
# ---------------------------------------------------------------------------

def estimate_normals(points: np.ndarray, k: int = 12) -> np.ndarray:
    """PCA normals from k-nearest neighbours (orientation is arbitrary but
    made consistent by flipping towards the centroid-facing direction)."""
    tree = cKDTree(points)
    _, idx = tree.query(points, k=min(k, len(points)))
    normals = np.empty_like(points)
    centroid = points.mean(axis=0)
    for i, nb in enumerate(idx):
        local = points[nb] - points[nb].mean(axis=0)
        cov = local.T @ local
        _, vecs = np.linalg.eigh(cov)
        n = vecs[:, 0]
        if n @ (centroid - points[i]) < 0:
            n = -n
        normals[i] = n
    return normals


def robust_weights(residuals: np.ndarray, loss: str, scale: float) -> np.ndarray:
    """IRLS weights w = psi(r)/r for the chosen robust loss."""
    if loss == "none" or scale <= 0:
        return np.ones_like(residuals)
    u = np.abs(residuals) / scale
    if loss == "huber":
        w = np.ones_like(u)
        big = u > 1.0
        w[big] = 1.0 / u[big]
        return w
    if loss == "tukey":
        w = np.zeros_like(u)
        small = u < 1.0
        w[small] = (1.0 - u[small] ** 2) ** 2
        return w
    raise ValueError(f"unknown loss: {loss}")


def _auto_scale(residuals: np.ndarray, loss: str) -> float:
    med = np.median(np.abs(residuals))
    s = 1.4826 * med
    if loss == "tukey":
        s *= 4.6851
    return max(s, 1e-9)


# ---------------------------------------------------------------------------
# Rigid increment solvers (rotation + translation only, never scale)
# ---------------------------------------------------------------------------

def solve_point_to_point(src: np.ndarray, dst: np.ndarray,
                         weights: np.ndarray):
    """Weighted Kabsch: rigid SE(3) increment.  Note the complete absence
    of a scale factor -- the SVD rotation is used as-is."""
    w = weights / weights.sum()
    mu_s = (w[:, None] * src).sum(axis=0)
    mu_d = (w[:, None] * dst).sum(axis=0)
    cs = src - mu_s
    cd = dst - mu_d
    H = (cs * w[:, None]).T @ cd
    U, _, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1.0, 1.0, d])
    R = Vt.T @ D @ U.T
    t = mu_d - R @ mu_s
    return R, t


def solve_point_to_plane(src: np.ndarray, dst: np.ndarray,
                         dst_normals: np.ndarray, weights: np.ndarray):
    """Weighted linearised point-to-plane step on se(3).

    Residual r_i = n_i . (R p_i + t - q_i).  Linearised around identity
    with twist xi = (t, omega):  r_i ~ n_i . (t + omega x p_i - (q_i - p_i)).
    Returns the composed rigid increment (R, t) via the exponential map.
    """
    p = src
    q = dst
    n = dst_normals
    # A rows: [n^T, (p x n)^T]; b: n . (q - p)
    cross = np.cross(p, n)
    A = np.hstack([n, cross])                    # (N, 6) -> [t, omega]
    b = np.einsum("ij,ij->i", n, q - p)
    sw = np.sqrt(weights)[:, None]
    Aw = A * sw
    bw = b * sw[:, 0]
    xi, *_ = np.linalg.lstsq(Aw, bw, rcond=None)
    R = exp_so3(xi[3:])
    t = xi[:3]
    return R, t


def point_to_plane_jacobian(src: np.ndarray, dst_normals: np.ndarray,
                            weights: np.ndarray) -> np.ndarray:
    """Gauss-Newton Hessian H = sum w J^T J over se(3) at the final pose;
    its null space exposes under-constrained motion directions."""
    cross = np.cross(src, dst_normals)
    A = np.hstack([dst_normals, cross])
    sw = np.sqrt(weights)[:, None]
    Aw = A * sw
    return Aw.T @ Aw


def point_to_point_jacobian(src: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """Hessian for point-to-point: J = [I, -[p]_x] per point (3 rows)."""
    N = len(src)
    A = np.zeros((3 * N, 6))
    A[:, :3] = np.repeat(np.eye(3), N, axis=0)
    for i, p in enumerate(src):
        A[3 * i:3 * i + 3, 3:] = -skew(p)
    sw = np.sqrt(np.repeat(weights, 3))[:, None]
    Aw = A * sw
    return Aw.T @ Aw


# ---------------------------------------------------------------------------
# Main ICP loop
# ---------------------------------------------------------------------------

def register(source: np.ndarray, target: np.ndarray,
             config: ICPConfig | None = None,
             target_normals: np.ndarray | None = None,
             R0: np.ndarray | None = None,
             t0: np.ndarray | None = None,
             callback=None) -> RegistrationResult:
    """Align `source` onto `target` with a rigid transform.

    Parameters
    ----------
    source, target : (N,3), (M,3) arrays
        Independently sampled point sets; no index correspondence assumed.
    callback : optional fn(iteration, transformed_source, matched_target,
                          valid_mask, record) for per-iteration visualisation.
    """
    cfg = config or ICPConfig()
    source = np.asarray(source, dtype=float)
    target = np.asarray(target, dtype=float)

    if cfg.residual == "point_to_plane" and target_normals is None:
        target_normals = estimate_normals(target, cfg.normal_neighbors)

    tree = cKDTree(target)
    R = np.eye(3) if R0 is None else R0.copy()
    t = np.zeros(3) if t0 is None else t0.copy()

    history: list[IterationRecord] = []
    converged = False
    message = "max iterations reached"
    last_H = None
    plateau_count = 0
    prev_rms = np.inf

    for it in range(cfg.max_iterations):
        transformed = (R @ source.T).T + t
        dist, idx = tree.query(transformed)
        matched = target[idx]

        valid = dist <= cfg.max_correspondence_distance
        num_valid = int(valid.sum())
        valid_ratio = num_valid / len(source)
        if num_valid < max(6, int(cfg.min_valid_ratio * len(source))):
            message = (f"aborted: only {num_valid} valid correspondences "
                       f"at iteration {it}")
            break

        p = transformed[valid]
        q = matched[valid]

        if cfg.residual == "point_to_plane":
            n = target_normals[idx][valid]
            res = np.einsum("ij,ij->i", n, p - q)
        else:
            res = np.linalg.norm(p - q, axis=1)

        scale = cfg.loss_scale if cfg.loss_scale > 0 else _auto_scale(res, cfg.loss)
        w = robust_weights(res, cfg.loss, scale)
        rms = float(np.sqrt(np.mean(res ** 2)))

        if cfg.residual == "point_to_plane":
            dR, dt = solve_point_to_plane(p, q, target_normals[idx][valid], w)
            last_H = point_to_plane_jacobian(p, target_normals[idx][valid], w)
        else:
            dR, dt = solve_point_to_point(p, q, w)
            last_H = point_to_point_jacobian(p, w)

        # Compose increment into the global rigid transform.
        R = dR @ R
        t = dR @ t + dt

        d_omega = log_so3(dR)
        rec = IterationRecord(
            iteration=it,
            num_correspondences=len(source),
            num_valid=num_valid,
            valid_ratio=valid_ratio,
            rms_residual=rms,
            delta_rotation_deg=float(np.degrees(np.linalg.norm(d_omega))),
            delta_translation=float(np.linalg.norm(dt)),
        )
        history.append(rec)

        if cfg.verbose:
            print(f"iter {it:3d}  valid {num_valid:5d}/{len(source)} "
                  f"({valid_ratio:6.1%})  rms {rms:.6f}  "
                  f"dR {rec.delta_rotation_deg:9.5f} deg  "
                  f"dt {rec.delta_translation:.6f}")

        if callback is not None:
            callback(it, transformed, matched, valid, rec)

        if (rec.delta_rotation_deg < np.degrees(cfg.tol_rotation)
                and rec.delta_translation < cfg.tol_translation):
            converged = True
            message = "converged"
            break

        # Residual plateau: increments are at the discretisation noise
        # floor, so further iterations cannot improve the pose.
        if abs(prev_rms - rms) < 1e-9 * max(1.0, prev_rms):
            plateau_count += 1
            if plateau_count >= 3:
                converged = True
                message = "converged (residual plateau)"
                break
        else:
            plateau_count = 0
        prev_rms = rms

    result = RegistrationResult(R=R, t=t, converged=converged,
                                history=history, message=message)
    if last_H is not None:
        evals, evecs = np.linalg.eigh(last_H)
        result.hessian_eigenvalues = evals
        result.hessian_eigenvectors = evecs
    return result


def underconstrained_directions(result: RegistrationResult,
                                rel_threshold: float = 0.2,
                                min_gap_decades: float = 1.0):
    """Interpret the small-eigenvalue directions of the final Hessian.

    Unobservable directions are found adaptively: scan the sorted
    eigenvalue ratios for the largest log-space gap; everything below a
    gap of at least `min_gap_decades` decades (and below `rel_threshold`)
    is treated as unobservable.

    Returns a list of human-readable strings describing unobservable
    rigid motions (translation along / rotation about a direction).
    """
    if result.hessian_eigenvalues is None:
        return []
    evals = result.hessian_eigenvalues
    evecs = result.hessian_eigenvectors
    lam_max = evals.max()
    if lam_max <= 0:
        return ["entire transform is unobservable (no valid correspondences)"]
    ratios = evals / lam_max
    log_r = np.log10(np.maximum(ratios, 1e-16))
    gaps = np.diff(log_r)
    split = 0
    if len(gaps) and gaps.max() >= min_gap_decades:
        candidate = int(np.argmax(gaps)) + 1
        if ratios[candidate - 1] < rel_threshold:
            split = candidate
    report = []
    for i in range(split):
        lam = evals[i]
        xi = evecs[:, i]
        trans, rot = xi[:3], xi[3:]
        parts = []
        if np.linalg.norm(trans) > 0.3:
            parts.append(f"translation along {np.round(trans / np.linalg.norm(trans), 3)}")
        if np.linalg.norm(rot) > 0.3:
            parts.append(f"rotation about {np.round(rot / np.linalg.norm(rot), 3)}")
        report.append(f"unobservable dof (lambda={lam:.3e}): " + " + ".join(parts))
    return report


def split_pose_error(result: RegistrationResult, R_gt: np.ndarray,
                     t_gt: np.ndarray, rel_threshold: float = 0.2,
                     min_gap_decades: float = 1.0):
    """Split the se(3) pose error into observable and unobservable parts
    using the final Hessian eigenspace.  Returns (obs, unobs) where each
    is a (rot_deg, trans) tuple.  Falls back to the full error when no
    eigensystem is available."""
    rot_err = log_so3(result.R @ R_gt.T)
    t_err = result.t - t_gt
    if result.hessian_eigenvalues is None:
        return (np.degrees(np.linalg.norm(rot_err)), np.linalg.norm(t_err)), (0.0, 0.0)
    evals = result.hessian_eigenvalues
    evecs = result.hessian_eigenvectors
    ratios = evals / evals.max()
    log_r = np.log10(np.maximum(ratios, 1e-16))
    gaps = np.diff(log_r)
    split = 0
    if len(gaps) and gaps.max() >= min_gap_decades:
        candidate = int(np.argmax(gaps)) + 1
        if ratios[candidate - 1] < rel_threshold:
            split = candidate
    null_mask = np.zeros(len(evals), dtype=bool)
    null_mask[:split] = True
    xi = np.concatenate([t_err, rot_err])
    xi_unobs = evecs[:, null_mask] @ (evecs[:, null_mask].T @ xi) if null_mask.any() \
        else np.zeros(6)
    xi_obs = xi - xi_unobs
    obs = (float(np.degrees(np.linalg.norm(xi_obs[3:]))),
           float(np.linalg.norm(xi_obs[:3])))
    unobs = (float(np.degrees(np.linalg.norm(xi_unobs[3:]))),
             float(np.linalg.norm(xi_unobs[:3])))
    return obs, unobs
