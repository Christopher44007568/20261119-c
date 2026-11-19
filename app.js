(function () {
  "use strict";

  const Core = window.BiharmonicCore;
  const SOLVER_COLS = 52;
  const SOLVER_ROWS = 38;
  const SOLVER_ITERATIONS = 220;
  const HANDLE_HIT_RADIUS = 19;

  const el = {
    mainCanvas: document.getElementById("main-canvas"),
    fieldGrid: document.getElementById("field-grid"),
    viewTitle: document.getElementById("view-title"),
    viewIndex: document.getElementById("view-index"),
    legendSwatch: document.getElementById("legend-swatch"),
    legendLabel: document.getElementById("legend-label"),
    cursorCoordinate: document.getElementById("cursor-coordinate"),
    handleName: document.getElementById("handle-name"),
    handleChip: document.getElementById("handle-chip"),
    handlePosition: document.getElementById("handle-position"),
    handleDisplacement: document.getElementById("handle-displacement"),
    fieldRange: document.getElementById("field-range"),
    rangeFill: document.getElementById("range-fill"),
    rangeMin: document.getElementById("range-min"),
    rangeMax: document.getElementById("range-max"),
    nodeCount: document.getElementById("node-count"),
    solverStatus: document.getElementById("solver-status"),
    liveDot: document.getElementById("live-dot"),
    solveStamp: document.getElementById("solve-stamp"),
    voidCallout: document.getElementById("void-callout"),
    toast: document.getElementById("toast"),
    modal: document.getElementById("modal"),
    resetButton: document.getElementById("reset-button"),
    aboutButton: document.getElementById("about-button"),
    modalClose: document.getElementById("modal-close"),
    modalDone: document.getElementById("modal-done"),
    iterations: document.getElementById("iterations"),
    solveTime: document.getElementById("solve-time"),
    resPde: document.getElementById("res-pde"),
    resDirichlet: document.getElementById("res-dirichlet"),
    resPartition: document.getElementById("res-partition"),
    resKkt: document.getElementById("res-kkt"),
    barPde: document.getElementById("bar-pde"),
    barDirichlet: document.getElementById("bar-dirichlet"),
    barPartition: document.getElementById("bar-partition"),
    barKkt: document.getElementById("bar-kkt"),
    bypassValue: document.getElementById("bypass-value")
  };

  const state = {
    result: null,
    selected: 3,
    mode: "field",
    displacements: Core.HANDLES.map(function () { return { x: 0, y: 0 }; }),
    drag: null,
    pointer: null,
    miniCanvases: [],
    toastTimer: null,
    solveTimer: null,
    lastInvalidMessage: 0,
    solveStarted: 0
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mixChannel(a, b, t) {
    return Math.round(a + (b - a) * t);
  }

  function hexToRgb(hex) {
    const normalized = hex.replace("#", "");
    return [
      parseInt(normalized.slice(0, 2), 16),
      parseInt(normalized.slice(2, 4), 16),
      parseInt(normalized.slice(4, 6), 16)
    ];
  }

  const FIELD_ZERO = [243, 240, 230];

  function fieldRgb(value, hex) {
    const target = hexToRgb(hex);
    const t = Math.pow(clamp(value, 0, 1), 0.72);
    return [
      mixChannel(FIELD_ZERO[0], target[0], t),
      mixChannel(FIELD_ZERO[1], target[1], t),
      mixChannel(FIELD_ZERO[2], target[2], t)
    ];
  }

  function residualRgb(value) {
    const target = [197, 76, 57];
    const t = Math.pow(clamp(value, 0, 1), 0.82);
    return [
      mixChannel(247, target[0], t),
      mixChannel(244, target[1], t),
      mixChannel(235, target[2], t)
    ];
  }

  function formatCoordinate(value) {
    return value.toFixed(3);
  }

  function formatSigned(value) {
    if (Math.abs(value) < 0.0005) return "0.000";
    return (value > 0 ? "+" : "") + value.toFixed(3);
  }

  function formatScientific(value) {
    if (value === 0) return "0";
    if (value < 0.001) return value.toExponential(1).replace("e-", "e−");
    return value.toFixed(4);
  }

  function setStatus(text, solving) {
    el.solverStatus.textContent = text;
    el.liveDot.classList.toggle("solving", !!solving);
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("visible");
    state.toastTimer = window.setTimeout(function () {
      el.toast.classList.remove("visible");
    }, 2800);
  }

  function handleDisplayPosition(index) {
    const handle = Core.HANDLES[index];
    const displacement = state.displacements[index];
    return {
      x: handle.x + displacement.x,
      y: handle.y + displacement.y
    };
  }

  function solve(showBusy) {
    if (showBusy) {
      setStatus("SOLVING · Δ²", true);
      state.solveStarted = performance.now();
    }
    const result = Core.solveWeights({
      cols: SOLVER_COLS,
      rows: SOLVER_ROWS,
      iterations: SOLVER_ITERATIONS
    });
    state.result = result;
    updateSolveReadout(result);
    renderFieldBank();
    renderMain();
    setStatus(result.feasible ? "SOLVED · " + SOLVER_COLS + " × " + SOLVER_ROWS : "INFEASIBLE", false);
  }

  function scheduleSolve() {
    setStatus("SOLVING · Δ²", true);
    window.clearTimeout(state.solveTimer);
    state.solveTimer = window.setTimeout(function () { solve(true); }, 40);
  }

  function updateSolveReadout(result) {
    el.nodeCount.textContent = result.grid.count.toLocaleString("en-US");
    el.iterations.textContent = result.iterations;
    el.solveTime.textContent = result.solveTime.toFixed(1);
    el.solveStamp.textContent = "solved " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    if (!result.feasible || !result.metrics) {
      setAudit("inside", "FAIL", "fail");
      setAudit("distinct", "CONFLICT", "fail");
      setAudit("connected", result.components === 1 ? "PASS" : "DISCONNECTED", result.components === 1 ? "" : "warn");
      el.resPde.textContent = "—";
      el.resDirichlet.textContent = "—";
      el.resPartition.textContent = "—";
      el.resKkt.textContent = "—";
      return;
    }

    const metrics = result.metrics;
    setAudit("inside", result.handlesInside ? "PASS" : "OUTSIDE Ω", result.handlesInside ? "" : "fail");
    setAudit("distinct", result.handleNodes.length + " / " + Core.HANDLES.length,
      new Set(result.handleNodes).size === Core.HANDLES.length ? "" : "fail");
    setAudit("connected", result.components + (result.components === 1 ? " component" : " components"),
      result.components === 1 ? "" : "warn");
    setAudit("locks", String(metrics.activeLocks), "");

    el.resPde.textContent = formatScientific(metrics.pdeResidual);
    el.resDirichlet.textContent = formatScientific(metrics.dirichletError);
    el.resPartition.textContent = formatScientific(metrics.sumError);
    el.resKkt.textContent = formatScientific(metrics.kktResidual);
    setMeter(el.barPde, metrics.pdeResidual * 1800);
    setMeter(el.barDirichlet, metrics.dirichletError * 5e6);
    setMeter(el.barPartition, metrics.sumError * 2e7);
    setMeter(el.barKkt, metrics.kktResidual * 5200);
    updateSelectedHandle();
  }

  function setAudit(key, value, kind) {
    const node = document.querySelector('[data-audit="' + key + '"]');
    if (!node) return;
    node.textContent = value;
    node.classList.toggle("fail", kind === "fail");
    node.classList.toggle("warn", kind === "warn");
  }

  function setMeter(node, percent) {
    const value = clamp(percent, 2, 100);
    node.style.width = value.toFixed(1) + "%";
    node.classList.toggle("warn", percent > 45 && percent <= 72);
    node.classList.toggle("fail", percent > 72);
  }

  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, rect: rect };
  }

  function makeView(rect, pad) {
    const availableW = Math.max(10, rect.width - pad * 2);
    const availableH = Math.max(10, rect.height - pad * 2);
    const scale = Math.min(availableW / 0.94, availableH / 0.94);
    return {
      scale: scale,
      ox: (rect.width - scale) / 2,
      oy: (rect.height - scale) / 2,
      screenX: function (x) { return this.ox + x * this.scale; },
      screenY: function (y) { return this.oy + y * this.scale; },
      worldX: function (x) { return (x - this.ox) / this.scale; },
      worldY: function (y) { return (y - this.oy) / this.scale; }
    };
  }

  function tracePolygon(ctx, polygon, view) {
    ctx.moveTo(view.screenX(polygon[0].x), view.screenY(polygon[0].y));
    for (let i = 1; i < polygon.length; i++) {
      ctx.lineTo(view.screenX(polygon[i].x), view.screenY(polygon[i].y));
    }
    ctx.closePath();
  }

  function makeDomainPath(ctx, view) {
    ctx.beginPath();
    tracePolygon(ctx, Core.OUTER, view);
    tracePolygon(ctx, Core.HOLE, view);
    return ctx;
  }

  function makeHolePath(ctx, view) {
    ctx.beginPath();
    tracePolygon(ctx, Core.HOLE, view);
    return ctx;
  }

  function drawHatch(ctx, view) {
    const bounds = Core.HOLE.reduce(function (acc, point) {
      return {
        minX: Math.min(acc.minX, point.x),
        maxX: Math.max(acc.maxX, point.x),
        minY: Math.min(acc.minY, point.y),
        maxY: Math.max(acc.maxY, point.y)
      };
    }, { minX: 1, maxX: 0, minY: 1, maxY: 0 });
    const left = view.screenX(bounds.minX) - 18;
    const right = view.screenX(bounds.maxX) + 18;
    const top = view.screenY(bounds.minY) - 18;
    const bottom = view.screenY(bounds.maxY) + 18;
    ctx.strokeStyle = "rgba(29,40,36,0.15)";
    ctx.lineWidth = 0.65;
    for (let offset = left - (bottom - top); offset < right; offset += 8) {
      ctx.beginPath();
      ctx.moveTo(offset, bottom);
      ctx.lineTo(offset + (bottom - top), top);
      ctx.stroke();
    }
  }

  function getCellVertices(grid, col, row) {
    if (col < 0 || row < 0 || col >= grid.cols - 1 || row >= grid.rows - 1) return null;
    const tl = grid.gridToActive[row * grid.cols + col];
    const tr = grid.gridToActive[row * grid.cols + col + 1];
    const bl = grid.gridToActive[(row + 1) * grid.cols + col];
    const br = grid.gridToActive[(row + 1) * grid.cols + col + 1];
    if (tl < 0 || tr < 0 || bl < 0 || br < 0) return null;
    return [tl, tr, br, bl];
  }

  function fillTriangle(ctx, points, color) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    ctx.lineTo(points[1][0], points[1][1]);
    ctx.lineTo(points[2][0], points[2][1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawStaticField(ctx, view, result, fieldIndex, accent) {
    const texture = getFieldTexture(result, fieldIndex, accent);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      texture,
      view.screenX(0), view.screenY(0),
      view.scale, view.scale
    );
  }

  function getFieldTexture(result, fieldIndex, accent) {
    if (!result._fieldTextures) result._fieldTextures = {};
    if (result._fieldTextures[fieldIndex]) return result._fieldTextures[fieldIndex];

    const grid = result.grid;
    const field = result.fields[fieldIndex];
    const canvas = document.createElement("canvas");
    canvas.width = grid.cols;
    canvas.height = grid.rows;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(grid.cols, grid.rows);
    for (let ai = 0; ai < grid.count; ai++) {
      const gi = grid.activeToGrid[ai];
      const offset = gi * 4;
      const color = fieldRgb(field[ai], accent);
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    result._fieldTextures[fieldIndex] = canvas;
    return canvas;
  }

  function getResidualTexture(result, fieldIndex) {
    if (!result._residualTextures) result._residualTextures = {};
    if (result._residualTextures[fieldIndex]) return result._residualTextures[fieldIndex];

    const grid = result.grid;
    const field = result.fields[fieldIndex];
    const residuals = new Float32Array(grid.count);
    let maximum = 1e-9;
    let hotCell = { value: 0, x: 0.5, y: 0.5 };
    for (let ai = 0; ai < grid.count; ai++) {
      if (result.handleNodes.indexOf(ai) >= 0) continue;
      const value = Math.abs(Core.directBiharmonicAt(field, grid, ai));
      residuals[ai] = value;
      if (value > maximum) {
        maximum = value;
        const gi = grid.activeToGrid[ai];
        hotCell = { value: value, x: grid.xs[gi], y: grid.ys[gi] };
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = grid.cols;
    canvas.height = grid.rows;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(grid.cols, grid.rows);
    for (let ai = 0; ai < grid.count; ai++) {
      const gi = grid.activeToGrid[ai];
      const offset = gi * 4;
      const normalized = Math.pow(residuals[ai] / maximum, 0.82);
      const color = residualRgb(normalized);
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const value = { texture: canvas, hotCell: hotCell, maximum: maximum };
    result._residualTextures[fieldIndex] = value;
    return value;
  }

  function deformedPositions(result) {
    const grid = result.grid;
    const positions = new Float32Array(grid.count * 2);
    for (let ai = 0; ai < grid.count; ai++) {
      const gi = grid.activeToGrid[ai];
      let dx = 0;
      let dy = 0;
      for (let k = 0; k < result.fields.length; k++) {
        const weight = result.fields[k][ai];
        dx += weight * state.displacements[k].x;
        dy += weight * state.displacements[k].y;
      }
      positions[ai * 2] = grid.xs[gi] + dx;
      positions[ai * 2 + 1] = grid.ys[gi] + dy;
    }
    return positions;
  }

  function drawWarpedMesh(ctx, view, result, positions, fieldMode) {
    const grid = result.grid;
    const fillAlpha = fieldMode ? 0 : 1;
    for (let row = 0; row < grid.rows - 1; row++) {
      for (let col = 0; col < grid.cols - 1; col++) {
        const cell = getCellVertices(grid, col, row);
        if (!cell) continue;
        const p0 = [view.screenX(positions[cell[0] * 2]), view.screenY(positions[cell[0] * 2 + 1])];
        const p1 = [view.screenX(positions[cell[1] * 2]), view.screenY(positions[cell[1] * 2 + 1])];
        const p2 = [view.screenX(positions[cell[2] * 2]), view.screenY(positions[cell[2] * 2 + 1])];
        const p3 = [view.screenX(positions[cell[3] * 2]), view.screenY(positions[cell[3] * 2 + 1])];
        if (fillAlpha) {
          const checker = ((row + col) & 1) === 0;
          fillTriangle(ctx, [p0, p1, p2], checker ? "rgba(29,40,36,0.022)" : "rgba(255,255,255,0.08)");
          fillTriangle(ctx, [p0, p2, p3], checker ? "rgba(29,40,36,0.022)" : "rgba(255,255,255,0.08)");
        }
      }
    }

    ctx.lineWidth = fieldMode ? 0.55 : 0.75;
    ctx.strokeStyle = fieldMode ? "rgba(29,40,36,0.14)" : "rgba(29,40,36,0.28)";
    for (let ai = 0; ai < grid.count; ai++) {
      const gi = grid.activeToGrid[ai];
      const col = gi % grid.cols;
      const row = (gi / grid.cols) | 0;
      const x = view.screenX(positions[ai * 2]);
      const y = view.screenY(positions[ai * 2 + 1]);
      if (col + 1 < grid.cols) {
        const right = grid.gridToActive[gi + 1];
        if (right >= 0) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(view.screenX(positions[right * 2]), view.screenY(positions[right * 2 + 1]));
          ctx.stroke();
        }
      }
      if (row + 1 < grid.rows) {
        const down = grid.gridToActive[gi + grid.cols];
        if (down >= 0) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(view.screenX(positions[down * 2]), view.screenY(positions[down * 2 + 1]));
          ctx.stroke();
        }
      }
    }

    if (!fieldMode) {
      ctx.fillStyle = "rgba(29,40,36,0.44)";
      for (let ai = 0; ai < grid.count; ai += 2) {
        const x = view.screenX(positions[ai * 2]);
        const y = view.screenY(positions[ai * 2 + 1]);
        ctx.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
      }
    }
  }

  function drawResidualField(ctx, view, result, fieldIndex) {
    const residual = getResidualTexture(result, fieldIndex);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      residual.texture,
      view.screenX(0), view.screenY(0),
      view.scale, view.scale
    );
    return residual.hotCell;
  }

  function drawDomainFrame(ctx, view) {
    makeDomainPath(ctx, view);
    ctx.fillStyle = "#f5f2e8";
    ctx.fill("evenodd");

    ctx.save();
    makeHolePath(ctx, view);
    ctx.clip();
    ctx.fillStyle = "#e9e5db";
    ctx.fillRect(
      view.screenX(0.3), view.screenY(0.3),
      view.scale * 0.4, view.scale * 0.4
    );
    drawHatch(ctx, view);
    ctx.restore();
  }

  function drawDomainBoundary(ctx, view) {
    ctx.beginPath();
    tracePolygon(ctx, Core.OUTER, view);
    ctx.strokeStyle = "#1d2824";
    ctx.lineWidth = 1.35;
    ctx.stroke();

    ctx.beginPath();
    tracePolygon(ctx, Core.HOLE, view);
    ctx.strokeStyle = "#1d2824";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    tracePolygon(ctx, Core.OUTER, view);
    ctx.strokeStyle = "rgba(29,40,36,0.1)";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.restore();
  }

  function drawRegistrationMarks(ctx, view) {
    const x0 = view.screenX(0.015);
    const x1 = view.screenX(0.985);
    const y0 = view.screenY(0.015);
    const y1 = view.screenY(0.985);
    ctx.strokeStyle = "rgba(29,40,36,0.18)";
    ctx.lineWidth = 0.7;
    const spread = 0.12 * view.scale;
    const corners = [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]];
    corners.forEach(function (corner) {
      ctx.beginPath();
      ctx.moveTo(corner[0] + corner[2] * spread, corner[1]);
      ctx.lineTo(corner[0], corner[1]);
      ctx.lineTo(corner[0], corner[1] + corner[3] * spread);
      ctx.stroke();
    });
  }

  function drawHandles(ctx, view, result) {
    Core.HANDLES.forEach(function (handle, index) {
      const display = handleDisplayPosition(index);
      const x = view.screenX(display.x);
      const y = view.screenY(display.y);
      const bx = view.screenX(handle.x);
      const by = view.screenY(handle.y);
      const displacement = state.displacements[index];
      const moved = Math.hypot(displacement.x, displacement.y) > 0.001;
      const selected = index === state.selected;

      if (moved) {
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = "rgba(29,40,36,0.32)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(bx, by, 3, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(29,40,36,0.34)";
        ctx.stroke();
        ctx.restore();
      }

      if (selected) {
        ctx.beginPath();
        ctx.arc(x, y, 18, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgb(handle.color).join(",");
        ctx.fillStyle = "rgba(" + hexToRgb(handle.color).join(",") + ",0.16)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.strokeStyle = handle.color;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(x, y, selected ? 9.5 : 8, 0, Math.PI * 2);
      ctx.fillStyle = handle.color;
      ctx.fill();
      ctx.strokeStyle = "#fbf8ef";
      ctx.lineWidth = 1.7;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, selected ? 6.4 : 5.2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.48)";
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.fillStyle = "#fffdf7";
      ctx.font = "700 " + (selected ? 9 : 8) + "px " + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(handle.id, x, y + 0.4);

      if (selected) {
        const label = handle.id + " · " + handle.name;
        ctx.font = "600 8px " + getComputedStyle(document.body).fontFamily;
        const width = ctx.measureText(label).width + 12;
        const lx = clamp(x, width / 2 + 8, view.screenX(1) - width / 2 - 8);
        ctx.fillStyle = "rgba(29,40,36,0.86)";
        ctx.beginPath();
        ctx.roundRect(lx - width / 2, y + 14, width, 18, 3);
        ctx.fill();
        ctx.fillStyle = "#f8f5ec";
        ctx.fillText(label, lx, y + 23.5);
      }
    });
  }

  function drawBypassProbe(ctx, view, result) {
    if (state.selected !== 3 || state.mode === "residual") return;
    const probe = { x: 0.36, y: 0.32 };
    const snap = Core.nearestActive(result.grid, probe.x, probe.y);
    if (snap.active < 0) return;
    const value = result.fields[3][snap.active];
    const px = view.screenX(probe.x);
    const py = view.screenY(probe.y);
    const start = handleDisplayPosition(3);
    const sx = view.screenX(start.x);
    const sy = view.screenY(start.y);
    const accent = Core.HANDLES[3].color;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(
      view.screenX(0.76), view.screenY(0.30),
      view.screenX(0.53), view.screenY(0.235),
      px, py
    );
    ctx.strokeStyle = "rgba(62,155,125,0.65)";
    ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(px, py, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(247,244,235,0.92)";
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px - 3, py);
    ctx.lineTo(px + 3, py);
    ctx.moveTo(px, py - 3);
    ctx.lineTo(px, py + 3);
    ctx.stroke();

    const label = "ψD " + value.toFixed(3) + " · bypass";
    ctx.font = "600 7.5px " + getComputedStyle(document.body).fontFamily;
    const width = ctx.measureText(label).width + 12;
    ctx.fillStyle = "rgba(247,244,235,0.94)";
    ctx.strokeStyle = "rgba(62,155,125,0.55)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.roundRect(px - width - 10, py + 8, width, 17, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#2d6f5b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, px - 4 - width / 2, py + 16.5);
    ctx.restore();
  }

  function renderMain() {
    const result = state.result;
    if (!result || !result.grid) return;
    const prepared = prepareCanvas(el.mainCanvas);
    const ctx = prepared.ctx;
    const rect = prepared.rect;
    const view = makeView(rect, Math.max(34, Math.min(rect.width, rect.height) * 0.09));
    ctx.clearRect(0, 0, rect.width, rect.height);

    drawRegistrationMarks(ctx, view);
    drawDomainFrame(ctx, view);
    ctx.save();
    makeDomainPath(ctx, view);
    ctx.clip("evenodd");

    const positions = deformedPositions(result);
    let hotCell = null;
    if (state.mode === "field") {
      drawStaticField(ctx, view, result, state.selected, Core.HANDLES[state.selected].color);
      drawWarpedMesh(ctx, view, result, positions, true);
    } else if (state.mode === "residual") {
      hotCell = drawResidualField(ctx, view, result, state.selected);
      drawWarpedMesh(ctx, view, result, positions, true);
    } else {
      drawWarpedMesh(ctx, view, result, positions, false);
    }
    ctx.restore();
    drawDomainBoundary(ctx, view);

    if (hotCell) {
      const x = view.screenX(hotCell.x);
      const y = view.screenY(hotCell.y);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.strokeStyle = "#cf5b45";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.fillRect(x + 8, y - 7, 58, 14);
      ctx.fillStyle = "#cf5b45";
      ctx.font = "600 7px " + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("max |Δ²ψ|", x + 12, y);
    }

    drawBypassProbe(ctx, view, result);
    drawHandles(ctx, view, result);
    const holeCenterX = view.screenX(0.495);
    const holeCenterY = view.screenY(0.5);
    el.voidCallout.style.left = holeCenterX + "px";
    el.voidCallout.style.top = holeCenterY + "px";
    el.voidCallout.classList.toggle("hidden", state.mode === "residual");
  }

  function computeFieldRange(result, index) {
    const field = result.fields[index];
    let min = Infinity;
    let max = -Infinity;
    for (let ai = 0; ai < field.length; ai++) {
      if (result.handleNodes.indexOf(ai) >= 0) continue;
      min = Math.min(min, field[ai]);
      max = Math.max(max, field[ai]);
    }
    return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max };
  }

  function updateSelectedHandle() {
    const handle = Core.HANDLES[state.selected];
    const displacement = state.displacements[state.selected];
    el.handleName.textContent = handle.id + " / " + handle.name;
    el.handleChip.textContent = handle.id;
    el.handleChip.style.background = handle.color;
    el.handleChip.style.boxShadow = "0 0 0 4px " + "rgba(" + hexToRgb(handle.color).join(",") + ",0.13)";
    el.handlePosition.textContent = formatCoordinate(handle.x) + ", " + formatCoordinate(handle.y);
    el.handleDisplacement.textContent = formatSigned(displacement.x) + ", " + formatSigned(displacement.y);

    if (state.result && state.result.fields.length) {
      const range = computeFieldRange(state.result, state.selected);
      el.fieldRange.textContent = range.min.toFixed(3) + " — " + range.max.toFixed(3);
      el.rangeFill.style.width = clamp(range.max * 100, 2, 100) + "%";
      el.rangeFill.style.background = "linear-gradient(90deg, rgba(" +
        hexToRgb(handle.color).join(",") + ",0.06), " + handle.color + ")";
      el.rangeMin.textContent = range.min.toFixed(2);
      el.rangeMax.textContent = range.max.toFixed(2);
      const probeSnap = Core.nearestActive(state.result.grid, 0.36, 0.32);
      el.bypassValue.textContent = state.result.fields[3][probeSnap.active].toFixed(3);
    }
  }

  function renderMini(canvas, result, index) {
    const prepared = prepareCanvas(canvas);
    const ctx = prepared.ctx;
    const rect = prepared.rect;
    const view = makeView(rect, 5);
    ctx.clearRect(0, 0, rect.width, rect.height);

    ctx.beginPath();
    tracePolygon(ctx, Core.OUTER, view);
    ctx.fillStyle = "#f7f4eb";
    ctx.fill();
    ctx.save();
    makeDomainPath(ctx, view);
    ctx.clip("evenodd");
    drawStaticField(ctx, view, result, index, Core.HANDLES[index].color);
    ctx.restore();

    ctx.save();
    makeHolePath(ctx, view);
    ctx.clip();
    ctx.fillStyle = "#ece9df";
    ctx.fillRect(0, 0, rect.width, rect.height);
    drawHatch(ctx, view);
    ctx.restore();

    ctx.beginPath();
    tracePolygon(ctx, Core.OUTER, view);
    ctx.strokeStyle = "rgba(29,40,36,0.88)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.beginPath();
    tracePolygon(ctx, Core.HOLE, view);
    ctx.strokeStyle = "rgba(29,40,36,0.7)";
    ctx.lineWidth = 0.7;
    ctx.stroke();

    Core.HANDLES.forEach(function (handle, handleIndex) {
      if (handleIndex !== index) return;
      const x = view.screenX(handle.x);
      const y = view.screenY(handle.y);
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = handle.color;
      ctx.fill();
      ctx.strokeStyle = "#fffdf7";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  function renderFieldBank() {
    if (!state.result || !state.result.fields.length) return;
    el.fieldGrid.innerHTML = "";
    state.miniCanvases = [];

    Core.HANDLES.forEach(function (handle, index) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "field-card" + (index === state.selected ? " active" : "");
      card.style.setProperty("--card-color", handle.color);
      card.setAttribute("aria-label", "查看手柄 " + handle.id + " 的权重场");

      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      card.appendChild(canvas);

      const marker = document.createElement("span");
      marker.className = "field-card-index";
      marker.textContent = "ψ" + handle.id;
      card.appendChild(marker);

      const foot = document.createElement("span");
      foot.className = "field-card-foot";
      const range = computeFieldRange(state.result, index);
      foot.innerHTML =
        '<span class="field-card-name"><i class="swatch-dot"></i>' + handle.id + " · " + handle.name + "</span>" +
        '<span class="field-card-range">' + range.min.toFixed(2) + "–" + range.max.toFixed(2) + "</span>";
      card.appendChild(foot);

      card.addEventListener("click", function () {
        state.selected = index;
        if (state.mode === "mesh") state.mode = "field";
        updateViewChrome();
        renderFieldBank();
        updateSelectedHandle();
        renderMain();
      });

      el.fieldGrid.appendChild(card);
      state.miniCanvases.push({ canvas: canvas, index: index });
      renderMini(canvas, state.result, index);
    });
  }

  function updateViewChrome() {
    const handle = Core.HANDLES[state.selected];
    document.querySelectorAll(".mode").forEach(function (button) {
      button.classList.toggle("active", button.dataset.mode === state.mode);
    });
    if (state.mode === "field") {
      el.viewTitle.textContent = "Influence field / " + handle.id;
      el.viewIndex.textContent = "F";
      el.legendSwatch.style.background = handle.color;
      el.legendLabel.textContent = "ψ" + handle.id + " weight · 0 → 1";
    } else if (state.mode === "residual") {
      el.viewTitle.textContent = "Optimality residual / " + handle.id;
      el.viewIndex.textContent = "R";
      el.legendSwatch.style.background = "#cf5b45";
      el.legendLabel.textContent = "|Δ²ψ" + handle.id + "| · low → high";
    } else {
      el.viewTitle.textContent = "Deformed sample mesh";
      el.viewIndex.textContent = "M";
      el.legendSwatch.style.background = handle.color;
      el.legendLabel.textContent = "warped samples · drag handler";
    }
  }

  function mainPointFromEvent(event) {
    const rect = el.mainCanvas.getBoundingClientRect();
    const view = makeView(rect, Math.max(34, Math.min(rect.width, rect.height) * 0.09));
    return {
      sx: event.clientX - rect.left,
      sy: event.clientY - rect.top,
      x: view.worldX(event.clientX - rect.left),
      y: view.worldY(event.clientY - rect.top),
      view: view
    };
  }

  function hitHandle(point) {
    let best = -1;
    let bestDistance = HANDLE_HIT_RADIUS;
    Core.HANDLES.forEach(function (handle, index) {
      const display = handleDisplayPosition(index);
      const sx = point.view.screenX(display.x);
      const sy = point.view.screenY(display.y);
      const distance = Math.hypot(point.sx - sx, point.sy - sy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  function handlesConflict(index, candidate) {
    for (let k = 0; k < Core.HANDLES.length; k++) {
      if (k === index) continue;
      const other = handleDisplayPosition(k);
      if (Math.hypot(candidate.x - other.x, candidate.y - other.y) < 0.036) return true;
    }
    return false;
  }

  function validHandlePosition(index, from, candidate) {
    const candidateInside = Core.pointInDomain(candidate.x, candidate.y);
    const candidateConflicts = handlesConflict(index, candidate);
    if (candidateInside && !candidateConflicts) return candidate;

    const inHole = Core.pointInPolygon(candidate.x, candidate.y, Core.HOLE);
    const now = performance.now();
    if (now - state.lastInvalidMessage > 1400) {
      state.lastInvalidMessage = now;
      if (candidateConflicts) {
        showToast("约束冲突：两个手柄不能落在同一 Dirichlet 节点附近。请保持它们分离。");
      } else if (inHole) {
        showToast("约束不可行：手柄 " + Core.HANDLES[index].id +
          " 不能进入孔洞。Dirichlet 点必须位于 Ω 内，路径不会被直线跨孔桥接。");
      } else {
        showToast("约束不可行：手柄 " + Core.HANDLES[index].id +
          " 必须保持在多边形域 Ω 内。");
      }
    }

    const steps = 18;
    let lastValid = null;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sample = {
        x: from.x + (candidate.x - from.x) * t,
        y: from.y + (candidate.y - from.y) * t
      };
      if (Core.pointInDomain(sample.x, sample.y) && !handlesConflict(index, sample)) {
        lastValid = sample;
      } else {
        break;
      }
    }
    return lastValid;
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const point = mainPointFromEvent(event);
    const hit = hitHandle(point);
    if (hit < 0) return;

    event.preventDefault();
    state.selected = hit;
    state.drag = {
      index: hit,
      pointerX: point.x,
      pointerY: point.y,
      startDisplacement: {
        x: state.displacements[hit].x,
        y: state.displacements[hit].y
      }
    };
    el.mainCanvas.classList.add("dragging");
    el.mainCanvas.setPointerCapture(event.pointerId);
    updateViewChrome();
    renderFieldBank();
    updateSelectedHandle();
    renderMain();
  }

  function onPointerMove(event) {
    const point = mainPointFromEvent(event);
    if (Core.pointInDomain(point.x, point.y)) {
      el.cursorCoordinate.textContent = "u " + point.x.toFixed(3) + " · v " + point.y.toFixed(3);
    } else {
      el.cursorCoordinate.textContent = "outside Ω";
    }

    if (!state.drag) return;
    const index = state.drag.index;
    const handle = Core.HANDLES[index];
    const candidate = {
      x: handle.x + state.drag.startDisplacement.x + (point.x - state.drag.pointerX),
      y: handle.y + state.drag.startDisplacement.y + (point.y - state.drag.pointerY)
    };
    const current = handleDisplayPosition(index);
    const accepted = validHandlePosition(index, current, candidate);
    if (!accepted) return;

    state.displacements[index].x = accepted.x - handle.x;
    state.displacements[index].y = accepted.y - handle.y;
    updateSelectedHandle();
    renderMain();
  }

  function endDrag(event) {
    if (!state.drag) return;
    state.drag = null;
    el.mainCanvas.classList.remove("dragging");
    if (event && el.mainCanvas.hasPointerCapture(event.pointerId)) {
      el.mainCanvas.releasePointerCapture(event.pointerId);
    }
    renderMain();
  }

  function resetDeformation(showMessage) {
    state.displacements = Core.HANDLES.map(function () { return { x: 0, y: 0 }; });
    state.selected = 3;
    state.drag = null;
    updateViewChrome();
    updateSelectedHandle();
    renderMain();
    if (showMessage) showToast("已恢复静止位形，并重新求解权重场。");
    scheduleSolve();
  }

  function bindEvents() {
    document.querySelectorAll(".mode").forEach(function (button) {
      button.addEventListener("click", function () {
        state.mode = button.dataset.mode;
        updateViewChrome();
        renderMain();
      });
    });

    el.mainCanvas.addEventListener("pointerdown", onPointerDown);
    el.mainCanvas.addEventListener("pointermove", onPointerMove);
    el.mainCanvas.addEventListener("pointerup", endDrag);
    el.mainCanvas.addEventListener("pointercancel", endDrag);
    el.mainCanvas.addEventListener("pointerleave", function () {
      if (!state.drag) el.cursorCoordinate.textContent = "u — · v —";
    });
    el.mainCanvas.addEventListener("dblclick", function (event) {
      const point = mainPointFromEvent(event);
      const hit = hitHandle(point);
      if (hit < 0) return;
      state.selected = hit;
      state.displacements[hit] = { x: 0, y: 0 };
      updateViewChrome();
      renderFieldBank();
      updateSelectedHandle();
      renderMain();
      showToast("手柄 " + Core.HANDLES[hit].id + " 已回到静止位置。");
    });

    el.resetButton.addEventListener("click", function () {
      resetDeformation(true);
    });

    el.aboutButton.addEventListener("click", openModal);
    el.modalClose.addEventListener("click", closeModal);
    el.modalDone.addEventListener("click", closeModal);
    el.modal.addEventListener("click", function (event) {
      if (event.target === el.modal) closeModal();
    });

    window.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (!el.modal.hidden) closeModal();
        if (state.drag) endDrag();
        return;
      }
      if (!el.modal.hidden) return;
      const key = event.key.toLowerCase();
      if (key === "m" || key === "f" || key === "r") {
        state.mode = key === "m" ? "mesh" : key === "f" ? "field" : "residual";
        updateViewChrome();
        renderMain();
      }
      const numeric = Number(event.key);
      if (numeric >= 1 && numeric <= Core.HANDLES.length) {
        state.selected = numeric - 1;
        updateViewChrome();
        renderFieldBank();
        updateSelectedHandle();
        renderMain();
      }
    });

    window.addEventListener("resize", function () {
      renderMain();
      state.miniCanvases.forEach(function (entry) {
        renderMini(entry.canvas, state.result, entry.index);
      });
    });

    if ("ResizeObserver" in window) {
      let frame = 0;
      const observer = new ResizeObserver(function () {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(function () {
          renderMain();
          state.miniCanvases.forEach(function (entry) {
            renderMini(entry.canvas, state.result, entry.index);
          });
        });
      });
      observer.observe(el.mainCanvas);
    }
  }

  function openModal() {
    el.modal.hidden = false;
    el.modalClose.focus();
  }

  function closeModal() {
    el.modal.hidden = true;
    el.aboutButton.focus();
  }

  function init() {
    bindEvents();
    updateViewChrome();
    solve(true);
  }

  window.BiharmonicApp = {
    state: state,
    solve: solve,
    render: renderMain
  };

  init();
})();
