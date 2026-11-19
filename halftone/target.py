"""Synthetic linear-RGB print test target with named measurement regions.

Layout (origin = top-left, units millimetres) on a 90 x 120 mm target:

* gray ramp        : 12 discrete neutral steps, plus a continuous gradient
* fine lines       : 0.10-1.00 mm horizontal and vertical dark lines
* resolution wedge : repeating dark bars whose width tapers 0.50 -> 0.08 mm
* color patches    : CMY/RGB solids and two mid-tone process colors

The returned ``rois`` list carries every rectangle in mm so the same
physical regions are measured at every output resolution.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ROI:
    name: str
    kind: str  # 'ramp' | 'line' | 'wedge' | 'patch'
    x_mm: float
    y_mm: float
    w_mm: float
    h_mm: float

    def pixel_bbox(self, px_per_mm: float) -> tuple[slice, slice]:
        x0 = int(round(self.x_mm * px_per_mm))
        y0 = int(round(self.y_mm * px_per_mm))
        x1 = int(round((self.x_mm + self.w_mm) * px_per_mm))
        y1 = int(round((self.y_mm + self.h_mm) * px_per_mm))
        return slice(y0, y1), slice(x0, x1)


def _fill_rect(image, x0, y0, x1, y1, rgb):
    image[y0:y1, x0:x1] = rgb


def _stripe_fill(cv, center, width_px):
    """Analytic coverage (0..1) of a centered stripe on each coordinate."""
    d = np.abs(cv - center)
    return np.clip((width_px / 2.0 + 0.5) - d, 0.0, 1.0)


def _paint_line(image, x0, y0, x1, y1, thickness_px, dark_rgb,
                center_x_px=None, center_y_px=None):
    """Anti-aliased constant-thickness line, axis aligned only."""
    height, width, _ = image.shape
    x0, x1 = max(0, min(x0, x1)), min(width, max(x0, x1))
    y0, y1 = max(0, min(y0, y1)), min(height, max(y0, y1))
    paper = image[y0:y1, x0:x1].copy()
    ink = np.asarray(dark_rgb, dtype=np.float64)
    if y1 - y0 >= x1 - x0:  # vertical line: stripe across x
        coords = np.arange(x0, x1, dtype=np.float64)
        center = coords.mean() if center_x_px is None else center_x_px
        coverage = _stripe_fill(coords, center, thickness_px)
        alpha = coverage[None, :, None]
    else:  # horizontal line: stripe across y
        coords = np.arange(y0, y1, dtype=np.float64)
        center = coords.mean() if center_y_px is None else center_y_px
        coverage = _stripe_fill(coords, center, thickness_px)
        alpha = coverage[:, None, None]
    image[y0:y1, x0:x1] = paper * (1 - alpha) + ink * alpha


def build_target(cfg) -> tuple[np.ndarray, list[ROI]]:
    """Return (linear RGB image HxWx3, named ROIs) for the configured size."""
    height, width = cfg.shape
    ppm = cfg.px_per_mm
    paper = np.array(cfg.paper_rgb, dtype=np.float64)
    dark = np.array(cfg.ink("K").solid_rgb, dtype=np.float64)
    image = np.broadcast_to(paper, (height, width, 3)).copy()
    rois: list[ROI] = []

    # -- 12-step neutral gray ramp (top band, 8-82 mm) ---------------------
    ramp_x0, ramp_y0, ramp_h = 8.0, 8.0, 14.0
    steps = 12
    step_w = 74.0 / steps
    for i in range(steps):
        level = i / (steps - 1)  # 0 = paper white, 1 = black
        rgb = paper * (1 - level) + dark * level
        x0 = int(round((ramp_x0 + i * step_w) * ppm))
        x1 = int(round((ramp_x0 + (i + 1) * step_w) * ppm))
        y0, y1 = int(ramp_y0 * ppm), int((ramp_y0 + ramp_h) * ppm)
        _fill_rect(image, x0, y0, x1, y1, rgb)
        rois.append(
            ROI(
                f"ramp_{i:02d}_{level:.2f}",
                "ramp",
                ramp_x0 + i * step_w + 1.0,
                ramp_y0 + 2.0,
                step_w - 2.0,
                ramp_h - 4.0,
            )
        )

    # -- continuous neutral gradient strip below the discrete ramp ---------
    grad_y0, grad_h = 25.0, 8.0
    y0, y1 = int(grad_y0 * ppm), int((grad_y0 + grad_h) * ppm)
    gx = np.linspace(0.0, 1.0, width, dtype=np.float64)[None, :, None]
    image[y0:y1, :] = paper * (1 - gx) + dark * gx

    # -- fine-line chart: pairs of horizontal and vertical dark lines ------
    line_x0, line_y0 = 8.0, 38.0
    line_widths_mm = (1.00, 0.75, 0.50, 0.35, 0.25, 0.18, 0.12, 0.10)
    spacing = 9.0
    for i, lw_mm in enumerate(line_widths_mm):
        cx = line_x0 + i * spacing + 2.0
        cy = line_y0 + 4.0
        thick = max(lw_mm * ppm, 1.0)
        # vertical line, 8 mm tall
        _paint_line(
            image,
            int((cx - 1.5) * ppm), int((cy - 4) * ppm),
            int((cx + 1.5) * ppm), int((cy + 4) * ppm),
            thick, dark, center_x_px=cx * ppm,
        )
        rois.append(ROI(f"vline_{lw_mm:.2f}mm", "line",
                        cx - 2.5, cy - 3.5, 5.0, 7.0))
        # horizontal line, 8 mm wide
        hy = line_y0 + 12.0
        _paint_line(
            image,
            int((cx - 4) * ppm), int((hy - 1.5) * ppm),
            int((cx + 4) * ppm), int((hy + 1.5) * ppm),
            thick, dark, center_y_px=hy * ppm,
        )
        rois.append(ROI(f"hline_{lw_mm:.2f}mm", "line",
                        cx - 3.5, hy - 2.5, 7.0, 5.0))

    # -- resolution wedge: bars tapering from 0.50 mm to 0.08 mm -----------
    wedge_x0, wedge_y0, wedge_w, wedge_h = 8.0, 58.0, 74.0, 16.0
    x0 = int(wedge_x0 * ppm)
    x1 = int((wedge_x0 + wedge_w) * ppm)
    y0 = int(wedge_y0 * ppm)
    y1 = int((wedge_y0 + wedge_h) * ppm)
    coords_x = np.arange(x0, x1, dtype=np.float64)
    t = (coords_x - x0) / max(x1 - x0, 1)
    bar_mm = 0.50 - 0.42 * t  # physical bar width in mm
    bar_px = bar_mm * ppm
    phase = np.cumsum(1.0 / np.maximum(bar_px, 1e-9))
    on = (phase % 2.0) < 1.0
    alpha = on.astype(np.float64)[None, :, None]
    region = image[y0:y1, x0:x1]
    image[y0:y1, x0:x1] = region * (1 - alpha) + dark * alpha
    for j, frac in enumerate((0.1, 0.3, 0.5, 0.7, 0.9)):
        cx = wedge_x0 + wedge_w * frac
        rois.append(ROI(f"wedge_{frac:.1f}", "wedge",
                        cx - 3.0, wedge_y0 + 2.0, 6.0, wedge_h - 4.0))

    # -- solid and mid-tone color patches (bottom band) --------------------
    patch_y0, patch_h = 80.0, 16.0
    names = ("C", "M", "Y", "K", "R", "G", "B", "midCMY", "midRGB")
    patch_w, gap = 7.0, 1.0
    solids = {ink.channel: np.array(ink.solid_rgb) for ink in cfg.inks}
    solids["R"] = np.minimum(solids["M"] * solids["Y"] / paper, 1.0)
    solids["G"] = np.minimum(solids["C"] * solids["Y"] / paper, 1.0)
    solids["B"] = np.minimum(solids["C"] * solids["M"] / paper, 1.0)
    for i, name in enumerate(names):
        px0 = 8.0 + i * (patch_w + gap)
        if name in solids:
            rgb = solids[name]
        elif name == "midCMY":
            rgb = paper * 0.5 + (solids["C"] * solids["M"] * solids["Y"]
                                 / paper**2) * 0.5
        else:
            rgb = paper * 0.5 + solids["B"] * 0.5
        xa = int(px0 * ppm)
        xb = int((px0 + patch_w) * ppm)
        ya, yb = int(patch_y0 * ppm), int((patch_y0 + patch_h) * ppm)
        _fill_rect(image, xa, ya, xb, yb, np.clip(rgb, 0, 1))
        rois.append(ROI(f"patch_{name}", "patch",
                        px0 + 1.0, patch_y0 + 2.0,
                        patch_w - 2.0, patch_h - 4.0))

    return np.clip(image, 0.0, 1.0), rois


__all__ = ["ROI", "build_target"]
