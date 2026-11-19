import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticTransmittance,
  convergenceSeries,
  guidedUpsample,
  marchHomogeneousTransmittance,
  upsampleDepthWeight,
  validationReport,
} from "../src/validation.mjs";

test("homogeneous analytic transmittance agrees at every step size", () => {
  const analytic = analyticTransmittance(0.24, 0.55, 7.1);
  for (const steps of [8, 16, 32, 64, 128, 256]) {
    const marched = marchHomogeneousTransmittance(steps, 0.24, 0.55, 7.1);
    assert.ok(Math.abs(marched - analytic) < 1e-12, `error at ${steps} steps`);
  }
});

test("spot scattering converges as step count increases", () => {
  const series = convergenceSeries();
  for (let i = 1; i < series.length; i++) {
    assert.ok(
      series[i].error < series[i - 1].error,
      `${series[i].steps} steps should improve on ${series[i - 1].steps}`,
    );
  }
  assert.ok(series.at(-1).error < 2e-4);
});

test("validation report exposes zero transmittance error", () => {
  const report = validationReport(64);
  assert.ok(report.transmittanceError < 1e-12);
  assert.ok(report.convergenceError < 5e-4);
});

test("depth-guided weights reject background behind a foreground occluder", () => {
  const foreground = 9.4;
  const backgroundBehindWall = 30;
  const sameSurface = 9.41;
  assert.equal(upsampleDepthWeight(foreground, sameSurface), 1);
  assert.equal(upsampleDepthWeight(foreground, backgroundBehindWall), 0);

  const taps = [
    { bilinearWeight: 0.25, depthWeight: 1, color: 0.08 },
    { bilinearWeight: 0.25, depthWeight: 1, color: 0.08 },
    { bilinearWeight: 0.25, depthWeight: 0, color: 8.0 },
    { bilinearWeight: 0.25, depthWeight: 0, color: 8.0 },
  ];
  const bilinearLeak = taps.reduce((sum, tap) => sum + tap.bilinearWeight * tap.color, 0);
  const guided = guidedUpsample(taps);
  assert.ok(bilinearLeak > 4);
  assert.ok(Math.abs(guided.color - 0.08) < 1e-9);
  assert.equal(guided.weightSum, 0.5);
});
