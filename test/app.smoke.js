/*
 * app.smoke.js — 在 Node 中用最小 DOM/Canvas 桩跑通 app.js 工作流。
 * 重点验证模式切换与双覆盖数据，不验证像素。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeCtx() {
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      return typeof prop === 'string' ? (..._args) => {} : undefined;
    },
    set() { return true; },
  });
}

function makeElement(id) {
  const listeners = {};
  return {
    id,
    style: {},
    dataset: {},
    value: 'mobius',
    width: 900,
    height: 760,
    clientWidth: 900,
    clientHeight: 760,
    innerHTML: '',
    classList: {
      _set: new Set(),
      toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    querySelectorAll() { return []; },
    getContext() { return makeCtx(); },
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 760 }; },
    _fire(type, ev) {
      for (const fn of listeners[type] || []) fn(ev || {});
    },
  };
}

const elements = {};
const ids = ['canvas', 'meshSelect', 'btnPropagate', 'btnLoop', 'btnCover',
  'btnFlip', 'btnReset', 'verdictCard', 'statsCard', 'loopCard', 'coverCard',
  'flipCard', 'detailCard', 'hint', 'view'];
for (const id of ids) elements[id] = makeElement(id);

const document = {
  getElementById: (id) => elements[id] || makeElement(id),
  createElement: () => makeElement('tmp'),
};
const sandbox = {
  document,
  window: {},
  console,
  Math,
  Set,
  Map,
  Int8Array,
  Int32Array,
  Uint8Array,
  Proxy,
  Number,
  devicePixelRatio: 1,
  addEventListener() {},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}
load('topology.js');
load('meshes.js');
load('render.js');
load('app.js');

const app = sandbox.window.OrientApp;
const assert = require('assert');

// 默认加载莫比乌斯
assert.strictEqual(app.state.prop.orientable, false, '初始莫比乌斯不可定向');
assert.ok(app.state.loop, '存在矛盾环');

// 切换三个示例网格
for (const [name, orientable, bLoops] of [
  ['torus', true, 0],
  ['annulus', true, 2],
  ['mobius', false, 1],
  ['klein', false, 0],
]) {
  app.loadMesh(name);
  assert.strictEqual(app.state.prop.orientable, orientable, name + ' 可定向性');
  const loops = sandbox.Topo.boundaryLoops(app.state.adj);
  assert.strictEqual(loops.length, bLoops, name + ' 边界环数');
}

// 回到莫比乌斯，验证各模式
app.loadMesh('mobius');
app.applyMode('loop');
assert.strictEqual(app.state.mode, 'loop');
assert.strictEqual(elements.loopCard.style.display, 'block');
app.applyMode('cover');
assert.strictEqual(app.state.coverProp.orientable, true, '覆盖可定向');
assert.strictEqual(elements.coverCard.style.display, 'block');
assert.strictEqual(app.state.cover.faces.length, app.state.adj.F * 2);
app.applyMode('flip');
assert.strictEqual(app.state.prop.orientable, false, '翻转后仍不可定向');
assert.ok(sandbox.Topo.shortestReversingLoop(app.state.adj), '翻转后矛盾环仍在');
assert.strictEqual(elements.flipCard.style.display, 'block');

// 圆环双覆盖应是两个连通分量
app.loadMesh('torus');
app.applyMode('cover');
assert.strictEqual(
  sandbox.Topo.componentCount(app.state.coverAdj), 2,
  '可定向网格的双覆盖有两个分量');

// 渲染调用不抛错（含炸开）
app.state.explode = 0.5;
app.draw();
app.state.explode = 0;
app.draw();

// 覆盖模式下点击面，走覆盖 sign 详情分支
app.applyMode('cover');
app.onFaceClick(0);
assert.strictEqual(app.state.selectedFace, 0);
app.draw();

// 莫比乌斯环步骤选择路径
app.loadMesh('mobius');
app.applyMode('loop');
app.onFaceClick(app.state.loop.steps[0].f);
assert.ok(app.state.loop.steps.length > 0);
app.draw();

console.log('app.js 工作流冒烟测试通过 ✓');
