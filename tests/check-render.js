"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const tracer = require("../scripts/lib/cpu-tracer");

const root = path.resolve(__dirname, "..");

function assertFiniteBand(options) {
  const width = 72;
  const height = 44;
  const result = tracer.renderBand({
    width,
    height,
    startRow: 0,
    rows: height,
    samples: 8,
    camera: options.camera,
    scene: { metalRoughness: 0, glossyRoughness: 0 }
  });
  assert.equal(result.accum.length, width * height * 3);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of result.accum) {
    assert.equal(Number.isFinite(value), true, "Renderer produced a non-finite pixel");
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  assert.ok(minimum >= 0);
  assert.ok(maximum <= 64 * 8 + 1e-4);
  return { minimum, maximum };
}

const normal = assertFiniteBand({ camera: {} });
const grazing = assertFiniteBand({
  camera: {
    yaw: 0.43,
    pitch: 0.002,
    distance: 3.1,
    target: [0.15, 0.08, -0.2]
  }
});

const metricsPath = path.join(root, "assets", "metrics.json");
assert.equal(fs.existsSync(metricsPath), true, "Missing assets/metrics.json");
const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
assert.equal(metrics.referenceSamples, 2048);
assert.deepEqual(metrics.checkpoints.map((item) => item.samples), [10, 100, 1000]);
assert.equal(metrics.checkpoints.every((item) => item.finite), true);
assert.ok(metrics.checkpoints[0].relativeL1 > metrics.checkpoints[1].relativeL1);
assert.ok(metrics.checkpoints[1].relativeL1 > metrics.checkpoints[2].relativeL1);

for (const file of ["reference.png", "samples-010.png", "samples-100.png", "samples-1000.png"]) {
  const fullPath = path.join(root, "assets", file);
  assert.equal(fs.existsSync(fullPath), true, `Missing ${file}`);
  const header = fs.readFileSync(fullPath).subarray(0, 24);
  assert.equal(header.subarray(1, 4).toString("ascii"), "PNG");
  assert.ok(header.readUInt32BE(16) >= 320);
  assert.ok(header.readUInt32BE(20) >= 200);
}

console.log(
  "Render checks: zero-roughness and grazing rays are finite; " +
  `linear RMSE converges ${metrics.checkpoints.map((item) => item.rmse.toFixed(4)).join(" → ")}.`
);
