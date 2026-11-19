"""Near clipping plane behavior and numerical-divergence guard.

Points are moved toward (and past) the near plane.  Without protection the
projected covariance grows like 1/z^2 and explodes; the projection instead
clamps the Jacobian depth to the near distance, marks behind-plane points
invalid and culls splats whose repaired footprint exceeds the size limit.
"""

from __future__ import annotations

import matplotlib.pyplot as plt
import numpy as np

from splat.camera import Camera
from splat.covariance import CovarianceConfig, project_covariances
from splat.corrections import CorrectionLog
from splat.rasterize import RasterConfig, render
from splat.scene import sample_surface

from .common import save_figure


def _camera(width: int, height: int, near: float) -> Camera:
    return Camera(
        width=width,
        height=height,
        fx=180.0,
        fy=180.0,
        cx=width / 2,
        cy=height / 2,
        eye=np.array([0.0, 0.0, 0.0]),
        forward=np.array([0.0, 0.0, 1.0]),
        near=near,
    )


def main():
    width, height = 180, 140
    near = 0.1
    camera = _camera(width, height, near)
    cloud = sample_surface("near", 0.12, extent=0.6, anisotropy=1.8)
    config = CovarianceConfig(max_radius_px=400.0)

    depths = np.concatenate(
        [np.linspace(1.0, near * 1.05, 30), np.linspace(near * 0.99, 0.02, 10)]
    )
    major_axes_guarded = []
    major_axes_raw = []
    behind_counts = []
    culled_counts = []

    for depth in depths:
        points = cloud.points.copy()
        points[:, 2] = depth
        log = CorrectionLog()
        projected = project_covariances(camera, points, cloud.covariances, config, log)
        if projected.uv.shape[0]:
            ellipses = projected.ellipses()
            major_axes_guarded.append(float(ellipses[:, 0].max()))
            culled_counts.append(int(projected.culled.sum()))
        else:
            major_axes_guarded.append(0.0)
            culled_counts.append(0)
        behind_counts.append(int((~projected.valid).sum()))

        # Unprotected reference math: raw 1/z Jacobian, no near clamping.
        cam_pts = camera.world_to_camera(points)
        raw_jac = camera.projection_jacobian(cam_pts)
        rotation = np.stack(camera.frame(), axis=0)
        cov_cam = np.einsum(
            "ij,njk,lk->nil", rotation, cloud.covariances, rotation
        )
        raw_cov = np.einsum("nij,njl,nkl->nik", raw_jac, cov_cam, raw_jac)
        raw_eig = np.linalg.eigvalsh(raw_cov)[:, -1]
        major_axes_raw.append(float(np.sqrt(np.maximum(raw_eig, 0)).max()))

    print("depth  guarded_major_px  raw_major_px  behind  culled")
    for index in list(range(0, 30, 3)) + list(range(30, len(depths), 2)):
        print(
            f"{depths[index]:.3f}  {major_axes_guarded[index]:16.1f} "
            f"{major_axes_raw[index]:12.1f}  {behind_counts[index]:6d} "
            f"{culled_counts[index]:7d}"
        )

    fig, axes = plt.subplots(1, 3, figsize=(14, 4.4))
    axes[0].plot(depths, major_axes_raw, "r--", label="unprotected 1/z^2")
    axes[0].plot(depths, major_axes_guarded, "b-", label="near-plane clamped")
    axes[0].axvline(near, color="k", ls=":", label="near plane")
    axes[0].set_xlabel("camera-space depth z")
    axes[0].set_ylabel("max projected major axis (px)")
    axes[0].set_yscale("symlog", linthresh=10)
    axes[0].set_title("Projected splat size vs depth")
    axes[0].legend()

    # Render at a safe depth and at a near-plane depth for visual comparison.
    safe_points = cloud.points.copy()
    safe_points[:, 2] = 0.6
    near_points = cloud.points.copy()
    near_points[:, 2] = 0.25
    raster_config = RasterConfig(mode="alpha", opacity=0.7)
    for ax, points, title in (
        (axes[1], safe_points, "Safe depth z=0.60"),
        (axes[2], near_points, "Close depth z=0.25 (bounded splats)"),
    ):
        log = CorrectionLog()
        projected = project_covariances(camera, points, cloud.covariances, config, log)
        output = render(projected, cloud.colors, width, height, raster_config)
        ax.imshow(output.color)
        ax.set_title(title)
        print(f"{title}: corrections={log.summary()} culled={int(projected.culled.sum())}")

    for ax in axes[1:]:
        ax.set_xticks([])
        ax.set_yticks([])
    fig.tight_layout()
    path = save_figure(fig, "exp3_near_plane.png")
    print(f"saved {path}")


if __name__ == "__main__":
    main()
