"""Degenerate covariance repair: every fix is detected and recorded."""

from __future__ import annotations

import matplotlib.pyplot as plt
import numpy as np

from splat.covariance import project_covariances
from splat.corrections import CorrectionLog
from splat.rasterize import RasterConfig, render
from splat.scene import degenerate_cloud

from .common import save_figure, standard_camera


def main():
    width, height = 180, 140
    camera = standard_camera(width, height)
    cloud = degenerate_cloud()
    log = CorrectionLog()
    projected = project_covariances(
        camera, cloud.points, cloud.covariances, log=log
    )
    output = render(projected, cloud.colors, width, height,
                    RasterConfig(mode="alpha", opacity=0.85))

    print("=== degenerate covariance correction report ===")
    print(f"input points: {cloud.points.shape[0]}")
    print(f"corrections recorded: {len(log)}")
    for entry in range(len(log)):
        before = np.round(log.eigenvalues_before[entry], 2)
        after = log.eigenvalues_after[entry]
        after = np.where(after < 1e-4, np.round(after, 10), np.round(after, 6))
        print(
            f"  point {log.point_index[entry]:2d} [{log.stage[entry]}] "
            f"{log.reason[entry]:45s} eigs {before} -> {after}"
        )
    print("summary:", log.summary())

    # All repaired 2D covariance must remain positive definite.
    min_eig = [
        float(np.linalg.eigvalsh(0.5 * (m + m.T)).min())
        for m in projected.cov2d
    ]
    print(f"min 2D eigenvalue after repair: {min(min_eig):.3e} (must be > 0)")

    fig, axes = plt.subplots(1, 2, figsize=(10, 4.4))
    axes[0].imshow(output.color)
    axes[0].set_title("Rendered after covariance repair")
    corrected = set(log.to_array().tolist())
    for index in range(cloud.points.shape[0]):
        local = np.where(projected.point_index == index)[0]
        if local.size == 0:
            continue
        mean = projected.uv[local[0]]
        color = "#ff3b30" if index in corrected else "#ffffff"
        axes[0].scatter(mean[0], mean[1], s=18, facecolors="none",
                        edgecolors=color, linewidths=1.2)
    axes[0].set_xticks([])
    axes[0].set_yticks([])

    labels = list(log.summary().keys())
    counts = list(log.summary().values())
    axes[1].barh(range(len(labels)), counts, color="#5e81f4")
    axes[1].set_yticks(range(len(labels)), labels, fontsize=8)
    axes[1].set_xlabel("number of corrections")
    axes[1].set_title("Repair reason counts")
    fig.tight_layout()
    path = save_figure(fig, "exp5_degenerate_repair.png")
    print(f"saved {path}")


if __name__ == "__main__":
    main()
