import math
import unittest

from decals import DecalDefinition, DecalSystem, TriangleMesh, project_decal
from decals.vec3 import barycentric, dot, sub


def flat_decal(**kw):
    args = dict(
        position=(0.0, 0.0, 0.5),
        direction=(0.0, 0.0, -1.0),
        half_extents=(0.4, 0.4, 0.5),
    )
    args.update(kw)
    return DecalDefinition(**args)


class FlatProjectionTest(unittest.TestCase):
    def test_patch_generated_with_uvs_and_offsets(self):
        mesh = TriangleMesh.grid(8, 8, 2.0)
        patch, report = project_decal(mesh, flat_decal())
        self.assertGreater(report.triangles_generated, 0)
        self.assertEqual(report.backface_culled, 0)
        for v in patch.vertices:
            self.assertGreaterEqual(v.uv[0], 0.0)
            self.assertLessEqual(v.uv[0], 1.0)
            self.assertGreaterEqual(v.uv[1], 0.0)
            self.assertLessEqual(v.uv[1], 1.0)
            self.assertGreater(v.offset, 0.0)
            self.assertGreater(v.position[2], 0.0)  # lifted above surface
        self.assertAlmostEqual(report.max_stretch, 1.0, places=6)

    def test_offset_reported(self):
        mesh = TriangleMesh.grid(4, 4, 2.0)
        _, report = project_decal(mesh, flat_decal(normal_bias=0.01))
        self.assertAlmostEqual(report.min_offset, 0.01, places=9)
        self.assertAlmostEqual(report.max_offset, 0.01, places=9)


class GrazingProjectionTest(unittest.TestCase):
    def test_grazing_direction_culled_by_backface_rule(self):
        mesh = TriangleMesh.grid(8, 8, 2.0)
        decal = flat_decal(position=(0.0, 0.0, 0.0), direction=(1.0, 0.0, 0.0))
        _, report = project_decal(mesh, decal)
        self.assertEqual(report.triangles_generated, 0)
        self.assertGreater(report.backface_culled, 0)

    def test_steep_but_visible_angle_reports_stretch(self):
        mesh = TriangleMesh.grid(8, 8, 2.0)
        # ~75 degrees from the surface normal.
        decal = flat_decal(direction=(0.0, 3.5, -1.0), max_stretch=100.0)
        patch, report = project_decal(mesh, decal)
        self.assertGreater(report.triangles_generated, 0)
        self.assertGreater(report.max_stretch, 3.0)
        # Slope-scaled correction: offsets exceed the flat-surface bias.
        self.assertGreater(report.max_offset, decal.normal_bias * 2)
        for v in patch.vertices:
            self.assertGreater(v.position[2], 0.0)

    def test_excessive_stretch_is_culled(self):
        mesh = TriangleMesh.grid(8, 8, 2.0)
        decal = flat_decal(direction=(0.0, 3.5, -1.0), max_stretch=2.0)
        _, report = project_decal(mesh, decal)
        self.assertEqual(report.triangles_generated, 0)
        self.assertGreater(report.stretch_culled, 0)


class CreaseStretchTest(unittest.TestCase):
    def roof(self):
        # 90-degree dihedral fold along the y axis (ridge at x=0).
        return TriangleMesh.grid(8, 8, 2.0, height_fn=lambda x, y: -abs(x))

    def test_patch_spans_crease_and_reports_stretch(self):
        mesh = self.roof()
        decal = flat_decal(half_extents=(0.4, 0.4, 1.0), max_stretch=100.0)
        patch, report = project_decal(mesh, decal)
        self.assertGreater(report.triangles_generated, 0)
        # 45-degree slopes: stretch ~ 1/cos(45deg).
        self.assertAlmostEqual(report.max_stretch, math.sqrt(2.0), places=3)
        sides = {0}
        for v in patch.vertices:
            tri = mesh.triangles[v.tri_id]
            cx = sum(mesh.vertices[i][0] for i in tri) / 3.0
            sides.add(1 if cx > 1e-9 else (-1 if cx < -1e-9 else 0))
        self.assertIn(1, sides)
        self.assertIn(-1, sides)

    def test_patch_stays_above_folded_surface(self):
        mesh = self.roof()
        decal = flat_decal(half_extents=(0.4, 0.4, 1.0), max_stretch=100.0)
        patch, _ = project_decal(mesh, decal)
        for v in patch.vertices:
            tri = mesh.triangles[v.tri_id]
            pts = [mesh.vertices[i] for i in tri]
            surface = barycentric(v.bary, *pts)
            lift = dot(sub(v.position, surface), v.normal)
            self.assertGreater(lift, 0.0)


def thin_plate():
    """Two-sided plate: top at z=0 facing +z, bottom at z=-0.1 facing -z."""
    top = TriangleMesh.grid(4, 4, 2.0)
    verts = list(top.vertices) + [(x, y, -0.1) for (x, y, z) in top.vertices]
    n = len(top.vertices)
    tris = list(top.triangles) + [(a + n, d + n, b + n)
                                  for (a, b, d) in top.triangles]
    return TriangleMesh(verts, tris)


class BackfaceProtectionTest(unittest.TestCase):
    def test_depth_range_blocks_far_side(self):
        mesh = thin_plate()
        decal = flat_decal(position=(0.0, 0.0, 0.1), half_extents=(0.4, 0.4, 0.15))
        patch, report = project_decal(mesh, decal)
        self.assertGreater(report.triangles_generated, 0)
        for v in patch.vertices:
            self.assertGreater(v.position[2], -0.05)

    def test_facing_rule_blocks_far_side(self):
        mesh = thin_plate()
        # Deep box reaches the bottom face, but it faces away.
        decal = flat_decal(position=(0.0, 0.0, 0.1), half_extents=(0.4, 0.4, 0.3))
        patch, report = project_decal(mesh, decal)
        self.assertGreater(report.backface_culled, 0)
        for v in patch.vertices:
            self.assertGreater(v.position[2], -0.05)


class SystemTest(unittest.TestCase):
    def setUp(self):
        self.mesh = TriangleMesh.grid(8, 8, 2.0)
        self.sys = DecalSystem(self.mesh)

    def test_priority_blending_order(self):
        low = self.sys.add_decal(flat_decal(texture="stain", priority=1))
        high = self.sys.add_decal(flat_decal(texture="bullet", priority=5))
        overlaps = self.sys.overlaps()
        self.assertTrue(overlaps)
        for stack in overlaps.values():
            self.assertEqual(stack, [low, high])
        # Higher priority decal rides on a higher layer offset.
        off_low = min(v.offset for v in self.sys.patch(low).vertices)
        off_high = min(v.offset for v in self.sys.patch(high).vertices)
        self.assertGreater(off_high, off_low)

    def test_removal_restores_surface_locally(self):
        keep = self.sys.add_decal(flat_decal(priority=1))
        gone = self.sys.add_decal(
            flat_decal(position=(0.2, 0.0, 0.5), priority=2))
        self.assertTrue(self.sys.overlaps())
        restored = self.sys.remove_decal(gone)
        self.assertTrue(restored)
        for tri_id in restored:
            self.assertNotIn(gone, self.sys.blend_stack(tri_id))
        self.assertFalse(self.sys.overlaps())
        self.assertIn(keep, self.sys.decal_ids())

    def test_layer_offset_not_compounded_by_reorder(self):
        a = self.sys.add_decal(flat_decal(priority=1))
        b = self.sys.add_decal(flat_decal(priority=2))
        before = [v.offset for v in self.sys.patch(a).vertices]
        self.sys.remove_decal(b)
        after = [v.offset for v in self.sys.patch(a).vertices]
        for x, y in zip(before, after):
            self.assertAlmostEqual(x, y)

    def test_deformation_following(self):
        did = self.sys.add_decal(flat_decal(max_stretch=100.0))
        self.sys.deform_receiver(
            lambda i, p: (p[0], p[1], p[2] + 0.1 * math.sin(3.0 * p[0]))
        )
        patch = self.sys.patch(did)
        for v in patch.vertices:
            tri = self.mesh.triangles[v.tri_id]
            pts = [self.mesh.vertices[i] for i in tri]
            surface = barycentric(v.bary, *pts)
            lifted = (
                surface[0] + v.normal[0] * v.offset,
                surface[1] + v.normal[1] * v.offset,
                surface[2] + v.normal[2] * v.offset,
            )
            for k in range(3):
                self.assertAlmostEqual(v.position[k], lifted[k], places=9)
            self.assertGreater(v.position[2], surface[2] - 1e-9)


if __name__ == "__main__":
    unittest.main()
