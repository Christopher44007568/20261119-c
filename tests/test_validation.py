"""Numerical validation for the direct volume ray caster."""

import unittest

import numpy as np

from dvr import (
    RayCaster,
    TransferFunction,
    make_nested_shells,
    make_sparse_blobs,
    make_uniform,
)
from dvr.raycaster import Camera

REF = 1.0 / 64.0
ALPHA = 0.025


def analytic_transmittance(alpha, ref_step, length):
    kappa = -np.log(1.0 - alpha) / ref_step
    return np.exp(-kappa * length)


class UniformTransmittanceTest(unittest.TestCase):
    def setUp(self):
        self.tf = TransferFunction.constant((0.0, 0.0, 0.0), ALPHA, ref_step=REF)
        self.vol = make_uniform(64, 1.0)
        self.cam = Camera(position=np.array([0.5, 0.5, 2.0]), fov_y_deg=30.0)

    def measure(self, step, **kw):
        rc = RayCaster(self.vol, self.tf, step=step, background=(1, 1, 1),
                       early_term=0.0, **kw)
        res = rc.render(32, 32, self.cam)
        return res.transmittance[16, 16]

    def test_matches_analytic(self):
        t_ana = analytic_transmittance(ALPHA, REF, 1.0)
        for mult in (0.5, 1.0, 2.0, 4.0):
            t_num = self.measure(REF * mult)
            self.assertAlmostEqual(t_num, t_ana, delta=2e-3, msg=f"step x{mult}")

    def test_step_invariance(self):
        vals = [self.measure(REF * m) for m in (0.5, 1.0, 2.0, 4.0)]
        spread = max(vals) - min(vals)
        self.assertLess(spread, 1e-3, "transmittance must not depend on step")

    def test_clipping_box_path_length(self):
        t_ana = analytic_transmittance(ALPHA, REF, 0.5)
        t_num = self.measure(REF, clip_min=(0.0, 0.0, 0.25),
                             clip_max=(1.0, 1.0, 0.75))
        self.assertAlmostEqual(t_num, t_ana, delta=2e-3)


class OcclusionTest(unittest.TestCase):
    def setUp(self):
        # dense shell/core -> opaque red, thin gap -> transparent green
        self.tf = TransferFunction(
            [
                (0.0, 0, 0, 0, 0.0),
                (0.05, 0, 1, 0, 0.0),
                (0.06, 0, 1, 0, 0.9),
                (0.9, 1, 0, 0, 0.95),
                (1.0, 1, 0, 0, 0.95),
            ],
            ref_step=1.0 / 96.0,
        )
        self.cam = Camera(position=np.array([0.5, 0.5, 2.2]), fov_y_deg=35.0)

    def test_core_hidden_by_outer_shell(self):
        res = RayCaster(make_nested_shells(96), self.tf, step=1.0 / 96.0).render(64, 64, self.cam)
        center = res.image[32, 32]
        self.assertGreater(center[0], 0.9, "outer red shell should dominate")
        self.assertLess(center[1], 0.05, "green core must be occluded")

    def test_removing_core_changes_nothing(self):
        full = RayCaster(make_nested_shells(96), self.tf, step=1.0 / 96.0).render(64, 64, self.cam)
        hollow = RayCaster(
            make_nested_shells(96, densities=(0.9, 0.05, 0.0)), self.tf, step=1.0 / 96.0
        ).render(64, 64, self.cam)
        err = np.abs(full.image - hollow.image).max()
        self.assertLess(err, 0.02, "occluded core must not affect the image")


class EmptySpaceSkippingTest(unittest.TestCase):
    def setUp(self):
        self.tf = TransferFunction.grayscale(ref_step=1.0 / 128.0)
        self.vol = make_sparse_blobs(128)
        self.cam = Camera(position=np.array([0.5, 0.5, 2.5]), fov_y_deg=40.0)

    def test_image_error_and_sample_counts(self):
        off = RayCaster(self.vol, self.tf, step=1.0 / 128.0).render(96, 96, self.cam)
        on = RayCaster(self.vol, self.tf, step=1.0 / 128.0,
                       ess_enabled=True).render(96, 96, self.cam)
        err = np.abs(off.image - on.image).max()
        self.assertLess(err, 1e-3, f"ESS changed the image (err={err})")
        ratio = on.total_samples / off.total_samples
        self.assertLess(ratio, 0.6, f"ESS saved too little ({ratio:.1%})")
        self.assertGreater(on.total_samples, 0)
        print(f"\nESS: {off.total_samples} -> {on.total_samples} samples "
              f"({ratio:.1%}), max image err {err:.2e}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
