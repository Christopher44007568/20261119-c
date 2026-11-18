import unittest

from lutlib import CubeLUT, GradingPipeline, ToneMapper

SCENE = [
    (0.0, 0.0, 0.0),
    (0.2, 0.4, 0.8),
    (1.0, 1.0, 1.0),
    (2.5, 1.2, 0.3),   # HDR, needs tone mapping
    (0.01, 0.5, 4.0),
]


class TestToneMappingStability(unittest.TestCase):
    """Toggling the LUT must never change the tone-mapped intermediate."""

    def test_toggle_keeps_tone_map(self):
        lut = CubeLUT.identity_3d(5)
        for operator in ("aces", "reinhard", "none"):
            on = GradingPipeline(lut=lut, operator=operator, lut_enabled=True)
            off = GradingPipeline(lut=lut, operator=operator, lut_enabled=False)
            for color in SCENE:
                with self.subTest(operator=operator, color=color):
                    self.assertEqual(on.tone_mapped(color), off.tone_mapped(color))

    def test_identity_lut_matches_lut_off(self):
        lut = CubeLUT.identity_3d(5)
        on = GradingPipeline(lut=lut, lut_enabled=True)
        off = GradingPipeline(lut=lut, lut_enabled=False)
        for color in SCENE:
            for a, b in zip(on.grade_color(color), off.grade_color(color)):
                self.assertAlmostEqual(a, b, places=9)

    def test_output_stays_in_gamut(self):
        lut = CubeLUT.identity_3d(2)
        lut.set(1, 1, 1, (5.0, -2.0, 1.0))  # deliberately out-of-gamut entry
        pipe = GradingPipeline(lut=lut)
        for color in SCENE:
            for channel in pipe.grade_color(color):
                self.assertGreaterEqual(channel, 0.0)
                self.assertLessEqual(channel, 1.0)

    def test_tone_mapper_deterministic(self):
        for color in SCENE:
            self.assertEqual(
                ToneMapper.apply(color, "aces"), ToneMapper.apply(color, "aces")
            )

    def test_lut_actually_changes_colors_when_enabled(self):
        lut = CubeLUT.identity_3d(2)
        lut.set(1, 1, 1, (1.0, 0.5, 0.0))  # pull highlights toward orange
        pipe = GradingPipeline(lut=lut, operator="none")
        graded = pipe.grade_color((0.9, 0.9, 0.9))
        self.assertNotAlmostEqual(graded[1], graded[2], places=3)


if __name__ == "__main__":
    unittest.main()
