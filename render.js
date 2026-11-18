/*
 * render.js — 零依赖 Canvas 3D 渲染器
 * 球面轨道相机 + 画家算法深度排序，支持面/边高亮与屏幕拾取。
 */
(function (global) {
  'use strict';

  function vecSub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }
  function vecCross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }
  function vecDot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  function vecNorm(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.yaw = 0.6;
    this.pitch = 0.35;
    this.zoom = 1;
    this.center = [0, 0, 0];
    this.scale = 1;
    this.mesh = null;
    this.faceColor = () => '#9fb4c7';
    this.edgeColor = () => 'rgba(30,40,55,0.55)';
    this.highlightEdges = new Set();
    this.hotEdges = new Set();
    this.highlightFaces = new Set();
    this.faceIdAt = null;
  }

  Renderer.prototype.setMesh = function (mesh) {
    this.mesh = mesh;
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (const v of mesh.vertices) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], v[k]);
        max[k] = Math.max(max[k], v[k]);
      }
    }
    this.center = [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ];
    const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    this.scale = (this.canvas.width * 0.42) / (extent || 1);
  };

  Renderer.prototype.rotate = function (p) {
    const x = p[0] - this.center[0];
    const y = p[1] - this.center[1];
    const z = p[2] - this.center[2];
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    // yaw around Z, then pitch around X
    const x1 = x * cy - y * sy;
    const y1 = x * sy + y * cy;
    const y2 = y1 * cp - z * sp;
    const z2 = y1 * sp + z * cp;
    return [x1, y2, z2];
  };

  Renderer.prototype.project = function (rp) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const persp = 9 / (9 + rp[2] * this.scale * 0.08);
    return [
      w / 2 + rp[0] * this.scale * this.zoom * persp,
      h / 2 - rp[1] * this.scale * this.zoom * persp,
      rp[2],
    ];
  };

  Renderer.prototype.render = function () {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!this.mesh) return;

    const rotated = this.mesh.vertices.map((v) => this.rotate(v));
    const items = [];
    for (let f = 0; f < this.mesh.faces.length; f++) {
      const fc = this.mesh.faces[f];
      const rp = fc.map((vi) => rotated[vi]);
      const depth = (rp[0][2] + rp[1][2] + rp[2][2]) / 3;
      items.push({ f, rp, depth });
    }
    items.sort((a, b) => a.depth - b.depth);

    this.faceIdAt = new Map();
    const lightDir = vecNorm([0.4, 0.5, 0.9]);

    for (const item of items) {
      const { f, rp } = item;
      const pts = rp.map((p) => this.project(p));
      const n = vecNorm(vecCross(vecSub(rp[1], rp[0]), vecSub(rp[2], rp[0])));
      const shade = 0.55 + 0.45 * Math.max(0, vecDot(n, lightDir));
      let base = this.faceColor(f, shade);
      if (this.highlightFaces.has(f)) base = this._hl || '#ffd23d';
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.lineTo(pts[2][0], pts[2][1]);
      ctx.closePath();
      if (typeof base === 'string') {
        ctx.fillStyle = base;
      } else {
        ctx.fillStyle = `rgb(${Math.round(base[0] * shade)},${Math.round(base[1] * shade)},${Math.round(base[2] * shade)})`;
      }
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = this.edgeColor(f);
      ctx.stroke();
      this._recordFace(f, pts);
    }

    // 高亮边在所有面之后再描一遍，保证可见
    if (this.highlightEdges.size) {
      this._drawHighlightEdges(rotated);
    }
  };

  Renderer.prototype._recordFace = function (f, pts) {
    const minX = Math.max(0, Math.floor(Math.min(pts[0][0], pts[1][0], pts[2][0])));
    const maxX = Math.min(this.canvas.width - 1, Math.ceil(Math.max(pts[0][0], pts[1][0], pts[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(pts[0][1], pts[1][1], pts[2][1])));
    const maxY = Math.min(this.canvas.height - 1, Math.ceil(Math.max(pts[0][1], pts[1][1], pts[2][1])));
    for (let x = minX; x <= maxX; x += 4) {
      for (let y = minY; y <= maxY; y += 4) {
        if (this._pointInTri(x, y, pts)) {
          this.faceIdAt.set(x + ',' + y, f);
        }
      }
    }
  };

  Renderer.prototype._pointInTri = function (px, py, pts) {
    const d1 = (px - pts[1][0]) * (pts[0][1] - pts[1][1]) -
      (pts[0][0] - pts[1][0]) * (py - pts[1][1]);
    const d2 = (px - pts[2][0]) * (pts[1][1] - pts[2][1]) -
      (pts[1][0] - pts[2][0]) * (py - pts[2][1]);
    const d3 = (px - pts[0][0]) * (pts[2][1] - pts[0][1]) -
      (pts[2][0] - pts[0][0]) * (py - pts[0][1]);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  Renderer.prototype.pick = function (x, y) {
    for (let dx = -4; dx <= 4; dx += 4) {
      for (let dy = -4; dy <= 4; dy += 4) {
        const id = this.faceIdAt && this.faceIdAt.get((x + dx) + ',' + (y + dy));
        if (id !== undefined) return id;
      }
    }
    return null;
  };

  Renderer.prototype._drawHighlightEdges = function (rotated) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    for (const key of this.highlightEdges) {
      const [va, vb] = key.split('|').map(Number);
      const pa = this.project(rotated[va]);
      const pb = this.project(rotated[vb]);
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.lineWidth = this.hotEdges.has(key) ? 6 : 3.5;
      ctx.strokeStyle = this.hotEdges.has(key) ? '#ffd23d' : '#ff5d5d';
      ctx.stroke();
    }
    ctx.restore();
  };

  global.MeshRenderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
