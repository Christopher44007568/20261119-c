"""LUT evaluation: domain mapping, boundary clamping, 1D linear and 3D
trilinear / tetrahedral interpolation.

Boundary handling: inputs are clamped into [DOMAIN_MIN, DOMAIN_MAX] before
interpolation, so out-of-gamut colors map to the nearest lattice edge
instead of extrapolating or wrapping.

Neutral colors: tetrahedral interpolation (the default for 3D LUTs) keeps
the gray axis on the lattice diagonal, so a LUT that maps neutrals to
themselves leaves grays exactly neutral; trilinear is offered for
reference comparison.
"""

from __future__ import annotations

from typing import Iterable, List, Sequence, Tuple

from .cube import CubeLUT, Vec3


def _clamp(value: float, lo: float, hi: float) -> float:
    return lo if value < lo else hi if value > hi else value


def _to_unit(lut: CubeLUT, color: Sequence[float]) -> Vec3:
    """Map a color from the LUT input domain into [0, 1]^3 with clamping."""
    out = []
    for value, lo, hi in zip(color, lut.domain_min, lut.domain_max):
        out.append(_clamp((value - lo) / (hi - lo), 0.0, 1.0))
    return (out[0], out[1], out[2])


def _sample_1d(lut: CubeLUT, unit: Vec3) -> Vec3:
    n = lut.size - 1
    out = []
    for channel in range(3):
        pos = unit[channel] * n
        i0 = min(int(pos), n - 1)
        frac = pos - i0
        a = lut.data[i0][channel]
        b = lut.data[i0 + 1][channel]
        out.append(a + (b - a) * frac)
    return (out[0], out[1], out[2])


def _lattice(lut: CubeLUT, r: int, g: int, b: int) -> Vec3:
    return lut.data[(b * lut.size + g) * lut.size + r]


def _sample_3d_trilinear(lut: CubeLUT, unit: Vec3) -> Vec3:
    n = lut.size - 1
    base = []
    frac = []
    for channel in range(3):
        pos = unit[channel] * n
        i0 = min(int(pos), n - 1)
        base.append(i0)
        frac.append(pos - i0)
    r0, g0, b0 = base
    fr, fg, fb = frac
    out = [0.0, 0.0, 0.0]
    for dr in (0, 1):
        wr = fr if dr else 1.0 - fr
        for dg in (0, 1):
            wg = fg if dg else 1.0 - fg
            for db in (0, 1):
                wb = fb if db else 1.0 - fb
                corner = _lattice(lut, r0 + dr, g0 + dg, b0 + db)
                weight = wr * wg * wb
                for channel in range(3):
                    out[channel] += weight * corner[channel]
    return (out[0], out[1], out[2])


def _sample_3d_tetrahedral(lut: CubeLUT, unit: Vec3) -> Vec3:
    n = lut.size - 1
    base = []
    frac = []
    for channel in range(3):
        pos = unit[channel] * n
        i0 = min(int(pos), n - 1)
        base.append(i0)
        frac.append(pos - i0)
    # Sort fractions descending: the cube diagonal from the base corner to
    # base+(1,1,1) splits the cell into 6 tetrahedra, one per ordering.
    order = sorted(range(3), key=lambda i: -frac[i])
    corners = []
    offsets = [0, 0, 0]
    for _ in range(4):
        corners.append(
            _lattice(lut, base[0] + offsets[0], base[1] + offsets[1], base[2] + offsets[2])
        )
        if len(corners) < 4:
            offsets[order[len(corners) - 1]] = 1
    f = frac
    weights = (
        1.0 - f[order[0]],
        f[order[0]] - f[order[1]],
        f[order[1]] - f[order[2]],
        f[order[2]],
    )
    out = [0.0, 0.0, 0.0]
    for corner, weight in zip(corners, weights):
        for channel in range(3):
            out[channel] += weight * corner[channel]
    return (out[0], out[1], out[2])


def apply_lut(
    lut: CubeLUT,
    color: Sequence[float],
    method: str = "tetrahedral",
) -> Vec3:
    """Evaluate the LUT at one RGB color (in the LUT's input domain)."""
    unit = _to_unit(lut, color)
    if not lut.is_3d:
        return _sample_1d(lut, unit)
    if method == "tetrahedral":
        return _sample_3d_tetrahedral(lut, unit)
    if method == "trilinear":
        return _sample_3d_trilinear(lut, unit)
    raise ValueError(f"unknown interpolation method {method!r}")


def apply_lut_to_image(
    lut: CubeLUT,
    pixels: Iterable[Sequence[float]],
    method: str = "tetrahedral",
) -> List[Vec3]:
    return [apply_lut(lut, pixel, method) for pixel in pixels]
