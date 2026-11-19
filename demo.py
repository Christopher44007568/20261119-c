"""Demo: build a CDT of a concave domain with a hole and an internal
constraint, insert extra vertices incrementally, and write an HTML
report showing the local retriangulation of each insertion (cavity,
circumcircles, edge-flip log).  Prints the validation summary.
"""

import os

from cdt import ConstrainedDelaunay, validate
from visualize import write_report


def main():
    # concave arrow-shaped outer boundary
    outer = [(0, 0), (14, 0), (14, 4), (9, 4), (9, 8),
             (5, 8), (5, 4), (0, 4)]
    hole = [(6.0, 1.0), (8.5, 1.0), (8.5, 3.0), (6.0, 3.0)]
    constraints = [((1, 1), (4.5, 3.5)), ((10, 1), (13, 3))]
    seeds = [(2, 2), (7, 0.6), (12, 2), (1, 3.2), (7, 6.5)]

    c = ConstrainedDelaunay(outer, holes=[hole], constraints=constraints,
                            points=seeds)

    # incremental insertions; each record captures the local re-triangulation
    records = []
    for p in [(3, 1.2), (11, 3.4), (7, 4.6), (6, 7.0)]:
        _, rec = c.insert_point(p)
        records.append(rec)

    pts, tris = c.export()
    area = validate.check_area_conservation(pts, tris, c.outer, c.holes)
    print(f"triangles: {len(tris)}, vertices: {len(pts)}")
    print(f"  mesh={area['triangle_area']} domain={area['domain_area']} "
          f"ok={area['ok']}")
    print(f"holes empty: {validate.check_holes_empty(pts, tris, c.holes) == []}")
    missing = validate.check_constraints_present(
        pts, tris, c.constraint_segments())
    print(f"constraints preserved: {missing == []}")
    print(f"export sanity: {validate.check_export(pts, tris) == []}")
    for i, rec in enumerate(records):
        print(f"insert #{i} {rec.point}: cavity={len(rec.cavity)} "
              f"new={len(rec.new_triangles)} flips={len(rec.flips)}")

    os.makedirs("out", exist_ok=True)
    write_report(c, records, "out/report.html")
    print("wrote out/report.html")


if __name__ == "__main__":
    main()
