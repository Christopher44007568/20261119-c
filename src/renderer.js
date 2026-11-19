import {
  add,
  boundingDiagonal,
  cross,
  dot,
  length,
  scale,
  sub,
  triangleNormal
} from "./geometry.js";

const FOV = Math.PI / 4;
const UP = [0, 0, 1];

function normalize(vector) {
  const magnitude = length(vector);
  return magnitude > 1e-12 ? scale(vector, 1 / magnitude) : [0, 0, 0];
}

function colorForFace(light, invalid) {
  if (invalid) {
    return `rgb(${Math.round(210 + 35 * light)}, ${Math.round(58 + 40 * light)}, ${Math.round(58 + 35 * light)})`;
  }
  const warm = Math.max(0, light - 0.7) * 80;
  return `rgb(${Math.round(41 + 55 * light + warm)}, ${Math.round(128 + 94 * light)}, ${Math.round(126 + 86 * light)})`;
}

export class MeshRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.mesh = null;
    this.positions = [];
    this.controls = [];
    this.invalidFaces = new Set();
    this.selectedVertex = null;
    this.showWireframe = true;
    this.yaw = -0.7;
    this.pitch = 0.32;
    this.distance = 3.4;
    this.target = [0, 0, 0];
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setMesh(mesh, positions = mesh?.vertices ?? []) {
    this.mesh = mesh;
    this.positions = positions;
    if (mesh) {
      const center = positions.reduce(
        (sum, vertex) => [sum[0] + vertex[0], sum[1] + vertex[1], sum[2] + vertex[2]],
        [0, 0, 0]
      ).map((value) => value / positions.length);
      this.target = center;
      this.distance = Math.max(boundingDiagonal(positions) * 2.05, 2.2);
      this.yaw = -0.72;
      this.pitch = 0.3;
    }
    this.render();
  }

  setScene({ positions, controls, invalidFaces, selectedVertex }) {
    if (positions) this.positions = positions;
    if (controls) this.controls = controls;
    if (invalidFaces) this.invalidFaces = new Set(invalidFaces);
    this.selectedVertex = selectedVertex ?? null;
    this.render();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.render();
  }

  cameraBasis() {
    const cosPitch = Math.cos(this.pitch);
    const eyeOffset = [
      this.distance * cosPitch * Math.cos(this.yaw),
      this.distance * cosPitch * Math.sin(this.yaw),
      this.distance * Math.sin(this.pitch)
    ];
    const eye = add(this.target, eyeOffset);
    const forward = normalize(sub(this.target, eye));
    const right = normalize(cross(forward, UP));
    const cameraUp = normalize(cross(right, forward));
    return { eye, forward, right, cameraUp };
  }

  projectPoint(point, basis = this.cameraBasis()) {
    const relative = sub(point, basis.eye);
    const depth = dot(relative, basis.forward);
    if (depth <= 1e-6) return null;
    const tangent = Math.tan(FOV / 2);
    const aspect = this.width / this.height;
    return {
      x: this.width / 2 + (dot(relative, basis.right) / (depth * tangent * aspect)) * (this.width / 2),
      y: this.height / 2 - (dot(relative, basis.cameraUp) / (depth * tangent)) * (this.height / 2),
      depth
    };
  }

  orbit(deltaX, deltaY) {
    this.yaw -= deltaX * 0.007;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + deltaY * 0.006));
    this.render();
  }

  zoom(deltaY) {
    this.distance = Math.max(1.2, Math.min(20, this.distance * Math.exp(deltaY * 0.001)));
    this.render();
  }

  pickVertex(x, y, maximumDistance = 15) {
    const basis = this.cameraBasis();
    let best = null;
    this.positions.forEach((position, index) => {
      const projected = this.projectPoint(position, basis);
      if (!projected) return;
      const distance = Math.hypot(projected.x - x, projected.y - y);
      if (distance <= maximumDistance && (!best || projected.depth < best.depth)) {
        best = { index, ...projected, distance };
      }
    });
    return best;
  }

  pickControl(x, y, maximumDistance = 15) {
    const basis = this.cameraBasis();
    let best = null;
    this.controls.forEach((control) => {
      const projected = this.projectPoint(control.target, basis);
      if (!projected) return;
      const distance = Math.hypot(projected.x - x, projected.y - y);
      if (distance <= maximumDistance && (!best || projected.depth < best.depth)) {
        best = { ...control, ...projected, distance };
      }
    });
    return best;
  }

  screenDeltaToWorld(deltaX, deltaY, depth) {
    const basis = this.cameraBasis();
    const tangent = Math.tan(FOV / 2);
    const aspect = this.width / this.height;
    const worldX = (deltaX * 2 * depth * tangent * aspect) / this.width;
    const worldY = (-deltaY * 2 * depth * tangent) / this.height;
    return add(scale(basis.right, worldX), scale(basis.cameraUp, worldY));
  }

  render() {
    const context = this.context;
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    if (!this.mesh || this.positions.length === 0) return;

    const basis = this.cameraBasis();
    const tangent = Math.tan(FOV / 2);
    const aspect = this.width / this.height;
    const light = normalize([0.32, -0.48, 0.82]);
    const projectedFaces = [];

    this.mesh.faces.forEach((face, faceIndex) => {
      const projected = face.map((vertex) => this.projectPoint(this.positions[vertex], basis));
      if (projected.some((point) => point === null)) return;
      const normal = triangleNormal(this.positions, face);
      const centroid = scale(
        add(add(this.positions[face[0]], this.positions[face[1]]), this.positions[face[2]]),
        1 / 3
      );
      const facing = dot(normal, sub(basis.eye, centroid));
      projectedFaces.push({
        faceIndex,
        projected,
        centroid,
        normal,
        facing,
        depth: (projected[0].depth + projected[1].depth + projected[2].depth) / 3
      });
    });

    projectedFaces.sort((a, b) => b.depth - a.depth);
    context.lineJoin = "round";
    for (const item of projectedFaces) {
      const invalid = this.invalidFaces.has(item.faceIndex);
      const frontFacing = item.facing > 0;
      if (!frontFacing && !invalid && this.invalidFaces.size === 0) continue;

      const unitNormal = normalize(item.normal);
      const illumination = Math.max(0, dot(unitNormal, light));
      context.beginPath();
      context.moveTo(item.projected[0].x, item.projected[0].y);
      context.lineTo(item.projected[1].x, item.projected[1].y);
      context.lineTo(item.projected[2].x, item.projected[2].y);
      context.closePath();
      context.fillStyle = colorForFace(frontFacing ? illumination : illumination * 0.45, invalid);
      context.fill();
      if (this.showWireframe) {
        context.strokeStyle = invalid
          ? "rgba(255, 220, 215, 0.9)"
          : "rgba(3, 29, 34, 0.55)";
        context.lineWidth = invalid ? 2 : 1;
        context.stroke();
      }
    }

    this.drawAxes(context, basis);
    this.drawVertices(context, basis);
    this.drawControls(context, basis);
  }

  drawAxes(context, basis) {
    if (!this.mesh) return;
    const size = Math.max(boundingDiagonal(this.positions) * 0.17, 0.2);
    const origin = [this.target[0] - size * 1.9, this.target[1] - size * 1.7, this.target[2] - size * 1.25];
    const axes = [
      { label: "X", color: "#ff8b78", end: add(origin, [size, 0, 0]) },
      { label: "Y", color: "#9add78", end: add(origin, [0, size, 0]) },
      { label: "Z", color: "#73c8ff", end: add(origin, [0, 0, size]) }
    ];
    const projectedOrigin = this.projectPoint(origin, basis);
    if (!projectedOrigin) return;
    context.save();
    context.lineWidth = 1.5;
    context.font = "600 10px ui-monospace, monospace";
    for (const axis of axes) {
      const end = this.projectPoint(axis.end, basis);
      if (!end) continue;
      context.strokeStyle = axis.color;
      context.beginPath();
      context.moveTo(projectedOrigin.x, projectedOrigin.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      context.fillStyle = axis.color;
      context.fillText(axis.label, end.x + 3, end.y + 3);
    }
    context.restore();
  }

  drawVertices(context, basis) {
    if (this.controls.length > 0) return;
    context.save();
    context.fillStyle = "rgba(215, 255, 248, 0.55)";
    this.positions.forEach((position) => {
      const point = this.projectPoint(position, basis);
      if (!point) return;
      context.beginPath();
      context.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
      context.fill();
    });
    context.restore();
  }

  drawControls(context, basis) {
    if (!this.mesh) return;
    context.save();
    context.lineWidth = 1.4;
    context.font = "600 10px ui-monospace, monospace";

    for (const control of this.controls) {
      const target = this.projectPoint(control.target, basis);
      const source = this.projectPoint(this.mesh.vertices[control.vertex], basis);
      if (!target || !source) continue;
      const selected = control.vertex === this.selectedVertex;

      if (Math.hypot(target.x - source.x, target.y - source.y) > 3) {
        context.setLineDash([4, 4]);
        context.strokeStyle = "rgba(255, 188, 92, 0.65)";
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.stroke();
        context.setLineDash([]);
      }

      context.strokeStyle = "rgba(255, 219, 158, 0.65)";
      context.beginPath();
      context.arc(source.x, source.y, 3.4, 0, Math.PI * 2);
      context.stroke();

      if (selected) {
        context.fillStyle = "rgba(255, 172, 64, 0.18)";
        context.beginPath();
        context.arc(target.x, target.y, 12, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = selected ? "#ffc266" : "#ff9f43";
      context.beginPath();
      context.arc(target.x, target.y, selected ? 5.2 : 4.3, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(255, 244, 220, 0.9)";
      context.fillText(`#${control.vertex}`, target.x + 8, target.y - 8);
    }
    context.restore();
  }
}
