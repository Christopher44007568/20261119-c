import unittest

import numpy as np

from multiview.scene import make_scene
from multiview.triangulate import (
    Flag,
    Observation,
    Status,
    Track,
    ellipsoid,
    evaluate,
    ray_angles_deg,
)


def find(scene, name):
    return next(t for t in scene.tracks if t.name == name)


class TestCleanTriangulation(unittest.TestCase):
    def setUp(self):
        self.scene = make_scene(seed=0, pixel_sigma=1.0)

    def test_noiseless_recovers_truth(self):
        scene = make_scene(seed=0, pixel_sigma=0.0)
        for track in scene.tracks[:6]:  # well-conditioned points only
            res = evaluate(track, scene.cameras, pixel_sigma=1.0)
            self.assertEqual(res.status, Status.OK)
            self.assertLess(np.linalg.norm(res.point - track.truth), 1e-6)

    def test_residuals_small_for_inliers(self):
        track = find(self.scene, "p0")
        res = evaluate(track, self.scene.cameras, pixel_sigma=1.0)
        for o in track.observations:
            self.assertLess(o.residual, 6.0)
            self.assertFalse(o.flags)

    def test_ellipsoid_scales_with_sigma(self):
        track = find(self.scene, "p0")
        res = evaluate(track, self.scene.cameras, pixel_sigma=1.0)
        r1, _ = ellipsoid(res.covariance, 1.0)
        r2, _ = ellipsoid(res.covariance, 2.0)
        np.testing.assert_allclose(r2, 2 * r1)


class TestIndependentFlags(unittest.TestCase):
    def setUp(self):
        self.scene = make_scene(seed=0, pixel_sigma=1.0)

    def test_short_baseline_flagged_not_fitted(self):
        track = find(self.scene, "short_baseline")
        res = evaluate(track, self.scene.cameras, pixel_sigma=1.0)
        self.assertEqual(res.status, Status.SHORT_BASELINE)
        self.assertLess(res.max_angle_deg, 2.0)
        for o in track.observations:
            self.assertIn(Flag.SHORT_BASELINE, o.flags)

    def test_behind_camera_flagged_per_observation(self):
        track = find(self.scene, "behind_camera")
        res = evaluate(track, self.scene.cameras, pixel_sigma=1.0)
        behind = [o for o in track.observations
                  if Flag.BEHIND_CAMERA in o.flags]
        self.assertTrue(behind, "expected at least one behind-camera flag")
        # flags are per-observation, not a blanket track failure
        clean = [o for o in track.observations
                 if not o.flags and np.isfinite(o.residual)]
        self.assertTrue(clean)

    def test_mismatch_flagged_on_single_camera(self):
        track = find(self.scene, "mismatch")
        res = evaluate(track, self.scene.cameras, pixel_sigma=1.0)
        self.assertEqual(res.status, Status.MISMATCH)
        flagged = {o.camera for o in track.observations
                   if Flag.MISMATCH in o.flags}
        self.assertIn(2, flagged)  # cam2 got the swapped pixel
        self.assertEqual(len(flagged), 1)

    def test_exclusion_recovers_mismatched_track(self):
        track = find(self.scene, "mismatch")
        bad = next(o for o in track.observations if o.camera == 2)
        bad.excluded = True
        res = evaluate(track, self.scene.cameras, pixel_sigma=1.0)
        self.assertEqual(res.status, Status.OK)
        self.assertIn(Flag.EXCLUDED, bad.flags)
        self.assertLess(np.linalg.norm(res.point - track.truth), 0.05)

    def test_insufficient_observations(self):
        track = Track("lone", [Observation(0, np.array([100.0, 100.0]))])
        res = evaluate(track, self.scene.cameras)
        self.assertEqual(res.status, Status.INSUFFICIENT)
        self.assertIsNone(res.point)

    def test_ray_angles_symmetric(self):
        track = find(self.scene, "p0")
        angles = ray_angles_deg(self.scene.cameras, track.observations)
        for (a, b), ang in angles.items():
            self.assertGreater(ang, 0.0)
            self.assertLess(ang, 180.0)


if __name__ == "__main__":
    unittest.main()
