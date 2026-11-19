import { ShaderWorkbench } from "../src/core/workbench.js";
import { VirtualFileSystem } from "../src/core/virtual-fs.js";
import { FakeCompiler } from "./fake-compiler.js";

export const BASE_FILES = {
  "shaders/main.vert": [
    "#version 300 es",
    "precision highp float;",
    'out vec2 vUv;',
    "void main() {",
    "  vUv = vec2(0.0);",
    "  gl_Position = vec4(0.0);",
    "}",
  ].join("\n"),
  "shaders/main.frag": [
    "#version 300 es",
    "precision highp float;",
    'in vec2 vUv;',
    "out vec4 outColor;",
    '#include "lib/common.glsl"',
    "void main() { outColor = vec4(sharedColor(vUv), 1.0); }",
  ].join("\n"),
  "shaders/lib/common.glsl": [
    "vec3 sharedColor(vec2 uv) {",
    "  return vec3(uv, 1.0);",
    "}",
  ].join("\n"),
  "shaders/other.frag": [
    "#version 300 es",
    "precision highp float;",
    "out vec4 outColor;",
    '#include "lib/other.glsl"',
    "void main() { outColor = vec4(otherColor(), 1.0); }",
  ].join("\n"),
  "shaders/lib/other.glsl": "vec3 otherColor() { return vec3(0.2); }",
};

export function createHarness(overrides = {}, compilerOptions = {}) {
  const fileSystem = new VirtualFileSystem({ ...BASE_FILES, ...overrides });
  const compiler = new FakeCompiler(compilerOptions);
  const programs = [
    {
      id: "main",
      label: "Main pass",
      vertex: "shaders/main.vert",
      fragment: "shaders/main.frag",
    },
    {
      id: "other",
      label: "Other pass",
      vertex: "shaders/main.vert",
      fragment: "shaders/other.frag",
    },
  ];
  const workbench = new ShaderWorkbench({ fileSystem, compiler, programs });
  return { fileSystem, compiler, workbench };
}
