// 体积选择核心：选择体（凸六面体）与旋转包围盒 OBB 的三维判定
// 不使用任何颜色/像素拾取，全部基于真实几何：
//   - 相交：分离轴定理 SAT（6 个选择体面法线 + 3 个 OBB 轴 + 18 个叉积轴）
//   - 完全包含：OBB 的 8 个角点全部位于选择体 6 个内侧半空间内

import { cross, dot, normalize, sub } from './math.js';
import { projectOBB, projectPoints, screenBounds } from './obb.js';

const PLANE_LABELS = ['左', '右', '下', '上', '近', '远'];
const OBB_LABELS = ['OBB-X', 'OBB-Y', 'OBB-Z'];

// 选择体棱方向：由角点与 12 条边索引计算（透视平截头体的面法线与棱方向并不重合，
// 因此 SAT 必须使用真实棱方向，而不是平面法线）
function frustumEdgeAxes(frustum) {
  const corners = frustum.corners();
  const seen = [];
  const axes = [];
  for (const [i, j] of frustum.constructor.EDGES) {
    const dir = normalize(sub(corners[j], corners[i]));
    if (seen.some((s) => Math.abs(dot(s, dir)) > 1 - 1e-10)) continue;
    seen.push(dir);
    axes.push(dir);
  }
  return axes;
}

function classifyOBB(frustum, obb, eps = 1e-7) {
  // 1) 完全包含：OBB 8 角点全部在选择体内
  const corners = obb.corners();
  let allInside = true;
  let worst = -Infinity;
  let worstPlane = null;
  for (const p of corners) {
    for (let i = 0; i < frustum.planes.length; i++) {
      const pl = frustum.planes[i];
      const dist = dot(pl.normal, p) + pl.d;
      if (dist < -eps) {
        allInside = false;
        if (dist > worst) {
          worst = dist;
          worstPlane = i;
        }
      }
    }
  }
  if (allInside) {
    return {
      status: 'contained',
      reason: `OBB 8 个角点全部位于选择体 6 个内侧半空间内（完全包含，最差余量 ${Math.min(
        ...corners.flatMap((p) =>
          frustum.planes.map((pl) => dot(pl.normal, p) + pl.d)
        )
      ).toFixed(3)} ≥ 0）`,
      separation: null,
    };
  }

  // 2) SAT 相交判定
  const fCorners = frustum.corners();
  const axes = [];
  frustum.planes.forEach((pl, i) => axes.push({ axis: pl.normal, label: `选择体${PLANE_LABELS[i]}面法线` }));
  obb.axes.forEach((a, i) => axes.push({ axis: a, label: OBB_LABELS[i] + '轴' }));
  // 关键：两个一般凸多面体的叉积分离体候选 = 棱方向 × 棱方向
  const fEdgeAxes = frustumEdgeAxes(frustum);
  for (let i = 0; i < fEdgeAxes.length; i++) {
    for (let j = 0; j < 3; j++) {
      const ax = cross(fEdgeAxes[i], obb.axes[j]);
      if (dot(ax, ax) < 1e-14) continue;
      axes.push({
        axis: normalize(ax),
        label: `叉积轴(选择体棱#${i}×${OBB_LABELS[j]})`,
      });
    }
  }

  let bestGap = -Infinity;
  let bestAxis = null;
  for (const { axis, label } of axes) {
    const [fMin, fMax] = projectPoints(fCorners, axis);
    const [oMin, oMax] = projectOBB(obb, axis);
    const gap = Math.max(fMin - oMax, oMin - fMax);
    if (gap > bestGap) {
      bestGap = gap;
      bestAxis = label;
    }
    if (gap > eps) {
      return {
        status: 'outside',
        reason: `SAT 在「${label}」上投影分离，间隙 ${gap.toFixed(3)} > 0，两凸体不相交`,
        separation: { gap, axis: label },
      };
    }
  }

  // 3) 未完全包含但所有轴投影重叠 -> 相交
  const outsideInfo = worstPlane !== null
    ? `；最接近越界的是选择体${PLANE_LABELS[worstPlane]}面，角点穿出距离 ${(-worst).toFixed(3)}`
    : '';
  return {
    status: 'intersects',
    reason: `共 ${axes.length} 条候选分离轴（选择体 6 面法线 + OBB 3 轴 + 选择体棱方向×OBB 轴的叉积轴）投影全部重叠（最大间隙 ${bestGap.toFixed(3)} ≤ 0），但角点未全部在内，判定为相交${outsideInfo}`,
    separation: { gap: bestGap, axis: bestAxis },
  };
}

// rule: 'contain'（仅完全包含）| 'intersect'（相交即选，含完全包含）
export function selectObjects(frustum, objects, rule, viewProj, viewport, eps = 1e-7) {
  return objects.map((obb) => {
    const result = classifyOBB(frustum, obb, eps);
    const selected =
      rule === 'contain' ? result.status === 'contained' : result.status !== 'outside';
    const bounds = screenBounds(obb, viewProj, viewport.width, viewport.height);
    return {
      name: obb.name,
      status: result.status,
      selected,
      reason: result.reason,
      separation: result.separation,
      screenBounds: bounds,
      obb,
    };
  });
}

export { classifyOBB };
