import math
import unittest

from sweep.diagnostics import analyze_normal_flips
from sweep.frame import frame_orthogonality_error, parallel_transport_frames
from sweep.path import Path
from sweep.vector import angle_between, cross, dot


class FrameTests(unittest.TestCase):
    def test_frames_are_orthonormal_and_right_handed(self):
        path = Path.helix()
        frames, _ = parallel_transport_frames(path.points, path.closed)
        self.assertLess(frame_orthogonality_error(frames), 1e-10)

    def test_straight_path_keeps_frame_constant(self):
        path = Path.from_samples(
            [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (2.0, 0.0, 0.0)]
        )
        frames, _ = parallel_transport_frames(path.points, False)
        self.assertLess(angle_between(frames[0].normal, frames[-1].normal), 1e-12)

    def test_closed_path_seam_has_no_residual_twist(self):
        path = Path.closed_polygon()
        frames, twist = parallel_transport_frames(path.points, True)
        # Distributed correction must close the normal field exactly.
        first, last = frames[0], frames[-1]
        turn = angle_between(last.tangent, first.tangent)
        axis = cross(last.tangent, first.tangent)
        from sweep.vector import safe_normalize, rotate

        axis = safe_normalize(axis)
        signed = turn
        if axis is not None and dot(axis, last.binormal) < 0:
            signed = -signed
        transported = rotate(first.normal, last.binormal, -signed)
        self.assertLess(angle_between(transported, last.normal), 1e-10)

    def test_parallel_transport_never_flips_but_frenet_does(self):
        path = Path.s_curve()
        frames, _ = parallel_transport_frames(path.points, False)
        report = analyze_normal_flips(path, frames)
        self.assertEqual(report.pt_flip_count, 0)
        self.assertGreater(report.frenet_flip_count, 0)


if __name__ == "__main__":
    unittest.main()
