// Vite wraps the UMD CommonJS sources into ESM default exports at build time.
import engine from '../src/engine.js';
import dofMod from '../src/dof.js';

const W = 640, H = 400;
const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const readout = document.getElementById('readout');

// --- Browser-side scene: mirrors src/scene.js geometry at a fixed size. ---
function buildScene() {
  const image = engine.createImage(W, H);
  const put = (x, y, rgb, z) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (z < image.depth[i]) {
      image.depth[i] = z;
      image.data[i * 3] = rgb[0];
      image.data[i * 3 + 1] = rgb[1];
      image.data[i * 3 + 2] = rgb[2];
    }
  };
  const rect = (x0, y0, x1, y1, rgb, z) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) put(x, y, rgb, z);
  };
  const circle = (cx, cy, r, rgb, z) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) put(x, y, rgb, z);
      }
  };

  const Z_WALL = 40, Z_MID = 10, Z_NEAR = 3.2;
  for (let y = 0; y < H; y++) {
    const g = 0.05 + 0.08 * (y / H);
    rect(0, y, W, y + 1, [g * 0.7, g * 0.8, g], Z_WALL);
  }
  const lights = [
    [0.16, 0.28, [6, 1.2, 0.6]], [0.5, 0.16, [0.8, 2, 6]],
    [0.82, 0.3, [6, 5, 1]], [0.28, 0.72, [1, 5.5, 1.4]],
    [0.72, 0.78, [5, 1.5, 5]], [0.4, 0.88, [7, 6.5, 2]],
  ];
  for (const [fx, fy, col] of lights) circle(fx * W, fy * H, 0.028 * W, col, Z_WALL - 0.01);

  const cell = 0.045 * W;
  for (let y = Math.floor(0.32 * H); y < 0.74 * H; y++) {
    for (let x = Math.floor(0.3 * W); x < 0.66 * W; x++) {
      const dark = ((Math.floor((x - 0.3 * W) / cell) + Math.floor((y - 0.32 * H) / cell)) & 1) === 0;
      put(x, y, dark ? [0.18, 0.18, 0.2] : [0.85, 0.85, 0.82], Z_MID);
    }
  }
  circle(0.48 * W, 0.53 * H, 0.018 * W, [0.9, 0.15, 0.15], Z_MID - 0.01);
  circle(0.14 * W, 0.4 * H, 0.05 * W, [4.5, 4.2, 2.6], Z_NEAR + 0.4);

  const cx = 0.4 * W, halfW = 0.014 * W;
  for (let y = 0; y < H; y++) {
    const tilt = 0.03 * W * (y / H - 0.5);
    rect(cx - halfW + tilt, y, cx + halfW + tilt, y + 1, [0.02, 0.02, 0.025], Z_NEAR);
  }
  return { image, Z_WALL, Z_MID, Z_NEAR };
}

const { image, Z_NEAR, Z_MID, Z_WALL } = buildScene();
const referenceWidth = W;

function diverging(t) {
  const a = Math.min(1, Math.abs(t));
  if (t > 0) return [0.85 * a + 0.8 * (1 - a), 0.25 * a + 0.8 * (1 - a), 0.2 * a + 0.8 * (1 - a)];
  return [0.2 * a + 0.8 * (1 - a), 0.4 * a + 0.8 * (1 - a), 0.9 * a + 0.8 * (1 - a)];
}

function present(mode, result, coc, maxCoc) {
  const img = ctx.createImageData(W, H);
  const tonemap = (v) => {
    v = Math.max(0, v);
    v = v / (1 + v);
    return Math.min(255, Math.round(255 * Math.pow(v, 1 / 2.2)));
  };
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    let r, g, b;
    if (mode === 'coc') {
      [r, g, b] = diverging(coc[i] / maxCoc);
      r *= 255; g *= 255; b *= 255;
    } else if (mode === 'layers') {
      const col = coc[i] > 0 ? [0.9, 0.55, 0.35] : coc[i] < 0 ? [0.35, 0.5, 0.9] : [0.82, 0.82, 0.82];
      r = col[0] * 255; g = col[1] * 255; b = col[2] * 255;
    } else if (mode === 'coverage') {
      r = 0.1 * result.fgCoverage[i] * 255;
      g = 0.9 * result.fgCoverage[i] * 255;
      b = 0.25 * result.fgCoverage[i] * 255;
    } else {
      const src = mode === 'original' ? image.data : result.data;
      r = tonemap(src[i * 3]); g = tonemap(src[i * 3 + 1]); b = tonemap(src[i * 3 + 2]);
    }
    img.data[p] = r;
    img.data[p + 1] = g;
    img.data[p + 2] = b;
    img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

const ids = ['aperture', 'focus', 'fgScale', 'bgScale', 'maxCoc', 'scaleMode', 'viewMode'];
const state = {};

function render() {
  ids.forEach((id) => { state[id] = document.getElementById(id).value; });
  document.getElementById('apertureVal').textContent = Number(state.aperture).toFixed(1);
  document.getElementById('focusVal').textContent = Number(state.focus).toFixed(1);
  document.getElementById('fgVal').textContent = Number(state.fgScale).toFixed(2);
  document.getElementById('bgVal').textContent = Number(state.bgScale).toFixed(2);
  document.getElementById('maxVal').textContent = state.maxCoc;

  const params = engine.defaultParams({
    width: W, referenceWidth, focusDistance: Number(state.focus),
    aperture: Number(state.aperture), focalLength: 0.085,
    foregroundScale: Number(state.fgScale), backgroundScale: Number(state.bgScale),
    maxCocPx: Number(state.maxCoc), scaleMode: state.scaleMode,
  });
  const coc = engine.computeCoc(image.depth, params);
  const result = params.aperture > 0
    ? dofMod.depthOfField(image, params, coc)
    : { data: image.data.slice(), fgCoverage: new Float32Array(W * H) };
  present(state.viewMode, result, coc, params.maxCocPx);

  const near = coc.find((v) => v > 0) ? Math.max(...coc) : 0;
  const far = coc.find((v) => v < 0) ? Math.min(...coc) : 0;
  readout.textContent =
    `aperture f${params.aperture}  focus ${params.focusDistance}\n` +
    `CoC near +${near.toFixed(1)}px  far ${far.toFixed(1)}px  cap ${params.maxCocPx}px [${params.scaleMode}]`;
}

ids.forEach((id) => document.getElementById(id).addEventListener('input', render));
render();
