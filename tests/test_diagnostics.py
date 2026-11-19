import unittest

from sweep.diagnostics import (
    analyze_normal_flips,
    scale_profile,
    seam_report,
    section_orientation,
    smooth_scale_profile,
)
from sweep.frame import parallel_transport_frames
from sweep.path import Path
from sweep.section import circle_section


class DiagnosticsTests(unittest.TestCase):
    def test_merge_report_lists_each_duplicate(self):
        path = Path.straight_bend_straight()
        self.assertGreaterEqual(path.merge_report.count, 2)
        self.assertTrue(all(isinstance(i, int) for i in path.merge_report.removed))
        self.assertIn("zero-length", path.merge_report.summary())

    def test_section_orientation_report(self):
        info = section_orientation(circle_section(1.0, 12))
        self.assertEqual(info["winding"], "CCW")
        self.assertTrue(info["valid_for_outward_faces"])

    def test_seam_residual_twist_is_zero(self):
        path = Path.closed_polygon()
        frames, _ = parallel_transport_frames(path.points, True)
        seam = seam_report(frames, True)
        self.assertAlmostEqual(seam["residual_twist_normal_deg"], 0.0, places=8)
        self.assertAlmostEqual(seam["residual_twist_binormal_deg"], 0.0, places=8)

    def test_s_curve_flip_comparison(self):
        path = Path.s_curve()
        frames, _ = parallel_transport_frames(path.points, False)
        report = analyze_normal_flips(path, frames)
        self.assertEqual(report.pt_flip_count, 0)
        self.assertGreaterEqual(report.frenet_flip_count, 2)

    def test_scale_profiles(self):
        self.assertEqual(scale_profile(3, {1: 2.0}), [1.0, 2.0, 1.0])
        smooth = smooth_scale_profile(5, [(0, 1.0), (4, 3.0)])
        self.assertEqual(smooth[0], 1.0)
        self.assertAlmostEqual(smooth[2], 2.0)
        self.assertEqual(smooth[4], 3.0)


if __name__ == "__main__":
    unittest.main()
