/**
 * Extended outputs: leakage zoom, parameter sweep, resolution/unit check.
 */
'use strict';

const engine = require('./engine');
const pipeline = require('./pipeline');
const sceneMod = require('./scene');
const io = require('./imageio');
const viz = require('./debugviz');

const BAR = 11;

function crop(image, x0, y0, w, h, scale) {
  const out = viz.emptyLike({ width: w * scale, height: h * scale });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(image.width - 1, Math.max(0, x0 + x));
      const sy = Math.min(image.height - 1, Math.max(0, y0 + y));
      const src = (sy * image.width + sx) * 3;
      for (let oy = 0; oy < scale; oy++) {
        for (let ox = 0; ox < scale; ox++) {
          const di = ((y * scale + oy) * out.width + x * scale + ox) * 3;
          out.data[di] = image.data[src];
          out.data[di + 1] = image.data[src + 1];
          out.data[di + 2] = image.data[src + 2];
        }
      }
    }
  }
  return out;
}

function captioned(image, text) {
  const out = viz.emptyLike({ width: image.width, height: image.height + BAR });
  out.data.set(image.data);
  viz.drawText(out, text, 4, image.height + 3, 1, [0.85, 0.85, 0.85]);
  return out;
}

function pinhole(ctx) {
  if (ctx._pinhole) return ctx._pinhole;
  ctx._pinhole = pipeline.runDoF(ctx.scene, engine.defaultParams(
    Object.assign({}, ctx.baseParams, { aperture: 0 })
  ));
  return ctx._pinhole;
}

module.exports = function extra(ctx) {
  const { scene, baseParams, dofResult, save, args } = ctx;

  // Leakage check: crop around the strip crossing the probe light at (0.42, 0.62).
  const cx = Math.round(0.4 * scene.width);
  const cy = Math.round(0.88 * scene.height);
  const halfW = Math.max(20, Math.round(scene.width * 0.09));
  const halfH = Math.max(16, Math.round(scene.height * 0.16));
  const cw = halfW * 2, ch = halfH * 2, zoom = 3;
  const x0 = cx - halfW, y0 = cy - halfH;
  const covImage = viz.coverageMap(scene, dofResult.fgCoverage);
  save(args.out, '20_leakage_zoom.png', io.montage([
    { image: captioned(crop(pinhole(ctx), x0, y0, cw, ch, zoom), 'original') },
    { image: captioned(crop(dofResult, x0, y0, cw, ch, zoom), 'dof') },
    { image: captioned(crop(covImage, x0, y0, cw, ch, zoom), 'fg coverage') },
  ], 3, BAR), 1);

  // Aperture / focus sweep.
  const sweep = [];
  for (const ap of [0, 0.95, 1.4, 2.8]) {
    const p = engine.defaultParams(Object.assign({}, baseParams, { aperture: ap }));
    sweep.push({ image: captioned(pipeline.runDoF(scene, p), 'aperture f' + ap) });
  }
  for (const fd of [scene.nearDepth, scene.focusDepth, scene.farDepth]) {
    const p = engine.defaultParams(Object.assign({}, baseParams, { aperture: 1.4, focusDistance: fd }));
    sweep.push({ image: captioned(pipeline.runDoF(scene, p), 'focus ' + fd.toFixed(1)) });
  }
  save(args.out, '30_sweep.png', io.montage(sweep, 4, BAR), 1);

  // Resolution / scale-mode comparison at half resolution.
  const smallW = Math.round(args.width / 2), smallH = Math.round(args.height / 2);
  const smallScene = sceneMod.buildScene(smallW, smallH);
  const shared = {
    referenceWidth: args.width, aperture: 1.4, maxCocPx: baseParams.maxCocPx,
  };
  const pm = pipeline.runDoF(smallScene, engine.defaultParams(Object.assign({}, baseParams, shared, {
    width: smallW, scaleMode: 'pixel',
  })));
  const phm = pipeline.runDoF(smallScene, engine.defaultParams(Object.assign({}, baseParams, shared, {
    width: smallW, scaleMode: 'physical',
  })));
  save(args.out, '40_small_pixel_mode.png', pm, 1);
  save(args.out, '41_small_physical_mode.png', phm, 1);

  // Headline montage.
  save(args.out, '90_montage.png', io.montage([
    { image: captioned(pinhole(ctx), 'original aperture 0') },
    { image: captioned(dofResult, 'dof f1.4') },
    { image: captioned(viz.cocMap(scene, dofResult.coc, baseParams.maxCocPx), 'signed coc px') },
    { image: captioned(viz.layerMap(scene, dofResult.coc), 'layers fg focal bg') },
  ], 2, BAR), 1);
};
