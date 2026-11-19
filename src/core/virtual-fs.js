export class VirtualFileError extends Error {
  constructor(message) {
    super(message);
    this.name = "VirtualFileError";
  }
}

export function normalizePath(path) {
  if (typeof path !== "string" || path.trim() === "") {
    throw new VirtualFileError("A file path is required.");
  }

  const parts = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) {
        throw new VirtualFileError(`Path escapes the workspace: ${path}`);
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  if (parts.length === 0) {
    throw new VirtualFileError("A file path is required.");
  }
  return parts.join("/");
}

export function dirname(path) {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? "" : normalized.slice(0, slash);
}

export function resolveRelative(fromFile, specifier) {
  if (specifier.startsWith("/")) {
    return normalizePath(specifier.slice(1));
  }
  const base = dirname(fromFile);
  return normalizePath(base ? `${base}/${specifier}` : specifier);
}

export function hashText(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class VirtualFileSystem {
  constructor(initialFiles = {}) {
    this.files = new Map();
    for (const [path, text] of Object.entries(initialFiles)) {
      this.write(path, text, { silent: true });
    }
  }

  has(path) {
    return this.files.has(normalizePath(path));
  }

  read(path) {
    const normalized = normalizePath(path);
    const file = this.files.get(normalized);
    if (!file) throw new VirtualFileError(`File not found: ${normalized}`);
    return file.text;
  }

  entry(path) {
    return this.files.get(normalizePath(path)) ?? null;
  }

  write(path, text, { silent = false } = {}) {
    const normalized = normalizePath(path);
    const previous = this.files.get(normalized)?.text ?? null;
    const changed = previous !== text;
    if (changed) {
      this.files.set(normalized, { text, hash: hashText(text) });
    }
    return { path: normalized, previous, changed, hash: hashText(text), silent };
  }

  delete(path) {
    const normalized = normalizePath(path);
    const previous = this.files.get(normalized) ?? null;
    this.files.delete(normalized);
    return { path: normalized, previous, changed: previous !== null };
  }

  paths() {
    return [...this.files.keys()].sort();
  }

  snapshot() {
    return new Map(
      [...this.files].map(([path, file]) => [path, { ...file }]),
    );
  }

  hashOf(path) {
    return this.files.get(normalizePath(path))?.hash ?? null;
  }
}
