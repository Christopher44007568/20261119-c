import assert from "node:assert/strict";
import test from "node:test";
import {
  NEUTRAL_TEXEL,
  bakeNormalMap,
  decodeNormal,
  encodeNormal,
} from "../js/bake.js";
import { createHighLowModel } from "../js/geometry.js";
import {
  buildBVH,
  closestPointOnTriangle,
  dot,
  normalize,
  rayTriangle,
} from "../js/math.js";
import { createKnownFixture, runValidation } from "../js/validation.js";

function triangle(na = [0, 0, 1]) {
  return {
    a: [0, 0, 0],
    b: [1, 0, 0],
    c: [0, 1, 0],
    na,
    nb: na,
    nc: na,
  };
}

test("Möller-Trumbore ray hit reports perspective barycentrics", () => {
  const hit = rayTriangle([0.2, 0.3, 1], [0, 0, -1], triangle());
  assert.ok(hit);
  assert.ok(Math.abs(hit.t - 1) < 1e-9);
  assert.ok(Math.abs(hit.u - 0.2) < 1e-9);
  assert.ok(Math.abs(hit.v - 0.3) < 1e-9);
  assert.ok(Math.abs(hit.w - 0.5) < 1e-9);
});

test("closest point clamps to the correct triangle feature", () => {
  const inside = closestPointOnTriangle([0.2, 0.2, 2], triangle());
  assert.ok(Math.abs(inside.point[0] - 0.2) < 1e-9);
  assert.ok(Math.abs(inside.point[1] - 0.2) < 1e-9);
  assert.equal(inside.point[2], 0);
  assert.equal(inside.distanceSq, 4);

  const vertex = closestPointOnTriangle([-2, -1, 0], triangle());
  assert.deepEqual(vertex.point, [0, 0, 0]);
});

test("tangent-space encode/decode preserves neutral and signed directions", () => {
  assert.deepEqual(encodeNormal([0, 0, 1]), NEUTRAL_TEXEL.slice(0, 3));
  const source = normalize([-0.32, 0.18, 0.93]);
  const decoded = decodeNormal(...encodeNormal(source));
  assert.ok(dot(source, decoded) > 0.9999);
});

test("known high/low fixture validates canonical and mirrored TBN", () => {
  const fixture = createKnownFixture();
  assert.ok(fixture.leftEncoded.rgb[0] < 128);
  assert.ok(fixture.mirroredEncoded.rgb[0] > 128);
  assert.equal(fixture.mirrored.handedness, -1);
  assert.ok(fixture.leftEncoded.vector[1] > 0);
  assert.ok(Math.abs(fixture.leftEncoded.vector[1] - fixture.mirroredEncoded.vector[1]) < 1e-9);
});

test("high-to-low cage bake repairs penetration and fills misses neutral", () => {
  const model = createHighLowModel();
  const bvh = buildBVH(model.highTriangles);
  const result = bakeNormalMap({
    model,
    bvh,
    resolution: 128,
    cageDistance: 0.11,
    projection: "cage",
    repairPenetration: true,
  });

  assert.ok(model.highTriangleCount > 4000);
  assert.equal(model.lowTriangleCount, 252);
  assert.ok(result.metrics.hitRate > 0.98);
  assert.ok(result.metrics.missCount > 0);
  assert.ok(result.metrics.falseHitCount > 0);
  assert.ok(result.metrics.penetrationCount > 0);
  assert.equal(result.metrics.repairedCount, result.metrics.penetrationCount);
  assert.ok(result.metrics.seamCount > 0);
  assert.ok(result.metrics.mirroredCount > 0);

  for (let index = 0; index < result.missMask.length; index += 1) {
    if (!result.missMask[index]) continue;
    const offset = index * 4;
    assert.deepEqual(
      [
        result.texture[offset],
        result.texture[offset + 1],
        result.texture[offset + 2],
        result.texture[offset + 3],
      ],
      NEUTRAL_TEXEL,
    );
  }
});

test("nearest-surface projection removes penetration and reaches the surface", () => {
  const model = createHighLowModel();
  const bvh = buildBVH(model.highTriangles);
  const result = bakeNormalMap({
    model,
    bvh,
    resolution: 96,
    cageDistance: 0.11,
    projection: "nearest",
    repairPenetration: false,
  });

  assert.equal(result.metrics.penetrationCount, 0);
  assert.equal(result.metrics.hitRate, 1);
  assert.ok(result.metrics.meanError < 5);
});

test("validation passes mirror correction and fails when the mirrored island is sampled unflipped", () => {
  const model = createHighLowModel();
  const bvh = buildBVH(model.highTriangles);
  const result = bakeNormalMap({
    model,
    bvh,
    resolution: 96,
    cageDistance: 0.11,
    projection: "cage",
    repairPenetration: true,
  });

  const passing = runValidation(result, true);
  const failing = runValidation(result, false);
  assert.equal(passing.allPass, true);
  assert.equal(failing.allPass, false);
  assert.equal(failing.tests.find((entry) => entry.key === "mirror").pass, false);
});
