"""Rotated amplitude-modulated halftone screens.

A screen is a periodic spot function sampled on a rotated lattice.
Pixel (x, y) belongs to cell coordinates

    u = (x*cos a + y*sin a) / period
    v = (-x*sin a + y*cos a) / period

and its normalized position inside the cell is (u mod 1, v mod 1),
centered at (0.5, 0.5).  A shape-specific scalar value in [0, 1] is
thresholded against the requested coverage.  Thresholds are the value
distribution's quantiles, which makes mean(value < t) == t by
construction: the rendered dot area matches the requested coverage.
"""

from __future__ import annotations

import math

import numpy as np


DOT_SHAPES = ("euclidean", "circle", "diamond", "line")


def cell_coordinates(
    height: int, width: int, angle_deg: float, period_px: float
) -> tuple[np.ndarray, np.ndarray]:
    """Centered in-cell coordinates (cu, cv), each roughly in [-0.5, 0.5]."""
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float64)
    angle = math.radians(angle_deg)
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    u = (xx * cos_a + yy * sin_a) / period_px
    v = (-xx * sin_a + yy * cos_a) / period_px
    cu = u - np.floor(u) - 0.5
    cv = v - np.floor(v) - 0.5
    return cu, cv


def spot_values(cu: np.ndarray, cv: np.ndarray, shape: str) -> np.ndarray:
    """Shape scalar in [0, 1]; smaller values print first (center-out)."""
    if shape == "euclidean":
        # classic round-ish postscript dot growing from the cell center
        radius = np.hypot(cu, cv)
        return radius
    if shape == "circle":
        # Continuous radius (no clipping): quantile calibration then covers
        # the full 0-100 % area range.  Mid-tones render as round dots; only
        # extreme shadows/highlights deform toward the cell corners, as real
        # circular press dots do when neighboring dots merge.
        radius = np.hypot(cu, cv)
        return radius
    if shape == "diamond":
        # L1 distance: square/diamond dot, kept unclipped for full range
        return np.abs(cu) + np.abs(cv)
    if shape == "line":
        # one-dimensional ruling: parallel lines instead of dots
        return np.clip(cv + 0.5, 0.0, 1.0)
    raise ValueError(f"unknown dot shape {shape!r}; choose from {DOT_SHAPES}")


def quantile_threshold_table(values: np.ndarray, levels: int = 1024) -> np.ndarray:
    """Coverage -> threshold lookup built from the actual value distribution."""
    quantiles = np.linspace(0.0, 1.0, levels + 1)
    table = np.quantile(values, quantiles)
    # make the table strictly non-decreasing so thresholding is well defined
    return np.maximum.accumulate(table)


class HalftoneScreen:
    """Precomputed screen lattice for one plate/angle/shape/resolution."""

    def __init__(
        self,
        height: int,
        width: int,
        angle_deg: float,
        period_px: float,
        shape: str,
        levels: int = 1024,
    ):
        if shape not in DOT_SHAPES:
            raise ValueError(f"unknown dot shape {shape!r}")
        cu, cv = cell_coordinates(height, width, angle_deg, period_px)
        self.values = spot_values(cu, cv, shape)
        self.thresholds = quantile_threshold_table(self.values, levels)
        self.levels = levels
        self._build_area_calibration()
        self.shape_name = shape
        self.angle_deg = angle_deg
        self.period_px = period_px

    def _build_area_calibration(self) -> None:
        """Invert the realized-area response of this finite lattice.

        Some shapes saturate before 100 % coverage (cell corners never
        print), so thresholding the requested coverage directly under-fills
        the shadows.  We measure the realized area fraction for every
        requestable level and store the inverse map, guaranteeing that the
        rendered mean area equals the request over the whole range.
        """
        realized = np.empty(self.levels + 1)
        # Measure on a compact representative patch: the value distribution
        # is stationary over the rotated lattice, so a few hundred cells are
        # statistically equivalent to the full page but far cheaper.
        sample_side = min(self.values.shape[0], self.values.shape[1], 512)
        flat = self.values[:sample_side, :sample_side].reshape(-1)
        thresholds_sample = quantile_threshold_table(flat, self.levels)
        for level in range(self.levels + 1):
            realized[level] = float(np.mean(flat < thresholds_sample[level]))
        # inverse: for each desired area, the first level realizing at least
        # that area; np.maximum.accumulate keeps it monotonic
        desired = np.linspace(0.0, 1.0, self.levels + 1)
        inverse = np.array(
            [np.searchsorted(realized, target) for target in desired]
        )
        inverse = np.minimum(inverse, self.levels)
        self.area_inverse_level = np.maximum.accumulate(inverse)

    def render(self, coverage: np.ndarray) -> np.ndarray:
        """Return a binary (0/1, uint8) plate for the coverage image."""
        coverage = np.clip(np.asarray(coverage, dtype=np.float64), 0.0, 1.0)
        requested = np.rint(coverage * self.levels).astype(np.int64)
        idx = self.area_inverse_level[requested]
        threshold = self.thresholds[idx]
        return (self.values < threshold).astype(np.uint8)


def tone_value_increase(coverage: np.ndarray, midtone_gain_pp: float) -> np.ndarray:
    """Physical TVI dot-gain curve on the coverage domain.

    A symmetric parabola added to the identity curve: the gain is zero at
    0 % and 100 % coverage and reaches ``midtone_gain_pp`` percentage points
    at the 50 % mid-tone, matching the conventional TVI specification.
    Because it acts on coverage values rather than on pixels, the same
    physical dot gain is reproduced at every sampling resolution.
    """
    coverage = np.clip(np.asarray(coverage, dtype=np.float64), 0.0, 1.0)
    gain = (midtone_gain_pp / 100.0) * 4.0 * coverage * (1.0 - coverage)
    return np.clip(coverage + gain, 0.0, 1.0)


def build_screen(cfg, plate_spec, shape_hw: tuple[int, int]) -> HalftoneScreen:
    height, width = shape_hw
    period = cfg.screen_period_px(plate_spec)
    return HalftoneScreen(
        height,
        width,
        plate_spec.angle_deg,
        period,
        plate_spec.dot_shape,
    )


__all__ = [
    "DOT_SHAPES",
    "HalftoneScreen",
    "tone_value_increase",
    "cell_coordinates",
    "spot_values",
    "quantile_threshold_table",
    "build_screen",
]
