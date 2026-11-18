// Adaptive Bezier surface: a graph of bicubic patches with shared-edge
// level negotiation, screen-space driven tessellation, and local
// re-tessellation when control points move.

import {
  analyzePatch,
  gridSize,
  tessellatePatch,
} from './tessellator.js';

let nextPatchId = 0;

export class Patch {
  // ctrl: 4x4 array of control points. Points are plain [x,y,z] arrays
  // and may be SHARED with neighboring patches (that is what keeps
  // adjacent patches C0 and lets edits propagate).
  constructor(ctrl) {
    this.id = nextPatchId++;
    this.ctrl = ctrl;
    this.analysis = null; // per-patch level request
    this.edgeLevel = [0, 0, 0, 0]; // negotiated edge levels
    this.mesh = null;
    this.dirty = true;
  }
}

export class Surface {
  constructor(tolPx = 0.75) {
    this.tolPx = tolPx;
    this.patches = [];
    this.links = []; // { a, ea, b, eb } : edge ea of a coincides with edge eb of b
    this.lastRebuild = [];
  }

  addPatch(ctrl) {
    const patch = new Patch(ctrl);
    this.patches.push(patch);
    return patch;
  }

  // Declare that edge ea of patch a and edge eb of patch b are the same
  // geometric curve (their control points are shared objects).
  link(a, ea, b, eb) {
    this.links.push({ a, ea, b, eb });
  }

  // Full re-tessellation: camera or tolerance changed.
  refit(project) {
    for (const p of this.patches) p.dirty = true;
    return this.update(project);
  }

  // Local update after control points moved. `points` are the mutated
  // control-point arrays; only patches referencing them are re-analyzed,
  // and neighbors are only rebuilt if a negotiated edge level changes.
  movePoints(points, project) {
    const affected = new Set();
    for (const p of this.patches) {
      let hit = false;
      for (let i = 0; i < 4 && !hit; i++) {
        for (let j = 0; j < 4 && !hit; j++) {
          if (points.includes(p.ctrl[i][j])) hit = true;
        }
      }
      if (hit) {
        p.dirty = true;
        affected.add(p);
      }
    }
    return this.update(project, affected);
  }

  // Core update: re-analyze dirty patches, negotiate edge levels, and
  // rebuild only what changed. Returns the list of rebuilt patches.
  update(project, dirtySet = null) {
    const dirty = dirtySet
      ? new Set(dirtySet)
      : new Set(this.patches.filter((p) => p.dirty));

    // Re-analyze dirty patches and remember old negotiated levels.
    const oldLevels = new Map();
    for (const p of dirty) {
      oldLevels.set(p, p.edgeLevel.slice());
      p.analysis = analyzePatch(p.ctrl, project, this.tolPx);
    }

    // Negotiate: a shared edge gets the max of both requests. Raising
    // one side never changes the other side's own request, so a single
    // pass over the links is enough.
    const negotiated = new Map(); // patch -> edgeLevel[]
    for (const p of this.patches) {
      negotiated.set(
        p,
        p.analysis ? p.analysis.edgeLevel.slice() : p.edgeLevel.slice(),
      );
    }
    for (const { a, ea, b, eb } of this.links) {
      const la = negotiated.get(a)[ea];
      const lb = negotiated.get(b)[eb];
      const l = Math.max(la, lb);
      negotiated.get(a)[ea] = l;
      negotiated.get(b)[eb] = l;
    }

    // Any patch whose negotiated levels changed must be (re)built, even
    // if its own control points did not move (neighbor-driven update).
    for (const p of this.patches) {
      const next = negotiated.get(p);
      const prev = p.dirty ? oldLevels.get(p) || p.edgeLevel : p.edgeLevel;
      const changed = p.dirty || next.some((l, e) => l !== prev[e]);
      if (changed) {
        p.edgeLevel = next;
        dirty.add(p);
      }
    }

    // Rebuild meshes for dirty patches only.
    const rebuilt = [];
    for (const p of dirty) {
      const { nu, nv } = gridSize(p.analysis, p.edgeLevel);
      const edgeSegs = p.edgeLevel.map((l) => 1 << l);
      p.mesh = tessellatePatch(p.ctrl, nu, nv, edgeSegs, project);
      p.dirty = false;
      rebuilt.push(p);
    }
    this.lastRebuild = rebuilt;
    return rebuilt;
  }

  stats() {
    let triangles = 0;
    let maxDevPx = 0;
    const perPatch = this.patches.map((p) => {
      const s = p.mesh ? p.mesh.stats : null;
      if (s) {
        triangles += s.triangles;
        maxDevPx = Math.max(maxDevPx, s.maxDevPx);
      }
      return { id: p.id, edgeLevel: p.edgeLevel.slice(), ...s };
    });
    return { triangles, maxDevPx, perPatch };
  }
}
