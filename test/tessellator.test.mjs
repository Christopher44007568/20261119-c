import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoSurface } from '../src/scene.js';
import { boundaryVertices } from '../src/tessellator.js';

// Perspective pinhole projector (lookAt + 60deg fov), so screen-space
// deviation is real and nonzero like in the WebGL app.
const EYE = [3.5, 4.5, 6.5];
const TARGET = [0, 0.3, 0];
const FOCAL = 500; // pixels
const FWD = norm3(sub3(TARGET, EYE));
const RIGHT = norm3(cross3(FWD, [0, 1, 0]));
const UP = cross3(RIGHT, FWD);
function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm3(a) {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
}
const project = (p) => {
  const d = sub3(p, EYE);
  const z = d[0] * FWD[0] + d[1] * FWD[1] + d[2] * FWD[2];
  if (z <= 0.01) return null; // behind camera
  const x = d[0] * RIGHT[0] + d[1] * RIGHT[1] + d[2] * RIGHT[2];
  const y = d[0] * UP[0] + d[1] * UP[1] + d[2] * UP[2];
  return [(FOCAL * x) / z + 640, (FOCAL * y) / z + 360];
};

const TOL = 0.75;

function makeSurface() {
  const { surface, pts, patches } = buildDemoSurface(TOL);
  surface.refit(project);
  return { surface, pts, patches };
}

// Extract the boundary vertex positions actually used by a mesh along
// one edge, by scanning triangle indices for vertices on that edge.
function usedBoundaryPositions(patch, edge) {
  const { positions, indices, uvs, stats } = patch.mesh;
  const { nu, nv } = stats;
  const onEdge = (vi) => {
    const u = uvs[vi * 2];
    const v = uvs[vi * 2 + 1];
    if (edge === 0) return u === 0;
    if (edge === 1) return u === 1;
    if (edge === 2) return v === 0;
    return v === 1;
  };
  const seen = new Set();
  for (const vi of indices) {
    if (onEdge(vi)) seen.add(vi);
  }
  const pts = [...seen].map((vi) => ({
    u: uvs[vi * 2],
    v: uvs[vi * 2 + 1],
    p: [positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]],
  }));
  const along = edge === 0 || edge === 1 ? 'v' : 'u';
  pts.sort((a, b) => a[along] - b[along]);
  return pts;
}

function assertSharedEdgeConsistent(surface, pa, ea, pb, eb) {
  // Same negotiated segment count on both sides.
  assert.equal(
    pa.edgeLevel[ea],
    pb.edgeLevel[eb],
    `edge level mismatch between patch ${pa.id}#${ea} and ${pb.id}#${eb}`,
  );
  // Same number of boundary vertices actually used.
  const va = usedBoundaryPositions(pa, ea);
  const vb = usedBoundaryPositions(pb, eb);
  const seg = 1 << pa.edgeLevel[ea];
  assert.equal(va.length, seg + 1, 'used boundary vertex count (a)');
  assert.equal(vb.length, seg + 1, 'used boundary vertex count (b)');
  // Identical positions (bitwise): no crack, no T-junction.
  for (let k = 0; k <= seg; k++) {
    // Edge parameter may run in opposite directions on the two patches.
    const a = va[k].p;
    const bFwd = vb[k].p;
    const bRev = vb[seg - k].p;
    const match = (x, y) => x[0] === y[0] && x[1] === y[1] && x[2] === y[2];
    assert.ok(
      match(a, bFwd) || match(a, bRev),
      `boundary vertex ${k} differs across shared edge`,
    );
  }
}

test('flat patches get far fewer triangles than curved ones', () => {
  const { surface, patches } = makeSurface();
  const s = surface.stats();
  const tri = (p) => p.mesh.stats.triangles;
  assert.ok(tri(patches.A) < 60, `flat patch A tris=${tri(patches.A)}`);
  assert.ok(tri(patches.C) < 60, `flat patch C tris=${tri(patches.C)}`);
  assert.ok(tri(patches.B) > 4 * tri(patches.A), 'curved B much denser than A');
  assert.ok(tri(patches.D) > 4 * tri(patches.C), 'curved D much denser than C');
  assert.ok(s.triangles > 0);
});

test('measured screen-space deviation stays within tolerance', () => {
  const { surface } = makeSurface();
  const s = surface.stats();
  for (const p of s.perPatch) {
    assert.ok(
      p.maxDevPx <= TOL,
      `patch ${p.id} deviation ${p.maxDevPx.toFixed(3)}px > tol ${TOL}px`,
    );
  }
});

test('shared edges negotiate identical tessellation (no T-junctions)', () => {
  const { surface, patches } = makeSurface();
  assertSharedEdgeConsistent(surface, patches.A, 1, patches.B, 0);
  assertSharedEdgeConsistent(surface, patches.C, 1, patches.D, 0);
  assertSharedEdgeConsistent(surface, patches.A, 3, patches.C, 2);
  assertSharedEdgeConsistent(surface, patches.B, 3, patches.D, 2);
});

test('interior control point move rebuilds only its own patch', () => {
  const { surface, patches } = makeSurface();
  const interiorPoint = patches.B.ctrl[2][2]; // interior to patch B
  interiorPoint[1] += 0.4;
  const rebuilt = surface.movePoints([interiorPoint], project);
  assert.deepEqual(
    rebuilt.map((p) => p.id).sort(),
    [patches.B.id],
    'only patch B should be re-tessellated',
  );
});

test('shared control point move rebuilds adjacent patches, keeps edges clean', () => {
  const { surface, pts, patches } = makeSurface();
  const shared = pts[3][3]; // shared by all 4 patches (corner meeting point)
  shared[1] += 0.5;
  const rebuilt = surface.movePoints([shared], project);
  const ids = rebuilt.map((p) => p.id).sort();
  assert.ok(ids.includes(patches.A.id));
  assert.ok(ids.includes(patches.B.id));
  assert.ok(ids.includes(patches.C.id));
  assert.ok(ids.includes(patches.D.id));
  // No T-junctions after the edit.
  assertSharedEdgeConsistent(surface, patches.A, 1, patches.B, 0);
  assertSharedEdgeConsistent(surface, patches.C, 1, patches.D, 0);
  assertSharedEdgeConsistent(surface, patches.A, 3, patches.C, 2);
  assertSharedEdgeConsistent(surface, patches.B, 3, patches.D, 2);
});

test('edge point move propagates to edge neighbors only via negotiation', () => {
  const { surface, pts, patches } = makeSurface();
  const edgePoint = pts[3][1]; // on the A|B shared edge (not a corner)
  edgePoint[1] += 0.6;
  const rebuilt = surface.movePoints([edgePoint], project);
  const ids = new Set(rebuilt.map((p) => p.id));
  assert.ok(ids.has(patches.A.id) && ids.has(patches.B.id));
  // Edges still consistent after the local update.
  assertSharedEdgeConsistent(surface, patches.A, 1, patches.B, 0);
  assertSharedEdgeConsistent(surface, patches.A, 3, patches.C, 2);
  assertSharedEdgeConsistent(surface, patches.B, 3, patches.D, 2);
});

test('boundary vertices match analytic curve samples', () => {
  const { surface, patches } = makeSurface();
  const p = patches.D;
  const edgeSegs = p.edgeLevel.map((l) => 1 << l);
  const { nu, nv } = p.mesh.stats;
  const expected = boundaryVertices(p.ctrl, nu, nv, edgeSegs, 0);
  const used = usedBoundaryPositions(p, 0);
  assert.equal(used.length, expected.length);
  for (let k = 0; k < used.length; k++) {
    // Mesh positions are float32; analytic samples are float64.
    for (let c = 0; c < 3; c++) {
      assert.ok(
        Math.abs(used[k].p[c] - expected[k][c]) < 1e-5,
        `boundary vertex ${k} coord ${c}: ${used[k].p[c]} vs ${expected[k][c]}`,
      );
    }
  }
});
