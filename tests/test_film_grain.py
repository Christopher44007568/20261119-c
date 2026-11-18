"""Acceptance tests for the post-tonemap film-grain pipeline."""

import numpy as np
import pytest

from film_grain import (
    FilmGrain,
    GrainConfig,
    reinhard,
    mean_shift,
    spatial_autocorrelation,
    temporal_correlation_pixelwise,
)


def flat_rgb(value, height=64, width=64):
    return np.full((height, width, 3), value, dtype=np.float64)


def test_zero_intensity_returns_input_exactly():
    image = np.random.default_rng(1).random((24, 24, 3))
    processor = FilmGrain(GrainConfig(intensity=0.0))
    assert processor.apply(image) is image
    # Also through both temporal modes.
    for mode in ("fixed", "evolving"):
        processor = FilmGrain(GrainConfig(intensity=0.0, mode=mode))
        assert processor.apply(image) is image


def test_pure_black_is_bit_exact_and_not_lifted():
    black = np.zeros((48, 48, 3), dtype=np.float64)
    for mode in ("fixed", "evolving"):
        processor = FilmGrain(GrainConfig(intensity=0.2, scale=2.0,
                                         mode=mode))
        out = processor.apply(black)
        assert np.array_equal(out, black)
        assert out.max() == 0.0


def test_fixed_mode_is_identical_across_frames():
    processor = FilmGrain(GrainConfig(mode="fixed", intensity=0.1,
                                      scale=1.5, seed=42))
    frame = flat_rgb(0.4)
    first = processor.apply(frame)
    rest = [processor.apply(frame) for _ in range(4)]
    for other in rest:
        assert np.array_equal(first, other)


def test_evolving_mode_changes_and_approaches_target_correlation():
    rho = 0.7
    processor = FilmGrain(GrainConfig(mode="evolving", intensity=0.1,
                                      scale=1.5, temporal_corr=rho,
                                      seed=7))
    frame = flat_rgb(0.4, height=96, width=96)
    frames = np.stack([processor.apply(frame) for _ in range(400)])
    corr = temporal_correlation_pixelwise(frames[..., 0], max_lag=1)
    # Lag-1 correlation of the AR(1) process must be close to rho.
    assert corr[0] == pytest.approx(1.0)
    assert abs(corr[1] - rho) < 0.05


def test_evolving_independent_when_temporal_corr_is_zero():
    processor = FilmGrain(GrainConfig(mode="evolving", intensity=0.1,
                                      temporal_corr=0.0, seed=3))
    frame = flat_rgb(0.5, height=96, width=96)
    frames = np.stack([processor.apply(frame) for _ in range(200)])
    corr = temporal_correlation_pixelwise(frames[..., 0], max_lag=1)
    assert abs(corr[1]) < 0.12


def test_spatial_autocorrelation_grows_with_scale():
    small = FilmGrain(GrainConfig(scale=0.8, seed=1))._field_gen
    large = FilmGrain(GrainConfig(4.0, seed=1))._field_gen
    acf_small = spatial_autocorrelation(small.sample((128, 128)), 8)
    acf_large = spatial_autocorrelation(large.sample((128, 128)), 8)
    assert acf_small[0] == pytest.approx(1.0)
    assert acf_large[4] > acf_small[4]


def test_amplitude_dark_vs_highlight_and_gains():
    image = np.concatenate([flat_rgb(0.1)[..., 0],
                            flat_rgb(0.9)[..., 0]], axis=1)
    processor = FilmGrain(GrainConfig(intensity=0.2,
                                      shadow_gain=1.0,
                                      highlight_gain=0.4))
    amp = processor.amplitude_map(image)
    dark, bright = amp[:, :64], amp[:, 64:]
    expected_dark = 0.2 * (1.0 + (0.4 - 1.0) * 0.1) * 0.1
    assert dark.mean() == pytest.approx(expected_dark, rel=1e-12)
    assert bright.mean() == pytest.approx(
        0.2 * (1.0 + (0.4 - 1.0) * 0.9) * 0.9, rel=1e-12)
    assert dark.mean() < bright.mean()


def test_patch_mean_shift_is_near_zero_and_black_exact():
    processor = FilmGrain(GrainConfig(intensity=0.08, scale=1.5, seed=11))
    levels = {"black": 0.0, "gray": 0.5, "near_white": 0.8}
    for name, level in levels.items():
        patch = flat_rgb(level, height=256, width=256)
        result = mean_shift(patch, processor.apply(patch), name)
        if name == "black":
            assert result.black_exact
            assert result.mean_delta == 0.0
        else:
            # Zero-mean grain: residual shift shrinks with sample count.
            assert abs(result.mean_delta) < 0.005
            assert result.std_after > 0.0


def test_white_patch_shift_is_clipping_only():
    # At L = 1 every positive perturbation is clipped, producing a
    # one-sided negative shift; the shift must match the clipped tail.
    processor = FilmGrain(GrainConfig(intensity=0.08, scale=1.5, seed=11))
    white = flat_rgb(1.0, height=256, width=256)
    out = processor.apply(white)
    assert out.max() == 1.0
    result = mean_shift(white, out, "white")
    assert result.mean_delta < 0.0
    assert result.mean_after < 1.0


def test_output_clipped_to_unit_range():
    hdr = reinhard(np.linspace(0, 8, 64 * 64).reshape(64, 64, 1)
                   * np.ones(3))
    processor = FilmGrain(GrainConfig(intensity=0.5, seed=5))
    out = processor.apply(hdr)
    assert out.min() >= 0.0 and out.max() <= 1.0


def test_grayscale_and_rgb_share_luma_behavior():
    gray = np.full((32, 32), 0.3)
    rgb = np.full((32, 32, 3), 0.3)
    processor_gray = FilmGrain(GrainConfig(intensity=0.1, seed=2))
    processor_rgb = FilmGrain(GrainConfig(intensity=0.1, seed=2))
    out_gray = processor_gray.apply(gray)
    out_rgb = processor_rgb.apply(rgb)
    assert np.allclose(out_gray, out_rgb[..., 0])
