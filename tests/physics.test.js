"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../physics.js");

const DEFAULT_STATE = { thickness: 320, nFilm: 2.0, angle: 25 };

test("zero thickness degenerates to the bare air/substrate interface", () => {
  let maxDeviation = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let angle = 0; angle <= 85; angle += 0.5) {
    const bare = 0.5 * (
      P.bareReflectance(P.N_AIR, P.N_SUBSTRATE, angle, "s")
      + P.bareReflectance(P.N_AIR, P.N_SUBSTRATE, angle, "p")
    );
    for (let wavelength = 380; wavelength <= 780; wavelength += 10) {
      const value = P.reflectanceAt(wavelength, 0, 2.0, angle);
      maxDeviation = Math.max(maxDeviation, Math.abs(value - bare));
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  assert.ok(maxDeviation < 1e-12, `max deviation ${maxDeviation}`);
  assert.ok(min >= 0 && max <= 1, `range ${min}..${max}`);
});

test("normal incidence stays in the energy range and is polarization-independent", () => {
  let min = Infinity;
  let max = -Infinity;
  let maxPolarizationGap = 0;

  for (let wavelength = 380; wavelength <= 780; wavelength += 0.5) {
    const rs = P.polarizationReflectance(wavelength, 320, 2.0, 0, "s");
    const rp = P.polarizationReflectance(wavelength, 320, 2.0, 0, "p");
    const value = P.reflectanceAt(wavelength, 320, 2.0, 0);
    min = Math.min(min, value);
    max = Math.max(max, value);
    maxPolarizationGap = Math.max(maxPolarizationGap, Math.abs(rs - rp));
  }

  assert.ok(min >= 0 && max <= 1, `range ${min}..${max}`);
  assert.ok(maxPolarizationGap < 1e-12, `polarization gap ${maxPolarizationGap}`);
});

test("grazing incidence remains finite, bounded, and reflective", () => {
  const range = P.energyRange({ thickness: 320, nFilm: 2.0, angle: 89, count: 401 });
  assert.ok(Number.isFinite(range.min) && Number.isFinite(range.max));
  assert.ok(range.min >= 0 && range.max <= 1, `range ${range.min}..${range.max}`);
  assert.ok(range.min > 0.9, `expected strong grazing reflection, got ${range.min}`);
});

test("displayed color changes continuously with angle", () => {
  const filmContinuity = P.colorContinuity({
    thickness: 320,
    nFilm: 2.0,
    start: 0,
    end: 85,
    step: 0.25,
    count: 161,
  });
  const bareContinuity = P.colorContinuity({
    thickness: 0,
    nFilm: 2.0,
    start: 0,
    end: 85,
    step: 0.25,
    count: 121,
  });

  assert.ok(filmContinuity <= 8, `film color step ${filmContinuity}`);
  assert.ok(bareContinuity <= 4, `bare color step ${bareContinuity}`);
});

test("guardrail suite passes across the supported parameter envelope", () => {
  const indices = [1.0, 1.2, 1.38, 1.8, 2.2, 2.5];
  const thicknesses = [0, 50, 320, 800, 1200];
  for (const nFilm of indices) {
    for (const thickness of thicknesses) {
      const result = P.runValidation({ thickness, nFilm, angle: 25 });
      const failed = result.checks.filter((check) => !check.pass);
      assert.ok(
        result.allPass,
        `n=${nFilm}, d=${thickness}: ${failed.map((check) => check.label).join(", ")}`,
      );
    }
  }
});

test("sampling error converges toward the 0.33 nm reference", () => {
  const result = P.compareSampling(DEFAULT_STATE);
  const byDensity = new Map(result.rows.map((row) => [row.count, row]));
  const sparse = byDensity.get(16);
  const medium = byDensity.get(61);
  const dense = byDensity.get(481);

  assert.ok(sparse.deltaE > medium.deltaE, "16-point error should exceed 61-point error");
  assert.ok(medium.deltaE >= dense.deltaE, "61-point error should not beat 481-point error");
  assert.ok(dense.deltaE < 0.01, `dense sampling error ${dense.deltaE}`);
  assert.ok(result.referenceCount === 1201);
});

test("increasing view angle moves the tracked interference peak toward blue", () => {
  const current = P.sampleSpectrum({ ...DEFAULT_STATE, count: 481 });
  const normal = P.sampleSpectrum({ ...DEFAULT_STATE, angle: 0, count: 481 });
  const currentPeaks = P.detectPeaks(current.wavelengths, current.reflectance);
  const normalPeaks = P.detectPeaks(normal.wavelengths, normal.reflectance);
  const normalMain = normalPeaks.reduce((a, b) => (a.reflectance >= b.reflectance ? a : b));
  const tracked = currentPeaks.reduce((best, peak) => (
    Math.abs(peak.wavelength - normalMain.wavelength)
      < Math.abs(best.wavelength - normalMain.wavelength)
      ? peak
      : best
  ));

  assert.ok(tracked.wavelength < normalMain.wavelength);
  assert.ok(normalMain.wavelength - tracked.wavelength < 60);
});
