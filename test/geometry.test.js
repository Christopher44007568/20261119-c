import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFineMesh,
  cycleEdges,
  deformPoint,
  meanValueCoordinates,
  validateCage,
  weightSums,
} from '../src/geometry.js';

const square = [
  { x: -2, y: -1.5 },
  { x: 2, y: -1.5 },
  { x: 2, y: 1.5 },
  { x: -2, y: 1.5 },
];

const concaveCage = [
  { x: -2, y: -1.5 },
  { x: 0.2, y: -1.5 },
  { x: 0.2, y: -0.2 },
  { x: 2, y: -0.2 },
  { x: 2, y: 1.5 },
  { x: -2, y: 1.5 },
];

function transformPoint(point, matrix, offset = { x: 0, y: 0 }) {
  return {
    x: matrix[0] * point.x + matrix[1] * point.y + offset.x,
    y: matrix[2] * point.x + matrix[3] * point.y + offset.y,
  };
}

function transformedCage(vertices, matrix, offset) {
  return vertices.map((point) => transformPoint(point, matrix, offset));
}

test('closed simple cage validates while open and self-intersecting cages are rejected', () => {
  assert.equal(validateCage(square, cycleEdges(4)).valid, true);

  const open = validateCage(square, [[0, 1], [1, 2], [2, 3]]);
  assert.equal(open.valid, false);
  assert.equal(open.closed, false);
  assert.match(open.errors.join(' '), /闭合|边数/);

  const bowTie = [
    { x: 0, y: 0 },
    { x: 2, y: 2 },
    { x: 2, y: 0 },
    { x: 0, y: 2 },
  ];
  const crossing = validateCage(bowTie, cycleEdges(4));
  assert.equal(crossing.valid, false);
  assert.equal(crossing.closed, true);
  assert.equal(crossing.simple, false);
});

test('fine mesh weights form a partition of unity including near-boundary points', () => {
  const mesh = buildFineMesh(square, 5);
  assert.ok(mesh.vertices.length > 20);
  assert.ok(mesh.triangles.length > 20);

  const points = [
    ...mesh.vertices,
    { x: 1.9999999, y: 0.13 },
    { x: 1.999999999, y: -1.499999999 },
    { x: -0.8, y: 1.49999999 },
  ];
  const weights = points.map((point) => meanValueCoordinates(point, square));
  const sums = weightSums(weights);

  for (const sum of sums) {
    assert.ok(Number.isFinite(sum));
    assert.ok(Math.abs(sum - 1) < 1e-9, `weight sum was ${sum}`);
  }
  for (const row of weights) {
    assert.ok(row.every(Number.isFinite));
    assert.ok(Math.max(...row.map(Math.abs)) < 1e6);
  }
});

test('concave cage weights remain finite close to every boundary type', () => {
  const points = [
    { x: 1.9999999, y: 0.7 },
    { x: 1.1, y: -0.1999999 },
    { x: 0.2000001, y: -0.8 },
    { x: 0.2, y: -1.4999999 },
  ];

  for (const point of points) {
    const weights = meanValueCoordinates(point, concaveCage);
    const sum = weights.reduce((total, weight) => total + weight, 0);
    assert.ok(weights.every(Number.isFinite));
    assert.ok(Math.abs(sum - 1) < 1e-9);
    assert.ok(Math.max(...weights.map(Math.abs)) < 1e6);
  }
});

test('translation reproduces exactly', () => {
  const mesh = buildFineMesh(concaveCage, 4);
  const weights = mesh.vertices.map((point) => meanValueCoordinates(point, concaveCage));
  const offset = { x: 37.25, y: -18.75 };
  const moved = transformedCage(concaveCage, [1, 0, 0, 1], offset);

  mesh.vertices.forEach((point, index) => {
    const actual = deformPoint(weights[index], moved);
    const expected = { x: point.x + offset.x, y: point.y + offset.y };
    assert.ok(Math.abs(actual.x - expected.x) < 1e-9);
    assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
  });
});

test('rotation reproduces exactly', () => {
  const mesh = buildFineMesh(concaveCage, 4);
  const weights = mesh.vertices.map((point) => meanValueCoordinates(point, concaveCage));
  const angle = 0.731;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const matrix = [cosine, -sine, sine, cosine];
  const rotated = transformedCage(concaveCage, matrix);

  mesh.vertices.forEach((point, index) => {
    const actual = deformPoint(weights[index], rotated);
    const expected = transformPoint(point, matrix);
    assert.ok(Math.abs(actual.x - expected.x) < 1e-9);
    assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
  });
});

test('uniform scale reproduces exactly', () => {
  const mesh = buildFineMesh(concaveCage, 4);
  const weights = mesh.vertices.map((point) => meanValueCoordinates(point, concaveCage));
  const scale = 2.75;
  const offset = { x: -13, y: 9 };
  const scaled = transformedCage(concaveCage, [scale, 0, 0, scale], offset);
  mesh.vertices.forEach((point, index) => {
    const actual = deformPoint(weights[index], scaled);
    const expected = { x: point.x * scale + offset.x, y: point.y * scale + offset.y };
    assert.ok(Math.abs(actual.x - expected.x) < 1e-9);
    assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
  });
});
