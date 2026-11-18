"""End-to-end analysis: LUT generation, reference validation, heatmaps,
resolution study, and roughness-continuity check.

Usage: python3 scripts/run_analysis.py [--fast]
Outputs land in artifacts/.
"""

import argparse
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from brdf.integrator import generate_lut, integrate_brdf, mirror_limit
from brdf.reference import integrate_brdf_reference
from brdf.evaluate import sample_lut, brightness, error_stats

ART = os.path.join(os.path.dirname(__file__), "..", "artifacts")
# Validation grid resolution (NdotV x roughness). 129 is odd, so its texel
# centers never coincide with any power-of-two LUT texel center - the LUT
# is always evaluated through genuine bilinear interpolation.
GRID = 129
LUT_SAMPLES = 16384
F0 = 0.04


def validation_grid():
    axis = (np.arange(GRID) + 0.5) / GRID
    nv, rr = np.meshgrid(axis, axis, indexing="xy")
    return nv, rr


def reference_grid(nv, rr, fast):
    path = os.path.join(ART, "reference_grid.npy")
    if os.path.exists(path):
        cached = np.load(path)
        if cached.shape == nv.shape + (2,):
            print("reference grid: loaded cache", path)
            return cached
    nt, np_ = ((1024, 256) if fast else (4096, 512))
    print(f"reference grid: computing {nv.size} points (max grid {nt}x{np_}) ...")
    t0 = time.time()
    a, b = integrate_brdf_reference(nv, rr, nt, np_)
    ref = np.stack([a, b], axis=-1)
    np.save(path, ref)
    print(f"reference grid: done in {time.time() - t0:.1f}s")
    return ref


def lut_error(lut_res, ref, nv, rr):
    lut = generate_lut(lut_res, LUT_SAMPLES)
    ab = sample_lut(lut, nv, rr)
    err = brightness(ab, F0) - brightness(ref, F0)
    return lut, err


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fast", action="store_true", help="smaller reference")
    args = parser.parse_args()
    os.makedirs(ART, exist_ok=True)
    nv, rr = validation_grid()
    ref = reference_grid(nv, rr, args.fast)
    from plots import (
        make_heatmap,
        make_resolution_plot,
        make_continuity_plot,
        make_lut_preview,
    )

    # 1) Error heatmap for the default 128 LUT.
    lut, err = lut_error(128, ref, nv, rr)
    np.save(os.path.join(ART, "env_brdf_lut_128.npy"), lut)
    make_lut_preview(lut, os.path.join(ART, "env_brdf_lut_128.png"))
    stats = error_stats(err)
    print("128 LUT brightness error:", {k: f"{v:.3e}" for k, v in stats.items()})
    make_heatmap(err, os.path.join(ART, "error_heatmap.png"))

    # 2) Resolution study.
    rows = []
    for res in [8, 16, 32, 64, 128, 256]:
        _, e = lut_error(res, ref, nv, rr)
        s = error_stats(e)
        interior = error_stats(e[nv >= 0.05])
        rows.append((res, s["max_abs"], s["rms"], interior["max_abs"]))
        print(
            f"res {res:4d}: max {s['max_abs']:.3e} rms {s['rms']:.3e} "
            f"max(NdotV>=0.05) {interior['max_abs']:.3e}"
        )
    np.savetxt(
        os.path.join(ART, "resolution_study.csv"),
        np.array(rows),
        delimiter=",",
        header="resolution,max_abs,rms,max_abs_ndotv_ge_0.05",
        comments="",
    )
    make_resolution_plot(rows, os.path.join(ART, "resolution_study.png"))

    # 3) Continuity across roughness (dense sweep through texel boundaries).
    make_continuity_plot(lut, os.path.join(ART, "continuity.png"))

    # 4) Boundary limit validation.
    check_limits()


def check_limits():
    print("\nboundary limits:")
    nv = np.array([0.0, 1e-4, 1e-2])
    rr = np.full(3, 0.5)
    ai, bi = integrate_brdf(nv, rr, 8192)
    ar, br = integrate_brdf_reference(nv, rr)
    for i in range(3):
        print(
            f"  NdotV={nv[i]:.0e}: int=({ai[i]:.5f},{bi[i]:.5f}) "
            f"ref=({ar[i]:.5f},{br[i]:.5f})"
        )
    rr = np.array([0.0, 1e-4, 1e-2])
    nv = np.full(3, 0.6)
    ai, bi = integrate_brdf(nv, rr, 8192)
    am, bm = mirror_limit(0.6)
    for i in range(3):
        print(
            f"  rough={rr[i]:.0e}: int=({ai[i]:.5f},{bi[i]:.5f}) "
            f"mirror-limit=({am:.5f},{bm:.5f})"
        )


if __name__ == "__main__":
    main()
