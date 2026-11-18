// Cubic Bezier curve / bicubic Bezier patch evaluation.
// Pure module: runs in both the browser and Node (for tests).

// Evaluate a cubic Bezier curve. cp = [p0, p1, p2, p3], each [x, y, z].
export function evalCubic(cp, t, out = [0, 0, 0]) {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  out[0] = b0 * cp[0][0] + b1 * cp[1][0] + b2 * cp[2][0] + b3 * cp[3][0];
  out[1] = b0 * cp[0][1] + b1 * cp[1][1] + b2 * cp[2][1] + b3 * cp[3][1];
  out[2] = b0 * cp[0][2] + b1 * cp[1][2] + b2 * cp[2][2] + b3 * cp[3][2];
  return out;
}

// Evaluate a bicubic Bezier patch.
// ctrl = 4x4 array of [x,y,z], ctrl[i][j] with i = u row, j = v column.
export function evalPatch(ctrl, u, v, out = [0, 0, 0]) {
  const su = 1 - u;
  const bu = [
    su * su * su,
    3 * su * su * u,
    3 * su * u * u,
    u * u * u,
  ];
  const sv = 1 - v;
  const bv = [
    sv * sv * sv,
    3 * sv * sv * v,
    3 * sv * v * v,
    v * v * v,
  ];
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const w = bu[i] * bv[j];
      const p = ctrl[i][j];
      x += w * p[0];
      y += w * p[1];
      z += w * p[2];
    }
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

// Extract the 4 boundary curves of a patch as cubic control polygons.
// Edge order: 0 = u=0 (v runs), 1 = u=1 (v runs), 2 = v=0 (u runs), 3 = v=1 (u runs).
export function boundaryCurves(ctrl) {
  const col = (j) => [ctrl[0][j], ctrl[1][j], ctrl[2][j], ctrl[3][j]];
  const row = (i) => [ctrl[i][0], ctrl[i][1], ctrl[i][2], ctrl[i][3]];
  return [row(0), row(3), col(0), col(3)];
}

// Bernstein basis derivatives for degree 3.
function bernsteinDeriv(t) {
  const u = 1 - t;
  return [
    -3 * u * u,
    3 * u * (1 - 3 * t),
    3 * t * (2 - 3 * t),
    3 * t * t,
  ];
}

// Evaluate partial derivatives dP/du and dP/dv of a bicubic patch.
export function evalPatchDerivatives(ctrl, u, v, outDu = [0, 0, 0], outDv = [0, 0, 0]) {
  const su = 1 - u;
  const bu = [su * su * su, 3 * su * su * u, 3 * su * u * u, u * u * u];
  const sv = 1 - v;
  const bv = [sv * sv * sv, 3 * sv * sv * v, 3 * sv * v * v, v * v * v];
  const dbu = bernsteinDeriv(u);
  const dbv = bernsteinDeriv(v);
  for (let k = 0; k < 3; k++) {
    outDu[k] = 0;
    outDv[k] = 0;
  }
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const p = ctrl[i][j];
      const wu = dbu[i] * bv[j];
      const wv = bu[i] * dbv[j];
      outDu[0] += wu * p[0];
      outDu[1] += wu * p[1];
      outDu[2] += wu * p[2];
      outDv[0] += wv * p[0];
      outDv[1] += wv * p[1];
      outDv[2] += wv * p[2];
    }
  }
  return { du: outDu, dv: outDv };
}
