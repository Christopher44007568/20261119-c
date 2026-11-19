import math
import os
import tempfile
import unittest

from sweep.export import write_frames_obj, write_obj
from sweep.frame import parallel_transport_frames
from sweep.mesh import SweepConfig, build_sweep
from sweep.path import Path
from sweep.section import SectionError, circle_section
from sweep.validate import (
    radial_orientation_check,
    signed_volume,
    validate_mesh,
)


def build(path, scales=None, caps=(True, True)):
    section = circle_section(0.5, 16)
    frames, _ = parallel_transport_frames(path.points, path.closed)
    scales = scales or [1.0] * len(frames)
    config = SweepConfig(
        section, scales, cap_start=caps[0], cap_end=caps[1],
        closed=path.closed,
    )
    return build_sweep(frames, config), frames, section


class MeshTests(unittest.TestCase):
    def test_open_capped_mesh_is_watertight_and_outward(self):
        mesh, _frames, _section = build(Path.helix(samples=41))
        report = validate_mesh(mesh)
        self.assertTrue(report.watertight)
        self.assertEqual(report.boundary_loop_count, 0)
        self.assertGreater(signed_volume(mesh), 0.0)
        self.assertTrue(report.outward_oriented)

    def test_uncapped_open_mesh_has_two_boundary_loops(self):
        path = Path.straight_bend_straight()
        mesh, frames, section = build(path, caps=(False, False))
        report = validate_mesh(mesh)
        self.assertFalse(report.watertight)
        self.assertEqual(report.boundary_loop_count, 2)
        for loop in report.boundary_loops:
            self.assertEqual(len(loop), len(section.points))
        ok, hits, total = radial_orientation_check(
            mesh, frames, len(section.points), False
        )
        self.assertTrue(ok)
        self.assertEqual(hits, total)

    def test_closed_sweep_is_watertight_with_no_caps(self):
        mesh, _frames, _section = build(Path.closed_polygon())
        report = validate_mesh(mesh)
        self.assertTrue(report.watertight)
        self.assertEqual(report.boundary_loop_count, 0)
        self.assertGreater(report.signed_volume, 0.0)

    def test_cap_faces_point_along_outward_tangents(self):
        path = Path.from_samples([(0, 0, 0), (1, 0, 0), (2, 0, 0)])
        mesh, frames, section = build(path, caps=(True, True))
        groups = {name: (start, end) for name, start, end in mesh.groups}
        from sweep.mesh import outward_normal
        from sweep.vector import dot

        start, end = groups["cap_start"]
        normal = outward_normal(mesh.faces[start], mesh.vertices)
        self.assertLess(dot(normal, frames[0].tangent), 0.0)
        start, end = groups["cap_end"]
        normal = outward_normal(mesh.faces[start], mesh.vertices)
        self.assertGreater(dot(normal, frames[-1].tangent), 0.0)

    def test_local_scaling_changes_geometry(self):
        path = Path.from_samples([(0, 0, 0), (1, 0, 0), (2, 0, 0), (3, 0, 0)])
        narrow, _, section = build(path, scales=[1.0, 1.0, 0.25, 0.25])
        wide, _, _ = build(path, scales=[1.0, 1.0, 1.0, 1.0])
        ring = len(section.points)
        narrow_radius = max(
            math.sqrt(v[1] ** 2 + v[2] ** 2)
            for v in narrow.vertices[2 * ring:3 * ring]
        )
        wide_radius = max(
            math.sqrt(v[1] ** 2 + v[2] ** 2)
            for v in wide.vertices[2 * ring:3 * ring]
        )
        self.assertAlmostEqual(narrow_radius, 0.125, places=6)
        self.assertAlmostEqual(wide_radius, 0.5, places=6)

    def test_size_constraint_violation_raises(self):
        path = Path.from_samples([(0, 0, 0), (1, 0, 0)])
        frames, _ = parallel_transport_frames(path.points, False)
        config = SweepConfig(
            circle_section(1.0, 12), [1.0, 5.0],
            max_cross_section_dimension=2.0,
        )
        with self.assertRaises(SectionError):
            build_sweep(frames, config)

    def test_obj_roundtrip_preserves_face_count(self):
        mesh, frames, _ = build(Path.helix(samples=25))
        with tempfile.TemporaryDirectory() as tmp:
            obj_path = os.path.join(tmp, "tube.obj")
            frame_path = os.path.join(tmp, "frames.obj")
            write_obj(mesh, obj_path)
            write_frames_obj(frames, frame_path)
            text = open(obj_path, encoding="utf-8").read()
            self.assertEqual(text.count("\nf ") + text.startswith("f "),
                             len(mesh.faces))
            self.assertTrue(os.path.exists(frame_path))


if __name__ == "__main__":
    unittest.main()
