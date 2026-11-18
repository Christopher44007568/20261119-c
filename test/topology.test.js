import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSample } from '../src/mesh/samples.js';
import { analyzeMesh, buildDefectView } from '../src/mesh/analyze.js';
import {
  buildFaceCorrespondence,
  capBoundaryLoops,
  flipFaces,
  removeFaces,
  splitNonManifoldBranches,
  weldDuplicateVertices,
} from '../src/mesh/repairs.js';
import { exportOBJ, parseOBJ } from '../src/mesh/io.js';

function sampleMesh(id) {
  return loadSample(id).mesh;
}

function defect(analysis, key) {
  return buildDefectView(analysis).find((item) => item.key === key);
}

test('touching shells expose a shared non-manifold edge without deleting branches', () => {
  const mesh = sampleMesh('shells');
  const analysis = analyzeMesh(mesh);
  assert.equal(analysis.kind, 'NON_MANIFOLD');
  assert.equal(analysis.stats.nonManifoldEdges, 1);
  assert.equal(analysis.stats.boundaryEdges, 0);
  assert.deepEqual(defect(analysis, 'nonmanifold').groups[0].faces, [0, 1, 4, 5]);

  const split = splitNonManifoldBranches(mesh, analysis);
  assert.equal(split.mesh.faces.length, mesh.faces.length);
  assert.equal(split.copiedVertices, 2);
  assert.equal(split.changed, 1);

  const splitAnalysis = analyzeMesh(split.mesh);
  assert.equal(splitAnalysis.kind, 'CLOSED_SOLID');
  assert.equal(splitAnalysis.stats.nonManifoldEdges, 0);
  assert.equal(splitAnalysis.stats.components, 2);
  assert.equal(splitAnalysis.duplicateGroups.filter((group) => !group.intentional).length, 0);
  assert.deepEqual(
    buildFaceCorrespondence(split.mesh).map((entry) => entry.status),
    Array(8).fill('preserved'),
  );

  const flipped = flipFaces(
    split.mesh,
    splitAnalysis.normalGroups.flatMap((group) => group.faces),
  );
  const finalAnalysis = analyzeMesh(flipped.mesh);
  assert.equal(finalAnalysis.kind, 'CLOSED_SOLID');
  assert.equal(finalAnalysis.stats.flippedFaces, 0);
});

test('open sheet separates safe repairs from user decisions', () => {
  const mesh = sampleMesh('sheet');
  const analysis = analyzeMesh(mesh);
  assert.equal(analysis.kind, 'OPEN_SURFACE');
  assert.equal(analysis.stats.duplicateGroups, 3);
  assert.equal(analysis.stats.isolatedFaces, 1);
  assert.equal(analysis.stats.normalGroups, 1);
  assert.equal(analysis.stats.boundaryLoops, 3);

  const welded = weldDuplicateVertices(mesh, analysis);
  const weldedAnalysis = analyzeMesh(welded.mesh);
  assert.equal(welded.changed, 3);
  assert.equal(weldedAnalysis.stats.duplicateGroups, 0);
  assert.equal(weldedAnalysis.stats.components, 2);

  const flipped = flipFaces(
    welded.mesh,
    weldedAnalysis.normalGroups.flatMap((group) => group.faces),
  );
  const flippedAnalysis = analyzeMesh(flipped.mesh);
  assert.equal(flippedAnalysis.stats.normalGroups, 0);

  const removed = removeFaces(
    flipped.mesh,
    flippedAnalysis.isolatedFaces,
    welded.removed || [],
  );
  const removedAnalysis = analyzeMesh(removed.mesh);
  assert.equal(removedAnalysis.stats.isolatedFaces, 0);
  assert.equal(removedAnalysis.stats.boundaryLoops, 1);
  assert.equal(
    buildFaceCorrespondence(removed.mesh, removed.removed).find(
      (entry) => entry.sourceFace === 12,
    ).status,
    'isolated',
  );

  const capped = capBoundaryLoops(removed.mesh, removedAnalysis);
  const cappedAnalysis = analyzeMesh(capped.mesh);
  assert.equal(cappedAnalysis.kind, 'CLOSED_SOLID');
  assert.equal(cappedAnalysis.stats.boundaryLoops, 0);
  assert.equal(capped.addedFaces, 10);
  assert.equal(capped.mesh.faceMap.filter((value) => value === null).length, 10);
  const correspondence = buildFaceCorrespondence(capped.mesh, removed.removed);
  assert.equal(
    correspondence.filter((entry) => entry.status === 'preserved').length,
    12,
  );
  assert.equal(
    correspondence.find((entry) => entry.sourceFace === 12).status,
    'isolated',
  );
});

test('OBJ export round-trips vertices and triangles', () => {
  const mesh = sampleMesh('shells');
  const text = exportOBJ(mesh, { mode: 'renderable' });
  assert.match(text, /# source-faces: 8/);
  const imported = parseOBJ(text, 'roundtrip.obj');
  assert.equal(imported.positions.length, mesh.positions.length);
  assert.equal(imported.faces.length, mesh.faces.length);
  assert.equal(analyzeMesh(imported).stats.nonManifoldEdges, 1);
});
