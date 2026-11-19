import math
import unittest

from sweep.section import (
    SectionError,
    circle_section,
    polygon_area,
    rectangle_section,
)


class SectionTests(unittest.TestCase):
    def test_circle_area_and_winding(self):
        section = circle_section(1.0, 64)
        self.assertGreater(polygon_area(list(section.points)), 0.0)
        self.assertAlmostEqual(section.area, math.pi, places=1)

    def test_cw_input_is_flipped_to_ccw(self):
        section = circle_section(1.0, 12)
        reversed_points = tuple(reversed(section.points))
        from sweep.section import Section

        fixed = Section(reversed_points)
        self.assertGreater(polygon_area(list(fixed.points)), 0.0)

    def test_degenerate_section_rejected(self):
        with self.assertRaises(SectionError):
            circle_section(0.0, 12)
        with self.assertRaises(SectionError):
            rectangle_section(1.0, 0.0)

    def test_positive_scale_required(self):
        section = circle_section(1.0, 8)
        with self.assertRaises(SectionError):
            section.scaled(0.0)
        with self.assertRaises(SectionError):
            section.scaled(-1.5)

    def test_max_dimension_constraint(self):
        section = rectangle_section(1.0, 1.0)
        section.scaled(2.0, max_dimension=2.0)
        with self.assertRaises(SectionError):
            section.scaled(2.1, max_dimension=2.0)


if __name__ == "__main__":
    unittest.main()
