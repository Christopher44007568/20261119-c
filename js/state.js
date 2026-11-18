/*
 * state.js — 应用状态、视锥参数与测试预设
 * 顶点在眼睛空间编辑（相机在原点，看向 -z），投影后进入裁剪空间。
 */
(function (root) {
  'use strict';

  var DEFAULT_FRUSTUM = { fovyDeg: 60, aspect: 1, near: 2, far: 30 };

  var VERTEX_COLORS = [
    { r: 230, g: 70, b: 70 },
    { r: 70, g: 170, b: 230 },
    { r: 120, g: 210, b: 90 }
  ];

  function vert(x, y, z, i) {
    var c = VERTEX_COLORS[i];
    return { x: x, y: y, z: z, r: c.r, g: c.g, b: c.b, u: i === 0 ? 0 : i === 1 ? 1 : 0, v: i === 2 ? 1 : 0 };
  }

  // 每个预设都是眼睛空间中的三个顶点
  var PRESETS = {
    inside: {
      label: '全部在视锥内',
      verts: [vert(-1.5, -1.2, -6, 0), vert(1.6, -1.0, -7, 1), vert(0.2, 1.6, -9, 2)]
    },
    nearCross: {
      label: '单顶点穿过近平面',
      // V0 越过 z=-2 近平面（更靠近相机），V1/V2 留在内侧
      verts: [vert(0, 0, -0.6, 0), vert(-2.4, -1.8, -7, 1), vert(2.4, 1.8, -8, 2)]
    },
    nearZeroW: {
      label: 'w 接近零（顶点贴近相机平面）',
      // V0 的 -z 极小 => clip w = -z ≈ 0.001
      verts: [vert(0, 0, -0.001, 0), vert(-2.0, -1.5, -6, 1), vert(2.0, 1.5, -7, 2)]
    },
    behindCamera: {
      label: '顶点越过相机（w < 0）',
      // V0 位于相机后方 z>0，投影后 w 为负，需在齐次空间裁剪
      verts: [vert(0, 0, 1.5, 0), vert(-2.0, -1.5, -6, 1), vert(2.0, 1.5, -7, 2)]
    },
    multiPlane: {
      label: '同时跨越多个平面',
      // 巨大三角形同时穿出近、左、右、上、下多个平面
      verts: [vert(0, 0, -0.8, 0), vert(-14, -11, -12, 1), vert(14, 11, -16, 2)]
    },
    rejectedNear: {
      label: '整个三角形被拒绝（近平面前）',
      verts: [vert(-0.4, 0.2, -0.5, 0), vert(0.4, 0.2, -0.6, 1), vert(0, 0.8, -0.7, 2)]
    },
    rejectedBehind: {
      label: '整个三角形被拒绝（相机之后）',
      verts: [vert(-1, 0.5, 4, 0), vert(1, 0.5, 5, 1), vert(0, 1.5, 6, 2)]
    }
  };

  function cloneVerts(verts) {
    return verts.map(function (v) {
      return { x: v.x, y: v.y, z: v.z, r: v.r, g: v.g, b: v.b, u: v.u, v: v.v };
    });
  }

  function createState() {
    var first = PRESETS.nearCross;
    return {
      frustum: Object.assign({}, DEFAULT_FRUSTUM),
      eyeVerts: cloneVerts(first.verts),
      selected: 0,
      perspectiveCorrect: true,
      checker: false,
      sweep: false,
      sweepDir: -1,
      preset: 'nearCross'
    };
  }

  root.AppState = {
    DEFAULT_FRUSTUM: DEFAULT_FRUSTUM,
    VERTEX_COLORS: VERTEX_COLORS,
    PRESETS: PRESETS,
    cloneVerts: cloneVerts,
    createState: createState
  };
})(typeof self !== 'undefined' ? self : globalThis);
