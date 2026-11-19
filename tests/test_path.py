import math
import unittest

from sweep.path import Path, PathError


class PathTests(unittest.TestCase):
    def test_zero_length_segments_merged_and_reported(self):
        samples = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 0.0, 0.0),
                   (2.0, 0.0, 0.0)]
        path = Path.from_samples(samples)
        self.assertEqual(len(path.points), 3)
        self.assertEqual(path.merge_report.count, 1)
        self.assertIn(2, path.merge_report.removed)

    def test_all_duplicates_collapse_raises(self):
        with self.assertRaises(PathError):
            Path.from_samples([(0.0, 0.0, 0.0), (0.0, 0.0, 0.0)])

    def test_bend_path_merges_junction_duplicates(self):
        path = Path.straight_bend_straight()
        self.assertGreaterEqual(path.merge_report.count, 2)
        lengths = path.segment_lengths()
        self.assertTrue(all(length > 1e-9 for length in lengths))

    def test_closed_polygon_has_closing_segment(self):
        path = Path.closed_polygon()
        self.assertTrue(path.closed)
        self.assertEqual(len(path.segment_lengths()), len(path.points))

    def test_helix_length(self):
        path = Path.helix(turns=1.0, radius=1.0, pitch=0.0, samples=61)
        self.assertAlmostEqual(path.total_length(), 2.0 * math.pi, places=1)


if __name__ == "__main__":
    unittest.main()
