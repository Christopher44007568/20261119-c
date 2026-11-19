from __future__ import annotations

import math
import unittest

from frustum import (
    Camera,
    CapacityError,
    Frustum,
    check_capacity,
)
from gl_api import EglContext
from gpu_culler import GpuFrustumCuller
from scenarios import Scenario, build_scenarios


class GpuCullingTests(unittest.TestCase):
    instance_count = 8192
    near_per_face = 128

    @classmethod
    def setUpClass(cls) -> None:
        camera = Camera(
            eye=(0.0, 3.0, 8.0),
            target=(0.0, 0.0, 0.0),
            up=(0.0, 1.0, 0.0),
            fov_y=math.radians(60.0),
            aspect=1.0,
            near=0.5,
            far=30.0,
        )
        cls.frustum = Frustum.from_camera(camera)
        cls.scenarios = {
            scenario.name: scenario
            for scenario in build_scenarios(
                cls.frustum,
                count=cls.instance_count,
                near_per_face=cls.near_per_face,
            )
        }
        cls.egl = EglContext()
        cls.culler = GpuFrustumCuller(
            instance_capacity=cls.instance_count,
            visible_capacity=cls.instance_count,
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls.culler.close()
        cls.egl.close()

    def _run(self, scenario: Scenario):
        return self.culler.run(scenario.name, scenario.spheres, self.frustum)

    def test_invisible_has_zero_count_and_no_error(self) -> None:
        result = self._run(self.scenarios["invisible"])
        self.assertEqual(result.expected_ids, [])
        self.assertEqual(result.gpu_ids, [])
        self.assertEqual(result.visible_count, 0)
        self.assertEqual(result.indirect_count, 0)
        self.assertFalse(result.draw_any_samples)
        self.assertFalse(result.overflow)
        self.assertEqual(result.gl_error, 0)
        self.assertTrue(result.passed)

    def test_all_visible_uses_exact_capacity(self) -> None:
        result = self._run(self.scenarios["all-visible"])
        self.assertEqual(len(result.expected_ids), self.instance_count)
        self.assertEqual(len(result.gpu_ids), self.instance_count)
        self.assertEqual(result.indirect_count, self.instance_count)
        self.assertEqual(result.visible_count, self.instance_count)
        self.assertFalse(result.overflow)
        self.assertTrue(result.draw_any_samples)
        self.assertEqual(result.gl_error, 0)
        self.assertEqual(sorted(result.gpu_ids), list(range(self.instance_count)))
        self.assertTrue(result.passed)

    def test_tangent_spheres_match_cpu_across_all_planes(self) -> None:
        scenario = self.scenarios["near-planes"]
        result = self._run(scenario)
        expected_count = 6 * self.near_per_face
        touched_planes = set()
        for sphere in scenario.spheres:
            distances = [
                plane.signed_distance(sphere.center)
                for plane in self.frustum.planes
            ]
            closest_plane = min(range(6), key=distances.__getitem__)
            touched_planes.add(closest_plane)
            self.assertAlmostEqual(
                distances[closest_plane],
                -sphere.radius,
                delta=3.0e-5,
            )
        self.assertEqual(touched_planes, set(range(6)))
        self.assertEqual(len(scenario.expected_ids), expected_count)
        self.assertEqual(len(result.expected_ids), expected_count)
        self.assertEqual(len(result.gpu_ids), expected_count)
        self.assertEqual(result.indirect_count, expected_count)
        self.assertEqual(sorted(result.gpu_ids), sorted(scenario.expected_ids))
        self.assertFalse(result.overflow)
        self.assertEqual(result.gl_error, 0)
        self.assertTrue(result.passed)

    def test_mixed_ids_match_cpu(self) -> None:
        scenario = self.scenarios["mixed"]
        result = self._run(scenario)
        self.assertEqual(len(result.expected_ids), self.instance_count // 2)
        self.assertEqual(sorted(result.gpu_ids), sorted(scenario.expected_ids))
        self.assertEqual(result.indirect_count, len(scenario.expected_ids))
        self.assertFalse(result.overflow)
        self.assertEqual(result.gl_error, 0)
        self.assertTrue(result.passed)

    def test_sync_order_is_explicit(self) -> None:
        result = self._run(self.scenarios["invisible"])
        trace = result.sync_trace
        self.assertIn("reset", trace[0])
        self.assertIn("dispatch cull", trace[1])
        self.assertIn("SHADER_STORAGE", trace[2])
        self.assertIn("draw_args", trace[3])
        self.assertIn("ELEMENT_ARRAY", trace[4])
        self.assertIn("COMMAND", trace[4])
        self.assertIn("glDrawElementsIndirect", trace[5])

    def test_capacity_checks_reject_unsafe_buffers(self) -> None:
        with self.assertRaises(CapacityError):
            check_capacity(9, 8, 9)
        with self.assertRaises(CapacityError):
            check_capacity(9, 9, 8)
        with self.assertRaises(CapacityError):
            check_capacity(1, 1, 1, indirect_bytes=19)
        report = check_capacity(8, 8, 8)
        self.assertEqual(report.visible_capacity, 8)
        self.assertEqual(report.indirect_bytes, 20)


if __name__ == "__main__":
    unittest.main()
