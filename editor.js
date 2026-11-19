// Browser pose editor: arcball manipulation, three interpolation methods,
// angular-velocity chart, joint table and per-frame matrix export.

import { Q, normalize, neg } from "./lib/quat.js";
import {
  fromAxisAngle, toAxisAngle, toEuler, fromEuler, toMatrix
} from "./lib/convert.js";
import {
  buildPath, sampleFrames, frameVelocities, jointJumps, fullTurnAudit
} from "./lib/sampling.js";
import { validateFrames } from "./lib/validate.js";

const deg = (d) => (d * Math.PI) / 180;
const rad = (r) => (r * 180) / Math.PI;
const zRot = (d) => fromAxisAngle([0, 0, 1], deg(d));
const xRot = (d) => fromAxisAngle([1, 0, 0], deg(d));

const state = {
  method: "slerp",
  keys: [],
  selected: 0,
  playing: false,
  playT: 0
};

const PRESETS = {
  near180() {
    return [
      { t: 0, q: zRot(0) },
      { t: 1, q: zRot(179.999) },
      { t: 2, q: xRot(90) }
    ];
  },
  negq() {
    const a = zRot(40);
    const b = xRot(110);
    return [
      { t: 0, q: a },
      { t: 1, q: neg(b) }, // identical orientation, opposite quaternion sign
      { t: 2, q: zRot(-60) }
    ];
  },
  repeat() {
    return [
      { t: 0, q: zRot(0) },
      { t: 1, q: zRot(45) },
      { t: 2, q: zRot(45) },
      { t: 3, q: zRot(90) }
    ];
  },
  nonuniform() {
    return [
      { t: 0, q: zRot(0) },
      { t: 0.15, q: zRot(60) },
      { t: 2, q: xRot(80) },
      { t: 3.5, q: zRot(-40) }
    ];
  },
  eulerlong() {
    // Same physical endpoints, different Euler winding: +190 vs -170.
    return [
      { t: 0, q: fromEuler([0, 0, deg(190)]), e: [0, 0, deg(190)] },
      { t: 1, q: fromEuler([0, 0, deg(-170)]), e: [0, 0, deg(-170)] },
      { t: 2, q: xRot(60) }
    ];
  },
  mixed() {
    return [
      { t: 0, q: zRot(0) },
      { t: 0.4, q: xRot(120) },
      { t: 1.1, q: zRot(175) },
      { t: 2.6, q: xRot(-80) },
      { t: 4, q: zRot(-160) }
    ];
  }
};

function loadPreset(name) {
  state.keys = PRESETS[name]().map((k) => ({
    t: k.t,
    q: normalize(k.q),
    e: k.e ? k.e.slice() : undefined
  }));
  state.selected = 0;
  renderAll();
}

// ---------- Arcball viewport ----------
const vp = document.getElementById("viewport");
const vctx = vp.getContext("2d");

// Fixed world-to-view basis (camera looks down -Z).
const VIEW = {
  ex: [1, 0, 0],
  ey: [0, 1, 0],
  ez: [0, 0, 1]
};

function project(v, center, radius) {
  return [
    center + radius * dot3(v, VIEW.ex),
    center - radius * dot3(v, VIEW.ey)
  ];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Map a canvas pixel to a point on the unit arcball sphere.
function pixelToBall(px, py) {
  const c = vp.width / 2;
  const r = vp.width * 0.42;
  const x = (px - c) / r;
  const y = (py - c) / r;
  const d2 = x * x + y * y;
  if (d2 <= 1) return [x, -y, Math.sqrt(1 - d2)];
  const n = 1 / Math.sqrt(d2); // hyperbolic sheet outside the sphere
  return [x * n, -y * n, 0];
}

function arcballQuat(a, b) {
  const axis = cross3(a, b);
  const aLen = Math.hypot(...axis);
  if (aLen < 1e-9) return new Q(1, 0, 0, 0);
  const angle = 2 * Math.acos(Math.min(1, dot3(a, b)));
  return fromAxisAngle([axis[0] / aLen, axis[1] / aLen, axis[2] / aLen], angle);
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function drawGizmo(quat) {
  const c = vp.width / 2;
  const r = vp.width * 0.42;
  vctx.clearRect(0, 0, vp.width, vp.height);

  // Sphere outline + faint equator guides.
  vctx.strokeStyle = "#2c3a58";
  vctx.lineWidth = 1;
  vctx.beginPath();
  vctx.arc(c, c, r, 0, Math.PI * 2);
  vctx.stroke();
  for (const axisWorld of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    vctx.beginPath();
    for (let k = 0; k <= 48; k++) {
      const ang = (k / 48) * Math.PI * 2;
      const basis = perpendicular(axisWorld);
      const p = rotateAround(axisWorld, basis, ang);
      const [sx, sy] = project(p, c, r);
      k === 0 ? vctx.moveTo(sx, sy) : vctx.lineTo(sx, sy);
    }
    vctx.stroke();
  }

  // Rotated body axes.
  const axes = [
    { v: [1, 0, 0], color: "#ff6b6b", label: "X" },
    { v: [0, 1, 0], color: "#6bd08a", label: "Y" },
    { v: [0, 0, 1], color: "#6ba8ff", label: "Z" }
  ];
  for (const ax of axes) {
    const tip = rotateVecPub(quat, ax.v);
    const [x2, y2] = project(tip, c, r);
    vctx.strokeStyle = ax.color;
    vctx.fillStyle = ax.color;
    vctx.lineWidth = 3;
    vctx.beginPath();
    vctx.moveTo(c, c);
    vctx.lineTo(x2, y2);
    vctx.stroke();
    vctx.beginPath();
    vctx.arc(x2, y2, 5, 0, Math.PI * 2);
    vctx.fill();
    vctx.font = "13px sans-serif";
    vctx.fillText(ax.label, x2 + 7, y2 - 7);
  }
}

function rotateAround(axis, basis, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return basis.map((b, i) =>
    b * c + cross3(axis, basis)[i] * s + axis[i] * dot3(axis, basis) * (1 - c));
}

function perpendicular(v) {
  const ref = Math.abs(v[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const p = cross3(v, ref);
  const n = Math.hypot(...p);
  return p.map((x) => x / n);
}

function rotateVecPub(quat, v) {
  // Reuse the library rotation via a temporary axis-angle-free path.
  const R = toMatrix(quat);
  return [
    R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
    R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
    R[2] * v[0] + R[5] * v[1] + R[8] * v[2]
  ];
}

let dragStart = null;
let dragStartQ = null;

vp.addEventListener("pointerdown", (e) => {
  vp.setPointerCapture(e.pointerId);
  const rect = vp.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (vp.width / rect.width);
  const sy = (e.clientY - rect.top) * (vp.height / rect.height);
  dragStart = pixelToBall(sx, sy);
  dragStartQ = state.keys[state.selected].q.clone();
});

vp.addEventListener("pointermove", (e) => {
  if (!dragStart) return;
  const rect = vp.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (vp.width / rect.width);
  const sy = (e.clientY - rect.top) * (vp.height / rect.height);
  const cur = pixelToBall(sx, sy);
  const dq = arcballQuat(dragStart, cur);
  // Left-apply the view-space drag to the body's current orientation.
  state.keys[state.selected].q = normalize(mulPub(dq, dragStartQ));
  state.keys[state.selected].e = undefined; // raw Euler winding no longer valid
  renderAll();
});

vp.addEventListener("pointerup", () => { dragStart = null; });
vp.addEventListener("pointercancel", () => { dragStart = null; });

function mulPub(a, b) {
  return new Q(
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
  );
}

// ---------- Key table ----------
const keyRows = document.getElementById("keyRows");

function fmtQ(q0) {
  return [q0.w, q0.x, q0.y, q0.z].map((v) => v.toFixed(3)).join(", ");
}

function fmtEuler(q0) {
  return toEuler(q0).map((v) => rad(v).toFixed(1)).join(", ");
}

function renderKeys() {
  keyRows.innerHTML = "";
  state.keys.forEach((k, i) => {
    const tr = document.createElement("tr");
    tr.className = "keyrow" + (i === state.selected ? " selected" : "");
    tr.innerHTML =
      `<td>${i}</td>` +
      `<td><input type="number" step="0.05" value="${k.t}" data-i="${i}" class="tinput" style="width:70px"></td>` +
      `<td class="mono">${fmtQ(k.q)}</td>` +
      `<td class="mono">${fmtEuler(k.q)}</td>` +
      `<td><button data-select="${i}">编辑</button></td>`;
    keyRows.appendChild(tr);
  });
  keyRows.querySelectorAll("[data-select]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selected = Number(btn.dataset.select);
      renderAll();
    });
  });
  keyRows.querySelectorAll(".tinput").forEach((inp) => {
    inp.addEventListener("change", () => {
      const i = Number(inp.dataset.i);
      state.keys[i].t = Math.max(0, Number(inp.value));
      state.keys.sort((a, b) => a.t - b.t);
      renderAll();
    });
  });
}

function renderReadout() {
  const k = state.keys[state.selected];
  if (!k) return;
  const { axis, angle } = toAxisAngle(k.q);
  document.getElementById("poseReadout").textContent =
    `关键帧 #${state.selected}  t=${k.t}\n` +
    `轴角: axis=(${axis.map((v) => v.toFixed(3)).join(", ")})  angle=${rad(angle).toFixed(2)}°\n` +
    `四元数: (${[k.q.w, k.q.x, k.q.y, k.q.z].map((v) => v.toFixed(5)).join(", ")})`;
  drawGizmo(k.q);
}

// ---------- Speed chart ----------
const chart = document.getElementById("speedChart");
const cctx = chart.getContext("2d");
const METHOD_COLORS = { euler: "#ffb86b", slerp: "#6ba8ff", squad: "#6bd08a" };
const METHOD_LABELS = { euler: "Euler 线性", slerp: "Slerp", squad: "Squad" };

function renderChart() {
  const W = chart.width;
  const H = chart.height;
  cctx.clearRect(0, 0, W, H);
  const frameCount = Math.max(8, Number(document.getElementById("frameCount").value) || 240);
  const all = {};
  let maxSpeed = 0.01;
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const method of ["euler", "slerp", "squad"]) {
    const path = buildPath(method, state.keys);
    const vels = frameVelocities(sampleFrames(path, frameCount));
    all[method] = vels;
    for (const v of vels) {
      maxSpeed = Math.max(maxSpeed, v.speed);
      tMin = Math.min(tMin, v.t);
      tMax = Math.max(tMax, v.t);
    }
  }
  const pad = 36;
  const xOf = (t) => pad + ((t - tMin) / Math.max(1e-9, tMax - tMin)) * (W - 2 * pad);
  const yOf = (s) => H - pad - (s / maxSpeed) * (H - 2 * pad);

  cctx.strokeStyle = "#222d44";
  cctx.fillStyle = "#7e90b0";
  cctx.lineWidth = 1;
  cctx.font = "11px monospace";
  for (let g = 0; g <= 4; g++) {
    const y = pad + (g / 4) * (H - 2 * pad);
    cctx.beginPath();
    cctx.moveTo(pad, y);
    cctx.lineTo(W - pad, y);
    cctx.stroke();
    cctx.fillText((maxSpeed * (1 - g / 4)).toFixed(2), 4, y + 4);
  }
  // Key time markers.
  for (const k of state.keys) {
    const x = xOf(k.t);
    cctx.strokeStyle = "#3a4a6e";
    cctx.beginPath();
    cctx.moveTo(x, pad);
    cctx.lineTo(x, H - pad);
    cctx.stroke();
  }
  for (const method of ["euler", "slerp", "squad"]) {
    cctx.strokeStyle = METHOD_COLORS[method];
    cctx.lineWidth = 2;
    cctx.beginPath();
    all[method].forEach((v, i) => {
      const x = xOf(v.t);
      const y = yOf(v.speed);
      i === 0 ? cctx.moveTo(x, y) : cctx.lineTo(x, y);
    });
    cctx.stroke();
  }
  document.getElementById("legend").innerHTML = ["euler", "slerp", "squad"]
    .map((m) => `<span style="color:${METHOD_COLORS[m]}">${METHOD_LABELS[m]}</span>`).join("");
}

// ---------- Joint table + audit ----------
function renderJoints() {
  const body = document.getElementById("jointRows");
  const path = buildPath(state.method, state.keys);
  const rows = jointJumps(path);
  body.innerHTML = rows.map((r) => {
    const cls = r.jumpMag > 0.5 ? "jump-high" : "jump-low";
    return `<tr>
      <td>#${r.index}</td>
      <td>${r.t.toFixed(3)}</td>
      <td>${r.speedLeft.toFixed(4)}</td>
      <td>${r.speedRight.toFixed(4)}</td>
      <td>(${r.jump.map((v) => v.toFixed(3)).join(", ")})</td>
      <td class="${cls}">${r.jumpMag.toFixed(4)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6">需要至少 3 个关键姿态才能显示连接处变化</td></tr>`;
}

function renderAudit() {
  const frameCount = Math.max(8, Number(document.getElementById("frameCount").value) || 240);
  const path = buildPath(state.method, state.keys);
  const audit = fullTurnAudit(path);
  const frames = sampleFrames(path, frameCount).map((f) => ({ R: toMatrix(f.q) }));
  const valid = validateFrames(frames, 1e-10);
  const geodesicTotal = audit.segments.reduce((s, x) => s + x.geodesic, 0);
  const lines = [
    `方法: ${METHOD_LABELS[state.method]}   帧数: ${valid.count}`,
    `矩阵正交误差 max|RᵀR−I|: ${valid.worstOrtho.toExponential(3)}`,
    `行列式偏差 max|det(R)−1|: ${valid.worstDet.toExponential(3)}`,
    `矩阵校验: ${valid.pass ? "通过 ✓" : "失败 ✗"}`,
    `短弧行程合计: ${geodesicTotal.toFixed(4)} rad   实际路径合计: ${
      audit.segments.reduce((s, x) => s + x.traveled, 0).toFixed(4)} rad`,
    `意外整圈: ${audit.anyFullTurn ? "检测到 ✗" : "无 ✓"}`,
    audit.segments.map((s) =>
      `段 ${s.i}: 短弧 ${s.geodesic.toFixed(3)} → 行程 ${s.traveled.toFixed(3)}`).join("\n")
  ];
  document.getElementById("audit").textContent = lines.join("\n");
}

function renderAll() {
  if (!state.keys.length) return;
  renderKeys();
  renderReadout();
  renderChart();
  renderJoints();
  renderAudit();
}

// ---------- Controls ----------
document.getElementById("methodSwitch").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-method]");
  if (!btn) return;
  state.method = btn.dataset.method;
  document.querySelectorAll("#methodSwitch button").forEach((b) =>
    b.classList.toggle("active", b === btn));
  renderAll();
});

document.getElementById("presets").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-preset]");
  if (btn) loadPreset(btn.dataset.preset);
});

document.getElementById("addKey").addEventListener("click", () => {
  const lastT = state.keys.length ? state.keys[state.keys.length - 1].t : 0;
  state.keys.push({ t: lastT + 1, q: new Q(1, 0, 0, 0) });
  state.selected = state.keys.length - 1;
  renderAll();
});

document.getElementById("dupKey").addEventListener("click", () => {
  const k = state.keys[state.selected];
  state.keys.push({ t: k.t + 0.5, q: k.q.clone(), e: k.e ? k.e.slice() : undefined });
  state.keys.sort((a, b) => a.t - b.t);
  state.selected = state.keys.findIndex((x) => x.t === k.t + 0.5);
  renderAll();
});

document.getElementById("delKey").addEventListener("click", () => {
  if (state.keys.length <= 2) return;
  state.keys.splice(state.selected, 1);
  state.selected = Math.min(state.selected, state.keys.length - 1);
  renderAll();
});

document.getElementById("negKey").addEventListener("click", () => {
  const k = state.keys[state.selected];
  k.q = neg(k.q);
  renderAll();
});

document.getElementById("frameCount").addEventListener("change", renderAll);

function buildExport() {
  const frameCount = Math.max(8, Number(document.getElementById("frameCount").value) || 240);
  const path = buildPath(state.method, state.keys);
  return sampleFrames(path, frameCount).map((f) => ({
    t: Number(f.t.toFixed(6)),
    q: [f.q.w, f.q.x, f.q.y, f.q.z],
    R: toMatrix(f.q).map((v) => Number(v.toFixed(12)))
  }));
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("exportJson").addEventListener("click", () => {
  const frames = buildExport();
  const checks = validateFrames(frames.map((f) => ({ R: f.R })), 1e-10);
  download(`matrices_${state.method}.json`, JSON.stringify({
    method: state.method,
    convention: "column-major R, v' = R v",
    frameCount: frames.length,
    validation: checks,
    frames
  }, null, 1), "application/json");
});

document.getElementById("exportCsv").addEventListener("click", () => {
  const frames = buildExport();
  const header = "frame,t,R00,R10,R20,R01,R11,R21,R02,R12,R22";
  const rows = frames.map((f, i) =>
    [i, f.t, ...f.R.map((v) => v.toFixed(12))].join(","));
  download(`matrices_${state.method}.csv`, [header, ...rows].join("\n"), "text/csv");
});

// ---------- Playback ----------
const playBtn = document.getElementById("play");
playBtn.addEventListener("click", () => {
  state.playing = !state.playing;
  playBtn.textContent = state.playing ? "⏸ 暂停" : "▶ 播放";
  if (state.playing) requestAnimationFrame(playTick);
});

function playTick(now) {
  if (!state.playing) return;
  const t0 = state.keys[0].t;
  const t1 = state.keys[state.keys.length - 1].t;
  if (state.playT > t1) state.playT = t0;
  state.playT += 0.016;
  const path = buildPath(state.method, state.keys);
  drawGizmo(path.at(Math.min(state.playT, t1)));
  requestAnimationFrame(playTick);
}

// ---------- Init ----------
loadPreset("mixed");
