import os
import tempfile
import unittest

from lutlib import CubeLUT, CubeParseError, load_cube, parse_cube


class TestParseValid(unittest.TestCase):
    def test_minimal_1d(self):
        lut = parse_cube("LUT_1D_SIZE 2\n0 0 0\n1 1 1\n")
        self.assertFalse(lut.is_3d)
        self.assertEqual(lut.size, 2)
        self.assertEqual(lut.domain_min, (0.0, 0.0, 0.0))
        self.assertEqual(lut.domain_max, (1.0, 1.0, 1.0))

    def test_full_header_and_comments(self):
        text = (
            "# a comment\n"
            'TITLE "demo"\n'
            "LUT_3D_SIZE 2\n"
            "DOMAIN_MIN 0.1 0.2 0.3\n"
            "DOMAIN_MAX 0.9 0.8 0.7\n"
            "\n"
            "0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n"
        )
        lut = parse_cube(text)
        self.assertTrue(lut.is_3d)
        self.assertEqual(lut.title, "demo")
        self.assertEqual(lut.domain_min, (0.1, 0.2, 0.3))
        self.assertEqual(lut.domain_max, (0.9, 0.8, 0.7))
        self.assertEqual(lut.get(1, 0, 1), (1.0, 0.0, 1.0))  # red-fastest order

    def test_roundtrip(self):
        lut = CubeLUT.identity_3d(4)
        lut.domain_min = (0.05, 0.0, 0.0)
        lut.domain_max = (0.95, 1.0, 1.0)
        lut.title = "rt"
        clone = parse_cube(lut.to_cube())
        self.assertEqual(clone.data, lut.data)
        self.assertEqual(clone.domain_min, lut.domain_min)
        self.assertEqual(clone.domain_max, lut.domain_max)
        self.assertEqual(clone.title, "rt")


class TestParseErrors(unittest.TestCase):
    def assert_error_line(self, text, line_no):
        with self.assertRaises(CubeParseError) as ctx:
            parse_cube(text)
        self.assertEqual(ctx.exception.line_no, line_no, str(ctx.exception))

    def test_unknown_keyword_line_number(self):
        self.assert_error_line("LUT_1D_SIZE 2\n0 0 0\nGAMMA 2.2\n1 1 1\n", 3)

    def test_data_before_size(self):
        self.assert_error_line("0 0 0\nLUT_1D_SIZE 2\n1 1 1\n", 1)

    def test_truncated_table_reports_last_line(self):
        text = "LUT_3D_SIZE 2\n" + "0 0 0\n" * 7  # 7 of 8 rows
        self.assert_error_line(text, 8)

    def test_extra_rows_rejected(self):
        text = "LUT_1D_SIZE 2\n0 0 0\n1 1 1\n0.5 0.5 0.5\n"
        self.assert_error_line(text, 4)

    def test_bad_row_arity(self):
        self.assert_error_line("LUT_1D_SIZE 2\n0 0\n1 1 1\n", 2)

    def test_non_numeric(self):
        self.assert_error_line("LUT_1D_SIZE 2\n0 x 0\n1 1 1\n", 2)

    def test_missing_size(self):
        self.assert_error_line("0 0 0\n", 1)

    def test_domain_after_data(self):
        self.assert_error_line("LUT_1D_SIZE 2\n0 0 0\nDOMAIN_MIN 0 0 0\n1 1 1\n", 3)

    def test_domain_max_not_above_min(self):
        text = "LUT_1D_SIZE 2\nDOMAIN_MIN 1 0 0\nDOMAIN_MAX 0 1 1\n0 0 0\n1 1 1\n"
        with self.assertRaises(CubeParseError):
            parse_cube(text)

    def test_atomic_load_no_partial_table(self):
        # A file that fails late must not leave a usable LUT behind.
        text = "LUT_1D_SIZE 3\n0 0 0\n0.5 0.5 0.5\nBROKEN\n"
        with tempfile.NamedTemporaryFile("w", suffix=".cube", delete=False) as fh:
            fh.write(text)
            path = fh.name
        try:
            with self.assertRaises(CubeParseError) as ctx:
                load_cube(path)
            self.assertEqual(ctx.exception.line_no, 4)
            self.assertIn(path, str(ctx.exception))
        finally:
            os.unlink(path)


class TestEditing(unittest.TestCase):
    def test_set_get_3d(self):
        lut = CubeLUT.identity_3d(3)
        lut.set(2, 1, 0, (0.9, 0.1, 0.2))
        self.assertEqual(lut.get(2, 1, 0), (0.9, 0.1, 0.2))
        clone = parse_cube(lut.to_cube())
        self.assertEqual(clone.get(2, 1, 0), (0.9, 0.1, 0.2))

    def test_1d_index_requires_single_coordinate(self):
        lut = CubeLUT.identity_1d(4)
        with self.assertRaises(ValueError):
            lut.get(1, 2, 1)


if __name__ == "__main__":
    unittest.main()
