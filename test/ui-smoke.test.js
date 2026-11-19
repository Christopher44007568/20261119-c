// 无头冒烟测试：用最小 DOM 桩驱动 app.js 的 pointer 事件状态机，
// 验证拖拽 -> 选择体 -> 选中 -> 面板渲染的完整链路在两种相机/两种规则下都能工作。

import test from 'node:test';
import assert from 'node:assert/strict';

function createDom() {
  const listeners = new Map();
  const canvas = {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 640 }),
    setPointerCapture() {},
    releasePointerCapture() {},
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    getContext: () => new Proxy({}, { get: () => () => {} }),
  };
  const radios = ['intersect', 'contain'].map((value) => ({
    value,
    checked: value === 'intersect',
    addEventListener(type, fn) {
      const key = `radio:${value}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push({ type, fn });
    },
  }));
  const elements = new Map();
  const makeEl = (id) => ({
    id,
    innerHTML: '',
    textContent: '',
    value: 'perspective',
    addEventListener(type, fn) {
      if (!listeners.has(`el:${id}`)) listeners.set(`el:${id}`, []);
      listeners.get(`el:${id}`).push({ type, fn });
    },
  });
  globalThis.document = {
    getElementById: (id) => {
      if (id === 'view') return canvas;
      if (!elements.has(id)) elements.set(id, makeEl(id));
      return elements.get(id);
    },
    querySelector: (sel) =>
      sel === 'input[name="rule"]:checked' ? radios.find((r) => r.checked) : null,
    querySelectorAll: (sel) => (sel === 'input[name="rule"]' ? radios : []),
  };
  const emit = (type, event) => listeners.get(type)?.forEach((fn) => fn(event));
  const emitEl = (id, type, event) =>
    listeners.get(`el:${id}`)?.filter((h) => h.type === type).forEach((h) => h.fn(event));
  const emitRadio = (value, type, event) =>
    listeners.get(`radio:${value}`)?.filter((h) => h.type === type).forEach((h) => h.fn(event));
  return { canvas, radios, emit, emitEl, emitRadio, elements };
}

test('UI 状态机：pointer 拖拽产生选择并渲染面板，oracle 全部一致', async () => {
  const dom = createDom();
  const { startApp } = await import('../src/app.js');
  startApp();

  dom.emit('pointerdown', { button: 0, clientX: 80, clientY: 100, pointerId: 1 });
  dom.emit('pointermove', { button: 0, clientX: 460, clientY: 430, pointerId: 1 });
  dom.emit('pointerup', { button: 0, clientX: 460, clientY: 430, pointerId: 1 });

  const summary = dom.elements.get('summary').textContent;
  assert.match(summary, /选中 \d+\/7 个对象/);
  assert.match(summary, /与独立几何判定全部一致/);
  const rowsHtml = dom.elements.get('objectRows').innerHTML;
  assert.match(rowsHtml, /前排-近/);
  assert.match(rowsHtml, /oracle/);
});

test('UI 状态机：反向拖框与视口外拖框都能完成选择', async () => {
  const dom = createDom();
  const { startApp } = await import('../src/app.js');
  startApp();

  dom.emit('pointerdown', { button: 0, clientX: 460, clientY: 440, pointerId: 1 });
  dom.emit('pointermove', { button: 0, clientX: 140, clientY: 140, pointerId: 1 });
  dom.emit('pointerup', { button: 0, clientX: 140, clientY: 140, pointerId: 1 });
  assert.match(dom.elements.get('summary').textContent, /与独立几何判定全部一致/);

  dom.emit('pointerdown', { button: 0, clientX: -80, clientY: -60, pointerId: 2 });
  dom.emit('pointermove', { button: 0, clientX: 1080, clientY: 730, pointerId: 2 });
  dom.emit('pointerup', { button: 0, clientX: 1080, clientY: 730, pointerId: 2 });
  assert.match(dom.elements.get('volumeInfo').innerHTML, /已夹取/);
});

test('UI 状态机：切换规则与相机会重新评估', async () => {
  const dom = createDom();
  const { startApp } = await import('../src/app.js');
  startApp();
  dom.emit('pointerdown', { button: 0, clientX: 40, clientY: 40, pointerId: 1 });
  dom.emit('pointerup', { button: 0, clientX: 600, clientY: 520, pointerId: 1 });

  const intersectSummary = dom.elements.get('summary').textContent;
  assert.match(intersectSummary, /规则=相交/);

  // 切换到“仅完全包含”
  dom.radios[0].checked = false;
  dom.radios[1].checked = true;
  dom.emitRadio('contain', 'change', {});
  assert.match(dom.elements.get('summary').textContent, /规则=完全包含/);

  // 切换到正交相机
  dom.emitEl('cameraMode', 'change', { target: { value: 'ortho' } });
  assert.match(dom.elements.get('volumeInfo').innerHTML, /正交长方体/);
  assert.match(dom.elements.get('summary').textContent, /与独立几何判定全部一致/);
});
