// 示例场景：多个带旋转的 OBB，特意布置前后重叠与跨近平面的对象

import { axisAngle, multiply, vec3 } from './math.js';
import { OBB } from './obb.js';
import { Camera } from './camera.js';

function rotFromEuler(rx, ry, rz) {
  return multiply(
    multiply(axisAngle([0, 0, 1], rz), axisAngle([0, 1, 0], ry)),
    axisAngle([1, 0, 0], rx)
  );
}

function axesFromRotation(m) {
  return [
    [m[0], m[1], m[2]],
    [m[4], m[5], m[6]],
    [m[8], m[9], m[10]],
  ];
}

function makeOBB(name, center, halfExtents, euler, color) {
  const rot = rotFromEuler(euler[0], euler[1], euler[2]);
  return new OBB(name, vec3(...center), axesFromRotation(rot), halfExtents, color);
}

export function createScene() {
  const objects = [
    // 相机位于 z=16 看向原点，视线方向为 -Z，z 越大越靠近相机。
    // 前排两个对象，在视线方向（z）上深度不同但屏幕投影重叠，用于验证前后重叠都能按规则选中
    makeOBB('前排-近', [-2.2, 0.6, 8.8], [0.9, 0.9, 0.9], [0.3, 0.5, 0.2], '#ffb86b'),
    makeOBB('前排-远', [-2.2, 0.6, 2.0], [2.0, 2.0, 1.4], [-0.4, 0.2, 0.7], '#ff7b7b'),
    // 中景两个部分穿插的旋转盒
    makeOBB('中景-A', [1.8, 1.2, 3.0], [1.4, 0.7, 1.0], [0.6, 0.3, 0.9], '#7ec8ff'),
    makeOBB('中景-B', [1.4, 0.2, 2.6], [0.8, 1.3, 0.8], [-0.2, 0.8, -0.5], '#8be28b'),
    // 斜放的细长盒
    makeOBB('斜置长盒', [0.0, -1.8, -1.5], [2.2, 0.35, 0.5], [0.4, 0.0, 0.6], '#c99bff'),
    // 跨近视锥平面的对象：相机 z=16、near=0.5，即近平面 z=15.5；
    // 盒中心 z=14.7、z 半尺寸 1.0，深度方向恰好 4 个角点越过近平面到相机后方
    makeOBB('跨近平面', [0.8, 0.4, 14.7], [0.35, 0.45, 1.0], [0.0, 0.0, 0.5], '#ff6bd6'),
    // 贴近远平面的对象
    makeOBB('远端对象', [-3.6, -2.2, -40], [1.6, 1.2, 1.2], [0.2, 0.4, 0.1], '#6be7d6'),
  ];

  const camera = new Camera({
    eye: [0, 0, 16],
    target: [0, 0, 0],
    up: [0, 1, 0],
    fovY: Math.PI / 4,
    orthoHeight: 12,
    near: 0.5,
    far: 80,
    mode: 'perspective',
  });

  return { objects, camera };
}
