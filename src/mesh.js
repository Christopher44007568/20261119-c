export const TAU = Math.PI * 2;

function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  return { min, max };
}

export function distance3(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dy, dz);
}

export class TriangleMesh {
  constructor({ positions, triangles, kind, label, radius = null }) {
    this.positions = positions instanceof Float64Array ? positions : Float64Array.from(positions);
    this.triangles = triangles instanceof Uint32Array ? triangles : Uint32Array.from(triangles);
    this.kind = kind;
    this.label = label;
    this.radius = radius;
    this.vertexCount = this.positions.length / 3;
    this.faceCount = this.triangles.length / 3;
    this.bounds = boundsOf(this.positions);
    this.center = this.bounds.min.map((value, axis) => (value + this.bounds.max[axis]) / 2);
    this.scale = Math.max(
      this.bounds.max[0] - this.bounds.min[0],
      this.bounds.max[1] - this.bounds.min[1],
      this.bounds.max[2] - this.bounds.min[2]
    );
    this.facesOfVertex = Array.from({ length: this.vertexCount }, () => []);
    this.neighbors = Array.from({ length: this.vertexCount }, () => new Set());
    this.faceNormals = new Float64Array(this.faceCount * 3);
    this.faceAreas = new Float64Array(this.faceCount);
    this.vertexNormals = new Float64Array(this.vertexCount * 3);
    this.edgeFaces = new Map();
    this._buildTopology();
    this.components = this._findComponents();
    this.componentOf = new Uint32Array(this.vertexCount);
    this.components.forEach((component, componentIndex) => {
      for (const vertex of component) this.componentOf[vertex] = componentIndex;
    });
  }

  point(vertex) {
    const offset = vertex * 3;
    return [
      this.positions[offset],
      this.positions[offset + 1],
      this.positions[offset + 2]
    ];
  }

  face(faceIndex) {
    const offset = faceIndex * 3;
    return [
      this.triangles[offset],
      this.triangles[offset + 1],
      this.triangles[offset + 2]
    ];
  }

  _buildTopology() {
    let lengthSum = 0;
    let lengthCount = 0;
    for (let face = 0; face < this.faceCount; face += 1) {
      const [a, b, c] = this.face(face);
      const pa = this.point(a);
      const pb = this.point(b);
      const pc = this.point(c);
      const ex = pb[0] - pa[0];
      const ey = pb[1] - pa[1];
      const ez = pb[2] - pa[2];
      const fx = pc[0] - pa[0];
      const fy = pc[1] - pa[1];
      const fz = pc[2] - pa[2];
      const nx = ey * fz - ez * fy;
      const ny = ez * fx - ex * fz;
      const nz = ex * fy - ey * fx;
      const area = Math.hypot(nx, ny, nz) * 0.5;
      this.faceAreas[face] = area;
      this.faceNormals[face * 3] = nx / (area * 2);
      this.faceNormals[face * 3 + 1] = ny / (area * 2);
      this.faceNormals[face * 3 + 2] = nz / (area * 2);
      for (const vertex of [a, b, c]) {
        this.facesOfVertex[vertex].push(face);
        const normalOffset = vertex * 3;
        this.vertexNormals[normalOffset] += nx;
        this.vertexNormals[normalOffset + 1] += ny;
        this.vertexNormals[normalOffset + 2] += nz;
      }
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        this.neighbors[u].add(v);
        this.neighbors[v].add(u);
        const key = u < v ? `${u}:${v}` : `${v}:${u}`;
        if (!this.edgeFaces.has(key)) this.edgeFaces.set(key, []);
        this.edgeFaces.get(key).push(face);
        lengthSum += distance3(this.point(u), this.point(v));
        lengthCount += 1;
      }
    }
    this.averageEdge = lengthSum / Math.max(1, lengthCount);
    for (let vertex = 0; vertex < this.vertexCount; vertex += 1) {
      const offset = vertex * 3;
      const length = Math.hypot(
        this.vertexNormals[offset],
        this.vertexNormals[offset + 1],
        this.vertexNormals[offset + 2]
      );
      if (length > 1e-14) {
        this.vertexNormals[offset] /= length;
        this.vertexNormals[offset + 1] /= length;
        this.vertexNormals[offset + 2] /= length;
      } else {
        this.vertexNormals[offset + 1] = 1;
      }
    }
  }

  _findComponents() {
    const seen = new Uint8Array(this.vertexCount);
    const components = [];
    for (let start = 0; start < this.vertexCount; start += 1) {
      if (seen[start]) continue;
      const component = [];
      const queue = [start];
      seen[start] = 1;
      while (queue.length) {
        const vertex = queue.pop();
        component.push(vertex);
        for (const neighbor of this.neighbors[vertex]) {
          if (!seen[neighbor]) {
            seen[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }
      components.push(component);
    }
    return components;
  }

  faceNeighbor(faceIndex, edgeVertices) {
    const key = edgeVertices[0] < edgeVertices[1]
      ? `${edgeVertices[0]}:${edgeVertices[1]}`
      : `${edgeVertices[1]}:${edgeVertices[0]}`;
    const faces = this.edgeFaces.get(key) || [];
    return faces.find((face) => face !== faceIndex) ?? -1;
  }

  referenceDistance(source, target) {
    if (source === target) return 0;
    if (this.componentOf[source] !== this.componentOf[target]) return null;
    const a = this.point(source);
    const b = this.point(target);
    if (this.kind === "sphere" && this.radius) {
      const ax = a[0] / this.radius;
      const ay = a[1] / this.radius;
      const az = a[2] / this.radius;
      const bx = b[0] / this.radius;
      const by = b[1] / this.radius;
      const bz = b[2] / this.radius;
      return this.radius * Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz)));
    }
    if (this.kind === "disconnected" || this.kind === "planar") {
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }
    return null;
  }
}
