import test from 'node:test';
import assert from 'node:assert/strict';
import {
  perspective, lookAt, multiply, transformPoint, projectToUV,
  reflectPoint, mirrorView, planeToView, makeOblique, planeSide,
} from '../src/math.mjs';
import { reflectionError, waterFootprint, perturbOffset } from '../src/water.mjs';

const WATER_N = [0, 1, 0];
const WATER_D = 0;

function makeCam() {
  const eye = [4, 3, 6];
  const center = [0, 0.5, 0];
  const up = [0, 1, 0];
  const proj = perspective(Math.PI / 3, 16 / 9, 0.1, 100);
  return { eye, center, up, proj, view: lookAt(eye, center, up) };
}

test('reflectPoint mirrors across y=0', () => {
  assert.deepEqual(reflectPoint([1, 2, 3], WATER_N, 0), [1, -2, 3]);
  assert.deepEqual(reflectPoint([0, 0, 0], WATER_N, 0), [0, 0, 0]);
});

test('mirror camera sits below water looking up', () => {
  const { eye, center, up } = makeCam();
  const mv = mirrorView(eye, center, up, WATER_N, WATER_D);
  // camera position = -(x*t0 + y*t1 + z*t2) with basis vectors x,y,z
  const t = [mv[12], mv[13], mv[14]];
  const r = [mv[0], mv[1], mv[2], mv[4], mv[5], mv[6], mv[8], mv[9], mv[10]];
  const pos = [
    -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]),
    -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]),
    -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2]),
  ];
  assert.ok(Math.abs(pos[1] + eye[1]) < 1e-6, `mirror cam y=${pos[1]}`);
  assert.ok(Math.abs(pos[0] - eye[0]) < 1e-6);
  assert.ok(Math.abs(pos[2] - eye[2]) < 1e-6);
});

test('oblique projection puts the clip plane at ndc z=-1', () => {
  const { proj } = makeCam();
  // view-space plane z = -2 (in front of camera looking down -z), keep z > -2
  const clip = { n: [0, 0, 1], d: 2 };
  // camera at origin: n·0 + d = 2 > 0 -> wrong side, flip so camera is negative
  const flipped = { n: [0, 0, -1], d: -2 };
  assert.ok(planeSide([0, 0, 0], flipped.n, flipped.d) < 0);
  const ob = makeOblique(proj, flipped);
  // point on the plane z=-2 maps to ndc z = -1
  const p = transformPoint(ob, [0.05, -0.03, -2]);
  assert.ok(Math.abs(p[2] + 1) < 1e-5, `ndc z=${p[2]}`);
  // point on the kept side (z=-5) is in front of the near plane
  const q = transformPoint(ob, [0, 0, -5]);
  assert.ok(q[2] > -1);
  // point on the camera side of the plane (z=-1) is clipped away
  const r = transformPoint(ob, [0, 0, -1]);
  assert.ok(r[2] < -1);
});

test('clip direction: water plane keeps above-water side for mirror camera', () => {
  const { eye, center, up } = makeCam();
  const mv = mirrorView(eye, center, up, WATER_N, WATER_D);
  const clipView = planeToView(mv, WATER_N, WATER_D);
  // mirror camera is below water: must evaluate negative in view space
  assert.ok(clipView.d < 0, `camera-side value ${clipView.d}`);
  // an object crossing the plane: above-water point kept, below clipped
  const above = [0, 1, 0];
  const below = [0, -1, 0];
  const a = transformPoint(mv, above);
  const b = transformPoint(mv, below);
  const sa = clipView.n[0] * a[0] + clipView.n[1] * a[1] + clipView.n[2] * a[2] + clipView.d;
  const sb = clipView.n[0] * b[0] + clipView.n[1] * b[1] + clipView.n[2] * b[2] + clipView.d;
  assert.ok(sa > 0, `above-water kept (${sa})`);
  assert.ok(sb < 0, `below-water clipped (${sb})`);
});

test('reflection error is zero without perturbation', () => {
  const { eye, center, up, proj } = makeCam();
  const mv = mirrorView(eye, center, up, WATER_N, WATER_D);
  const corners = [[-5, 0, -5], [5, 0, -5], [5, 0, 5], [-5, 0, 5]];
  const projectUV = (p) => projectToUV(proj, mv, p);
  const err = reflectionError({
    projectUV, corners, res: [1024, 1024],
    time: 1.23, strength: 0.08, perturb: false,
  });
  assert.equal(err.mean, 0);
  assert.equal(err.max, 0);
  assert.equal(err.outside, 0);
});

test('perturbed samples never leave the water footprint', () => {
  const { eye, center, up, proj } = makeCam();
  const mv = mirrorView(eye, center, up, WATER_N, WATER_D);
  const corners = [[-5, 0, -5], [5, 0, -5], [5, 0, 5], [-5, 0, 5]];
  const projectUV = (p) => projectToUV(proj, mv, p);
  const err = reflectionError({
    projectUV, corners, res: [1024, 1024],
    time: 2.5, strength: 0.08, perturb: true,
  });
  assert.ok(err.mean > 0, 'perturbation should introduce measurable error');
  assert.equal(err.outside, 0, 'no sample may be dragged out of the water');
  const fp = waterFootprint(projectUV, corners);
  assert.ok(fp.min[0] >= 0 && fp.max[0] <= 1);
});

test('perturb offset is bounded by wave slope times strength', () => {
  const o = perturbOffset(1.7, -2.3, 0.9, 0.08);
  assert.ok(Math.abs(o[0]) < 0.05);
  assert.ok(Math.abs(o[1]) < 0.05);
});
