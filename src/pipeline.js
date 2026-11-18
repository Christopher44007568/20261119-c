/**
 * High-level pipeline shared by the CLI and the browser demo.
 */
(function (global) {
  'use strict';

  const engine = require('./engine');
  const dof = require('./dof');

  // Full DOF run: signed CoC -> layered gather.
  function runDoF(image, params) {
    const coc = engine.computeCoc(image.depth, params);
    if (!(params.aperture > 0)) {
      return {
        width: image.width,
        height: image.height,
        data: image.data.slice(),
        depth: image.depth,
        fgCoverage: new Float32Array(image.width * image.height),
        coc,
      };
    }
    const result = dof.depthOfField(image, params, coc);
    result.coc = coc;
    return result;
  }

  // A single HDR image with a depth field; used by the unit tests.
  function impulseImage(width, height, cx, cy, radius, rgb, z, bgZ) {
    const image = engine.createImage(width, height);
    for (let i = 0; i < image.depth.length; i++) image.depth[i] = bgZ;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = y * width + x;
        image.data[i * 3] = rgb[0];
        image.data[i * 3 + 1] = rgb[1];
        image.data[i * 3 + 2] = rgb[2];
        image.depth[i] = z;
      }
    }
    return image;
  }

  const api = { runDoF, impulseImage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DOF = Object.assign(global.DOF || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
