// Canvas 2D 简易三维渲染器：仅用于可视化展示，选择判定完全不经过渲染/像素。
// 画家算法 + 半透明面 + 线框，相机后方的面直接剔除。

import { transformPoint } from './math.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  clear() {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#10141c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.drawGrid();
  }

  drawGrid() {
    const { ctx, canvas } = this;
    ctx.strokeStyle = 'rgba(120,150,200,0.12)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  project(p, viewProj) {
    const cp = transformPoint(viewProj, p);
    // w<=0 表示点在相机后方
    return {
      x: (cp[0] * 0.5 + 0.5) * this.canvas.width,
      y: (1 - (cp[1] * 0.5 + 0.5)) * this.canvas.height,
      z: cp[2],
      behind: cp[2] > 1,
    };
  }

  drawBox({ corners, faces, edges, fillStyle, strokeStyle, lineWidth = 1.5, viewProj }) {
    const { ctx } = this;
    const projected = corners.map((p) => this.project(p, viewProj));
    if (projected.some((q) => !Number.isFinite(q.x))) return;

    const drawables = [];
    for (const face of faces) {
      if (face.some((idx) => projected[idx].behind)) continue; // 含相机后方点的面剔除
      const depth = face.reduce((s, idx) => s + projected[idx].z, 0) / face.length;
      drawables.push({ type: 'face', indices: face, depth });
    }
    drawables.sort((a, b) => b.depth - a.depth);

    for (const d of drawables) {
      ctx.beginPath();
      d.indices.forEach((idx, i) => {
        const q = projected[idx];
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }

    ctx.beginPath();
    for (const [i, j] of edges) {
      if (projected[i].behind || projected[j].behind) continue;
      ctx.moveTo(projected[i].x, projected[i].y);
      ctx.lineTo(projected[j].x, projected[j].y);
    }
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  drawOBB(obb, viewProj, { selected = false, dimmed = false } = {}) {
    this.drawBox({
      corners: obb.corners(),
      faces: obb.constructor.FACES ?? [
        [0, 1, 3, 2], [4, 6, 7, 5], [0, 2, 6, 4],
        [1, 5, 7, 3], [0, 4, 5, 1], [2, 3, 7, 6],
      ],
      edges: obb.constructor.EDGES,
      fillStyle: dimbedFill(obb.color, dimmed),
      strokeStyle: selected ? '#ffe66d' : dimbedStroke(obb.color, dimmed),
      lineWidth: selected ? 2.6 : 1.4,
      viewProj,
    });
  }

  drawFrustum(frustum, viewProj) {
    this.drawBox({
      corners: frustum.corners(),
      faces: frustum.constructor.FACES,
      edges: frustum.constructor.EDGES,
      fillStyle: 'rgba(110,200,255,0.10)',
      strokeStyle: 'rgba(120,220,255,0.95)',
      lineWidth: 2,
      viewProj,
    });
  }

  drawScreenRect(rect, reversed, clamped) {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = clamped ? '#ff9f43' : '#7fe0ff';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(rect.minX, rect.minY, rect.maxX - rect.minX, rect.maxY - rect.minY);
    ctx.setLineDash([]);
    ctx.fillStyle = clamped ? '#ff9f43' : '#7fe0ff';
    ctx.font = '12px monospace';
    const tag = `${reversed ? '反向 ' : ''}${clamped ? '已夹取到视口' : ''}`;
    if (tag.trim()) ctx.fillText(tag.trim(), rect.minX + 4, Math.max(14, rect.minY - 6));
    ctx.restore();
  }
}

function dimbedFill(hex, dimmed) {
  return dimmed ? withAlpha(hex, 0.06) : withAlpha(hex, 0.22);
}
function dimbedStroke(hex, dimmed) {
  return dimmed ? withAlpha(hex, 0.35) : withAlpha(hex, 0.95);
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
