import assert from "node:assert/strict";
import test from "node:test";
import { createHarness } from "./helpers.js";

test("recompiles only programs whose expanded dependency graph changed", async () => {
  const { fileSystem, compiler, workbench } = createHarness();
  await workbench.initialize();
  const previousOther = workbench.getState().programs.find(
    (program) => program.id === "other",
  );
  const callsAfterInitialize = compiler.calls.length;

  fileSystem.write(
    "shaders/lib/common.glsl",
    "vec3 sharedColor(vec2 uv) { return vec3(uv, 0.5); } // changed",
  );
  const result = await workbench.reload(["shaders/lib/common.glsl"]);

  assert.equal(result.status, "committed");
  assert.deepEqual(result.affectedPrograms, ["main"]);
  assert.equal(compiler.calls.length, callsAfterInitialize + 1);
  assert.equal(compiler.calls.at(-1).programId, "main");
  const nextOther = workbench.getState().programs.find(
    (program) => program.id === "other",
  );
  assert.equal(nextOther.resourceVersion, previousOther.resourceVersion);
  assert.equal(workbench.getState().activeVersion, 2);
});

test("maps an injected include syntax error back to its file and line", async () => {
  const { fileSystem, compiler, workbench } = createHarness();
  await workbench.initialize();
  assert.equal(workbench.getState().activeVersion, 1);

  fileSystem.write(
    "shaders/lib/common.glsl",
    [
      "vec3 sharedColor(vec2 uv) {",
      "  return vec3(uv, 1.0);",
      "}",
      "void broken() { __SYNTAX_ERROR__ }",
    ].join("\n"),
  );
  const result = await workbench.reload(["shaders/lib/common.glsl"]);

  assert.equal(result.status, "rejected");
  assert.equal(result.activeVersion, 1);
  assert.equal(result.wouldBeVersion, 2);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].file, "shaders/lib/common.glsl");
  assert.equal(result.diagnostics[0].line, 4);
  assert.equal(result.diagnostics[0].generatedLine, 8);
  assert.equal(workbench.getState().activeVersion, 1);
  assert.equal(compiler.calls.filter((call) => call.programId === "main").length, 2);
});

test("rejects a partial multi-program update and reclaims staged resources", async () => {
  const { fileSystem, workbench, compiler } = createHarness(
    {},
    { failProgramIds: ["other"] },
  );
  await workbench.initialize();
  const previous = workbench.getState();

  fileSystem.write(
    "shaders/main.vert",
    [
      "#version 300 es",
      "precision highp float;",
      'out vec2 vUv;',
      "void main() {",
      "  vUv = vec2(0.0);",
      "  gl_Position = vec4(0.0);",
      "}",
      "// __LINK_MISMATCH__",
    ].join("\n"),
  );
  const result = await workbench.reload(["shaders/main.vert"]);

  assert.equal(result.status, "rejected");
  assert.deepEqual([...result.affectedPrograms].sort(), ["main", "other"]);
  assert.equal(workbench.getState().activeVersion, previous.activeVersion);
  assert.deepEqual(
    workbench.getState().programs.map((program) => program.resourceVersion),
    previous.programs.map((program) => program.resourceVersion),
  );
  assert.match(result.diagnostics[0].message, /Types of varying 'vUv' differ/);
  assert.equal(result.diagnostics[0].file, "shaders/main.vert");
  assert.equal(result.diagnostics[0].line, 3);

  const reclaimed = workbench.ledger.reclaimEvents();
  assert.equal(
    reclaimed.some((event) => event.reason === "failed-staging"),
    true,
  );
  assert.equal(workbench.ledger.liveCount, previous.programs.length);
  const staged = compiler.resources.at(-1);
  assert.equal(staged.disposed, true);
});

test("keeps a frame on one snapshot while an atomic swap happens", async () => {
  const { fileSystem, workbench } = createHarness();
  await workbench.initialize();
  const lease = workbench.beginFrame();
  const oldVersions = [...lease.snapshot.programs.values()].map(
    (bundle) => bundle.resourceVersion,
  );

  fileSystem.write(
    "shaders/lib/common.glsl",
    "vec3 sharedColor(vec2 uv) { return vec3(uv.yx, 1.0); }",
  );
  await workbench.reload(["shaders/lib/common.glsl"]);

  assert.equal(workbench.getState().activeVersion, 2);
  assert.equal(lease.snapshot.version, 1);
  assert.deepEqual(
    [...lease.snapshot.programs.values()].map(
      (bundle) => bundle.resourceVersion,
    ),
    oldVersions,
  );
  assert.equal(workbench.ledger.liveCount, 3);
  workbench.endFrame(lease);
  assert.equal(workbench.ledger.liveCount, 2);

  let renderedVersion = null;
  workbench.renderFrame((snapshot) => {
    renderedVersion = snapshot.version;
    assert.equal(snapshot.programs.get("main").resourceVersion.startsWith("2."), true);
  });
  assert.equal(renderedVersion, 2);
});

test("records resource reclamation when a program is removed", async () => {
  const { workbench } = createHarness();
  await workbench.initialize();
  const removedBundle = workbench.active.programs.get("other");
  const removedKey = removedBundle.key;

  await workbench.removePrograms(["other"]);

  assert.equal(workbench.getState().activeVersion, 2);
  assert.equal(workbench.getState().programs.length, 1);
  const event = workbench.ledger
    .reclaimEvents()
    .find((item) => item.key === removedKey);
  assert.equal(event.reason, "program-removed");
  assert.equal(removedBundle.disposed, true);
  assert.equal(workbench.ledger.liveCount, 1);
});

test("include cycles reject the whole update and retain the old frame", async () => {
  const { fileSystem, workbench } = createHarness();
  await workbench.initialize();
  fileSystem.write(
    "shaders/lib/common.glsl",
    ['#include "common.glsl"', "vec3 sharedColor(vec2 uv) {"].join("\n"),
  );

  const result = await workbench.reload(["shaders/lib/common.glsl"]);

  assert.equal(result.status, "rejected");
  assert.equal(result.diagnostics[0].code, "INCLUDE_CYCLE");
  assert.equal(result.diagnostics[0].file, "shaders/lib/common.glsl");
  assert.equal(result.diagnostics[0].line, 1);
  assert.equal(workbench.active.version, 1);
});
