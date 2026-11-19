const EPSILON = 1e-8;

export function identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function cloneMatrix(a) {
  return new Float32Array(a);
}

export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    const b0 = b[column * 4];
    const b1 = b[column * 4 + 1];
    const b2 = b[column * 4 + 2];
    const b3 = b[column * 4 + 3];
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row] * b0 +
        a[4 + row] * b1 +
        a[8 + row] * b2 +
        a[12 + row] * b3;
    }
  }
  return out;
}

export function multiplyAll(...matrices) {
  return matrices.reduce((result, matrix) => multiply(result, matrix), identity());
}

export function invert(a) {
  const out = new Float32Array(16);
  const a00 = a[0];
  const a01 = a[1];
  const a02 = a[2];
  const a03 = a[3];
  const a10 = a[4];
  const a11 = a[5];
  const a12 = a[6];
  const a13 = a[7];
  const a20 = a[8];
  const a21 = a[9];
  const a22 = a[10];
  const a23 = a[11];
  const a30 = a[12];
  const a31 = a[13];
  const a32 = a[14];
  const a33 = a[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let determinant =
    b00 * b11 - b01 * b10 + b02 * b09 +
    b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(determinant) < EPSILON) {
    throw new Error("Matrix is singular and cannot be inverted");
  }
  determinant = 1 / determinant;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * determinant;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * determinant;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * determinant;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * determinant;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * determinant;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * determinant;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * determinant;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * determinant;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * determinant;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * determinant;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * determinant;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * determinant;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * determinant;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * determinant;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * determinant;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * determinant;
  return out;
}

export function translation(x, y, z) {
  const out = identity();
  out[12] = x;
  out[13] = y;
  out[14] = z;
  return out;
}

export function scaling(x, y = x, z = x) {
  const out = identity();
  out[0] = x;
  out[5] = y;
  out[10] = z;
  return out;
}

export function fromQuaternion([x, y, z, w]) {
  const out = identity();
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  out[0] = 1 - (yy + zz);
  out[1] = xy + wz;
  out[2] = xz - wy;
  out[4] = xy - wz;
  out[5] = 1 - (xx + zz);
  out[6] = yz + wx;
  out[8] = xz + wy;
  out[9] = yz - wx;
  out[10] = 1 - (xx + yy);
  return out;
}

export function composeTRS(position, rotation, scale) {
  const translationMatrix = translation(...position);
  const rotationMatrix = fromQuaternion(rotation);
  const scaleMatrix = scaling(...scale);
  return multiplyAll(translationMatrix, rotationMatrix, scaleMatrix);
}

export function transformPoint(matrix, point) {
  const [x, y, z] = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const inverseW = Math.abs(w) > EPSILON ? 1 / w : 1;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * inverseW,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * inverseW,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * inverseW,
  ];
}

export function transformDirection(matrix, direction) {
  const [x, y, z] = direction;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z,
  ];
}

export function normalMatrix(matrix) {
  return upperLeft3(invert(matrix), true);
}

export function upperLeft3(matrix, transpose = false) {
  if (transpose) {
    return new Float32Array([
      matrix[0], matrix[4], matrix[8],
      matrix[1], matrix[5], matrix[9],
      matrix[2], matrix[6], matrix[10],
    ]);
  }
  return new Float32Array([
    matrix[0], matrix[1], matrix[2],
    matrix[4], matrix[5], matrix[6],
    matrix[8], matrix[9], matrix[10],
  ]);
}

export function transformNormal(matrix, normal) {
  const [x, y, z] = normal;
  return normalize3([
    matrix[0] * x + matrix[3] * y + matrix[6] * z,
    matrix[1] * x + matrix[4] * y + matrix[7] * z,
    matrix[2] * x + matrix[5] * y + matrix[8] * z,
  ]);
}

export function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < EPSILON) {
    return [0, 0, 0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(vector, scalar) {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

export function perspective(fieldOfView, aspect, near, far) {
  const out = new Float32Array(16);
  const f = 1 / Math.tan(fieldOfView / 2);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(eye, target, up) {
  const z = normalize3(subtract3(eye, target));
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}

export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function maxAbsDifference(a, b) {
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference = Math.max(difference, Math.abs(a[index] - b[index]));
  }
  return difference;
}
