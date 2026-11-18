/**
 * Depth-of-field post-processing engine (pure floating point, no dependencies).
 *
 * Signed circle of confusion convention:
 *   coc > 0  -> foreground / near field  (camera side of the focal plane)
 *   coc < 0  -> background / far field
 *   coc = 0  -> inside the focal band, kept perfectly sharp
 *
 * The value magnitude is the blur-circle radius in *output pixels*.
 */
(function (global) {
  'use strict';

  function createImage(width, height) {
    return {
      width: width,
      height: height,
      data: new Float32Array(width * height * 3),
      depth: new Float32Array(width * height),
    };
  }

  function defaultParams(overrides) {
    const p = Object.assign(
      {
        focusDistance: 10.0, // world units, same unit as depth
        aperture: 1.4, // f-number; 0 means pinhole (no defocus at all)
        focalLength: 0.085, // world units (e.g. 85 mm expressed in metres)
        sensorWidth: 0.036, // world units (full-frame 36 mm)
        width: 320, // current output width in pixels
        referenceWidth: 320, // design width for scaleMode = "pixel"
        scaleMode: 'pixel', // "pixel": keep radius in px; "physical": keep sensor CoC
        foregroundScale: 1.0, // separate multiplier for near-field radius
        backgroundScale: 1.0, // separate multiplier for far-field radius
        maxCocPx: 18.0, // hard cap -> bounded bokeh
        focusBandPx: 0.5, // |coc| <= this is snapped to the sharp focal plane
      },
      overrides || {}
    );
    return p;
  }

  /**
   * Thin-lens blur-circle radius in output pixels.
   *
   * Sensor diameter: c(z) = f^2 * |S - z| / (N * (S - f) * z).
   * The sign follows (S - z): near objects (z < S) are positive
   * (foreground), far objects (z > S) are negative (background).
   *
   * The focal band is a *physical* depth interval [zNear, zFar] whose
   * boundaries map exactly to focusBandPx, so changing resolution cannot
   * pull distant objects into the "sharp" class.
   */
  function computeCoc(depth, params) {
    const count = depth.length;
    const coc = new Float32Array(count);
    if (!(params.aperture > 0)) return coc; // pinhole: everything sharp

    const f = params.focalLength;
    const s = params.focusDistance;
    const n = params.aperture;
    const anchorWidth =
      params.scaleMode === 'physical' ? params.width : params.referenceWidth;
    // Signed pixels per unit of (S - z) / z at the anchor resolution.
    const k = (f * f) / (n * (s - f)) * (anchorWidth / params.sensorWidth);
    // Solve k * (S - z) / z = +/- band for the physical band boundaries.
    const band = params.focusBandPx;
    const zNear = s / (1 + band / k); // k*(S-z)/z = +band
    const zFar = s / (1 - band / k); // k*(S-z)/z = -band

    for (let i = 0; i < count; i++) {
      const z = depth[i];
      if (!isFinite(z) || z <= f) {
        coc[i] = 0;
        continue;
      }
      let r = k * ((s - z) / z);
      if (z >= zNear && z <= zFar) r = 0; // physical focal plane
      if (r > 0) r *= params.foregroundScale;
      else if (r < 0) r *= params.backgroundScale;
      if (r > params.maxCocPx) r = params.maxCocPx;
      if (r < -params.maxCocPx) r = -params.maxCocPx;
      coc[i] = r;
    }
    return coc;
  }

  function labelLayers(coc) {
    const labels = new Int8Array(coc.length);
    for (let i = 0; i < coc.length; i++) {
      if (coc[i] > 0) labels[i] = 1;
      else if (coc[i] < 0) labels[i] = -1;
    }
    return labels;
  }

  const api = { createImage, defaultParams, computeCoc, labelLayers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DOF = Object.assign(global.DOF || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
