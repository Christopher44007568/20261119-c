"""Shared helpers for the experiment scripts."""

from __future__ import annotations

import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from splat.camera import look_at
from splat.covariance import ProjectedSplats

ARTIFACT_DIR = os.path.join(os.path.dirname(__file__), "..", "artifacts")


def standard_camera(width: int = 200, height: int = 160):
    """Oblique overview camera shared by every experiment."""
    return look_at(
        eye=np.array([0.0, -0.7, 2.7]),
        target=np.array([0.0, 0.0, 0.05]),
        up=np.array([0.0, 0.0, 1.0]),
        width=width,
        height=height,
        fov_y_deg=42.0,
        near=0.1,
    )


def save_figure(fig, name: str) -> str:
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    path = os.path.abspath(os.path.join(ARTIFACT_DIR, name))
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)
    return path


def draw_ellipse_axes(ax, projected: ProjectedSplats, scale: float = 1.0):
    """Overlay the two principal axes (1-sigma half axes) of every splat."""
    for row in range(projected.uv.shape[0]):
        if projected.culled[row]:
            continue
        matrix = projected.cov2d[row]
        eigvals, eigvecs = np.linalg.eigh(0.5 * (matrix + matrix.T))
        order = np.argsort(eigvals)[::-1]
        eigvals = eigvals[order]
        eigvecs = eigvecs[:, order]
        mean = projected.uv[row]
        for axis_index, color in ((0, "#ff3b30"), (1, "#34c759")):
            half = scale * np.sqrt(max(eigvals[axis_index], 0.0))
            direction = eigvecs[:, axis_index]
            ax.plot(
                [mean[0] - half * direction[0], mean[0] + half * direction[0]],
                [mean[1] - half * direction[1], mean[1] + half * direction[1]],
                color=color,
                lw=0.7,
                alpha=0.8,
            )
