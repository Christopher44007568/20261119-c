"""Plate export, zoom views and result figures."""

from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

from .simulate import srgb_compand

# print-friendly ink tints used only for visual plate previews
PLATE_TINTS = {
    "C": (0.0, 0.55, 0.85),
    "M": (0.85, 0.1, 0.55),
    "Y": (0.95, 0.8, 0.05),
    "K": (0.08, 0.08, 0.08),
}


def _dpi_tuple(cfg) -> tuple[float, float]:
    return (float(cfg.dpi), float(cfg.dpi))


def export_plates(sim, out_dir) -> list[dict]:
    """Write each separation as a 1-bit TIFF and a grayscale PNG preview."""
    cfg = sim.cfg
    written = []
    for ch in "CMYK":
        plate = sim.plates[ch]
        # PIL mode '1': one bit per pixel, 1 = paper (no ink), 0 = ink
        bit_image = Image.fromarray((1 - plate).astype(np.uint8) * 255).convert(
            "1"
        )
        tif_path = out_dir / f"plate_{ch}.tif"
        bit_image.save(tif_path, dpi=_dpi_tuple(cfg), compression="group4")

        preview = Image.fromarray((1 - plate) * 255)
        png_path = out_dir / f"plate_{ch}_preview.png"
        preview.save(png_path, dpi=_dpi_tuple(cfg))

        spec = cfg.plate(ch)
        written.append(
            {
                "channel": ch,
                "tiff": str(tif_path.name),
                "preview_png": str(png_path.name),
                "mode": "1-bit, 0=ink 1=paper",
                "dpi": cfg.dpi,
                "width_px": plate.shape[1],
                "height_px": plate.shape[0],
                "width_mm": cfg.width_mm,
                "height_mm": cfg.height_mm,
                "screen_angle_deg": spec.angle_deg,
                "screen_frequency_lpi": spec.frequency_lpi,
                "dot_shape": spec.dot_shape,
                "misregister_um": list(spec.misregister_um),
                "ink_area_fraction": float(plate.mean()),
            }
        )
    return written


def export_composite(sim, target_rgb, out_dir) -> dict:
    cfg = sim.cfg
    rendered = (srgb_compand(sim.composite_rgb) * 255).astype(np.uint8)
    target = (srgb_compand(target_rgb) * 255).astype(np.uint8)
    rendered_path = out_dir / "composite_render.png"
    target_path = out_dir / "target_linear_rgb.png"
    Image.fromarray(rendered).save(rendered_path, dpi=_dpi_tuple(cfg))
    Image.fromarray(target).save(target_path, dpi=_dpi_tuple(cfg))
    return {
        "rendered": rendered_path.name,
        "target": target_path.name,
        "encoding": "gamma sRGB preview of linear-RGB data",
    }


def export_zoom_views(sim, target_rgb, out_dir, center_mm=(45.0, 66.0),
                      window_mm=8.0) -> str:
    """Six-panel zoom: four tinted plates, raw composite, target crop."""
    cfg = sim.cfg
    ppm = cfg.px_per_mm
    cx, cy = center_mm
    half = window_mm / 2
    y0 = int((cy - half) * ppm)
    y1 = int((cy + half) * ppm)
    x0 = int((cx - half) * ppm)
    x1 = int((cx + half) * ppm)

    fig, axes = plt.subplots(2, 3, figsize=(11, 7.4))
    for ax, ch in zip(axes.flat, "CMYK"):
        crop = sim.plates[ch][y0:y1, x0:x1]
        tint = np.array(PLATE_TINTS[ch])
        rgb = np.ones(crop.shape + (3,))
        rgb = rgb * (1 - crop[..., None]) + tint * crop[..., None]
        spec = cfg.plate(ch)
        ax.imshow(np.clip(rgb, 0, 1), extent=(0, window_mm, window_mm, 0))
        ax.set_title(
            f"{ch} plate  {spec.angle_deg:g}deg / "
            f"{spec.frequency_lpi:g} lpi / {spec.dot_shape}"
        )
        ax.set_xlabel("mm")
    axes[1, 1].imshow(
        srgb_compand(sim.composite_rgb[y0:y1, x0:x1]),
        extent=(0, window_mm, window_mm, 0),
    )
    axes[1, 1].set_title("composite print (zoomed)")
    axes[1, 1].set_xlabel("mm")
    axes[1, 2].imshow(
        srgb_compand(target_rgb[y0:y1, x0:x1]),
        extent=(0, window_mm, window_mm, 0),
    )
    axes[1, 2].set_title("original target (zoomed)")
    axes[1, 2].set_xlabel("mm")
    fig.suptitle(
        f"Halftone separations, {cfg.dpi:g} dpi, "
        f"{window_mm:g} mm window centered at ({cx:g}, {cy:g}) mm"
    )
    fig.tight_layout()
    path = out_dir / "zoom_views.png"
    fig.savefig(path, dpi=180)
    plt.close(fig)
    return path.name


def export_metrics_figure(metrics_bundle: dict, out_dir) -> str:
    """Coverage, line-detail and color-error charts for one run."""
    fig, axes = plt.subplots(1, 3, figsize=(14, 4.2))

    ramp = metrics_bundle["ramp_coverage"]
    levels = [r["requested_gray"] for r in ramp]
    for ch, marker in zip("CMYK", "os^d"):
        axes[0].plot(
            levels, [r[f"{ch}_measured"] for r in ramp],
            marker=marker, label=ch,
        )
        axes[0].plot(
            levels, [r[f"{ch}_requested"] for r in ramp],
            linestyle=":", color="gray",
        )
    axes[0].set_title("ramp: measured vs requested coverage")
    axes[0].set_xlabel("requested neutral level")
    axes[0].set_ylabel("plate ink area fraction")
    axes[0].legend()

    lines = metrics_bundle["line_detail"]
    widths = [r["nominal_width_mm"] for r in lines]
    axes[1].plot(widths, [r["rendered_fwhm_mm"] for r in lines], "o",
                 label="rendered FWHM")
    axes[1].plot(widths, widths, ":", color="gray", label="nominal")
    axes[1].set_xlabel("nominal line width (mm)")
    axes[1].set_ylabel("rendered FWHM (mm)")
    axes[1].set_title("fine-line reproduction")
    axes[1].legend()

    color_rows = metrics_bundle["color_error"]
    axes[2].bar(
        range(len(color_rows)),
        [r["area_avg_dE00"] for r in color_rows],
        label="total",
    )
    axes[2].plot(
        range(len(color_rows)),
        [r["area_avg_process_dE00"] for r in color_rows],
        "ro", label="process only",
    )
    axes[2].set_xticks(range(len(color_rows)))
    axes[2].set_xticklabels([r["roi"] for r in color_rows],
                            rotation=70, fontsize=6)
    axes[2].set_ylabel("ROI-averaged CIEDE2000")
    axes[2].set_title("area color error per ROI")
    axes[2].legend(fontsize=7)

    fig.tight_layout()
    path = out_dir / "metrics.png"
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path.name


def write_json(payload: dict, path) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False, default=float)


__all__ = [
    "PLATE_TINTS",
    "export_plates",
    "export_composite",
    "export_zoom_views",
    "export_metrics_figure",
    "write_json",
]
