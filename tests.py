"""Run all topology scenarios and verify invariants."""

from __future__ import annotations

import os

from halfedge.check import validate
from halfedge.mesh import build_mesh
from halfedge.scenarios import (
    collinear_overlap,
    dangling_edges,
    multi_vertex_concurrency,
    t_junctions,
)
from halfedge.serialize import write_topology_json
from halfedge.svg import render_svg

SCENARIOS = {
    "dangling_edges": dangling_edges,
    "t_junctions": t_junctions,
    "collinear_overlap": collinear_overlap,
    "multi_vertex_concurrency": multi_vertex_concurrency,
}


def main() -> int:
    os.makedirs("output", exist_ok=True)
    failures = 0
    for name, builder in SCENARIOS.items():
        mesh = build_mesh(builder())
        report = validate(mesh)
        bounded = [f for f in mesh.faces if f.bounded]
        print(f"\n=== {name} ===")
        print(f"  V={report['vertices']} E={report['edges']} "
              f"F={report['faces']} C={report['components']} "
              f"bounded={len(bounded)}")
        print(f"  Euler {report['euler_characteristic']} == "
              f"{report['euler_expected']} "
              f"-> {'OK' if report['euler_characteristic'] == report['euler_expected'] else 'FAIL'}")
        print(f"  total area={report['total_bounded_area']:.6f} "
              f"bridges={len(report['bridge_edges'])} "
              f"algebraic_sum={report['algebraic_area_sum']:.2e}")
        for face in bounded:
            print(f"    F{face.fid}: area={face.area:.4f} "
                  f"loops={len(face.loops)}")
        if not report["ok"]:
            failures += 1
            print("  FAIL:", report["problems"])
        write_topology_json(mesh, f"output/{name}.json")
        render_svg(mesh, f"output/{name}.svg")

    print("\n" + ("ALL SCENARIOS PASSED" if failures == 0
                  else f"{failures} SCENARIO(S) FAILED"))
    return failures


if __name__ == "__main__":
    raise SystemExit(main())
