import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sdf_tracer import vecmath as vm
from sdf_tracer.sdf import (Scene, sd_box, sd_sphere, sd_torus, smooth_min)
from sdf_tracer import tracer
from sdf_tracer.camera import Camera
from sdf_tracer.render import render, OVER_STEP_COLOR


class PrimitiveTests(unittest.TestCase):
    def test_sphere_signed_distances(self):
        self.assertAlmostEqual(sd_sphere((0.0, 0.0, 0.0), 1.0), -1.0)
        self.assertAlmostEqual(sd_sphere((2.0, 0.0, 0.0), 1.0), 1.0)
        self.assertAlmostEqual(sd_sphere((0.0, 3.0, 4.0), 4.0), 1.0)

    def test_box_signed_distances(self):
        half = (1.0, 1.0, 1.0)
        self.assertAlmostEqual(sd_box((0.0, 0.0, 0.0), half), -1.0)
        self.assertAlmostEqual(sd_box((2.0, 0.0, 0.0), half), 1.0)
        self.assertAlmostEqual(sd_box((2.0, 2.0, 0.0), half),
                               math.sqrt(2.0))

    def test_torus_zero_on_surface(self):
        major, minor = 0.85, 0.30
        self.assertAlmostEqual(sd_torus((major + minor, 0.0, 0.0),
                                        major, minor), 0.0, places=6)
        self.assertAlmostEqual(sd_torus((major, 0.0, minor),
                                        major, minor), 0.0, places=6)

    def test_smooth_min_blends(self):
        self.assertEqual(smooth_min(1.0, 2.0, 0.0), 1.0)
        blended = smooth_min(1.0, 1.0, 1.0)
        self.assertLess(blended, 1.0)
        self.assertGreater(blended, 0.0)


class SceneTests(unittest.TestCase):
    def test_rotation_changes_local_coordinates(self):
        unrotated = Scene(euler=(0.0, 0.0, 0.0))
        rotated = Scene(euler=(0.0, 0.0, math.radians(90.0)))
        point = (1.0, 0.0, 0.0)
        self.assertAlmostEqual(unrotated.to_local(point)[0], 1.0)
        local = rotated.to_local(point)
        self.assertAlmostEqual(local[0], 0.0, places=9)
        self.assertAlmostEqual(local[1], 1.0, places=9)

    def test_sdf_inside_is_negative(self):
        scene = Scene()
        self.assertLess(scene((0.0, 0.0, 0.0)), 0.0)

    def test_sdf_far_outside_positive(self):
        scene = Scene()
        self.assertGreater(scene((10.0, 0.0, 0.0)), 0.0)

    def test_blend_radius_affects_distance(self):
        narrow = Scene(blend_radius=0.05)
        wide = Scene(blend_radius=0.9)
        point = (0.85, -0.35, 0.35)
        self.assertNotAlmostEqual(narrow(point), wide(point))


class NormalTests(unittest.TestCase):
    def test_normals_are_unit_and_finite(self):
        scene = Scene(euler=(0.4, -0.2, 0.7))
        for p in [(1.3, 0.0, 0.0), (0.0, 1.2, 0.5),
                  (-0.9, 0.8, -0.6), (0.0, 0.0, 1.15)]:
            n = tracer.normal_gradient(scene, p)
            self.assertTrue(all(math.isfinite(c) for c in n), p)
            self.assertAlmostEqual(vm.length(n), 1.0, places=5)

    def test_normal_never_nan_at_pathological_inputs(self):
        scene = Scene()
        for p in [(0.0, 0.0, 0.0), (1e12, 0.0, 0.0),
                  (-1e12, 1e12, 0.0)]:
            n = tracer.normal_gradient(scene, p)
            self.assertTrue(all(math.isfinite(c) for c in n))
            self.assertAlmostEqual(vm.length(n), 1.0, places=4)

    def test_sphere_normal_points_radially(self):
        class SphereOnly:
            center = (0.0, 0.0, 0.0)
            sphere_radius = 1.0

            def __call__(self, p):
                return sd_sphere(p, 1.0)

        p = (0.0, 0.0, 1.0)
        n = tracer.normal_gradient(SphereOnly(), p)
        self.assertTrue(all(abs(a - b) < 1e-3
                            for a, b in zip(n, (0.0, 0.0, 1.0))))


class RaySphereTests(unittest.TestCase):
    def test_outside_hit(self):
        enter, exit_t = tracer.ray_sphere((3.0, 0.0, 0.0),
                                          (-1.0, 0.0, 0.0), 1.0)
        self.assertAlmostEqual(enter, 2.0)
        self.assertAlmostEqual(exit_t, 4.0)

    def test_inside_returns_exit_only(self):
        enter, exit_t = tracer.ray_sphere((0.0, 0.0, 0.0),
                                          (0.0, 1.0, 0.0), 1.0)
        self.assertIsNone(enter)
        self.assertAlmostEqual(exit_t, 1.0)

    def test_miss_returns_none(self):
        enter, exit_t = tracer.ray_sphere((5.0, 5.0, 0.0),
                                          (1.0, 0.0, 0.0), 1.0)
        self.assertIsNone(enter)
        self.assertIsNone(exit_t)


class MarcherTests(unittest.TestCase):
    def setUp(self):
        self.scene = Scene(euler=(0.4, 0.2, 0.6), blend_radius=0.35)

    def test_exterior_hit(self):
        result = tracer.sphere_march(self.scene, (4.0, 0.0, 0.0),
                                     (-1.0, 0.0, 0.0))
        self.assertEqual(result["reason"], tracer.HIT_SURFACE)
        self.assertGreater(result["t"], 0.0)

    def test_interior_camera_finds_exit_surface(self):
        origin = (0.02, 0.02, 0.02)
        result = tracer.sphere_march(self.scene, origin,
                                     vm.norm((1.0, 1.0, 1.0)))
        self.assertEqual(result["reason"], tracer.HIT_SURFACE)
        self.assertGreater(result["t"], 0.0)
        self.assertLess(abs(self.scene(result["point"])), 1e-3)

    def test_far_plane_termination(self):
        result = tracer.sphere_march(self.scene, (0.0, 0.0, 20.0),
                                     (0.0, 0.0, 1.0), far=5.0)
        self.assertEqual(result["reason"], tracer.FAR_PLANE)

    def test_over_steps_distinct_reason(self):
        result = tracer.sphere_march(self.scene, (4.0, 0.0, 0.0),
                                     (-1.0, 0.0, 0.0), max_steps=2)
        self.assertEqual(result["reason"], tracer.OVER_STEPS)

    def test_trace_records_step_sizes(self):
        result = tracer.sphere_march(self.scene, (4.0, 0.0, 0.0),
                                     (-1.0, 0.0, 0.0), record=True)
        self.assertTrue(result["trace"])
        for step, t, dist, step_size in result["trace"]:
            self.assertGreater(step_size, 0.0)
            self.assertAlmostEqual(step_size, abs(dist))

    def test_marched_hit_within_analytic_sphere_bound(self):
        origin, direction = (3.5, 1.2, 2.2), vm.norm((-1.0, -0.4, -0.7))
        result = tracer.sphere_march(self.scene, origin, direction)
        validation = tracer.validate_hit(self.scene, origin,
                                         direction, result)
        self.assertIsNotNone(validation["analytic_t"])
        self.assertTrue(validation["within_bound"], validation)

    def test_degenerate_direction(self):
        result = tracer.sphere_march(self.scene, (0.0, 0.0, 0.0),
                                     (0.0, 0.0, 0.0))
        self.assertEqual(result["reason"], tracer.DEGENERATE)


class RenderTests(unittest.TestCase):
    def test_render_classifies_over_steps_with_marker_color(self):
        scene = Scene()
        camera = Camera((0.0, 0.0, 4.2), (0.0, 0.0, 0.0))
        rows, stats, reports = render(scene, camera, 24, 16,
                                      max_steps=1,
                                      debug_pixels=((12, 8),))
        self.assertGreater(stats[tracer.OVER_STEPS], 0)
        self.assertEqual(stats[tracer.HIT_SURFACE], 0)
        marker = tuple(int(c * 255) for c in OVER_STEP_COLOR)
        flat = bytes(rows[8])
        self.assertIn(bytes(marker), flat)
        self.assertEqual(len(reports), 1)

    def test_inside_render_produces_hits(self):
        scene = Scene()
        camera = Camera((0.05, 0.05, 0.05), (1.0, 1.0, 1.0))
        _, stats, _ = render(scene, camera, 32, 24)
        self.assertGreater(stats[tracer.HIT_SURFACE], 0)
        self.assertEqual(stats[tracer.DEGENERATE], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
