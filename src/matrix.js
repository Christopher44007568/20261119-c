const PALETTE = [
  [18, 35, 34],
  [15, 119, 112],
  [191, 211, 74],
  [240, 101, 72],
];

function colorAt(value) {
  const scaled = Math.min(1, Math.max(0, value));
  const segment = Math.min(PALETTE.length - 2, Math.floor(scaled * (PALETTE.length - 1)));
  const local = scaled * (PALETTE.length - 1) - segment;
  const from = PALETTE[segment];
  const to = PALETTE[segment + 1];
  return from.map((channel, index) => Math.round(channel + (to[index] - channel) * local));
}

function percentile(values, fraction) {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] || 1;
}

function canvasSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, rect.width);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  return { width, dpr };
}

function plotGeometry(width, rows, cols) {
  const left = 52;
  const right = 18;
  const top = 22;
  const bottom = 48;
  const available = width - left - right;
  const plotWidth = Math.max(180, available);
  const plotHeight = Math.max(230, Math.min(590, plotWidth * (rows / cols)));
  return {
    left,
    top,
    plotWidth,
    plotHeight,
    height: plotHeight + top + bottom,
    cellWidth: plotWidth / cols,
    cellHeight: plotHeight / rows,
  };
}

export function hitTestMatrix(canvas, event, rows, cols) {
  const rect = canvas.getBoundingClientRect();
  const geometry = plotGeometry(rect.width, rows, cols);
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (
    x < geometry.left ||
    x > geometry.left + geometry.plotWidth ||
    y < geometry.top ||
    y > geometry.top + geometry.plotHeight
  ) {
    return null;
  }
  return {
    ref: Math.min(rows - 1, Math.floor((y - geometry.top) / geometry.cellHeight)),
    target: Math.min(cols - 1, Math.floor((x - geometry.left) / geometry.cellWidth)),
  };
}

function drawTicks(context, geometry, rows, cols) {
  context.save();
  context.fillStyle = "#69736f";
  context.font = '8px "SFMono-Regular", Consolas, monospace';
  context.textAlign = "center";
  const fractions = [0, 0.25, 0.5, 0.75, 1];
  for (const fraction of fractions) {
    const x = geometry.left + geometry.plotWidth * fraction;
    const value = Math.round((cols - 1) * fraction);
    context.fillText(String(value), x, geometry.top + geometry.plotHeight + 13);
    if (fraction > 0) {
      context.strokeStyle = "rgba(238,238,230,.18)";
      context.beginPath();
      context.moveTo(x, geometry.top);
      context.lineTo(x, geometry.top + geometry.plotHeight);
      context.stroke();
    }
  }
  context.textAlign = "right";
  for (const fraction of fractions) {
    const y = geometry.top + geometry.plotHeight * fraction;
    const value = Math.round((rows - 1) * fraction);
    context.fillText(String(value), geometry.left - 9, y + 3);
    if (fraction > 0) {
      context.strokeStyle = "rgba(238,238,230,.18)";
      context.beginPath();
      context.moveTo(geometry.left, y);
      context.lineTo(geometry.left + geometry.plotWidth, y);
      context.stroke();
    }
  }
  context.fillStyle = "#45514d";
  context.font = '9px "SFMono-Regular", Consolas, monospace';
  context.textAlign = "center";
  context.fillText("B / TARGET FRAME", geometry.left + geometry.plotWidth / 2, geometry.height - 10);
  context.translate(11, geometry.top + geometry.plotHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillText("A / REFERENCE FRAME", 0, 0);
  context.restore();
}

function drawHeatmap(context, geometry, costMatrix) {
  const { rows, cols, values } = costMatrix;
  const scaleMax = Math.max(1e-9, percentile(values, 0.97));
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const normalized = Math.sqrt(values[row * cols + col] / scaleMax);
      const [red, green, blue] = colorAt(normalized);
      context.fillStyle = `rgb(${red} ${green} ${blue})`;
      context.fillRect(
        geometry.left + col * geometry.cellWidth,
        geometry.top + row * geometry.cellHeight,
        Math.ceil(geometry.cellWidth + 0.25),
        Math.ceil(geometry.cellHeight + 0.25),
      );
    }
  }
  context.strokeStyle = "rgba(16,29,28,.55)";
  context.lineWidth = 1;
  context.strokeRect(geometry.left, geometry.top, geometry.plotWidth, geometry.plotHeight);
}

function drawPath(context, geometry, path) {
  if (!path || path.length === 0) return;
  const point = (pair) => ({
    x: geometry.left + (pair.target + 0.5) * geometry.cellWidth,
    y: geometry.top + (pair.ref + 0.5) * geometry.cellHeight,
  });
  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  path.forEach((pair, index) => {
    const current = point(pair);
    if (index === 0) context.moveTo(current.x, current.y);
    else context.lineTo(current.x, current.y);
  });
  context.strokeStyle = "rgba(16,29,28,.9)";
  context.lineWidth = 5;
  context.stroke();
  context.strokeStyle = "#fffdf4";
  context.lineWidth = 2.2;
  context.stroke();
  context.restore();
}

function drawAnchors(context, geometry, anchors) {
  for (const anchor of anchors ?? []) {
    if (anchor.boundary) continue;
    const x = geometry.left + (anchor.target + 0.5) * geometry.cellWidth;
    const y = geometry.top + (anchor.ref + 0.5) * geometry.cellHeight;
    context.save();
    context.beginPath();
    context.arc(x, y, 6, 0, Math.PI * 2);
    context.fillStyle = "#dff54a";
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "#101d1c";
    context.stroke();
    context.beginPath();
    context.arc(x, y, 2, 0, Math.PI * 2);
    context.fillStyle = "#101d1c";
    context.fill();
    context.restore();
  }
}

function drawSelection(context, geometry, cell, strong) {
  if (!cell) return;
  context.save();
  context.strokeStyle = strong ? "#dff54a" : "rgba(255,253,244,.92)";
  context.lineWidth = strong ? 2 : 1;
  context.strokeRect(
    geometry.left + cell.target * geometry.cellWidth + 1,
    geometry.top + cell.ref * geometry.cellHeight + 1,
    geometry.cellWidth - 2,
    geometry.cellHeight - 2,
  );
  context.restore();
}

export function drawCostMatrix(canvas, state) {
  const costMatrix = state.costMatrix;
  if (!costMatrix) return;
  const { width, dpr } = canvasSize(canvas);
  const geometry = plotGeometry(width, costMatrix.rows, costMatrix.cols);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(geometry.height * dpr);
  canvas.style.height = `${geometry.height}px`;
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, geometry.height);
  context.fillStyle = "#e9eae1";
  context.fillRect(0, 0, width, geometry.height);

  drawHeatmap(context, geometry, costMatrix);

  context.save();
  context.setLineDash([4, 5]);
  context.strokeStyle = "rgba(255,253,244,.35)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(geometry.left, geometry.top);
  context.lineTo(geometry.left + geometry.plotWidth, geometry.top + geometry.plotHeight);
  context.stroke();
  context.restore();

  drawPath(context, geometry, state.path);
  drawAnchors(context, geometry, state.anchors);
  drawSelection(context, geometry, state.hover, false);
  drawSelection(context, geometry, state.selected, true);
  drawTicks(context, geometry, costMatrix.rows, costMatrix.cols);
}

export function drawSparkline(canvas, clip, color) {
  const { width, dpr } = canvasSize(canvas);
  const height = 30;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!clip?.frames?.length) return;
  const speeds = [0];
  for (let index = 1; index < clip.frames.length; index += 1) {
    let squared = 0;
    let coordinates = 0;
    clip.frames[index].positions.forEach((position, jointIndex) => {
      position.forEach((coordinate, axis) => {
        squared += (coordinate - clip.frames[index - 1].positions[jointIndex][axis]) ** 2;
        coordinates += 1;
      });
    });
    speeds.push(Math.sqrt(squared / Math.max(1, coordinates)));
  }
  const maxSpeed = Math.max(1e-9, ...speeds);
  const padding = 2;
  context.beginPath();
  speeds.forEach((speed, index) => {
    const x = padding + (index / Math.max(1, speeds.length - 1)) * (width - padding * 2);
    const y = height - 3 - (speed / maxSpeed) * (height - 8);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.lineTo(width - padding, height);
  context.lineTo(padding, height);
  context.closePath();
  context.fillStyle = `${color}22`;
  context.fill();
  context.beginPath();
  speeds.forEach((speed, index) => {
    const x = padding + (index / Math.max(1, speeds.length - 1)) * (width - padding * 2);
    const y = height - 3 - (speed / maxSpeed) * (height - 8);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = color;
  context.lineWidth = 1.2;
  context.stroke();
}
