import { distance } from './geometry.js';
import { weightColor } from './visual.js';

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 640;
const CAGE_HIT_RADIUS = 17;
const MESH_HIT_RADIUS = 18;

export class CageEditor {
  constructor({
    canvas,
    model,
    onSelectionChange = () => {},
    onActiveChange = () => {},
    onModelChange = () => {},
  }) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.model = model;
    this.onSelectionChange = onSelectionChange;
    this.onActiveChange = onActiveChange;
    this.onModelChange = onModelChange;
    this.selectedMesh = null;
    this.activeCageVertex = null;
    this.selectedCageVertex = null;
    this.hoverCageVertex = null;
    this.drag = null;
    this.pointer = { x: 0, y: 0 };
    this.frame = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.bindEvents();
    this.selectNearestToCenter(false);
    this.resize();
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.handlePointerMove(event));
    this.canvas.addEventListener('pointerup', (event) => this.handlePointerUp(event));
    this.canvas.addEventListener('pointercancel', (event) => this.handlePointerUp(event));
    this.canvas.addEventListener('pointerleave', () => {
      if (this.drag) return;
      this.hoverCageVertex = null;
      this.canvas.style.cursor = 'default';
      this.scheduleDraw();
    });
  }

  setModel(model, notify = true) {
    this.model = model;
    this.selectedCageVertex = null;
    this.drag = null;
    this.selectNearestToCenter(notify);
    this.scheduleDraw();
  }

  selectNearestToCenter(notify = true) {
    const vertices = this.model.posedMeshVertices;
    if (vertices.length === 0) {
      this.selectedMesh = null;
      this.activeCageVertex = null;
      return;
    }

    const centroid = this.model.referenceCage.vertices.reduce(
      (sum, point) => ({ x: sum.x + point.x / this.model.referenceCage.vertices.length, y: sum.y + point.y / this.model.referenceCage.vertices.length }),
      { x: 0, y: 0 },
    );
    let nearest = 0;
    let nearestDistance = Infinity;
    vertices.forEach((point, index) => {
      const candidateDistance = distance(point, centroid);
      if (candidateDistance < nearestDistance) {
        nearest = index;
        nearestDistance = candidateDistance;
      }
    });
    this.selectedMesh = nearest;
    this.activeCageVertex = this.dominantWeight(nearest);
    if (notify) {
      this.onSelectionChange(nearest);
      this.onActiveChange(this.activeCageVertex);
    }
  }

  dominantWeight(meshIndex) {
    if (meshIndex === null) return null;
    const weights = this.model.weightRecord.weights[meshIndex] ?? [];
    let dominant = weights.length ? 0 : null;
    weights.forEach((weight, index) => {
      if (Math.abs(weight) > Math.abs(weights[dominant] ?? 0)) dominant = index;
    });
    return dominant;
  }

  setActiveCageVertex(index, notify = true) {
    this.activeCageVertex = index;
    if (notify) this.onActiveChange(index);
    this.scheduleDraw();
  }

  selectMesh(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.model.posedMeshVertices.length) return;
    this.selectedMesh = index;
    const dominant = this.dominantWeight(index);
    if (this.activeCageVertex === null) this.activeCageVertex = dominant;
    this.onSelectionChange(index);
    this.onActiveChange(this.activeCageVertex);
    this.scheduleDraw();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.scheduleDraw();
  }

  scheduleDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  getView() {
    const padding = Math.max(26, Math.min(54, this.width * 0.055));
    const scale = Math.min(
      (this.width - padding * 2) / WORLD_WIDTH,
      (this.height - padding * 2) / WORLD_HEIGHT,
    );
    return {
      scale,
      offsetX: (this.width - WORLD_WIDTH * scale) / 2,
      offsetY: (this.height - WORLD_HEIGHT * scale) / 2,
    };
  }

  worldToScreen(point, view = this.getView()) {
    return {
      x: view.offsetX + point.x * view.scale,
      y: view.offsetY + point.y * view.scale,
    };
  }

  screenToWorld(point, view = this.getView()) {
    return {
      x: (point.x - view.offsetX) / view.scale,
      y: (point.y - view.offsetY) / view.scale,
    };
  }

  eventPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  findCageHit(screenPoint) {
    const view = this.getView();
    let hit = null;
    let hitDistance = CAGE_HIT_RADIUS;
    this.model.posedVertices.forEach((point, index) => {
      const candidateDistance = distance(this.worldToScreen(point, view), screenPoint);
      if (candidateDistance <= hitDistance) {
        hitDistance = candidateDistance;
        hit = index;
      }
    });
    return hit;
  }

  findMeshHit(screenPoint) {
    const view = this.getView();
    let hit = null;
    let hitDistance = MESH_HIT_RADIUS;
    this.model.posedMeshVertices.forEach((point, index) => {
      const candidateDistance = distance(this.worldToScreen(point, view), screenPoint);
      if (candidateDistance <= hitDistance) {
        hitDistance = candidateDistance;
        hit = index;
      }
    });
    return hit;
  }

  handlePointerDown(event) {
    const screenPoint = this.eventPoint(event);
    const cageHit = this.findCageHit(screenPoint);
    if (cageHit !== null) {
      event.preventDefault();
      this.canvas.setPointerCapture(event.pointerId);
      this.selectedCageVertex = cageHit;
      this.activeCageVertex = cageHit;
      this.drag = { type: 'cage', index: cageHit, pointerId: event.pointerId };
      this.canvas.style.cursor = 'grabbing';
      this.onActiveChange(cageHit);
      this.scheduleDraw();
      return;
    }

    const meshHit = this.findMeshHit(screenPoint);
    if (meshHit !== null) {
      this.selectMesh(meshHit);
      return;
    }

    const worldPoint = this.screenToWorld(screenPoint);
    let nearest = null;
    let nearestDistance = Infinity;
    this.model.posedMeshVertices.forEach((point, index) => {
      const candidateDistance = distance(point, worldPoint);
      if (candidateDistance < nearestDistance) {
        nearest = index;
        nearestDistance = candidateDistance;
      }
    });
    if (nearest !== null && nearestDistance * this.getView().scale < 46) {
      this.selectMesh(nearest);
    }
  }

  handlePointerMove(event) {
    const screenPoint = this.eventPoint(event);
    this.pointer = screenPoint;

    if (this.drag) {
      event.preventDefault();
      const worldPoint = this.screenToWorld(screenPoint);
      const result = this.model.setCageVertex(this.drag.index, worldPoint.x, worldPoint.y);
      this.onModelChange({ kind: 'drag', result });
      this.scheduleDraw();
      return;
    }

    const hover = this.findCageHit(screenPoint);
    if (hover !== this.hoverCageVertex) {
      this.hoverCageVertex = hover;
      this.scheduleDraw();
    }
    this.canvas.style.cursor = hover !== null ? 'grab' : this.findMeshHit(screenPoint) !== null ? 'crosshair' : 'default';
  }

  handlePointerUp(event) {
    if (!this.drag) return;
    if (event.pointerId !== undefined && this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    const wasInvalid = Boolean(this.model.lastError);
    this.drag = null;
    this.canvas.style.cursor = this.hoverCageVertex !== null ? 'grab' : 'default';
    if (!wasInvalid) this.onModelChange({ kind: 'commit', result: { ok: true } });
    this.scheduleDraw();
  }

  draw() {
    if (!this.context || this.width === 0 || this.height === 0) return;
    const context = this.context;
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop(context);

    const view = this.getView();
    this.drawReferenceCage(context, view);
    this.drawMesh(context, view);
    this.drawSelectedProbe(context, view);
    this.drawCage(context, view);
  }

  drawBackdrop(context) {
    const spacing = 38;
    context.save();
    context.strokeStyle = 'rgba(104, 143, 174, 0.075)';
    context.lineWidth = 1;
    context.beginPath();
    for (let x = (this.width % spacing) / 2; x < this.width; x += spacing) {
      context.moveTo(x, 0);
      context.lineTo(x, this.height);
    }
    for (let y = (this.height % spacing) / 2; y < this.height; y += spacing) {
      context.moveTo(0, y);
      context.lineTo(this.width, y);
    }
    context.stroke();

    const gradient = context.createRadialGradient(
      this.width * 0.5,
      this.height * 0.45,
      0,
      this.width * 0.5,
      this.height * 0.45,
      Math.max(this.width, this.height) * 0.7,
    );
    gradient.addColorStop(0, 'rgba(52, 170, 211, 0.045)');
    gradient.addColorStop(1, 'rgba(52, 170, 211, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);
    context.restore();
  }

  tracePolygon(context, points, view) {
    if (points.length === 0) return;
    const first = this.worldToScreen(points[0], view);
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (let index = 1; index < points.length; index += 1) {
      const point = this.worldToScreen(points[index], view);
      context.lineTo(point.x, point.y);
    }
    context.closePath();
  }

  drawReferenceCage(context, view) {
    if (this.model.referenceCage.vertices.length === 0) return;
    context.save();
    this.tracePolygon(context, this.model.referenceCage.vertices, view);
    context.setLineDash([6, 7]);
    context.lineWidth = 1.2;
    context.strokeStyle = 'rgba(145, 172, 197, 0.34)';
    context.stroke();
    context.restore();
  }

  drawMesh(context, view) {
    const { triangles } = this.model.mesh;
    const posed = this.model.posedMeshVertices;
    const weights = this.model.weightRecord.weights;
    const active = this.activeCageVertex;
    if (triangles.length === 0) return;

    context.save();
    for (const triangle of triangles) {
      const a = this.worldToScreen(posed[triangle[0]], view);
      const b = this.worldToScreen(posed[triangle[1]], view);
      const c = this.worldToScreen(posed[triangle[2]], view);
      if (active === null) {
        context.fillStyle = 'rgba(95, 137, 166, 0.075)';
      } else {
        const weight = (weights[triangle[0]][active] + weights[triangle[1]][active] + weights[triangle[2]][active]) / 3;
        const alpha = 0.055 + 0.23 * Math.sqrt(Math.min(1, Math.abs(weight)));
        context.fillStyle = weightColor(weight, alpha);
      }
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.lineTo(c.x, c.y);
      context.closePath();
      context.fill();
    }

    context.beginPath();
    for (const triangle of triangles) {
      const a = this.worldToScreen(posed[triangle[0]], view);
      const b = this.worldToScreen(posed[triangle[1]], view);
      const c = this.worldToScreen(posed[triangle[2]], view);
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.lineTo(c.x, c.y);
      context.closePath();
    }
    context.strokeStyle = active === null ? 'rgba(147, 183, 209, 0.2)' : 'rgba(213, 237, 250, 0.3)';
    context.lineWidth = 0.65;
    context.stroke();

    if (active !== null) {
      context.globalCompositeOperation = 'lighter';
      posed.forEach((point, index) => {
        const weight = weights[index][active];
        const screen = this.worldToScreen(point, view);
        context.fillStyle = weightColor(weight, 0.42);
        context.beginPath();
        context.arc(screen.x, screen.y, 1.35, 0, Math.PI * 2);
        context.fill();
      });
    }
    context.restore();
  }

  drawSelectedProbe(context, view) {
    if (this.selectedMesh === null) return;
    const point = this.model.posedMeshVertices[this.selectedMesh];
    if (!point) return;
    const screen = this.worldToScreen(point, view);

    context.save();
    context.strokeStyle = 'rgba(255, 255, 255, 0.82)';
    context.lineWidth = 1.3;
    context.beginPath();
    context.arc(screen.x, screen.y, 7.5, 0, Math.PI * 2);
    context.stroke();

    context.strokeStyle = 'rgba(85, 216, 255, 0.36)';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(screen.x, screen.y, 12, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = '#f6fbff';
    context.beginPath();
    context.arc(screen.x, screen.y, 2.4, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  drawCage(context, view) {
    const points = this.model.posedVertices;
    if (points.length < 3) return;

    context.save();
    this.tracePolygon(context, points, view);
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.lineWidth = 2.2;
    context.strokeStyle = this.model.lastError ? 'rgba(255, 130, 137, 0.92)' : 'rgba(85, 216, 255, 0.9)';
    context.shadowColor = this.model.lastError ? 'rgba(255, 111, 120, 0.55)' : 'rgba(38, 190, 231, 0.6)';
    context.shadowBlur = 16;
    context.stroke();
    context.shadowBlur = 0;

    const weights = this.selectedMesh === null ? null : this.model.weightRecord.weights[this.selectedMesh];
    points.forEach((point, index) => {
      const screen = this.worldToScreen(point, view);
      const isSelected = index === this.selectedCageVertex;
      const isHovered = index === this.hoverCageVertex;
      const weight = weights?.[index];
      const radius = isHovered || isSelected || this.drag?.index === index ? 9 : 7.2;

      context.beginPath();
      context.arc(screen.x, screen.y, radius + 4, 0, Math.PI * 2);
      context.fillStyle = 'rgba(5, 13, 21, 0.76)';
      context.fill();

      context.beginPath();
      context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      context.fillStyle = weights ? weightColor(weight, 0.92) : '#0b1a27';
      context.fill();
      context.lineWidth = isSelected ? 2.4 : 1.5;
      context.strokeStyle = isSelected ? '#ffffff' : isHovered ? '#bff4ff' : 'rgba(113, 226, 255, 0.9)';
      context.stroke();

      if (isSelected) {
        context.beginPath();
        context.arc(screen.x, screen.y, radius + 7, 0, Math.PI * 2);
        context.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        context.lineWidth = 1;
        context.stroke();
      }

      context.font = '600 9px "SFMono-Regular", Consolas, monospace';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.fillStyle = isSelected ? '#ffffff' : 'rgba(203, 232, 247, 0.8)';
      context.fillText(`C${index}`, screen.x + radius + 7, screen.y - 1);

      if (weights && (isHovered || isSelected || Math.abs(weight) > 0.12)) {
        context.fillStyle = weightColor(weight, 0.95);
        context.font = '600 8px "SFMono-Regular", Consolas, monospace';
        context.fillText(weight.toFixed(3), screen.x + radius + 7, screen.y + 10);
      }
    });
    context.restore();
  }

  destroy() {
    this.resizeObserver.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
  }
}

export { WORLD_WIDTH, WORLD_HEIGHT };
