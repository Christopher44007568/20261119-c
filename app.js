"use strict";

// ---------- 全局状态 ----------
const W = 440, H = 440;
const FOCAL = 500; // 投影焦距（像素），用于把屏幕点+深度还原为 3D

const state = {
  // 屏幕空间角点 + 深度 w（即视空间 z）
  corners: [
    { x:  32.5, y: 115.8, w: 1.2 },
    { x: 332.5, y: 157.5, w: 2.0 },
    { x: 332.5, y: 307.5, w: 2.0 },
    { x:  32.5, y: 365.8, w: 1.2 },
  ],
  uvs: [ [0,0], [1,0], [1,1], [0,1] ],
  diag: "A",           // 'A': (0,1,2)+(0,2,3)  'B': (0,1,3)+(1,2,3)
  probe: null,         // {x, y} 画布坐标
  dragIndex: -1,
};

const DEFAULTS = JSON.parse(JSON.stringify(state.corners));
// 倾斜的 3D 矩形（平行四边形）：透视校正应与对角线无关
const TILT = [
  { x:  32.5, y: 115.8, w: 1.2 },
  { x: 332.5, y: 157.5, w: 2.0 },
  { x: 332.5, y: 307.5, w: 2.0 },
  { x:  32.5, y: 365.8, w: 1.2 },
];
// 正面矩形（等深）
const FLAT = [
  { x:  60, y: 100, w: 1.5 },
  { x: 380, y: 100, w: 1.5 },
  { x: 380, y: 340, w: 1.5 },
  { x:  60, y: 340, w: 1.5 },
];
// 非平行四边形（任意深度）：即使透视校正也会因对角线不同而不同
const WARPED = [
  { x: 100, y: 100, w: 1.0 },
  { x: 350, y:  80, w: 2.2 },
  { x: 370, y: 350, w: 2.6 },
  { x:  90, y: 330, w: 1.2 },
];

function tris() {
  return state.diag === "A"
    ? [[0, 1, 2], [0, 2, 3]]
    : [[0, 1, 3], [1, 2, 3]];
}

// ---------- 数学工具 ----------
function edge(ax, ay, bx, by, px, py) {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

// 点 (px,py) 在三角形 (a,b,c) 内的重心坐标；在外返回 null
function barycentric(tri, px, py) {
  const A = state.corners[tri[0]], B = state.corners[tri[1]], C = state.corners[tri[2]];
  const d = edge(A.x, A.y, B.x, B.y, C.x, C.y);
  if (Math.abs(d) < 1e-9) return null;
  const l0 = edge(B.x, B.y, C.x, C.y, px, py) / d;
  const l1 = edge(C.x, C.y, A.x, A.y, px, py) / d;
  const l2 = edge(A.x, A.y, B.x, B.y, px, py) / d;
  const EPS = -1e-6;
  if (l0 < EPS || l1 < EPS || l2 < EPS) return null;
  return [l0, l1, l2];
}

function locateTriangle(px, py) {
  const ts = tris();
  for (let i = 0; i < ts.length; i++) {
    const lam = barycentric(ts[i], px, py);
    if (lam) return { triIndex: i, tri: ts[i], lam };
  }
  return null;
}

// 给定重心坐标，按模式计算 UV
// mode: 'affine' | 'persp'  返回 {u, v, uw, vw, iw}
function interpolateUV(tri, lam, mode) {
  let u = 0, v = 0, uw = 0, vw = 0, iw = 0;
  for (let k = 0; k < 3; k++) {
    const c = state.corners[tri[k]];
    const uv = state.uvs[tri[k]];
    u  += lam[k] * uv[0];
    v  += lam[k] * uv[1];
    uw += lam[k] * uv[0] / c.w;
    vw += lam[k] * uv[1] / c.w;
    iw += lam[k] * 1 / c.w;
  }
  if (mode === "persp") return { u: uw / iw, v: vw / iw, uw, vw, iw };
  return { u, v, uw, vw, iw };
}

// ---------- 纹理 ----------
function sampleTexture(u, v) {
  const N = 8;
  const cu = Math.floor(u * N), cv = Math.floor(v * N);
  const on = ((cu + cv) & 1) === 0;
  // 叠加 u(红)/v(绿) 渐变，便于观察插值方向
  const r = on ? 235 : 40, g = on ? 235 : 40, b = on ? 235 : 45;
  const tu = Math.min(1, Math.max(0, u)), tv = Math.min(1, Math.max(0, v));
  return [
    Math.min(255, r * 0.75 + tu * 90),
    Math.min(255, g * 0.75 + tv * 90),
    b * 0.75 + 20,
  ];
}

// ---------- 光栅化 ----------
function rasterize(ctx, mode) {
  const img = ctx.createImageData(W, H);
  const data = img.data;
  // 背景
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 12; data[i + 1] = 14; data[i + 2] = 18; data[i + 3] = 255;
  }
  for (const tri of tris()) {
    const pts = tri.map(i => state.corners[i]);
    const minX = Math.max(0, Math.floor(Math.min(pts[0].x, pts[1].x, pts[2].x)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(pts[0].x, pts[1].x, pts[2].x)));
    const minY = Math.max(0, Math.floor(Math.min(pts[0].y, pts[1].y, pts[2].y)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(pts[0].y, pts[1].y, pts[2].y)));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const lam = barycentric(tri, x + 0.5, y + 0.5);
        if (!lam) continue;
        const { u, v } = interpolateUV(tri, lam, mode);
        const [r, g, b] = sampleTexture(u, v);
        const o = (y * W + x) * 4;
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------- 解析平面求交 ----------
// 屏幕点 + 深度还原视空间 3D 点（针孔相机，光心在原点）
function unproject(c) {
  return {
    x: (c.x - W / 2) / FOCAL * c.w,
    y: (c.y - H / 2) / FOCAL * c.w,
    z: c.w,
  };
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

// 像素 (px,py) 发出视线与三角形所在平面求交，返回解析 UV；失败返回 null
function analyticUV(tri, px, py) {
  const P = tri.map(i => unproject(state.corners[i]));
  const n = cross(sub(P[1], P[0]), sub(P[2], P[0]));
  const d = { x: (px - W / 2) / FOCAL, y: (py - H / 2) / FOCAL, z: 1 };
  const denom = dot(n, d);
  if (Math.abs(denom) < 1e-12) return null;
  const t = dot(n, P[0]) / denom;
  const Q = { x: d.x * t, y: d.y * t, z: d.z * t };
  // Q 在 3D 三角形中的重心坐标
  const v0 = sub(P[2], P[0]), v1 = sub(P[1], P[0]), v2 = sub(Q, P[0]);
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1);
  const d20 = dot(v2, v0), d21 = dot(v2, v1);
  const det = d00 * d11 - d01 * d01;
  if (Math.abs(det) < 1e-12) return null;
  const m2 = (d11 * d20 - d01 * d21) / det; // P0 权重
  const m1 = (d00 * d21 - d01 * d20) / det; // P1 权重
  const m0 = 1 - m1 - m2;
  const mu = [m0, m1, m2];
  let u = 0, v = 0;
  for (let k = 0; k < 3; k++) {
    u += mu[k] * state.uvs[tri[k]][0];
    v += mu[k] * state.uvs[tri[k]][1];
  }
  return { u, v };
}

// 四个 3D 角点是否构成平行四边形（P0 + P2 ≈ P1 + P3）
function isParallelogram3D() {
  const P = state.corners.map(unproject);
  const d = {
    x: P[0].x + P[2].x - P[1].x - P[3].x,
    y: P[0].y + P[2].y - P[1].y - P[3].y,
    z: P[0].z + P[2].z - P[1].z - P[3].z,
  };
  return Math.hypot(d.x, d.y, d.z) < 1e-6;
}

// ---------- 覆盖层 ----------
function drawOverlay(ctx) {
  const cs = state.corners;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = cs[i], b = cs[(i + 1) % 4];
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  // 对角线
  const dg = state.diag === "A" ? [0, 2] : [1, 3];
  ctx.strokeStyle = "rgba(77,163,255,0.9)";
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(cs[dg[0]].x, cs[dg[0]].y);
  ctx.lineTo(cs[dg[1]].x, cs[dg[1]].y);
  ctx.stroke();
  ctx.setLineDash([]);
  // 角点手柄
  cs.forEach((c, i) => {
    ctx.fillStyle = "#ffb454";
    ctx.strokeStyle = "#14171c";
    ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "11px monospace";
    ctx.fillText(`v${i} w=${c.w.toFixed(2)}`, c.x + 9, c.y - 8);
  });
  // 探针
  if (state.probe) {
    const { x, y } = state.probe;
    ctx.strokeStyle = "#ff5fa2";
    ctx.beginPath();
    ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y);
    ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8);
    ctx.stroke();
  }
}

// ---------- 探针读数 ----------
const probeTable = document.getElementById("probeTable");

function fmt(v, n = 4) { return Number.isFinite(v) ? v.toFixed(n) : "—"; }

function errClass(e) { return e < 1e-3 ? "err-good" : "err-bad"; }

function updateProbe() {
  const p = state.probe;
  if (!p) {
    probeTable.innerHTML = `<tr><td class="k">状态</td><td class="v">将鼠标移到画布上</td></tr>`;
    return;
  }
  const hit = locateTriangle(p.x, p.y);
  if (!hit) {
    probeTable.innerHTML =
      `<tr><td class="k">屏幕坐标</td><td class="v">(${fmt(p.x,1)}, ${fmt(p.y,1)})</td></tr>` +
      `<tr><td class="k">状态</td><td class="v">四边形外</td></tr>`;
    return;
  }
  const { triIndex, tri, lam } = hit;
  const aff = interpolateUV(tri, lam, "affine");
  const per = interpolateUV(tri, lam, "persp");
  const ana = analyticUV(tri, p.x, p.y);
  let rows = "";
  const row = (k, v, cls) => { rows += `<tr><td class="k">${k}</td><td class="v"${cls ? ` class="${cls}"` : ""}>${v}</td></tr>`; };
  row("屏幕坐标", `(${fmt(p.x,1)}, ${fmt(p.y,1)})`);
  row("所在三角形", `T${triIndex} (v${tri[0]}, v${tri[1]}, v${tri[2]})`);
  row("屏幕重心坐标 λ", `(${fmt(lam[0])}, ${fmt(lam[1])}, ${fmt(lam[2])})`);
  row("插值 u/w", fmt(per.uw, 5));
  row("插值 v/w", fmt(per.vw, 5));
  row("插值 1/w", fmt(per.iw, 5));
  row("透视校正 UV", `(${fmt(per.u)}, ${fmt(per.v)})`);
  row("仿射 UV", `(${fmt(aff.u)}, ${fmt(aff.v)})`);
  if (ana) {
    const eP = Math.hypot(per.u - ana.u, per.v - ana.v);
    const eA = Math.hypot(aff.u - ana.u, aff.v - ana.v);
    row("解析平面求交 UV", `(${fmt(ana.u)}, ${fmt(ana.v)})`);
    row("误差·透视校正", fmt(eP, 6), errClass(eP));
    row("误差·仿射", fmt(eA, 6), errClass(eA));
  } else {
    row("解析平面求交 UV", "退化");
  }
  probeTable.innerHTML = rows;
}

// ---------- 主渲染 ----------
const cvA = document.getElementById("cvAffine");
const cvP = document.getElementById("cvPersp");
const ctxA = cvA.getContext("2d");
const ctxP = cvP.getContext("2d");

function render() {
  rasterize(ctxA, "affine");
  rasterize(ctxP, "persp");
  drawOverlay(ctxA);
  drawOverlay(ctxP);
  updateProbe();
  updateDiagNote();
}

// ---------- UI：深度滑杆 ----------
const sliderBox = document.getElementById("depthSliders");
const sliderInputs = [];

function buildSliders() {
  state.corners.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("label");
    label.textContent = `v${i} 深度 w`;
    const input = document.createElement("input");
    input.type = "range"; input.min = "0.4"; input.max = "3.0"; input.step = "0.01";
    input.value = c.w;
    const val = document.createElement("span");
    val.className = "val"; val.textContent = c.w.toFixed(2);
    input.addEventListener("input", () => {
      c.w = parseFloat(input.value);
      val.textContent = c.w.toFixed(2);
      render();
    });
    row.append(label, input, val);
    sliderBox.appendChild(row);
    sliderInputs.push({ input, val });
  });
}

function syncSliders() {
  state.corners.forEach((c, i) => {
    sliderInputs[i].input.value = c.w;
    sliderInputs[i].val.textContent = c.w.toFixed(2);
  });
}

// ---------- UI：对角线切换 ----------
const diagNote = document.getElementById("diagNote");

function updateDiagNote() {
  diagNote.textContent = isParallelogram3D()
    ? "当前为 3D 平行四边形：透视校正视图在两种对角线下完全一致；仿射视图随三角化改变。"
    : "当前非 3D 平行四边形：两种对角线对应不同的双线性插值面，透视校正视图也会出现合理差异。";
}

document.getElementById("diagSeg").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  state.diag = btn.dataset.diag;
  document.querySelectorAll("#diagSeg button").forEach(b =>
    b.classList.toggle("active", b === btn));
  render();
});

// ---------- UI：预设 ----------
function applyPreset(preset) {
  preset.forEach((p, i) => Object.assign(state.corners[i], p));
  syncSliders();
  render();
}
document.getElementById("btnTilt").addEventListener("click", () => applyPreset(TILT));
document.getElementById("btnFlat").addEventListener("click", () => applyPreset(FLAT));
document.getElementById("btnWarped").addEventListener("click", () => applyPreset(WARPED));
document.getElementById("btnReset").addEventListener("click", () => applyPreset(DEFAULTS));

// ---------- 画布交互 ----------
function canvasPos(cv, e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (cv.width / r.width),
           y: (e.clientY - r.top) * (cv.height / r.height) };
}

function nearestCorner(p) {
  let best = -1, bestD = 14;
  state.corners.forEach((c, i) => {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

for (const cv of [cvA, cvP]) {
  cv.addEventListener("mousedown", e => {
    state.dragIndex = nearestCorner(canvasPos(cv, e));
  });
  cv.addEventListener("mousemove", e => {
    const p = canvasPos(cv, e);
    if (state.dragIndex >= 0) {
      const c = state.corners[state.dragIndex];
      c.x = Math.max(0, Math.min(W, p.x));
      c.y = Math.max(0, Math.min(H, p.y));
    }
    state.probe = p;
    render();
  });
  cv.addEventListener("mouseup", () => { state.dragIndex = -1; });
  cv.addEventListener("mouseleave", () => {
    state.dragIndex = -1;
    state.probe = null;
    render();
  });
  cv.addEventListener("wheel", e => {
    const i = nearestCorner(canvasPos(cv, e));
    if (i < 0) return;
    e.preventDefault();
    const c = state.corners[i];
    c.w = Math.max(0.4, Math.min(3.0, c.w + (e.deltaY < 0 ? 0.05 : -0.05)));
    syncSliders();
    render();
  }, { passive: false });
}

// ---------- 启动 ----------
buildSliders();
render();
