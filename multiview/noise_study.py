"""Noise sensitivity study.

Projects known 3D points into the cameras with increasing pixel noise,
triangulates, and measures the 3D error against ground truth. Also
reports how the 95% confidence ellipsoid grows and how often each
failure flag triggers.
"""
from __future__ import annotations

import numpy as np

from .camera import Camera
from .triangulate import Observation, Status, Track, ellipsoid, evaluate


def run_study(cameras: list[Camera], points: np.ndarray,
              sigmas: list[float], trials: int = 50, seed: int = 1,
              ) -> dict:
    """Sweep pixel noise; return per-sigma error statistics."""
    rng = np.random.default_rng(seed)
    rows = []
    for sigma in sigmas:
        errs, radii_max, statuses = [], [], []
        for _ in range(trials):
            for X in points:
                obs = [Observation(ci, cam.project(X)[0]
                                   + rng.normal(0, sigma, 2))
                       for ci, cam in enumerate(cameras)]
                track = Track("study", obs, truth=X)
                res = evaluate(track, cameras, pixel_sigma=max(sigma, 1e-6))
                statuses.append(res.status)
                if res.point is not None:
                    errs.append(np.linalg.norm(res.point - X))
                    radii_max.append(ellipsoid(res.covariance,
                                               max(sigma, 1e-6))[0].max())
        errs = np.array(errs)
        rows.append(dict(
            sigma=sigma,
            median_err=float(np.median(errs)),
            p95_err=float(np.percentile(errs, 95)),
            ellipsoid_max=float(np.median(radii_max)),
            ok_rate=float(np.mean([s == Status.OK for s in statuses])),
        ))
    return dict(rows=rows)


def study_points(n: int = 5, seed: int = 2) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.uniform(-1.5, 1.5, size=(n, 3))


def plot_study(result: dict, path: str):
    import matplotlib.pyplot as plt

    rows = result["rows"]
    sig = [r["sigma"] for r in rows]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.5))
    ax1.plot(sig, [r["median_err"] for r in rows], "o-",
             label="median 3D error")
    ax1.plot(sig, [r["p95_err"] for r in rows], "s--",
             label="95th percentile")
    ax1.plot(sig, [r["ellipsoid_max"] for r in rows], "^:",
             label="max 95% ellipsoid radius")
    ax1.set_xscale("log")
    ax1.set_yscale("log")
    ax1.set_xlabel("pixel noise sigma [px]")
    ax1.set_ylabel("3D error [m]")
    ax1.legend()
    ax1.grid(True, which="both", alpha=0.3)
    ax1.set_title("Noise sensitivity")

    ax2.plot(sig, [r["ok_rate"] for r in rows], "o-", color="tab:green")
    ax2.set_xscale("log")
    ax2.set_ylim(0, 1.05)
    ax2.set_xlabel("pixel noise sigma [px]")
    ax2.set_ylabel("fraction OK")
    ax2.grid(True, which="both", alpha=0.3)
    ax2.set_title("Track status vs noise")
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    return path
