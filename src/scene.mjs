import { lookAt, multiply, perspective } from "./math.mjs";

const WALL_Z = 0;
const WALL_HALF_Z = 0.1;
const WALL_X = 5.5;
const WALL_TOP = 5.35;
const SLIT_BOTTOM = 1.28;
const SLIT_TOP = 3.86;

const SLITS = [
  { min: -1.82, max: -1.61, width: 0.21 },
  { min: -0.18, max: 0.06, width: 0.24 },
  { min: 1.48, max: 1.68, width: 0.20 },
];

const FACES = [
  { n: [1, 0, 0], p: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], p: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], p: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], p: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], p: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], p: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

export class MeshBuilder {
  constructor() {
    this.vertices = [];
    this.indices = [];
  }

  box(min, max, color, { light = 0 } = {}) {
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const base = this.vertices.length / 10;
    for (const face of FACES) {
      for (const corner of face.p) {
        this.vertices.push(
          min[0] + corner[0] * size[0],
          min[1] + corner[1] * size[1],
          min[2] + corner[2] * size[2],
          face.n[0], face.n[1], face.n[2],
          color[0], color[1], color[2],
          light,
        );
      }
      const i = this.vertices.length / 10 - 4;
      this.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
    return base;
  }

  build() {
    return {
      vertices: new Float32Array(this.vertices),
      indices: new Uint32Array(this.indices),
      indexCount: this.indices.length,
    };
  }
}

export function createScene(width, height) {
  const mesh = new MeshBuilder();
  const stone = [0.145, 0.155, 0.15];
  const warmStone = [0.22, 0.205, 0.18];
  const floor = [0.17, 0.175, 0.165];
  const dark = [0.064, 0.069, 0.068];

  mesh.box([-7, -0.25, -16], [7, 0, 14], floor);
  mesh.box([-5.7, 5.35, -16.2], [5.7, 5.52, 13], dark);
  mesh.box([-5.7, 0, -16.2], [-5.5, 5.45, 13], stone);
  mesh.box([5.5, 0, -16.2], [5.7, 5.45, 13], stone);
  mesh.box([-5.7, 0, -16.2], [5.7, 5.45, -16.0], dark);

  mesh.box([-WALL_X, 0, WALL_Z - WALL_HALF_Z], [WALL_X, SLIT_BOTTOM, WALL_Z + WALL_HALF_Z], warmStone);
  mesh.box([-WALL_X, SLIT_TOP, WALL_Z - WALL_HALF_Z], [WALL_X, WALL_TOP, WALL_Z + WALL_HALF_Z], warmStone);

  let cursor = -WALL_X;
  for (const slit of SLITS) {
    mesh.box(
      [cursor, SLIT_BOTTOM, WALL_Z - WALL_HALF_Z],
      [slit.min, SLIT_TOP, WALL_Z + WALL_HALF_Z],
      warmStone,
    );
    cursor = slit.max;
  }
  mesh.box(
    [cursor, SLIT_BOTTOM, WALL_Z - WALL_HALF_Z],
    [WALL_X, SLIT_TOP, WALL_Z + WALL_HALF_Z],
    warmStone,
  );

  mesh.box([-0.68, 1.6, -2.6], [0.68, 3.5, -2.48], [1, 0.88, 0.68], { light: 1 });
  mesh.box([-2.75, 0, 2.9], [-2.35, 2.65, 3.3], dark);
  mesh.box([2.55, 0, 2.35], [3.17, 3.1, 2.95], dark);
  mesh.box([-0.18, 3.55, 2.9], [0.18, 5.35, 3.26], dark);

  const camera = {
    position: [0.02, 2.28, 9.4],
    target: [-0.02, 2.24, 0],
    fovY: 47 * Math.PI / 180,
    near: 0.08,
    far: 32,
  };
  const view = lookAt(camera.position, camera.target, [0, 1, 0]);
  const projection = perspective(camera.fovY, width / height, camera.near, camera.far);
  const lightPosition = [-0.4, 5.0, -10.5];
  const lightTarget = [0.0, 1.5, 5.5];
  const lightDirection = normalizeVec(lightTarget.map((v, i) => v - lightPosition[i]));
  const lightView = lookAt(lightPosition, lightTarget, [0, 1, 0]);
  const lightProjection = perspective(52 * Math.PI / 180, 1, 0.12, 32);

  return {
    ...mesh.build(),
    camera,
    view,
    projection,
    viewProjection: multiply(projection, view),
    light: {
      position: lightPosition,
      target: lightTarget,
      direction: lightDirection,
      innerCos: Math.cos(5.5 * Math.PI / 180),
      outerCos: Math.cos(16 * Math.PI / 180),
      viewProjection: multiply(lightProjection, lightView),
      near: 0.12,
      far: 32,
    },
    slits: SLITS.map(({ min, max, width }) => ({ min, max, width })),
  };
}

function normalizeVec(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
