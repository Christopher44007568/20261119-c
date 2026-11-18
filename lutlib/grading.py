"""Color grading pipeline: tone mapping + optional LUT, applied to scenes.

The tone map runs first and is completely independent of LUT state, so
toggling the LUT never changes the underlying tone-mapped image: with the
LUT off (or with an identity LUT) the output is exactly the tone-mapped
result. The LUT is evaluated in tone-mapped display space and its output
is clamped to [0, 1].
"""

from __future__ import annotations

from typing import Iterable, List, Sequence, Tuple

from .cube import CubeLUT
from .interp import apply_lut

Vec3 = Tuple[float, float, float]


class ToneMapper:
    """Deterministic, dependency-free tone mapping operators (scene -> [0,1])."""

    @staticmethod
    def clamp01(value: float) -> float:
        return 0.0 if value < 0.0 else 1.0 if value > 1.0 else value

    @classmethod
    def reinhard(cls, color: Sequence[float]) -> Vec3:
        return tuple(c / (1.0 + c) if c > 0.0 else 0.0 for c in color)  # type: ignore[return-value]

    @classmethod
    def aces_approx(cls, color: Sequence[float]) -> Vec3:
        # Narkowicz ACES approximation, per channel.
        a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
        out = []
        for x in color:
            x = max(x, 0.0)
            out.append(cls.clamp01((x * (a * x + b)) / (x * (c * x + d) + e)))
        return (out[0], out[1], out[2])

    @classmethod
    def apply(cls, color: Sequence[float], operator: str = "aces") -> Vec3:
        if operator == "aces":
            return cls.aces_approx(color)
        if operator == "reinhard":
            return cls.reinhard(color)
        if operator == "none":
            return tuple(cls.clamp01(c) for c in color)  # type: ignore[return-value]
        raise ValueError(f"unknown tone mapping operator {operator!r}")


class GradingPipeline:
    """Tone map a scene, then optionally apply a 1D/3D LUT.

    `lut_enabled` only gates the LUT stage; the tone-mapped intermediate is
    computed identically either way, which keeps results stable across
    toggles. `tone_mapped()` exposes that intermediate for verification.
    """

    def __init__(
        self,
        lut: CubeLUT | None = None,
        operator: str = "aces",
        lut_enabled: bool = True,
        method: str = "tetrahedral",
    ) -> None:
        self.lut = lut
        self.operator = operator
        self.lut_enabled = lut_enabled
        self.method = method

    def tone_mapped(self, color: Sequence[float]) -> Vec3:
        return ToneMapper.apply(color, self.operator)

    def grade_color(self, color: Sequence[float]) -> Vec3:
        mapped = self.tone_mapped(color)
        if not self.lut_enabled or self.lut is None:
            return mapped
        graded = apply_lut(self.lut, mapped, self.method)
        return tuple(ToneMapper.clamp01(c) for c in graded)  # type: ignore[return-value]

    def grade_scene(self, pixels: Iterable[Sequence[float]]) -> List[Vec3]:
        return [self.grade_color(pixel) for pixel in pixels]
