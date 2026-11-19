#!/usr/bin/env python3
"""Run the reproducible CMYK halftone color-separation experiment.

Examples
--------
python3 run_experiment.py                       # 300 and 600 dpi runs
python3 run_experiment.py --dpi 150 300 600
python3 run_experiment.py --output-dir results/run1

Outputs per resolution go under <output-dir>/run_<dpi>dpi/ and contain the
four 1-bit TIFF plates (DPI + physical size tagged), previews, the
composite print, zoom views, metrics figures and JSON/CSV measurements.
A top-level comparison report summarises resolution independence of the
physical screen ruling.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

# allow execution from a fresh checkout where deps live in ~/.local
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np

from halftone.config import ExperimentConfig, rosette_summary
from halftone.export import (
    export_composite,
    export_metrics_figure,
    export_plates,
    export_zoom_views,
    write_json,
)
from halftone.metrics import (
    color_error_table,
    coverage_rmse,
    line_detail_table,
    ramp_coverage_table,
    summarize,
    wedge_contrast_table,
)
from halftone.simulate import separate_and_render
from halftone.target import build_target


def _write_csv(rows: list[dict], path: Path) -> None:
    if not rows:
        return
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def run_once(cfg: ExperimentConfig, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    target_rgb, rois = build_target(cfg)
    sim = separate_and_render(cfg, target_rgb)

    plate_info = export_plates(sim, out_dir)
    composite_info = export_composite(sim, target_rgb, out_dir)
    # center on the middle of the continuous gray gradient band
    zoom_name = export_zoom_views(
        sim, target_rgb, out_dir, center_mm=(45.0, 29.0), window_mm=6.0
    )

    ramp_rows = ramp_coverage_table(sim, rois)
    line_rows = line_detail_table(sim, target_rgb, rois)
    wedge_rows = wedge_contrast_table(sim, rois)
    color_rows = color_error_table(sim, target_rgb, rois)
    metrics = {
        "ramp_coverage": ramp_rows,
        "line_detail": line_rows,
        "wedge_contrast": wedge_rows,
        "color_error": color_rows,
    }
    metrics_fig = export_metrics_figure(metrics, out_dir)
    _write_csv(ramp_rows, out_dir / "ramp_coverage.csv")
    _write_csv(line_rows, out_dir / "line_detail.csv")
    _write_csv(wedge_rows, out_dir / "wedge_contrast.csv")
    _write_csv(color_rows, out_dir / "color_error.csv")

    summary = {
        "dpi": cfg.dpi,
        "shape_px": list(cfg.shape),
        "physical_size_mm": [cfg.width_mm, cfg.height_mm],
        "screens": rosette_summary(cfg),
        "coverage_rmse_percent_points": coverage_rmse(ramp_rows),
        "mean_dE00_all_rois": summarize(color_rows, "total_mean_dE00"),
        "mean_dE76_all_rois": summarize(color_rows, "total_mean_dE76"),
        "reference_dE00_all_rois": summarize(
            color_rows, "reference_mean_dE00"
        ),
        "process_dE00_all_rois": summarize(color_rows, "process_mean_dE00"),
        "mean_rgb_rmse": summarize(color_rows, "total_rgb_rmse"),
        "process_rgb_rmse": summarize(color_rows, "process_rgb_rmse"),
        "area_avg_dE00": summarize(color_rows, "area_avg_dE00"),
        "area_avg_process_dE00": summarize(
            color_rows, "area_avg_process_dE00"
        ),
        "area_avg_rgb_error": summarize(color_rows, "area_avg_rgb_error"),
        "mean_line_fwhm_ratio": summarize(
            [r for r in line_rows if r["fwhm_ratio"] is not None],
            "fwhm_ratio",
        ),
        "wedge_contrast": {r["roi"]: r["michelson_contrast"] for r in wedge_rows},
        "files": {
            "plates": plate_info,
            "composite": composite_info,
            "zoom_views": zoom_name,
            "metrics_figure": metrics_fig,
        },
    }
    write_json(
        {"config": cfg.to_dict(), "summary": summary, "metrics": metrics},
        out_dir / "report.json",
    )
    return summary


def build_comparison(summaries: list[dict], out_dir: Path) -> None:
    rows = []
    for summary in summaries:
        rows.append(
            {
                "dpi": summary["dpi"],
                "shape_px": "x".join(str(v) for v in summary["shape_px"]),
                "coverage_RMSE_C": summary[
                    "coverage_rmse_percent_points"
                ]["C"],
                "area_avg_dE00": summary["area_avg_dE00"],
                "area_avg_process_dE00": summary["area_avg_process_dE00"],
                "reference_gamut_dE00": summary["reference_dE00_all_rois"],
                "area_avg_rgb_error": summary["area_avg_rgb_error"],
                "pixelwise_mean_dE00": summary["mean_dE00_all_rois"],
                "mean_line_fwhm_ratio": summary["mean_line_fwhm_ratio"],
            }
        )
    _write_csv(rows, out_dir / "resolution_comparison.csv")
    write_json({"runs": summaries}, out_dir / "resolution_comparison.json")


def write_markdown(cfg: ExperimentConfig, summaries: list[dict],
                   out_dir: Path) -> None:
    lines = [
        "# 半色调印刷分色实验报告",
        "",
        "## 实验规则与固定参数",
        "",
        f"- 输入：线性 sRGB（BT.709, D65），物理尺寸 "
        f"{cfg.width_mm:g} x {cfg.height_mm:g} mm，随机种子 {cfg.seed}",
        "- RGB->CMYK 规则：`C0=1-R, M0=1-G, Y0=1-B`；"
        f"中性分量 `n=min(C0,M0,Y0)`；`K={cfg.ucr_strength:g}*n`，"
        "C/M/Y 减去 K（UCR 黑版生成）",
        f"- 网屏设置：{rosette_summary(cfg)}",
        f"- 网点扩大（TVI）：50% 中间调增加 "
        f"{cfg.dot_gain_midtone_pp:g} 个百分点（覆盖率域，与 DPI 无关）；"
        f"光学扩散 sigma={cfg.optical_spread_sigma_um:g} um；"
        f"套印偏移（um）："
        + ", ".join(
            f"{p.channel}={p.misregister_um}" for p in cfg.plates
        ),
        "- 印刷模型：Beer-Lambert 密度叠加 + Demichel-Neugebauer 16 基色混合",
        "- 色差：CIEDE2000（同时报告 ΔE76 与线性 RGB RMSE）",
        "",
        "## 不同输出分辨率结果（物理网频保持不变）",
        "",
        "色差以 ROI 空间平均颜色计算（像素级波动保留在 `color_error.csv`）。",
        "",
        "| DPI | 像素尺寸 | 覆盖率 RMSE (C, 百分点) | 区域平均总ΔE00 | 区域平均工艺ΔE00 | 色域限制ΔE00 | 区域平均RGB误差 | 线宽 FWHM 比值 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for s in summaries:
        rmse = s["coverage_rmse_percent_points"]
        lines.append(
            f"| {s['dpi']:g} | {s['shape_px'][1]}x{s['shape_px'][0]} | "
            f"{rmse['C']:.3f} | {s['area_avg_dE00']:.2f} | "
            f"{s['area_avg_process_dE00']:.2f} | "
            f"{s['reference_dE00_all_rois']:.2f} | "
            f"{s['area_avg_rgb_error']:.4f} | "
            f"{s['mean_line_fwhm_ratio']:.3f} |"
        )
    lines += [
        "",
        "## 输出文件",
        "",
        "每个 `run_<dpi>dpi/` 目录包含：",
        "",
        "- `plate_C/M/Y/K.tif`：1-bit Group4 TIFF 色版，带 DPI 与物理尺寸",
        "- `plate_*_preview.png`、`composite_render.png`、`zoom_views.png`",
        "- `ramp_coverage.csv`、`line_detail.csv`、`wedge_contrast.csv`、"
        "`color_error.csv`、`report.json`",
        "",
        "重跑命令：`python3 run_experiment.py`（固定种子，结果可逐字节复现）。",
    ]
    (out_dir / "REPORT.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dpi", nargs="+", type=float, default=[300, 600])
    parser.add_argument("--output-dir", default="artifacts/results")
    parser.add_argument("--seed", type=int, default=ExperimentConfig.seed)
    args = parser.parse_args(argv)

    base = ExperimentConfig(seed=args.seed)
    out_root = Path(args.output_dir)
    out_root.mkdir(parents=True, exist_ok=True)

    summaries = []
    for dpi in args.dpi:
        cfg = base.with_dpi(dpi)
        run_dir = out_root / f"run_{int(dpi)}dpi"
        print(f"[run] {dpi:g} dpi -> {run_dir}")
        summaries.append(run_once(cfg, run_dir))

    build_comparison(summaries, out_root)
    write_markdown(base, summaries, out_root)
    print(f"[done] report: {out_root / 'REPORT.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
