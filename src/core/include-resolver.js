import {
  normalizePath,
  resolveRelative,
  VirtualFileError,
} from "./virtual-fs.js";

const INCLUDE_PATTERN =
  /^\s*#\s*include\s+["<]([^">]+)[">]\s*(?:\/\/.*)?$/;
const PRAGMA_ONCE_PATTERN = /^\s*#\s*pragma\s+once\s*(?:\/\/.*)?$/;

function includeDiagnostic({ file, line, column, message, code }) {
  return {
    severity: "error",
    phase: "preprocess",
    file,
    line,
    column,
    message,
    code,
  };
}

function includeColumn(text) {
  const quote = text.search(/["<]/);
  return quote === -1 ? 1 : quote + 2;
}

export class IncludeResolver {
  constructor(fileSystem) {
    this.fileSystem = fileSystem;
  }

  resolve(entryPath) {
    const root = normalizePath(entryPath);
    const lines = [];
    const mappings = [];
    const dependencies = new Set();
    const activeStack = [];
    const onceFiles = new Set();
    const diagnostics = [];

    const visit = (path) => {
      if (!this.fileSystem.has(path)) {
        return;
      }

      dependencies.add(path);
      const source = this.fileSystem.read(path);
      const sourceLines = source.split(/\r?\n/);
      activeStack.push(path);

      sourceLines.forEach((sourceLine, index) => {
        const lineNumber = index + 1;
        if (PRAGMA_ONCE_PATTERN.test(sourceLine)) {
          onceFiles.add(path);
          return;
        }

        const include = INCLUDE_PATTERN.exec(sourceLine);
        if (!include) {
          lines.push(sourceLine);
          mappings.push({
            generatedLine: lines.length,
            file: path,
            line: lineNumber,
            column: 1,
          });
          return;
        }

        let target;
        try {
          target = resolveRelative(path, include[1]);
        } catch (error) {
          diagnostics.push(
            includeDiagnostic({
              file: path,
              line: lineNumber,
              column: includeColumn(sourceLine),
              message: error.message,
              code: "INCLUDE_PATH_INVALID",
            }),
          );
          return;
        }

        const cycleStart = activeStack.indexOf(target);
        if (cycleStart !== -1) {
          const chain = [...activeStack.slice(cycleStart), target].join(" -> ");
          diagnostics.push(
            includeDiagnostic({
              file: path,
              line: lineNumber,
              column: includeColumn(sourceLine),
              message: `Include cycle detected: ${chain}`,
              code: "INCLUDE_CYCLE",
            }),
          );
          return;
        }

        if (!this.fileSystem.has(target)) {
          diagnostics.push(
            includeDiagnostic({
              file: path,
              line: lineNumber,
              column: includeColumn(sourceLine),
              message: `Included file not found: ${target}`,
              code: "INCLUDE_MISSING",
            }),
          );
          return;
        }

        if (onceFiles.has(target)) {
          return;
        }
        visit(target);
      });

      activeStack.pop();
    };

    if (!this.fileSystem.has(root)) {
      return {
        ok: false,
        root,
        source: "",
        mappings: [],
        dependencies: [],
        diagnostics: [
          includeDiagnostic({
            file: root,
            line: 1,
            column: 1,
            message: `Shader entry file not found: ${root}`,
            code: "ENTRY_MISSING",
          }),
        ],
      };
    }

    visit(root);
    return {
      ok: diagnostics.length === 0,
      root,
      source: lines.join("\n"),
      mappings,
      dependencies: [...dependencies],
      diagnostics,
    };
  }

  mapLine(resolution, generatedLine) {
    if (!resolution || !Number.isFinite(generatedLine)) return null;
    return resolution.mappings[generatedLine - 1] ?? null;
  }
}

export { VirtualFileError };
