import { vec, clamp, faceVertices, computeBounds } from "./geometry.js";

const WORLD_UP = [0, 1, 0];
const LIGHT_DIR = vec.normalize([-0.45, 0.78, 0.42]);

function triangleContainsPoint(x, y, a, b, c) {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-8) return false;
  const wa = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
  const wb = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
  return wa >= 0 && wb >= 0 && wa + wb <= 1;
}

function rgba(hue, saturation, lightness, alpha = 1) {
  return `hsla(${hue} ${saturation}% ${lightness}% / ${alpha})`;
}

export class MeshRenderer {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.callbacks = callbacks;
    this.mesh = null;
    this.query = null;
    this.classification = null;
    this.slicePlane = null;
    this.hoveredFace = -1;
    this.cutMode = false;
    this.yaw = -0.58;
    this.pitch = 0.3;
    this.distance = 4.7;
    this.target = [0, 0, 0];
    this.bounds = null;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.drag = null;
    this.pointer = { x: 0, y: 0, inside: false };
    this.animationFrame = 0;
    this.time = 0;
    this.bindEvents();
    this.resize();
    this.loop();
  }

  setMesh(mesh, { frame = true } = {}) {
    this.mesh = mesh;
    this.bounds = computeBounds(mesh);
    this.target = this.bounds.center.slice();
    if (frame) this.frameMesh();
    this.hoveredFace = -1;
  }

  frameMesh() {
    if (!this.bounds) return;
    this.distance = Math.max(2.8, this.bounds.radius * 2.65);
  }

  setQuery(point, classification) {
    this.query = point ? point.slice() : null;
    this.classification = classification;
  }

  setSlicePlane(slicePlane) {
    this.slicePlane = slicePlane;
  }

  setCutMode(enabled) {
    this.cutMode = enabled;
    this.canvas.classList.toggle("cut-mode", enabled);
  }

  setHoveredFace(face) {
    this.hoveredFace = face;
  }

  bindEvents() {
    const canvas = this.canvas;
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      const rect = canvas.getBoundingClientRect();
      this.pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        inside: true,
      };
      this.drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        moved: 0,
      };
      canvas.classList.add("dragging");
    });
    canvas.addEventListener("pointermove", (event) => {
      const rect = canvas.getBoundingClientRect();
      this.pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        inside: true,
      };
      if (this.drag) {
        const dx = event.clientX - this.drag.x;
        const dy = event.clientY - this.drag.y;
        this.drag.x = event.clientX;
        this.drag.y = event.clientY;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        this.yaw -= dx * 0.007;
        this.pitch = clamp(this.pitch + dy * 0.007, -1.42, 1.42);
      } else if (this.cutMode) {
        const face = this.faceAt(this.pointer.x, this.pointer.y);
        if (face !== this.hoveredFace) {
          this.hoveredFace = face;
          this.callbacks.onHover?.(face, this.pointer);
        }
      }
    });
    canvas.addEventListener("pointerup", (event) => {
      if (!this.drag) return;
      const wasClick = this.drag.moved < 5;
      const rect = canvas.getBoundingClientRect();
      this.pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        inside: true,
      };
      canvas.classList.remove("dragging");
      this.drag = null;
      if (wasClick && this.cutMode) {
        const face = this.faceAt(this.pointer.x, this.pointer.y);
        if (face >= 0) this.callbacks.onFaceClick?.(face);
      }
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointer.inside = false;
      if (this.hoveredFace !== -1) {
        this.hoveredFace = -1;
        this.callbacks.onHover?.(-1, this.pointer);
      }
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.distance = clamp(
        this.distance * Math.exp(event.deltaY * 0.0011),
        this.bounds ? this.bounds.radius * 1.25 : 2.2,
        this.bounds ? this.bounds.radius * 9 : 14,
      );
    }, { passive: false });
    canvas.addEventListener("dblclick", () => this.frameMesh());
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  cameraBasis() {
    const cosPitch = Math.cos(this.pitch);
    const eye = vec.add(this.target, [
      this.distance * cosPitch * Math.sin(this.yaw),
      this.distance * Math.sin(this.pitch),
      this.distance * cosPitch * Math.cos(this.yaw),
    ]);
    const forward = vec.normalize(vec.sub(this.target, eye));
    let right = vec.normalize(vec.cross(forward, WORLD_UP));
    if (vec.length(right) < 1e-5) right = [1, 0, 0];
    const up = vec.normalize(vec.cross(right, forward));
    const focal = (Math.min(this.width, this.height) * 0.5) / Math.tan((41 * Math.PI) / 360);
    return { eye, forward, right, up, focal };
  }

  project(point, basis = this.cameraBasis()) {
    const relative = vec.sub(point, basis.eye);
    const depth = vec.dot(relative, basis.forward);
    if (depth <= 0.03) return { x: 0, y: 0, depth, visible: false };
    return {
      x: this.width * 0.5 + (vec.dot(relative, basis.right) / depth) * basis.focal,
      y: this.height * 0.5 - (vec.dot(relative, basis.up) / depth) * basis.focal,
      depth,
      visible: true,
    };
  }

  projectedFaces() {
    if (!this.mesh) return [];
    const basis = this.cameraBasis();
    const faces = [];
    for (let face = 0; face < this.mesh.removed.length; face += 1) {
      const vertices = faceVertices(this.mesh, face);
      const projected = vertices.map((point) => this.project(point, basis));
      if (projected.some((point) => !point.visible)) continue;
      const centroid = vec.scale(vec.add(vec.add(vertices[0], vertices[1]), vertices[2]), 1 / 3);
      const normal = vec.normalize(vec.cross(vec.sub(vertices[1], vertices[0]), vec.sub(vertices[2], vertices[0])));
      faces.push({
        index: face,
        vertices,
        projected,
        centroid,
        normal,
        depth: (projected[0].depth + projected[1].depth + projected[2].depth) / 3,
        facing: vec.dot(normal, vec.sub(basis.eye, centroid)),
      });
    }
    return faces.sort((a, b) => b.depth - a.depth);
  }

  faceAt(x, y) {
    const faces = this.projectedFaces().sort((a, b) => a.depth - b.depth);
    for (const face of faces) {
      if (triangleContainsPoint(x, y, ...face.projected)) return face.index;
    }
    return -1;
  }

  drawGround(basis) {
    if (!this.bounds) return;
    const ctx = this.context;
    const y = this.bounds.min[1] - this.bounds.size[1] * 0.075 - 0.16;
    const extent = Math.max(this.bounds.size[0], this.bounds.size[2]) * 0.92 + 0.5;
    const divisions = 10;
    ctx.save();
    ctx.lineWidth = 1;
    for (let i = 0; i <= divisions; i += 1) {
      const t = -extent + (2 * extent * i) / divisions;
      const alpha = i === divisions / 2 ? 0.16 : 0.055;
      ctx.strokeStyle = `rgba(120, 158, 171, ${alpha})`;
      ctx.beginPath();
      const p1 = this.project([this.bounds.center[0] - extent, y, this.bounds.center[2] + t], basis);
      const p2 = this.project([this.bounds.center[0] + extent, y, this.bounds.center[2] + t], basis);
      if (p1.visible && p2.visible) {
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
      }
      ctx.stroke();
      ctx.beginPath();
      const p3 = this.project([this.bounds.center[0] + t, y, this.bounds.center[2] - extent], basis);
      const p4 = this.project([this.bounds.center[0] + t, y, this.bounds.center[2] + extent], basis);
      if (p3.visible && p4.visible) {
        ctx.moveTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSlicePlane(basis) {
    if (!this.slicePlane || !this.bounds) return;
    const { axis, value } = this.slicePlane;
    const center = this.bounds.center.slice();
    center[axis] = value;
    const axes = [0, 1, 2].filter((item) => item !== axis);
    const extents = axes.map((item) => this.bounds.size[item] * 0.62 + 0.08);
    const corners = [];
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        const point = center.slice();
        point[axes[0]] += su * extents[0];
        point[axes[1]] += sv * extents[1];
        corners.push(this.project(point, basis));
      }
    }
    if (corners.some((corner) => !corner.visible)) return;
    const ctx = this.context;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[1].x, corners[1].y);
    ctx.lineTo(corners[3].x, corners[3].y);
    ctx.lineTo(corners[2].x, corners[2].y);
    ctx.closePath();
    ctx.fillStyle = "rgba(73, 204, 208, 0.045)";
    ctx.fill();
    ctx.setLineDash([5, 7]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(111, 220, 220, 0.42)";
    ctx.stroke();
    ctx.restore();
  }

  drawMesh(faces) {
    const ctx = this.context;
    for (const face of faces) {
      const isRemoved = this.mesh.removed[face.index] === 1;
      const isHovered = this.cutMode && face.index === this.hoveredFace;
      const centroidOffset = vec.sub(face.centroid, this.bounds.center);
      const outward = vec.dot(face.normal, centroidOffset) >= 0;
      const light = 0.5 + 0.5 * Math.abs(vec.dot(face.normal, LIGHT_DIR));
      ctx.beginPath();
      ctx.moveTo(face.projected[0].x, face.projected[0].y);
      ctx.lineTo(face.projected[1].x, face.projected[1].y);
      ctx.lineTo(face.projected[2].x, face.projected[2].y);
      ctx.closePath();

      if (isRemoved) {
        ctx.fillStyle = "rgba(5, 9, 13, 0.74)";
        ctx.fill();
        ctx.setLineDash([4, 5]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(235, 163, 88, 0.72)";
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      if (isHovered) {
        ctx.fillStyle = "rgba(255, 211, 128, 0.78)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 239, 201, 0.95)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        continue;
      }

      const warm = outward;
      const hue = warm ? 36 : 187;
      const saturation = warm ? 68 : 42;
      const lightness = 27 + 35 * light;
      ctx.fillStyle = rgba(hue, saturation, lightness, 0.91);
      ctx.fill();
      ctx.strokeStyle = warm ? "rgba(20, 17, 12, 0.33)" : "rgba(4, 17, 21, 0.32)";
      ctx.lineWidth = 0.65;
      ctx.stroke();
    }
  }

  drawQuery(basis) {
    if (!this.query) return;
    const projected = this.project(this.query, basis);
    if (!projected.visible) return;
    const ctx = this.context;
    const kind = this.classification?.kind || "uncertain";
    const palette = {
      inside: ["#ffc86b", "rgba(255, 190, 82, 0.16)"],
      outside: ["#68d8df", "rgba(74, 205, 213, 0.14)"],
      uncertain: ["#ed8cc7", "rgba(228, 111, 179, 0.14)"],
      surface: ["#f279a9", "rgba(235, 103, 158, 0.16)"],
    }[kind] || ["#ed8cc7", "rgba(228, 111, 179, 0.14)"];

    if (this.classification?.nearestPoint) {
      const nearest = this.project(this.classification.nearestPoint, basis);
      if (nearest.visible && this.classification.nearestDistance < 0.2) {
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = "rgba(237, 140, 199, 0.52)";
        ctx.beginPath();
        ctx.moveTo(projected.x, projected.y);
        ctx.lineTo(nearest.x, nearest.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#f279a9";
        ctx.beginPath();
        ctx.arc(nearest.x, nearest.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    const pulse = 0.5 + 0.5 * Math.sin(this.time * 0.004);
    ctx.save();
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, 12 + pulse * 4, 0, Math.PI * 2);
    ctx.fillStyle = palette[1];
    ctx.fill();
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = palette[0];
    ctx.fill();
    ctx.strokeStyle = "rgba(8, 12, 17, 0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = palette[0];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(projected.x - 12, projected.y);
    ctx.lineTo(projected.x - 7, projected.y);
    ctx.moveTo(projected.x + 7, projected.y);
    ctx.lineTo(projected.x + 12, projected.y);
    ctx.moveTo(projected.x, projected.y - 12);
    ctx.lineTo(projected.x, projected.y - 7);
    ctx.moveTo(projected.x, projected.y + 7);
    ctx.lineTo(projected.x, projected.y + 12);
    ctx.stroke();

    const label = `W ${this.classification.winding.toFixed(4)}`;
    ctx.font = "600 11px 'IBM Plex Mono', monospace";
    const width = ctx.measureText(label).width + 16;
    let boxX = projected.x + 14;
    let boxY = projected.y - 28;
    if (boxX + width > this.width - 8) boxX = projected.x - width - 14;
    boxY = clamp(boxY, 8, this.height - 26);
    ctx.fillStyle = "rgba(6, 10, 14, 0.9)";
    ctx.strokeStyle = palette[0];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, width, 20, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette[0];
    ctx.fillText(label, boxX + 8, boxY + 14);
    ctx.restore();
  }

  drawAxisGizmo(basis) {
    const ctx = this.context;
    const origin = { x: 50, y: this.height - 48 };
    const axes = [
      { label: "X", color: "#ea7e68", vector: [1, 0, 0] },
      { label: "Y", color: "#7fc58a", vector: [0, 1, 0] },
      { label: "Z", color: "#6fb6dd", vector: [0, 0, 1] },
    ];
    ctx.save();
    ctx.font = "600 9px 'IBM Plex Mono', monospace";
    for (const axis of axes) {
      const sx = vec.dot(axis.vector, basis.right);
      const sy = -vec.dot(axis.vector, basis.up);
      ctx.strokeStyle = axis.color;
      ctx.fillStyle = axis.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(origin.x + sx * 23, origin.y + sy * 23);
      ctx.stroke();
      ctx.fillText(axis.label, origin.x + sx * 30 - 3, origin.y + sy * 30 + 3);
    }
    ctx.restore();
  }

  draw() {
    const ctx = this.context;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const gradient = ctx.createRadialGradient(
      this.width * 0.5,
      this.height * 0.4,
      0,
      this.width * 0.5,
      this.height * 0.5,
      Math.max(this.width, this.height) * 0.7,
    );
    gradient.addColorStop(0, "#101920");
    gradient.addColorStop(0.55, "#0b1117");
    gradient.addColorStop(1, "#070a0e");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    if (!this.mesh) return;
    const basis = this.cameraBasis();
    this.drawGround(basis);
    this.drawSlicePlane(basis);
    this.drawMesh(this.projectedFaces());
    this.drawQuery(basis);
    this.drawAxisGizmo(basis);
  }

  loop() {
    this.time = performance.now();
    this.draw();
    this.animationFrame = requestAnimationFrame(() => this.loop());
  }
}
