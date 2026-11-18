/**
 * Depth-aware "circle of confusion" gather renderer.
 *
 * Background pass: only samples at/behind the focal plane are allowed, so a
 * foreground occluder is replaced by what lies behind it rather than being
 * smeared over the image. Foreground pass: only nearer samples contribute and
 * they are coverage weighted, which keeps a thin near-field occluder opaque
 * to background bokeh (no colour leaking through its centre).
 */
(function (global) {
  'use strict';

  function buildDisks(maxRadius) {
    const rMax = Math.max(1, Math.ceil(maxRadius));
    const disks = new Array(rMax + 1);
    for (let r = 1; r <= rMax; r++) {
      const offsets = [];
      const r2 = r * r;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r2) offsets.push(dx, dy);
        }
      }
      disks[r] = new Int16Array(offsets);
    }
    return disks;
  }

  function clampIndex(v, high) {
    return v < 0 ? 0 : v > high ? high : v;
  }

  function depthOfField(image, params, coc) {
    const w = image.width;
    const h = image.height;
    const n = w * h;
    const src = image.data;
    const out = new Float32Array(n * 3);
    const disks = buildDisks(params.maxCocPx);
    const eps = 1e-6;

    // Foreground coverage for the debug/leakage visualisation.
    const fgCoverage = new Float32Array(n);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const c = coc[idx];

        if (c === 0) {
          // Focal band: untouched original pixels, edges stay perfectly sharp.
          out[idx * 3] = src[idx * 3];
          out[idx * 3 + 1] = src[idx * 3 + 1];
          out[idx * 3 + 2] = src[idx * 3 + 2];
          fgCoverage[idx] = 0;
          continue;
        }

        // Symmetric gather radius: a blurred foreground pixel must be able to
        // spread onto neighbouring in-focus pixels.
        const radius = Math.min(Math.ceil(Math.abs(c)), disks.length - 1);
        const offsets = disks[radius];

        let bgW = 0;
        let bgR = 0, bgG = 0, bgB = 0;
        let fgW = 0, fgCount = 0;
        let fgR = 0, fgG = 0, fgB = 0;
        const diskSamples = offsets.length / 2;

        for (let k = 0; k < offsets.length; k += 2) {
          const sx = clampIndex(x + offsets[k], w - 1);
          const sy = clampIndex(y + offsets[k + 1], h - 1);
          const si = sy * w + sx;
          const cs = coc[si];
          const pr = src[si * 3], pg = src[si * 3 + 1], pb = src[si * 3 + 2];

          if (cs <= 0) {
            // In-focus or background sample.
            bgW += 1;
            bgR += pr; bgG += pg; bgB += pb;
          } else {
            // Foreground sample, active only within its own blur circle.
            const d2 = offsets[k] * offsets[k] + offsets[k + 1] * offsets[k + 1];
            if (d2 <= cs * cs) {
              const weight = 1 / (Math.PI * cs * cs);
              fgW += weight;
              fgCount += 1;
              fgR += pr * weight;
              fgG += pg * weight;
              fgB += pb * weight;
            }
          }
        }

        if (bgW > 0) {
          bgR /= bgW; bgG /= bgW; bgB /= bgW;
        }

        // Fill ratio measures the fraction of the blur disc covered by solid
        // near-field pixels: a solid foreground surface reaches ~1 and stays
        // fully opaque, while sparse discs fall back to the Poisson estimate so
        // a genuinely thin out-of-focus occluder can reveal what is behind it.
        const fillRatio = fgCount / diskSamples;
        let coverage = Math.max(fillRatio, 1 - Math.exp(-fgW));
        if (coverage > 1) coverage = 1;
        fgCoverage[idx] = coverage;

        if (fgW > eps) {
          fgR /= fgW; fgG /= fgW; fgB /= fgW;
        }

        const keep = 1 - coverage;
        out[idx * 3] = keep * bgR + coverage * fgR;
        out[idx * 3 + 1] = keep * bgG + coverage * fgG;
        out[idx * 3 + 2] = keep * bgB + coverage * fgB;
      }
    }

    return {
      width: w,
      height: h,
      data: out,
      depth: image.depth,
      fgCoverage: fgCoverage,
    };
  }

  const api = { depthOfField, buildDisks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DOF = Object.assign(global.DOF || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
