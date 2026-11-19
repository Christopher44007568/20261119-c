// Rotation matrix validation: orthogonality and determinant (+1).
// Matrices are column-major 3x3 arrays of 9 numbers.

export function determinant3(m) {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[3] * (m[1] * m[8] - m[2] * m[7]) +
    m[6] * (m[1] * m[5] - m[2] * m[4])
  );
}

export function transpose3(m) {
  return [
    m[0], m[3], m[6],
    m[1], m[4], m[7],
    m[2], m[5], m[8]
  ];
}

export function multiply3(a, b) {
  const r = new Array(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      r[col * 3 + row] =
        a[0 * 3 + row] * b[col * 3 + 0] +
        a[1 * 3 + row] * b[col * 3 + 1] +
        a[2 * 3 + row] * b[col * 3 + 2];
    }
  }
  return r;
}

function maxAbs(a) {
  let m = 0;
  for (const x of a) m = Math.max(m, Math.abs(x));
  return m;
}

// Returns orthogonality error ||R^T R - I||_inf and |det(R) - 1|.
export function matrixCheck(m) {
  const shouldBeIdentity = multiply3(transpose3(m), m);
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const orthoError = maxAbs(shouldBeIdentity.map((x, i) => x - identity[i]));
  const det = determinant3(m);
  return { orthoError, det, detError: Math.abs(det - 1) };
}

export function validateFrames(framesWithMatrices, tolerance = 1e-10) {
  let worstOrtho = 0;
  let worstDet = 0;
  for (const f of framesWithMatrices) {
    const c = matrixCheck(f.R);
    worstOrtho = Math.max(worstOrtho, c.orthoError);
    worstDet = Math.max(worstDet, c.detError);
  }
  return {
    worstOrtho,
    worstDet,
    tolerance,
    pass: worstOrtho <= tolerance && worstDet <= tolerance,
    count: framesWithMatrices.length
  };
}
