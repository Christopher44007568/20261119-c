"""Run the full FXAA evaluation suite and export artifacts."""

import json
import os

import numpy as np
from PIL import Image

import fxaa
import metrics
import scaling_test
import test_images
import visualize

OUT_DIR = os.path.join("artifacts", "out")

# Scenarios with an analytic supersampled ground truth.
SUPERSAMPLED = {"hard_edges", "gradient", "diagonal_line", "checkerboard",
                "flat_blocks"}


def run_scenario(name, generator):
    if name == "size_boundary":
        img = generator()
    else:
        img = generator()
    out = fxaa.apply_fxaa(img)
    result = out["result"]

    if name in SUPERSAMPLED:
        if name == "checkerboard":
            ref = metrics.supersample_reference(generator, 256, cells=32)
        else:
            ref = metrics.supersample_reference(generator, 256)
    else:
        ref = img  # noise / text / odd-size: measure deviation from input

    err_map, err_stats = metrics.per_pixel_error(result, ref)
    pres_rate, n_edge = metrics.edge_preservation(img, result)
    identical, reload_max = metrics.check_export_reload(result)
    if name == "flat_blocks":
        # Invariant: pixels with no edge in the input stay bit-exact.
        nb = fxaa.neighborhood(fxaa.to_luma(img))
        _, _, edge_mask_in = fxaa.edge_contrast(nb)
        flat_change = np.abs(result - img).max(axis=-1)
        flat_max = float(flat_change[~edge_mask_in].max())
    else:
        flat_max = None

    png_path = os.path.join(OUT_DIR, f"{name}_result.png")
    Image.fromarray(metrics.to_uint8(result)).save(png_path)
    reloaded = np.asarray(Image.open(png_path), dtype=np.float64) / 255.0
    reload_ok = np.array_equal(metrics.to_uint8(reloaded),
                               metrics.to_uint8(result))

    stats = (f"preserve={pres_rate:.3f} ({n_edge} edge px)  "
             f"MAE={err_stats['mae']:.4f}  p95={err_stats['p95']:.4f}  "
             f"max={err_stats['max']:.4f}")
    visualize.save_comparison(
        os.path.join(OUT_DIR, f"{name}_compare.png"),
        img, result, out["edge_mask"], err_map, name, stats)
    if name in ("hard_edges", "diagonal_line", "low_contrast_text"):
        visualize.save_direction_map(
            os.path.join(OUT_DIR, f"{name}_directions.png"),
            img, out["blend_vec"], out["is_horizontal"], out["edge_mask"],
            f"Sampling directions - {name}")

    return {
        "edge_preservation_rate": round(pres_rate, 4),
        "edge_pixels": n_edge,
        "error": {k: round(v, 5) for k, v in err_stats.items()},
        "export_reload_identical": bool(identical and reload_ok),
        "export_reload_max_diff": reload_max,
        "flat_max_change": flat_max,
    }


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    report = {}
    for name, gen in test_images.SCENARIOS.items():
        report[name] = run_scenario(name, gen)
        print(f"[{name}] {report[name]}")

    sweep = scaling_test.run_scaling_sweep()
    visualize.save_scaling_curve(
        os.path.join(OUT_DIR, "scaling_continuity.png"),
        sweep["scales"], sweep["frame_diff"], sweep["jaggedness"],
        sweep["orientations"])
    report["scaling_continuity"] = {
        "passed": sweep["passed"],
        "max_frame_diff": round(sweep["max_frame_diff"], 5),
        "max_dir_jump_deg": round(sweep["max_dir_jump_deg"], 3),
        "max_jaggedness_px": round(float(sweep["jaggedness"].max()), 4),
    }
    print(f"[scaling_continuity] {report['scaling_continuity']}")

    with open(os.path.join(OUT_DIR, "report.json"), "w") as fh:
        json.dump(report, fh, indent=2)

    failures = []
    for name, r in report.items():
        if name == "scaling_continuity":
            if not r["passed"]:
                failures.append("scaling continuity spike")
            continue
        if not r["export_reload_identical"]:
            failures.append(f"{name}: export/reload mismatch")
    if report["flat_blocks"]["flat_max_change"] != 0.0:
        failures.append("flat blocks were modified")
    if report["diagonal_line"]["edge_preservation_rate"] < 0.9:
        failures.append("thin diagonal line was erased")
    if failures:
        raise SystemExit("FAILURES: " + "; ".join(failures))
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
