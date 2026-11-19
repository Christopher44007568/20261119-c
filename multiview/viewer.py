"""Interactive matplotlib viewer for multi-camera triangulation.

Layout:
  left   - 3D scene: camera frustums, rays, triangulated points,
           confidence ellipsoid for the selected track.
  right  - per-observation reprojection residual bars for the selected
           track. Click a bar to exclude/re-include that observation;
           the track is re-triangulated immediately.

Keys: n/p select next/previous track, r reset exclusions, q quit.
"""
from __future__ import annotations

import numpy as np
import matplotlib
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

from .scene import Scene
from .triangulate import Flag, Status, ellipsoid, evaluate

STATUS_STYLE = {
    Status.OK: dict(color="tab:green", label="OK"),
    Status.INSUFFICIENT: dict(color="tab:gray", label="insufficient obs"),
    Status.SHORT_BASELINE: dict(color="tab:orange", label="short baseline"),
    Status.BEHIND_CAMERA: dict(color="tab:purple", label="behind camera"),
    Status.MISMATCH: dict(color="tab:red", label="mismatch"),
}

FLAG_COLOR = {
    Flag.EXCLUDED: "0.75",
    Flag.BEHIND_CAMERA: "tab:purple",
    Flag.SHORT_BASELINE: "tab:orange",
    Flag.MISMATCH: "tab:red",
}


def _frustum(cam, scale=0.6):
    """Camera frustum pyramid vertices in world frame."""
    c = cam.center
    corners_px = np.array([[0, 0], [1280, 0], [1280, 720], [0, 720]])
    pts = []
    for uv in corners_px:
        _, d = cam.ray(uv)
        pts.append(c + d * scale)
    return c, np.array(pts)


def _ellipsoid_mesh(center, radii, rotation, n=24):
    u = np.linspace(0, 2 * np.pi, n)
    v = np.linspace(0, np.pi, n)
    x = np.outer(np.cos(u), np.sin(v))
    y = np.outer(np.sin(u), np.sin(v))
    z = np.outer(np.ones_like(u), np.cos(v))
    sphere = np.stack([x, y, z], axis=-1) * radii
    return center + sphere @ rotation.T


class Viewer:
    def __init__(self, scene: Scene, pixel_sigma: float | None = None):
        self.scene = scene
        self.sigma = pixel_sigma if pixel_sigma is not None else scene.pixel_sigma
        self.sel = 0
        self.results = [evaluate(t, scene.cameras, pixel_sigma=self.sigma)
                        for t in scene.tracks]

        self.fig = plt.figure(figsize=(14, 8))
        gs = self.fig.add_gridspec(2, 2, width_ratios=[3, 2],
                                   height_ratios=[3, 1])
        self.ax3d = self.fig.add_subplot(gs[:, 0], projection="3d")
        self.ax_res = self.fig.add_subplot(gs[0, 1])
        self.ax_info = self.fig.add_subplot(gs[1, 1])
        self.ax_info.axis("off")

        self.fig.canvas.mpl_connect("pick_event", self._on_pick)
        self.fig.canvas.mpl_connect("key_press_event", self._on_key)
        self.redraw()

    # ------------------------------------------------------------------
    def reevaluate(self):
        self.results = [evaluate(t, self.scene.cameras,
                                 pixel_sigma=self.sigma)
                        for t in self.scene.tracks]

    # ------------------------------------------------------------------
    def redraw(self):
        self._draw_scene()
        self._draw_residuals()
        self._draw_info()
        self.fig.canvas.draw_idle()

    # ------------------------------------------------------------------
    def _draw_scene(self):
        ax = self.ax3d
        ax.clear()
        ax.set_title("3D scene — click a point to select a track")
        for cam in self.scene.cameras:
            c, corners = _frustum(cam)
            faces = [[c, corners[i], corners[(i + 1) % 4]] for i in range(4)]
            ax.add_collection3d(Poly3DCollection(
                faces, alpha=0.15, facecolor="tab:blue",
                edgecolor="tab:blue"))
            ax.scatter(*c, color="tab:blue", s=30)
            ax.text(*c, cam.name, fontsize=8)

        for ti, res in enumerate(self.results):
            style = STATUS_STYLE[res.status]
            selected = ti == self.sel
            if res.track.truth is not None:
                ax.scatter(*res.track.truth, marker="x", s=60,
                           color="k" if selected else "0.5")
            if res.point is None:
                continue
            sc = ax.scatter(*res.point, s=120 if selected else 50,
                            color=style["color"],
                            marker="*" if selected else "o",
                            picker=True, pickradius=8)
            sc._track_index = ti
            if selected:
                self._draw_selected(ax, res)

        ax.set_xlabel("x"); ax.set_ylabel("y"); ax.set_zlabel("z")
        ax.set_box_aspect((1, 1, 0.5))

    def _draw_selected(self, ax, res):
        cams = self.scene.cameras
        for o in res.track.observations:
            origin, direction = cams[o.camera].ray(o.uv)
            length = (10.0 if res.point is None else
                      float(np.linalg.norm(res.point - origin)) * 1.15)
            end = origin + direction * length
            color = "0.7" if o.excluded else (
                FLAG_COLOR[next(iter(o.flags))] if o.flags else "tab:green")
            ax.plot(*zip(origin, end), color=color, lw=1.2,
                    ls=":" if o.excluded else "-")
        if res.point is not None and res.covariance is not None:
            radii, rot = ellipsoid(res.covariance, self.sigma)
            if np.all(np.isfinite(radii)) and np.max(radii) < 50:
                mesh = _ellipsoid_mesh(res.point, radii, rot)
                ax.plot_wireframe(*np.moveaxis(mesh, -1, 0),
                                  color="tab:green", alpha=0.4, lw=0.5)

    # ------------------------------------------------------------------
    def _draw_residuals(self):
        ax = self.ax_res
        ax.clear()
        res = self.results[self.sel]
        obs = res.track.observations
        labels = [self.scene.cameras[o.camera].name for o in obs]
        vals = [o.residual if np.isfinite(o.residual) else 0.0 for o in obs]
        colors = []
        for o in obs:
            if o.excluded:
                colors.append("0.75")
            elif o.flags:
                colors.append(FLAG_COLOR[next(iter(o.flags))])
            else:
                colors.append("tab:green")
        bars = ax.bar(labels, vals, color=colors, picker=True)
        for bar, o in zip(bars, obs):
            bar._observation = o  # tag for pick events
        ax.axhline(6 * self.sigma, color="tab:red", ls="--", lw=1,
                   label=f"6σ threshold ({6 * self.sigma:.1f}px)")
        ax.set_ylabel("reprojection residual [px]")
        ax.set_title(f"{res.track.name} — click a bar to exclude/re-include")
        ax.legend(fontsize=8, loc="upper right")
        ax.tick_params(axis="x", labelsize=8)

    def _draw_info(self):
        ax = self.ax_info
        ax.clear(); ax.axis("off")
        res = self.results[self.sel]
        lines = [f"track: {res.track.name}",
                 f"status: {STATUS_STYLE[res.status]['label']}",
                 f"max ray intersection angle: {res.max_angle_deg:.2f}°"]
        if res.point is not None:
            lines.append("point: " + np.array2string(
                res.point, precision=3, suppress_small=True))
            if res.track.truth is not None:
                err = np.linalg.norm(res.point - res.track.truth)
                lines.append(f"error vs ground truth: {err:.4f} m")
            radii, _ = ellipsoid(res.covariance, self.sigma)
            lines.append("95% ellipsoid radii [m]: "
                         + np.array2string(radii, precision=4))
        for o in res.track.observations:
            cam = self.scene.cameras[o.camera].name
            flags = ",".join(f.value for f in o.flags) or "-"
            r = f"{o.residual:6.2f}px" if np.isfinite(o.residual) else "  n/a  "
            lines.append(f"  {cam}: residual {r}  flags: {flags}")
        ax.text(0.0, 1.0, "\n".join(lines), va="top", family="monospace",
                fontsize=8)

    # ------------------------------------------------------------------
    def _on_pick(self, event):
        artist = event.artist
        # residual bar clicked -> toggle that observation
        obs = getattr(artist, "_observation", None)
        if obs is not None:
            obs.excluded = not obs.excluded
            self.reevaluate()
            self.redraw()
            return
        # 3D point clicked -> select that track
        ti = getattr(artist, "_track_index", None)
        if ti is not None:
            self.sel = ti
            self.redraw()

    def _on_key(self, event):
        if event.key in ("n", "p"):
            step = 1 if event.key == "n" else -1
            self.sel = (self.sel + step) % len(self.scene.tracks)
            self.redraw()
        elif event.key == "r":
            for t in self.scene.tracks:
                for o in t.observations:
                    o.excluded = False
            self.reevaluate()
            self.redraw()
        elif event.key == "q":
            plt.close(self.fig)


def run_viewer(scene: Scene, pixel_sigma: float | None = None,
               snapshot: str | None = None):
    """Open the interactive viewer, or save a snapshot if headless."""
    viewer = Viewer(scene, pixel_sigma)
    if snapshot:
        viewer.fig.savefig(snapshot, dpi=130, bbox_inches="tight")
    if matplotlib.get_backend().lower() != "agg":
        plt.show()
    return viewer
