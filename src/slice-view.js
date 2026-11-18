import { computeBounds, clamp } from "./geometry.js";
import { windingNumber, classifyQuery } from "./winding.js";

const AXIS_INFO = [
  { label: "X", uAxis: 2, vAxis: 1, uLabel: "Z", vLabel: "Y" },
  { label: "Y", uAxis: 0, vAxis: 2, uLabel: "X", vLabel: "Z" },
  { label: "Z", uAxis: 0, vAxis: 1, uLabel: "X", vLabel: "Y" },
];

function cellColor(winding, kind, distance, epsilon) {
  const magnitude = Math.min(1, Math.abs(winding));
  if (kind === 2) {
    const surface = distance <= epsilon;
    const transition = 1 - Math.min(1, Math.abs(Math.abs(winding) - 0.5) / 0.16);
    return `hsl(${surface ? 332 : 322} ${surface ? 58 : 48}% ${surface ? 27 : 18 + transition * 13}%)`;
  }
  if (kind === 1) {
    return `hsl(35 ${52 + magnitude * 28}% ${18 + magnitude * 31}%)`;
  }
  return `hsl(190 ${30 + (1 - magnitude) * 16}% ${10 + (1 - magnitude) * 8}%)`;
}

export class SliceView {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.callbacks = callbacks;
    this.mesh = null;
    this.bounds = null;
    this.axis = 1;
    this.value = 0;
    this.resolution = 43;
    this.values = null;
    this.distances = null;
    this.kinds = null;
    this.geometry = null;
    this.epsilon = 0.008;
    this.band = 0.035;
    this.showValues = true;
    this.query = null;
    this.busy = false;
    this.bindEvents();
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setMesh(mesh) {
    this.mesh = mesh;
    this.bounds = computeBounds(mesh);
    this.setAxis(this.axis, this.bounds.center[this.axis]);
  }

  setAxis(axis, value = null) {
    this.axis = axis;
    if (!this.bounds) return;
    const info = AXIS_INFO[axis];
    const range = this.bounds.max[axis] - this.bounds.min[axis];
    this.value = value ?? this.bounds.center[axis];
    this.axisMin = this.bounds.min[axis] - range * 0.08;
    this.axisMax = this.bounds.max[axis] + range * 0.08;
    if (this.axisMax - this.axisMin < 0.2) {
      this.axisMin -= 0.1;
      this.axisMax += 0.1;
    }
    this.updateGeometry(info);
  }

  setValue(value) {
    this.value = value;
  }

  setQuery(point) {
    this.query = point ? point.slice() : null;
  }

  setSettings({ epsilon, band, showValues }) {
    if (epsilon !== undefined) this.epsilon = epsilon;
    if (band !== undefined) this.band = band;
    if (showValues !== undefined) this.showValues = showValues;
  }

  updateGeometry(info = AXIS_INFO[this.axis]) {
    const b = this.bounds;
    const margin = 0.1;
    const uRange = b.max[info.uAxis] - b.min[info.uAxis];
    const vRange = b.max[info.vAxis] - b.min[info.vAxis];
    this.geometry = {
      ...info,
      uMin: b.min[info.uAxis] - Math.max(0.08, uRange * margin),
      uMax: b.max[info.uAxis] + Math.max(0.08, uRange * margin),
      vMin: b.min[info.vAxis] - Math.max(0.08, vRange * margin),
      vMax: b.max[info.vAxis] + Math.max(0.08, vRange * margin),
    };
  }

  compute() {
    if (!this.mesh || !this.geometry) return;
    const { resolution } = this;
    const { uAxis, vAxis } = this.geometry;
    const total = resolution * resolution;
    this.values = new Float32Array(total);
    this.distances = new Float32Array(total);
    this.kinds = new Uint8Array(total);
    const point = [0, 0, 0];
    for (let row = 0; row < resolution; row += 1) {
      const v = this.geometry.vMax - ((row + 0.5) / resolution) * (this.geometry.vMax - this.geometry.vMin);
      for (let column = 0; column < resolution; column += 1) {
        const u = this.geometry.uMin + ((column + 0.5) / resolution) * (this.geometry.uMax - this.geometry.uMin);
        point[this.axis] = this.value;
        point[uAxis] = u;
        point[vAxis] = v;
        const result = windingNumber(this.mesh, point);
        const classification = classifyQuery(result, {
          surfaceEpsilon: this.epsilon,
          valueBand: this.band,
        });
        const index = row * resolution + column;
        this.values[index] = result.winding;
        this.distances[index] = result.nearestDistance;
        this.kinds[index] = classification.kind === "inside"
          ? 1
          : classification.kind === "uncertain" || classification.kind === "surface" ? 2 : 0;
      }
    }
    this.draw();
  }

  sampleAtEvent(event) {
    if (!this.geometry) return null;
    const rect = this.canvas.getBoundingClientRect();
    const nx = clamp((event.clientX - rect.left) / rect.width, 0, 0.99999);
    const ny = clamp((event.clientY - rect.top) / rect.height, 0, 0.99999);
    const u = this.geometry.uMin + nx * (this.geometry.uMax - this.geometry.uMin);
    const v = this.geometry.vMax - ny * (this.geometry.vMax - this.geometry.vMin);
    const point = [0, 0, 0];
    point[this.axis] = this.value;
    point[this.geometry.uAxis] = u;
    point[this.geometry.vAxis] = v;
    const result = windingNumber(this.mesh, point);
    const classification = classifyQuery(result, {
      surfaceEpsilon: this.epsilon,
      valueBand: this.band,
    });
    return {
      point,
      result,
      classification,
      nx,
      ny,
      column: Math.min(this.resolution - 1, Math.floor(nx * this.resolution)),
      row: Math.min(this.resolution - 1, Math.floor(ny * this.resolution)),
    };
  }

  bindEvents() {
    this.canvas.addEventListener("pointermove", (event) => {
      const sample = this.sampleAtEvent(event);
      if (sample) this.callbacks.onSample?.(sample);
    });
    this.canvas.addEventListener("pointerleave", () => this.callbacks.onLeave?.());
    this.canvas.addEventListener("click", (event) => {
      const sample = this.sampleAtEvent(event);
      if (sample) this.callbacks.onPick?.(sample);
    });
  }

  drawContour(level, color) {
    if (!this.values) return;
    const ctx = this.context;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const n = this.resolution;
    const dw = width / n;
    const dh = height / n;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let row = 0; row < n - 1; row += 1) {
      for (let column = 0; column < n - 1; column += 1) {
        const tl = this.values[row * n + column];
        const tr = this.values[row * n + column + 1];
        const br = this.values[(row + 1) * n + column + 1];
        const bl = this.values[(row + 1) * n + column];
        const corners = [
          { value: tl, x: column * dw, y: row * dh },
          { value: tr, x: (column + 1) * dw, y: row * dh },
          { value: br, x: (column + 1) * dw, y: (row + 1) * dh },
          { value: bl, x: column * dw, y: (row + 1) * dh },
        ];
        const points = [];
        for (let edge = 0; edge < 4; edge += 1) {
          const a = corners[edge];
          const b = corners[(edge + 1) % 4];
          if ((a.value < level && b.value >= level) || (a.value >= level && b.value < level)) {
            const t = (level - a.value) / (b.value - a.value);
            points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
          }
        }
        if (points.length === 2) {
          ctx.moveTo(points[0].x, points[0].y);
          ctx.lineTo(points[1].x, points[1].y);
        } else if (points.length === 4) {
          ctx.moveTo(points[0].x, points[0].y);
          ctx.lineTo(points[1].x, points[1].y);
          ctx.moveTo(points[2].x, points[2].y);
          ctx.lineTo(points[3].x, points[3].y);
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  drawValueLabels(width, height) {
    if (!this.showValues || !this.values) return;
    const ctx = this.context;
    const n = this.resolution;
    const step = 7;
    const dw = width / n;
    const dh = height / n;
    ctx.save();
    ctx.font = "6px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let row = step; row < n; row += step) {
      for (let column = step; column < n; column += step) {
        const index = row * n + column;
        if (this.kinds[index] === 2 && this.distances[index] <= this.epsilon * 1.6) continue;
        const value = this.values[index];
        ctx.fillStyle = "rgba(238, 244, 244, 0.72)";
        ctx.fillText(value.toFixed(2), (column + 0.5) * dw, (row + 0.5) * dh);
      }
    }
    ctx.restore();
  }

  draw() {
    const canvas = this.canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#080d11";
    ctx.fillRect(0, 0, width, height);
    if (!this.values) return;

    const n = this.resolution;
    const cw = width / n;
    const ch = height / n;
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const index = row * n + column;
        ctx.fillStyle = cellColor(
          this.values[index],
          this.kinds[index],
          this.distances[index],
          this.epsilon,
        );
        ctx.fillRect(column * cw - 0.4, row * ch - 0.4, cw + 0.8, ch + 0.8);
      }
    }

    this.drawContour(0.5, "rgba(255, 205, 130, 0.82)");
    this.drawContour(-0.5, "rgba(106, 215, 223, 0.72)");

    ctx.save();
    ctx.strokeStyle = "rgba(170, 205, 211, 0.08)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let index = 0; index <= n; index += 7) {
      ctx.moveTo((index / n) * width, 0);
      ctx.lineTo((index / n) * width, height);
      ctx.moveTo(0, (index / n) * height);
      ctx.lineTo(width, (index / n) * height);
    }
    ctx.stroke();
    ctx.restore();

    if (this.query) {
      const info = this.geometry;
      const nx = (this.query[info.uAxis] - info.uMin) / (info.uMax - info.uMin);
      const ny = (info.vMax - this.query[info.vAxis]) / (info.vMax - info.vMin);
      if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(nx * width, ny * height, 3.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    this.drawValueLabels(width, height);
  }
}

export { AXIS_INFO };
