// 用最小 DOM/Canvas 垫片在 Node 中加载 app.js，跑若干帧与一次扫描。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

class FakeContext {
  createImageData(w, h) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  putImageData() {}
  clearRect() {}
  fillRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  fill() {}
  fillText() {}
  arc() {}
}

const elements = {};
function makeEl(id) {
  const el = {
    id: id,
    value: {
      count: '3000', buckets: '16', tau: '0.12', hyst: '0.02',
    }[id] || '0',
    checked: true,
    textContent: '',
    innerHTML: '',
    width: 560,
    height: 130,
    listeners: {},
    addEventListener: function (name, fn) { this.listeners[name] = fn; },
    getContext: function () { return new FakeContext(); },
  };
  return el;
}

const ids = ['count', 'buckets', 'tau', 'hyst', 'smoothing', 'pause',
  'sweep', 'hud', 'bucketNo', 'migrationLog', 'refCanvas', 'testCanvas',
  'diffCanvas', 'bucketCanvas', 'sweepCanvas', 'sweepNote'];
const canvasSize = {
  refCanvas: [320, 200], testCanvas: [320, 200], diffCanvas: [320, 200],
  bucketCanvas: [560, 130], sweepCanvas: [720, 220],
};
ids.forEach(function (id) {
  elements[id] = makeEl(id);
  if (canvasSize[id]) {
    elements[id].width = canvasSize[id][0];
    elements[id].height = canvasSize[id][1];
  }
});

let rafCb = null;
global.document = {
  getElementById: function (id) {
    if (!elements[id]) elements[id] = makeEl(id);
    return elements[id];
  },
};
global.performance = { now: function () { return Date.now(); } };
let rafCount = 0;
global.requestAnimationFrame = function (cb) {
  rafCount += 1;
  if (rafCount <= 40) rafCb = cb;
};

globalThis.PBSim = require('../src/simulation.js');
globalThis.PBSort = require('../src/sort.js');
globalThis.PBFramebuffer = require('../src/framebuffer.js');
globalThis.PBEngine = require('../src/engine.js');
const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
eval(code);

let t = 0;
for (let i = 0; i < 40; i += 1) {
  t += 16.7;
  assert.doesNotThrow(function () { rafCb(t); });
}
assert.ok(elements.hud.innerHTML.includes('颜色 RMSE'));
assert.strictEqual(String(elements.bucketNo.textContent), '16');

// 模拟暂停与桶数调整。
elements.pause.listeners.click();
elements.buckets.value = '32';
elements.buckets.listeners.input();
assert.strictEqual(Number(elements.buckets.value), 32);
elements.pause.listeners.click();
rafCb(t + 16.7);
assert.strictEqual(String(elements.bucketNo.textContent), '32');

console.log('  ok - app.js 帧循环、HUD、扫描与控件无异常');
console.log('\n1 smoke test passed');
