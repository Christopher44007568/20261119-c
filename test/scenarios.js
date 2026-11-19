// Deterministic scenes reused by the solver tests and the validation report.

function singleMirror() {
  return {
    name: "single mirror + direct view",
    source: { x: 0, y: 2 },
    receiver: { x: 3, y: 1 },
    mirrors: [{ id: "M0", a: { x: -5, y: 0 }, b: { x: 5, y: 0 } }],
    occluders: [],
    maxBounces: 1,
  };
}

function parallelMirrors() {
  return {
    name: "two parallel mirrors (multi-bounce corridor)",
    source: { x: 0, y: 1 },
    receiver: { x: 2, y: 2 },
    mirrors: [
      { id: "bottom", a: { x: -6, y: 0 }, b: { x: 6, y: 0 } },
      { id: "top", a: { x: -6, y: 4 }, b: { x: 6, y: 4 } },
    ],
    occluders: [],
    maxBounces: 3,
  };
}

function rightAngle() {
  return {
    name: "right-angle corner mirrors",
    source: { x: 2, y: 3 },
    receiver: { x: 4, y: 1 },
    mirrors: [
      { id: "vert", a: { x: 0, y: 0 }, b: { x: 0, y: 6 } },
      { id: "horiz", a: { x: 0, y: 0 }, b: { x: 6, y: 0 } },
    ],
    occluders: [],
    maxBounces: 2,
  };
}

function occludedDirect() {
  return {
    name: "occluder blocks the direct line",
    source: { x: 0, y: 2 },
    receiver: { x: 6, y: 2 },
    mirrors: [{ id: "m", a: { x: -5, y: 0 }, b: { x: 11, y: 0 } }],
    occluders: [{ id: "wall", a: { x: 3, y: 1 }, b: { x: 3, y: 3 } }],
    maxBounces: 1,
  };
}

function finiteBoundary() {
  // A small mirror: the geometric one-bounce hit falls past its end.
  return {
    name: "finite mirror boundary rejects the candidate",
    source: { x: 0, y: 2 },
    receiver: { x: 8, y: 2 },
    mirrors: [{ id: "short", a: { x: -1, y: 0 }, b: { x: 1, y: 0 } }],
    occluders: [],
    maxBounces: 1,
  };
}

function collinearPair() {
  // Two collinear segments that overlap around x=2; both host the same
  // one-bounce reflection point, so the two sequences form one path.
  return {
    name: "collinear mirror pair (duplicate geometric paths)",
    source: { x: 0, y: 2 },
    receiver: { x: 3, y: 1 },
    mirrors: [
      { id: "left", a: { x: -5, y: 0 }, b: { x: 5, y: 0 } },
      { id: "right", a: { x: 1, y: 0 }, b: { x: 5, y: 0 } },
    ],
    occluders: [],
    maxBounces: 1,
  };
}

function mirrorBlocker() {
  // A vertical mirror crosses both the direct line of sight and the
  // floor-reflection route, so no valid path survives.
  return {
    name: "non-intended mirror blocks a candidate leg",
    source: { x: 0, y: 1 },
    receiver: { x: 6, y: 1 },
    mirrors: [
      { id: "floor", a: { x: -6, y: -2 }, b: { x: 12, y: -2 } },
      { id: "cross", a: { x: 2, y: -4 }, b: { x: 2, y: 3 } },
    ],
    occluders: [],
    maxBounces: 1,
  };
}

module.exports = {
  singleMirror,
  parallelMirrors,
  rightAngle,
  occludedDirect,
  finiteBoundary,
  collinearPair,
  mirrorBlocker,
};
