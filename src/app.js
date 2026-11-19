/*
 * Interactive canvas controller: drag mirrors / source / receiver,
 * re-solve on every move, render exact paths, rejected candidates and
 * dense ray-sampling comparison.
 */
(function () {
  "use strict";

  const G = window.Geometry;
  const Solver = window.Solver;
  const { PRESETS, cloneScene } = window.Presets;

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const tooltip = document.getElementById("tooltip");

  // World -> screen: uniform scale, world y grows upward.
  const VIEW = { scale: 58, ox: 250, oy: 470 };
  const HANDLE_PX = 9;

  const state = {
    scene: cloneScene(PRESETS.parallel),
    maxBounces: 3,
    sampleCount: 720,
    receiverRadius: 0.15,
    showRejected: true,
    showSampling: false,
    showReached: true,
    showLabels: true,
    result: null,
    sampling: null,
    activePath: -1,
    drag: null,
  };

  const w2s = (p) => ({ x: VIEW.ox + p.x * VIEW.scale, y: VIEW.oy - p.y * VIEW.scale });
  const s2w = (p) => ({ x: (p.x - VIEW.ox) / VIEW.scale, y: (VIEW.oy - p.y) / VIEW.scale });

  function pointerWorld(event) {
    const rect = canvas.getBoundingClientRect();
    return s2w({
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    });
  }

  // Return a draggable handle descriptor under the pointer, or null.
  function hitHandle(world) {
    const s = state.scene;
    const grab = (p, set) => ({ dist: G.dist(world, p), set });
    const handles = [
      grab(s.source, (p) => { s.source = p; }),
      grab(s.receiver, (p) => { s.receiver = p; }),
    ];
    s.mirrors.forEach((m, i) => {
      handles.push(grab(m.a, (p) => { m.a = p; }));
      handles.push(grab(m.b, (p) => { m.b = p; }));
      handles.push({
        dist: G.pointSegmentDistance(world, m.a, m.b),
        set: (p) => {
          const delta = G.sub(p, G.scale(G.add(m.a, m.b), 0.5));
          m.a = G.add(m.a, delta);
          m.b = G.add(m.b, delta);
        },
        body: true,
      });
      handles[handles.length - 1].mirrorIndex = i;
    });
    s.occluders.forEach((o) => {
      handles.push(grab(o.a, (p) => { o.a = p; }));
      handles.push(grab(o.b, (p) => { o.b = p; }));
    });
    const pxTol = HANDLE_PX / VIEW.scale;
    const best = handles
      .filter((h) => h.dist <= (h.body ? pxTol * 0.7 : pxTol))
      .sort((a, b) => a.dist - b.dist)[0];
    return best || null;
  }

  function refresh() {
    state.result = Solver.enumeratePaths(state.scene, state.maxBounces);
    state.sampling = Solver.sampleAngles(
      state.scene, state.maxBounces, state.sampleCount, state.receiverRadius);
    if (state.activePath >= state.result.valid.length) state.activePath = -1;
    render();
    renderStats();
    renderPathList();
  }

  function drawSegment(a, b, color, width, dash) {
    const pa = w2s(a);
    const pb = w2s(b);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawPolyline(points, color, width, dash) {
    for (let i = 1; i < points.length; i++) {
      drawSegment(points[i - 1], points[i], color, width, dash);
    }
  }

  function drawHandle(point, color, radius = HANDLE_PX) {
    const p = w2s(point);
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = "#0f1420";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawMarker(point, color, symbol) {
    const p = w2s(point);
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = "#0f1420";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (symbol === "source") {
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    } else {
      ctx.rect(p.x - 7, p.y - 7, 14, 14);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = "#1d2740";
    ctx.lineWidth = 1;
    for (let x = -10; x <= 14; x++) {
      const p = w2s({ x, y: 0 });
      ctx.beginPath();
      ctx.moveTo(p.x, 0);
      ctx.lineTo(p.x, canvas.height);
      ctx.stroke();
    }
    for (let y = -6; y <= 10; y++) {
      const p = w2s({ x: 0, y });
      ctx.beginPath();
      ctx.moveTo(0, p.y);
      ctx.lineTo(canvas.width, p.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  const PATH_COLORS = ["#57e389", "#57c7e3", "#c09bf5", "#f5c26b", "#8be9fd", "#ff9edb"];

  function render() {
    const s = state.scene;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();

    // Dense sampling rays underneath the exact solution.
    if (state.showSampling && state.sampling) {
      for (const ray of state.sampling.rays) {
        const trace = ray.trace;
        const reached = trace.status === "reached";
        if (reached && !state.showReached) continue;
        drawPolyline(trace.points,
          reached ? "rgba(245,194,107,0.55)" : "rgba(120,135,165,0.18)",
          reached ? 1.2 : 0.6);
      }
    }

    // Rejected candidates: full polyline when geometry exists, plus the
    // explicit rejection point that violated a finite boundary / occlusion.
    if (state.showRejected) {
      for (const rej of state.result.rejected) {
        if (rej.points) drawPolyline(rej.points, "rgba(255,90,90,0.45)", 1.2, [5, 4]);
        if (rej.rejectedPoint) {
          const p = w2s(rej.rejectedPoint);
          ctx.save();
          ctx.strokeStyle = "#ff5a5a";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(p.x - 5, p.y - 5);
          ctx.lineTo(p.x + 5, p.y + 5);
          ctx.moveTo(p.x + 5, p.y - 5);
          ctx.lineTo(p.x - 5, p.y + 5);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // Valid exact paths, drawn thicker for the selected one.
    state.result.valid.forEach((path, i) => {
      const selected = i === state.activePath;
      const color = PATH_COLORS[i % PATH_COLORS.length];
      drawPolyline(path.points, color, selected ? 3.4 : 2);
      for (let k = 1; k < path.points.length - 1; k++) {
        drawHandle(path.points[k], color, selected ? 7 : 5);
      }
      if (state.showLabels) {
        const mid = path.points[Math.floor(path.points.length / 2)];
        const p = w2s(mid);
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = "12px sans-serif";
        ctx.fillText(`#${i + 1} L=${path.length.toFixed(2)}`, p.x + 8, p.y - 8);
        ctx.restore();
      }
    });

    // Mirrors with reflective sheen, occluders as dashed dark bars.
    s.mirrors.forEach((m) => {
      drawSegment(m.a, m.b, "#9fd8ff", 5);
      drawSegment(m.a, m.b, "#d9efff", 2);
      drawHandle(m.a, "#9fd8ff");
      drawHandle(m.b, "#9fd8ff");
    });
    s.occluders.forEach((o) => {
      drawSegment(o.a, o.b, "#8a6d5c", 6, [7, 5]);
      drawHandle(o.a, "#c79a82", 6);
      drawHandle(o.b, "#c79a82", 6);
    });

    drawMarker(s.source, "#ffe066", "source");
    drawMarker(s.receiver, "#ff7a90", "receiver");

    // Receiver acceptance radius used by the sampling comparison.
    const rc = w2s(s.receiver);
    ctx.save();
    ctx.strokeStyle = "rgba(255,122,144,0.6)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(rc.x, rc.y, state.receiverRadius * VIEW.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const REASON_LABEL = {
    outside_segment: "超出有限镜边",
    occluded: "被遮挡段拦截",
    blocked_by_mirror: "被其他镜片拦截",
    unfold_order: "展开顺序不可行",
    unfold_miss: "展开线平行",
    law_violation: "反射定律不符",
    degenerate: "退化光路",
  };

  function renderStats() {
    const r = state.result;
    const totalLength = r.valid.reduce((sum, p) => sum + p.length, 0);
    const maxErr = r.valid.reduce((m, p) => Math.max(m, p.maxAngleError), 0);
    const reasonBits = Object.entries(r.counts)
      .map(([k, v]) => `${REASON_LABEL[k] || k} ×${v}`)
      .join("，") || "无";
    const samp = state.sampling;
    document.getElementById("stats").innerHTML = `
      <div>有效光路：<b>${r.valid.length}</b> 条
        （去重 <b>${r.duplicates || 0}</b> 条）</div>
      <div>被拒绝候选：<span class="rej">${r.rejected.length}</span> 条</div>
      <div>拒绝原因：<span class="rej">${reasonBits}</span></div>
      <div>所有光路总长：<b>${totalLength.toFixed(3)}</b></div>
      <div>最大入射角/反射角误差：<b>${maxErr.toExponential(2)}</b> rad</div>
      <div>采样 ${samp.sampleCount} 射线（${samp.angularResolution.toFixed(2)}°）：
        命中 ${samp.reachedCount}，匹配精确解
        <b>${samp.matchedExact}/${samp.exactCount}</b>，漏 ${samp.missedExact}</div>`;
  }

  function renderPathList() {
    const list = document.getElementById("pathList");
    list.innerHTML = "";
    state.result.valid.forEach((path, i) => {
      const li = document.createElement("li");
      li.textContent = `#${i + 1}  ${path.bounces} 次反射 · 长度 ${path.length.toFixed(3)}` +
        (path.maxAngleError > 0 ? ` · 角误差 ${path.maxAngleError.toExponential(1)}` : "");
      if (i === state.activePath) li.classList.add("active");
      li.addEventListener("click", () => {
        state.activePath = state.activePath === i ? -1 : i;
        render();
        renderPathList();
      });
      list.appendChild(li);
    });
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button === 2) return;
    const handle = hitHandle(pointerWorld(event));
    if (handle) {
      state.drag = handle;
      canvas.setPointerCapture(event.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    const world = pointerWorld(event);
    if (state.drag) {
      state.drag.set(world);
      refresh();
      return;
    }
    const handle = hitHandle(world);
    canvas.style.cursor = handle ? "grab" : "crosshair";
    if (handle && handle.mirrorIndex != null) {
      tooltip.textContent = "拖动镜段整体平移";
      tooltip.classList.remove("hidden");
      tooltip.style.left = `${event.offsetX}px`;
      tooltip.style.top = `${event.offsetY}px`;
    } else {
      tooltip.classList.add("hidden");
    }
  });

  canvas.addEventListener("pointerup", () => { state.drag = null; });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const world = pointerWorld(event);
    const s = state.scene;
    const nearest = (arr) => arr.map((seg, i) => ({
      i,
      d: G.pointSegmentDistance(world, seg.a, seg.b),
    })).sort((x, y) => x.d - y.d)[0];
    const m = nearest(s.mirrors);
    const o = nearest(s.occluders);
    if (m && m.d < 0.5 && (!o || m.d <= o.d) && s.mirrors.length > 1) {
      s.mirrors.splice(m.i, 1);
    } else if (o && o.d < 0.5) {
      s.occluders.splice(o.i, 1);
    }
    refresh();
  });

  function bindRange(id, key, valueId, transform = Number) {
    const input = document.getElementById(id);
    const label = document.getElementById(valueId);
    input.addEventListener("input", () => {
      state[key] = transform(input.value);
      label.textContent = input.value;
      refresh();
    });
  }

  bindRange("maxBounces", "maxBounces", "maxBouncesVal", (v) => parseInt(v, 10));
  bindRange("sampleCount", "sampleCount", "sampleCountVal", (v) => parseInt(v, 10));
  bindRange("receiverRadius", "receiverRadius", "receiverRadiusVal");

  function bindToggle(id, key) {
    document.getElementById(id).addEventListener("change", (event) => {
      state[key] = event.target.checked;
      render();
    });
  }

  bindToggle("showRejected", "showRejected");
  bindToggle("showSampling", "showSampling");
  bindToggle("showReached", "showReached");
  bindToggle("showLabels", "showLabels");

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const preset = PRESETS[button.dataset.preset];
      state.scene = cloneScene(preset);
      state.maxBounces = preset.maxBounces;
      document.getElementById("maxBounces").value = preset.maxBounces;
      document.getElementById("maxBouncesVal").textContent = preset.maxBounces;
      state.activePath = -1;
      refresh();
    });
  });

  refresh();

  // Test hook: headless environments inspect the live scene and result.
  if (typeof window !== "undefined") {
    window.__solverApp = { state, refresh, w2s, s2w };
  }
})();
