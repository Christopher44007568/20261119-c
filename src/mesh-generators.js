import { TAU, TriangleMesh } from "./mesh.js";

function gridPatch(nx, nz, x0, x1, z0, z1, y = 0) {
  const positions = new Float64Array((nx + 1) * (nz + 1) * 3);
  const triangles = [];
  for (let iz = 0; iz <= nz; iz += 1) {
    for (let ix = 0; ix <= nx; ix += 1) {
      const vertex = iz * (nx + 1) + ix;
      positions[vertex * 3] = x0 + (x1 - x0) * (ix / nx);
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = z0 + (z1 - z0) * (iz / nz);
    }
  }
  for (let iz = 0; iz < nz; iz += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const a = iz * (nx + 1) + ix;
      const b = a + 1;
      const d = a + nx + 1;
      const c = d + 1;
      triangles.push(a, c, b, a, d, c);
    }
  }
  return { positions, triangles, vertexAt: (ix, iz) => iz * (nx + 1) + ix, nx, nz };
}

export function createPlanarMesh(nx = 32, nz = 22) {
  const patch = gridPatch(nx, nz, -1.34, 1.34, -0.9, 0.9);
  const mesh = new TriangleMesh({
    positions: patch.positions,
    triangles: patch.triangles,
    kind: "planar",
    label: "平面网格"
  });
  mesh.grid = { nx, nz, ...patch, vertexAt: undefined };
  mesh.suggested = {
    source: patch.vertexAt(Math.max(1, Math.round(nx * 0.16)), Math.round(nz * 0.55)),
    target: patch.vertexAt(Math.max(1, Math.round(nx * 0.84)), Math.round(nz * 0.43))
  };
  return mesh;
}

export function createSphereMesh(longitude = 36, latitude = 18, radius = 1.3) {
  const positions = [];
  const triangles = [];
  const rings = [];
  const top = 0;
  positions.push(0, radius, 0);
  for (let ring = 1; ring < latitude; ring += 1) {
    const theta = Math.PI * (ring / latitude);
    const y = radius * Math.cos(theta);
    const r = radius * Math.sin(theta);
    const indices = [];
    for (let segment = 0; segment < longitude; segment += 1) {
      const phi = TAU * (segment / longitude);
      indices.push(positions.length / 3);
      positions.push(r * Math.cos(phi), y, r * Math.sin(phi));
    }
    rings.push(indices);
  }
  const bottom = positions.length / 3;
  positions.push(0, -radius, 0);
  const first = rings[0];
  for (let segment = 0; segment < longitude; segment += 1) {
    const next = (segment + 1) % longitude;
    triangles.push(top, first[segment], first[next]);
  }
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    const upper = rings[ring];
    const lower = rings[ring + 1];
    for (let segment = 0; segment < longitude; segment += 1) {
      const next = (segment + 1) % longitude;
      const a = upper[segment];
      const b = upper[next];
      const c = lower[segment];
      const d = lower[next];
      triangles.push(a, b, d, a, d, c);
    }
  }
  const last = rings[rings.length - 1];
  for (let segment = 0; segment < longitude; segment += 1) {
    const next = (segment + 1) % longitude;
    triangles.push(bottom, last[next], last[segment]);
  }
  const mesh = new TriangleMesh({
    positions: Float64Array.from(positions),
    triangles: Uint32Array.from(triangles),
    kind: "sphere",
    label: "球面网格",
    radius
  });
  const middleRing = rings[Math.floor(rings.length * 0.5)];
  const targetRing = rings[Math.floor(rings.length * 0.42)];
  mesh.suggested = {
    source: middleRing[0],
    target: targetRing[Math.floor(longitude * 0.3)]
  };
  return mesh;
}

export function createDisconnectedMesh(nx = 13, nz = 16) {
  const left = gridPatch(nx, nz, -1.43, -0.22, -0.82, 0.82);
  const right = gridPatch(nx, nz, 0.22, 1.43, -0.82, 0.82);
  const leftCount = left.positions.length / 3;
  const positions = new Float64Array(left.positions.length + right.positions.length);
  positions.set(left.positions, 0);
  positions.set(right.positions, left.positions.length);
  const triangles = [...left.triangles, ...right.triangles.map((index) => index + leftCount)];
  const mesh = new TriangleMesh({
    positions,
    triangles: Uint32Array.from(triangles),
    kind: "disconnected",
    label: "断开双片"
  });
  mesh.suggested = {
    source: left.vertexAt(Math.round(nx * 0.35), Math.round(nz * 0.55)),
    target: right.vertexAt(Math.round(nx * 0.65), Math.round(nz * 0.45)) + leftCount
  };
  return mesh;
}
