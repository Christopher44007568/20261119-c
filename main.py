#!/usr/bin/env python3
"""CLI for the disk-topology mesh parameterization tool.

Examples:
    python main.py mesh.obj --weights cotangent --out out.obj --report-dir out/
    python main.py --demo curved --weights uniform --report-dir artifacts/
"""

from __future__ import annotations

import argparse
import os
import sys

from mesh_param import Mesh, TopologyError, distortion_report, parameterize
from mesh_param.test_meshes import curved_sheet, grid_sheet, holed_sheet
from mesh_param.texture import checkerboard_image
from mesh_param.visualize import plot_distortion, plot_textured, plot_uv

DEMOS = {"planar": grid_sheet, "curved": curved_sheet, "holed": holed_sheet}


def run(mesh: Mesh, weights: str, out_obj: str | None,
        report_dir: str | None, tag: str) -> int:
    print(f"[{tag}] mesh: {len(mesh.vertices)} vertices, "
          f"{len(mesh.faces)} triangles")
    try:
        parameterize(mesh, weights=weights)
    except TopologyError as exc:
        print(f"[{tag}] TOPOLOGY ERROR: {exc}", file=sys.stderr)
        return 2

    report = distortion_report(mesh)
    print(f"[{tag}] weights={weights}")
    print(report.summary())

    if out_obj:
        mesh.save_obj(out_obj)
        print(f"[{tag}] wrote OBJ with UVs: {out_obj}")

    if report_dir:
        os.makedirs(report_dir, exist_ok=True)
        plot_uv(mesh, report, os.path.join(report_dir, f"{tag}_uv.png"),
                title=f"UV layout - {tag} ({weights})")
        plot_distortion(mesh, report.angle_distortion,
                        os.path.join(report_dir, f"{tag}_angle.png"),
                        f"Angle distortion (deg) - {tag} ({weights})",
                        cmap="magma")
        plot_distortion(mesh, report.area_distortion,
                        os.path.join(report_dir, f"{tag}_area.png"),
                        f"Area distortion log2(uv/3d) - {tag} ({weights})",
                        cmap="coolwarm")
        plot_textured(mesh, os.path.join(report_dir, f"{tag}_textured.png"),
                      title=f"Checkerboard on mesh - {tag} ({weights})")
        checkerboard_image(path=os.path.join(report_dir, "checkerboard.png"))
        print(f"[{tag}] wrote plots to {report_dir}/")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", nargs="?", help="input OBJ file")
    ap.add_argument("--demo", choices=sorted(DEMOS),
                    help="use a built-in test mesh instead of an OBJ file")
    ap.add_argument("--weights", choices=("uniform", "cotangent"),
                    default="cotangent")
    ap.add_argument("--out", help="output OBJ path with UVs")
    ap.add_argument("--report-dir", help="directory for PNG reports")
    args = ap.parse_args()

    if args.demo:
        mesh = DEMOS[args.demo]()
        tag = f"{args.demo}_{args.weights}"
    elif args.input:
        mesh = Mesh.load_obj(args.input)
        base = os.path.splitext(os.path.basename(args.input))[0]
        tag = f"{base}_{args.weights}"
    else:
        ap.error("provide an input OBJ or --demo {planar,curved,holed}")

    out = args.out
    if out is None and args.demo:
        out_dir = args.report_dir or "."
        os.makedirs(out_dir, exist_ok=True)
        out = os.path.join(out_dir, f"{tag}.obj")
    return run(mesh, args.weights, out, args.report_dir, tag)


if __name__ == "__main__":
    raise SystemExit(main())
