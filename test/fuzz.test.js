// 大规模模糊对拍：SAT 判定（selection.js）与独立几何 oracle（oracle.js）
// 两套完全不同的算法必须在数千个随机选择体/OBB 配置上给出相同分类。

import test from 'node:test';
import assert from 'node:assert/strict';
import { axisAngle, multiply, vec3, transformPoint } from '../src/math.js';
import { OBB } from '../src/obb.js';
import { Camera } from '../src/camera.js';
import { buildSelectionFromDrag, viewProjMatrix } from '../src/marquee.js';
import { classifyOBB } from '../src/selection.js';
import { oracleClassify } from '../src/oracle.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomOBB(rng, name) {
  const center = vec3((rng() - 0.5) * 16, (rng() - 0.5) * 12, 2 + rng() * 30);
  const rot = multiply(
    multiply(axisAngle([0, 0, 1], rng() * Math.PI), axisAngle([0, 1, 0], rng() * Math.PI)),
    axisAngle([1, 0, 0], rng() * Math.PI)
  );
  const axes = [
    [rot[0], rot[1], rot[2]],
    [rot[4], rot[5], rot[6]],
    [rot[8], rot[9], rot[10]],
  ];
  const half = [0.3 + rng() * 2.4, 0.3 + rng() * 2.4, 0.3 + rng() * 2.4];
  return new OBB(name, center, axes, half);
}

function randomDrag(rng, viewport) {
  // 允许端点落在视口外，覆盖夹取路径
  const start = { x: (rng() - 0.2) * viewport.width, y: (rng() - 0.2) * viewport.height };
  const current = { x: (rng() - 0.2) * viewport.width, y: (rng() - 0.2) * viewport.height };
  return { start, current };
}

test('模糊对拍：透视相机 1500 组随机框选，SAT 与 oracle 分类一致', () => {
  const rng = mulberry32(20261119);
  const viewport = { width: 960, height: 640 };
  const camera = new Camera({
    eye: [0, 0, 12], target: [0, 0, 0], near: 0.5, far: 60, mode: 'perspective',
  });
  let checked = 0;
  const tally = { contained: 0, intersects: 0, outside: 0 };
  for (let i = 0; i < 1500; i++) {
    const obb = randomOBB(rng, `obb-${i}`);
    const { start, current } = randomDrag(rng, viewport);
    const built = buildSelectionFromDrag(start, current, viewport, camera);
    if (built.degenerate) continue;
    const sat = classifyOBB(built.frustum, obb).status;
    const oracle = oracleClassify(built.frustum, obb);
    assert.equal(
      sat,
      oracle,
      `第 ${i} 组不一致：SAT=${sat} oracle=${oracle}，drag=${JSON.stringify({ start, current })}`
    );
    tally[sat]++;
    checked++;
  }
  assert.ok(checked > 1000);
  assert.ok(tally.intersects > 20, '应覆盖相交但不包含情形');
  assert.ok(tally.outside > 100, '应覆盖大量分离情形');
});

test('定向用例：大框完全包含小 OBB 时判定 contained，小框仅相交时判定 intersects', () => {
  const viewport = { width: 960, height: 640 };
  const camera = new Camera({
    eye: [0, 0, 16], target: [0, 0, 0], near: 0.5, far: 80, mode: 'perspective',
  });
  // 视野中部的小 OBB
  const obb = new OBB(
    'small',
    vec3(0, 0, 4),
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [0.5, 0.5, 0.5]
  );
  // 全屏框必然完全包含（对象在近远平面之间且远离侧面）
  const full = buildSelectionFromDrag(
    { x: 0, y: 0 }, { x: viewport.width, y: viewport.height }, viewport, camera
  );
  assert.equal(classifyOBB(full.frustum, obb).status, 'contained');
  assert.equal(oracleClassify(full.frustum, obb), 'contained');

  // 取对象屏幕投影中心的一个很小的框 -> 只能相交，不能完全包含
  const vpm = viewProjMatrix(full.view, full.proj);
  const ndc = transformPoint(vpm, obb.center);
  const center = {
    x: (ndc[0] * 0.5 + 0.5) * viewport.width,
    y: (1 - (ndc[1] * 0.5 + 0.5)) * viewport.height,
  };
  const tiny = buildSelectionFromDrag(
    { x: center.x - 3, y: center.y - 3 },
    { x: center.x + 3, y: center.y + 3 },
    viewport,
    camera
  );
  assert.equal(tiny.degenerate, false);
  assert.equal(classifyOBB(tiny.frustum, obb).status, 'intersects');
  assert.equal(oracleClassify(tiny.frustum, obb), 'intersects');
});

test('模糊对拍：正交相机 800 组随机框选，SAT 与 oracle 分类一致', () => {
  const rng = mulberry32(99);
  const viewport = { width: 960, height: 640 };
  const camera = new Camera({
    eye: [0, 0, 12], target: [0, 0, 0], near: 0.5, far: 60,
    orthoHeight: 14, mode: 'ortho',
  });
  let checked = 0;
  for (let i = 0; i < 800; i++) {
    const obb = randomOBB(rng, `o-${i}`);
    const { start, current } = randomDrag(rng, viewport);
    const built = buildSelectionFromDrag(start, current, viewport, camera);
    if (built.degenerate) continue;
    assert.equal(
      classifyOBB(built.frustum, obb).status,
      oracleClassify(built.frustum, obb)
    );
    checked++;
  }
  assert.ok(checked > 500);
});

test('包含关系单调性：全屏框选（近远平面之间）应包含所有场景内对象', () => {
  const rng = mulberry32(7);
  const viewport = { width: 960, height: 640 };
  const camera = new Camera({ mode: 'perspective', eye: [0, 0, 12], near: 0.5, far: 60 });
  const built = buildSelectionFromDrag(
    { x: 0, y: 0 },
    { x: viewport.width, y: viewport.height },
    viewport,
    camera
  );
  for (let i = 0; i < 50; i++) {
    const obb = randomOBB(rng, `full-${i}`);
    // 位于近远平面之间的对象，全屏选择体必然完全包含
    if (obb.center[2] > -48 && obb.center[2] < 11.5 - 1) {
      assert.equal(oracleClassify(built.frustum, obb), classifyOBB(built.frustum, obb).status);
    }
  }
});
