import { buildReference, mergeLocalHistogram } from "./core.js";

export async function runCpuFallback(snapshot, readbackDelay = 80) {
  const started = performance.now();
  const reference = buildReference(snapshot.values, snapshot.config);
  const mergedHistogram = mergeLocalHistogram(
    reference.localHistogram,
    reference.workgroups,
    reference.config.bins,
  );

  if (readbackDelay > 0) {
    await new Promise((resolve) => {
      setTimeout(resolve, readbackDelay);
    });
  }

  const finished = performance.now();
  return {
    globalHistogram: reference.histogram.slice(),
    localHistogram: reference.localHistogram.slice(),
    mergedHistogram,
    globalCdf: reference.cdf.slice(),
    localCdf: reference.cdf.slice(),
    globalQuantileBins: reference.quantileBins.slice(),
    localQuantileBins: reference.quantileBins.slice(),
    timing: {
      totalMs: finished - started,
      readbackMs: finished - started,
    },
  };
}
