"""Fast, dependency-light checks for the halftone pipeline."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from halftone.color import cmyk_to_rgb_rule, rgb_to_cmyk
from halftone.config import ExperimentConfig
from halftone.screen import HalftoneScreen, tone_value_increase
from halftone.simulate import separate_and_render
from halftone.target import build_target


def test_rgb_cmyk_rule_roundtrip_and_black():
    rgb = np.array([[[1.0, 1.0, 1.0], [0.2, 0.4, 0.6]]])
    cmyk = rgb_to_cmyk(rgb, ucr_strength=0.9)
    # paper white -> no ink
    assert np.allclose(cmyk[0, 0], 0.0, atol=1e-12)
    # rule is invertible
    assert np.allclose(cmyk_to_rgb_rule(cmyk), rgb, atol=1e-12)
    # pure black is K dominated
    black = rgb_to_cmyk(np.zeros((1, 1, 3)), ucr_strength=1.0)
    assert black[0, 0, 3] == 1.0
    assert np.allclose(black[0, 0, :3], 0.0)


def test_screen_area_matches_coverage():
    rng = np.random.default_rng(0)
    screen = HalftoneScreen(256, 256, 15.0, 4.0, "circle")
    coverage = rng.uniform(0.05, 0.95, (256, 256))
    plate = screen.render(coverage)
    # quantile thresholding keeps whole-image area close to the request
    assert abs(plate.mean() - coverage.mean()) < 0.01


def test_tvi_curve_endpoints_and_midtone():
    assert tone_value_increase(0.0, 12.0) == 0.0
    assert tone_value_increase(1.0, 12.0) == 1.0
    assert abs(float(tone_value_increase(0.5, 12.0)) - 0.62) < 1e-12


def test_physical_screen_ruling_is_dpi_invariant():
    pitches = []
    for dpi in (150.0, 300.0, 600.0):
        cfg = ExperimentConfig(dpi=dpi)
        spec = cfg.plate("C")
        pitch_mm = cfg.screen_period_px(spec) / cfg.px_per_mm
        pitches.append(pitch_mm)
    assert np.allclose(pitches, pitches[0], atol=1e-12)
    assert abs(25.4 / pitches[0] - 150.0) < 1e-9


def test_blank_paper_carries_no_ink():
    cfg = ExperimentConfig(dpi=150.0)
    target, _ = build_target(cfg)
    sim = separate_and_render(cfg, target)
    n = int(6 * cfg.px_per_mm)  # top-left region is blank substrate
    for ch in "CMYK":
        assert sim.plates[ch][:n, :n].mean() == 0.0


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
    print("all checks passed")
