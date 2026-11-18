// Numerical exploration of the foldable manifold of the degree-4 loop.
// Drives one fold and Gauss-Newton-solves the remaining fold angles so that
// the closure residual vanishes. Not part of the shipped app; used to pick a
// valid demo configuration.
import { solveFold } from '../src/core/folding.js';
import { degreeFourLoop } from '../src/core/patterns.js';

const rad = (d) => (d * Math.PI) / 180;
const deg = (x) => (x * 180) / Math.PI;
const pattern = degreeFourLoop();

function residual(angles, drive) {
  const state = { F0: rad(drive), F1: angles[0], F2: angles[1], F3: angles[2] };
  const result = solveFold(pattern, state);
  const g2 = result.geometry.get('P2');
  const g3 = result.geometry.get('P3');
  const c2 = g2.world3d[g2.vertexToLocal.get(3)];
  const c3 = g3.world3d[g3.vertexToLocal.get(3)];
  const dp = c2.map((c, i) => c - c3[i]);
  return [...dp, result.closure[0].angleResidual];
}

function invert3(m) {
  const cof = [
    [
      m[1][1] * m[2][2] - m[1][2] * m[2][1],
      -(m[1][0] * m[2][2] - m[1][2] * m[2][0]),
      m[1][0] * m[2][1] - m[1][1] * m[2][0],
    ],
    [
      -(m[0][1] * m[2][2] - m[0][2] * m[2][1]),
      m[0][0] * m[2][2] - m[0][2] * m[2][0],
      -(m[0][0] * m[2][1] - m[0][1] * m[2][0]),
    ],
    [
      m[0][1] * m[1][2] - m[0][2] * m[1][1],
      -(m[0][0] * m[1][2] - m[0][2] * m[1][0]),
      m[0][0] * m[1][1] - m[0][1] * m[1][0],
    ],
  ];
  const det =
    m[0][0] * cof[0][0] + m[0][1] * cof[1][0] + m[0][2] * cof[2][0];
  return cof.flatMap((row, i) => row.map((c, j) => cof[j][i] / det));
}

for (const drive of [20, 40, 60]) {
  let x = [rad(15), rad(15), rad(15)];
  const h = 1e-6;
  for (let iter = 0; iter < 300; iter++) {
    const f = residual(x, drive);
    if (Math.hypot(...f) < 1e-11) break;
    const J = [];
    for (let k = 0; k < 3; k++) {
      const xp = x.slice();
      xp[k] += h;
      const fp = residual(xp, drive);
      J.push(fp.map((v, i) => (v - f[i]) / h));
    }
    const jtj = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const jtf = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        for (let r = 0; r < 4; r++) jtj[i][j] += J[i][r] * J[j][r];
      }
      for (let r = 0; r < 4; r++) jtf[i] += J[i][r] * f[r];
    }
    const inv = invert3(jtj);
    const step = [0, 0, 0].map((_, i) => {
      let s = 0;
      for (let j = 0; j < 3; j++) s -= inv[i * 3 + j] * jtf[j];
      return s;
    });
    let lambda = 1;
    let nx = x.map((v, i) => v + step[i]);
    let tries = 0;
    while (Math.hypot(...residual(nx, drive)) > Math.hypot(...f) && tries++ < 30) {
      lambda *= 0.5;
      nx = x.map((v, i) => v + step[i] * lambda);
    }
    x = nx;
  }
  const result = solveFold(pattern, {
    F0: rad(drive),
    F1: x[0],
    F2: x[1],
    F3: x[2],
  });
  console.log(
    'drive', drive,
    'angles', x.map((v) => +deg(v).toFixed(3)),
    'posRes', result.closure[0].positionResidual.toExponential(2),
    'angRes', result.closure[0].angleResidual.toExponential(2),
    'intersections', result.intersections.length,
  );
}
