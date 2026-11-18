// app.js — 投影映射、渲染循环、UI、足迹可视化
"use strict";

const W = 360, H = 240;
const CAM_H = 1.0;                 // 相机离地高度（世界单位）
const FOV_TAN = 0.7;               // tan(半视角)
const ASPECT = W / H;

// 像素 -> 世界射线 -> 地面 (y=-CAM_H) -> 纹理 uv（texel）
// tiltDeg: 视线相对垂直向下的倾角；texScale: 每世界单位的 texel 数（缩小比例）
function projectPixel(px, py, tiltRad, texScale) {
  const nx = ((px + 0.5) / W) * 2 - 1;
  const ny = 1 - ((py + 0.5) / H) * 2;
  const cx = nx * FOV_TAN * ASPECT, cy = ny * FOV_TAN, cz = -1;
  // 相机先垂直向下看，再绕 x 轴倾转 tilt
  const d1x = cx, d1y = cz, d1z = cy;
  const ct = Math.cos(tiltRad), st = Math.sin(tiltRad);
  const dy = ct * d1y + st * d1z;
  const dz = -st * d1y + ct * d1z;
  const dx = d1x;
  if (dy >= -1e-6) return null;    // 射线不朝向地面
  const t = -CAM_H / dy;
  return { u: dx * t * texScale, v: dz * t * texScale };
}

// 精确数值 Jacobian：用相邻像素的真实投影差分
function pixelJacobian(px, py, tiltRad, texScale) {
  const p0 = projectPixel(px, py, tiltRad, texScale);
  if (!p0) return null;
  const px1 = projectPixel(px + 1, py, tiltRad, texScale);
  const py1 = projectPixel(px, py + 1, tiltRad, texScale);
  if (!px1 || !py1) return null;
  return {
    u: p0.u, v: p0.v,
    dudx: px1.u - p0.u, dvdx: px1.v - p0.v,
    dudy: py1.u - p0.u, dvdy: py1.v - p0.v,
  };
}

// 用给定采样函数渲染整幅图，返回 { img: ImageData, ms }
function renderView(tex, samplerFn, tiltRad, texScale) {
  const img = new ImageData(W, H);
  const t0 = performance.now();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const j = pixelJacobian(x, y, tiltRad, texScale);
      const idx = (y * W + x) * 4;
      let g = 0;
      if (j) {
        const ell = footprintEllipse(j.dudx, j.dudy, j.dvdx, j.dvdy);
        g = Math.max(0, Math.min(1, samplerFn(tex, j.u, j.v, ell)));
      } else {
        g = 0.12; // 地平线以上：暗色背景
      }
      const b = (g * 255) | 0;
      img.data[idx] = b; img.data[idx + 1] = b; img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }
  }
  return { img, ms: performance.now() - t0 };
}

// ---------- 全局状态 ----------
const state = {
  texKind: "checker",
  tiltDeg: 62,
  scaleSlider: 50,      // 0..100 -> texScale = 2^(slider*0.08)
  budget: 16,
  weight: "box",
  lodComp: true,
  probe: { x: (W / 2) | 0, y: (H * 0.62) | 0 },
  tex: null,
  results: {},          // name -> { img, ms }
};

function texScaleFromSlider(s) { return Math.pow(2, s * 0.08); }

function rmse(a, b) {
  let s = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = a.data[i] - b.data[i];
    s += d * d;
  }
  return Math.sqrt(s / (a.data.length / 4)) / 255;
}

const $ = (id) => document.getElementById(id);
const ctxOf = (id) => $(id).getContext("2d");

function drawProbeMarker(ctx) {
  const { x, y } = state.probe;
  ctx.strokeStyle = "#ff5c5c";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y);
  ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6);
  ctx.stroke();
}

function renderAll() {
  state.tex = makeTexture(state.texKind);
  const tiltRad = (state.tiltDeg * Math.PI) / 180;
  const texScale = texScaleFromSlider(state.scaleSlider);
  const budget = state.budget, weight = state.weight, lodComp = state.lodComp;

  const runs = [
    ["Point", (t, u, v) => samplePoint(t, u, v)],
    ["Iso", (t, u, v, e) => sampleIsoMip(t, u, v, e)],
    ["Ellipse", (t, u, v, e) => sampleEllipseFilter(t, u, v, e, budget, weight, lodComp).value],
    ["Ref", (t, u, v, e) => sampleReference(t, u, v, e)],
  ];
  for (const [name, fn] of runs) {
    const r = renderView(state.tex, fn, tiltRad, texScale);
    state.results[name] = r;
    const ctx = ctxOf("view" + name);
    ctx.putImageData(r.img, 0, 0);
    drawProbeMarker(ctx);
  }

  // 耗时与 RMSE
  const ref = state.results.Ref.img;
  const set = (id, v) => { $(id).textContent = v; };
  set("timePoint", state.results.Point.ms.toFixed(1) + " ms");
  set("timeIso", state.results.Iso.ms.toFixed(1) + " ms");
  set("timeEllipse", state.results.Ellipse.ms.toFixed(1) + " ms");
  set("timeRef", state.results.Ref.ms.toFixed(1) + " ms");
  set("mTimePoint", state.results.Point.ms.toFixed(1));
  set("mTimeIso", state.results.Iso.ms.toFixed(1));
  set("mTimeEllipse", state.results.Ellipse.ms.toFixed(1));
  set("mRmsePoint", (rmse(state.results.Point.img, ref) * 100).toFixed(2) + "%");
  set("mRmseIso", (rmse(state.results.Iso.img, ref) * 100).toFixed(2) + "%");
  set("mRmseEllipse", (rmse(state.results.Ellipse.img, ref) * 100).toFixed(2) + "%");

  updateProbePanel(tiltRad, texScale);
  drawFootprintView(tiltRad, texScale);
}

// ---------- 探针信息 ----------
function probeData(tiltRad, texScale) {
  const j = pixelJacobian(state.probe.x, state.probe.y, tiltRad, texScale);
  if (!j) return null;
  const ell = footprintEllipse(j.dudx, j.dudy, j.dvdx, j.dvdy);
  const res = sampleEllipseFilter(state.tex, j.u, j.v, ell,
    state.budget, state.weight, state.lodComp);
  return { j, ell, res };
}

function updateProbePanel(tiltRad, texScale) {
  const pd = probeData(tiltRad, texScale);
  const noteEl = $("mNoteEllipse");
  if (!pd) {
    $("probeInfo").textContent = "探针位于地平线以上，无足迹。";
    noteEl.textContent = "—";
    return;
  }
  const { j, ell, res } = pd;
  const lines = [
    `探针像素: (${state.probe.x}, ${state.probe.y})`,
    `纹理 uv : (${j.u.toFixed(1)}, ${j.v.toFixed(1)}) texel`,
    `足迹椭圆: 长轴 ${(ell.major * 2).toFixed(1)} texel, 短轴 ${(ell.minor * 2).toFixed(1)} texel`,
    `各向异性比: ${ell.ratio.toFixed(1)} : 1`,
    `椭圆滤波: LOD ${res.lod.toFixed(2)}, 采样 ${res.usedN} 次（理论需要 ${res.needN} 次）`,
  ];
  if (res.clamped) {
    const under = ell.ratio / state.budget;
    lines.push(`⚠ 足迹过细长，超出预算 ${under.toFixed(1)}×`);
    if (state.lodComp) {
      lines.push(`  已提升 LOD 至 ${res.lod.toFixed(2)} 补偿：长轴方向以模糊换取无混叠，`);
      lines.push(`  误差表现为细节变糊（对比参考图可见锐度下降）。`);
      noteEl.textContent = `超预算 ${under.toFixed(1)}×，LOD 补偿为 ${res.lod.toFixed(1)}，长轴细节模糊`;
    } else {
      lines.push(`  未做 LOD 补偿：长轴方向欠采样，残留混叠/闪烁，`);
      lines.push(`  误差量级 ≈ 未覆盖的高频能量（RMSE 升高）。`);
      noteEl.textContent = `超预算 ${under.toFixed(1)}×，长轴欠采样，残留混叠`;
    }
    noteEl.className = "warn";
  } else {
    lines.push(`足迹在预算内，椭圆滤波逼近参考解。`);
    noteEl.textContent = `N=${res.usedN}，预算内，逼近参考`;
    noteEl.className = "";
  }
  $("probeInfo").textContent = lines.join("\n");
}

// ---------- 足迹可视化（纹理空间） ----------
function drawFootprintView(tiltRad, texScale) {
  const cv = $("footprintView");
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#10131a";
  ctx.fillRect(0, 0, cv.width, cv.height);
  const pd = probeData(tiltRad, texScale);
  if (!pd) {
    ctx.fillStyle = "#8892a3";
    ctx.font = "13px sans-serif";
    ctx.fillText("探针在地平线以上", 20, 30);
    return;
  }
  const { j, ell, res } = pd;
  const half = Math.max(ell.major * 1.3, 6);      // 视野半径（texel）
  const scale = cv.width / (half * 2);            // 像素/texel
  const toPx = (u, v) => [cv.width / 2 + (u - j.u) * scale,
                          cv.height / 2 + (v - j.v) * scale];

  // 底图：level 0 纹理（最近邻放大）
  const lvl = state.tex.levels[0];
  const u0 = Math.floor(j.u - half), v0 = Math.floor(j.v - half);
  const n = Math.ceil(half * 2) + 1;
  const off = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const uu = ((u0 + x) % TEX_SIZE + TEX_SIZE) % TEX_SIZE;
      const vv = ((v0 + y) % TEX_SIZE + TEX_SIZE) % TEX_SIZE;
      const g = (lvl.data[vv * TEX_SIZE + uu] * 255) | 0;
      const i = (y * n + x) * 4;
      off.data[i] = g; off.data[i + 1] = g; off.data[i + 2] = g; off.data[i + 3] = 255;
    }
  }
  const tmp = document.createElement("canvas");
  tmp.width = n; tmp.height = n;
  tmp.getContext("2d").putImageData(off, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const [px0, py0] = toPx(u0, v0);
  ctx.drawImage(tmp, px0, py0, n * scale, n * scale);
  ctx.imageSmoothingEnabled = true;

  // 足迹椭圆（屏幕像素逆映射到纹理空间）
  ctx.strokeStyle = "#4da3ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cv.width / 2, cv.height / 2, ell.major * scale, ell.minor * scale,
    Math.atan2(ell.dirY, ell.dirX), 0, Math.PI * 2);
  ctx.stroke();

  // 椭圆滤波的采样位置
  ctx.fillStyle = "#ffd34d";
  for (const o of res.offsets) {
    const [sx, sy] = toPx(j.u + o.du, j.v + o.dv);
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 各向同性 mip 的等效圆形足迹（直径 = 长轴），用于对比
  ctx.strokeStyle = "rgba(240,110,90,0.9)";
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.arc(cv.width / 2, cv.height / 2, ell.major * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 图例
  ctx.fillStyle = "#c6cfdd";
  ctx.font = "12px sans-serif";
  ctx.fillText("蓝实线: 足迹椭圆   黄点: 椭圆滤波采样位置", 10, 18);
  ctx.fillText("红虚线: 各向同性 mip 的等效圆形足迹", 10, 34);
  ctx.fillText(`LOD ${res.lod.toFixed(2)}  N=${res.usedN}/${res.needN}`, 10, cv.height - 10);
}

// ---------- UI 绑定 ----------
let renderTimer = null;
function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(renderAll, 120);
}

function bindUI() {
  const upd = () => {
    state.texKind = $("ctlTexture").value;
    state.tiltDeg = +$("ctlTilt").value;
    state.scaleSlider = +$("ctlScale").value;
    state.budget = +$("ctlBudget").value;
    state.weight = $("ctlWeight").value;
    state.lodComp = $("ctlLodComp").checked;
    $("lblTilt").textContent = state.tiltDeg + "°";
    $("lblScale").textContent = texScaleFromSlider(state.scaleSlider).toFixed(1) + " texel/单位";
    $("lblBudget").textContent = state.budget;
    scheduleRender();
  };
  for (const id of ["ctlTexture", "ctlTilt", "ctlScale", "ctlBudget", "ctlWeight", "ctlLodComp"]) {
    $(id).addEventListener("input", upd);
  }
  for (const id of ["viewPoint", "viewIso", "viewEllipse", "viewRef"]) {
    $(id).addEventListener("click", (e) => {
      const r = e.target.getBoundingClientRect();
      state.probe.x = Math.round(((e.clientX - r.left) / r.width) * (W - 1));
      state.probe.y = Math.round(((e.clientY - r.top) / r.height) * (H - 1));
      renderAll();
    });
  }
  upd();
}

if (typeof document !== "undefined") bindUI();
