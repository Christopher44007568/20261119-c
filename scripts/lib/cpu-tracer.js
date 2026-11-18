"use strict";

const PI = Math.PI;
const EPS = 2.5e-4;
const LIGHT_Y = 3.72;
const LIGHT_MIN = { x: -2.25, z: -1.75 };
const LIGHT_MAX = { x: 2.25, z: 1.55 };
const LIGHT_AREA = (LIGHT_MAX.x - LIGHT_MIN.x) * (LIGHT_MAX.z - LIGHT_MIN.z);
const EMISSION = [7.2, 5.55, 3.75];

const DEFAULT_SCENE = Object.freeze({
  metalRoughness: 0.105,
  glossyRoughness: 0.055,
  diffuseRoughness: 0.82
});

let scene = { ...DEFAULT_SCENE };
let rngState = 1;
let hitT = Infinity;
let hitId = -1;
let hitNx = 0;
let hitNy = 1;
let hitNz = 0;
let outR = 0;
let outG = 0;
let outB = 0;

function configure(options = {}) {
  scene = { ...DEFAULT_SCENE, ...options };
}

function rand() {
  rngState = (Math.imul(rngState, 747796405) + 2891336453) >>> 0;
  const shift = (rngState >>> 28) + 4;
  let word = Math.imul(((rngState >>> shift) ^ rngState) >>> 0, 277803737) >>> 0;
  word = ((word >>> 22) ^ word) >>> 0;
  return word / 4294967296;
}

function seedPath(x, y, sample) {
  let seed = (x + Math.imul(1973, y + Math.imul(9277, sample + 1))) >>> 0;
  seed = (seed ^ (seed >>> 16)) >>> 0;
  rngState = seed || 0x9e3779b9;
}

function length3(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}

function intersectSphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius) {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const root = Math.sqrt(Math.max(disc, 0));
  const near = -b - root;
  const far = -b + root;
  const t = near > EPS ? near : far;
  return t > EPS ? t : Infinity;
}

function roomHit(ox, oy, oz, dx, dy, dz) {
  const invX = 1 / dx;
  const invY = 1 / dy;
  const invZ = 1 / dz;
  const ax = (-4.8 - ox) * invX;
  const bx = (4.8 - ox) * invX;
  const ay = (0 - oy) * invY;
  const by = (6 - oy) * invY;
  const az = (-4 - oz) * invZ;
  const bz = (5 - oz) * invZ;
  const nx = Math.min(ax, bx);
  const ny = Math.min(ay, by);
  const nz = Math.min(az, bz);
  const fx = Math.max(ax, bx);
  const fy = Math.max(ay, by);
  const fz = Math.max(az, bz);
  const enter = Math.max(nx, Math.max(ny, nz));
  const exitT = Math.min(fx, Math.min(fy, fz));
  if (exitT < Math.max(enter, 0) || exitT <= EPS) return Infinity;
  if (Math.abs(exitT - fx) < 1e-5) {
    hitNx = -Math.sign(dx); hitNy = 0; hitNz = 0;
  } else if (Math.abs(exitT - fy) < 1e-5) {
    hitNx = 0; hitNy = -Math.sign(dy); hitNz = 0;
  } else {
    hitNx = 0; hitNy = 0; hitNz = -Math.sign(dz);
  }
  return exitT;
}

function lightHit(ox, oy, oz, dx, dy, dz) {
  if (Math.abs(dy) < 1e-7) return Infinity;
  const t = (LIGHT_Y - oy) / dy;
  if (t <= EPS) return Infinity;
  const px = ox + dx * t;
  const pz = oz + dz * t;
  if (px < LIGHT_MIN.x || px > LIGHT_MAX.x || pz < LIGHT_MIN.z || pz > LIGHT_MAX.z) {
    return Infinity;
  }
  return t;
}

function hitScene(ox, oy, oz, dx, dy, dz) {
  hitT = roomHit(ox, oy, oz, dx, dy, dz);
  hitId = hitT < Infinity ? 0 : -1;
  let t = intersectSphere(ox, oy, oz, dx, dy, dz, -1.34, 0.89, -0.18, 0.89);
  if (t < hitT) { hitT = t; hitId = 1; }
  t = intersectSphere(ox, oy, oz, dx, dy, dz, 0.69, 0.70, 0.02, 0.70);
  if (t < hitT) { hitT = t; hitId = 2; }
  t = intersectSphere(ox, oy, oz, dx, dy, dz, 1.57, 0.44, 1.03, 0.44);
  if (t < hitT) { hitT = t; hitId = 3; }
  t = lightHit(ox, oy, oz, dx, dy, dz);
  if (t < hitT) { hitT = t; hitId = 4; }

  if (hitId === 1) {
    hitNx = (ox + dx * hitT + 1.34) / 0.89;
    hitNy = (oy + dy * hitT - 0.89) / 0.89;
    hitNz = (oz + dz * hitT + 0.18) / 0.89;
  } else if (hitId === 2) {
    hitNx = (ox + dx * hitT - 0.69) / 0.70;
    hitNy = (oy + dy * hitT - 0.70) / 0.70;
    hitNz = (oz + dz * hitT - 0.02) / 0.70;
  } else if (hitId === 3) {
    hitNx = (ox + dx * hitT - 1.57) / 0.44;
    hitNy = (oy + dy * hitT - 0.44) / 0.44;
    hitNz = (oz + dz * hitT - 1.03) / 0.44;
  } else if (hitId === 4) {
    hitNx = 0; hitNy = -1; hitNz = 0;
  }
  return hitId >= 0;
}

function fresnelScalar(f0, vdotH) {
  const x = Math.max(0, Math.min(1, 1 - vdotH));
  const x2 = x * x;
  return Math.max(0, Math.min(1, f0 + (1 - f0) * x2 * x2 * x));
}

function g1(ndotv, alpha) {
  const v = Math.max(ndotv, 0);
  const a2 = alpha * alpha;
  return 2 * v / Math.max(v + Math.sqrt(a2 + (1 - a2) * v * v), 1e-6);
}

function materialFor(id, px, py, pz, nx, ny, nz) {
  if (id === 1) return { r: 0.61, g: 0.235, b: 0.095, rough: scene.diffuseRoughness, type: 0 };
  if (id === 2) return { r: 0.70, g: 0.72, b: 0.67, rough: scene.metalRoughness, type: 1 };
  if (id === 3) return { r: 0.105, g: 0.43, b: 0.39, rough: scene.glossyRoughness, type: 2 };
  if (id === 4) return { r: EMISSION[0], g: EMISSION[1], b: EMISSION[2], rough: 1, type: 3 };
  if (ny > 0.5) {
    const cellX = Math.floor(px * 1.35);
    const cellZ = Math.floor(pz * 1.35);
    const variation = Math.abs(Math.sin(cellX * 41.3 + cellZ * 289.7) * 45758.5453) % 1;
    const gain = 0.91 + variation * 0.12;
    return { r: 0.40 * gain, g: 0.365 * gain, b: 0.30 * gain, rough: 0.72, type: 0 };
  }
  if (nz < -0.5) return { r: 0.115, g: 0.195, b: 0.165, rough: 0.85, type: 0 };
  if (nx < -0.5) return { r: 0.46, g: 0.39, b: 0.30, rough: 0.82, type: 0 };
  if (nx > 0.5) return { r: 0.25, g: 0.285, b: 0.25, rough: 0.82, type: 0 };
  return { r: 0.36, g: 0.37, b: 0.33, rough: 0.82, type: 0 };
}

let wiX = 0;
let wiY = 0;
let wiZ = 0;

function cosineSample(nx, ny, nz) {
  const u1 = rand();
  const u2 = rand();
  const phi = 2 * PI * u1;
  const radius = Math.sqrt(u2);
  let tx;
  let ty;
  let tz;
  if (Math.abs(ny) < 0.999) {
    tx = nz; ty = 0; tz = -nx;
  } else {
    tx = 0; ty = -nz; tz = ny;
  }
  let tl = length3(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  const bx = ny * tz - nz * ty;
  const by = nz * tx - nx * tz;
  const bz = nx * ty - ny * tx;
  wiX = tx * (Math.cos(phi) * radius) + bx * (Math.sin(phi) * radius) + nx * Math.sqrt(Math.max(1 - u2, 0));
  wiY = ty * (Math.cos(phi) * radius) + by * (Math.sin(phi) * radius) + ny * Math.sqrt(Math.max(1 - u2, 0));
  wiZ = tz * (Math.cos(phi) * radius) + bz * (Math.sin(phi) * radius) + nz * Math.sqrt(Math.max(1 - u2, 0));
  tl = length3(wiX, wiY, wiZ) || 1;
  wiX /= tl; wiY /= tl; wiZ /= tl;
}

function specularSample(wox, woy, woz, nx, ny, nz, roughnessValue) {
  const vn = wox * nx + woy * ny + woz * nz;
  const mirrorX = -wox + 2 * vn * nx;
  const mirrorY = -woy + 2 * vn * ny;
  const mirrorZ = -woz + 2 * vn * nz;
  const roughness = Math.max(roughnessValue, 0);
  if (roughness <= 1e-4) {
    wiX = mirrorX; wiY = mirrorY; wiZ = mirrorZ;
    return;
  }
  const alpha = Math.max(roughness * roughness, 1e-4);
  const u1 = rand();
  const u2 = rand();
  const phi = 2 * PI * u1;
  const cosTheta = Math.sqrt((1 - u2) / Math.max(1 + (alpha * alpha - 1) * u2, 1e-7));
  const sinTheta = Math.sqrt(Math.max(1 - cosTheta * cosTheta, 0));
  let tx;
  let ty;
  let tz;
  if (Math.abs(ny) < 0.999) {
    tx = nz; ty = 0; tz = -nx;
  } else {
    tx = 0; ty = -nz; tz = ny;
  }
  let tl = length3(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  const bx = ny * tz - nz * ty;
  const by = nz * tx - nx * tz;
  const bz = nx * ty - ny * tx;
  let hx = tx * (Math.cos(phi) * sinTheta) + bx * (Math.sin(phi) * sinTheta) + nx * cosTheta;
  let hy = ty * (Math.cos(phi) * sinTheta) + by * (Math.sin(phi) * sinTheta) + ny * cosTheta;
  let hz = tz * (Math.cos(phi) * sinTheta) + bz * (Math.sin(phi) * sinTheta) + nz * cosTheta;
  tl = length3(hx, hy, hz) || 1;
  hx /= tl; hy /= tl; hz /= tl;
  const wh = wox * hx + woy * hy + woz * hz;
  wiX = -wox + 2 * wh * hx;
  wiY = -woy + 2 * wh * hy;
  wiZ = -woz + 2 * wh * hz;
  if (wiX * nx + wiY * ny + wiZ * nz <= EPS) {
    wiX = mirrorX; wiY = mirrorY; wiZ = mirrorZ;
  }
  tl = length3(wiX, wiY, wiZ) || 1;
  wiX /= tl; wiY /= tl; wiZ /= tl;
}

function occluded(ox, oy, oz, dx, dy, dz, limit) {
  if (intersectSphere(ox, oy, oz, dx, dy, dz, -1.34, 0.89, -0.18, 0.89) < limit - EPS) return true;
  if (intersectSphere(ox, oy, oz, dx, dy, dz, 0.69, 0.70, 0.02, 0.70) < limit - EPS) return true;
  if (intersectSphere(ox, oy, oz, dx, dy, dz, 1.57, 0.44, 1.03, 0.44) < limit - EPS) return true;
  return roomHit(ox, oy, oz, dx, dy, dz) < limit - EPS;
}

let directR = 0;
let directG = 0;
let directB = 0;

function directLight(px, py, pz, nx, ny, nz, ar, ag, ab) {
  directR = directG = directB = 0;
  if (py >= LIGHT_Y - EPS) return;
  const lx = LIGHT_MIN.x + (LIGHT_MAX.x - LIGHT_MIN.x) * rand();
  const lz = LIGHT_MIN.z + (LIGHT_MAX.z - LIGHT_MIN.z) * rand();
  const tx = lx - px;
  const ty = LIGHT_Y - py;
  const tz = lz - pz;
  const distance2 = tx * tx + ty * ty + tz * tz;
  if (distance2 < 1e-8) return;
  const distance = Math.sqrt(distance2);
  const ux = tx / distance;
  const uy = ty / distance;
  const uz = tz / distance;
  const cosSurface = nx * ux + ny * uy + nz * uz;
  const cosLight = ty / distance;
  if (cosSurface <= 0 || cosLight <= 0) return;
  if (occluded(px + nx * EPS, py + ny * EPS, pz + nz * EPS, ux, uy, uz, distance)) return;
  const weight = cosSurface * cosLight * LIGHT_AREA / (distance2 * PI);
  directR = ar * EMISSION[0] * weight;
  directG = ag * EMISSION[1] * weight;
  directB = ab * EMISSION[2] * weight;
}

function tracePath(ox, oy, oz, dx, dy, dz) {
  let radianceR = 0;
  let radianceG = 0;
  let radianceB = 0;
  let throughR = 1;
  let throughG = 1;
  let throughB = 1;
  let lastWasSpecular = true;

  for (let bounce = 0; bounce < 7; bounce++) {
    if (!hitScene(ox, oy, oz, dx, dy, dz)) break;
    if (hitT >= 1e29) break;
    const px = ox + dx * hitT;
    const py = oy + dy * hitT;
    const pz = oz + dz * hitT;
    const id = hitId;

    if (id === 4) {
      if (bounce === 0 || lastWasSpecular) {
        radianceR += throughR * EMISSION[0];
        radianceG += throughG * EMISSION[1];
        radianceB += throughB * EMISSION[2];
      }
      break;
    }

    let nx = hitNx;
    let ny = hitNy;
    let nz = hitNz;
    let nl = length3(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    let wox = -dx;
    let woy = -dy;
    let woz = -dz;
    if (nx * wox + ny * woy + nz * woz < 0) {
      nx = -nx; ny = -ny; nz = -nz;
    }

    const mat = materialFor(id, px, py, pz, nx, ny, nz);
    if (mat.type === 0) {
      directLight(px, py, pz, nx, ny, nz, mat.r, mat.g, mat.b);
      radianceR += throughR * directR;
      radianceG += throughG * directG;
      radianceB += throughB * directB;
      cosineSample(nx, ny, nz);
      if (wiX * nx + wiY * ny + wiZ * nz <= EPS) break;
      throughR *= mat.r;
      throughG *= mat.g;
      throughB *= mat.b;
      lastWasSpecular = false;
    } else {
      const f0r = mat.type === 1 ? Math.max(0, Math.min(1, mat.r)) : 0.055 * 0.38 + mat.r * 0.62;
      const f0g = mat.type === 1 ? Math.max(0, Math.min(1, mat.g)) : 0.055 * 0.38 + mat.g * 0.62;
      const f0b = mat.type === 1 ? Math.max(0, Math.min(1, mat.b)) : 0.055 * 0.38 + mat.b * 0.62;
      specularSample(wox, woy, woz, nx, ny, nz, mat.rough);
      const ndotl = wiX * nx + wiY * ny + wiZ * nz;
      if (ndotl <= EPS) break;
      const ndotv = Math.max(wox * nx + woy * ny + woz * nz, EPS);
      let hx = wox + wiX;
      let hy = woy + wiY;
      let hz = woz + wiZ;
      let hl = length3(hx, hy, hz) || 1;
      hx /= hl; hy /= hl; hz /= hl;
      const vdoth = Math.max(0, Math.min(1, wox * hx + woy * hy + woz * hz));
      const fr = fresnelScalar(f0r, vdoth);
      const fg = fresnelScalar(f0g, vdoth);
      const fb = fresnelScalar(f0b, vdoth);
      let weight = 1;
      if (mat.rough > 1e-4) {
        const alpha = Math.max(mat.rough * mat.rough, 1e-4);
        const ndoth = Math.max(nx * hx + ny * hy + nz * hz, 1e-4);
        weight = g1(ndotl, alpha) * Math.max(0, Math.min(1, vdoth / ndoth));
      }
      throughR = Math.max(0, Math.min(1, throughR * fr * weight));
      throughG = Math.max(0, Math.min(1, throughG * fg * weight));
      throughB = Math.max(0, Math.min(1, throughB * fb * weight));
      lastWasSpecular = true;
    }

    ox = px + nx * EPS;
    oy = py + ny * EPS;
    oz = pz + nz * EPS;
    dx = wiX;
    dy = wiY;
    dz = wiZ;
    const survival = Math.max(0, Math.min(0.99, Math.max(throughR, Math.max(throughG, throughB))));
    if (bounce >= 3) {
      if (rand() > survival || survival <= 1e-5) break;
      throughR /= survival;
      throughG /= survival;
      throughB /= survival;
    }
    if (Math.max(throughR, Math.max(throughG, throughB)) <= 0) break;
  }

  outR = radianceR;
  outG = radianceG;
  outB = radianceB;
  if (!Number.isFinite(outR) || !Number.isFinite(outG) || !Number.isFinite(outB)) {
    outR = outG = outB = 0;
  }
  outR = Math.max(0, Math.min(64, outR));
  outG = Math.max(0, Math.min(64, outG));
  outB = Math.max(0, Math.min(64, outB));
}

function cameraFrame(camera = {}) {
  const yaw = camera.yaw ?? 0.035;
  const pitch = camera.pitch ?? 0.047;
  const distance = camera.distance ?? 4.72;
  const target = camera.target || [0, 0.98, -0.12];
  const cp = Math.cos(pitch);
  const eye = [
    target[0] + Math.sin(yaw) * cp * distance,
    target[1] + Math.sin(pitch) * distance,
    target[2] + Math.cos(yaw) * cp * distance
  ];
  let fx = target[0] - eye[0];
  let fy = target[1] - eye[1];
  let fz = target[2] - eye[2];
  let fl = length3(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz;
  let ry = 0;
  let rz = fx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  return {
    eye,
    forward: [fx, fy, fz],
    right: [rx, ry, rz],
    up: [ry * fz - rz * fy, rz * fx - rx * fz, rx * fy - ry * fx],
    fov: camera.fov ?? 42
  };
}

function renderBand(options) {
  const {
    width,
    height,
    startRow,
    rows,
    samples,
    milestones = [],
    camera,
    scene: sceneOverrides,
    onSample
  } = options;
  configure(sceneOverrides);
  const frame = cameraFrame(camera);
  const aspect = width / height;
  const tanHalf = Math.tan(frame.fov * Math.PI / 360);
  const accum = new Float32Array(width * rows * 3);
  const snapshots = {};

  for (let sample = 0; sample < samples; sample++) {
    for (let localY = 0; localY < rows; localY++) {
      const y = startRow + localY;
      for (let x = 0; x < width; x++) {
        seedPath(x, y, sample);
        const jitterX = rand();
        const jitterY = rand();
        const uvx = (x + jitterX) / width;
        const uvy = (y + jitterY) / height;
        const px = (uvx * 2 - 1) * tanHalf * aspect;
        const py = (uvy * 2 - 1) * tanHalf;
        let dx = frame.forward[0] + frame.right[0] * px + frame.up[0] * py;
        let dy = frame.forward[1] + frame.right[1] * px + frame.up[1] * py;
        let dz = frame.forward[2] + frame.right[2] * px + frame.up[2] * py;
        const dl = length3(dx, dy, dz) || 1;
        dx /= dl; dy /= dl; dz /= dl;
        tracePath(frame.eye[0], frame.eye[1], frame.eye[2], dx, dy, dz);
        const index = (localY * width + x) * 3;
        accum[index] += outR;
        accum[index + 1] += outG;
        accum[index + 2] += outB;
      }
    }
    if (milestones.includes(sample + 1)) snapshots[sample + 1] = new Float32Array(accum);
    if (onSample && ((sample + 1) % 16 === 0 || sample + 1 === samples)) onSample(sample + 1);
  }

  return { startRow, rows, accum, snapshots };
}

module.exports = {
  DEFAULT_SCENE,
  EMISSION,
  cameraFrame,
  configure,
  renderBand,
  tracePath
};
