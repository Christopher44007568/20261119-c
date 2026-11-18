"""End-to-end demonstration:

1. tone-map a synthetic HDR scene;
2. add film grain in fixed and evolving modes;
3. report mean-luminance shifts on black / gray / white test patches;
4. measure spatial autocorrelation and temporal correlation;
5. save figures and a JSON report under artifacts/.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from film_grain import (
    FilmGrain,
    GrainConfig,
    reinhard,
    mean_shift,
    spatial_autocorrelation,
    temporal_correlation_pixelwise,
)

rng = np.random.default_rng(2026)
H, W = 128, 128
N_FRAMES = 80


def hdr_scene() -> np.ndarray:
    """Synthetic HDR image: gradient plus bright and dark blobs."""
    yy, xx = np.mgrid[0:H, 0:W] / (H - 1)
    luma = 0.15 + 0.7 * xx
    bright_blob = 6.0 * np.exp(-((xx - 0.75) ** 2 +
                                 (yy - 0.3) ** 2) / 0.01)
    dark_blob = -0.12 * np.exp(-((xx - 0.25) ** 2 +
                                 (yy - 0.7) ** 2) / 0.02)
    luma = np.clip(luma + bright_blob + dark_blob, 0.0, None)
    color = np.empty((H, W, 3))
    color[..., 0] = luma * (1.0 + 0.15 * yy)
    color[..., 1] = luma
    color[..., 2] = luma * (1.1 - 0.1 * xx)
    return color


def patch_report() -> list[dict]:
    """Mean-luminance shifts on black, mid-gray and near-white patches."""
    processor = FilmGrain(GrainConfig(intensity=0.06, scale=1.5,
                                     shadow_gain=1.0,
                                     highlight_gain=0.5, seed=11))
    rows = []
    for name, level in (("black", 0.0), ("mid_gray", 0.5),
                        ("near_white", 0.9), ("white", 1.0)):
        patch = np.full((512, 512, 3), level)
        result = mean_shift(patch, processor.apply(patch), name)
        rows.append({
            "patch": name,
            "level": level,
            "mean_before": result.mean_before,
            "mean_after": result.mean_after,
            "mean_delta": result.mean_delta,
            "std_after": result.std_after,
            "black_bit_exact": result.black_exact,
        })
    return rows


def simulate(mode: str, base: np.ndarray) -> np.ndarray:
    cfg = GrainConfig(intensity=0.06, scale=1.5,
                      shadow_gain=1.0, highlight_gain=0.5,
                      temporal_corr=0.8, mode=mode, seed=7)
    processor = FilmGrain(cfg)
    return np.stack([processor.apply(base) for _ in range(N_FRAMES)])


def main() -> None:
    scene = reinhard(hdr_scene())
    fixed = simulate("fixed", scene)
    evolving = simulate("evolving", scene)

    field = FilmGrain(GrainConfig(scale=1.5, seed=7))._field_gen
    acf = spatial_autocorrelation(field.sample((H, W)), max_lag=16)
    temp_fixed = temporal_correlation_pixelwise(fixed[..., 1], max_lag=8)
    temp_evo = temporal_correlation_pixelwise(evolving[..., 1], max_lag=8)

    report = {
        "config": {
            "intensity": 0.06,
            "scale_px": 1.5,
            "shadow_gain": 1.0,
            "highlight_gain": 0.5,
            "temporal_corr": 0.8,
            "frames": N_FRAMES,
        },
        "patch_report": patch_report(),
        "spatial_acf": np.round(acf, 6).tolist(),
        "temporal_corr_fixed": np.round(temp_fixed, 6).tolist(),
        "temporal_corr_evolving": np.round(temp_evo, 6).tolist(),
        "fixed_frame_to_frame_identical":
            bool(np.array_equal(fixed[0], fixed[1])),
    }
    with open("artifacts/grain_report.json", "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    np.savez_compressed(
        "artifacts/grain_sequences.npz",
        base=scene.astype(np.float32),
        fixed=fixed.astype(np.float32),
        evolving=evolving.astype(np.float32), acf=acf,
        temp_fixed=temp_fixed, temp_evo=temp_evo)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
