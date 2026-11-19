#!/usr/bin/env python3
import json
import sys
from pathlib import Path


def fail(message):
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def ppm_size(path):
    with path.open("rb") as handle:
        magic = handle.readline().strip()
        dimensions = handle.readline().strip()
        maximum = handle.readline().strip()
    if magic != b"P6" or maximum != b"255":
        fail(f"{path} is not a binary P6 PPM")
    width, height = (int(value) for value in dimensions.split())
    return width, height


report_path = Path("artifacts/results/msaa_report.json")
if not report_path.exists():
    fail(f"missing {report_path}")

report = json.loads(report_path.read_text())
target = report["render_target"]
width = target["width"]
height = target["height"]
capability = report["capability"]
color_supported = set(capability["rgba8_sample_counts"])
depth_supported = set(capability["depth24_sample_counts"])
common_support = color_supported & depth_supported
modes = {mode["mode"]: mode for mode in report["modes"]}

if report["depth_safety"]["status"] != "pass":
    fail("depth safety status is not pass")
if report["depth_safety"]["single_sample_result_labelled_msaa"]:
    fail("single sample output is labelled MSAA")
if "not hardware MSAA" not in report["reference"]["method"]:
    fail("reference is not clearly labelled as non-MSAA")

baseline = modes["x1"]
if baseline["is_multisample"] or "not MSAA" not in baseline["label"]:
    fail("1x baseline is mislabelled as multisample")
if baseline["actual_color_samples"] != 0 or baseline["actual_depth_samples"] != 0:
    fail("1x baseline unexpectedly uses multisample storage")

for name, mode in modes.items():
    requested = mode["requested_samples"]
    if not mode["supported"]:
        if mode["rendered"] or "image" in mode or "frame_ms_median" in mode:
            fail(f"{name} is unsupported but has measured output")
        if requested in common_support:
            fail(f"{name} is marked unsupported despite being advertised")
        continue

    if not mode["rendered"]:
        fail(f"supported {name} has no rendered output")
    if mode["is_multisample"] != (requested > 1):
        fail(f"{name} multisample flag does not match request")
    if requested > 1:
        if mode["actual_color_samples"] != requested:
            fail(f"{name} color sample count was not honored")
        if mode["actual_depth_samples"] != requested:
            fail(f"{name} depth sample count was not honored")
        if requested not in common_support:
            fail(f"{name} rendered without queried format support")

    if mode["resolve_depth_object_type"] != 0:
        fail(f"{name} resolve FBO has a depth attachment")
    if not mode["resolve_depth_attachment_is_none"]:
        fail(f"{name} resolve depth safety flag is false")
    if mode["edge_band_pixels"] <= 0:
        fail(f"{name} has no edge-band measurements")

    attachments = mode["attachments"]
    for attachment in ("color", "depth", "resolve"):
        entry = attachments[attachment]
        if entry["width"] != width or entry["height"] != height:
            fail(f"{name} {attachment} dimensions are not recorded correctly")
    image = Path(mode["image"])
    if not image.exists():
        fail(f"missing image {image}")
    if ppm_size(image) != (width, height):
        fail(f"image dimensions do not match render target: {image}")

if "x2" in modes and not modes["x2"]["supported"]:
    if report["x2_vs_x4"]["available"]:
        fail("2x versus 4x comparison is claimed without 2x support")
    if Path("artifacts/results/frame_2x_msaa.ppm").exists():
        fail("unsupported 2x image exists")

print("report validation passed")
