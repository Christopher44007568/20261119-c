"""Test harness for the rigid ICP registration tool.

Ground-truth transforms are generated here and used ONLY to build the
target point set and to evaluate the pose error afterwards.  They are
never passed to the solver.  The solver estimates rotation + translation
only; there is no scale parameter that could absorb pose error.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from rigid_icp import (ICPConfig, exp_so3, log_so3, register,
                       split_pose_error, underconstrained_directions)
from visualize import CorrespondenceRecorder, plot_history

FIG_DIR = os.path.join(os.path.dirname(__file__), "artifacts", "figs")
REPORT_PATH = os.path.join(os.path.dirname(__file__), "artifacts", "report.md")


def sample_blob(n, rng):
    """Asymmetric deformed ellipsoid surface."""
    u = rng.uniform(0, 2 * np.pi, n)
    v = np.arccos(rng.uniform(-1, 1, n))
    d = np.c_[np.sin(v) * np.cos(u), np.sin(v) * np.sin(u), np.cos(v)]
    r = 1.0 + 0.35 * np.sin(3 * d[:, 0]) * np.cos(2 * d[:, 1]) + 0.2 * d[:, 2] ** 2
    p = d * r[:, None]
    p[:, 0] *= 1.4
    p[:, 1] *= 0.8
    return p


def sample_plane(n, rng):
    p = np.zeros((n, 3))
    p[:, 0] = rng.uniform(-1.5, 1.5, n)
    p[:, 1] = rng.uniform(-1.0, 1.0, n)
    p[:, 2] = 0.02 * rng.standard_normal(n)
    return p


def sample_cylinder(n, rng):
    theta = rng.uniform(0, 2 * np.pi, n)
    z = rng.uniform(-1.5, 1.5, n)
    p = np.c_[np.cos(theta), np.sin(theta), z]
    p[:, :2] += 0.01 * rng.standard_normal((n, 2))
    return p


def pose_error(R_est, t_est, R_gt, t_gt):
    rot_err = np.degrees(np.linalg.norm(log_so3(R_est @ R_gt.T)))
    trans_err = np.linalg.norm(t_est - t_gt)
    return rot_err, trans_err


def rigidity_check(R):
    ortho = np.linalg.norm(R.T @ R - np.eye(3))
    det = np.linalg.det(R)
    return ortho, det


def run_case(name, sampler, R_gt, t_gt, residual, rng,
             corrupt=None, loss="tukey", n_src=2000, n_tgt=2500,
             max_corr=0.3, make_figs=True, max_iter=60, verbose=False):
    source = sampler(n_src, rng)
    target = (R_gt @ sampler(n_tgt, rng).T).T + t_gt
    if corrupt is not None:
        source = corrupt(source, rng)

    cfg = ICPConfig(residual=residual, loss=loss, max_iterations=max_iter,
                    max_correspondence_distance=max_corr, verbose=verbose)
    recorder = None
    case_dir = os.path.join(FIG_DIR, name)
    if make_figs:
        recorder = CorrespondenceRecorder(case_dir, target)
    result = register(source, target, cfg, callback=recorder)
    if make_figs and result.history:
        plot_history(result.history,
                     os.path.join(case_dir, "history.png"), title=name)

    rot_err, trans_err = pose_error(result.R, result.t, R_gt, t_gt)
    ortho, det = rigidity_check(result.R)
    obs, unobs = split_pose_error(result, R_gt, t_gt)
    return {
        "name": name,
        "residual": residual,
        "converged": result.converged,
        "iters": len(result.history),
        "rot_err_deg": rot_err,
        "trans_err": trans_err,
        "obs_err": obs,
        "unobs_err": unobs,
        "ortho_err": ortho,
        "det": det,
        "final_valid_ratio": result.history[-1].valid_ratio if result.history else 0.0,
        "degenerate": underconstrained_directions(result),
        "message": result.message,
    }


def corrupt_partial(source, rng):
    """Local defect: remove every point inside one spherical cap."""
    centre = np.array([1.0, 0.4, 0.3])
    keep = np.linalg.norm(source - centre, axis=1) > 0.9
    return source[keep]


def corrupt_outliers(source, rng, fraction=0.15):
    n_out = int(fraction * len(source))
    outliers = rng.uniform(-2.5, 2.5, size=(n_out, 3))
    return np.vstack([source, outliers])


def scale_guard_case(rng, R_gt, t_gt):
    """Guard: a scaled target must NOT be explainable by the rigid solver.
    If a hidden scale parameter existed, the final RMS would collapse to
    ~0; here it must stay large."""
    source = sample_blob(2000, rng)
    target = 1.15 * ((R_gt @ sample_blob(2500, rng).T).T) + t_gt
    cfg = ICPConfig(residual="point_to_plane",
                    max_correspondence_distance=0.5)
    result = register(source, target, cfg)
    final_rms = result.history[-1].rms_residual
    return final_rms


def main():
    rng = np.random.default_rng(42)
    os.makedirs(FIG_DIR, exist_ok=True)

    # Known ground-truth transform (used only to build targets + evaluate).
    omega = np.array([0.22, -0.31, 0.18])
    R_gt = exp_so3(omega)
    t_gt = np.array([0.4, -0.3, 0.25])
    # Small transform for degenerate geometries: keeps the solver near the
    # true alignment so the unobservable subspace can be inspected cleanly.
    R_gt_s = exp_so3(np.array([0.05, -0.04, 0.03]))
    t_gt_s = np.array([0.08, -0.05, 0.04])

    results = []
    # 1. clean, known transform, both residual types
    results.append(run_case("clean_p2plane", sample_blob, R_gt, t_gt,
                            "point_to_plane", rng, verbose=True))
    results.append(run_case("clean_p2point", sample_blob, R_gt, t_gt,
                            "point_to_point", rng, max_iter=120))
    # 2. local defect (missing cap) on the source
    results.append(run_case("partial_defect", sample_blob, R_gt, t_gt,
                            "point_to_plane", rng, corrupt=corrupt_partial))
    # 3. outliers added to the source
    results.append(run_case("outliers", sample_blob, R_gt, t_gt,
                            "point_to_plane", rng, corrupt=corrupt_outliers))
    # 4/5. degenerate geometries: plane and axis-symmetric cylinder
    results.append(run_case("plane_degenerate", sample_plane, R_gt_s, t_gt_s,
                            "point_to_plane", rng, max_corr=0.1))
    results.append(run_case("cylinder_degenerate", sample_cylinder, R_gt_s, t_gt_s,
                            "point_to_plane", rng, max_corr=0.1))

    guard_rms = scale_guard_case(rng, R_gt, t_gt)

    lines = []
    lines.append("# Rigid ICP registration report")
    lines.append("")
    lines.append("Solver estimates rotation + translation only (no scale "
                 "parameter exists). Ground truth is used solely to build "
                 "targets and to evaluate pose error after the fact.")
    lines.append("")
    hdr = ("| case | residual | conv | iters | rot err (deg) | trans err | "
           "valid ratio | |R^TR-I| | det R |")
    lines.append(hdr)
    lines.append("|" + "---|" * 9)
    for r in results:
        lines.append(
            f"| {r['name']} | {r['residual']} | {r['converged']} | "
            f"{r['iters']} | {r['rot_err_deg']:.4f} | {r['trans_err']:.5f} | "
            f"{r['final_valid_ratio']:.2f} | {r['ortho_err']:.2e} | "
            f"{r['det']:.6f} |")
    lines.append("")
    lines.append("## No-scale guard")
    lines.append("")
    lines.append(
        f"Target scaled by 1.15x: final RMS residual = {guard_rms:.4f} "
        f"(must stay >> 0; a hidden scale parameter would drive it to ~0). "
        f"Guard {'PASSED' if guard_rms > 0.05 else 'FAILED'}.")
    lines.append("")
    lines.append("## Under-constrained directions (degenerate inputs)")
    lines.append("")
    for r in results:
        if r["degenerate"]:
            lines.append(f"- **{r['name']}**:")
            for d in r["degenerate"]:
                lines.append(f"  - {d}")
            o, u = r["obs_err"], r["unobs_err"]
            lines.append(
                f"  - pose error split: observable rot {o[0]:.4f} deg / "
                f"trans {o[1]:.5f}; unobservable rot {u[0]:.4f} deg / "
                f"trans {u[1]:.5f} (only the observable part is meaningful)")
    report = "\n".join(lines)
    with open(REPORT_PATH, "w") as fh:
        fh.write(report + "\n")
    print(report)


if __name__ == "__main__":
    main()
