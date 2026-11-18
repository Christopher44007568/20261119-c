"use strict";
// 用最小 DOM 桩执行完整 app.js，捕获集成错误（缺失元素、事件绑定、渲染流程）
const fs = require("fs");

function makeCtx2d() {
  const noop = () => {};
  return {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    stroke: noop, fill: noop, arc: noop, fillText: noop, setLineDash: noop,
  };
}

function makeEl(id) {
  const el = {
    id, children: [], listeners: {}, dataset: {}, className: "",
    textContent: "", innerHTML: "", value: "0", type: "",
    classList: { toggle: () => {} },
    style: {},
    appendChild(c) { this.children.push(c); },
    append(...cs) { cs.forEach(c => this.appendChild(c)); },
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
    fire(ev, e) { (this.listeners[ev] || []).forEach(f => f(e)); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 440, height: 440 }),
    getContext: () => makeCtx2d(),
    closest() { return this; },
  };
  return el;
}

const ids = ["cvAffine", "cvPersp", "diagSeg", "diagNote", "depthSliders",
  "btnTilt", "btnFlat", "btnWarped", "btnReset", "probeTable"];
const els = Object.fromEntries(ids.map(id => [id, makeEl(id)]));
els.cvAffine.width = els.cvAffine.height = 440;
els.cvPersp.width = els.cvPersp.height = 440;

global.document = {
  getElementById: id => els[id] || null,
  createElement: () => makeEl("dyn"),
  querySelectorAll: () => [],
};

eval(fs.readFileSync("app.js", "utf8"));

// 模拟交互：移动探针、切换对角线、点预设、拖角点
els.cvPersp.fire("mousemove", { clientX: 200, clientY: 220 });
els.cvAffine.fire("mousemove", { clientX: 150, clientY: 300 });
const diagBtn = makeEl("b"); diagBtn.dataset.diag = "B";
els.diagSeg.fire("click", { target: diagBtn });
els.btnWarped.fire("click");
els.cvAffine.fire("mousemove", { clientX: 220, clientY: 200 });
els.cvAffine.fire("mousedown", { clientX: 100, clientY: 100 });
els.cvAffine.fire("mousemove", { clientX: 130, clientY: 140 });
els.cvAffine.fire("mouseup", {});
els.cvPersp.fire("wheel", { clientX: 350, clientY: 80, deltaY: -100, preventDefault: () => {} });
els.btnTilt.fire("click");
els.btnFlat.fire("click");
els.btnReset.fire("click");
els.cvPersp.fire("mouseleave", {});

if (!els.probeTable.innerHTML.includes("将鼠标移到画布上")) {
  throw new Error("probe table not reset after mouseleave");
}
els.cvPersp.fire("mousemove", { clientX: 200, clientY: 220 });
for (const key of ["屏幕重心坐标", "插值 u/w", "插值 1/w", "解析平面求交 UV", "误差·透视校正", "误差·仿射"]) {
  if (!els.probeTable.innerHTML.includes(key)) throw new Error("probe missing: " + key);
}
console.log("SMOKE OK");
