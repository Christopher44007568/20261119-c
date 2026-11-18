"""Piecewise-linear transfer function with step-size opacity correction."""

from __future__ import annotations

import numpy as np

LUT_SIZE = 256


class TransferFunction:
    """Maps scalar density in [0, 1] to (r, g, b, alpha).

    Control points are (scalar, r, g, b, alpha) tuples with scalar in [0, 1].
    The stored alpha is defined at a reference step length ``ref_step``;
    use :meth:`corrected_alpha` to obtain the alpha for any other step so
    that the overall transmittance of a homogeneous region stays invariant.
    """

    def __init__(self, points, ref_step: float = 1.0 / 128.0):
        self.ref_step = float(ref_step)
        self.points: list[list[float]] = []
        for p in points:
            self.add_point(*p)
        self._lut = np.zeros((LUT_SIZE, 4), dtype=np.float64)
        self.rebuild_lut()

    # ------------------------------------------------------------------ edit
    def add_point(self, scalar, r, g, b, a):
        self.points.append([float(scalar), float(r), float(g), float(b), float(a)])
        self.points.sort(key=lambda p: p[0])

    def remove_point(self, index: int):
        if len(self.points) <= 2:
            raise ValueError("transfer function needs at least two points")
        del self.points[index]

    def move_point(self, index: int, scalar=None, rgba=None):
        p = self.points[index]
        if scalar is not None:
            p[0] = float(np.clip(scalar, 0.0, 1.0))
        if rgba is not None:
            p[1:5] = np.clip(rgba, 0.0, 1.0)
        self.points.sort(key=lambda q: q[0])
        return self.points.index(p)

    # ------------------------------------------------------------------- lut
    def rebuild_lut(self):
        pts = np.asarray(self.points, dtype=np.float64)
        xs = pts[:, 0]
        grid = np.linspace(0.0, 1.0, LUT_SIZE)
        for ch in range(4):
            self._lut[:, ch] = np.interp(grid, xs, pts[:, ch + 1])
        return self._lut

    @property
    def lut(self) -> np.ndarray:
        return self._lut

    def map_density(self, density: np.ndarray) -> np.ndarray:
        """Map density values to RGBA using the LUT."""
        idx = np.clip(density * (LUT_SIZE - 1), 0, LUT_SIZE - 1).astype(np.intp)
        return self._lut[idx]

    # -------------------------------------------------- opacity correction
    def corrected_alpha(self, alpha: np.ndarray, step: float) -> np.ndarray:
        """Beer-Lambert consistent alpha for sampling distance ``step``.

        alpha_ref = 1 - exp(-kappa * ref_step)  =>  kappa = -ln(1-alpha_ref)/ref_step
        alpha(step) = 1 - exp(-kappa * step) = 1 - (1-alpha_ref)^(step/ref_step)
        """
        ratio = step / self.ref_step
        base = np.clip(1.0 - alpha, 0.0, 1.0)
        return 1.0 - np.power(base, ratio)

    # --------------------------------------------------------------- presets
    @classmethod
    def grayscale(cls, ref_step: float = 1.0 / 128.0) -> "TransferFunction":
        return cls(
            [
                (0.0, 0.0, 0.0, 0.0, 0.0),
                (0.4, 0.2, 0.2, 0.2, 0.05),
                (0.7, 0.8, 0.7, 0.6, 0.4),
                (1.0, 1.0, 1.0, 1.0, 0.9),
            ],
            ref_step=ref_step,
        )

    @classmethod
    def constant(cls, rgb, alpha, ref_step: float = 1.0 / 128.0) -> "TransferFunction":
        r, g, b = rgb
        return cls([(0.0, r, g, b, alpha), (1.0, r, g, b, alpha)], ref_step=ref_step)
