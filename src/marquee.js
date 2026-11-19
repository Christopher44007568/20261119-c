// 鼠标框选矩形：支持任意方向拖拽（含反向）、视口外夹取，并转换为 NDC 矩形

import { clamp, multiply } from './math.js';
import { buildFrustum } from './frustum.js';

// 记录一次拖拽的原始端点与归一化结果
export function normalizeDrag(start, current, viewport) {
  const raw = {
    x0: start.x,
    y0: start.y,
    x1: current.x,
    y1: current.y,
  };
  const minX = clamp(Math.min(start.x, current.x), 0, viewport.width);
  const maxX = clamp(Math.max(start.x, current.x), 0, viewport.width);
  const minY = clamp(Math.min(start.y, current.y), 0, viewport.height);
  const maxY = clamp(Math.max(start.y, current.y), 0, viewport.height);

  const clamped =
    minX !== Math.min(start.x, current.x) ||
    maxX !== Math.max(start.x, current.x) ||
    minY !== Math.min(start.y, current.y) ||
    maxY !== Math.max(start.y, current.y);

  const direction =
    current.x < start.x
      ? current.y < start.y
        ? '左上（反向）'
        : '左下（水平反向）'
      : current.y < start.y
        ? '右上（垂直反向）'
        : '右下（正向）';

  return {
    raw,
    rect: { minX, minY, maxX, maxY },
    width: maxX - minX,
    height: maxY - minY,
    reversed: current.x < start.x || current.y < start.y,
    clamped,
    direction,
    degenerate: maxX - minX < 1e-6 || maxY - minY < 1e-6,
  };
}

// 像素矩形 -> NDC 矩形（y 轴翻转；NDC x/y ∈ [-1,1]）
export function rectToNDC(rect, viewport) {
  return {
    xmin: (rect.minX / viewport.width) * 2 - 1,
    xmax: (rect.maxX / viewport.width) * 2 - 1,
    // 像素 y 向下，NDC y 向上
    ymax: 1 - (rect.minY / viewport.height) * 2,
    ymin: 1 - (rect.maxY / viewport.height) * 2,
  };
}

// 一次完整框选的端到端流程
export function buildSelectionFromDrag(start, current, viewport, camera) {
  const drag = normalizeDrag(start, current, viewport);
  if (drag.degenerate) {
    return { drag, ndcRect: null, frustum: null, degenerate: true };
  }
  const ndcRect = rectToNDC(drag.rect, viewport);
  const view = camera.viewMatrix();
  const proj = camera.projectionMatrix(viewport.width, viewport.height);
  const frustum = buildFrustum(view, proj, camera.mode === 'ortho', ndcRect);
  return { drag, ndcRect, frustum, view, proj, degenerate: false };
}

export function viewProjMatrix(view, proj) {
  return multiply(proj, view);
}
