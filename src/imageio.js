/**
 * PNG I/O (pngjs) plus linear-HDR -> display conversion and debug montage.
 */
(function (global) {
  'use strict';

  const PNG = require('pngjs').PNG;
  const fs = require('fs');

  // ACES-ish / Reinhard compression of HDR linear values, then sRGB encode.
  function tonemap(x, exposure) {
    x = Math.max(0, x * exposure);
    x = x / (1 + x); // Reinhard: bounded highlights -> finite bokeh discs
    x = Math.pow(x, 1 / 2.2);
    return Math.min(255, Math.round(x * 255));
  }

  function linearToPng(image, exposure) {
    const exp = exposure == null ? 1 : exposure;
    const png = new PNG({ width: image.width, height: image.height });
    const src = image.data;
    for (let i = 0, p = 0; i < src.length; i += 3, p += 4) {
      png.data[p] = tonemap(src[i], exp);
      png.data[p + 1] = tonemap(src[i + 1], exp);
      png.data[p + 2] = tonemap(src[i + 2], exp);
      png.data[p + 3] = 255;
    }
    return png;
  }

  function savePng(path, image, exposure) {
    const png = linearToPng(image, exposure);
    fs.writeFileSync(path, PNG.sync.write(png));
  }

  function readPng(path) {
    const buf = fs.readFileSync(path);
    const png = PNG.sync.read(buf);
    const image = {
      width: png.width,
      height: png.height,
      data: new Float32Array(png.width * png.height * 3),
      depth: new Float32Array(png.width * png.height),
    };
    for (let i = 0, p = 0; p < png.data.length; i += 3, p += 4) {
      image.data[i] = Math.pow(png.data[p] / 255, 2.2);
      image.data[i + 1] = Math.pow(png.data[p + 1] / 255, 2.2);
      image.data[i + 2] = Math.pow(png.data[p + 2] / 255, 2.2);
    }
    return image;
  }

  // Combine panels into one grid image; every panel gets a caption bar so the
  // cells stay perfectly aligned (no black gaps from mixed dimensions).
  function montage(panels, cols, captionHeight) {
    const rows = Math.ceil(panels.length / cols);
    const w = Math.max(...panels.map((p) => p.image.width));
    const h = Math.max(...panels.map((p) => p.image.height));
    const bar = captionHeight || 0;
    const cellH = h + bar;
    const gap = 3;
    const out = {
      width: cols * w + (cols - 1) * gap,
      height: rows * cellH + (rows - 1) * gap,
      data: new Float32Array(
        (cols * w + (cols - 1) * gap) * (rows * cellH + (rows - 1) * gap) * 3
      ),
      depth: new Float32Array(
        (cols * w + (cols - 1) * gap) * (rows * cellH + (rows - 1) * gap)
      ),
    };
    panels.forEach((panel, k) => {
      const col = k % cols, row = (k / cols) | 0;
      const ox = col * (w + gap), oy = row * (cellH + gap) + bar;
      const img = panel.image;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const si = (y * img.width + x) * 3;
          const di = ((oy + y) * out.width + ox + x) * 3;
          out.data[di] = img.data[si];
          out.data[di + 1] = img.data[si + 1];
          out.data[di + 2] = img.data[si + 2];
        }
      }
    });
    return out;
  }

  const api = { tonemap, linearToPng, savePng, readPng, montage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DOF = Object.assign(global.DOF || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
