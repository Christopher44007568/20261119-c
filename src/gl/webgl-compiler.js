function parseInfoLog(log, stage) {
  const diagnostics = [];
  for (const rawLine of String(log ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match =
      /^(ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/i.exec(line) ??
      /^(ERROR|WARNING):\s*(.*)$/i.exec(line);
    diagnostics.push({
      severity: (match?.[1] ?? "ERROR").toLowerCase(),
      stage,
      generatedLine: match?.[2] ? Number(match[2]) : null,
      message: (match?.[3] ?? match?.[2] ?? line).trim(),
    });
  }
  return diagnostics;
}

export class WebGLCompiler {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl =
      canvas?.getContext?.("webgl2", {
        alpha: false,
        antialias: true,
        preserveDrawingBuffer: false,
      }) ?? null;
    if (!this.gl) {
      throw new Error("WebGL2 is not available in this browser.");
    }
  }

  _compileShader(type, source, stage) {
    const { gl } = this;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      return { shader, diagnostics: [] };
    }
    const diagnostics = parseInfoLog(gl.getShaderInfoLog(shader), stage);
    gl.deleteShader(shader);
    return {
      shader: null,
      diagnostics:
        diagnostics.length > 0
          ? diagnostics
          : [{ severity: "error", stage, generatedLine: null, message: "Shader compilation failed." }],
    };
  }

  compile({ vertex, fragment }) {
    const { gl } = this;
    const vertexResult = this._compileShader(gl.VERTEX_SHADER, vertex.source, "vertex");
    if (!vertexResult.shader) {
      return { ok: false, diagnostics: vertexResult.diagnostics };
    }

    const fragmentResult = this._compileShader(
      gl.FRAGMENT_SHADER,
      fragment.source,
      "fragment",
    );
    if (!fragmentResult.shader) {
      gl.deleteShader(vertexResult.shader);
      return { ok: false, diagnostics: fragmentResult.diagnostics };
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertexResult.shader);
    gl.attachShader(program, fragmentResult.shader);
    gl.linkProgram(program);
    gl.detachShader(program, vertexResult.shader);
    gl.detachShader(program, fragmentResult.shader);
    gl.deleteShader(vertexResult.shader);
    gl.deleteShader(fragmentResult.shader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const diagnostics = parseInfoLog(gl.getProgramInfoLog(program), "link");
      gl.deleteProgram(program);
      return {
        ok: false,
        diagnostics:
          diagnostics.length > 0
            ? diagnostics
            : [{ severity: "error", stage: "link", generatedLine: null, message: "Program linking failed." }],
      };
    }

    return {
      ok: true,
      resource: {
        program,
        gl,
        dispose: () => gl.deleteProgram(program),
      },
    };
  }
}
