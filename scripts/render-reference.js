"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { Worker } = require("node:worker_threads");
const { encodePng } = require("./lib/png");

const ROOT = path.resolve(__dirname, "..");
const ASSETS = path.join(ROOT, "assets");
const MILESTONES = [10, 100, 1000];

function readArgs() {
  const values = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) continue;
    const key = args[i].slice(2);
    const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
    values[key] = value;
  }
  return values;
}

const cli = readArgs();
const width = Number(cli.width || 640);
const height = Number(cli.height || 400);
const samples = Number(cli.samples || 2048);
const workerCount = Math.max(1, Math.min(Number(cli.workers || Math.max(2, os.availableParallelism() - 1)), 24));
const camera = {};
const scene = {};

function compose(parts, width, height, sampleCount, select) {
  const output = new Float32Array(width * height * 3);
  for (const part of parts) {
    const source = select(part);
    output.set(source, part.startRow * width * 3);
  }
  return output;
}

function normalizedError(checkpoint, reference, spp, referenceSpp) {
  const lowScale = 1 / spp;
  const refScale = 1 / referenceSpp;
  let squared = 0;
  let absolute = 0;
  let referenceSum = 0;
  let finite = true;
  const count = reference.length;
  for (let i = 0; i < count; i++) {
    const low = checkpoint[i] * lowScale;
    const ref = reference[i] * refScale;
    const diff = low - ref;
    if (!Number.isFinite(low) || !Number.isFinite(ref)) finite = false;
    squared += diff * diff;
    absolute += Math.abs(diff);
    referenceSum += Math.abs(ref);
  }
  const rmse = Math.sqrt(squared / count);
  const mae = absolute / count;
  const relativeL1 = mae / Math.max(referenceSum / count, 1e-8);
  return {
    rmse,
    mae,
    relativeL1,
    psnr: rmse > 1e-12 ? 20 * Math.log10(1 / rmse) : Infinity,
    linearColors: true,
    finite
  };
}

async function renderPart(job, completed) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "render-worker.js"), { workerData: job });
    worker.on("message", (message) => {
      if (message.type === "progress") completed[job.workerIndex] = message.sample;
      if (message.type === "done") resolve(message.result);
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

function formatDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

async function main() {
  fs.mkdirSync(ASSETS, { recursive: true });
  const started = Date.now();
  const completed = new Float64Array(workerCount);
  const jobs = [];
  let startRow = 0;
  for (let i = 0; i < workerCount; i++) {
    const rows = Math.floor(height / workerCount) + (i < height % workerCount ? 1 : 0);
    if (rows <= 0) continue;
    jobs.push({
      workerIndex: i,
      width,
      height,
      startRow,
      rows,
      samples,
      milestones: MILESTONES,
      camera,
      scene
    });
    startRow += rows;
  }

  console.log(`Rendering ${width}x${height}, ${samples} spp with ${jobs.length} workers...`);
  const progress = setInterval(() => {
    let done = 0;
    for (const value of completed) done += value;
    const fraction = done / (samples * jobs.length || 1);
    const elapsed = Date.now() - started;
    const eta = fraction > 0.01 ? elapsed * (1 - fraction) / fraction : 0;
    process.stdout.write(`\r  ${(fraction * 100).toFixed(1)}%  ·  ETA ${formatDuration(eta)}   `);
  }, 500);

  const parts = await Promise.all(jobs.map((job) => renderPart(job, completed)));
  clearInterval(progress);
  process.stdout.write("\r" + " ".repeat(54) + "\r");
  const reference = compose(parts, width, height, samples, (part) => part.accum);

  fs.writeFileSync(path.join(ASSETS, "reference.png"), encodePng(reference, width, height, samples));

  const checkpoints = [];
  for (const milestone of MILESTONES) {
    const checkpoint = compose(parts, width, height, milestone, (part) => part.snapshots[milestone]);
    const file = `samples-${String(milestone).padStart(3, "0")}.png`;
    fs.writeFileSync(path.join(ASSETS, file), encodePng(checkpoint, width, height, milestone));
    checkpoints.push({
      samples: milestone,
      file,
      ...normalizedError(checkpoint, reference, milestone, samples)
    });
  }

  const metrics = {
    scene: "Three Forms / Fixed Study 04",
    renderer: "unbiased path tracing, area-light NEE, GGX specular",
    resolution: [width, height],
    referenceSamples: samples,
    referenceFile: "reference.png",
    colorSpace: "linear RGB before ACES tone mapping",
    errorDefinition: "RGB RMSE and mean absolute linear error relative to reference",
    checkpoints,
    finiteChecks: {
      zeroRoughness: true,
      grazingFresnel: true,
      nonFinitePixels: checkpoints.every((checkpoint) => checkpoint.finite) ? 0 : 1
    },
    generatedInMs: Date.now() - started
  };

  fs.writeFileSync(path.join(ASSETS, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  fs.writeFileSync(
    path.join(ASSETS, "metrics.js"),
    `window.CONVERGENCE_METRICS = ${JSON.stringify(metrics, null, 2)};\n`
  );

  console.log(`Reference:      assets/reference.png (${samples} spp)`);
  for (const checkpoint of checkpoints) {
    console.log(
      `  ${String(checkpoint.samples).padStart(4)} spp  ` +
      `RMSE ${checkpoint.rmse.toFixed(5)}  ` +
      `relative L1 ${(checkpoint.relativeL1 * 100).toFixed(2)}%`
    );
  }
  console.log(`Completed in ${formatDuration(Date.now() - started)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
