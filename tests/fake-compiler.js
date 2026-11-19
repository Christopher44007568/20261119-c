function markerLine(source, marker) {
  const index = source.indexOf(marker);
  if (index === -1) return null;
  return source.slice(0, index).split("\n").length;
}

export class FakeCompiler {
  constructor({ failProgramIds = null } = {}) {
    this.calls = [];
    this.resources = [];
    this.failProgramIds = failProgramIds ? new Set(failProgramIds) : null;
  }

  _shouldFail(programId) {
    return !this.failProgramIds || this.failProgramIds.has(programId);
  }

  async compile({ programId, vertex, fragment, resourceVersion }) {
    this.calls.push({ programId, resourceVersion });

    for (const [stage, input] of [
      ["vertex", vertex],
      ["fragment", fragment],
    ]) {
      const line = markerLine(input.source, "__SYNTAX_ERROR__");
      if (line !== null && this._shouldFail(programId)) {
        return {
          ok: false,
          diagnostics: [
            {
              severity: "error",
              stage,
              generatedLine: line,
              message: "Injected syntax error",
            },
          ],
        };
      }
    }

    if (
      this._shouldFail(programId) &&
      (vertex.source.includes("__LINK_MISMATCH__") ||
        fragment.source.includes("__LINK_MISMATCH__"))
    ) {
      return {
        ok: false,
        diagnostics: [
          {
            severity: "error",
            stage: "link",
            generatedLine: null,
            message: "Types of varying 'vUv' differ between VERTEX and FRAGMENT shaders.",
          },
        ],
      };
    }

    const resource = {
      programId,
      resourceVersion,
      disposed: false,
      dispose() {
        this.disposed = true;
      },
    };
    this.resources.push(resource);
    return { ok: true, resource };
  }
}
