// Runs every scenario through the exact solver and dense sampling,
// writing artifacts/validation_report.json + a human-readable summary.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const Solver = require(join(root, "src/solver.js"));
const scenarios = require(join(root, "test/scenarios.js"));

const SAMPLE_COUNTS = [36, 180, 720, 3600];
const RECEIVER_RADIUS = 0.15;

const report = { generatedAt: new Date().toISOString(), scenarios: [] };

for (const factory of Object.values(scenarios)) {
  const scene = factory();
  const result = Solver.enumeratePaths(scene, scene.maxBounces);
  const sampling = SAMPLE_COUNTS.map((n) => {
    const s = Solver.sampleAngles(scene, scene.maxBounces, n, RECEIVER_RADIUS);
    return {
      sampleCount: n,
      angularResolutionDeg: Number(s.angularResolution.toFixed(3)),
      reached: s.reachedCount,
      exactPaths: s.exactCount,
      matchedExact: s.matchedExact,
      missedExact: s.missedExact,
    };
  });

  report.scenarios.push({
    name: scene.name,
    maxBounces: scene.maxBounces,
    mirrorCount: scene.mirrors.length,
    occluderCount: scene.occluders.length,
    validPathCount: result.valid.length,
    rejectedCandidateCount: result.rejected.length,
    duplicateCount: result.duplicates || 0,
    rejectionReasons: result.counts,
    paths: result.valid.map((p) => ({
      bounces: p.bounces,
      mirrorSequence: p.sequence,
      totalLength: Number(p.length.toFixed(6)),
      maxAngleErrorRad: Number(p.maxAngleError.toExponential(3)),
      points: p.points.map((q) => ({
        x: Number(q.x.toFixed(6)),
        y: Number(q.y.toFixed(6)),
      })),
    })),
    rejected: result.rejected.map((r) => ({
      reason: r.reason,
      detail: r.detail,
      mirrorSequence: r.sequence,
      rejectedPoint: r.rejectedPoint
        ? { x: Number(r.rejectedPoint.x.toFixed(4)), y: Number(r.rejectedPoint.y.toFixed(4)) }
        : null,
    })),
    sampling,
  });
}

mkdirSync(join(root, "artifacts"), { recursive: true });
writeFileSync(
  join(root, "artifacts/validation_report.json"),
  JSON.stringify(report, null, 2)
);

const lines = [];
lines.push("Mirror reflection solver - validation report");
lines.push("=".repeat(58));
for (const sc of report.scenarios) {
  lines.push("");
  lines.push(`* ${sc.name}`);
  lines.push(`  valid paths: ${sc.validPathCount}, rejected: ${sc.rejectedCandidateCount}, ` +
    `duplicates removed: ${sc.duplicateCount}`);
  lines.push(`  rejection reasons: ${JSON.stringify(sc.rejectionReasons)}`);
  for (const p of sc.paths) {
    lines.push(`  - ${p.bounces} bounce(s), length=${p.totalLength}, ` +
      `max law error=${p.maxAngleErrorRad} rad, seq=[${p.mirrorSequence}]`);
  }
  lines.push("  dense ray sampling:");
  for (const s of sc.sampling) {
    lines.push(`    N=${String(s.sampleCount).padStart(4)} ` +
      `(${String(s.angularResolutionDeg).padStart(6)} deg): reached=${s.reached}, ` +
      `matched exact=${s.matchedExact}/${s.exactPaths}, missed=${s.missedExact}`);
  }
}
const text = lines.join("\n") + "\n";
writeFileSync(join(root, "artifacts/validation_report.txt"), text);
process.stdout.write(text);
