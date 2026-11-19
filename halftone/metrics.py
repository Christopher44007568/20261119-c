"""Quantitative metrics over named physical regions of interest."""

from __future__ import annotations

import numpy as np

from .color import ciede2000, deltaE76, rgb_to_lab


# ---------------------------------------------------------------------------
# Area-coverage accuracy
# ---------------------------------------------------------------------------


def ramp_coverage_table(sim, rois) -> list[dict]:
    """Requested vs. measured ink coverage on every gray-ramp step."""
    ppm = sim.cfg.px_per_mm
    rows = []
    ramp_rois = [r for r in rois if r.kind == "ramp"]
    for roi in ramp_rois:
        sy, sx = roi.pixel_bbox(ppm)
        level = float(roi.name.split("_")[-1])
        row = {"roi": roi.name, "requested_gray": level}
        for ch in "CMYK":
            idx = "CMYK".index(ch)
            ideal = float(sim.cmyk_continuous[sy, sx, idx].mean())
            tvi = float(sim.coverage_with_tvi[sy, sx, idx].mean())
            measured = float(sim.plates_nominal[ch][sy, sx].mean())
            row[f"{ch}_ideal_coverage"] = ideal
            row[f"{ch}_requested"] = tvi
            row[f"{ch}_measured"] = measured
            row[f"{ch}_error_pp"] = (measured - tvi) * 100.0
            row[f"{ch}_dot_gain_pp"] = (tvi - ideal) * 100.0
        rows.append(row)
    return rows


def coverage_rmse(rows: list[dict]) -> dict[str, float]:
    out = {}
    for ch in "CMYK":
        errs = np.array([r[f"{ch}_error_pp"] for r in rows])
        out[ch] = float(np.sqrt(np.mean(errs**2)))
    return out


# ---------------------------------------------------------------------------
# Detail loss on fine lines and the resolution wedge
# ---------------------------------------------------------------------------


def _fwhm_px(profile: np.ndarray) -> float:
    """Full width at half maximum of a 1-D dark-line profile (0..1 depth)."""
    depth = profile.max() - profile.min()
    if depth <= 1e-6:
        return 0.0
    half = profile.min() + depth / 2.0
    above = np.flatnonzero(profile >= half)
    if above.size < 2:
        return 0.0
    return float(above[-1] - above[0] + 1)


def line_detail_table(sim, target_rgb, rois) -> list[dict]:
    """Line width (FWHM) and Michelson contrast for each line ROI."""
    ppm = sim.cfg.px_per_mm
    rendered_gray = sim.composite_rgb.mean(axis=-1)
    target_gray = target_rgb.mean(axis=-1)
    rows = []
    for roi in rois:
        if roi.kind != "line":
            continue
        sy, sx = roi.pixel_bbox(ppm)
        vertical = roi.name.startswith("vline")
        # collapse along the line direction to get the cross-section
        target_profile = (
            1 - target_gray[sy, sx].mean(axis=0)
            if vertical
            else 1 - target_gray[sy, sx].mean(axis=1)
        )
        rendered_profile = (
            1 - rendered_gray[sy, sx].mean(axis=0)
            if vertical
            else 1 - rendered_gray[sy, sx].mean(axis=1)
        )
        target_fwhm = _fwhm_px(target_profile) / ppm
        rendered_fwhm = _fwhm_px(rendered_profile) / ppm
        lo, hi = rendered_profile.min(), rendered_profile.max()
        contrast = float((hi - lo) / (hi + lo)) if hi + lo > 0 else 0.0
        rows.append(
            {
                "roi": roi.name,
                "direction": "vertical" if vertical else "horizontal",
                "nominal_width_mm": float(roi.name.split("_")[1].replace("mm", "")),
                "target_fwhm_mm": float(target_fwhm),
                "rendered_fwhm_mm": float(rendered_fwhm),
                "fwhm_ratio": (
                    float(rendered_fwhm / target_fwhm)
                    if target_fwhm > 0
                    else None
                ),
                "michelson_contrast": contrast,
            }
        )
    return rows


def wedge_contrast_table(sim, rois) -> list[dict]:
    """Mean bar/paper contrast inside each resolution-wedge window."""
    ppm = sim.cfg.px_per_mm
    gray = sim.composite_rgb.mean(axis=-1)
    rows = []
    for roi in rois:
        if roi.kind != "wedge":
            continue
        sy, sx = roi.pixel_bbox(ppm)
        profile = 1 - gray[sy, sx].mean(axis=0)
        lo, hi = float(profile.min()), float(profile.max())
        contrast = (hi - lo) / (hi + lo) if hi + lo > 0 else 0.0
        rows.append(
            {
                "roi": roi.name,
                "michelson_contrast": float(contrast),
                "modulation_depth": float(hi - lo),
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Mean color error inside named regions
# ---------------------------------------------------------------------------


def color_error_table(sim, target_rgb, rois, kinds=("ramp", "patch")) -> list[dict]:
    """Mean color error per ROI, split into two clearly separated terms.

    * ``reference_*`` compares the *ideal* continuous-tone Neugebauer
      prediction with the input target: ink-gamut / conversion limitation.
    * ``process_*`` compares the halftoned print with that ideal prediction:
      error introduced by screening, dot gain and misregistration.
    * ``total_*`` compares the final print directly with the input target.
    """
    ppm = sim.cfg.px_per_mm
    lab_rendered = rgb_to_lab(sim.composite_rgb)
    lab_target = rgb_to_lab(target_rgb)
    lab_reference = rgb_to_lab(sim.reference_rgb)
    lab_rule = rgb_to_lab(sim.rule_rgb)
    total_de00 = ciede2000(lab_rendered, lab_target)
    total_de76 = deltaE76(lab_rendered, lab_target)
    reference_de00 = ciede2000(lab_reference, lab_target)
    gamut_de00 = ciede2000(lab_rule, lab_target)
    process_de00 = ciede2000(lab_rendered, lab_reference)
    total_rgb_err = np.linalg.norm(sim.composite_rgb - target_rgb, axis=-1)
    process_rgb_err = np.linalg.norm(
        sim.composite_rgb - sim.reference_rgb, axis=-1
    )
    rows = []
    for roi in rois:
        if roi.kind not in kinds:
            continue
        sy, sx = roi.pixel_bbox(ppm)
        # spatially averaged colors: the visual area color of each region,
        # which is how a printed patch is actually judged
        mean_rendered = sim.composite_rgb[sy, sx].mean(axis=(0, 1))
        mean_target = target_rgb[sy, sx].mean(axis=(0, 1))
        mean_reference = sim.reference_rgb[sy, sx].mean(axis=(0, 1))
        avg_de00 = float(
            ciede2000(
                rgb_to_lab(mean_rendered), rgb_to_lab(mean_target)
            )
        )
        avg_process_de00 = float(
            ciede2000(
                rgb_to_lab(mean_rendered), rgb_to_lab(mean_reference)
            )
        )
        avg_rgb_err = float(
            np.linalg.norm(mean_rendered - mean_target)
        )
        rows.append(
            {
                "roi": roi.name,
                "kind": roi.kind,
                "total_mean_dE00": float(total_de00[sy, sx].mean()),
                "total_p95_dE00": float(np.percentile(total_de00[sy, sx], 95)),
                "total_mean_dE76": float(total_de76[sy, sx].mean()),
                "reference_mean_dE00": float(reference_de00[sy, sx].mean()),
                "gamut_rule_mean_dE00": float(gamut_de00[sy, sx].mean()),
                "process_mean_dE00": float(process_de00[sy, sx].mean()),
                "total_rgb_rmse": float(
                    np.sqrt(np.mean(total_rgb_err[sy, sx] ** 2))
                ),
                "process_rgb_rmse": float(
                    np.sqrt(np.mean(process_rgb_err[sy, sx] ** 2))
                ),
                "area_avg_dE00": avg_de00,
                "area_avg_process_dE00": avg_process_de00,
                "area_avg_rgb_error": avg_rgb_err,
                "n_px": int(total_de00[sy, sx].size),
            }
        )
    return rows


def summarize(rows: list[dict], key: str) -> float:
    return float(np.mean([r[key] for r in rows])) if rows else float("nan")


__all__ = [
    "ramp_coverage_table",
    "coverage_rmse",
    "line_detail_table",
    "wedge_contrast_table",
    "color_error_table",
    "summarize",
]
