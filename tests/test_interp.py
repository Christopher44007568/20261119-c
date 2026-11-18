import unittest

from lutlib import CubeLUT, apply_lut

METHODS = ("tetrahedral", "trilinear")


def assert_color_close(tc, actual, expected, places=9):
    tc.assertEqual(len(actual), 3)
    for a, e in zip(actual, expected):
        tc.assertAlmostEqual(a, e, places=places)


def permutation_lut(size, order):
    """3D LUT whose output channels are a permutation of the input."""
    n = size - 1
    data = []
    for b in range(size):
        for g in range(size):
            for r in range(size):
                unit = (r / n, g / n, b / n)
                data.append(tuple(unit[i] for i in order))
    return CubeLUT(size=size, is_3d=True, data=data)


class TestIdentityReference(unittest.TestCase):
    """Identity LUTs must reproduce their input at arbitrary points."""

    def test_identity_1d(self):
        lut = CubeLUT.identity_1d(17)
        for t in (0.0, 0.13, 0.5, 0.9375, 1.0):
            assert_color_close(self, apply_lut(lut, (t, t, t)), (t, t, t))

    def test_identity_3d(self):
        lut = CubeLUT.identity_3d(5)
        colors = [
            (0.0, 0.0, 0.0),
            (1.0, 1.0, 1.0),
            (0.3, 0.5, 0.7),
            (0.9, 0.1, 0.4),
            (0.13, 0.77, 0.29),
        ]
        for method in METHODS:
            for color in colors:
                with self.subTest(method=method, color=color):
                    assert_color_close(self, apply_lut(lut, color, method), color)


class TestPermutationReference(unittest.TestCase):
    """Channel permutation is linear, so interpolation must match exactly."""

    def test_channel_swap(self):
        order = (2, 0, 1)  # out = (b, r, g)
        lut = permutation_lut(4, order)
        colors = [(0.2, 0.4, 0.6), (0.0, 1.0, 0.5), (0.83, 0.17, 0.41)]
        for method in METHODS:
            for color in colors:
                expected = (color[2], color[0], color[1])
                with self.subTest(method=method, color=color):
                    assert_color_close(self, apply_lut(lut, color, method), expected)


class TestNonUniformDomain(unittest.TestCase):
    """DOMAIN_MIN/MAX define the mapping into the lattice; clamp outside."""

    def setUp(self):
        self.lut = CubeLUT.identity_3d(4)
        self.lut.domain_min = (0.1, 0.2, 0.3)
        self.lut.domain_max = (0.9, 0.8, 0.7)

    def test_domain_endpoints(self):
        for method in METHODS:
            assert_color_close(
                self, apply_lut(self.lut, (0.1, 0.2, 0.3), method), (0.0, 0.0, 0.0)
            )
            assert_color_close(
                self, apply_lut(self.lut, (0.9, 0.8, 0.7), method), (1.0, 1.0, 1.0)
            )
            assert_color_close(
                self, apply_lut(self.lut, (0.5, 0.5, 0.5), method), (0.5, 0.5, 0.5)
            )

    def test_interior_reference(self):
        # Linear ramp reference: out = (c - min) / (max - min).
        color = (0.3, 0.65, 0.44)
        expected = ((0.3 - 0.1) / 0.8, (0.65 - 0.2) / 0.6, (0.44 - 0.3) / 0.4)
        for method in METHODS:
            assert_color_close(self, apply_lut(self.lut, color, method), expected)

    def test_boundary_clamping(self):
        for method in METHODS:
            assert_color_close(
                self, apply_lut(self.lut, (-1.0, 0.5, 99.0), method), (0.0, 0.5, 1.0)
            )


class TestNeutralColors(unittest.TestCase):
    """Grays on the neutral axis must stay neutral for neutral-preserving LUTs."""

    def test_identity_keeps_grays_exact(self):
        lut = CubeLUT.identity_3d(3)
        for g in (0.0, 0.25, 0.5, 0.75, 1.0):
            for method in METHODS:
                out = apply_lut(lut, (g, g, g), method)
                assert_color_close(self, out, (g, g, g), places=12)

    def test_contrast_lut_keeps_grays_neutral(self):
        # S-curve per channel: non-linear, but maps gray -> same gray.
        size = 9
        n = size - 1

        def curve(x):
            return x * x * (3.0 - 2.0 * x)  # smoothstep, keeps r==g==b on axis

        data = [
            (curve(r / n), curve(g / n), curve(b / n))
            for b in range(size)
            for g in range(size)
            for r in range(size)
        ]
        lut = CubeLUT(size=size, is_3d=True, data=data)
        for g in (0.1, 0.3, 0.5, 0.7, 0.9):
            out = apply_lut(lut, (g, g, g), "tetrahedral")
            self.assertAlmostEqual(out[0], out[1], places=12)
            self.assertAlmostEqual(out[1], out[2], places=12)


if __name__ == "__main__":
    unittest.main()
