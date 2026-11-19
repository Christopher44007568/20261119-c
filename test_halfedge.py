"""Unit tests for the half-edge planar subdivision builder."""

import math
import unittest

from halfedge import Point, Segment, build_mesh
from halfedge.check import validate
from halfedge.match import match_faces
from halfedge.scenarios import (
    base_rectangle_cells,
    collinear_overlap,
    cross_faces_line,
    dangling_edges,
    multi_vertex_concurrency,
    t_junctions,
)


def rect(x1: float, y1: float, x2: float, y2: float, base: int) -> list[Segment]:
    points = [Point(x1, y1), Point(x2, y1), Point(x2, y2), Point(x1, y2)]
    return [Segment(points[i], points[(i + 1) % 4], base + i)
            for i in range(4)]


class HalfEdgeTests(unittest.TestCase):
    def assertMeshValid(self, mesh) -> dict:
        report = validate(mesh)
        self.assertTrue(report["ok"], report["problems"])
        return report

    def test_basic_square(self):
        mesh = build_mesh(rect(0, 0, 4, 3, 0))
        report = self.assertMeshValid(mesh)
        bounded = [f for f in mesh.faces if f.bounded]
        self.assertEqual(len(bounded), 1)
        self.assertAlmostEqual(bounded[0].area, 12.0)
        self.assertEqual((report["vertices"], report["edges"], report["faces"]),
                         (4, 4, 2))

    def test_twin_and_next_coverage(self):
        mesh = build_mesh(t_junctions())
        self.assertMeshValid(mesh)
        for he in mesh.halfedges:
            self.assertEqual(mesh.halfedges[he.twin].twin, he.hid)
            self.assertGreaterEqual(he.next, 0)
            self.assertGreaterEqual(he.face, 0)
        ownership = [0] * len(mesh.halfedges)
        for face in mesh.faces:
            for loop in face.loops:
                for hid in loop:
                    ownership[hid] += 1
        self.assertTrue(all(count == 1 for count in ownership))

    def test_dangling_edges_are_bridges(self):
        mesh = build_mesh(dangling_edges())
        report = self.assertMeshValid(mesh)
        self.assertEqual(len(report["bridge_edges"]), 3)
        bounded = [f for f in mesh.faces if f.bounded]
        self.assertAlmostEqual(bounded[0].area, 6.0)

    def test_t_junction_splits_at_contact(self):
        mesh = build_mesh(t_junctions())
        report = self.assertMeshValid(mesh)
        self.assertEqual(report["vertices"], 8)
        self.assertAlmostEqual(report["total_bounded_area"], 24.0)

    def test_collinear_overlap_deduplicates_edges(self):
        mesh = build_mesh(collinear_overlap())
        report = self.assertMeshValid(mesh)
        endpoint_pairs = {
            tuple(sorted((mesh.halfedges[e.he_forward].origin,
                          mesh.destination(e.he_forward))))
            for e in mesh.edges
        }
        self.assertEqual(len(endpoint_pairs), len(mesh.edges))
        self.assertAlmostEqual(report["total_bounded_area"], 12.5)

    def test_multi_vertex_concurrency(self):
        mesh = build_mesh(multi_vertex_concurrency())
        report = self.assertMeshValid(mesh)
        self.assertAlmostEqual(report["total_bounded_area"], 9.0)
        self.assertEqual(report["euler_characteristic"],
                         report["euler_expected"])

    def test_holes_and_nested_islands(self):
        segments = (rect(0, 0, 10, 10, 0) + rect(2, 2, 8, 8, 4)
                    + rect(3, 3, 7, 7, 8) + rect(4, 4, 6, 6, 12))
        mesh = build_mesh(segments)
        report = self.assertMeshValid(mesh)
        bounded = sorted(
            (f for f in mesh.faces if f.bounded), key=lambda f: -f.area)
        self.assertEqual(len(bounded), 4)
        self.assertTrue(all(len(f.loops) >= 2 for f in bounded[:3]))
        for face, expected in zip(bounded, (64.0, 20.0, 12.0, 4.0)):
            self.assertAlmostEqual(face.area, expected)
        self.assertAlmostEqual(report["total_bounded_area"], 100.0)

    def test_disconnected_components_euler(self):
        segments = (rect(0, 0, 2, 2, 0) + rect(5, 0, 7, 2, 4)
                    + [Segment(Point(9, 0), Point(9, 2), 8)])
        mesh = build_mesh(segments)
        report = self.assertMeshValid(mesh)
        self.assertEqual(report["components"], 3)
        self.assertEqual(report["euler_characteristic"],
                         1 + report["components"])

    def test_face_area_conserved_after_insertion(self):
        before = build_mesh(base_rectangle_cells())
        after = build_mesh(base_rectangle_cells() + [cross_faces_line()])
        self.assertMeshValid(before)
        self.assertMeshValid(after)
        rows = match_faces(before, after)
        self.assertEqual(len(rows), 6)
        grouped: dict[int, float] = {}
        for row in rows:
            grouped[row["old_face"]] = grouped.get(row["old_face"], 0.0) \
                + row["new_area"]
        for old_id, combined in grouped.items():
            old_area = next(f.area for f in before.faces if f.fid == old_id)
            self.assertTrue(math.isclose(combined, old_area, abs_tol=1e-8))
        total_before = sum(f.area for f in before.faces if f.bounded)
        total_after = sum(f.area for f in after.faces if f.bounded)
        self.assertAlmostEqual(total_before, total_after)


if __name__ == "__main__":
    unittest.main(verbosity=2)
