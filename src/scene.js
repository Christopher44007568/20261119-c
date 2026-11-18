/**
 * Deterministic synthetic test scene rendered with 4x4 supersampling in
 * linear (HDR-capable) colour. It deliberately contains:
 *   - a far wall with several very bright lights (bokeh sources);
 *   - a mid-ground target on the focal plane (checkerboard + marker);
 *   - a thin, dark foreground strip (the colour-leakage occluder);
 *   - a bright near-field sphere (foreground bokeh source).
 */
(function (global) {
  'use strict';

  function makeScene(width, height) {
    const data = new Float32Array(width * height * 3);
    const depth = new Float32Array(width * height).fill(Infinity);
    return { width, height, data, depth };
  }

  function paint(scene, x0, y0, x1, y1, rgb, z) {
    const w = scene.width, h = scene.height;
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
        const i = y * w + x;
        if (z < scene.depth[i]) {
          scene.depth[i] = z;
          scene.data[i * 3] = rgb[0];
          scene.data[i * 3 + 1] = rgb[1];
          scene.data[i * 3 + 2] = rgb[2];
        }
      }
    }
  }

  function fillRect(scene, rx0, ry0, rx1, ry1, rgb, z) {
    paint(scene, Math.floor(rx0), Math.floor(ry0), Math.ceil(rx1), Math.ceil(ry1), rgb, z);
  }

  function fillCircle(scene, cx, cy, radius, rgb, z) {
    const x0 = Math.floor(cx - radius), x1 = Math.ceil(cx + radius);
    const y0 = Math.floor(cy - radius), y1 = Math.ceil(cy + radius);
    const r2 = radius * radius;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) paint(scene, x, y, x + 1, y + 1, rgb, z);
      }
    }
  }

  function checker(scene, rx0, ry0, rx1, ry1, cell, za, zb, cA, cB) {
    for (let y = Math.floor(ry0); y < Math.ceil(ry1); y++) {
      for (let x = Math.floor(rx0); x < Math.ceil(rx1); x++) {
        const u = Math.floor((x - rx0) / cell);
        const v = Math.floor((y - ry0) / cell);
        const dark = ((u + v) & 1) === 0;
        paint(scene, x, y, x + 1, y + 1, dark ? cA : cB, dark ? za : zb);
      }
    }
  }

  function buildScene(width, height) {
    const ss = 4; // supersampling factor
    const W = width * ss, H = height * ss;
    const big = makeScene(W, H);
    const sx = W / width, sy = H / height;
    const Z_WALL = 40, Z_MID = 10, Z_NEAR = 3.2;

    // Far wall: dark blue-grey base with a depth gradient cue.
    for (let y = 0; y < H; y++) {
      const g = 0.05 + 0.08 * (y / H);
      fillRect(big, 0, y, W, y + 1, [g * 0.7, g * 0.8, g], Z_WALL);
    }

    // Bright HDR lights on the far wall (intensity > 1 -> visible bokeh).
    const lights = [
      [0.16, 0.28, [6.0, 1.2, 0.6]],
      [0.5, 0.16, [0.8, 2.0, 6.0]],
      [0.82, 0.3, [6.0, 5.0, 1.0]],
      [0.28, 0.72, [1.0, 5.5, 1.4]],
      [0.72, 0.78, [5.0, 1.5, 5.0]],
      // Deliberately behind the foreground strip: the leakage probe light.
      [0.4, 0.88, [7.0, 6.5, 2.0]],
    ];
    for (const [fx, fy, col] of lights) {
      fillCircle(big, fx * W, fy * H, 0.028 * W, col, Z_WALL - 0.01);
    }

    // Mid-ground checkerboard target sitting on the focal plane.
    checker(
      big, 0.3 * W, 0.32 * H, 0.66 * W, 0.74 * H, 0.045 * W,
      Z_MID, Z_MID, [0.18, 0.18, 0.2], [0.85, 0.85, 0.82]
    );
    fillCircle(big, 0.48 * W, 0.53 * H, 0.018 * W, [0.9, 0.15, 0.15], Z_MID - 0.01);

    // Bright near-field sphere: foreground bokeh source.
    fillCircle(big, 0.14 * W, 0.4 * H, 0.05 * W, [4.5, 4.2, 2.6], Z_NEAR + 0.4);

    // Thin dark foreground strip, slightly tilted, very close to the camera.
    // It crosses two bright wall lights so leakage is easy to spot.
    const cx = 0.4 * W, halfW = 0.014 * W;
    for (let y = 0; y < H; y++) {
      const tilt = 0.03 * W * (y / H - 0.5);
      fillRect(big, cx - halfW + tilt, y, cx + halfW + tilt, y + 1, [0.02, 0.02, 0.025], Z_NEAR);
    }

    // Downsample with a box filter.
    const out = makeScene(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, zSum = 0;
        for (let j = 0; j < ss; j++) {
          for (let i = 0; i < ss; i++) {
            const bi = (y * ss + j) * W + (x * ss + i);
            r += big.data[bi * 3]; g += big.data[bi * 3 + 1]; b += big.data[bi * 3 + 2];
            zSum += big.depth[bi];
          }
        }
        const oi = y * width + x;
        const inv = 1 / (ss * ss);
        out.data[oi * 3] = r * inv;
        out.data[oi * 3 + 1] = g * inv;
        out.data[oi * 3 + 2] = b * inv;
        out.depth[oi] = zSum * inv;
      }
    }
    out.farDepth = Z_WALL;
    out.nearDepth = Z_NEAR;
    out.focusDepth = Z_MID;
    return out;
  }

  const api = { makeScene, buildScene, fillRect, fillCircle, checker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DOF = Object.assign(global.DOF || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
