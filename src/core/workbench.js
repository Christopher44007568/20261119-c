import { IncludeResolver } from "./include-resolver.js";
import {
  locateInterfaceDeclaration,
  mapCompilerDiagnostic,
  sortDiagnostics,
  varyingNameFromMessage,
} from "./diagnostics.js";
import {
  ManagedShaderBundle,
  ProgramSnapshot,
  ResourceLedger,
} from "./resource-ledger.js";
import { normalizePath } from "./virtual-fs.js";

function normalizePrograms(programs) {
  const normalized = new Map();
  for (const program of programs) {
    normalized.set(program.id, {
      id: program.id,
      label: program.label ?? program.id,
      vertex: normalizePath(program.vertex),
      fragment: normalizePath(program.fragment),
      drawOrder: program.drawOrder ?? 0,
    });
  }
  return normalized;
}

function compilerFailure(rootPath, error) {
  return {
    severity: "error",
    phase: "compile",
    file: rootPath,
    line: 1,
    column: 1,
    message: error?.message ?? String(error),
    code: "COMPILER_EXCEPTION",
  };
}

export class ShaderWorkbench {
  constructor({ fileSystem, compiler, programs, ledger = new ResourceLedger() }) {
    this.fileSystem = fileSystem;
    this.compiler = compiler;
    this.programs = normalizePrograms(programs);
    this.ledger = ledger;
    this.resolver = new IncludeResolver(fileSystem);
    this.active = null;
    this.version = 0;
    this.attempt = 0;
    this.dependencies = new Map();
    this.diagnostics = [];
    this.lastResult = null;
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.stats = {
      compileCalls: 0,
      successfulSwaps: 0,
      failedSwaps: 0,
      recompiledPrograms: 0,
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _emit(result) {
    for (const listener of this.listeners) listener(result, this);
  }

  initialize() {
    return this.reload(null, { forceAll: true, reason: "initial" });
  }

  reload(changedPaths = null, options = {}) {
    const task = () => this._reload(changedPaths, options);
    this.queue = this.queue.then(task, task);
    return this.queue;
  }

  _affectedPrograms(changedPaths, { forceAll = false } = {}) {
    if (forceAll || !this.active) return new Set(this.programs.keys());
    const changed = new Set(
      [...(changedPaths ?? [])].map((path) => normalizePath(path)),
    );
    const affected = new Set();
    for (const [programId, dependencies] of this.dependencies) {
      if ([...dependencies].some((path) => changed.has(path))) {
        affected.add(programId);
      }
    }
    return affected;
  }

  async _compileProgram(program, targetVersion) {
    const vertexResolution = this.resolver.resolve(program.vertex);
    const fragmentResolution = this.resolver.resolve(program.fragment);
    const diagnostics = [
      ...vertexResolution.diagnostics,
      ...fragmentResolution.diagnostics,
    ];
    if (!vertexResolution.ok || !fragmentResolution.ok) {
      return {
        ok: false,
        diagnostics: sortDiagnostics(diagnostics),
        dependencies: new Set([
          ...vertexResolution.dependencies,
          ...fragmentResolution.dependencies,
        ]),
      };
    }

    const dependencies = new Set([
      ...vertexResolution.dependencies,
      ...fragmentResolution.dependencies,
    ]);
    const resourceVersion = `${targetVersion}.${++this.attempt}`;
    let compiled;
    try {
      this.stats.compileCalls += 1;
      compiled = await this.compiler.compile({
        programId: program.id,
        label: program.label,
        resourceVersion,
        vertex: vertexResolution,
        fragment: fragmentResolution,
      });
    } catch (error) {
      return {
        ok: false,
        diagnostics: [compilerFailure(program.vertex, error)],
        dependencies,
      };
    }

    if (!compiled?.ok) {
      const locations = {
        vertex: { resolution: vertexResolution, root: program.vertex },
        fragment: { resolution: fragmentResolution, root: program.fragment },
        link: { resolution: vertexResolution, root: program.vertex },
      };
      for (const diagnostic of compiled.diagnostics ?? []) {
        const stage = diagnostic.stage ?? "vertex";
        let location = locations[stage] ?? locations.vertex;
        let mappedDiagnostic = diagnostic;
        if (stage === "link" && !diagnostic.generatedLine) {
          const identifier = varyingNameFromMessage(diagnostic.message);
          if (identifier) {
            const preferred =
              /FRAGMENT varying/i.test(diagnostic.message) &&
              locations.fragment;
            const candidates = preferred
              ? [locations.fragment, locations.vertex]
              : [locations.vertex, locations.fragment];
            for (const candidate of candidates) {
              const line = locateInterfaceDeclaration(
                candidate.resolution,
                identifier,
              );
              if (line) {
                location = candidate;
                mappedDiagnostic = { ...diagnostic, generatedLine: line };
                break;
              }
            }
          }
        }
        diagnostics.push(
          mapCompilerDiagnostic({
            diagnostic: mappedDiagnostic,
            resolution: location.resolution,
            rootPath: location.root,
            programId: program.id,
            stage,
          }),
        );
      }
      return {
        ok: false,
        diagnostics: sortDiagnostics(diagnostics),
        dependencies,
      };
    }

    return {
      ok: true,
      dependencies,
      bundle: new ManagedShaderBundle({
        programId: program.id,
        label: program.label,
        resourceVersion,
        resource: compiled.resource,
        ledger: this.ledger,
      }),
    };
  }

  _disposeStaged(staged, reason) {
    for (const bundle of staged) bundle.release(reason);
    if (typeof staged.clear === "function") staged.clear();
  }

  _commit(programs, dependencies, reason) {
    const version = this.version + 1;
    const candidate = new ProgramSnapshot({
      version,
      programs,
      dependencies,
      reason,
    });
    const previous = this.active;
    this.active = candidate;
    this.version = version;
    this.dependencies = dependencies;
    if (previous) previous.release(reason);
    return candidate;
  }

  async _reload(changedPaths, options) {
    const reason = options.reason ?? "reload";
    const affected = this._affectedPrograms(changedPaths, options);
    if (affected.size === 0) {
      const result = {
        status: "unchanged",
        affectedPrograms: [],
        diagnostics: [],
        activeVersion: this.active?.version ?? 0,
      };
      this.lastResult = result;
      this._emit(result);
      return result;
    }

    const targetVersion = this.version + 1;
    const stagedBundles = new Map();
    const nextDependencies = new Map(this.dependencies);
    const diagnostics = [];
    const settled = await Promise.all(
      [...affected].map(async (programId) => {
        const program = this.programs.get(programId);
        const result = await this._compileProgram(program, targetVersion);
        return { programId, result };
      }),
    );

    for (const { programId, result } of settled) {
      nextDependencies.set(programId, result.dependencies);
      diagnostics.push(...(result.diagnostics ?? []));
      if (result.ok) stagedBundles.set(programId, result.bundle);
    }

    const failed = settled.some(({ result }) => !result.ok);
    if (failed) {
      this._disposeStaged(stagedBundles.values(), "failed-staging");
      this.stats.failedSwaps += 1;
      this.diagnostics = sortDiagnostics(diagnostics);
      const result = {
        status: "rejected",
        affectedPrograms: [...affected],
        diagnostics: this.diagnostics,
        activeVersion: this.active?.version ?? 0,
        wouldBeVersion: targetVersion,
      };
      this.lastResult = result;
      this._emit(result);
      return result;
    }

    const programs = new Map(this.active?.programs ?? []);
    for (const [programId, bundle] of stagedBundles) {
      programs.set(programId, bundle);
    }

    const candidate = this._commit(programs, nextDependencies, reason);
    this.stats.successfulSwaps += 1;
    this.stats.recompiledPrograms += affected.size;
    this.diagnostics = [];
    const result = {
      status: "committed",
      affectedPrograms: [...affected],
      diagnostics: [],
      activeVersion: candidate.version,
    };
    this.lastResult = result;
    this._emit(result);
    return result;
  }

  removePrograms(programIds) {
    const task = async () => {
      const remove = new Set(programIds);
      const programs = new Map(this.active?.programs ?? []);
      const dependencies = new Map(this.dependencies);
      for (const programId of remove) {
        programs.delete(programId);
        dependencies.delete(programId);
        this.programs.delete(programId);
      }
      if (!this.active) return null;
      const candidate = this._commit(programs, dependencies, "program-removed");
      const result = {
        status: "committed",
        affectedPrograms: [],
        removedPrograms: [...remove],
        diagnostics: [],
        activeVersion: candidate.version,
      };
      this.stats.successfulSwaps += 1;
      this.lastResult = result;
      this._emit(result);
      return result;
    };
    this.queue = this.queue.then(task, task);
    return this.queue;
  }

  previewAffected(changedPaths) {
    const affected = this._affectedPrograms(changedPaths);
    return [...affected].map((programId) => ({
      id: programId,
      label: this.programs.get(programId)?.label ?? programId,
    }));
  }

  beginFrame() {
    if (!this.active) return null;
    const snapshot = this.active.acquire();
    let released = false;
    return {
      snapshot,
      release: () => {
        if (released) return false;
        released = true;
        return snapshot.release("frame-finished");
      },
    };
  }

  endFrame(lease) {
    return lease?.release() ?? false;
  }

  renderFrame(draw) {
    const lease = this.beginFrame();
    if (!lease) return false;
    try {
      draw(lease.snapshot);
      return true;
    } finally {
      this.endFrame(lease);
    }
  }

  getState() {
    return {
      activeVersion: this.active?.version ?? 0,
      programs: [...(this.active?.programs.values() ?? [])].map((bundle) => ({
        id: bundle.programId,
        label: bundle.label,
        resourceVersion: bundle.resourceVersion,
      })),
      dependencies: Object.fromEntries(
        [...this.dependencies].map(([id, paths]) => [id, [...paths].sort()]),
      ),
      diagnostics: this.diagnostics,
      ledger: {
        liveCount: this.ledger.liveCount,
        recent: this.ledger.recent(),
        reclaimCount: this.ledger.reclaimEvents().length,
      },
      stats: { ...this.stats },
      lastResult: this.lastResult,
    };
  }

  dispose() {
    if (this.active) {
      this.active.release("workbench-disposed");
      this.active = null;
    }
  }
}
