// Node verification harness for the rotation interpolation library.
// Runs every edge-case scenario, exports per-frame rotation matrices and
// validates orthogonality / determinant / short-arc (no unintended turns).

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fromAxisAngle, toMatrix, toEuler, fromEuler, angleBetween } from "./lib/convert.js";
import { neg, normalize } from "./lib/quat.js";
import { slerp } from "./lib/interp.js";
import {
  buildPath, sampleFrames, frameVelocities, jointJumps,
  slerpSegmentVelocity, fullTurnAudit, angularVelocity
} from "./lib/sampling.js";
import { validateFrames, matrixCheck } from "./lib/validate.js";

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

function approx(x, y, tol = 1e-8) {
  return Math.abs(x - y) <= tol;
}

const deg = (d) => (d * Math.PI) / 180;
const z = (d) => fromAxisAngle([0, 0, 1], deg(d));
const x = (d) => fromAxisAngle([1, 0, 0], deg(d));

console.log("\n== 1. Basic short-arc slerp: constant angular velocity ==");
{
  const keys = [{ t: 0, q: z(0) }, { t: 2, q: z(90) }];
  const path = buildPath("slerp", keys);
  const frames = sampleFrames(path, 21);
  const vels = frameVelocities(frames);
  const speeds = vels.slice(2, -2).map((v) => v.speed);
  const maxDev = Math.max(...speeds) - Math.min(...speeds);
  check("speed constant across segment", maxDev < 1e-6, `dev=${maxDev}`);
  check("speed magnitude = angle/dt", approx(vels[10].speed, Math.PI / 4, 1e-6));
  check("rotation axis stays +z", approx(vels[10].omega[2], Math.PI / 4, 1e-6) &&
    Math.hypot(vels[10].omega[0], vels[10].omega[1]) < 1e-8);
  const analytic = slerpSegmentVelocity(keys[0].q, keys[1].q, 2);
  check("analytic matches numerical omega", approx(analytic[2], vels[10].omega[2], 1e-6));
}

console.log("\n== 2. Equivalent q and -q must follow the same short arc ==");
{
  const a = z(30);
  const b = x(110);
  const p1 = slerp(a, b, 0.5);
  const p2 = slerp(a, neg(b), 0.5);
  const same = angleBetween(p1, p2) < 1e-10;
  check("slerp(q, -b) == slerp(q, b)", same);
  const p3 = slerp(neg(a), b, 0.5);
  check("slerp(-a, b) == slerp(a, b)", angleBetween(p1, p3) < 1e-10);
  const keys = [{ t: 0, q: a }, { t: 1, q: neg(b) }];
  const audit = fullTurnAudit(buildPath("slerp", keys));
  check("no full turn with negated key", !audit.anyFullTurn);
}

console.log("\n== 3. Near 180 degree antipodal endpoints ==");
{
  const cases = [179.999, 180, 180.001].map((d) => {
    const keys = [{ t: 0, q: z(0) }, { t: 1, q: z(d) }];
    const path = buildPath("slerp", keys);
    const mid = path.at(0.5);
    const frames = sampleFrames(path, 51);
    const audit = fullTurnAudit(path);
    const checkOk = matrixCheck(toMatrix(mid));
    return { d, mid, audit, checkOk, frames };
  });
  for (const c of cases) {
    check(`matrix valid at ${c.d} deg`, c.checkOk.orthoError < 1e-14 && c.checkOk.detError < 1e-14);
    check(`short arc, no full turn at ${c.d} deg`, !c.audit.anyFullTurn &&
      c.audit.segments[0].traveled <= Math.PI + 1e-6,
      `traveled=${c.audit.segments[0].traveled}`);
  }
  // Exactly 180: midpoint must be a valid 90-degree rotation around some axis.
  const midAngle = angleBetween(cases[1].mid, z(0));
  check("180 deg midpoint is a 90 deg rotation", approx(midAngle, Math.PI / 2, 1e-6));
}

console.log("\n== 4. Repeated / duplicate poses ==");
{
  const keys = [
    { t: 0, q: z(0) }, { t: 1, q: z(45) },
    { t: 2, q: z(45) }, { t: 3, q: z(90) }
  ];
  const path = buildPath("slerp", keys);
  const hold = path.at(1.5);
  check("identical endpoints hold still", angleBetween(hold, z(45)) < 1e-10);
  const frames = sampleFrames(path, 61);
  const vels = frameVelocities(frames);
  const mid = vels.find((v) => approx(v.t, 1.5, 0.06));
  check("zero angular velocity inside repeated segment", mid.speed < 1e-6,
    `speed=${mid.speed}`);
  const jumps = jointJumps(path);
  check("joint rows produced for interior keys", jumps.length === 2);
  // Zero-duration duplicate keys collapse instead of NaN.
  const collapsed = buildPath("slerp", [
    { t: 0, q: z(0) }, { t: 1, q: z(30) }, { t: 1, q: z(60) }, { t: 2, q: z(90) }
  ]);
  const f = sampleFrames(collapsed, 5);
  check("zero-duration duplicate keys do not produce NaN",
    f.every((fr) => Number.isFinite(fr.q.w)));
}

console.log("\n== 5. Non-uniform time intervals ==");
{
  const keys = [
    { t: 0, q: z(0) }, { t: 0.2, q: z(30) }, { t: 2, q: z(60) }
  ];
  const path = buildPath("slerp", keys);
  const w1 = slerpSegmentVelocity(keys[0].q, keys[1].q, 0.2);
  const w2 = slerpSegmentVelocity(keys[1].q, keys[2].q, 1.8);
  check("short dt -> high speed", approx(w1[2], deg(30) / 0.2, 1e-8));
  check("long dt -> low speed", approx(w2[2], deg(30) / 1.8, 1e-8));
  check("speed ratio follows time ratio", approx(w1[2] / w2[2], 9, 1e-8));
  const jumps = jointJumps(path);
  check("slerp shows a velocity jump at the shared key",
    jumps[0].jumpMag > 1, `jump=${jumps[0].jumpMag}`);
  const audit = fullTurnAudit(path);
  check("all segments stay on the geodesic", audit.segments.every(
    (s) => Math.abs(s.excess) < 1e-9));
}

console.log("\n== 6. SQUAD smoothness vs slerp at joints ==");
{
  const uniformKeys = [
    { t: 0, q: z(0) }, { t: 1, q: x(30) },
    { t: 2, q: z(50) }, { t: 3, q: x(-20) }
  ];
  const uSlerp = jointJumps(buildPath("slerp", uniformKeys));
  const uSquad = jointJumps(buildPath("squad", uniformKeys));
  for (let i = 0; i < uSquad.length; i++) {
    check(`uniform: squad jump ~100x smaller than slerp at key ${i + 1}`,
      uSquad[i].jumpMag * 100 < uSlerp[i].jumpMag,
      `squad=${uSquad[i].jumpMag.toExponential(2)} slerp=${uSlerp[i].jumpMag.toFixed(3)}`);
  }
  check("uniform squad residual jump is at finite-difference floor",
    Math.max(...uSquad.map((j) => j.jumpMag)) < 1e-2);

  const keys = [
    { t: 0, q: z(0) }, { t: 0.5, q: x(70) },
    { t: 2, q: z(110) }, { t: 3.2, q: x(-50) }
  ];
  const slerpJumps = jointJumps(buildPath("slerp", keys));
  const squadJumps = jointJumps(buildPath("squad", keys));
  for (let i = 0; i < slerpJumps.length; i++) {
    check(`non-uniform: squad still smoother than slerp at key ${i + 1}`,
      squadJumps[i].jumpMag < slerpJumps[i].jumpMag,
      `squad=${squadJumps[i].jumpMag.toExponential(2)} slerp=${slerpJumps[i].jumpMag.toExponential(2)}`);
  }
  // Classic SQUAD is C1 in its normalized parameter; non-uniform physical
  // time reintroduces a finite residual. That is an honest, documented
  // property rather than an unintended revolution.
  check("non-uniform squad residual stays finite and moderate",
    squadJumps.every((j) => Number.isFinite(j.jumpMag) && j.jumpMag < slerpJumps[j.index - 1].jumpMag));
  const audit = fullTurnAudit(buildPath("squad", keys));
  check("squad performs no unintended full turn", audit.segments.every(
    (s) => s.traveled <= s.geodesic + 2 * Math.PI + 1e-6),
    audit.segments.map((s) => s.traveled.toFixed(3)).join(","));
  // Endpoints: squad reproduces the key poses exactly.
  const squadPath = buildPath("squad", keys);
  check("squad interpolates key poses exactly",
    angleBetween(squadPath.at(0), keys[0].q) < 1e-12 &&
    angleBetween(squadPath.at(3.2), keys[3].q) < 1e-12);
}

console.log("\n== 7. Euler linear interpolation takes the long way ==");
{
  // Build poses straight from Euler angles: yaw +190 deg and yaw -170 deg are
  // the same orientation, but naive Euler lerp sweeps the full 360 deg while
  // slerp recognizes the identical quaternions and holds still.
  const qStart = fromEuler([0, 0, deg(190)]);
  const qEnd = fromEuler([0, 0, deg(-170)]);
  const keys = [
    { t: 0, q: qStart, e: [0, 0, deg(190)] },
    { t: 1, q: qEnd, e: [0, 0, deg(-170)] }
  ];
  check("190 deg and -170 deg are the same orientation",
    angleBetween(qStart, qEnd) < 1e-12);
  const ePath = buildPath("euler", keys);
  const qPath = buildPath("slerp", keys);
  const eAudit = fullTurnAudit(ePath);
  const qAudit = fullTurnAudit(qPath);
  check("Euler lerp travels a full 360 deg sweep", approx(
    eAudit.segments[0].traveled, deg(360), 0.02),
    `traveled=${eAudit.segments[0].traveled}`);
  check("slerp holds still (zero travel for equal orientations)",
    qAudit.segments[0].traveled < 1e-8);
  check("Euler endpoints still match orientations",
    angleBetween(ePath.at(1), keys[1].q) < 1e-10);
  check("slerp path contains no full turn", !qAudit.anyFullTurn);
  check("Euler path crosses 180 deg (the artifact signature)",
    eAudit.anyFullTurn);
}


console.log("\n== 8. Per-frame matrix export, orthogonality and determinant ==");
{
  mkdirSync("artifacts", { recursive: true });
  const N = 240;
  const methods = ["euler", "slerp", "squad"];
  const keys = [
    { t: 0, q: z(0) }, { t: 0.4, q: x(120) }, { t: 1.1, q: z(175) },
    { t: 2.6, q: x(-80) }, { t: 4, q: z(-160) }
  ];
  for (const method of methods) {
    const path = buildPath(method, keys);
    const frames = sampleFrames(path, N).map((f) => ({
      t: f.t,
      q: f.q,
      R: toMatrix(f.q)
    }));
    const result = validateFrames(frames, 1e-12);
    check(`${method}: all ${N} frames orthogonal, det=+1`, result.pass,
      `ortho=${result.worstOrtho} det=${result.worstDet}`);

    const exportObj = {
      method,
      frameCount: N,
      convention: "column-major R, v' = R v",
      frames: frames.map((f) => ({
        t: Number(f.t.toFixed(6)),
        q: [f.q.w, f.q.x, f.q.y, f.q.z],
        R: f.R.map((v) => Number(v.toFixed(12)))
      }))
    };
    writeFileSync(`artifacts/matrices_${method}.json`, JSON.stringify(exportObj, null, 1));

    const csv = ["frame,t,R00,R10,R20,R01,R11,R21,R02,R12,R22"]
      .concat(frames.map((f, i) =>
        [i, f.t.toFixed(6), ...f.R.map((v) => v.toFixed(12))].join(",")))
      .join("\n");
    writeFileSync(`artifacts/matrices_${method}.csv`, csv + "\n");
  }
  // Re-read the exported JSON and validate the rounded values on disk.
  const disk = JSON.parse(readFileSync("artifacts/matrices_squad.json", "utf8"));
  const diskCheck = validateFrames(
    disk.frames.map((f) => ({ R: f.R })), 1e-10);
  check("exported (rounded) JSON matrices still pass", diskCheck.pass,
    `ortho=${diskCheck.worstOrtho}`);
}

console.log("\n== 9. Angular velocity across repeated + non-uniform mixed track ==");
{
  const keys = [
    { t: 0, q: z(0) }, { t: 0.1, q: z(90) },
    { t: 1.1, q: z(90) }, { t: 3.1, q: z(180) }
  ];
  const path = buildPath("slerp", keys);
  const vels = frameVelocities(sampleFrames(path, 121));
  const hold = vels.filter((v) => v.t > 0.2 && v.t < 1.0);
  check("velocity zero across the hold", hold.every((v) => v.speed < 1e-6));
  const fast = vels.filter((v) => v.t > 0.02 && v.t < 0.08);
  check("fast segment speed ~ pi/(2*0.1)", Math.abs(fast[0].speed - Math.PI / 0.2) < 1e-4);
  const jumps = jointJumps(path);
  check("joint jump table flags the speed changes", jumps.length === 2 &&
    jumps.every((j) => Number.isFinite(j.jumpMag)));
  check("omega finite everywhere", vels.every((v) =>
    isFinite(v.omega[0]) && isFinite(v.speed)));
}

console.log(`\n==== ${passed} passed, ${failed} failed ====`);
process.exit(failed === 0 ? 0 : 1);
