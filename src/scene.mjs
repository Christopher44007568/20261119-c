// Scene geometry: boxes, a sphere, the calm water quad, frustum line lists.

export function cubeGeometry() {
  const p = [];
  const c = [];
  const idx = [];
  const faces = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  for (const [n, verts] of faces) {
    const base = p.length / 3;
    for (const v of verts) {
      p.push(v[0] * 0.5, v[1] * 0.5, v[2] * 0.5);
      c.push(n[0] * 0.5 + 0.5, n[1] * 0.5 + 0.5, n[2] * 0.5 + 0.5);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: p, normals: c, indices: idx };
}

export function sphereGeometry(rows = 12, cols = 20) {
  const p = [];
  const c = [];
  const idx = [];
  for (let i = 0; i <= rows; i++) {
    const th = (i / rows) * Math.PI;
    for (let j = 0; j <= cols; j++) {
      const ph = (j / cols) * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph);
      const y = Math.cos(th);
      const z = Math.sin(th) * Math.sin(ph);
      p.push(x * 0.5, y * 0.5, z * 0.5);
      c.push(x, y, z);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j;
      const b = a + cols + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions: p, normals: c, indices: idx };
}

// Calm water quad: the geometric reference, never displaced.
export function waterGeometry(half) {
  return {
    positions: [
      -half, 0, -half, half, 0, -half, half, 0, half,
      -half, 0, -half, half, 0, half, -half, 0, half,
    ],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    corners: [
      [-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half],
    ],
    indices: [0, 1, 2, 3, 4, 5],
  };
}

// 12 edges of a camera frustum as line-vertex pairs (for debug view).
export function frustumLines(eye, center, up, fovy, aspect, near, far) {
  const z = norm(sub3(eye, center));
  const x = norm(cross3(up, z));
  const y = cross3(z, x);
  const corners = [];
  for (const d of [near, far]) {
    const hh = Math.tan(fovy / 2) * d;
    const hw = hh * aspect;
    const c = add3(eye, scale3(z, -d));
    corners.push(
      add3(c, add3(scale3(x, -hw), scale3(y, -hh))),
      add3(c, add3(scale3(x, hw), scale3(y, -hh))),
      add3(c, add3(scale3(x, hw), scale3(y, hh))),
      add3(c, add3(scale3(x, -hw), scale3(y, hh))),
    );
  }
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const out = [];
  for (const [a, b] of edges) out.push(...corners[a], ...corners[b]);
  return out;
}

function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
