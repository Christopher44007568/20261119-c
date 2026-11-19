"""Print simulation: dot gain, misregistration, paper, composite reflectance."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .color import demichel_weights, predict_rgb, primary_table_for, rgb_to_cmyk
from .screen import build_screen, tone_value_increase


def srgb_compand(linear_rgb: np.ndarray) -> np.ndarray:
    """Linear sRGB -> gamma-encoded sRGB for preview image files."""
    x = np.clip(linear_rgb, 0.0, 1.0)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def _optical_spread(coverage: np.ndarray, sigma_px: float) -> np.ndarray:
    """Sub-pixel optical diffusion (Yule-Nielsen style light spreading)."""
    if sigma_px < 0.5:
        return coverage
    ksize = int(2 * round(3 * sigma_px) + 1)
    ksize = min(max(ksize, 3), 15)
    if ksize % 2 == 0:
        ksize += 1
    return cv2.GaussianBlur(
        coverage, (ksize, ksize), sigmaX=sigma_px,
        sigmaY=sigma_px, borderType=cv2.BORDER_REFLECT,
    )


def _shift(coverage: np.ndarray, dx_px: float, dy_px: float) -> np.ndarray:
    """Translate a plate; positive dx moves content right, dy down."""
    if dx_px == 0 and dy_px == 0:
        return coverage
    matrix = np.array([[1, 0, dx_px], [0, 1, dy_px]], dtype=np.float64)
    return cv2.warpAffine(
        coverage, matrix, (coverage.shape[1], coverage.shape[0]),
        flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT,
    )


@dataclass
class PrintSimulation:
    cfg: object
    cmyk_continuous: np.ndarray  # ideal coverage before halftoning, HxWx4
    coverage_with_tvi: np.ndarray  # coverage after the TVI dot-gain curve
    plates: dict  # channel -> binary uint8 HxW (as printed, post-shift)
    plates_nominal: dict  # channel -> binary uint8 before misregistration
    effective: dict  # channel -> fractional coverage after gain + shift
    composite_rgb: np.ndarray  # simulated paper reflectance, linear RGB
    reference_rgb: np.ndarray  # continuous-tone print incl. TVI dot gain
    rule_rgb: np.ndarray  # ideal rule-based prediction, no print effects


def separate_and_render(cfg, target_rgb: np.ndarray) -> PrintSimulation:
    """Run the full pipeline for one configuration."""
    height, width = cfg.shape
    # Normalize by the paper white first: the blank substrate must map to
    # zero ink.  Without this step its reflectance (<1) would be mistaken
    # for a printable color and produce spurious dots on blank paper.
    paper = np.array(cfg.paper_rgb, dtype=np.float64)
    normalized = np.clip(target_rgb / paper, 0.0, 1.0)
    cmyk = rgb_to_cmyk(normalized, cfg.ucr_strength)

    rng = np.random.default_rng(cfg.seed)
    primary_table = primary_table_for(cfg)

    binary_nominal: dict[str, np.ndarray] = {}
    binary_printed: dict[str, np.ndarray] = {}
    effective: dict[str, np.ndarray] = {}
    tvi = np.zeros_like(cmyk)
    optical_sigma_px = cfg.um_to_px(cfg.optical_spread_sigma_um)

    for spec in cfg.plates:
        ch = spec.channel
        screen = build_screen(cfg, spec, (height, width))
        ideal_coverage = cmyk[..., _cmyk_index(ch)]
        # 1) physical dot gain (TVI), resolution independent
        gained_coverage = tone_value_increase(
            ideal_coverage, cfg.dot_gain_midtone_pp
        )
        tvi[..., _cmyk_index(ch)] = gained_coverage
        # 2) amplitude-modulated screening -> binary plate
        nominal = screen.render(gained_coverage)
        dx = cfg.um_to_px(spec.misregister_um[0])
        dy = cfg.um_to_px(spec.misregister_um[1])
        # 3) misregistration (physical shift, converted to pixels per dpi)
        printed = _shift(nominal.astype(np.float64), dx, dy)
        # 4) optical diffusion -> effective fractional coverage
        gained = np.clip(_optical_spread(printed, optical_sigma_px), 0.0, 1.0)
        binary_nominal[ch] = nominal
        binary_printed[ch] = (printed >= 0.5).astype(np.uint8)
        effective[ch] = gained
    # Demichel weights from *effective* (dot-gained, shifted) coverages,
    # combined with the 16-primary reflectance table.
    eff_cmyk = np.stack(
        [effective[ch] for ch in "CMYK"], axis=-1
    )
    weights = demichel_weights(eff_cmyk)
    composite = np.einsum("...i,ij->...j", weights, primary_table)

    # deterministic multiplicative paper grain
    if cfg.paper_grain_sigma > 0:
        grain = rng.normal(1.0, cfg.paper_grain_sigma, composite.shape)
        composite = composite * np.clip(grain, 0.9, 1.1)

    # Continuous-tone benchmark *with* the same TVI dot gain as the print:
    # any residual gap to the composite is caused by screening, optical
    # diffusion and misregistration rather than by the dot-gain curve itself.
    reference = predict_rgb(
        tvi,
        np.array([ink.solid_rgb for ink in cfg.inks]),
        np.array(cfg.paper_rgb),
    )
    rule_rgb = predict_rgb(
        cmyk,
        np.array([ink.solid_rgb for ink in cfg.inks]),
        np.array(cfg.paper_rgb),
    )
    return PrintSimulation(
        cfg=cfg,
        cmyk_continuous=cmyk,
        coverage_with_tvi=tvi,
        plates=binary_printed,
        plates_nominal=binary_nominal,
        effective=effective,
        composite_rgb=np.clip(composite, 0.0, 1.0),
        reference_rgb=np.clip(reference, 0.0, 1.0),
        rule_rgb=np.clip(rule_rgb, 0.0, 1.0),
    )


def _cmyk_index(channel: str) -> int:
    return "CMYK".index(channel)


__all__ = ["PrintSimulation", "separate_and_render", "srgb_compand"]
