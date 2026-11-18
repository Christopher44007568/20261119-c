"""Fast sanity tests: python3 -m pytest tests/ or python3 tests/test_brdf.py."""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from brdf.integrator import integrate_brdf, generate_lut, mirror_limit
from brdf.reference import integrate_brdf_reference
from brdf.evaluate import sample_lut


def test_mirror_limit_exact_below_threshold():
    nv = np.array([0.0, 0.25, 0.5, 0.9, 1.0])
    a, b = integrate_brdf(nv, np.zeros(5))
    am, bm = mirror_limit(nv)
    assert np.allclose(a, am) and np.allclose(b, bm)


def test_grazing_limit_is_finite_and_continuous():
    # NdotV -> 0 is a removable singularity: values must be finite and
    # converge to a constant (not to 0/1).
    nv = np.array([1e-2, 1e-3, 1e-4, 0.0])
    a, b = integrate_brdf(nv, np.full(4, 0.5), 4096)
    assert np.all(np.isfinite(a)) and np.all(np.isfinite(b))
    assert abs(a[-1] - a[-2]) < 5e-3 and abs(b[-1] - b[-2]) < 5e-3
    assert 0.6 < a[-1] < 0.8  # asymptotic limit ~0.701 at roughness 0.5


def test_integrator_matches_reference():
    nv = np.array([0.05, 0.3, 0.7, 0.95])
    rr = np.array([0.1, 0.4, 0.6, 0.9])
    ai, bi = integrate_brdf(nv, rr, 8192)
    ar, br = integrate_brdf_reference(nv, rr)
    assert np.max(np.abs(ai - ar)) < 5e-3
    assert np.max(np.abs(bi - br)) < 5e-3


def test_energy_not_exceeded():
    nv, rr = np.meshgrid(np.linspace(0.01, 1, 9), np.linspace(0.01, 1, 9))
    a, b = integrate_brdf(nv, rr, 4096)
    assert np.all(a + b <= 1.0 + 1e-2)  # single-scattering: A+B <= 1


def test_lut_bilinear_continuity():
    lut = generate_lut(32, 2048)
    r = np.linspace(0.01, 0.99, 2000)
    ab = sample_lut(lut, np.full_like(r, 0.5), r)
    jumps = np.max(np.abs(np.diff(ab, axis=0)))
    assert jumps < 0.02  # no texel discontinuities across roughness


if __name__ == "__main__":
    for name, fn in sorted(list(globals().items())):
        if name.startswith("test_"):
            fn()
            print("ok", name)
