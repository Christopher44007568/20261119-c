#!/usr/bin/env python3
"""Compare tone-mapping curves on a genuinely floating-point HDR ramp."""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
import struct
import unittest
import zlib
from dataclasses import dataclass


WIDTH = 512
HEIGHT = 192
EXPOSURE = 1.0
INPUT_PEAK = 8.0
MIDDLE_GRAY = 0.18


def clamp01(value: float) -> float:
    return 0.0 if value < 0.0 else 1.0 if value > 1.0 else value


def linear_curve(value: float) -> float:
    x = max(0.0, EXPOSURE * value)
    return clamp01(x)


def reinhard_curve(value: float) -> float:
    x = max(0.0, EXPOSURE * value)
    return x / (1.0 + x)


def aces_approx_curve(value: float) -> float:
    x = max(0.0, EXPOSURE * value)
    numerator = 0.940_097_4 * x * x + 2.539_692_4 * x
    denominator = 0.846_729_6 * x * x + 2.365_537_4 * x + 1.0
    return clamp01(numerator / denominator)


def custom_curve(value: float) -> float:
    x = max(0.0, EXPOSURE * value)
    if x <= 0.75:
        return x
    return 1.0 - 0.3125 / (x + 0.5)


CURVES = {
    "linear": linear_curve,
    "reinhard": reinhard_curve,
    "aces_approx": aces_approx_curve,
    "custom": custom_curve,
}


FORMULAS = {
    "linear": "y=clamp(Ex,0,1), E=1; x≥1 硬截断",
    "reinhard": "y=Ex/(1+Ex), E=1; 全局软肩，渐近 1",
    "aces_approx": "y=clamp((0.9401(Ex)^2+2.5397Ex)/(0.8467(Ex)^2+2.3655Ex+1),0,1)",
    "custom": "x≤0.75: y=x; x>0.75: y=1-0.3125/(Ex+0.5), E=1; 灰阶直通、肩部压缩",
}


@dataclass(frozen=True)
class Image:
    width: int
    height: int
    pixels: list[list[float]]

    def max_value(self) -> float:
        return max(channel for pixel in self.pixels for channel in pixel)

    def channel_maxima(self) -> list[float]:
        return [max(pixel[channel] for pixel in self.pixels) for channel in range(3)]


def make_hdr_image() -> Image:
    pixels: list[list[float]] = []
    for row in range(HEIGHT):
        for column in range(WIDTH):
            u = column / (WIDTH - 1)
            ramp = u * INPUT_PEAK
            if row < 48:
                pixel = [ramp, ramp, ramp]
            elif row < 96:
                block = column // 64
                pixel = [ramp if block == 0 else 0.0, ramp if block == 1 else 0.0, ramp if block == 2 else 0.0]
                if block == 3:
                    pixel = [ramp, ramp * 0.35, ramp * 0.12]
                if block == 4:
                    pixel = [ramp * 0.12, ramp * 0.55, ramp]
                if block == 5:
                    pixel = [ramp * 0.18, ramp, ramp * 0.72]
                if block == 6:
                    pixel = [ramp, ramp * 0.82, ramp * 0.38]
                if block == 7:
                    pixel = [ramp * 0.62, ramp * 0.22, ramp]
            elif row < 144:
                block = column // 64
                neutral = [0.18, 0.5, 1.0, 2.0, 4.0, 8.0, 0.03, 0.9]
                level = neutral[block]
                pixel = [level, level, level]
            else:
                bands = [
                    [4.0, 0.35, 0.12],
                    [0.15, 4.0, 0.25],
                    [0.2, 0.45, 4.0],
                    [4.0, 2.8, 0.35],
                    [2.2, 0.35, 4.0],
                    [0.45, 3.6, 3.2],
                    [4.0, 4.0, 4.0],
                    [6.0, 1.0, 0.25],
                ]
                pixel = bands[column // 64]
            pixels.append([max(0.0, channel) for channel in pixel])
    return Image(WIDTH, HEIGHT, pixels)


def assert_is_genuine_hdr(image: Image) -> None:
    if image.max_value() <= 1.0:
        raise ValueError("HDR input must contain floating-point values above 1")
    if len(image.pixels) != image.width * image.height:
        raise ValueError("Invalid image pixel count")


def pixels_almost_equal(left: list[list[float]], right: list[list[float]], tolerance: float = 2e-7) -> bool:
    if len(left) != len(right):
        return False
    for left_pixel, right_pixel in zip(left, right):
        if any(abs(a - b) > tolerance * max(1.0, abs(a), abs(b)) for a, b in zip(left_pixel, right_pixel)):
            return False
    return True


def tone_map(image: Image, curve) -> Image:
    return Image(
        image.width,
        image.height,
        [[clamp01(curve(channel)) for channel in pixel] for pixel in image.pixels],
    )


def srgb_encode(channel: float) -> int:
    if channel <= 0.0031308:
        encoded = 12.92 * channel
    else:
        encoded = 1.055 * channel ** (1.0 / 2.4) - 0.055
    return max(0, min(255, round(encoded * 255.0)))


def write_pfm(path: str, image: Image) -> None:
    data = bytearray(f"PF\n{image.width} {image.height}\n-1.0\n".encode("ascii"))
    for pixel in image.pixels:
        data.extend(struct.pack("fff", *pixel))
    with open(path, "wb") as handle:
        handle.write(data)


def read_pfm(path: str) -> Image:
    with open(path, "rb") as handle:
        magic = handle.readline().strip()
        if magic != b"PF":
            raise ValueError("Only RGB little-endian PFM is supported")
        width, height = map(int, handle.readline().split())
        scale = float(handle.readline().strip())
        if scale > 0:
            raise ValueError("Expected little-endian PFM")
        raw = handle.read(width * height * 12)
    flat = struct.unpack(f"<{width * height * 3}f", raw)
    pixels = [list(flat[index:index + 3]) for index in range(0, len(flat), 3)]
    return Image(width, height, pixels)


def write_png(path: str, image: Image) -> None:
    with open(path, "wb") as handle:
        handle.write(png_bytes(image))


def png_bytes(image: Image) -> bytes:
    rows = bytearray()
    for row in range(image.height):
        rows.append(0)
        start = row * image.width
        for pixel in image.pixels[start:start + image.width]:
            rows.extend(srgb_encode(channel) for channel in pixel)

    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", image.width, image.height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(rows), level=9))
    png += chunk(b"IEND", b"")
    return png


def embedded_png(image: Image, x: float, y: float, width: float, height: float) -> str:
    encoded = base64.b64encode(png_bytes(image)).decode("ascii")
    return (
        f'<image x="{x}" y="{y}" width="{width}" height="{height}" '
        f'preserveAspectRatio="none" href="data:image/png;base64,{encoded}"/>'
    )


def luminance(pixel: list[float]) -> float:
    return 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]


def chroma(pixel: list[float]) -> float:
    return max(pixel) - min(pixel)


def hue_angle(pixel: list[float]) -> float | None:
    red, green, blue = pixel
    if chroma(pixel) < 1e-9:
        return None
    if red >= green and red >= blue:
        angle = (green - blue) / chroma(pixel)
    elif green >= red and green >= blue:
        angle = 2.0 + (blue - red) / chroma(pixel)
    else:
        angle = 4.0 + (red - green) / chroma(pixel)
    return angle * 60.0 % 360.0


def hue_delta(source: list[float], output: list[float]) -> float | None:
    source_hue = hue_angle(source)
    output_hue = hue_angle(output)
    if source_hue is None or output_hue is None:
        return None
    return (output_hue - source_hue + 180.0) % 360.0 - 180.0


def histogram(values: list[float], bins: int, log_scale: bool) -> dict:
    positive = [value for value in values if value > 0.0]
    minimum = min(positive)
    maximum = max(values)
    counts = [0 for _ in range(bins)]
    for value in values:
        if value <= 0.0:
            counts[0] += 1
            continue
        if log_scale:
            position = math.log(value / minimum) / math.log(maximum / minimum)
        else:
            position = value / maximum
        index = min(bins - 1, max(0, int(position * bins)))
        counts[index] += 1
    return {
        "bins": bins,
        "counts": counts,
        "minimum": min(values),
        "maximum": maximum,
        "log_scale": log_scale,
    }


NEUTRAL_LEVELS = [0.03, 0.18, 0.5, 0.9, 1.0, 2.0, 4.0, 8.0]
COLOR_SAMPLES = [
    ("hot_red", [4.0, 0.35, 0.12]),
    ("hot_green", [0.15, 4.0, 0.25]),
    ("hot_blue", [0.2, 0.45, 4.0]),
    ("yellow", [4.0, 2.8, 0.35]),
    ("violet", [2.2, 0.35, 4.0]),
    ("cyan", [0.45, 3.6, 3.2]),
    ("orange_peak", [6.0, 1.0, 0.25]),
    ("white_peak", [4.0, 4.0, 4.0]),
]

REPORT_COLOR_SAMPLE_NAMES = {"hot_red", "hot_blue", "yellow", "cyan", "orange_peak", "white_peak"}


def curve_metrics(source: Image, output: Image) -> dict:
    ramp_luminance = [
        luminance(output.pixels[column])
        for column in range(output.width)
        if chroma(source.pixels[column]) < 1e-9
    ]
    monotonic = all(current >= previous for previous, current in zip(ramp_luminance, ramp_luminance[1:]))
    neutral = []
    for level in NEUTRAL_LEVELS:
        index = next(
            item for item, pixel in enumerate(source.pixels)
            if abs(pixel[0] - level) < 1e-9 and chroma(pixel) < 1e-9
        )
        source_pixel = source.pixels[index]
        output_pixel = output.pixels[index]
        neutral.append({
            "input": level,
            "input_luminance": luminance(source_pixel),
            "output_rgb": [round(channel, 6) for channel in output_pixel],
            "output_luminance": round(luminance(output_pixel), 6),
            "output_chroma": round(chroma(output_pixel), 8),
            "neutral_gray_kept": chroma(output_pixel) < 1e-9,
        })

    colors = []
    for name, source_pixel in COLOR_SAMPLES:
        index = source.pixels.index(source_pixel)
        output_pixel = output.pixels[index]
        delta = hue_delta(source_pixel, output_pixel)
        colors.append({
            "name": name,
            "input_rgb": source_pixel,
            "output_rgb": [round(channel, 6) for channel in output_pixel],
            "hue_delta_deg": None if delta is None else round(delta, 3),
            "output_chroma": round(chroma(output_pixel), 6),
            "output_luminance": round(luminance(output_pixel), 6),
        })

    clipped_channels = sum(1 for pixel in output.pixels for channel in pixel if channel == 1.0)
    clipped_pixels = sum(1 for pixel in output.pixels if any(channel == 1.0 for channel in pixel))
    near_white_channels = sum(1 for pixel in output.pixels for channel in pixel if channel >= 0.999)
    near_white_pixels = sum(1 for pixel in output.pixels if any(channel >= 0.999 for channel in pixel))
    hard_clip_source_channels = sum(1 for pixel in source.pixels for channel in pixel if EXPOSURE * channel >= 1.0)
    hard_clip_source_pixels = sum(1 for pixel in source.pixels if any(EXPOSURE * channel >= 1.0 for channel in pixel))
    hue_deltas = [item["hue_delta_deg"] for item in colors if item["hue_delta_deg"] is not None]
    chroma_values = [item["output_chroma"] for item in colors if chroma(item["input_rgb"]) > 0.0]
    return {
        "output_peak": round(output.max_value(), 6),
        "channel_maxima": [round(value, 6) for value in output.channel_maxima()],
        "clipped_channel_fraction": round(clipped_channels / (output.width * output.height * 3), 6),
        "clipped_pixel_fraction": round(clipped_pixels / (output.width * output.height), 6),
        "hard_clip_source_channel_fraction": round(hard_clip_source_channels / (output.width * output.height * 3), 6),
        "hard_clip_source_pixel_fraction": round(hard_clip_source_pixels / (output.width * output.height), 6),
        "near_white_channel_fraction": round(near_white_channels / (output.width * output.height * 3), 6),
        "near_white_pixel_fraction": round(near_white_pixels / (output.width * output.height), 6),
        "neutral_gray": neutral,
        "saturated_colors": colors,
        "max_abs_hue_delta_deg": round(max(abs(value) for value in hue_deltas), 3),
        "mean_abs_hue_delta_deg": round(sum(abs(value) for value in hue_deltas) / len(hue_deltas), 3),
        "mean_color_sample_chroma": round(sum(chroma_values) / len(chroma_values), 6),
        "luminance_histogram": histogram([luminance(pixel) for pixel in output.pixels], 24, False),
        "monotonic_on_0_8": monotonic,
    }


def svg_color(pixel: list[float]) -> str:
    return "#" + "".join(f"{srgb_encode(channel):02x}" for channel in pixel)


def svg_text(value) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def histogram_bars(counts: list[int], x: float, y: float, width: float, height: float, fill: str) -> str:
    peak_count = max(counts)
    bar_width = width / len(counts)
    parts = [f'<rect x="{x}" y="{y}" width="{width}" height="{height}" fill="#111827" rx="6"/>']
    for index, count in enumerate(counts):
        bar_height = 0 if peak_count == 0 else height * count / peak_count
        parts.append(
            f'<rect x="{x + index * bar_width:.2f}" y="{y + height - bar_height:.2f}" '
            f'width="{bar_width * 0.86:.2f}" height="{bar_height:.2f}" fill="{fill}"/>'
        )
    return "".join(parts)


def write_svg_report(path: str, source: Image, results: dict, metrics: dict) -> None:
    width = 1400
    height = 1720
    colors = {
        "linear": "#f97316",
        "reinhard": "#22c55e",
        "aces_approx": "#38bdf8",
        "custom": "#c084fc",
    }
    labels = {
        "linear": "线性",
        "reinhard": "Reinhard",
        "aces_approx": "ACES 近似",
        "custom": "自定义",
    }
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#f8fafc"/>',
        '<style>text{font-family:Arial,"Noto Sans CJK SC",sans-serif;fill:#0f172a}.small{font-size:13px}.label{font-size:16px;font-weight:700}.title{font-size:30px;font-weight:800}.mono{font-family:monospace;font-size:12px}.card{fill:white;stroke:#cbd5e1;stroke-width:1}.grid{stroke:#e2e8f0;stroke-width:1}.axis{stroke:#475569;stroke-width:1.4}</style>',
        '<text x="40" y="48" class="title">同一浮点 HDR 输入上的四种色调映射</text>',
        f'<text x="40" y="76" class="small">共享输入：RGB32 PFM，{source.width}×{source.height}，输入峰值 {source.max_value():.3f}；E={EXPOSURE}，曝光点 x=1.0，18% 中性灰 x=0.18。</text>',
    ]

    parts.append('<rect x="40" y="98" width="1320" height="250" class="card" rx="12"/>')
    parts.append('<text x="60" y="128" class="label">共享 HDR 输入（含超 1 浮点坡度；不是从 8-bit LDR 回填）</text>')
    parts.append(embedded_png(source, 60, 145, 820, source.height * 0.75))
    parts.append(f'<text x="910" y="155" class="small">输入峰值：{source.max_value():.3f}</text>')
    parts.append(f'<text x="910" y="178" class="small">通道峰值 R/G/B：{source.channel_maxima()[0]:.3f} / {source.channel_maxima()[1]:.3f} / {source.channel_maxima()[2]:.3f}</text>')
    parts.append(f'<text x="910" y="201" class="small">超 1 像素 {metrics["hdr_input"]["above_one_pixel_fraction"] * 100:.2f}%；通道 {metrics["hdr_input"]["above_one_channel_fraction"] * 100:.2f}%</text>')
    parts.append('<text x="910" y="222" class="small">场景行：中性坡度、彩色/单通道坡度、中性灰、高饱和 HDR 色块</text>')
    parts.append(histogram_bars(metrics["hdr_input"]["luminance_histogram"]["counts"], 910, 238, 410, 74, "#64748b"))
    parts.append('<text x="910" y="333" class="small">输入亮度直方图：对数分箱，展示 0–8 的高亮余量</text>')

    plot_x, plot_y, plot_w, plot_h = 60, 390, 520, 300
    parts.append('<rect x="40" y="370" width="620" height="360" class="card" rx="12"/>')
    parts.append('<text x="60" y="400" class="label">曲线与曝光位置</text>')
    for index in range(6):
        gy = plot_y + plot_h - index * plot_h / 5
        parts.append(f'<line x1="{plot_x}" y1="{gy:.1f}" x2="{plot_x + plot_w}" y2="{gy:.1f}" class="grid"/>')
    parts.append(f'<line x1="{plot_x}" y1="{plot_y}" x2="{plot_x}" y2="{plot_y + plot_h}" class="axis"/>')
    parts.append(f'<line x1="{plot_x}" y1="{plot_y + plot_h}" x2="{plot_x + plot_w}" y2="{plot_y + plot_h}" class="axis"/>')
    for x_value in (0.18, 1.0, 4.0, 8.0):
        marker_x = plot_x + plot_w * x_value / INPUT_PEAK
        parts.append(f'<line x1="{marker_x:.1f}" y1="{plot_y}" x2="{marker_x:.1f}" y2="{plot_y + plot_h}" stroke="#94a3b8" stroke-dasharray="4 4"/>')
        parts.append(f'<text x="{marker_x - 18:.1f}" y="{plot_y + plot_h + 20}" class="small">{x_value:g}</text>')
    for name, curve in CURVES.items():
        points = []
        for index in range(401):
            x_value = index * INPUT_PEAK / 400
            y_value = curve(x_value)
            points.append(f"{plot_x + plot_w * x_value / INPUT_PEAK:.2f},{plot_y + plot_h * (1 - y_value):.2f}")
        parts.append(f'<polyline fill="none" stroke="{colors[name]}" stroke-width="3" points="{" ".join(points)}"/>')
    for index, name in enumerate(CURVES):
        parts.append(f'<line x1="620" y1="{405 + index * 24}" x2="650" y2="{405 + index * 24}" stroke="{colors[name]}" stroke-width="4"/>')
        parts.append(f'<text x="658" y="{410 + index * 24}" class="small">{svg_text(labels[name])}</text>')
    parts.append(f'<text x="60" y="714" class="small">虚线：18% 灰、曝光点 x=1、x=4、输入峰值 x=8</text>')

    for index, (name, result) in enumerate(results.items()):
        x = 700 + (index % 2) * 340
        y = 370 + (index // 2) * 360
        parts.append(f'<rect x="{x}" y="{y}" width="320" height="340" class="card" rx="12"/>')
        parts.append(f'<text x="{x + 16}" y="{y + 28}" class="label" fill="{colors[name]}">{svg_text(labels[name])}</text>')
        output = tone_map(source, CURVES[name])
        parts.append(embedded_png(output, x + 16, y + 48, 288, 108))
        metric = result["metrics"]
        lines = [
            f'输出峰值 {metric["output_peak"]:.4f}',
            f'线性截断域像素 {metric["hard_clip_source_pixel_fraction"] * 100:.2f}% / 通道 {metric["hard_clip_source_channel_fraction"] * 100:.2f}%',
            f'输出等于1像素 {metric["clipped_pixel_fraction"] * 100:.2f}%；近白 {metric["near_white_pixel_fraction"] * 100:.2f}%',
            f'单调：{"是" if metric["monotonic_on_0_8"] else "否"}；中性灰：{"保持" if all(item["neutral_gray_kept"] for item in metric["neutral_gray"]) else "偏移"}',
            f'平均 |Δhue| {metric["mean_abs_hue_delta_deg"]:.2f}°；最大 {metric["max_abs_hue_delta_deg"]:.2f}°',
            f'平均样本色度 {metric["mean_color_sample_chroma"]:.3f}',
        ]
        for line_index, line in enumerate(lines):
            parts.append(f'<text x="{x + 16}" y="{y + 176 + line_index * 20}" class="small">{svg_text(line)}</text>')
        parts.append(histogram_bars(metric["luminance_histogram"]["counts"], x + 16, y + 270, 288, 50, colors[name]))

    parts.append('<rect x="40" y="760" width="1320" height="250" class="card" rx="12"/>')
    parts.append('<text x="60" y="790" class="label">公式、曝光位置与评估</text>')
    headers = ["曲线", "公式", "曝光点 y(x=1)", "x=8 输出", "中性灰 / 单调性 / 饱和颜色"]
    column_x = [60, 170, 650, 780, 900]
    for index, header in enumerate(headers):
        parts.append(f'<text x="{column_x[index]}" y="825" class="small" font-weight="700">{svg_text(header)}</text>')
    for row_index, name in enumerate(CURVES):
        row_y = 855 + row_index * 38
        metric = results[name]["metrics"]
        values = [
            labels[name],
            results[name]["formula"],
            f"{CURVES[name](1.0):.4f}",
            f"{CURVES[name](8.0):.4f}",
            f'灰保持 {"是" if all(item["neutral_gray_kept"] for item in metric["neutral_gray"]) else "否"}；单调 是；平均色相 {metric["mean_abs_hue_delta_deg"]:.2f}°',
        ]
        for column_index, value in enumerate(values):
            parts.append(f'<text x="{column_x[column_index]}" y="{row_y}" class="{"mono" if column_index == 1 else "small"}">{svg_text(value)}</text>')

    lower_y = 1040
    parts.append(f'<rect x="40" y="{lower_y}" width="1320" height="620" class="card" rx="12"/>')
    parts.append(f'<text x="60" y="{lower_y + 30}" class="label">样本数值：中性灰与饱和 HDR 颜色</text>')
    sample_headers = ["曲线", "样本", "输入 RGB", "输出 RGB", "Δhue", "输出亮度", "色度"]
    sample_x = [60, 210, 340, 560, 790, 910, 1050]
    for index, header in enumerate(sample_headers):
        parts.append(f'<text x="{sample_x[index]}" y="{lower_y + 62}" class="small" font-weight="700">{header}</text>')
    row_y = lower_y + 88
    for name in CURVES:
        report_colors = [
            color for color in results[name]["metrics"]["saturated_colors"]
            if color["name"] in REPORT_COLOR_SAMPLE_NAMES
        ]
        for color_index, color in enumerate(report_colors):
            values = [
                labels[name] if color_index == 0 else "",
                color["name"],
                str(color["input_rgb"]),
                str(color["output_rgb"]),
                "—" if color["hue_delta_deg"] is None else f'{color["hue_delta_deg"]:.2f}°',
                f'{color["output_luminance"]:.4f}',
                f'{color["output_chroma"]:.4f}',
            ]
            for column_index, value in enumerate(values):
                parts.append(f'<text x="{sample_x[column_index]}" y="{row_y}" class="mono">{svg_text(value)}</text>')
            row_y += 17
        row_y += 5

    parts.append("</svg>")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(parts))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default="artifacts/tonemap")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        _run_self_test()
        return
    run_comparison(args.output_dir)


def _run_self_test() -> None:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ToneMappingTests)
    unittest.TextTestRunner(verbosity=2).run(suite)


def run_comparison(output_dir: str) -> None:
    os.makedirs(output_dir, exist_ok=True)
    source = make_hdr_image()
    assert_is_genuine_hdr(source)
    source_path = os.path.join(output_dir, "shared_hdr_input.pfm")
    write_pfm(source_path, source)
    reloaded = read_pfm(source_path)
    if not pixels_almost_equal(reloaded.pixels, source.pixels):
        raise AssertionError("PFM round trip changed the shared HDR input")

    results = {}
    for name, curve in CURVES.items():
        output = tone_map(source, curve)
        write_png(os.path.join(output_dir, f"{name}_srgb.png"), output)
        results[name] = {
            "formula": FORMULAS[name],
            "exposure_multiplier": EXPOSURE,
            "exposure_point_input": 1.0 / EXPOSURE,
            "metrics": curve_metrics(source, output),
        }

    metrics = {
        "hdr_input": {
            "path": source_path,
            "format": "binary RGB32 little-endian PFM",
            "width": source.width,
            "height": source.height,
            "input_peak": source.max_value(),
            "channel_maxima": source.channel_maxima(),
            "contains_values_above_one": source.max_value() > 1.0,
            "above_one_pixel_fraction": round(
                sum(1 for pixel in source.pixels if any(channel > 1.0 for channel in pixel)) / len(source.pixels), 6
            ),
            "above_one_channel_fraction": round(
                sum(1 for pixel in source.pixels for channel in pixel if channel > 1.0) / (len(source.pixels) * 3), 6
            ),
            "is_not_repackaged_ldr": source.max_value() > 1.0 and min(channel for pixel in source.pixels for channel in pixel) >= 0.0,
            "luminance_histogram": histogram([luminance(pixel) for pixel in source.pixels], 28, True),
        },
        "curves": results,
        "evaluation_points": {
            "middle_gray": MIDDLE_GRAY,
            "exposure_point": 1.0,
            "input_peak": INPUT_PEAK,
        },
    }
    metrics_path = os.path.join(output_dir, "metrics.json")
    with open(metrics_path, "w", encoding="utf-8") as handle:
        json.dump(metrics, handle, ensure_ascii=False, indent=2)
    write_svg_report(os.path.join(output_dir, "tonemap_report.svg"), source, results, metrics)


class ToneMappingTests(unittest.TestCase):
    def test_curves_are_non_negative_and_bounded(self) -> None:
        for index in range(8_001):
            x = index * 0.001
            for name, curve in CURVES.items():
                with self.subTest(name=name, x=x):
                    y = curve(x)
                    self.assertGreaterEqual(y, 0.0)
                    self.assertLessEqual(y, 1.0)

    def test_curves_are_monotonic(self) -> None:
        for name, curve in CURVES.items():
            previous = -1.0
            for index in range(1, 8_001):
                x = index * 0.001
                current = curve(x)
                with self.subTest(name=name, x=x):
                    self.assertGreaterEqual(current, previous)
                    previous = current

    def test_custom_is_identity_below_shoulder_start(self) -> None:
        for x in (0.0, 0.18, 0.5, 0.75):
            self.assertEqual(custom_curve(x), x)

    def test_custom_shoulder_is_continuous(self) -> None:
        self.assertAlmostEqual(custom_curve(0.75), 0.75)
        self.assertAlmostEqual(custom_curve(0.750_001), 0.750_000_199_999_84, places=10)

    def test_shared_hdr_contains_super_one_float_ramp(self) -> None:
        image = make_hdr_image()
        assert_is_genuine_hdr(image)
        self.assertEqual(image.max_value(), INPUT_PEAK)
        self.assertGreater(sum(1 for pixel in image.pixels for value in pixel if value > 1.0), 0)

    def test_pfm_round_trip_preserves_float_ramp(self) -> None:
        image = make_hdr_image()
        write_pfm("/tmp/tonemap-test.pfm", image)
        reloaded = read_pfm("/tmp/tonemap-test.pfm")
        self.assertEqual((reloaded.width, reloaded.height), (image.width, image.height))
        self.assertTrue(pixels_almost_equal(reloaded.pixels, image.pixels))
        self.assertGreater(reloaded.max_value(), 1.0)


if __name__ == "__main__":
    main()
