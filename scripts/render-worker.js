"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { renderBand } = require("./lib/cpu-tracer");

const result = renderBand({
  ...workerData,
  onSample: (sample) => parentPort.postMessage({ type: "progress", sample })
});

const transfer = [result.accum.buffer, ...Object.values(result.snapshots).map((buffer) => buffer.buffer)];
parentPort.postMessage({ type: "done", result }, transfer);
