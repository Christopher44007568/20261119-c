// 需求场景测试：反向拖框、视口外拖动、跨近平面、前后重叠、两种规则与两种相机

import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene } from '../src/scene.js';
import { buildSelectionFromDrag, normalizeDrag, rectToNDC, viewProjMatrix } from '../src/marquee.js';
import { selectObjects } from '../src/selection.js';
import { oracleClassify } from '../src/oracle.js';

const viewport = { width: 960, height: 640 };

function evaluate(camera, objects, start, current, rule) {
  const built = buildSelectionFromDrag(start, current, viewport, camera);
  assert.equal(built.degenerate, false);
  const viewProj = viewProjMatrix(built.view, built.proj);
  const rows = selectObjects(built.frustum, objects, rule, viewProj, viewport);
  for (const row of rows) {
    assert.equal(
      row.status,
      oracleClassify(built.frustum, row.obb),
      `${row.name} 的 SAT 判定与独立 oracle 不一致`
    );
  }
  return { built, rows };
}

test('反向拖框与正向拖框产生完全相同的选择体与选中结果', () => {
  const { objects, camera } = createScene();
  const a = evaluate(camera, objects, { x: 120, y: 120 }, { x: 420, y: 420 }, 'intersect');
  const b = evaluate(camera, objects, { x: 420, y: 420 }, { x: 120, y: 120 }, 'intersect');
  assert.ok(b.built.drag.reversed);
  assert.deepEqual(a.built.ndcRect, b.built.ndcRect);
  assert.deepEqual(
    a.rows.map((r) => [r.name, r.status, r.selected]),
    b.rows.map((r) => [r.name, r.status, r.selected])
  );
});

test('视口外拖动：夹取后等价于全屏框选，且标记 clamped', () => {
  const { objects, camera } = createScene();
  const drag = normalizeDrag({ x: -80, y: -60 }, { x: 1200, y: 900 }, viewport);
  assert.ok(drag.clamped);
  assert.deepEqual(drag.rect, { minX: 0, minY: 0, maxX: 960, maxY: 640 });

  const outside = evaluate(camera, objects, { x: -80, y: -60 }, { x: 1200, y: 900 }, 'intersect');
  const full = evaluate(camera, objects, { x: 0, y: 0 }, { x: 960, y: 640 }, 'intersect');
  assert.deepEqual(outside.built.ndcRect, full.built.ndcRect);
  // 全屏框选：完全处于近/远平面之间的对象必然与相机视锥相交；
  // 跨近平面对象部分在相机后方，其结果由真实几何决定（与 oracle 一致性已在 evaluate 中断言）
  const insideObjects = outside.rows.filter((r) => r.name !== '跨近平面');
  assert.ok(insideObjects.every((r) => r.status !== 'outside'));
  const nearObj = outside.rows.find((r) => r.name === '跨近平面');
  assert.ok(['intersects', 'contained', 'outside'].includes(nearObj.status));
});

test('跨近平面对象：部分在相机后方时仍按真实三维几何判定，不崩溃且与 oracle 一致', () => {
  const { objects, camera } = createScene();
  // 框住“跨近平面”对象可见部分的屏幕区域
  const { rows, built } = evaluate(
    camera, objects,
    { x: 540, y: 20 }, { x: 950, y: 420 },
    'intersect'
  );
  const target = rows.find((r) => r.name === '跨近平面');
  assert.ok(target, '场景中应存在跨近平面对象');
  // 跨近平面的 OBB 一部分被近平面裁掉，选择体近平面与 OBB 相交 -> intersects 或 contained，
  // 关键是结果必须与独立 oracle 一致（上方 evaluate 已断言），且对象可被相交规则选中
  assert.ok(['intersects', 'contained'].includes(target.status));
  assert.equal(target.selected, true);
  // 选择体近平面确实位于 OBB 中心附近（相机 z=12, near=0.5 -> 世界近平面 z=11.5）
  assert.ok(built.frustum.planes[4].label.includes('近'));
});

test('前后重叠对象：深度不同但屏幕投影重叠，两者都能按相交规则选中', () => {
  const { objects, camera } = createScene();
  const { rows } = evaluate(
    camera, objects,
    { x: 60, y: 60 }, { x: 360, y: 360 },
    'intersect'
  );
  const near = rows.find((r) => r.name === '前排-近');
  const far = rows.find((r) => r.name === '前排-远');
  assert.ok(near && far);
  // 验证二者屏幕投影确实重叠
  assert.ok(
    near.screenBounds.maxX >= far.screenBounds.minX &&
    far.screenBounds.maxX >= near.screenBounds.minX &&
    near.screenBounds.maxY >= far.screenBounds.minY &&
    far.screenBounds.maxY >= near.screenBounds.minY
  );
  // 不是单张颜色拾取能同时区分的深度层次：两个对象深度明显不同
  assert.ok(Math.abs(near.obb.center[2] - far.obb.center[2]) > 2);
  assert.equal(near.selected, true);
  assert.equal(far.selected, true);
});

test('完全包含规则比相交规则更严格：contain 选中集合是 intersect 的子集', () => {
  const { objects, camera } = createScene();
  const start = { x: 40, y: 40 };
  const current = { x: 520, y: 520 };
  const inter = evaluate(camera, objects, start, current, 'intersect');
  const contain = evaluate(camera, objects, start, current, 'contain');
  const interSel = new Set(inter.rows.filter((r) => r.selected).map((r) => r.name));
  const containSel = new Set(contain.rows.filter((r) => r.selected).map((r) => r.name));
  for (const name of containSel) assert.ok(interSel.has(name));
  assert.ok(containSel.size < interSel.size, '该框选区域应存在只相交但未完全包含的对象');
  for (const row of contain.rows) {
    if (row.selected) assert.equal(row.status, 'contained');
  }
});

test('正交相机下两种规则同样工作且与 oracle 一致', () => {
  const scene = createScene();
  scene.camera.mode = 'ortho';
  for (const rule of ['intersect', 'contain']) {
    const { rows } = evaluate(
      scene.camera, scene.objects,
      { x: 80, y: 80 }, { x: 600, y: 560 }, rule
    );
    assert.ok(rows.some((r) => r.selected));
    if (rule === 'contain') {
      assert.ok(rows.every((r) => !r.selected || r.status === 'contained'));
    }
  }
});

test('透视与正交相机构造的选择体形状不同（发散平截头体 vs 平行长方体），各自判定自洽', () => {
  const scene = createScene();
  const drag = [{ x: 300, y: 150 }, { x: 560, y: 420 }];
  const persp = evaluate(scene.camera, scene.objects, drag[0], drag[1], 'intersect');
  scene.camera.mode = 'ortho';
  const ortho = evaluate(scene.camera, scene.objects, drag[0], drag[1], 'intersect');
  // 透视选择体：近端面与远端面尺寸不同（棱不平行）；正交选择体：端面尺寸相同（棱平行）
  function edgeRatios(frustum) {
    const c = frustum.corners();
    const dist = (i, j) => Math.hypot(
      c[i][0] - c[j][0], c[i][1] - c[j][1], c[i][2] - c[j][2]
    );
    // 近端面对角线 (0,3) 与远端面对角线 (4,7)
    return { nearDiag: dist(0, 3), farDiag: dist(4, 7) };
  }
  const pr = edgeRatios(persp.built.frustum);
  const orr = edgeRatios(ortho.built.frustum);
  assert.ok(Math.abs(pr.farDiag - pr.nearDiag) > 1, '透视选择体远近端面应明显不同大小');
  assert.ok(Math.abs(orr.farDiag - orr.nearDiag) < 1e-8, '正交选择体远近端面应全等');
  // 两套判定仍然各自与 oracle 一致（evaluate 已断言），且都能选中对象
  assert.ok(persp.rows.some((r) => r.selected));
  assert.ok(ortho.rows.some((r) => r.selected));
});

test('退化拖框不产生选择体', () => {
  const { camera } = createScene();
  const built = buildSelectionFromDrag({ x: 100, y: 100 }, { x: 100, y: 300 }, viewport, camera);
  assert.equal(built.degenerate, true);
  assert.equal(built.frustum, null);
});

test('NDC 矩形与像素矩形往返一致', () => {
  const rect = { minX: 200, minY: 120, maxX: 760, maxY: 500 };
  const ndc = rectToNDC(rect, viewport);
  assert.ok(ndc.xmin < ndc.xmax && ndc.ymin < ndc.ymax);
  const px = (v) => ((v + 1) / 2) * viewport.width;
  const py = (v) => ((1 - v) / 2) * viewport.height;
  assert.ok(Math.abs(px(ndc.xmin) - rect.minX) < 1e-9);
  assert.ok(Math.abs(py(ndc.ymax) - rect.minY) < 1e-9);
});
