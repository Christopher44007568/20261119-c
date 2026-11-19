'use strict';
/**
 * Validation for height-to-normal reconstruction.
 *
 * Uses analytic ground truth (sloped plane, sinusoidal height field) to
 * measure normal angular error, and checks the declared invariants:
 *  - geometric direction comes only from the height gradient;
 *  - roughness only scales the filter, never injects direction;
 *  - edge protection prevents smoothing bleed across height steps;
 *  - unified texture coordinates (u = columns, v = rows) and
 *    right-handed tangent frame T x B = N.
 *
 * Run: node src/validate.js   (exit code 1 on any failure)
 */
const { heightToNormals } = require('./height-to-normal');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
}

function makeField(width, heightPx, fn) {
  const h = new Float64Array(width * heightPx);
  for (let y = 0; y < heightPx; y++)
    for (let x = 0; x < width; x++) h[y * width + x] = fn(x, y);
  return h;
}

function angleDeg(ax, ay, az, bx, by, bz) {
  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  const nx = ax / la, ny = ay / la, nz = az / la;
  const mx = bx / lb, my = by / lb, mz = bz / lb;
  const dot = nx * mx + ny * my + nz * mz;
  const cx = ny * mz - nz * my;
  const cy = nz * mx - nx * mz;
  const cz = nx * my - ny * mx;
  return (Math.atan2(Math.hypot(cx, cy, cz), dot) * 180) / Math.PI;
}

function maxInteriorAngle(normals, width, heightPx, margin, expectedAt) {
  let maxErr = 0;
  for (let y = margin; y < heightPx - margin; y++) {
    for (let x = margin; x < width - margin; x++) {
      const o = 3 * (y * width + x);
      const e = expectedAt(x, y);
      const err = angleDeg(
        normals[o], normals[o + 1], normals[o + 2],
        e[0], e[1], e[2]
      );
      if (err > maxErr) maxErr = err;
    }
  }
  return maxErr;
}

function unit(nx, ny, nz) {
  const l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// --- 1. Analytic sloped plane: exact for every radius / edge mode --------
{
  const W = 64, H = 64, a = 0.3, b = -0.2;
  const h = makeField(W, H, (x, y) => a * x + b * y);
  const expected = unit(-a, -b, 1);
  for (const radius of [0, 2, 4]) {
    for (const edgeProtect of [false, true]) {
      const { normals } = heightToNormals(h, W, H, {
        radius, edgeProtect, edgeThreshold: 0.05,
      });
      const margin = Math.ceil(3 * radius) + 2;
      const err = maxInteriorAngle(normals, W, H, margin, () => expected);
      check(
        `plane radius=${radius} edgeProtect=${edgeProtect}`,
        err < 1e-3,
        `max angle error ${err.toExponential(2)} deg`
      );
    }
  }
}

// --- 3. Roughness on a plane: scales the filter, adds no direction -------
{
  const W = 64, H = 64, a = 0.25, b = 0.4;
  const h = makeField(W, H, (x, y) => a * x + b * y);
  const rand = lcg(12345);
  const roughness = makeField(W, H, () => rand());
  const expected = unit(-a, -b, 1);
  const { normals } = heightToNormals(h, W, H, {
    radius: 0, roughness, roughnessRadius: 6,
  });
  const err = maxInteriorAngle(normals, W, H, 20, () => expected);
  check(
    'plane + random roughness (radius 0..6)',
    err < 1e-3,
    `max angle error ${err.toExponential(2)} deg`
  );
}

// --- 4. Flat height + roughness: normals must stay exactly vertical ------
{
  const W = 48, H = 48;
  const h = makeField(W, H, () => 0.7);
  const rand = lcg(777);
  const roughness = makeField(W, H, () => rand());
  const { normals } = heightToNormals(h, W, H, {
    radius: 0, roughness, roughnessRadius: 6,
  });
  const err = maxInteriorAngle(normals, W, H, 0, () => [0, 0, 1]);
  check('flat + roughness stays vertical', err < 1e-6, `max angle error ${err} deg`);
}

// --- 5. Zero total filter scale: roughness is a strict no-op -------------
{
  const W = 48, H = 48;
  const rand = lcg(42);
  const h = makeField(W, H, () => rand());
  const roughness = makeField(W, H, () => rand());
  const withR = heightToNormals(h, W, H, { radius: 0, roughness, roughnessRadius: 0 });
  const noR = heightToNormals(h, W, H, { radius: 0 });
  let identical = true;
  for (let i = 0; i < withR.normals.length; i++) {
    if (withR.normals[i] !== noR.normals[i]) { identical = false; break; }
  }
  check('roughness no-op at zero filter scale', identical, 'normals bit-identical');
}

// --- 6. Roughness selects filter scale only -------------------------------
// With a striped roughness map, each half of the map (away from the scale
// transition) must reproduce a uniform-radius run bit for bit: roughness
// picks the local filter scale, the height gradient picks the direction.
{
  const W = 128, H = 128, A = 0.5;
  const fu = 4 / W, fv = 6 / H;
  const ku = 2 * Math.PI * fu, kv = 2 * Math.PI * fv;
  const h = makeField(W, H, (x, y) => A * Math.sin(ku * x + kv * y));
  const roughness = makeField(W, H, (x) => (x < W / 2 ? 0 : 1));
  const radius = 0.5, roughnessRadius = 3;
  const mixed = heightToNormals(h, W, H, { radius, roughness, roughnessRadius }).normals;
  const uniL = heightToNormals(h, W, H, { radius }).normals;
  const uniR = heightToNormals(h, W, H, { radius: radius + roughnessRadius }).normals;
  const margin = 14;
  let maxDiff = 0;
  for (let y = margin; y < H - margin; y++) {
    for (let x = margin; x < W - margin; x++) {
      if (Math.abs(x - W / 2) < margin) continue;
      const o = 3 * (y * W + x);
      const ref = x < W / 2 ? uniL : uniR;
      const err = angleDeg(
        mixed[o], mixed[o + 1], mixed[o + 2],
        ref[o], ref[o + 1], ref[o + 2]
      );
      if (err > maxDiff) maxDiff = err;
    }
  }
  check(
    'roughness selects scale, gradient sets direction',
    maxDiff < 1e-3,
    `max deviation from uniform-scale runs ${maxDiff.toExponential(2)} deg`
  );
}

// --- 7. Edge protection across a height step ------------------------------
{
  const W = 64, H = 32;
  const h = makeField(W, H, (x) => (x < W / 2 ? 0 : 1));
  const band = [];
  for (let x = 26; x <= 29; x++) band.push(x);
  for (let x = 34; x <= 37; x++) band.push(x);
  const maxTilt = (normals) => {
    let m = 0;
    for (let y = 12; y < H - 12; y++) {
      for (const x of band) {
        const o = 3 * (y * W + x);
        const t = angleDeg(normals[o], normals[o + 1], normals[o + 2], 0, 0, 1);
        if (t > m) m = t;
      }
    }
    return m;
  };
  const unprot = maxTilt(heightToNormals(h, W, H, { radius: 3 }).normals);
  const prot = maxTilt(
    heightToNormals(h, W, H, { radius: 3, edgeProtect: true, edgeThreshold: 0.2 }).normals
  );
  check(
    'edge protection at height step',
    unprot > 3 && prot < 0.5 && prot < unprot,
    `tilt near edge: unprotected ${unprot.toFixed(2)} deg, protected ${prot.toFixed(4)} deg`
  );
}

// --- 8. Handedness, texture-coordinate unification, RGB packing ----------
{
  const W = 32, H = 32, s = 0.5;
  const rampU = makeField(W, H, (x) => s * x);
  const rampV = makeField(W, H, (x, y) => s * y);
  const nU = heightToNormals(rampU, W, H, {}).normals;
  const nV = heightToNormals(rampV, W, H, {}).normals;
  const o = 3 * (16 * W + 16);
  const okU = nU[o] < 0 && nU[o + 1] === 0 && nU[o + 2] > 0;
  const okV = nV[o + 1] < 0 && nV[o] === 0 && nV[o + 2] > 0;
  // Transposing the field must swap nx/ny (u<->v unification).
  const rampT = makeField(W, H, (x, y) => s * x + 0.25 * y);
  const rampTt = makeField(W, H, (x, y) => s * y + 0.25 * x);
  const a = heightToNormals(rampT, W, H, {}).normals;
  const b = heightToNormals(rampTt, W, H, {}).normals;
  const okT = Math.abs(a[o] - b[o + 1]) < 1e-7 && Math.abs(a[o + 1] - b[o]) < 1e-7;
  // Packing: greenUp flips only G; R/B unchanged; G channels mirror.
  const gl = heightToNormals(rampV, W, H, { greenUp: true }).rgb;
  const dx = heightToNormals(rampV, W, H, { greenUp: false }).rgb;
  const okPack =
    gl[o] === dx[o] && gl[o + 2] === dx[o + 2] &&
    Math.abs(gl[o + 1] + dx[o + 1] - 255) <= 1 &&
    gl[o + 1] > 128 && dx[o + 1] < 128;
  check(
    'handedness + uv unification + packing',
    okU && okV && okT && okPack,
    `rampU ${okU}, rampV ${okV}, transpose ${okT}, packing ${okPack}`
  );
}

// --- 2. Sinusoid: error vs analytically attenuated expected normal -------
{
  const W = 128, H = 128, A = 0.5;
  const fu = 3 / W, fv = 5 / H;
  const ku = 2 * Math.PI * fu, kv = 2 * Math.PI * fv;
  const h = makeField(W, H, (x, y) => A * Math.sin(ku * x + kv * y));
  // Central differences scale a sinusoid derivative by sin(k)/k per axis;
  // Gaussian smoothing of sigma scales amplitude by exp(-2 pi^2 sigma^2 f^2).
  const fdx = Math.sin(ku) / ku, fdy = Math.sin(kv) / kv;
  for (const radius of [0, 1.5, 3]) {
    const att = Math.exp(-2 * Math.PI * Math.PI * radius * radius * (fu * fu + fv * fv));
    const { normals } = heightToNormals(h, W, H, { radius });
    const margin = Math.ceil(3 * radius) + 2;
    const err = maxInteriorAngle(normals, W, H, margin, (x, y) => {
      const c = Math.cos(ku * x + kv * y);
      return unit(-A * ku * c * fdx * att, -A * kv * c * fdy * att, 1);
    });
    check(
      `sinusoid radius=${radius}`,
      err < 0.05,
      `max angle error ${err.toExponential(2)} deg (attenuation ${att.toFixed(4)})`
    );
  }
}

// --- runner ----------------------------------------------------------------
let failures = 0;
for (const r of results) {
  if (!r.pass) failures++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.detail}`);
}
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
