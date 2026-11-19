import { V } from "./physics.js";

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function lerpColor(a, b, t) {
  return a.map((channel, index) => Math.round(channel + (b[index] - channel) * t));
}

function rgba(color, alpha) {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

function pathFromPoints(ctx, points) {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
}

export class SceneRenderer {
  constructor(canvas, chain, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.chain = chain;
    this.camera = {
      yaw: -0.52,
      pitch: 0.14,
      distance: 7.15,
      target: [0, 0.23, 0],
      focal: 850,
    };
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.time = 0;
    this.dragState = null;
    this.onCameraChange = options.onCameraChange ?? (() => {});
    this._bindPointer();
    this.resize();
  }

  _bindPointer() {
    const canvas = this.canvas;
    canvas.addEventListener("pointerdown", (event) => {
      this.dragState = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        yaw: this.camera.yaw,
        pitch: this.camera.pitch,
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.dragState || event.pointerId !== this.dragState.id) return;
      const dx = event.clientX - this.dragState.x;
      const dy = event.clientY - this.dragState.y;
      this.camera.yaw = this.dragState.yaw + dx * 0.008;
      this.camera.pitch = clamp(this.dragState.pitch + dy * 0.0055, -0.35, 0.72);
      this.onCameraChange(this.camera);
    });
    const stopDrag = (event) => {
      if (!this.dragState || event.pointerId !== this.dragState.id) return;
      this.dragState = null;
      canvas.classList.remove("is-dragging");
    };
    canvas.addEventListener("pointerup", stopDrag);
    canvas.addEventListener("pointercancel", stopDrag);
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.camera.distance = clamp(this.camera.distance + event.deltaY * 0.005, 4.7, 10.5);
        this.onCameraChange(this.camera);
      },
      { passive: false },
    );
    canvas.addEventListener("dblclick", () => this.resetCamera());
  }

  resetCamera() {
    this.camera.yaw = -0.52;
    this.camera.pitch = 0.14;
    this.camera.distance = 7.15;
    this.onCameraChange(this.camera);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  project(point) {
    const [x, y, z] = point;
    const tx = x - this.camera.target[0];
    const ty = y - this.camera.target[1];
    const tz = z - this.camera.target[2];
    const cy = Math.cos(this.camera.yaw);
    const sy = Math.sin(this.camera.yaw);
    const cp = Math.cos(this.camera.pitch);
    const sp = Math.sin(this.camera.pitch);
    const x1 = tx * cy + tz * sy;
    const z1 = -tx * sy + tz * cy;
    const y1 = ty * cp - z1 * sp;
    const z2 = ty * sp + z1 * cp;
    const depth = this.camera.distance + z2;
    if (depth < 0.1) return null;
    const focal = (this.height * 0.5) / Math.tan((35 * Math.PI) / 360);
    const scale = focal / depth;
    return {
      x: this.width * 0.5 + x1 * scale,
      y: this.height * 0.47 - y1 * scale,
      z: depth,
      scale,
    };
  }

  render(props) {
    const ctx = this.ctx;
    this.time = props.time ?? performance.now() / 1000;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop();
    this.drawFloor();
    if (props.overlays?.trail) this.drawRootPath(props.pathPreview ?? [], props.rootTrail ?? []);
    this.drawBody(props.time ?? this.time);
    if (props.overlays?.cones) this.drawConeLimits(props.shape);
    this.drawChain(props.shape, props.time ?? this.time);
    if (props.overlays?.velocity) this.drawVelocities();
    if (props.overlays?.contacts) this.drawCollisions();
    this.drawRootAnchor(props.time ?? this.time);
  }

  drawBackdrop() {
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(
      this.width * 0.49,
      this.height * 0.4,
      10,
      this.width * 0.49,
      this.height * 0.45,
      this.width * 0.54,
    );
    gradient.addColorStop(0, "rgba(76,109,88,0.12)");
    gradient.addColorStop(0.55, "rgba(33,49,41,0.045)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.strokeStyle = "rgba(183,218,201,0.055)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 8]);
    ctx.beginPath();
    ctx.moveTo(this.width * 0.17, 0);
    ctx.lineTo(this.width * 0.17, this.height);
    ctx.moveTo(this.width * 0.83, 0);
    ctx.lineTo(this.width * 0.83, this.height);
    ctx.stroke();
    ctx.restore();
  }

  drawFloor() {
    const ctx = this.ctx;
    const floorY = -1.36;
    const center = this.project([0, floorY, 0]);
    if (!center) return;

    const glow = ctx.createRadialGradient(center.x, center.y, 2, center.x, center.y, Math.max(90, this.width * 0.26));
    glow.addColorStop(0, "rgba(81,123,99,0.13)");
    glow.addColorStop(1, "rgba(81,123,99,0)");
    ctx.save();
    ctx.scale(1, 0.28);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(center.x, center.y / 0.28, this.width * 0.26, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.lineWidth = 0.65;
    for (let ring = 1; ring <= 6; ring += 1) {
      const radius = ring * 0.68;
      const points = [];
      for (let step = 0; step <= 72; step += 1) {
        const angle = (step / 72) * TAU;
        const projected = this.project([
          Math.cos(angle) * radius,
          floorY,
          Math.sin(angle) * radius,
        ]);
        if (projected) points.push(projected);
      }
      if (points.length < 2) continue;
      ctx.strokeStyle = `rgba(117,151,132,${0.13 - ring * 0.012})`;
      pathFromPoints(ctx, points);
      ctx.stroke();
    }
    for (let spoke = 0; spoke < 12; spoke += 1) {
      const angle = (spoke / 12) * TAU;
      const a = this.project([Math.cos(angle) * 0.5, floorY, Math.sin(angle) * 0.5]);
      const b = this.project([Math.cos(angle) * 4.1, floorY, Math.sin(angle) * 4.1]);
      if (!a || !b) continue;
      ctx.strokeStyle = "rgba(117,151,132,0.055)";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBody(time) {
    const ctx = this.ctx;
    const sphere = this.chain.options.sphere;
    const center = this.project(sphere.center);
    if (!center) return;
    const radius = sphere.radius * center.scale;
    const top = center.y - radius * 0.92;

    ctx.save();
    const aura = ctx.createRadialGradient(
      center.x - radius * 0.2,
      center.y - radius * 0.22,
      radius * 0.1,
      center.x,
      center.y,
      radius * 1.35,
    );
    aura.addColorStop(0, "rgba(83,125,102,0.22)");
    aura.addColorStop(0.7, "rgba(40,67,53,0.08)");
    aura.addColorStop(1, "rgba(20,30,25,0)");
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 1.35, 0, TAU);
    ctx.fill();

    const body = ctx.createRadialGradient(
      center.x - radius * 0.34,
      center.y - radius * 0.4,
      radius * 0.05,
      center.x,
      center.y,
      radius,
    );
    body.addColorStop(0, "rgba(69,97,80,0.44)");
    body.addColorStop(0.44, "rgba(27,43,35,0.48)");
    body.addColorStop(0.84, "rgba(10,19,15,0.62)");
    body.addColorStop(1, "rgba(6,10,8,0.72)");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, TAU);
    ctx.fill();

    const rim = ctx.createRadialGradient(center.x, center.y, radius * 0.84, center.x, center.y, radius);
    rim.addColorStop(0, "rgba(156,204,177,0)");
    rim.addColorStop(0.88, "rgba(158,208,181,0.09)");
    rim.addColorStop(1, "rgba(191,235,209,0.38)");
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, TAU);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, TAU);
    ctx.clip();
    this.drawSphereLatitude(center, sphere, time);
    this.drawSphereLongitude(center, sphere);
    this.drawScanRing(center, sphere, radius, time);
    ctx.restore();

    ctx.strokeStyle = "rgba(174,219,191,0.13)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(center.x, top - 24);
    ctx.lineTo(center.x, center.y + radius + 18);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "7px ui-monospace, monospace";
    ctx.fillStyle = "rgba(157,190,171,0.45)";
    ctx.fillText("COLLISION BODY", center.x + radius * 0.62, center.y + radius + 22);
    ctx.fillText(`R ${sphere.radius.toFixed(2)}`, center.x + radius * 0.62, center.y + radius + 32);
    ctx.restore();
  }

  drawSphereLatitude(center, sphere, time) {
    const ctx = this.ctx;
    const latitudes = [-0.72, -0.4, -0.08, 0.25, 0.57, 0.82];
    for (const latitude of latitudes) {
      const y = sphere.center[1] + latitude * sphere.radius;
      const ringRadius = Math.sqrt(Math.max(0, 1 - latitude * latitude)) * sphere.radius;
      const points = [];
      for (let step = 0; step <= 48; step += 1) {
        const angle = (step / 48) * TAU;
        const point = this.project([
          sphere.center[0] + Math.cos(angle) * ringRadius,
          y,
          sphere.center[2] + Math.sin(angle) * ringRadius,
        ]);
        if (point) points.push(point);
      }
      if (points.length < 2) continue;
      ctx.strokeStyle = `rgba(118,163,138,${0.1 + latitude * 0.025})`;
      ctx.lineWidth = 0.7;
      pathFromPoints(ctx, points);
      ctx.stroke();
    }
    const scan = Math.sin(time * 0.85) * 0.55;
    const scanY = sphere.center[1] + scan * sphere.radius;
    const scanRadius = Math.sqrt(1 - scan * scan) * sphere.radius;
    const scanPoints = [];
    for (let step = 0; step <= 64; step += 1) {
      const angle = (step / 64) * TAU;
      const point = this.project([
        sphere.center[0] + Math.cos(angle) * scanRadius,
        scanY,
        sphere.center[2] + Math.sin(angle) * scanRadius,
      ]);
      if (point) scanPoints.push(point);
    }
    ctx.strokeStyle = "rgba(201,246,90,0.21)";
    ctx.lineWidth = 1;
    pathFromPoints(ctx, scanPoints);
    ctx.stroke();
  }

  drawSphereLongitude(center, sphere) {
    const ctx = this.ctx;
    for (const rotation of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
      const points = [];
      for (let step = 0; step <= 40; step += 1) {
        const angle = (step / 40) * TAU;
        const x = Math.cos(angle) * sphere.radius;
        const y = Math.sin(angle) * sphere.radius;
        const point = this.project([
          sphere.center[0] + Math.cos(rotation) * x,
          sphere.center[1] + y,
          sphere.center[2] + Math.sin(rotation) * x,
        ]);
        if (point) points.push(point);
      }
      ctx.strokeStyle = "rgba(109,151,129,0.075)";
      ctx.lineWidth = 0.6;
      pathFromPoints(ctx, points);
      ctx.stroke();
    }
  }

  drawScanRing(center, sphere, radius, time) {
    const ctx = this.ctx;
    const pulse = (time * 0.22) % 1;
    const y = center.y - radius + radius * 2 * pulse;
    const fade = Math.sin(pulse * Math.PI);
    ctx.save();
    ctx.strokeStyle = `rgba(201,246,90,${0.2 * fade})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(center.x, y, radius * 0.83 * fade + 4, radius * 0.18 * fade + 1, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  drawRootPath(preview, trail) {
    const ctx = this.ctx;
    if (preview.length > 1) {
      const points = preview.map((point) => this.project(point)).filter(Boolean);
      if (points.length > 1) {
        ctx.save();
        ctx.strokeStyle = "rgba(201,246,90,0.12)";
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 6]);
        pathFromPoints(ctx, points);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (trail.length > 1) {
      const points = trail.map((point) => this.project(point)).filter(Boolean);
      if (points.length < 2) return;
      ctx.save();
      const gradient = ctx.createLinearGradient(points[0].x, points[0].y, points.at(-1).x, points.at(-1).y);
      gradient.addColorStop(0, "rgba(255,156,98,0)");
      gradient.addColorStop(0.7, "rgba(255,156,98,0.18)");
      gradient.addColorStop(1, "rgba(255,156,98,0.72)");
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1.2;
      pathFromPoints(ctx, points);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawConeLimits(shape) {
    const ctx = this.ctx;
    const maxBend = this.chain.maxBend;
    const restLength = this.chain.restLength;
    const coneCenterOffset = restLength * Math.cos(maxBend);
    const coneRadius = restLength * Math.sin(maxBend);
    const stride = shape === "pendant" ? 1 : 2;
    ctx.save();
    for (let index = 1; index < this.chain.segments; index += stride) {
      const previous = this.chain.positions[index - 1];
      const joint = this.chain.positions[index];
      const incoming = V.normalize(V.sub(joint, previous));
      const helper = Math.abs(incoming[1]) < 0.88 ? [0, 1, 0] : [1, 0, 0];
      const u = V.normalize(V.cross(incoming, helper));
      const w = V.normalize(V.cross(incoming, u));
      const center = V.add(joint, V.scale(incoming, coneCenterOffset));
      const ring = [];
      for (let step = 0; step <= 32; step += 1) {
        const angle = (step / 32) * TAU;
        const point = V.add(
          center,
          V.add(V.scale(u, Math.cos(angle) * coneRadius), V.scale(w, Math.sin(angle) * coneRadius)),
        );
        const projected = this.project(point);
        if (projected) ring.push(projected);
      }
      if (ring.length < 3) continue;
      ctx.strokeStyle = `rgba(201,246,90,${index % 4 === 1 ? 0.22 : 0.1})`;
      ctx.lineWidth = 0.65;
      ctx.setLineDash([2, 4]);
      pathFromPoints(ctx, ring);
      ctx.stroke();
      if (index % 4 === 1) {
        ctx.fillStyle = "rgba(201,246,90,0.018)";
        pathFromPoints(ctx, ring);
        ctx.closePath();
        ctx.fill();
        ctx.setLineDash([]);
        const origin = this.project(joint);
        if (origin) {
          ctx.strokeStyle = "rgba(201,246,90,0.08)";
          ctx.beginPath();
          for (const step of [0, 8, 16, 24]) {
            const endpoint = ring[step];
            if (!endpoint) continue;
            ctx.moveTo(origin.x, origin.y);
            ctx.lineTo(endpoint.x, endpoint.y);
          }
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  getStyle(shape) {
    if (shape === "pendant") {
      return {
        radius: 0.038,
        core: [151, 176, 164],
        highlight: [239, 249, 243],
        shadow: [4, 11, 8],
        joint: [184, 206, 194],
        tip: "gem",
      };
    }
    return {
      radius: 0.069,
      core: [186, 148, 92],
      highlight: [248, 225, 175],
      shadow: [38, 23, 12],
      joint: [218, 186, 127],
      tip: "braid",
    };
  }

  drawChain(shape, time) {
    const ctx = this.ctx;
    const style = this.getStyle(shape);
    const points = this.chain.positions.map((position) => this.project(position));
    if (points.some((point) => !point)) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (shape === "pendant") {
      this.drawPendantSegments(points, style, time);
    } else {
      this.drawBraidSegments(points, style, time);
    }
    this.drawJoints(points, style, shape);
    if (style.tip === "gem") this.drawPendantGem(points, time);
    else this.drawBraidTassel(points, style);
    ctx.restore();
  }

  drawBraidSegments(points, style, time) {
    const ctx = this.ctx;
    for (let index = 0; index < this.chain.segments; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      const scale = (a.scale + b.scale) * 0.5;
      const taper = 1 - (index / this.chain.segments) * 0.28;
      const width = Math.max(2.2, style.radius * 2 * scale * taper);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / length;
      const ny = dx / length;

      ctx.strokeStyle = rgba(style.shadow, 0.82);
      ctx.lineWidth = width * 1.35;
      ctx.beginPath();
      ctx.moveTo(a.x + 2, a.y + 3);
      ctx.lineTo(b.x + 2, b.y + 3);
      ctx.stroke();

      const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      gradient.addColorStop(0, rgba(style.core, 0.95));
      gradient.addColorStop(0.46, rgba(lerpColor(style.core, style.highlight, 0.24), 1));
      gradient.addColorStop(1, rgba(lerpColor(style.core, style.shadow, 0.16), 0.98));
      ctx.strokeStyle = gradient;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      const weave = Math.sin(time * 2.2 + index * 1.15) * width * 0.22;
      for (const side of [-1, 1]) {
        const offset = side * width * 0.24 + weave * side;
        ctx.strokeStyle = rgba(style.highlight, side > 0 ? 0.32 : 0.16);
        ctx.lineWidth = Math.max(0.55, width * 0.14);
        ctx.beginPath();
        ctx.moveTo(a.x + nx * offset, a.y + ny * offset);
        ctx.quadraticCurveTo(
          (a.x + b.x) * 0.5 + nx * offset * 1.9,
          (a.y + b.y) * 0.5 + ny * offset * 1.9,
          b.x + nx * offset,
          b.y + ny * offset,
        );
        ctx.stroke();
      }
    }
  }

  drawPendantSegments(points, style, time) {
    const ctx = this.ctx;
    for (let index = 0; index < this.chain.segments; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      const scale = (a.scale + b.scale) * 0.5;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);

      ctx.strokeStyle = "rgba(4,9,7,0.85)";
      ctx.lineWidth = Math.max(2.8, style.radius * scale * 3.2);
      ctx.beginPath();
      ctx.moveTo(a.x + 1.5, a.y + 2);
      ctx.lineTo(b.x + 1.5, b.y + 2);
      ctx.stroke();

      ctx.strokeStyle = index % 2 === 0 ? "rgba(162,187,174,0.85)" : "rgba(113,139,126,0.86)";
      ctx.lineWidth = Math.max(1.2, style.radius * scale * 1.5);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.strokeStyle = "rgba(238,250,243,0.35)";
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.moveTo(a.x - 1, a.y - 1);
      ctx.lineTo(b.x - 1, b.y - 1);
      ctx.stroke();

      if (length > 9) {
        ctx.save();
        ctx.translate((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
        ctx.rotate(angle + Math.PI / 2);
        ctx.strokeStyle = index % 2 === 0 ? "rgba(218,234,225,0.7)" : "rgba(144,171,157,0.7)";
        ctx.lineWidth = Math.max(0.7, scale * 0.012);
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(2, scale * 0.032), length * 0.35, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawJoints(points, style, shape) {
    const ctx = this.ctx;
    const start = shape === "pendant" ? 1 : 1;
    for (let index = start; index <= this.chain.segments; index += 1) {
      const point = points[index];
      const taper = 1 - (index / this.chain.segments) * 0.2;
      const radius = Math.max(1.5, style.radius * point.scale * (shape === "pendant" ? 0.82 : 0.78) * taper);
      if (shape === "pendant" && index < this.chain.segments) {
        ctx.fillStyle = "rgba(197,218,207,0.62)";
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(0.8, radius * 0.45), 0, TAU);
        ctx.fill();
        continue;
      }
      const gradient = ctx.createRadialGradient(
        point.x - radius * 0.35,
        point.y - radius * 0.38,
        radius * 0.05,
        point.x,
        point.y,
        radius,
      );
      gradient.addColorStop(0, rgba(style.highlight, 1));
      gradient.addColorStop(0.36, rgba(style.joint, 0.9));
      gradient.addColorStop(1, rgba(style.shadow, 0.96));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,242,205,0.18)";
      ctx.lineWidth = 0.55;
      ctx.stroke();
    }
  }

  drawBraidTassel(points, style) {
    const ctx = this.ctx;
    const tip = points.at(-1);
    const previous = points.at(-2);
    const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
    const length = Math.max(18, tip.scale * 0.14);
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(angle);
    for (let index = -1; index <= 1; index += 1) {
      const spread = index * 4.2;
      ctx.strokeStyle = index === 0 ? "rgba(246,218,164,0.78)" : "rgba(187,145,86,0.62)";
      ctx.lineWidth = Math.max(1, style.radius * tip.scale * 0.22);
      ctx.beginPath();
      ctx.moveTo(0, spread * 0.28);
      ctx.quadraticCurveTo(length * 0.66, spread, length, spread * 1.25 + index * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPendantGem(points, time) {
    const ctx = this.ctx;
    const tip = points.at(-1);
    const previous = points.at(-2);
    const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
    const size = Math.max(6, tip.scale * 0.052);
    ctx.save();
    ctx.translate(tip.x, tip.y + size * 0.35);
    ctx.rotate(angle - Math.PI / 2);
    const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, size * 2.8);
    glow.addColorStop(0, "rgba(255,156,98,0.34)");
    glow.addColorStop(1, "rgba(255,156,98,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, size * 2.8, 0, TAU);
    ctx.fill();
    const gradient = ctx.createLinearGradient(-size, -size, size, size);
    gradient.addColorStop(0, "#ffd2a6");
    gradient.addColorStop(0.45, "#ff9c62");
    gradient.addColorStop(1, "#9c3f35");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.72);
    ctx.lineTo(size * 0.72, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size * 0.72, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,226,190,0.6)";
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.72);
    ctx.lineTo(0, size);
    ctx.moveTo(-size * 0.72, 0);
    ctx.lineTo(size * 0.72, 0);
    ctx.strokeStyle = "rgba(255,242,225,0.24)";
    ctx.stroke();
    ctx.restore();
  }

  drawVelocities() {
    const ctx = this.ctx;
    ctx.save();
    for (let index = 2; index <= this.chain.segments; index += 2) {
      const position = this.chain.positions[index];
      const velocity = this.chain.velocities[index];
      const speed = V.len(velocity);
      if (speed < 0.12) continue;
      const start = this.project(position);
      const direction = V.normalize(velocity);
      const vectorLength = Math.min(0.38, 0.055 + speed * 0.035);
      const end = this.project(V.add(position, V.scale(direction, vectorLength)));
      if (!start || !end) continue;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length < 2) continue;
      const alpha = clamp(0.18 + speed * 0.045, 0.2, 0.72);
      const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
      gradient.addColorStop(0, `rgba(108,231,196,${alpha})`);
      gradient.addColorStop(1, "rgba(201,246,90,0.08)");
      ctx.strokeStyle = gradient;
      ctx.fillStyle = `rgba(108,231,196,${alpha})`;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(start.x, start.y, 1.4, 0, TAU);
      ctx.fill();
      const ux = dx / length;
      const uy = dy / length;
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - ux * 4 - uy * 2, end.y - uy * 4 + ux * 2);
      ctx.lineTo(end.x - ux * 4 + uy * 2, end.y - uy * 4 - ux * 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawCollisions() {
    const ctx = this.ctx;
    const contacts = this.chain.collisions;
    ctx.save();
    for (let index = 0; index < contacts.length; index += 1) {
      const contact = contacts[index];
      const point = this.project(contact.point);
      if (!point) continue;
      const pulse = 4 + Math.sin(this.time * 4.2 + index) * 1.4;
      ctx.strokeStyle = "rgba(255,156,98,0.82)";
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(point.x, point.y, pulse, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,156,98,0.22)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, pulse + 4, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,196,153,0.76)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(point.x - 7, point.y);
      ctx.lineTo(point.x - 2, point.y);
      ctx.moveTo(point.x + 2, point.y);
      ctx.lineTo(point.x + 7, point.y);
      ctx.moveTo(point.x, point.y - 7);
      ctx.lineTo(point.x, point.y - 2);
      ctx.moveTo(point.x, point.y + 2);
      ctx.lineTo(point.x, point.y + 7);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,164,104,0.9)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawRootAnchor(time) {
    const ctx = this.ctx;
    const root = this.project(this.chain.positions[0]);
    if (!root) return;
    const velocity = this.chain.rootVelocity;
    const speed = V.len(velocity);
    ctx.save();
    ctx.strokeStyle = "rgba(255,156,98,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(root.x, root.y, 6.5, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,156,98,0.22)";
    ctx.beginPath();
    ctx.arc(root.x, root.y, 10 + Math.sin(time * 3) * 1.2, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "#ffb17b";
    ctx.beginPath();
    ctx.arc(root.x, root.y, 2.1, 0, TAU);
    ctx.fill();
    if (speed > 0.15) {
      const end = this.project(
        V.add(this.chain.positions[0], V.scale(V.normalize(velocity), Math.min(0.24, speed * 0.025))),
      );
      if (end) {
        ctx.strokeStyle = "rgba(255,156,98,0.34)";
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(root.x, root.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

export function drawEnergyScope(canvas, samples, options = {}) {
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const left = 9;
  const right = rect.width - 9;
  const top = 23;
  const bottom = rect.height - 19;
  if (samples.length < 2) {
    ctx.strokeStyle = "rgba(201,246,90,0.16)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(left, top + (bottom - top) * 0.5);
    ctx.lineTo(right, top + (bottom - top) * 0.5);
    ctx.stroke();
    return;
  }
  const max = Math.max(0.35, ...samples) * 1.12;
  const step = (right - left) / Math.max(1, samples.length - 1);
  const yFor = (value) => bottom - (value / max) * (bottom - top);

  ctx.save();
  ctx.beginPath();
  samples.forEach((value, index) => {
    const x = left + index * step;
    const y = yFor(value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, top, 0, bottom);
  fill.addColorStop(0, "rgba(201,246,90,0.18)");
  fill.addColorStop(1, "rgba(201,246,90,0)");
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  samples.forEach((value, index) => {
    const x = left + index * step;
    const y = yFor(value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = options.stopped ? "rgba(255,156,98,0.86)" : "rgba(201,246,90,0.84)";
  ctx.lineWidth = 1.15;
  ctx.stroke();

  const lastX = left + (samples.length - 1) * step;
  const lastY = yFor(samples.at(-1));
  const dot = ctx.createRadialGradient(lastX, lastY, 0, lastX, lastY, 8);
  dot.addColorStop(0, "rgba(201,246,90,0.95)");
  dot.addColorStop(1, "rgba(201,246,90,0)");
  ctx.fillStyle = dot;
  ctx.beginPath();
  ctx.arc(lastX, lastY, 8, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#d8ff80";
  ctx.beginPath();
  ctx.arc(lastX, lastY, 1.7, 0, TAU);
  ctx.fill();

  if (options.markerIndex != null && options.markerIndex >= 0 && options.markerIndex < samples.length) {
    const markerX = left + options.markerIndex * step;
    ctx.strokeStyle = "rgba(255,156,98,0.45)";
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(markerX, top);
    ctx.lineTo(markerX, bottom);
    ctx.stroke();
  }
  ctx.restore();
}
