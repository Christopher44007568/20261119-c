// End-to-end demonstration and measurement of the adjustable bloom pipeline.
//
// Outputs (under artifacts/output):
//   <viewport>/scene-*.png            tonemapped input scene
//   <viewport>/bloom-composite.png    scene + bloom
//   <viewport>/bloom-only.png         isolated bloom contribution
//   <viewport>/mip-L*.png             every downsample level (upscaled)
//   metrics.json                      per-level radius & luminance metrics
//   report.html                       gallery of every downsample level

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeScene } from '../src/scene.js';
import { runBloom } from '../src/bloom.js';
import { encodePng, reinhard } from '../src/png.js';
import {
  totalLuminance,
  spatialStats,
  levelsForRadius,
} from '../src/math.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'artifacts', 'output');

const VIEWPORTS = [
  { name: 'viewport-160x120', width: 160, height: 120 },
  { name: 'viewport-320x240', width: 320, height: 240 },
];

const BLOOM_OPTIONS = {
  threshold: 1.0,
  kneeScale: 0.5,
  radiusFraction: 0.18,
  intensity: 1.0,
  // Broad mips contribute less: keeps the highlight edge a smooth falloff
  // instead of a flat white disc.
  upsampleWeights: [1.0, 0.7, 0.45, 0.28, 0.17, 0.1, 0.06, 0.035],
};

function writePng(filePath, buffer, width, height) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encodePng(reinhard(buffer), width, height));
}

// Nearest-neighbor upscale of a mip to full viewport size, purely for display.
function upscaleNearest(buffer, srcWidth, srcHeight, dstWidth, dstHeight) {
  const out = new Float32Array(dstWidth * dstHeight * 3);
  for (let y = 0; y < dstHeight; y++) {
    const sy = Math.min(srcHeight - 1, Math.floor((y + 0.5) * srcHeight / dstHeight));
    for (let x = 0; x < dstWidth; x++) {
      const sx = Math.min(srcWidth - 1, Math.floor((x + 0.5) * srcWidth / dstWidth));
      const srcIndex = (sy * srcWidth + sx) * 3;
      const dstIndex = (y * dstWidth + x) * 3;
      out[dstIndex] = buffer[srcIndex];
      out[dstIndex + 1] = buffer[srcIndex + 1];
      out[dstIndex + 2] = buffer[srcIndex + 2];
    }
  }
  return out;
}

function measureEmitterRegions(result, viewport) {
  // Crop windows (in viewport-relative coordinates) around each emitter so
  // point and line statistics do not contaminate one another.
  const pointCrop = { x0: 0.18, y0: 0.24, x1: 0.46, y1: 0.52 };
  const lineCrop = { x0: 0.4, y0: 0.55, x1: 0.97, y1: 0.82 };

  const cropBuffer = (level, crop) => {
    const x0 = Math.max(0, Math.floor(crop.x0 * level.width));
    const x1 = Math.min(level.width, Math.ceil(crop.x1 * level.width));
    const y0 = Math.max(0, Math.floor(crop.y0 * level.height));
    const y1 = Math.min(level.height, Math.ceil(crop.y1 * level.height));
    const width = x1 - x0;
    const height = y1 - y0;
    const cropped = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const src = ((y + y0) * level.width + (x + x0)) * 3;
        const dst = (y * width + x) * 3;
        cropped[dst] = level.buffer[src];
        cropped[dst + 1] = level.buffer[src + 1];
        cropped[dst + 2] = level.buffer[src + 2];
      }
    }
    return { buffer: cropped, width, height, scale: viewport.width / level.width };
  };

  const rows = result.levels.map((level, index) => {
    const pointView = cropBuffer(level, pointCrop);
    const lineView = cropBuffer(level, lineCrop);
    const pointStats = spatialStats(
      pointView.buffer,
      pointView.width,
      pointView.height,
      pointView.scale,
      false
    );
    const lineStats = spatialStats(
      lineView.buffer,
      lineView.width,
      lineView.height,
      lineView.scale,
      true
    );
    return {
      level: index,
      mipSize: `${level.width}x${level.height}`,
      levelLuminance: totalLuminance(
        level.buffer,
        level.width,
        level.height
      ),
      point: {
        e90RadiusPx: pointStats.e90,
        sigmaPx: pointStats.sigma,
        luminance: pointStats.totalLuminance,
      },
      line: {
        e90HalfWidthPx: lineStats.e90,
        sigmaPx: lineStats.sigma,
        luminance: lineStats.totalLuminance,
      },
    };
  });

  // Cumulative luminance from each level down to the coarsest mip: shows how
  // much of the original energy survives at or beyond a given level.
  for (let i = rows.length - 1; i >= 0; i--) {
    rows[i].cumulativeLuminanceFromHere =
      rows[i].levelLuminance +
      (i + 1 < rows.length ? rows[i + 1].cumulativeLuminanceFromHere : 0);
    rows[i].point.cumulativeLuminance =
      rows[i].point.luminance +
      (i + 1 < rows.length ? rows[i + 1].point.cumulativeLuminance : 0);
    rows[i].line.cumulativeLuminance =
      rows[i].line.luminance +
      (i + 1 < rows.length ? rows[i + 1].line.cumulativeLuminance : 0);
  }
  return rows;
}

function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  const report = {
    generatedAt: new Date().toISOString(),
    options: BLOOM_OPTIONS,
    viewports: [],
  };

  for (const viewport of VIEWPORTS) {
    const scene = makeScene(viewport.width, viewport.height);
    const result = runBloom(
      scene.buffer,
      viewport.width,
      viewport.height,
      BLOOM_OPTIONS
    );
    const dir = path.join(outDir, viewport.name);

    writePng(
      path.join(dir, 'scene-input.png'),
      scene.buffer,
      viewport.width,
      viewport.height
    );
    writePng(
      path.join(dir, 'bloom-composite.png'),
      result.composite,
      viewport.width,
      viewport.height
    );
    writePng(
      path.join(dir, 'bloom-only.png'),
      result.bloom,
      viewport.width,
      viewport.height
    );

    for (const level of result.levels) {
      const display = upscaleNearest(
        level.buffer,
        level.width,
        level.height,
        viewport.width,
        viewport.height
      );
      writePng(
        path.join(dir, `mip-L${level.level ?? result.levels.indexOf(level)}.png`),
        display,
        viewport.width,
        viewport.height
      );
    }

    // Off control: bloom disabled must reproduce the source exactly.
    const disabled = runBloom(
      scene.buffer,
      viewport.width,
      viewport.height,
      { ...BLOOM_OPTIONS, enabled: false }
    );
    const polluted = Array.from(disabled.composite).some(
      (v, i) => v !== scene.buffer[i]
    );

    report.viewports.push({
      viewport: `${viewport.width}x${viewport.height}`,
      continuousLevelCount: levelsForRadius(
        BLOOM_OPTIONS.radiusFraction,
        viewport.height
      ),
      realizedMipLevels: result.levels.length,
      downsampleWeights: result.downWeights,
      upsampleWeights: result.upWeights,
      bloomOffLeavesSourceUntouched: !polluted,
      sourceLuminance: totalLuminance(
        scene.buffer,
        viewport.width,
        viewport.height
      ),
      bloomLuminance: totalLuminance(
        result.bloom,
        viewport.width,
        viewport.height
      ),
      perLevel: measureEmitterRegions(result, viewport),
    });
  }

  fs.writeFileSync(
    path.join(outDir, 'metrics.json'),
    JSON.stringify(report, null, 2)
  );
  writeHtmlGallery(report);

  const summary = report.viewports.map((entry) => ({
    viewport: entry.viewport,
    levels: entry.realizedMipLevels,
    bloomOffClean: entry.bloomOffLeavesSourceUntouched,
    pointE90: entry.perLevel.map((m) => m.point.e90RadiusPx.toFixed(1)),
  }));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nArtifacts written to ${path.relative(root, outDir)}`);
}

function writeHtmlGallery(report) {
  const sections = report.viewports
    .map((entry) => {
      const dir = `viewport-${entry.viewport}`;
      const rows = entry.perLevel
        .map((metric) => {
          return `
        <tr>
          <td>L${metric.level}</td>
          <td>${metric.mipSize}</td>
          <td>${metric.levelLuminance.toFixed(3)}</td>
          <td>${metric.cumulativeLuminanceFromHere.toFixed(3)}</td>
          <td>${metric.point.e90RadiusPx.toFixed(2)}</td>
          <td>${metric.point.luminance.toFixed(3)}</td>
          <td>${metric.point.cumulativeLuminance.toFixed(3)}</td>
          <td>${metric.line.e90HalfWidthPx.toFixed(2)}</td>
          <td>${metric.line.luminance.toFixed(3)}</td>
          <td>${metric.line.cumulativeLuminance.toFixed(3)}</td>
        </tr>`;
        })
        .join('');
      const mipImages = entry.perLevel
        .map(
          (metric) => `
        <figure>
          <img src="${dir}/mip-L${metric.level}.png" alt="mip L${metric.level}">
          <figcaption>L${metric.level} · ${metric.mipSize}</figcaption>
        </figure>`
        )
        .join('');
      return `
      <section>
        <h2>${entry.viewport}</h2>
        <div class="strips">
          <figure><img src="${dir}/scene-input.png"><figcaption>input</figcaption></figure>
          <figure><img src="${dir}/bloom-only.png"><figcaption>bloom only</figcaption></figure>
          <figure><img src="${dir}/bloom-composite.png"><figcaption>composite</figcaption></figure>
        </div>
        <h3>Downsample levels</h3>
        <div class="mips">${mipImages}</div>
        <table>
          <thead><tr>
            <th>level</th><th>size</th><th>level lum</th><th>cumulative lum</th>
            <th>point e90 r (px)</th><th>point lum</th><th>point cumulative</th>
            <th>line e90 w (px)</th><th>line lum</th><th>line cumulative</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Adjustable Bloom Pipeline Report</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #111; color: #ddd; }
  h1, h2, h3 { color: #fff; }
  figure { margin: 0 0.5rem 1rem; display: inline-block; text-align: center; }
  figcaption { font-size: 0.8rem; margin-top: 0.25rem; }
  img { image-rendering: pixelated; border: 1px solid #333; background: #000; }
  .strips img { width: 320px; }
  .mips img { width: 180px; }
  table { border-collapse: collapse; margin: 1rem 0; }
  th, td { border: 1px solid #444; padding: 0.35rem 0.7rem; font-size: 0.85rem; }
  th { background: #222; }
  code { color: #9cf; }
</style>
</head>
<body>
<h1>Adjustable Bloom Pipeline</h1>
<p>Threshold <code>${report.options.threshold}</code>, knee scale
<code>${report.options.kneeScale}</code>, declared radius
<code>${report.options.radiusFraction}</code> of viewport height.</p>
${sections}
</body>
</html>`;
  fs.writeFileSync(path.join(outDir, 'report.html'), html);
}

main();
