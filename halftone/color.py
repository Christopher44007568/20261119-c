"""Color science: the explicit linear-RGB -> CMYK rule and print model.

All array inputs/outputs are numpy float arrays in [0, 1] unless noted.
RGB always means *linear* sRGB (BT.709), never gamma-encoded display RGB.
"""

from __future__ import annotations

import itertools
import math

import numpy as np


# ---------------------------------------------------------------------------
# Explicit linear RGB -> CMYK conversion rule
# ---------------------------------------------------------------------------


def rgb_to_cmyk(rgb: np.ndarray, ucr_strength: float = 0.9) -> np.ndarray:
    """Convert linear RGB to CMYK using an explicitly defined rule.

    Step 1, complementary primaries:
        c0 = 1 - R, m0 = 1 - G, y0 = 1 - B
    Step 2, neutral component (the achromatic amount shared by C/M/Y):
        n = min(c0, m0, y0)
    Step 3, under-color removal + black generation:
        K = ucr_strength * n
        C = c0 - K,  M = m0 - K,  Y = y0 - K

    With ``ucr_strength = 1`` every neutral is printed with black only;
    with ``0`` no black is generated and the rule is plain complement.
    Inputs are clipped to [0, 1] for safety; the output channel order is
    C, M, Y, K.
    """
    rgb = np.clip(np.asarray(rgb, dtype=np.float64), 0.0, 1.0)
    c0 = 1.0 - rgb[..., 0]
    m0 = 1.0 - rgb[..., 1]
    y0 = 1.0 - rgb[..., 2]
    neutral = np.minimum(np.minimum(c0, m0), y0)
    black = ucr_strength * neutral
    cyan = c0 - black
    magenta = m0 - black
    yellow = y0 - black
    cmyk = np.stack([cyan, magenta, yellow, black], axis=-1)
    return np.clip(cmyk, 0.0, 1.0)


def cmyk_to_rgb_rule(cmyk: np.ndarray) -> np.ndarray:
    """Inverse of :func:`rgb_to_cmyk` for rule verification only."""
    cmyk = np.asarray(cmyk, dtype=np.float64)
    c, m, y, k = (cmyk[..., i] for i in range(4))
    return np.clip(np.stack([1 - (c + k), 1 - (m + k), 1 - (y + k)], -1), 0, 1)


# ---------------------------------------------------------------------------
# Linear sRGB <-> XYZ <-> Lab (D65 reference) and CIEDE2000
# ---------------------------------------------------------------------------

# BT.709 linear-RGB -> XYZ (D65)
_RGB_TO_XYZ = np.array(
    [
        [0.4123908, 0.3575843, 0.1804808],
        [0.2126390, 0.7151687, 0.0721923],
        [0.0193308, 0.1191948, 0.9505322],
    ]
)

# D65 reference white in XYZ
_WHITE_D65 = np.array([0.95047, 1.0, 1.08883])


def rgb_to_xyz(rgb: np.ndarray) -> np.ndarray:
    return np.einsum("ij,...j->...i", _RGB_TO_XYZ, np.asarray(rgb))


def xyz_to_lab(xyz: np.ndarray) -> np.ndarray:
    xyz = np.asarray(xyz, dtype=np.float64) / _WHITE_D65
    delta = 6.0 / 29.0
    f = np.where(xyz > delta**3, np.cbrt(xyz), xyz / (3 * delta**2) + 4 / 29)
    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    return np.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], -1)


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    return xyz_to_lab(rgb_to_xyz(np.clip(rgb, 0.0, 1.0)))


def ciede2000(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    """CIEDE2000 Delta E (Sharma et al. implementation), pointwise."""
    lab1 = np.asarray(lab1, dtype=np.float64)
    lab2 = np.asarray(lab2, dtype=np.float64)
    l1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    l2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    c1 = np.hypot(a1, b1)
    c2 = np.hypot(a2, b2)
    c_bar = (c1 + c2) / 2
    c_bar7 = c_bar**7
    g = 0.5 * (1 - np.sqrt(c_bar7 / (c_bar7 + 25**7)))
    a1p = (1 + g) * a1
    a2p = (1 + g) * a2
    c1p = np.hypot(a1p, b1)
    c2p = np.hypot(a2p, b2)

    def hue(ap, bp):
        h = np.degrees(np.arctan2(bp, ap))
        return np.where(h < 0, h + 360, h)

    h1p = hue(a1p, b1)
    h2p = hue(a2p, b2)
    delta_p = l2 - l1
    delta_cp = c2p - c1p
    delta_hp = np.zeros_like(delta_cp)
    both = (c1p * c2p) > 0
    raw = h2p - h1p
    delta_hp = np.where(
        both,
        np.where(raw > 180, raw - 360, np.where(raw < -180, raw + 360, raw)),
        0.0,
    )
    delta_hp_cap = 2 * np.sqrt(c1p * c2p) * np.sin(np.radians(delta_hp / 2))

    l_bar_p = (l1 + l2) / 2
    c_bar_p = (c1p + c2p) / 2
    h_bar_p = (h1p + h2p) / 2
    h_bar_p = np.where(both & (np.abs(h1p - h2p) > 180),
                       (h_bar_p + 180) % 360, h_bar_p)
    t = (
        1
        - 0.17 * np.cos(np.radians(h_bar_p - 30))
        + 0.24 * np.cos(np.radians(2 * h_bar_p))
        + 0.32 * np.cos(np.radians(3 * h_bar_p + 6))
        - 0.20 * np.cos(np.radians(4 * h_bar_p - 63))
    )
    delta_theta = 30 * np.exp(-(((h_bar_p - 275) / 25) ** 2))
    r_c = 2 * np.sqrt(c_bar_p**7 / (c_bar_p**7 + 25**7))
    s_l = 1 + (0.015 * (l_bar_p - 50) ** 2) / np.sqrt(
        20 + (l_bar_p - 50) ** 2
    )
    s_c = 1 + 0.045 * c_bar_p
    s_h = 1 + 0.015 * c_bar_p * t
    r_t = -np.sin(np.radians(2 * delta_theta)) * r_c
    k_l = k_c = k_h = 1.0
    de = np.sqrt(
        (delta_p / (k_l * s_l)) ** 2
        + (delta_cp / (k_c * s_c)) ** 2
        + (delta_hp_cap / (k_h * s_h)) ** 2
        + r_t
        * (delta_cp / (k_c * s_c))
        * (delta_hp_cap / (k_h * s_h))
    )
    return de


def deltaE76(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    return np.linalg.norm(np.asarray(lab1) - np.asarray(lab2), axis=-1)


# ---------------------------------------------------------------------------
# Print model: Demichel-Neugebauer mixing of the 16 ink combinations
# ---------------------------------------------------------------------------


def _stacked_reflectance(
    ink_present: tuple[bool, ...],
    ink_solid_rgb: np.ndarray,
    paper_rgb: np.ndarray,
) -> np.ndarray:
    """Reflectance of one Neugebauer primary (paper + subset of inks).

    Inks are modelled by optical density d = -log10(R_ink / R_paper).
    Densities add when inks overprint (Beer-Lambert), so:
        R_stack = R_paper * 10 ** (-sum(d_ink))
    """
    density = np.zeros(3)
    for present, solid in zip(ink_present, ink_solid_rgb):
        if present:
            density += -np.log10(np.clip(solid / paper_rgb, 1e-6, 1.0))
    return paper_rgb * np.power(10.0, -density)


def demichel_weights(coverages: np.ndarray) -> np.ndarray:
    """Map C/M/Y/K fractional coverages to weights of the 16 primaries.

    Returns an array whose last axis follows binary order over
    (C, M, Y, K): index = b_C*8 + b_M*4 + b_Y*2 + b_K.
    Demichel assumes independently positioned screens, the standard
    first-order halftone mixing approximation.
    """
    coverages = np.asarray(coverages)
    c, m, y, k = (coverages[..., i] for i in range(4))
    weights = np.ones(coverages.shape[:-1] + (16,))
    for idx, amount in zip((8, 4, 2, 1), (c, m, y, k)):
        for combo in range(16):
            factor = amount if (combo & idx) else (1.0 - amount)
            weights[..., combo] *= factor
    return weights


def neugebauer_primary_table(
    ink_solid_rgb: np.ndarray, paper_rgb: np.ndarray
) -> np.ndarray:
    """Build the 16x3 table of primary reflectances in linear RGB."""
    table = np.zeros((16, 3))
    for combo in range(16):
        present = tuple(bool(combo & bit) for bit in (8, 4, 2, 1))
        table[combo] = _stacked_reflectance(
            present, ink_solid_rgb, paper_rgb
        )
    return table


def predict_rgb(
    coverages: np.ndarray,
    ink_solid_rgb: np.ndarray,
    paper_rgb: np.ndarray,
) -> np.ndarray:
    """Continuous-tone predicted print reflectance from CMYK coverages."""
    weights = demichel_weights(coverages)
    table = neugebauer_primary_table(ink_solid_rgb, paper_rgb)
    return np.einsum("...i,ij->...j", weights, table)


def primary_table_for(cfg) -> np.ndarray:
    solids = np.array([ink.solid_rgb for ink in cfg.inks], dtype=np.float64)
    paper = np.array(cfg.paper_rgb, dtype=np.float64)
    return neugebauer_primary_table(solids, paper)


__all__ = [
    "rgb_to_cmyk",
    "cmyk_to_rgb_rule",
    "rgb_to_lab",
    "ciede2000",
    "deltaE76",
    "demichel_weights",
    "neugebauer_primary_table",
    "predict_rgb",
    "primary_table_for",
]
