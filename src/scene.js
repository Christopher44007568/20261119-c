// Demo scene: a 2x2 grid of bicubic patches built from one shared
// control grid, so neighboring patches are C0 by construction.
//   - left column:  perfectly flat (all control points at y = 0)
//   - right column: curved (two bumps)
//   - the vertical shared edge is bowed in-plane, so even the flat
//     patches must negotiate a non-trivial edge tessellation.

import { Surface } from './surface.js';

export function buildDemoSurface(tolPx) {
  const GP = 7; // 2 patches per side -> 7x7 shared control points
  const pts = [];
  for (let gx = 0; gx < GP; gx++) {
    pts.push([]);
    for (let gz = 0; gz < GP; gz++) {
      const x = -2 + (gx / (GP - 1)) * 4;
      const z = -2 + (gz / (GP - 1)) * 4;
      let y = 0;
      if (x > 0) {
        // Curved right half, smoothly rising from the shared edge.
        const b1 = 1.15 * Math.exp(-((x - 1.15) ** 2 + (z - 0.55) ** 2) / 0.45);
        const b2 = 0.8 * Math.exp(-((x - 0.85) ** 2 + (z + 1.05) ** 2) / 0.3);
        const ramp = Math.min(1, x / 0.45); // C0-ish ramp near x = 0
        y = (b1 + b2) * ramp;
      }
      // Bow the vertical shared edge (gx = 3) in-plane so it is curved
      // even though the surface stays flat there.
      const bow = gx === 3 ? 0.35 * Math.sin(z * 1.9) : 0;
      pts[gx].push([x + bow, y, z]);
    }
  }

  const surface = new Surface(tolPx);
  const patchAt = (pi, pz) => {
    const ctrl = [];
    for (let i = 0; i < 4; i++) {
      ctrl.push([]);
      for (let j = 0; j < 4; j++) {
        ctrl[i].push(pts[pi * 3 + i][pz * 3 + j]);
      }
    }
    return surface.addPatch(ctrl);
  };

  const A = patchAt(0, 0); // flat,  bottom-left
  const B = patchAt(1, 0); // curved, bottom-right
  const C = patchAt(0, 1); // flat,  top-left
  const D = patchAt(1, 1); // curved, top-right

  // Shared edges: right of A/C with left of B/D; top of A/B with bottom of C/D.
  surface.link(A, 1, B, 0);
  surface.link(C, 1, D, 0);
  surface.link(A, 3, C, 2);
  surface.link(B, 3, D, 2);

  return { surface, pts, patches: { A, B, C, D } };
}
