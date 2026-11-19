#!/usr/bin/env python3
"""End-to-end sweep modeling demo.

Runs three scenarios requested for verification:
  1. helix (smooth 3D path, local section scaling, caps on)
  2. straight -> bend -> straight (zero-length junction merging, caps off)
  3. closed polygon path (seam/closure twist correction, no caps possible)

Outputs OBJ meshes, frame OBJ + SVG gizmos, and a Markdown report.
"""

from __future__ import annotations

import json
import os

from sweep.diagnostics import (
    analyze_normal_flips,
    scale_profile,
    seam_report,
    section_orientation,
    smooth_scale_profile,
)
from sweep.export import write_frames_obj, write_obj
from sweep.frame import frame_orthogonality_error, parallel_transport_frames
from sweep.mesh import SweepConfig, build_sweep
from sweep.path import Path
from sweep.section import SectionError, circle_section
from sweep.validate import radial_orientation_check, validate_mesh
from sweep.visualize import render_svg

ROOT = os.path.dirname(os.path.abspath(__file__))
MESH_DIR = os.path.join(ROOT, "artifacts", "meshes")
FRAME_DIR = os.path.join(ROOT, "artifacts", "frames")
REPORT_DIR = os.path.join(ROOT, "artifacts", "reports")


def scenario_helix():
    path = Path.helix(turns=2.0, radius=2.0, pitch=1.5, samples=121)
    section = circle_section(radius=0.6, segments=20)
    # Bulge in the middle, pinched ends: demonstrate local scaling.
    scales = smooth_scale_profile(
        len(path.points),
        [(0, 0.55), (30, 1.25), (60, 1.5), (90, 1.1), (120, 0.55)],
    )
    return "helix", path, section, scales, True, True


def scenario_bend():
    path = Path.straight_bend_straight(
        straight=3.0, bend_radius=1.5,
        straight_samples=16, bend_samples=31,
    )
    section = circle_section(radius=0.5, segments=18)
    scales = scale_profile(len(path.points), {len(path.points) // 2: 0.7})
    # Caps deliberately switched off -> expect two boundary loops.
    return "line_bend_line", path, section, scales, False, False


def scenario_closed():
    path = Path.closed_polygon(radius=2.5, corners=5, per_side=12)
    section = circle_section(radius=0.45, segments=16)
    scales = [1.0] * len(path.points)
    return "closed_loop", path, section, scales, False, False


def scenario_s_curve():
    path = Path.s_curve(samples=121)
    section = circle_section(radius=0.4, segments=16)
    scales = smooth_scale_profile(
        len(path.points), [(0, 0.8), (60, 1.3), (120, 0.8)]
    )
    return "s_curve", path, section, scales, True, True


def run_scenario(name, path, section, scales, cap_start, cap_end):
    frames, closure_twist = parallel_transport_frames(path.points, path.closed)
    config = SweepConfig(
        section=section,
        scales=scales,
        cap_start=cap_start,
        cap_end=cap_end,
        closed=path.closed,
        max_cross_section_dimension=2.5,
    )
    mesh = build_sweep(frames, config)
    report = validate_mesh(mesh)
    radial_ok, radial_hits, radial_total = radial_orientation_check(
        mesh, frames, len(section.points), path.closed
    )
    report.radial_outward_faces = radial_hits
    report.radial_total_faces = radial_total
    report.radial_all_outward = radial_ok
    flips = analyze_normal_flips(path, frames)
    seam = seam_report(frames, path.closed)
    orientation = section_orientation(section)

    obj_path = os.path.join(MESH_DIR, f"{name}.obj")
    frame_obj = os.path.join(FRAME_DIR, f"{name}_frames.obj")
    frame_svg = os.path.join(FRAME_DIR, f"{name}_frames.svg")
    write_obj(mesh, obj_path)
    write_frames_obj(frames, frame_obj, axis_length=0.5)
    render_svg(mesh, frames, frame_svg, title=f"{name} - parallel transport frames")

    result = {
        "name": name,
        "samples": len(path.points),
        "closed": path.closed,
        "merge": path.merge_report.summary(),
        "merge_count": path.merge_report.count,
        "closure_twist_deg": closure_twist * 180.0 / 3.141592653589793,
        "orthogonality_error": frame_orthogonality_error(frames),
        "flips": flips.summary(),
        "pt_flips": flips.pt_flip_count,
        "frenet_flips": flips.frenet_flip_count,
        "seam": seam,
        "section_orientation": orientation,
        "mesh": {
            "vertices": report.vertex_count,
            "faces": report.face_count,
            "boundary_loops": report.boundary_loop_count,
            "boundary_edges": report.boundary_edge_count,
            "watertight": report.watertight,
            "outward_oriented": report.outward_oriented,
            "signed_volume": report.signed_volume,
            "non_manifold": len(report.non_manifold_edges),
        },
        "validation_text": report.summary(),
        "artifacts": {
            "obj": os.path.relpath(obj_path, ROOT),
            "frame_obj": os.path.relpath(frame_obj, ROOT),
            "frame_svg": os.path.relpath(frame_svg, ROOT),
        },
    }
    return result, report


def main():
    for directory in (MESH_DIR, FRAME_DIR, REPORT_DIR):
        os.makedirs(directory, exist_ok=True)
    scenarios = [
        scenario_helix(),
        scenario_bend(),
        scenario_closed(),
        scenario_s_curve(),
    ]
    results = []
    print("=" * 72)
    for spec in scenarios:
        result, report = run_scenario(*spec)
        results.append(result)
        print(f"SCENARIO: {result['name']}")
        print(f"  samples={result['samples']} closed={result['closed']} "
              f"| {result['merge']}")
        print(f"  {result['flips']}")
        print(report.summary())
        print("-" * 72)
    with open(os.path.join(REPORT_DIR, "results.json"), "w",
              encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)
    write_markdown(results)


def write_markdown(results):
    lines = [
        "# Sweep Surface Modeler — Verification Report",
        "",
        "Parallel-transport (Bishop) frames, local section scaling, optional "
        "end caps, zero-length segment merging.",
        "",
        "## Scenario Summary",
        "",
        "| scenario | samples | closed | merged zero-length | PT flips | "
        "Frenet flips | boundary loops | watertight | outward |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        m = r["mesh"]
        lines.append(
            f"| {r['name']} | {r['samples']} | {r['closed']} | "
            f"{r['merge_count']} | {r['pt_flips']} | {r['frenet_flips']} | "
            f"{m['boundary_loops']} | {m['watertight']} | "
            f"{m['outward_oriented']} |"
        )
    lines.append("")
    for r in results:
        lines.extend([
            f"## {r['name']}",
            "",
            f"- path samples: {r['samples']}, closed: {r['closed']}",
            f"- zero-length handling: {r['merge']}",
            f"- closure twist corrected: {r['closure_twist_deg']:.4f} deg",
            f"- frame orthogonality error: {r['orthogonality_error']:.2e}",
            f"- normal analysis: {r['flips']}",
            f"- section winding: {r['section_orientation']['winding']}",
            f"- boundary loops: {r['mesh']['boundary_loops']} "
            f"({r['mesh']['boundary_edges']} edges)",
            f"- signed volume: {r['mesh']['signed_volume']:.6g}",
            f"- artifacts: `{r['artifacts']['obj']}`, "
            f"`{r['artifacts']['frame_obj']}`, `{r['artifacts']['frame_svg']}`",
            "",
            "```",
            r["validation_text"],
            "```",
            "",
        ])
        if r["seam"].get("closed"):
            seam = r["seam"]
            lines.extend([
                "### Closed-path seam",
                "",
                f"- closing edge length: {seam['closing_edge_length']:.4f}",
                f"- corner tangent turn (expected geometry): "
                f"{seam['corner_turn_deg']:.4f} deg",
                f"- residual normal twist after closure: "
                f"{seam['residual_twist_normal_deg']:.6f} deg",
                f"- residual binormal twist after closure: "
                f"{seam['residual_twist_binormal_deg']:.6f} deg",
                "",
            ])
    with open(os.path.join(REPORT_DIR, "report.md"), "w",
              encoding="utf-8") as handle:
        handle.write("\n".join(lines))


if __name__ == "__main__":
    main()
