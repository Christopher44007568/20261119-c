"use strict";
// 抽取 app.js 中 DOM 无关的数学部分做数值验证
const fs = require("fs");
const src = fs.readFileSync("app.js", "utf8");
const cut = src.indexOf("// ---------- 覆盖层 ----------");
if (cut < 0) throw new Error("marker not found");
const api = eval(src.slice(0, cut) +
  "\n;({ state, tris, locateTriangle, interpolateUV, analyticUV, isParallelogram3D, W, H });");
Object.assign(globalThis, api);

let fails = 0;
function check(name, cond, detail) {
  if (cond) console.log("PASS", name, detail || "");
  else { fails++; console.log("FAIL", name, detail || ""); }
}

function sampleDiagDiff(mode) {
  const perDiag = [];
  for (const diag of ["A", "B"]) {
    state.diag = diag;
    const arr = [];
    for (let y = 0; y < H; y += 5) {
      for (let x = 0; x < W; x += 5) {
        const hit = locateTriangle(x + 0.5, y + 0.5);
        if (!hit) continue;
        const r = interpolateUV(hit.tri, hit.lam, mode);
        arr.push([x, y, r.u, r.v]);
      }
    }
    perDiag.push(arr);
  }
  let maxDiff = 0;
  const mapB = new Map(perDiag[1].map(s => [s[0] + "," + s[1], s]));
  for (const s of perDiag[0]) {
    const o = mapB.get(s[0] + "," + s[1]);
    if (o) maxDiff = Math.max(maxDiff, Math.hypot(s[2] - o[2], s[3] - o[3]));
  }
  return maxDiff;
}

function maxErrVsAnalytic() {
  let maxPersp = 0, maxAffine = 0, n = 0;
  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < W; x += 3) {
      const hit = locateTriangle(x + 0.5, y + 0.5);
      if (!hit) continue;
      const ana = analyticUV(hit.tri, x + 0.5, y + 0.5);
      if (!ana) continue;
      const per = interpolateUV(hit.tri, hit.lam, "persp");
      const aff = interpolateUV(hit.tri, hit.lam, "affine");
      maxPersp = Math.max(maxPersp, Math.hypot(per.u - ana.u, per.v - ana.v));
      maxAffine = Math.max(maxAffine, Math.hypot(aff.u - ana.u, aff.v - ana.v));
      n++;
    }
  }
  return { maxPersp, maxAffine, n };
}

// 1) 默认倾斜矩形（3D 平行四边形）
check("默认预设是 3D 平行四边形", isParallelogram3D());
for (const diag of ["A", "B"]) {
  state.diag = diag;
  const r = maxErrVsAnalytic();
  check(`diag=${diag} persp==analytic (n=${r.n})`, r.maxPersp < 1e-6,
    `maxErr=${r.maxPersp.toExponential(2)}`);
  check(`diag=${diag} affine has visible error`, r.maxAffine > 0.02,
    `maxErr=${r.maxAffine.toExponential(2)}`);
}
check("平行四边形: persp 与对角线无关", sampleDiagDiff("persp") < 1e-9,
  `maxDiff=${sampleDiagDiff("persp").toExponential(2)}`);
check("平行四边形: affine 暴露对角线差异", sampleDiagDiff("affine") > 0.02,
  `maxDiff=${sampleDiagDiff("affine").toExponential(2)}`);

// 2) 扭曲四边形（非平行四边形）：透视校正仍等于解析求交，但两种对角线不同
state.corners[0].w = 1.0; state.corners[1].w = 2.2;
state.corners[2].w = 2.6; state.corners[3].w = 1.2;
check("扭曲后不再是平行四边形", !isParallelogram3D());
state.diag = "A";
const rw = maxErrVsAnalytic();
check("扭曲: persp==analytic 仍成立", rw.maxPersp < 1e-6,
  `maxErr=${rw.maxPersp.toExponential(2)}`);
check("扭曲: persp 随对角线变化(符合预期)", sampleDiagDiff("persp") > 1e-3,
  `maxDiff=${sampleDiagDiff("persp").toExponential(2)}`);

console.log(fails === 0 ? "ALL PASS" : fails + " FAILURES");
process.exit(fails === 0 ? 0 : 1);
