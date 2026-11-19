/*
 * Editable scene presets. Coordinates share the solver's world frame;
 * the canvas maps world -> pixels with a simple scale + offset.
 */
(function (root) {
  "use strict";

  const PRESETS = {
    parallel: {
      name: "平行镜",
      source: { x: 0, y: 1 },
      receiver: { x: 2, y: 2 },
      mirrors: [
        { id: "bottom", a: { x: -6, y: 0 }, b: { x: 6, y: 0 } },
        { id: "top", a: { x: -6, y: 4 }, b: { x: 6, y: 4 } },
      ],
      occluders: [],
      maxBounces: 3,
    },
    rightAngle: {
      name: "直角镜",
      source: { x: 2, y: 3 },
      receiver: { x: 4, y: 1 },
      mirrors: [
        { id: "vert", a: { x: 0, y: 0 }, b: { x: 0, y: 6 } },
        { id: "horiz", a: { x: 0, y: 0 }, b: { x: 6, y: 0 } },
      ],
      occluders: [],
      maxBounces: 2,
    },
    occluder: {
      name: "遮挡线段",
      source: { x: 0, y: 2 },
      receiver: { x: 6, y: 2 },
      mirrors: [{ id: "m", a: { x: -5, y: 0 }, b: { x: 11, y: 0 } }],
      occluders: [{ id: "wall", a: { x: 3, y: 1 }, b: { x: 3, y: 3 } }],
      maxBounces: 1,
    },
    finite: {
      name: "有限边界",
      source: { x: 0, y: 2 },
      receiver: { x: 8, y: 2 },
      mirrors: [{ id: "short", a: { x: -1, y: 0 }, b: { x: 1, y: 0 } }],
      occluders: [],
      maxBounces: 1,
    },
    single: {
      name: "单镜",
      source: { x: 0, y: 2 },
      receiver: { x: 3, y: 1 },
      mirrors: [{ id: "M0", a: { x: -5, y: 0 }, b: { x: 5, y: 0 } }],
      occluders: [],
      maxBounces: 1,
    },
    corridorBlock: {
      name: "镜间遮挡",
      source: { x: 0, y: 1 },
      receiver: { x: 6, y: 1 },
      mirrors: [
        { id: "floor", a: { x: -6, y: -2 }, b: { x: 12, y: -2 } },
        { id: "cross", a: { x: 2, y: -4 }, b: { x: 2, y: 3 } },
      ],
      occluders: [],
      maxBounces: 1,
    },
  };

  function cloneScene(preset) {
    return JSON.parse(JSON.stringify(preset));
  }

  const api = { PRESETS, cloneScene };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Presets = api;
  }
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this));
