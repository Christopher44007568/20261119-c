function fallbackLocation(resolution, rootPath) {
  const first = resolution?.mappings?.[0];
  return {
    file: first?.file ?? resolution?.root ?? rootPath,
    line: first?.line ?? 1,
    column: 1,
  };
}

export function mapCompilerDiagnostic({
  diagnostic,
  resolution,
  rootPath,
  programId,
  stage,
}) {
  const generatedLine =
    diagnostic.generatedLine ?? diagnostic.line ?? null;
  const mapped =
    generatedLine === null
      ? null
      : resolution?.mappings?.[generatedLine - 1] ?? null;
  const fallback = fallbackLocation(resolution, rootPath);

  return {
    severity: diagnostic.severity ?? "error",
    phase: diagnostic.phase ?? (stage === "link" ? "link" : "compile"),
    programId,
    stage,
    file: mapped?.file ?? fallback.file,
    line: mapped?.line ?? fallback.line,
    column: mapped?.column ?? fallback.column,
    generatedLine,
    message: diagnostic.message ?? "Shader compilation failed.",
    code: diagnostic.code ?? null,
  };
}

export function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort((left, right) => {
    return (
      String(left.file).localeCompare(String(right.file)) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      (left.column ?? 0) - (right.column ?? 0)
    );
  });
}

export function formatDiagnostic(diagnostic) {
  const location = diagnostic.line
    ? `${diagnostic.file}:${diagnostic.line}:${diagnostic.column ?? 1}`
    : diagnostic.file;
  return `${location}: ${diagnostic.message}`;
}

export function varyingNameFromMessage(message) {
  const quoted = /varying\s+['"]([A-Za-z_]\w*)['"]/i.exec(message ?? "");
  if (quoted) return quoted[1];
  const plain = /\bvarying\s+([A-Za-z_]\w*)\s+does not match/i.exec(
    message ?? "",
  );
  return plain?.[1] ?? null;
}

export function locateInterfaceDeclaration(resolution, identifier) {
  if (!resolution?.source || !identifier) return null;
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\b(?:out|in|varying)\\s+(?:(?:lowp|mediump|highp)\\s+)?[A-Za-z_]\\w*\\s+${escaped}\\s*(?:;|=)`,
  );
  const match = pattern.exec(resolution.source);
  if (!match) return null;
  return resolution.source.slice(0, match.index).split("\n").length;
}
