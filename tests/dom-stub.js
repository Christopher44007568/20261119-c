/*
 * 极简 Canvas 2D / DOM 桩，仅用于在 Node 中执行 app.js 的渲染循环，
 * 捕获视图层与主控的运行时错误（不验证像素，像素路径由手工审查保证）。
 */
'use strict';

function makeGradient() { return { addColorStop() {} }; }

function makeContext() {
  const noop = () => {};
  return {
    canvas: { width: 360, height: 360 },
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
    globalAlpha: 1, lineDash: [],
    clearRect: noop, fillRect: noop, strokeRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, fill: noop, stroke: noop, fillText: noop,
    setLineDash: noop, save: noop, restore: noop, translate: noop, scale: noop,
    createLinearGradient: makeGradient, createRadialGradient: makeGradient,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: noop, measureText: (t) => ({ width: t.length * 6 })
  };
}

function makeCanvas(id, w, h) {
  return {
    id, width: w, height: h,
    style: {},
    getContext: () => makeContext(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    addEventListener: () => {}
  };
}

function makeElement(id) {
  return {
    id, innerHTML: '', textContent: '', className: '', value: 0,
    checked: false, disabled: false,
    classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    addEventListener: () => {}
  };
}

function install() {
  const canvases = {
    view3d: makeCanvas('view3d', 760, 380),
    topView: makeCanvas('topView', 360, 360),
    screenView: makeCanvas('screenView', 360, 360)
  };
  const elements = {};
  [
    'pipeStatus', 'planeStats', 'areaStats', 'vertexTable', 'inputTable',
    'sl-x', 'sl-y', 'sl-z', 'num-x', 'num-y', 'num-z',
    'chk-correct', 'chk-checker', 'chk-sweep'
  ].forEach((id) => { elements[id] = makeElement(id); });
  elements['chk-correct'].checked = true;

  const groups = [
    { cls: 'vertex-pick', n: 3, data: 'idx' },
    { cls: 'preset', n: 7, data: 'preset' }
  ];
  const allBtns = [];
  groups.forEach((g) => {
    for (let i = 0; i < g.n; i++) {
      allBtns.push(Object.assign(makeElement(g.cls + i), {
        dataset: { [g.data]: g.cls === 'preset'
          ? ['inside', 'nearCross', 'nearZeroW', 'behindCamera', 'multiPlane', 'rejectedNear', 'rejectedBehind'][i]
          : String(i) }
      }));
    }
  });

  global.self = global;
  global.window = { addEventListener: () => {} };
  global.requestAnimationFrame = () => 0;
  global.document = {
    getElementById: (id) => {
      if (canvases[id]) return canvases[id];
      return elements[id] || makeElement(id);
    },
    querySelectorAll: (sel) => {
      if (sel === '.vertex-pick') return allBtns.slice(0, 3);
      if (sel === '.preset') return allBtns.slice(3);
      return [];
    }
  };
  return { canvases, elements };
}

module.exports = { install, makeContext };
