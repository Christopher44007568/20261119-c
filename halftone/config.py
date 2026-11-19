"""Experiment configuration: every physical parameter is explicit.

Conventions
-----------
* Lengths are millimetres unless the name ends with ``_um`` (micrometres).
* Screen frequencies are lines per inch (lpi), the printing-industry unit.
* Input RGB is *linear* sRGB (BT.709 primaries, reference white D65),
  values in [0, 1]; 1.0 means the paper's reflected-light maximum.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
import math


# ---------------------------------------------------------------------------
# Screen and ink descriptions
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PlateSpec:
    """One of the four separation plates."""

    channel: str  # 'C' | 'M' | 'Y' | 'K'
    angle_deg: float  # screen angle, degrees, measured CCW from the x axis
    frequency_lpi: float  # physical screen ruling, lines per inch
    dot_shape: str  # 'euclidean' | 'circle' | 'diamond' | 'line'
    misregister_um: tuple[float, float]  # (dx, dy) paper shift of this plate


@dataclass(frozen=True)
class InkSpec:
    """Solid-ink spectral response expressed as *linear RGB* reflectance.

    A neutral cyan absorbs mostly red, etc.  These are the reflectances of a
    fully covered area relative to the blank paper, so all entries lie in
    [0, 1].  The same convention applies to the paper value.
    """

    channel: str
    solid_rgb: tuple[float, float, float]


@dataclass(frozen=True)
class ExperimentConfig:
    """All knobs for one experiment run.

    The physical geometry (``width_mm`` etc.) is fixed; changing
    ``dpi`` only changes the sampling grid, so the physical screen ruling
    (lpi) and every physical length stay constant across resolutions.
    """

    # target geometry
    width_mm: float = 90.0
    height_mm: float = 120.0
    dpi: float = 600.0

    # paper reflectance in linear RGB
    paper_rgb: tuple[float, float, float] = (0.92, 0.91, 0.88)
    inks: tuple[InkSpec, ...] = (
        InkSpec("C", (0.06, 0.55, 0.72)),
        InkSpec("M", (0.65, 0.12, 0.50)),
        InkSpec("Y", (0.90, 0.82, 0.05)),
        InkSpec("K", (0.04, 0.04, 0.05)),
    )

    # classic offset screen set: C 15 / M 75 / Y 0 / K 45 degrees,
    # weak yellow on its own coarser ruling to reduce moire visibility.
    plates: tuple[PlateSpec, ...] = (
        PlateSpec("C", 15.0, 150.0, "circle", (25.0, 12.0)),
        PlateSpec("M", 75.0, 150.0, "euclidean", (-18.0, 20.0)),
        PlateSpec("Y", 0.0, 133.0, "diamond", (15.0, -10.0)),
        PlateSpec("K", 45.0, 150.0, "diamond", (0.0, 0.0)),
    )

    # RGB->CMYK rule
    ucr_strength: float = 0.9  # fraction of the neutral component moved to K
    k_epsilon: float = 1e-6

    # print simulation
    # Physical TVI (tone value increase) dot-gain curve, applied on the
    # coverage domain so the effect is identical at every output resolution.
    # A 50% mid-tone therefore prints as ~62% coverage (12 pp gain).
    dot_gain_midtone_pp: float = 12.0
    optical_spread_sigma_um: float = 6.0  # sub-pixel optical diffusion
    paper_grain_sigma: float = 0.005  # multiplicative paper noise (1 sigma)
    seed: int = 20261119  # fixed seed => byte-identical reruns

    # reference resolution used when comparing two renderings
    compare_dpi: float = 300.0

    def to_dict(self) -> dict:
        return asdict(self)

    def plate(self, channel: str) -> PlateSpec:
        for spec in self.plates:
            if spec.channel == channel:
                return spec
        raise KeyError(channel)

    def ink(self, channel: str) -> InkSpec:
        for spec in self.inks:
            if spec.channel == channel:
                return spec
        raise KeyError(channel)

    # -- geometry helpers --------------------------------------------------

    @property
    def px_per_mm(self) -> float:
        return self.dpi / 25.4

    @property
    def shape(self) -> tuple[int, int]:
        return (
            int(round(self.height_mm * self.px_per_mm)),
            int(round(self.width_mm * self.px_per_mm)),
        )

    def mm_to_px(self, value_mm: float) -> float:
        return value_mm * self.px_per_mm

    def um_to_px(self, value_um: float) -> float:
        return value_um * 1e-3 * self.px_per_mm

    def screen_period_px(self, spec: PlateSpec) -> float:
        """Cell pitch in output pixels for a physical lpi ruling."""
        return self.dpi / spec.frequency_lpi

    def with_dpi(self, dpi: float) -> "ExperimentConfig":
        """Return a copy that differs only in sampling resolution."""
        from dataclasses import replace

        return replace(self, dpi=float(dpi))


def rosette_summary(cfg: ExperimentConfig) -> str:
    """One-line description of the screen set for reports."""
    parts = [
        f"{p.channel} {p.angle_deg:g}deg/{p.frequency_lpi:g}lpi/{p.dot_shape}"
        for p in cfg.plates
    ]
    return ", ".join(parts)


def mm_to_inch(value_mm: float) -> float:
    return value_mm / 25.4


__all__ = [
    "PlateSpec",
    "InkSpec",
    "ExperimentConfig",
    "rosette_summary",
    "mm_to_inch",
    "math",
]
