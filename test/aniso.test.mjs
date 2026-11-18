import { strict as assert } from 'node:assert';
import {
  dot, normalize, makeFrame, rotateTangent,
  evalSpecular, D,
} from '../brdf.mjs';

const N = [0, 0, 1];
const T0 = [1, 0, 0];

function dirFromAngles(azimuth, elevation) {
  const ce = Math.cos(elevation);
  return [ce * Math.cos(azimuth), ce * Math.sin(azimuth), Math.sin(elevation)];
}

// Uniform-ish hemisphere samples (Fibonacci spiral), z-up.
function hemisphereSamples(count) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const z = (i + 0.5) / count;
    const r = Math.sqrt(1 - z * z);
    const phi = golden * i;
    pts.push({ dir: [r * Math.cos(phi), r * Math.sin(phi), z], area: (2 * Math.PI) / count });
  }
  return pts;
}

// Weighted highlight principal axis (mod pi) in the tangent plane.
function highlightAxis(n, t, ax, ay, wi) {
  const samples = hemisphereSamples(20000);
  let maxW = 0;
  const weighted = samples.map(({ dir }) => {
    const w = evalSpecular(n, t, ax, ay, wi, dir) * dir[2];
    if (w > maxW) maxW = w;
    return { dir, w };
  });
  let sx = 0, sy = 0, sw = 0;
  for (const { dir, w } of weighted) {
    if (w < 0.05 * maxW) continue;
    sx += w * dir[0]; sy += w * dir[1]; sw += w;
  }
  const cx = sx / sw, cy = sy / sw;
  let mxx = 0, mxy = 0, myy = 0;
  for (const { dir, w } of weighted) {
    if (w < 0.05 * maxW) continue;
    const dx = dir[0] - cx, dy = dir[1] - cy;
    mxx += w * dx * dx; mxy += w * dx * dy; myy += w * dy * dy;
  }
  return { axis: 0.5 * Math.atan2(2 * mxy, mxx - myy), centroid: [cx, cy] };
}

// Smallest distance between two axes (directions mod pi).
function axisError(a, b) {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('equal roughness degenerates to isotropic (tangent irrelevant)', () => {
  const wi = normalize(dirFromAngles(0.7, 0.9));
  const wo = normalize(dirFromAngles(2.1, 0.6));
  const a = 0.25;
  const ref = evalSpecular(N, T0, a, a, wi, wo);
  for (let k = 1; k <= 8; k++) {
    const t = rotateTangent(N, T0, (k * Math.PI) / 8);
    const v = evalSpecular(N, t, a, a, wi, wo);
    assert.ok(Math.abs(v - ref) < 1e-12, `tangent rotation changed result: ${v} vs ${ref}`);
  }
  // Matches the closed-form isotropic GGX D term.
  const frame = makeFrame(N, rotateTangent(N, T0, 1.234));
  const h = normalize([wi[0] + wo[0], wi[1] + wo[1], wi[2] + wo[2]]);
  const a2 = a * a;
  const cos2 = h[2] * h[2];
  const dIso = a2 / (Math.PI * (cos2 * (a2 - 1) + 1) ** 2);
  assert.ok(Math.abs(D(frame, a, a, h) - dIso) < 1e-12);
});

test('tangent sign flip leaves brightness unchanged', () => {
  const wi = normalize(dirFromAngles(0.3, 1.0));
  for (const [ax, ay] of [[0.08, 0.5], [0.5, 0.08], [0.3, 0.3]]) {
    for (let k = 0; k < 12; k++) {
      const t = rotateTangent(N, T0, k * 0.61);
      const wo = normalize(dirFromAngles(k * 0.83, 0.35 + 0.05 * k));
      const plus = evalSpecular(N, t, ax, ay, wi, wo);
      const minus = evalSpecular(N, [-t[0], -t[1], -t[2]], ax, ay, wi, wo);
      assert.ok(Math.abs(plus - minus) < 1e-12 * Math.max(1, plus),
        `sign flip changed brightness: ${plus} vs ${minus}`);
    }
  }
});

test('highlight main axis follows tangent rotation', () => {
  const wi = normalize(dirFromAngles(0.4, 1.0));
  const ax = 0.5, ay = 0.08; // rougher along T -> highlight stretches along T
  for (const phi of [0, 0.5, 1.1, 1.9, 2.6]) {
    const t = rotateTangent(N, T0, phi);
    const { axis } = highlightAxis(N, t, ax, ay, wi);
    const err = axisError(axis, phi);
    assert.ok(err < 0.06, `axis ${axis} does not follow tangent ${phi} (err ${err})`);
  }
  // Swapping the roughness axes rotates the stretch axis by 90 degrees.
  const t = rotateTangent(N, T0, 0.7);
  const a1 = highlightAxis(N, t, ax, ay, wi).axis;
  const a2 = highlightAxis(N, t, ay, ax, wi).axis;
  assert.ok(axisError(a1, a2 + Math.PI / 2) < 0.06, 'axis swap should rotate highlight by 90 deg');
});

test('rotating light rotates the highlight sensibly', () => {
  const t = T0;
  const ax = 0.35, ay = 0.12;
  let prev = null;
  for (const phiL of [0.2, 0.9, 1.6]) {
    const wi = normalize(dirFromAngles(phiL, 1.0));
    const { centroid } = highlightAxis(N, t, ax, ay, wi);
    const az = Math.atan2(centroid[1], centroid[0]);
    // Mirror direction: viewer sits opposite the light across the normal.
    const expectedAz = phiL + Math.PI;
    let d = Math.abs(az - expectedAz) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    assert.ok(d < 0.25, `highlight azimuth ${az} far from mirror azimuth ${expectedAz}`);
    if (prev !== null) {
      const shift = az - prev.az;
      const expected = phiL - prev.phiL;
      assert.ok(Math.abs(shift - expected) < 0.25, 'highlight did not track light rotation');
    }
    prev = { az, phiL };
  }
});

test('no NaN, negative, or energy-violating values across sweeps', () => {
  const samples = hemisphereSamples(4000);
  for (const [ax, ay] of [[0.05, 0.6], [0.6, 0.05], [0.2, 0.2], [1.2, 1.2], [0.03, 1.5]]) {
    for (const tAngle of [0, 0.9, 2.2]) {
      const t = rotateTangent(N, T0, tAngle);
      const wi = normalize(dirFromAngles(tAngle * 1.7 + 0.3, 0.8));
      let energy = 0;
      for (const { dir, area } of samples) {
        const f = evalSpecular(N, t, ax, ay, wi, dir);
        assert.ok(Number.isFinite(f), `non-finite BRDF at ax=${ax} ay=${ay}`);
        assert.ok(f >= 0, `negative BRDF: ${f}`);
        energy += f * dir[2] * area;
      }
      assert.ok(energy <= 1 + 1e-3, `energy ${energy} exceeds 1 (ax=${ax} ay=${ay})`);
    }
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok   - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}\n       ${err.message}`);
  }
}
if (failed) process.exit(1);
console.log(`${tests.length} tests passed`);
