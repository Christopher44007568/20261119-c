"""Interactive matplotlib viewer for the direct volume ray caster."""

from __future__ import annotations

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.widgets import Button, Slider

from .raycaster import Camera, RayCaster
from .transfer import TransferFunction
from .volume import make_nested_shells, make_sparse_blobs, make_uniform

RENDER_SIZE = 160
VOLUME_FACTORIES = {
    "sparse_blobs": lambda: make_sparse_blobs(128),
    "nested_shells": lambda: make_nested_shells(96),
    "uniform": lambda: make_uniform(64, 1.0),
}


class Viewer:
    def __init__(self):
        self.volume_name = "sparse_blobs"
        self.volume = VOLUME_FACTORIES[self.volume_name]()
        self.ref_step = self.volume.voxel_size
        self.tf = TransferFunction.grayscale(ref_step=self.ref_step)
        self.step_exp = 0.0
        self.clip = [[0.0, 1.0] for _ in range(3)]
        self.ess = False
        self.camera = Camera()
        self._drag = None

        self.fig = plt.figure(figsize=(12, 7))
        self.ax_img = self.fig.add_axes([0.05, 0.30, 0.55, 0.65])
        self.ax_tf = self.fig.add_axes([0.65, 0.55, 0.32, 0.38])
        self.ax_info = self.fig.add_axes([0.65, 0.30, 0.32, 0.20])
        self.ax_info.axis("off")
        self._build_widgets()
        self._connect_tf_editor()
        self.update()

    def _build_widgets(self):
        self.sliders = {}
        specs = [
            ("step", "log2 step", -2.0, 3.0, 0.0),
            ("xmin", "clip x min", 0.0, 1.0, 0.0),
            ("xmax", "clip x max", 0.0, 1.0, 1.0),
            ("ymin", "clip y min", 0.0, 1.0, 0.0),
            ("ymax", "clip y max", 0.0, 1.0, 1.0),
            ("zmin", "clip z min", 0.0, 1.0, 0.0),
            ("zmax", "clip z max", 0.0, 1.0, 1.0),
        ]
        for i, (key, label, lo, hi, val) in enumerate(specs):
            ax = self.fig.add_axes([0.08, 0.22 - i * 0.03, 0.35, 0.02])
            s = Slider(ax, label, lo, hi, valinit=val)
            s.on_changed(lambda _v, k=key: self._on_slider(k))
            self.sliders[key] = s
        ax_vol = self.fig.add_axes([0.50, 0.16, 0.12, 0.05])
        self.btn_vol = Button(ax_vol, "volume")
        self.btn_vol.on_clicked(lambda _e: self._cycle_volume())
        ax_ess = self.fig.add_axes([0.50, 0.09, 0.12, 0.05])
        self.btn_ess = Button(ax_ess, "ESS: off")
        self.btn_ess.on_clicked(lambda _e: self._toggle_ess())

    def _on_slider(self, key):
        if key == "step":
            self.step_exp = self.sliders["step"].val
        else:
            axis = "xyz".index(key[0])
            self.clip[axis][0 if key.endswith("min") else 1] = self.sliders[key].val
        self.update()

    def _cycle_volume(self):
        names = list(VOLUME_FACTORIES)
        self.volume_name = names[(names.index(self.volume_name) + 1) % len(names)]
        self.volume = VOLUME_FACTORIES[self.volume_name]()
        self.ref_step = self.volume.voxel_size
        self.tf = TransferFunction.grayscale(ref_step=self.ref_step)
        self.update()

    def _toggle_ess(self):
        self.ess = not self.ess
        self.btn_ess.label.set_text("ESS: on" if self.ess else "ESS: off")
        self.update()

    # ------------------------------------------------------- TF editor
    def _connect_tf_editor(self):
        self.fig.canvas.mpl_connect("button_press_event", self._tf_press)
        self.fig.canvas.mpl_connect("motion_notify_event", self._tf_move)
        self.fig.canvas.mpl_connect("button_release_event", self._tf_release)

    def _tf_nearest(self, x, y):
        pts = np.array([[p[0], p[4]] for p in self.tf.points])
        d = np.hypot((pts[:, 0] - x) * 2.0, pts[:, 1] - y)
        i = int(np.argmin(d))
        return i if d[i] < 0.08 else None

    def _tf_press(self, event):
        if event.inaxes is not self.ax_tf:
            return
        i = self._tf_nearest(event.xdata, event.ydata)
        if event.button == 3:
            if i is not None:
                self.tf.remove_point(i)
                self.tf.rebuild_lut()
                self.update()
            return
        if event.button == 1:
            if i is None:
                s = float(np.clip(event.xdata, 0, 1))
                self.tf.add_point(s, s, s, s, float(np.clip(event.ydata, 0, 1)))
                self.tf.rebuild_lut()
                i = self._tf_nearest(event.xdata, event.ydata)
            self._drag = i

    def _tf_move(self, event):
        if self._drag is None or event.inaxes is not self.ax_tf:
            return
        i = self._drag
        s = float(np.clip(event.xdata, 0, 1))
        a = float(np.clip(event.ydata, 0, 1))
        gray = s
        self._drag = self.tf.move_point(i, scalar=s, rgba=(gray, gray, gray, a))
        self.tf.rebuild_lut()
        self.update()

    def _tf_release(self, _event):
        self._drag = None

    # ----------------------------------------------------------- render
    def update(self):
        clip_min = [c[0] for c in self.clip]
        clip_max = [max(c[1], c[0] + 1e-3) for c in self.clip]
        caster = RayCaster(
            self.volume,
            self.tf,
            clip_min=clip_min,
            clip_max=clip_max,
            step=self.ref_step * 2.0 ** self.step_exp,
            ess_enabled=self.ess,
        )
        res = caster.render(RENDER_SIZE, RENDER_SIZE, self.camera)

        self.ax_img.clear()
        self.ax_img.imshow(np.clip(res.image, 0, 1), origin="upper")
        self.ax_img.set_title(
            f"{self.volume.name}  step=2^{self.step_exp:+.1f}x  "
            f"samples={res.total_samples}"
        )
        self.ax_img.axis("off")

        self.ax_tf.clear()
        grid = np.linspace(0, 1, 256)
        rgba = self.tf.lut
        grad = np.zeros((2, 256, 3))
        grad[0] = rgba[:, :3] * rgba[:, 3:4]
        grad[1] = rgba[:, :3]
        self.ax_tf.imshow(grad, extent=[0, 1, 0, 1], aspect="auto", origin="lower")
        self.ax_tf.plot(grid, rgba[:, 3], "w-", lw=1.5)
        pts = np.array(self.tf.points)
        self.ax_tf.plot(pts[:, 0], pts[:, 4], "wo", ms=6)
        self.ax_tf.set_xlim(0, 1)
        self.ax_tf.set_ylim(0, 1)
        self.ax_tf.set_title("transfer function (alpha)")

        self.ax_info.clear()
        self.ax_info.axis("off")
        self.ax_info.text(
            0.0,
            0.9,
            "drag TF points: move\n"
            "left-click empty: add point\n"
            "right-click point: delete\n"
            "top strip: premultiplied\n"
            "bottom strip: raw color",
            va="top",
            fontsize=9,
        )
        self.fig.canvas.draw_idle()


def main():
    viewer = Viewer()
    plt.show()


if __name__ == "__main__":
    main()
