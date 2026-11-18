#!/usr/bin/env node
/**
 * Command-line entry: renders the DOF demo scene and every verification image.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const engine = require('./engine');
const pipeline = require('./pipeline');
const sceneMod = require('./scene');
const io = require('./imageio');
const viz = require('./debugviz');

function parseArgs(argv) {
  const args = { width: 320, height: 200, out: path.join(__dirname, '..', 'output') };
  for (let i = 2; i < argv.length; i++) {
    const kv = argv[i];
    if (kv.startsWith('--')) {
      const eq = kv.indexOf('=');
      const key = kv.slice(2, eq < 0 ? kv.length : eq);
      const val = eq < 0 ? true : kv.slice(eq + 1);
      args[key] = val;
    }
  }
  args.width = parseInt(args.width, 10);
  args.height = parseInt(args.height, 10);
  return args;
}

function save(outDir, name, image, exposure) {
  io.savePng(path.join(outDir, name), image, exposure);
  console.log('  wrote', name);
}

function main() {
  const args = parseArgs(process.argv);
  const outDir = args.out;
  fs.mkdirSync(outDir, { recursive: true });

  const scene = sceneMod.buildScene(args.width, args.height);
  const baseParams = engine.defaultParams({
    width: args.width,
    referenceWidth: args.width,
    focusDistance: scene.focusDepth,
    maxCocPx: Math.max(10, args.width * 0.06),
  });
  const exposure = 1;

  console.log('Depth-of-field demo, scene', args.width + 'x' + args.height);

  // 1. Reference pinhole image (aperture = 0 must reproduce the original).
  const pinhole = pipeline.runDoF(scene, engine.defaultParams(
    Object.assign({}, baseParams, { aperture: 0 })
  ));
  save(outDir, '00_original_pinhole.png', pinhole, exposure);

  // 2. Default DOF render with separate near/far scales.
  const dofParams = engine.defaultParams(
    Object.assign({}, baseParams, { aperture: 1.4, foregroundScale: 1.3, backgroundScale: 0.85 })
  );
  const dofResult = pipeline.runDoF(scene, dofParams);
  save(outDir, '01_dof_default.png', dofResult, exposure);

  // 3. Wide aperture -> large, bounded bokeh.
  const wideParams = engine.defaultParams(
    Object.assign({}, baseParams, { aperture: 0.95, foregroundScale: 1.0, backgroundScale: 1.0 })
  );
  const wide = pipeline.runDoF(scene, wideParams);
  save(outDir, '02_dof_wide_open.png', wide, exposure);

  // 4. Refocused toward the foreground occluder.
  const nearFocus = engine.defaultParams(
    Object.assign({}, baseParams, { focusDistance: scene.nearDepth, aperture: 1.4 })
  );
  save(outDir, '03_dof_focus_near.png', pipeline.runDoF(scene, nearFocus), exposure);

  // 5. Debug visualisations for the default run.
  save(outDir, '10_coc_signed.png', viz.cocMap(scene, dofResult.coc, baseParams.maxCocPx), 1);
  save(outDir, '11_layers.png', viz.layerMap(scene, dofResult.coc), 1);
  save(outDir, '12_fg_coverage.png', viz.coverageMap(scene, dofResult.fgCoverage), 1);

  module.exports._continue = { scene, baseParams, dofParams, dofResult, save, exposure, args };
  return module.exports._continue;
}

if (require.main === module) {
  const ctx = main();
  require('./main_extra')(ctx);
}
