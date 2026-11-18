/**
 * Debug visualisations:
 *   - signed circle-of-confusion map (warm = near/positive, cool = far/neg);
 *   - layer map (foreground / focal / background tinting);
 *   - foreground coverage map for the colour-leakage check.
 * A compact 5x7 bitmap font is embedded for labels and colour bars.
 */
(function (global) {
  'use strict';

  const FONT = {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    '.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
    '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
    'p': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'x': ['00000', '10001', '01010', '00100', '01010', '10001', '00000'],
    'a': ['00000', '01110', '00001', '01111', '10001', '10001', '01111'],
    'b': ['10000', '10000', '11110', '10001', '10001', '10001', '11110'],
    'c': ['00000', '01111', '10000', '10000', '10000', '10000', '01111'],
    'd': ['00001', '00001', '01111', '10001', '10001', '10001', '01111'],
    'e': ['00000', '01110', '10001', '11111', '10000', '10000', '01110'],
    'f': ['00110', '01001', '01000', '11100', '01000', '01000', '01000'],
    'g': ['00000', '01111', '10001', '10001', '01111', '00001', '01110'],
    'h': ['10000', '10000', '11110', '10001', '10001', '10001', '10001'],
    'i': ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
    'l': ['01100', '00100', '00100', '00100', '00100', '00100', '01110'],
    'm': ['00000', '00000', '11010', '10101', '10101', '10101', '10101'],
    'n': ['00000', '00000', '11110', '10001', '10001', '10001', '10001'],
    'o': ['00000', '01110', '10001', '10001', '10001', '10001', '01110'],
    'r': ['00000', '00000', '11110', '10001', '10000', '10000', '10000'],
    's': ['00000', '01111', '10000', '01110', '00001', '00001', '11110'],
    't': ['01000', '01000', '11100', '01000', '01000', '01001', '00110'],
    'u': ['00000', '10001', '10001', '10001', '10001', '10001', '01111'],
    'v': ['00000', '10001', '10001', '10001', '10001', '01010', '00100'],
    'y': ['00000', '10001', '10001', '01111', '00001', '00010', '01100'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  };

  function drawText(image, text, x0, y0, scale, rgb) {
    let cx = x0;
    for (const ch of text.toLowerCase()) {
      const glyph = FONT[ch] || FONT[' '];
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (glyph[gy][gx] === '1') {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                const x = cx + gx * scale + sx;
                const y = y0 + gy * scale + sy;
                if (x >= 0 && x < image.width && y >= 0 && y < image.height) {
                  const i = (y * image.width + x) * 3;
                  image.data[i] = rgb[0];
                  image.data[i + 1] = rgb[1];
                  image.data[i + 2] = rgb[2];
                }
              }
            }
          }
        }
      }
      cx += 6 * scale;
    }
  }

  function emptyLike(image) {
    return {
      width: image.width,
      height: image.height,
      data: new Float32Array(image.width * image.height * 3),
      depth: new Float32Array(image.width * image.height),
    };
  }

  // Diverging map: t in [-1, 1]; negative -> blue, zero -> light grey, positive -> red.
  function diverging(t) {
    const a = Math.min(1, Math.abs(t));
    if (t > 0) return [0.85 * a + 0.8 * (1 - a), 0.25 * a + 0.8 * (1 - a), 0.2 * a + 0.8 * (1 - a)];
    return [0.2 * a + 0.8 * (1 - a), 0.4 * a + 0.8 * (1 - a), 0.9 * a + 0.8 * (1 - a)];
  }

  function cocMap(image, coc, maxCocPx) {
    const out = emptyLike(image);
    for (let i = 0; i < coc.length; i++) {
      const col = diverging(coc[i] / maxCocPx);
      out.data[i * 3] = col[0];
      out.data[i * 3 + 1] = col[1];
      out.data[i * 3 + 2] = col[2];
    }
    drawText(out, 'coc+px', 4, 4, 1, [0.05, 0.05, 0.05]);
    // Vertical colour bar with numeric end labels.
    const bx = out.width - 14, by0 = 12, bh = out.height - 28;
    for (let y = 0; y < bh; y++) {
      const t = 1 - 2 * y / bh;
      const col = diverging(t);
      for (let x = bx; x < bx + 8; x++) {
        const i = (y + by0) * out.width + x;
        out.data[i * 3] = col[0];
        out.data[i * 3 + 1] = col[1];
        out.data[i * 3 + 2] = col[2];
      }
    }
    drawText(out, '+' + maxCocPx.toFixed(0), 2, by0, 1, [0.05, 0.05, 0.05]);
    drawText(out, '-' + maxCocPx.toFixed(0), 2, by0 + bh - 7, 1, [0.05, 0.05, 0.05]);
    drawText(out, '0', bx + 1, (by0 + bh) / 2 - 3, 1, [0.05, 0.05, 0.05]);
    return out;
  }

  function layerMap(image, coc) {
    const out = emptyLike(image);
    for (let i = 0; i < coc.length; i++) {
      let col;
      if (coc[i] > 0) col = [0.9, 0.55, 0.35]; // foreground: orange
      else if (coc[i] < 0) col = [0.35, 0.5, 0.9]; // background: blue
      else col = [0.82, 0.82, 0.82]; // focal plane: grey
      out.data[i * 3] = col[0];
      out.data[i * 3 + 1] = col[1];
      out.data[i * 3 + 2] = col[2];
    }
    drawText(out, 'layers', 4, 4, 1, [0.05, 0.05, 0.05]);
    drawText(out, 'fg', 4, 14, 1, [0.5, 0.15, 0]);
    drawText(out, 'focal', 26, 14, 1, [0.2, 0.2, 0.2]);
    drawText(out, 'bg', 70, 14, 1, [0.05, 0.1, 0.5]);
    return out;
  }

  function coverageMap(image, coverage) {
    const out = emptyLike(image);
    for (let i = 0; i < coverage.length; i++) {
      const v = coverage[i];
      // Green = fully covered by near field; black = background visible.
      out.data[i * 3] = 0.1 * v;
      out.data[i * 3 + 1] = 0.9 * v;
      out.data[i * 3 + 2] = 0.25 * v;
    }
    drawText(out, 'fg coverage', 4, 4, 1, [1, 1, 1]);
    return out;
  }

  const api = { drawText, cocMap, layerMap, coverageMap, emptyLike };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DOF = Object.assign(global.DOF || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
