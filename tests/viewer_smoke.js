/* Node 冒烟测试：用最小 DOM 桩加载 viewer/app.js，
 * 校验 JS 端 BVH 遍历与 Python 导出的 trace / 暴力参照一致。
 * 运行：node tests/viewer_smoke.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.dirname(__dirname);
const sceneCode = fs.readFileSync(path.join(root, "viewer", "scene-data.js"), "utf8");
const appCode = fs.readFileSync(path.join(root, "viewer", "app.js"), "utf8");

function makeCtxStub() {
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === "canvas") return { width: 860, height: 640 };
        return typeof prop === "string" ? () => {} : undefined;
      },
      set() {
        return true;
      },
    }
  );
}

function makeElement() {
  return {
    classList: { add() {}, remove() {} },
    addEventListener() {},
    querySelectorAll: () => [],
    dataset: {},
    style: {},
    value: "0",
    max: "0",
    checked: true,
    innerHTML: "",
    textContent: "",
    clientWidth: 860,
    parentElement: { getBoundingClientRect: () => ({ width: 860 }) },
    getContext: () => makeCtxStub(),
  };
}

const sandbox = {};
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
sandbox.devicePixelRatio = 1;
sandbox.document = {
  getElementById: () => makeElement(),
  querySelectorAll: () => [],
};
sandbox.alert = () => {};
vm.createContext(sandbox);
vm.runInContext(sceneCode, sandbox);
vm.runInContext(appCode, sandbox);
vm.runInContext(
  "window.__test = { state, recomputeTrace, get currentTrace() { return currentTrace; } };",
  sandbox
);

const SCENE = sandbox.window.BVH_SCENE;
const testApi = sandbox.window.__test;
let failures = 0;

function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}

for (const strategy of ["sah", "median"]) {
  for (const geometry of ["original", "refit", "rebuilt"]) {
    testApi.state.strategy = strategy;
    testApi.state.geometry = geometry;
    testApi.state.ray = {
      origin: [...SCENE.ray.origin],
      direction: [...SCENE.ray.direction],
    };
    testApi.recomputeTrace();
    const trace = testApi.currentTrace;
    const expectedTree =
      geometry === "original"
        ? SCENE.trees[strategy]
        : geometry === "rebuilt"
          ? SCENE.refit[strategy].rebuilt
          : SCENE.refit[strategy];
    const expected = expectedTree.trace;

    assert(
      trace.order.length === expected.order.length,
      `${strategy}/${geometry} 访问步数 ${trace.order.length} != ${expected.order.length}`
    );
    assert(
      trace.nodesTested === expected.nodesTested,
      `${strategy}/${geometry} AABB 测试数不一致`
    );
    assert(
      trace.trisTested === expected.trisTested,
      `${strategy}/${geometry} 三角形测试数不一致`
    );
    const jh = trace.hit;
    const ph = expected.hit;
    if (ph === null) {
      assert(jh === null, `${strategy}/${geometry} 应为未命中`);
    } else {
      assert(jh !== null, `${strategy}/${geometry} 应有命中`);
      if (jh) {
        assert(jh.triId === ph.triId, `${strategy}/${geometry} 命中三角形不一致`);
        assert(Math.abs(jh.t - ph.t) < 1e-6, `${strategy}/${geometry} 命中距离不一致`);
      }
    }
    // JS 暴力参照必须与 BVH 一致
    if (trace.brute) {
      assert(jh && trace.brute.triId === jh.triId, `${strategy}/${geometry} 暴力参照不一致`);
    } else {
      assert(jh === null, `${strategy}/${geometry} 暴力参照应为空`);
    }
  }
}

// 自定义射线（网格上方斜射）也应与暴力一致
  testApi.state.geometry = "original";
testApi.state.ray = { origin: [-3, 3, -3], direction: [0.6, -0.5, 0.6] };
  testApi.recomputeTrace();
assert(testApi.currentTrace.hit !== null, "斜射射线应有命中");
assert(
  Math.abs(testApi.currentTrace.hit.t - testApi.currentTrace.brute.t) < 1e-7,
  "斜射射线 BVH/暴力 t 不一致"
);

// 平行于网格平面的射线应未命中，且 BVH 与暴力一致
testApi.state.ray = { origin: [-3, 0.5, 0], direction: [1, 0, 0] };
testApi.recomputeTrace();
assert(testApi.currentTrace.hit === null, "平行射线应未命中");
assert(testApi.currentTrace.brute === null, "平行射线暴力参照也应未命中");

if (failures) {
  console.error(`\nviewer_smoke: ${failures} 项失败`);
  process.exit(1);
}
console.log("viewer_smoke OK：JS 遍历与 Python 导出 trace、暴力参照全部一致");
