import assert from "node:assert/strict";
import test from "node:test";
import { IncludeResolver } from "../src/core/include-resolver.js";
import { VirtualFileSystem } from "../src/core/virtual-fs.js";

test("expands nested local includes and preserves original line mappings", () => {
  const files = new VirtualFileSystem({
    "shaders/main.frag": [
      "#version 300 es",
      '#include "lib/a.glsl"',
      "void main() {}",
    ].join("\n"),
    "shaders/lib/a.glsl": ["float a() { return 1.0; }", '#include "b.glsl"'].join(
      "\n",
    ),
    "shaders/lib/b.glsl": "float b() { return 2.0; }",
  });
  const resolution = new IncludeResolver(files).resolve("shaders/main.frag");

  assert.equal(resolution.ok, true);
  assert.deepEqual(resolution.dependencies.sort(), [
    "shaders/lib/a.glsl",
    "shaders/lib/b.glsl",
    "shaders/main.frag",
  ]);
  assert.match(resolution.source, /float b\(\)/);
  assert.equal(resolution.mappings[1].file, "shaders/lib/a.glsl");
  assert.equal(resolution.mappings[1].line, 1);
  assert.equal(resolution.mappings[2].file, "shaders/lib/b.glsl");
  assert.equal(resolution.mappings[3].file, "shaders/main.frag");
  assert.equal(resolution.mappings[3].line, 3);
});

test("reports an include cycle at the original include directive", () => {
  const files = new VirtualFileSystem({
    "shaders/main.frag": ['#include "lib/a.glsl"', "void main() {}"].join("\n"),
    "shaders/lib/a.glsl": ["float a() { return 1.0; }", '#include "b.glsl"'].join(
      "\n",
    ),
    "shaders/lib/b.glsl": ['#include "a.glsl"'].join("\n"),
  });
  const resolution = new IncludeResolver(files).resolve("shaders/main.frag");

  assert.equal(resolution.ok, false);
  assert.equal(resolution.diagnostics.length, 1);
  assert.deepEqual(
    {
      file: resolution.diagnostics[0].file,
      line: resolution.diagnostics[0].line,
      code: resolution.diagnostics[0].code,
    },
    { file: "shaders/lib/b.glsl", line: 1, code: "INCLUDE_CYCLE" },
  );
  assert.match(
    resolution.diagnostics[0].message,
    /shaders\/lib\/a\.glsl -> shaders\/lib\/b\.glsl -> shaders\/lib\/a\.glsl/,
  );
});

test("reports missing local includes without expanding partial text", () => {
  const files = new VirtualFileSystem({
    "shaders/main.frag": ['#include "missing.glsl"', "void main() {}"].join("\n"),
  });
  const resolution = new IncludeResolver(files).resolve("shaders/main.frag");

  assert.equal(resolution.ok, false);
  assert.equal(resolution.diagnostics[0].code, "INCLUDE_MISSING");
  assert.equal(resolution.diagnostics[0].file, "shaders/main.frag");
  assert.equal(resolution.diagnostics[0].line, 1);
  assert.doesNotMatch(resolution.source, /#include/);
});

test("honors #pragma once when a common file is included twice", () => {
  const files = new VirtualFileSystem({
    "shaders/main.frag": [
      '#include "lib/once.glsl"',
      '#include "lib/once.glsl"',
      "void main() {}",
    ].join("\n"),
    "shaders/lib/once.glsl": ["#pragma once", "float once() { return 1.0; }"].join(
      "\n",
    ),
  });
  const resolution = new IncludeResolver(files).resolve("shaders/main.frag");

  assert.equal(resolution.ok, true);
  assert.equal(resolution.source.match(/float once/g)?.length, 1);
  assert.equal(resolution.mappings[0].file, "shaders/lib/once.glsl");
  assert.equal(resolution.mappings[0].line, 2);
});
