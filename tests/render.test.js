/* node tests/render.test.js — 用 DOM 桩执行完整渲染循环与全部预设切换 */
'use strict';
const assert = require('assert');
const stub = require('./dom-stub.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

const dom = stub.install();

// 按 index.html 的顺序加载脚本；UMD 在 Node 下导出到 exports，
// 这里显式挂到 global 以模拟浏览器的全局命名空间
global.Clip = require('../js/clip.js');
global.Mat = require('../js/mat.js');
global.Raster = require('../js/raster.js');
require('../js/state.js');
global.Views = require('../js/views.js');
require('../js/app.js');

test('initial render populates status, stats and vertex tables', () => {
  assert.ok(dom.elements.pipeStatus.textContent.includes('输出'));
  assert.ok(dom.elements.planeStats.innerHTML.includes('near'));
  assert.ok(dom.elements.areaStats.innerHTML.includes('NDC'));
  assert.ok(dom.elements.vertexTable.innerHTML.includes('x_c'));
  assert.ok(dom.elements.inputTable.innerHTML.includes('w_c'));
});

test('all seven presets render without throwing', () => {
  const presetNames = ['inside', 'nearCross', 'nearZeroW', 'behindCamera',
    'multiPlane', 'rejectedNear', 'rejectedBehind'];
  presetNames.forEach((name) => {
    const state = global.AppState;
    const st = state.createState();
    st.eyeVerts = state.cloneVerts(state.PRESETS[name].verts);
    assert.doesNotThrow(() => {
      const P = global.Mat.perspective(st.frustum.fovyDeg * Math.PI / 180,
        st.frustum.aspect, st.frustum.near, st.frustum.far);
      const clipIn = st.eyeVerts.map((e) => global.Mat.eyeToClip(P, e));
      const res = global.Clip.clipPolygon(clipIn);
      const ctx = stub.makeContext();
      global.Views.drawScreen(ctx, 360, 360, res.vertices, res.rejected,
        { perspectiveCorrect: true, checker: true });
      global.Views.drawScreen(ctx, 360, 360, res.vertices, res.rejected,
        { perspectiveCorrect: false, checker: false });
      global.Views.drawTopView(stub.makeContext(), 360, 360, st.frustum,
        st.eyeVerts, 0);
      const cam = global.Views.makeCamera3D();
      const invP = global.Mat.invert4(P);
      const clippedEye = res.vertices.map((c) => {
        c.generated = !!c.onPlane;
        return global.Mat.clipToEye(invP, c);
      });
      global.Views.drawView3D(stub.makeContext(), 760, 380, cam,
        st.frustum, st.eyeVerts, clippedEye, 0);
    }, 'preset ' + name);
  });
});

test('rejected preset shows rejection status and empty vertex table', () => {
  const st = global.AppState.createState();
  st.eyeVerts = global.AppState.cloneVerts(global.AppState.PRESETS.rejectedBehind.verts);
  const P = global.Mat.perspective(st.frustum.fovyDeg * Math.PI / 180,
    st.frustum.aspect, st.frustum.near, st.frustum.far);
  const res = global.Clip.clipPolygon(st.eyeVerts.map((e) => global.Mat.eyeToClip(P, e)));
  assert.strictEqual(res.rejected, true);
  const ctx = stub.makeContext();
  const out = global.Views.drawScreen(ctx, 360, 360, res.vertices, true, {});
  assert.deepStrictEqual(out, []);
});

test('top view round-trips screen<->world near identity', () => {
  const f = global.AppState.DEFAULT_FRUSTUM;
  const ctx = stub.makeContext();
  const tr = global.Views.drawTopView(ctx, 360, 360, f,
    global.AppState.PRESETS.inside.verts, 0);
  const p = tr.toScreen(1.5, -7);
  const back = tr.toWorld(p.x, p.y);
  assert.ok(Math.abs(back.x - 1.5) < 1e-9);
  assert.ok(Math.abs(back.z - (-7)) < 1e-9);
});

test('3D projection keeps origin centered and depth positive', () => {
  const cam = global.Views.makeCamera3D();
  const origin = global.Views.project3D({ x: 0, y: 0, z: 0 }, cam, 760, 380);
  assert.ok(Math.abs(origin.x - 380) < 1e-9);
  assert.ok(Math.abs(origin.y - 190) < 1e-9);
  assert.ok(origin.depth > 0);
});

console.log('\n' + passed + ' render tests passed');
