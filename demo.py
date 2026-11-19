"""End-to-end demonstration: insert a line crossing multiple faces."""

from __future__ import annotations

import json
import os

from halfedge.check import validate
from halfedge.match import face_centroid, match_faces
from halfedge.mesh import build_mesh
from halfedge.scenarios import base_rectangle_cells, cross_faces_line
from halfedge.serialize import write_topology_json
from halfedge.svg import render_svg

OUT = "output"


def print_checks(title: str, report: dict) -> None:
    print(f"\n[{title}]")
    print(f"  V={report['vertices']} E={report['edges']} "
          f"F={report['faces']} (C={report['components']})")
    print(f"  Euler V-E+F={report['euler_characteristic']} "
          f"expected {report['euler_expected']} "
          f"-> {'OK' if report['euler_characteristic'] == report['euler_expected'] else 'FAIL'}")
    print(f"  total bounded area = {report['total_bounded_area']:.6f}")
    print(f"  bridge edges = {report['bridge_edges']}")
    if report["problems"]:
        print("  PROBLEMS:", report["problems"])


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    base_segments = base_rectangle_cells()
    inserted = cross_faces_line()

    before = build_mesh(base_segments)
    after = build_mesh(base_segments + [inserted])

    before_report = validate(before)
    after_report = validate(after)
    print_checks("before insertion", before_report)
    print_checks("after insertion", after_report)

    print("\nFace IDs and areas:")
    print(f"  {'old FID':>8} | {'new FID':>8} | {'area before':>11} | "
          f"{'area after':>10}")
    old_areas = {f.fid: f.area for f in before.faces if f.bounded}
    for row in match_faces(before, after):
        old = row["old_face"]
        print(f"  {('F' + str(old)):>8} | {('F' + str(row['new_face'])):>8} | "
              f"{old_areas[old]:>11.4f} | {row['new_area']:>10.4f}")

    before_centroids = {
        f.fid: face_centroid(before, f) for f in before.faces if f.bounded
    }
    summary = {
        "inserted_segment": {
            "from": [inserted.a.x, inserted.a.y],
            "to": [inserted.b.x, inserted.b.y],
        },
        "before": {
            "faces": [
                {"id": fid, "area": area, "centroid": before_centroids[fid]}
                for fid, area in sorted(old_areas.items())
            ],
            "total_area": before_report["total_bounded_area"],
            "checks": before_report,
        },
        "after": {
            "faces": [
                {"id": f.fid, "area": f.area,
                 "centroid": face_centroid(after, f)}
                for f in after.faces if f.bounded
            ],
            "total_area": after_report["total_bounded_area"],
            "checks": after_report,
        },
    }
    with open(os.path.join(OUT, "insertion_comparison.json"), "w",
              encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)

    write_topology_json(before, os.path.join(OUT, "topology_before.json"))
    write_topology_json(after, os.path.join(OUT, "topology_after.json"))
    render_svg(before, os.path.join(OUT, "faces_before.svg"))
    render_svg(after, os.path.join(OUT, "faces_after.svg"))
    print(f"\nArtifacts written to {OUT}/")


if __name__ == "__main__":
    main()
