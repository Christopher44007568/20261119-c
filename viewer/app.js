/* BVH 射线拾取查看器：纯原生 JS + Canvas 2D，无构建依赖。 */
"use strict";

const SCENE = window.BVH_SCENE;
const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d");

const state = {
  strategy: "sah",
  geometry: "original", // original | refit | rebuilt
  depthLimit: 0,
  maxDepth: 0,
  selectedNode: null,
  visitIndex: -1,
  playing: false,
  playTimer: null,
  ray: { ...SCENE.ray },
  showMesh: true,
  showBoxes: true,
  showRay: true,
  camera: { yaw: 0.7, pitch: 0.42, dist: 11, target: [0, 1.2, 0] },
};

// --------------------------------------------------------------------- 向量
const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  norm: (a) => {
    const n = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / n, a[1] / n, a[2] / n];
  },
};

// --------------------------------------------------------------- 相机与投影
function cameraBasis() {
  const { yaw, pitch } = state.camera;
  const eye = [
    state.camera.target[0] + state.camera.dist * Math.cos(pitch) * Math.sin(yaw),
    state.camera.target[1] + state.camera.dist * Math.sin(pitch),
    state.camera.target[2] + state.camera.dist * Math.cos(pitch) * Math.cos(yaw),
  ];
  const forward = v3.norm(v3.sub(state.camera.target, eye));
  const right = v3.norm(v3.cross(forward, [0, 1, 0]));
  const up = v3.cross(right, forward);
  return { eye, forward, right, up };
}

function project(p, cam) {
  const rel = v3.sub(p, cam.eye);
  const z = v3.dot(rel, cam.forward);
  if (z <= 0.05) return null;
  const focal = canvas.height * 0.95;
  const x = canvas.width / 2 + (v3.dot(rel, cam.right) * focal) / z;
  const y = canvas.height / 2 - (v3.dot(rel, cam.up) * focal) / z;
  return { x, y, depth: z };
}

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(640 * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas.style.height = "640px";
}
window.addEventListener("resize", resizeCanvas);

// ------------------------------------------------------------- 当前数据访问
function currentTreeData() {
  if (state.geometry === "original") return SCENE.trees[state.strategy];
  const refit = SCENE.refit[state.strategy];
  return state.geometry === "rebuilt" ? refit.rebuilt : refit;
}

function currentVertices() {
  if (state.geometry === "original") {
    // 还原被移动的顶点
    const verts = SCENE.vertices.map((v) => [...v]);
    const mv = SCENE.movedVertex;
    verts[mv.index] = [...mv.from];
    return verts;
  }
  const verts = SCENE.vertices.map((v) => [...v]);
  return verts;
}

// ------------------------------------------------------------- JS 端射线求交
const EPS_T = 1e-9;
const EPS_D = 1e-12;

function rayAabb(ray, box) {
  let tLo = EPS_T;
  let tHi = ray.tmax;
  for (let i = 0; i < 3; i++) {
    const d = ray.direction[i];
    const o = ray.origin[i];
    if (Math.abs(d) < EPS_D) {
      if (o < box.lo[i] - EPS_D || o > box.hi[i] + EPS_D) return null;
      continue;
    }
    let t1 = (box.lo[i] - o) / d;
    let t2 = (box.hi[i] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tLo = Math.max(tLo, t1);
    tHi = Math.min(tHi, t2);
    if (tLo > tHi + EPS_D) return null;
  }
  return tLo;
}

function rayTriangle(ray, v0, v1, v2) {
  const e1 = v3.sub(v1, v0);
  const e2 = v3.sub(v2, v0);
  const p = v3.cross(ray.direction, e2);
  const det = v3.dot(e1, p);
  if (Math.abs(det) < EPS_D) return null;
  const inv = 1 / det;
  const tv = v3.sub(ray.origin, v0);
  const u = v3.dot(tv, p) * inv;
  if (u < -EPS_D || u > 1 + EPS_D) return null;
  const q = v3.cross(tv, e1);
  const v = v3.dot(ray.direction, q) * inv;
  if (v < -EPS_D || u + v > 1 + EPS_D) return null;
  const t = v3.dot(e2, q) * inv;
  if (t < EPS_T || t > ray.tmax) return null;
  return { t, bary: [Math.min(Math.max(u, 0), 1), Math.min(Math.max(v, 0), 1)] };
}

function makeRay(origin, direction) {
  return {
    origin: [...origin],
    direction: v3.norm(direction),
    tmax: Number.POSITIVE_INFINITY,
    at(t) {
      return [
        this.origin[0] + t * this.direction[0],
        this.origin[1] + t * this.direction[1],
        this.origin[2] + t * this.direction[2],
      ];
    },
  };
}

// 与 Python BVH.traverse 同构：近端优先 + 完整访问顺序
function traverseTree(tree, vertices, ray) {
  const nodes = tree.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order = [];
  let nodesTested = 1;
  let trisTested = 0;
  let best = null;
  const root = byId.get(tree.rootId);

  const t0 = rayAabb(ray, root.box);
  order.push({ nodeId: root.id, depth: 0, kind: t0 === null ? "miss" : "box", t: t0 });
  if (t0 === null) {
    return { hit: null, order, nodesTested: 1, trisTested: 0 };
  }
  const stack = [root];

  while (stack.length) {
    const node = stack.pop();
    if (node.leaf) {
      for (const triId of node.triIds) {
        trisTested++;
        const tri = SCENE.triangles[triId];
        const h = rayTriangle(
          ray,
          vertices[tri[0]],
          vertices[tri[1]],
          vertices[tri[2]]
        );
        if (h === null) {
          order.push({ nodeId: node.id, depth: node.depth, kind: "tri_miss", triId, t: null });
        } else {
          order.push({ nodeId: node.id, depth: node.depth, kind: "tri_hit", triId, t: h.t });
          if (best === null || h.t < best.t) {
            best = {
              triId,
              t: h.t,
              point: ray.at(h.t),
              bary: h.bary,
            };
          }
        }
      }
      continue;
    }
    const left = byId.get(node.left);
    const right = byId.get(node.right);
    const tL = rayAabb(ray, left.box);
    const tR = rayAabb(ray, right.box);
    nodesTested += 2;
    order.push({ nodeId: left.id, depth: left.depth, kind: tL === null ? "miss" : "box", t: tL });
    order.push({ nodeId: right.id, depth: right.depth, kind: tR === null ? "miss" : "box", t: tR });
    const pairs = [];
    if (tL !== null) pairs.push([left, tL]);
    if (tR !== null) pairs.push([right, tR]);
    pairs.sort((a, b) => b[1] - a[1]); // 远端先入栈
    for (const [child] of pairs) stack.push(child);
  }
  return { hit: best, order, nodesTested, trisTested };
}

function bruteForce(vertices, ray) {
  let best = null;
  SCENE.triangles.forEach((tri, triId) => {
    const h = rayTriangle(ray, vertices[tri[0]], vertices[tri[1]], vertices[tri[2]]);
    if (h !== null && (best === null || h.t < best.t)) {
      best = { triId, t: h.t, point: ray.at(h.t), bary: h.bary };
    }
  });
  return best;
}

let currentTrace = null;

function recomputeTrace() {
  const tree = currentTreeData();
  const vertices = currentVertices();
  const ray = makeRay(state.ray.origin, state.ray.direction);
  currentTrace = traverseTree(tree, vertices, ray);
  currentTrace.ray = ray;
  currentTrace.brute = bruteForce(vertices, ray);
  state.visitIndex = -1;
  const slider = document.getElementById("visitSlider");
  slider.max = Math.max(0, currentTrace.order.length - 1);
  slider.value = 0;
  stopPlay();
  renderAll();
}

// ---------------------------------------------------------------------- 绘制
const BOX_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function boxCorners(box) {
  const [x0, y0, z0] = box.lo;
  const [x1, y1, z1] = box.hi;
  return [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
}

function drawSegment(a, b, cam, color, width) {
  const pa = project(a, cam);
  const pb = project(b, cam);
  if (!pa || !pb) return;
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawBox(box, cam, color, width, alpha = 1) {
  const corners = boxCorners(box);
  ctx.globalAlpha = alpha;
  for (const [i, j] of BOX_EDGES) {
    drawSegment(corners[i], corners[j], cam, color, width);
  }
  ctx.globalAlpha = 1;
}

function drawMesh(vertices, cam) {
  const hitId = currentTrace && currentTrace.hit ? currentTrace.hit.triId : -1;
  for (let id = 0; id < SCENE.triangles.length; id++) {
    const [a, b, c] = SCENE.triangles[id];
    const pts = [vertices[a], vertices[b], vertices[c]];
    const screen = pts.map((p) => project(p, cam));
    if (screen.some((p) => !p)) continue;
    ctx.beginPath();
    ctx.moveTo(screen[0].x, screen[0].y);
    ctx.lineTo(screen[1].x, screen[1].y);
    ctx.lineTo(screen[2].x, screen[2].y);
    ctx.closePath();
    if (id === hitId) {
      ctx.fillStyle = "rgba(255, 193, 94, 0.42)";
      ctx.fill();
      ctx.strokeStyle = "#ffd479";
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = "rgba(143, 193, 255, 0.55)";
      ctx.lineWidth = 0.8;
    }
    ctx.stroke();
  }
}

function drawBoxes(tree, cam) {
  const visited = new Set();
  if (currentTrace && state.visitIndex >= 0) {
    for (let i = 0; i <= state.visitIndex && i < currentTrace.order.length; i++) {
      const rec = currentTrace.order[i];
      if (rec.kind === "box" || rec.kind === "tri_hit" || rec.kind === "tri_miss") {
        visited.add(rec.nodeId);
      }
    }
  }
  for (const node of tree.nodes) {
    if (node.depth !== state.depthLimit) continue;
    const isSelected = state.selectedNode === node.id;
    const isVisited = visited.has(node.id);
    let color = "rgba(120, 145, 190, 0.55)";
    let width = 1;
    if (isVisited) {
      color = "#57e3c8";
      width = 1.6;
    }
    if (isSelected) {
      color = "#ff8a5c";
      width = 2.4;
    }
    drawBox(node.box, cam, color, width);
  }
}

function drawRay(cam) {
  if (!currentTrace) return;
  const ray = currentTrace.ray;
  const far = ray.at(30);
  const start = project(ray.origin, cam);
  const end = project(far, cam);
  if (!start || !end) return;
  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.strokeStyle = "#b48bff";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#b48bff";
  ctx.beginPath();
  ctx.arc(start.x, start.y, 3.5, 0, Math.PI * 2);
  ctx.fill();

  if (currentTrace.hit) {
    const hp = project(currentTrace.hit.point, cam);
    if (hp) {
      ctx.fillStyle = "#ffd479";
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function render() {
  const cssW = canvas.clientWidth;
  const cssH = 640;
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = "#0d1322";
  ctx.fillRect(0, 0, cssW, cssH);
  const cam = cameraBasis();
  const vertices = currentVertices();
  const tree = currentTreeData();
  if (state.showMesh) drawMesh(vertices, cam);
  if (state.showBoxes) drawBoxes(tree, cam);
  if (state.showRay) drawRay(cam);
}

// ------------------------------------------------------------------ 信息面板
function renderStats() {
  const tree = currentTreeData();
  const s = tree.stats;
  document.getElementById("statsBox").innerHTML = [
    `<div>策略：<b>${tree.strategy === "sah" ? "表面积启发式 SAH" : "中位数切分"}</b></div>`,
    `<div>节点数：<b>${s.nodeCount}</b>（叶子 ${s.leafCount}）</div>`,
    `<div>最大深度：<b>${s.maxDepth}</b>，最大叶子三角形：<b>${s.maxLeafTris}</b></div>`,
    `<div>SAH 期望成本：<b>${s.sahCost.toFixed(2)}</b></div>`,
    `<div>节点盒总表面积：<b>${s.nodeSurface.toFixed(1)}</b></div>`,
    `<div>节点盒总体积：<b>${s.nodeVolume.toFixed(2)}</b></div>`,
  ].join("");

  const degrade = document.getElementById("degradeBox");
  if (state.geometry === "refit") {
    if (tree.degraded) {
      degrade.className = "degrade bad";
      degrade.innerHTML =
        "<b>⚠ 树质量恶化</b><br>" + tree.degradeReasons.join("<br>") +
        '<br><span style="font-size:11px">建议：切换到 rebuild 查看重建后的恢复效果</span>';
    } else {
      degrade.className = "degrade good";
      degrade.innerHTML = "<b>✓ refit 后质量仍在阈值内</b>";
    }
  } else if (state.geometry === "rebuilt") {
    degrade.className = "degrade good";
    degrade.innerHTML = "<b>✓ 已按当前拓扑重新建树，质量恢复</b>";
  } else {
    degrade.className = "degrade";
    degrade.innerHTML = "";
  }
}

function renderHit() {
  const box = document.getElementById("hitBox");
  if (!currentTrace) return;
  const { hit, brute, nodesTested, trisTested } = currentTrace;
  const rows = [
    `<div>AABB 测试：<b>${nodesTested}</b>，三角形测试：<b>${trisTested}</b> / ${SCENE.triangles.length}</div>`,
  ];
  if (hit) {
    const [u, v] = hit.bary;
    rows.push(
      `<div>命中三角形：<b>#${hit.triId}</b></div>`,
      `<div>距离 t：<b>${hit.t.toFixed(4)}</b></div>`,
      `<div>重心坐标：<b>(${ (1 - u - v).toFixed(4)}, ${u.toFixed(4)}, ${v.toFixed(4)})</b></div>`,
      `<div>命中点：(${hit.point.map((x) => x.toFixed(3)).join(", ")})</div>`
    );
  } else {
    rows.push('<div><b>未命中任何三角形</b></div>');
  }
  if (brute) {
    const agree = hit && Math.abs(brute.t - hit.t) < 1e-6 && brute.triId === hit.triId;
    rows.push(
      `<div>暴力参照：#${brute.triId}，t=${brute.t.toFixed(4)}，` +
        `<b style="color:${agree ? "#a6e7bd" : "#ffb3c8"}">${agree ? "一致 ✓" : "不一致 ✗"}</b></div>`
    );
  } else {
    rows.push('<div>暴力参照：未命中，与 BVH ' + (hit ? "<b style='color:#ffb3c8'>不一致 ✗</b>" : "<b style='color:#a6e7bd'>一致 ✓</b>") + "</div>");
  }
  box.innerHTML = rows.join("");
}

function renderTreeView() {
  const tree = currentTreeData();
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const root = byId.get(tree.rootId);
  const lines = [];
  (function walk(node) {
    const indent = "　".repeat(node.depth);
    const label = node.leaf
      ? `叶子 #${node.id} <span class="tag">[${node.triIds.length}△]</span>`
      : `节点 #${node.id} <span class="tag">d=${node.depth}</span>`;
    const sel = state.selectedNode === node.id ? " selected" : "";
    lines.push(
      `<div class="tree-node${sel}" data-node="${node.id}">${indent}${label}</div>`
    );
    if (!node.leaf) {
      walk(byId.get(node.left));
      walk(byId.get(node.right));
    }
  })(root);
  const box = document.getElementById("treeBox");
  box.innerHTML = lines.join("");
  box.querySelectorAll(".tree-node").forEach((el) => {
    el.addEventListener("click", () => {
      const id = Number(el.dataset.node);
      state.selectedNode = state.selectedNode === id ? null : id;
      const node = byId.get(id);
      if (state.selectedNode !== null) {
        state.depthLimit = node.depth;
        document.getElementById("depthSlider").value = node.depth;
        document.getElementById("depthLabel").textContent = node.depth;
      }
      renderAll();
    });
  });
}

const KIND_LABEL = {
  box: "进入包围盒",
  miss: "包围盒未命中",
  tri_hit: "三角形命中",
  tri_miss: "三角形未命中",
};

function renderOrderList() {
  if (!currentTrace) return;
  const box = document.getElementById("orderList");
  box.innerHTML = currentTrace.order
    .map((rec, i) => {
      const tri = rec.triId !== undefined && rec.triId !== null ? ` △#${rec.triId}` : "";
      const t = rec.t === null ? "—" : rec.t.toFixed(3);
      const cls =
        rec.kind === "box" ? "k-box" : rec.kind === "miss" ? "k-miss" : "k-hit";
      const cur = i === state.visitIndex ? " current" : "";
      return (
        `<div class="order-item${cur}" data-i="${i}">` +
        `#${i + 1} <span class="${cls}">${KIND_LABEL[rec.kind]}</span> ` +
        `节点${rec.nodeId}${tri} t=${t}</div>`
      );
    })
    .join("");
  box.querySelectorAll(".order-item").forEach((el) => {
    el.addEventListener("click", () => {
      state.visitIndex = Number(el.dataset.i);
      document.getElementById("visitSlider").value = state.visitIndex;
      stopPlay();
      renderAll();
    });
  });
  updateVisitInfo();
}

function updateVisitInfo() {
  const info = document.getElementById("visitInfo");
  if (!currentTrace || state.visitIndex < 0) {
    info.textContent = "拖动滑块或点击播放，逐步查看访问顺序";
    return;
  }
  const rec = currentTrace.order[state.visitIndex];
  const tri = rec.triId !== undefined && rec.triId !== null ? `，三角形 #${rec.triId}` : "";
  info.innerHTML =
    `第 <b>${state.visitIndex + 1}</b> / ${currentTrace.order.length} 步：` +
    `${KIND_LABEL[rec.kind]}（节点 #${rec.nodeId}${tri}，t=${rec.t === null ? "—" : rec.t.toFixed(3)}）`;
}

function renderAll() {
  render();
  renderStats();
  renderHit();
  renderTreeView();
  renderOrderList();
}

// ---------------------------------------------------------------------- 交互
function bindSegment(id, key, onChange) {
  document.querySelectorAll(`#${id} button`).forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      onChange(btn.dataset[key]);
    });
  });
}

bindSegment("strategySeg", "strategy", (v) => {
  state.strategy = v;
  state.selectedNode = null;
  setupDepthSlider();
  recomputeTrace();
});

bindSegment("stateSeg", "state", (v) => {
  state.geometry = v;
  state.selectedNode = null;
  setupDepthSlider();
  recomputeTrace();
});

document.getElementById("showMesh").addEventListener("change", (e) => {
  state.showMesh = e.target.checked;
  render();
});
document.getElementById("showBoxes").addEventListener("change", (e) => {
  state.showBoxes = e.target.checked;
  render();
});
document.getElementById("showRay").addEventListener("change", (e) => {
  state.showRay = e.target.checked;
  render();
});

function setupDepthSlider() {
  const max = currentTreeData().stats.maxDepth;
  state.maxDepth = max;
  state.depthLimit = Math.min(state.depthLimit, max);
  const slider = document.getElementById("depthSlider");
  slider.max = max;
  slider.value = state.depthLimit;
  document.getElementById("depthLabel").textContent = state.depthLimit;
}

document.getElementById("depthSlider").addEventListener("input", (e) => {
  state.depthLimit = Number(e.target.value);
  document.getElementById("depthLabel").textContent = state.depthLimit;
  render();
});

function stopPlay() {
  state.playing = false;
  if (state.playTimer) clearInterval(state.playTimer);
  state.playTimer = null;
  document.getElementById("playBtn").textContent = "▶ 播放";
}

document.getElementById("playBtn").addEventListener("click", () => {
  if (state.playing) {
    stopPlay();
    return;
  }
  if (!currentTrace) return;
  state.playing = true;
  document.getElementById("playBtn").textContent = "⏸ 暂停";
  if (state.visitIndex >= currentTrace.order.length - 1) state.visitIndex = -1;
  state.playTimer = setInterval(() => {
    state.visitIndex++;
    if (state.visitIndex >= currentTrace.order.length - 1) stopPlay();
    document.getElementById("visitSlider").value = state.visitIndex;
    renderAll();
  }, 350);
});

document.getElementById("visitSlider").addEventListener("input", (e) => {
  state.visitIndex = Number(e.target.value);
  stopPlay();
  renderAll();
});

function syncRayInputs() {
  const ids = ["ox", "oy", "oz", "dx", "dy", "dz"];
  const vals = [...state.ray.origin, ...state.ray.direction];
  ids.forEach((id, i) => {
    document.getElementById(id).value = vals[i].toFixed(2);
  });
}

document.getElementById("applyRay").addEventListener("click", () => {
  const get = (id) => Number(document.getElementById(id).value);
  const origin = [get("ox"), get("oy"), get("oz")];
  const direction = [get("dx"), get("dy"), get("dz")];
  if (Math.hypot(...direction) < 1e-9) {
    alert("射线方向不能为零向量");
    return;
  }
  state.ray = { origin, direction };
  recomputeTrace();
});

document.getElementById("resetRay").addEventListener("click", () => {
  state.ray = { origin: [...SCENE.ray.origin], direction: [...SCENE.ray.direction] };
  syncRayInputs();
  recomputeTrace();
});

document.getElementById("viewReset").addEventListener("click", () => {
  state.camera = { yaw: 0.7, pitch: 0.42, dist: 11, target: [0, 1.2, 0] };
  render();
});

// 相机拖拽
let dragging = false;
let lastX = 0;
let lastY = 0;
canvas.addEventListener("mousedown", (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener("mouseup", () => (dragging = false));
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  state.camera.yaw += (e.clientX - lastX) * 0.01;
  state.camera.pitch = Math.max(
    -1.3,
    Math.min(1.3, state.camera.pitch + (e.clientY - lastY) * 0.01)
  );
  lastX = e.clientX;
  lastY = e.clientY;
  render();
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    state.camera.dist = Math.max(4, Math.min(30, state.camera.dist * (1 + e.deltaY * 0.001)));
    render();
  },
  { passive: false }
);

// ---------------------------------------------------------------------- 初始化
resizeCanvas();
setupDepthSlider();
syncRayInputs();
recomputeTrace();
