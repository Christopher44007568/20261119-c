import test from "node:test";
import assert from "node:assert/strict";
import {
  makeSphere,
  makeOpenSheet,
  meshStats,
  faceVertices,
} from "../src/geometry.js";
import {
  windingNumber,
  classifyQuery,
  closestPointOnTriangle,
  triangleSolidAngle,
} from "../src/winding.js";
import {
  compareClosedSphere,
  inspectOpenSheet,
  runBuiltInBenchmarks,
} from "../src/benchmark.js";

const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
};

test("closed sphere has W = 1 inside and W = 0 outside", () => {
  const sphere = makeSphere();
  closeTo(windingNumber(sphere, [0, 0, 0]).winding, 1, 1e-8);
  closeTo(windingNumber(sphere, [1.5, 0.2, -0.3]).winding, 0, 1e-8);
  const inside = windingNumber(sphere, [0.25, -0.2, 0.15]);
  closeTo(inside.solidAngle, 4 * Math.PI, 1e-8);
  closeTo(inside.solidAngle / (4 * Math.PI), inside.winding, 1e-14);
  assert.equal(meshStats(sphere).openEdges, 0);
});

test("flipped orientation changes signed W without changing |W| containment", () => {
  const outward = makeSphere();
  const inward = makeSphere({ flipped: true });
  const point = [0.2, -0.1, 0.3];
  closeTo(windingNumber(outward, point).winding, 1, 1e-8);
  closeTo(windingNumber(inward, point).winding, -1, 1e-8);
  closeTo(
    Math.abs(windingNumber(inward, point).winding),
    Math.abs(windingNumber(outward, point).winding),
    1e-8,
  );
  assert.equal(meshStats(inward).volume < 0, true);
});

test("closed and flipped spheres match analytic sphere containment", () => {
  const audit = runBuiltInBenchmarks();
  assert.equal(audit.closed.containmentAgreement, 1);
  assert.equal(audit.flipped.containmentAgreement, 1);
  assert.equal(audit.flipped.signedAgreement, 1);
  assert.ok(audit.closed.maxWindingError < 1e-10);
  assert.ok(audit.flipped.maxWindingError < 1e-10);
});

test("points inside the bounding box but outside the sphere are outside", () => {
  const sphere = makeSphere();
  const points = [
    [0.6, 0.6, 0.6],
    [0.99, 0.99, 0.99],
    [0.4, 0.4, 0.9],
  ];
  for (const point of points) {
    assert.ok(point.every((coordinate) => Math.abs(coordinate) <= 1));
    assert.ok(Math.hypot(...point) > 1);
    const result = windingNumber(sphere, point);
    const classification = classifyQuery(result);
    assert.equal(classification.kind, "outside");
    closeTo(result.winding, 0, 1e-8);
  }
});

test("vertex, edge, and face-interior points use the surface convention", () => {
  const sphere = makeSphere();
  const [a, b, c] = faceVertices(sphere, 0);
  const edgeMidpoint = [
    (a[0] + b[0]) * 0.5,
    (a[1] + b[1]) * 0.5,
    (a[2] + b[2]) * 0.5,
  ];
  const faceCenter = [
    (a[0] + b[0] + c[0]) / 3,
    (a[1] + b[1] + c[1]) / 3,
    (a[2] + b[2] + c[2]) / 3,
  ];
  for (const point of [a, edgeMidpoint, faceCenter]) {
    const result = windingNumber(sphere, point);
    const classification = classifyQuery(result, { surfaceEpsilon: 0.008 });
    assert.ok(result.nearestDistance <= 1e-7);
    assert.equal(classification.kind, "surface");
    assert.equal(classification.containment, null);
  }
});

test("point-triangle distance is exact at an edge and face interior", () => {
  const a = [0, 0, 0];
  const b = [1, 0, 0];
  const c = [0, 1, 0];
  closeTo(closestPointOnTriangle([0.5, 0, 0], a, b, c).distance, 0);
  closeTo(closestPointOnTriangle([0.2, 0.3, 0], a, b, c).distance, 0);
  closeTo(closestPointOnTriangle([0.2, 0.3, 2], a, b, c).distance, 2);
  const point = [0.2, 0.3, 2];
  closeTo(
    triangleSolidAngle(point, a, b, c) + triangleSolidAngle(point, b, a, c),
    0,
    1e-12,
  );
});

test("open sheet is fractional and changes sign across its two sides", () => {
  const sheet = makeOpenSheet();
  const above = windingNumber(sheet, [0.2, 0.24, -0.15]);
  const below = windingNumber(sheet, [0.2, -0.2, -0.15]);
  assert.ok(Math.abs(above.winding) > 0.05 && Math.abs(above.winding) < 0.95);
  assert.equal(Math.sign(above.winding), -Math.sign(below.winding));
  const summary = inspectOpenSheet(sheet);
  assert.ok(summary.tested > 0);
  assert.equal(summary.fractional, summary.tested);
  assert.equal(summary.signPairs, summary.tested);
  assert.equal(summary.analyticEquivalent, false);
});

test("open sheet boundary points are surface, not bounding-box containment", () => {
  const sheet = makeOpenSheet();
  const onSheet = windingNumber(sheet, [0, 0.075, 0]);
  assert.equal(classifyQuery(onSheet, { surfaceEpsilon: 0.008 }).kind, "surface");
  const inBoundingBoxButFar = windingNumber(sheet, [1.1, 1.1, 1.1]);
  assert.equal(classifyQuery(inBoundingBoxButFar, { surfaceEpsilon: 0.008 }).kind, "outside");
});

test("deleting faces opens the mesh and changes the winding field", () => {
  const sphere = makeSphere();
  const before = windingNumber(sphere, [0, 1.3, 0]);
  const removed = [];
  for (let face = 0; face < sphere.removed.length; face += 1) {
    const vertices = faceVertices(sphere, face);
    const y = (vertices[0][1] + vertices[1][1] + vertices[2][1]) / 3;
    if (y > 0.9) {
      sphere.removed[face] = 1;
      removed.push(face);
    }
  }
  assert.ok(removed.length > 5);
  const after = windingNumber(sphere, [0, 1.3, 0]);
  assert.ok(meshStats(sphere).openEdges > 0);
  assert.ok(Math.abs(after.winding - before.winding) > 0.02);
  assert.notEqual(after.winding, before.winding);
});

test("analytic comparison skips the surface uncertainty band", () => {
  const sphere = makeSphere();
  const report = compareClosedSphere(sphere, { samples: 80, surfaceEpsilon: 0.02 });
  assert.ok(report.tested > 0);
  assert.equal(report.containmentAgreement, 1);
  assert.ok(report.skipped > 0);
});
