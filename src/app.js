import { ShaderWorkbench } from "./core/workbench.js";
import { VirtualFileSystem } from "./core/virtual-fs.js";
import { WebGLCompiler } from "./gl/webgl-compiler.js";
import { SceneRenderer } from "./gl/scene-renderer.js";
import { demoFiles, demoPrograms } from "./demo/workspace.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  editor: $("#editor"),
  lineNumbers: $("#lineNumbers"),
  activeFile: $("#activeFile"),
  fileTree: $("#fileTree"),
  fileCount: $("#fileCount"),
  programList: $("#programList"),
  programCount: $("#programCount"),
  dependencyList: $("#dependencyList"),
  diagnosticList: $("#diagnosticList"),
  diagnosticCount: $("#diagnosticCount"),
  compileState: $("#compileState"),
  compileDot: $("#compileDot"),
  compileButton: $("#compileButton"),
  autoToggle: $("#autoToggle"),
  activeVersion: $("#activeVersion"),
  versionPill: $("#versionPill"),
  frameVersion: $("#frameVersion"),
  oldFrameBadge: $("#oldFrameBadge"),
  passCount: $("#passCount"),
  ledgerList: $("#ledgerList"),
  liveResources: $("#liveResources"),
  statCompile: $("#statCompile"),
  statRecompiled: $("#statRecompiled"),
  statRejected: $("#statRejected"),
  statReclaimed: $("#statReclaimed"),
  statusMessage: $("#statusMessage"),
  affectedMessage: $("#affectedMessage"),
  snapshotLabel: $("#snapshotLabel"),
  cursorPosition: $("#cursorPosition"),
  dirtyDot: $("#dirtyDot"),
  toastStack: $("#toastStack"),
  canvas: $("#previewCanvas"),
  revertButton: $("#revertButton"),
};

const baseline = { ...demoFiles };
const fileSystem = new VirtualFileSystem(demoFiles);
let compiler = null;
let renderer = null;
let workbench = null;
let currentFile = "shaders/scene.frag";
let pendingPaths = new Set();
let pendingAffected = new Set();
let autoReload = true;
let reloadTimer = null;
let compiling = false;
let queuedReload = false;
let lastRejected = false;
let activeScenario = null;
let renderStartedAt = performance.now();
let lastFrameVersion = 0;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function splitPath(path) {
  const parts = path.split("/");
  return { directory: parts.slice(0, -1).join("/"), name: parts.at(-1) };
}

function lineOfSelection(textarea) {
  const before = textarea.value.slice(0, textarea.selectionStart);
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function showToast(title, message, type = "success") {
  elements.toastStack.replaceChildren();
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  toast.dataset.title = title;
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message)}`;
  elements.toastStack.append(toast);
  setTimeout(() => toast.remove(), 3600);
}

function markDirty(paths) {
  for (const path of paths) pendingPaths.add(path);
  pendingAffected = new Set(
    workbench.previewAffected(pendingPaths).map((program) => program.id),
  );
  updateAffectedStatus();
  elements.dirtyDot.classList.toggle(
    "visible",
    fileSystem.read(currentFile) !== baseline[currentFile],
  );
}

function updateAffectedStatus() {
  if (pendingAffected.size === 0) {
    elements.affectedMessage.textContent = pendingPaths.size
      ? "No linked program depends on this file"
      : "No pending changes";
    elements.affectedMessage.classList.remove("error");
    return;
  }
  const names = [...pendingAffected].join(", ");
  elements.affectedMessage.textContent = `Dependency slice: ${names} (${pendingAffected.size} program${
    pendingAffected.size === 1 ? "" : "s"
  })`;
  elements.affectedMessage.classList.remove("error");
}

function updateLineNumbers(diagnostics = []) {
  const text = elements.editor.value;
  const errorLines = new Set(
    diagnostics
      .filter((diagnostic) => diagnostic.file === currentFile)
      .map((diagnostic) => diagnostic.line),
  );
  const count = Math.max(1, text.split("\n").length);
  elements.lineNumbers.innerHTML = Array.from({ length: count }, (_, index) => {
    const line = index + 1;
    return `<div class="${errorLines.has(line) ? "error-line" : ""}">${line}</div>`;
  }).join("");
}

function syncEditorScroll() {
  elements.lineNumbers.scrollTop = elements.editor.scrollTop;
}

function setCursorPosition() {
  const position = lineOfSelection(elements.editor);
  elements.cursorPosition.textContent = `Ln ${position.line}, Col ${position.column}`;
}

function loadFile(path) {
  currentFile = path;
  elements.editor.value = fileSystem.read(path);
  elements.activeFile.textContent = path;
  elements.dirtyDot.classList.toggle(
    "visible",
    elements.editor.value !== baseline[path],
  );
  updateLineNumbers(workbench?.diagnostics ?? []);
  renderFileTree();
  elements.editor.scrollTop = 0;
  syncEditorScroll();
  setCursorPosition();
}

function restoreFile(path) {
  if (!(path in baseline)) return;
  fileSystem.write(path, baseline[path]);
  if (path === currentFile) {
    elements.editor.value = baseline[path];
    updateLineNumbers();
    elements.dirtyDot.classList.remove("visible");
  }
}

function renderFileTree() {
  const groups = new Map();
  for (const path of fileSystem.paths()) {
    const { directory } = splitPath(path);
    if (!groups.has(directory)) groups.set(directory, []);
    groups.get(directory).push(path);
  }
  const diagnosticFiles = new Set(
    (workbench?.diagnostics ?? []).map((diagnostic) => diagnostic.file),
  );
  const markup = [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([directory, paths]) => {
      const rows = paths
        .map((path) => {
          const { name } = splitPath(path);
          const error = diagnosticFiles.has(path)
            ? '<span class="panel-count" style="color:var(--red)">!</span>'
            : "";
          return `<button class="tree-file ${
            path === currentFile ? "selected" : ""
          }" type="button" data-path="${escapeHtml(path)}">
            <span class="file-glyph"></span><span>${escapeHtml(name)}</span>${error}
          </button>`;
        })
        .join("");
      return `<div class="tree-group">
        <div class="tree-folder">
          <svg viewBox="0 0 16 16"><path d="M1.5 4.5h4l1.4 1.7h7.6v6.3h-13v-8Z"/></svg>
          ${escapeHtml(directory || "workspace")}
        </div>${rows}</div>`;
    })
    .join("");
  elements.fileTree.innerHTML = markup;
  elements.fileCount.textContent = fileSystem.paths().length;
}

function renderPrograms(state) {
  const activeById = new Map(
    state.programs.map((program) => [program.id, program]),
  );
  const failedPrograms = new Set(
    state.diagnostics.map((diagnostic) => diagnostic.programId).filter(Boolean),
  );
  elements.programList.innerHTML = demoPrograms
    .map((definition) => {
      const active = activeById.get(definition.id);
      const isPending = pendingAffected.has(definition.id);
      const isRejected = lastRejected && failedPrograms.has(definition.id);
      const className = isRejected
        ? "rejected"
        : isPending
          ? "compiling"
          : "";
      const status = active
        ? `res ${active.resourceVersion}`
        : isRejected
          ? "staged"
          : "offline";
      return `<div class="program-item ${className}">
        <span class="program-led"></span>
        <span class="program-copy">
          <strong>${escapeHtml(definition.label)}</strong>
          <small>${escapeHtml(definition.vertex)}</small>
        </span>
        <span class="program-badge">${escapeHtml(status)}</span>
      </div>`;
    })
    .join("");
  elements.programCount.textContent = demoPrograms.length;
  elements.passCount.textContent = state.programs.length;
}

function renderDependencies(state) {
  const entries = Object.entries(state.dependencies);
  elements.dependencyList.innerHTML = entries.length
    ? entries
        .map(([programId, paths]) => {
          const definition = demoPrograms.find((item) => item.id === programId);
          return `<div class="dependency-item">
            <div class="dependency-head">
              <span>${escapeHtml(definition?.label ?? programId)}</span>
              <span>${paths.length}</span>
            </div>
            <ul class="dependency-paths">
              ${paths.map((path) => `<li>${escapeHtml(path)}</li>`).join("")}
            </ul>
          </div>`;
        })
        .join("")
    : '<div class="dependency-item"><div class="dependency-head"><span>No linked slice</span></div></div>';
}

function renderDiagnostics(state) {
  const diagnostics = state.diagnostics ?? [];
  elements.diagnosticCount.textContent = diagnostics.length;
  elements.diagnosticCount.classList.toggle("has-errors", diagnostics.length > 0);
  if (diagnostics.length === 0) {
    elements.diagnosticList.innerHTML = `<div class="empty-state">
      <span class="empty-check">✓</span>
      <div><strong>Program set is healthy</strong>
      <p>All shader stages compiled and linked.</p></div>
    </div>`;
  } else {
    elements.diagnosticList.innerHTML = diagnostics
      .map(
        (diagnostic, index) => `<button class="diagnostic-item" type="button" data-diagnostic="${index}">
          <span class="diagnostic-icon">!</span>
          <span class="diagnostic-body">
            <strong>${escapeHtml(diagnostic.message)}</strong>
            <small>${escapeHtml(diagnostic.file)}:${diagnostic.line}:${
              diagnostic.column ?? 1
            } · ${escapeHtml(diagnostic.phase)}</small>
          </span>
          <span class="diagnostic-program">${escapeHtml(
            diagnostic.programId ?? diagnostic.stage ?? "build",
          )}</span>
        </button>`,
      )
      .join("");
  }
  updateLineNumbers(diagnostics);
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function renderLedger(state) {
  const { ledger, stats } = state;
  elements.liveResources.textContent = ledger.liveCount;
  elements.statCompile.textContent = stats.compileCalls;
  elements.statRecompiled.textContent = stats.recompiledPrograms;
  elements.statRejected.textContent = stats.failedSwaps;
  elements.statReclaimed.textContent = ledger.reclaimCount;
  elements.ledgerList.innerHTML = ledger.recent
    .slice(0, 12)
    .map((event) => {
      const reason =
        event.type === "allocated" ? "staging" : event.reason.replaceAll("-", " ");
      return `<div class="ledger-row ${event.type}">
        <span class="ledger-kind">${event.type === "allocated" ? "alloc" : "free"}</span>
        <span title="${escapeHtml(event.key)}">${escapeHtml(
          event.programId,
        )} · ${escapeHtml(event.resourceVersion)} · ${escapeHtml(reason)}</span>
        <time>${formatTime(event.at)}</time>
      </div>`;
    })
    .join("");
}

function updateStatus(result, state, { toast = true } = {}) {
  if (!result) return;
  const rejected = result.status === "rejected";
  lastRejected = rejected;
  elements.compileDot.className = `state-dot ${rejected ? "error" : "ok"}`;
  elements.versionPill.classList.toggle("stale", rejected);
  elements.oldFrameBadge.classList.toggle("visible", rejected);
  elements.oldFrameBadge.textContent = `Last known good · v${state.activeVersion}`;
  if (result.status === "committed") {
    elements.compileState.textContent = `Atomic swap committed · v${state.activeVersion}`;
    elements.statusMessage.textContent = `v${state.activeVersion} active · ${result.affectedPrograms.length} program slice rebuilt`;
    elements.statusMessage.classList.remove("error");
    if (toast) {
      showToast(
        `Program set v${state.activeVersion} is live`,
        `${result.affectedPrograms.length} dependent program${
          result.affectedPrograms.length === 1 ? "" : "s"
        } recompiled and linked.`,
      );
    }
  } else if (result.status === "rejected") {
    elements.compileState.textContent = `Build rejected · still rendering v${state.activeVersion}`;
    elements.statusMessage.textContent = `Diagnostics mapped to source · old v${state.activeVersion} retained`;
    elements.statusMessage.classList.add("error");
    if (toast) {
      showToast(
        "Update rejected atomically",
        `Still rendering frame set v${state.activeVersion}; staged resources reclaimed.`,
        "error",
      );
    }
    const first = result.diagnostics[0];
    if (first?.file === currentFile) {
      elements.editor.scrollTop = Math.max(0, ((first.line ?? 1) - 8) * 21);
      syncEditorScroll();
    }
  } else {
    elements.compileState.textContent = "No dependent programs changed";
  }
}

function renderState(result = workbench.lastResult, options = {}) {
  const state = workbench.getState();
  if (result) lastRejected = result.status === "rejected";
  elements.activeVersion.textContent = state.activeVersion;
  elements.snapshotLabel.textContent = `v${state.activeVersion}`;
  renderFileTree();
  renderPrograms(state);
  renderDependencies(state);
  renderDiagnostics(state);
  renderLedger(state);
  updateAffectedStatus();
  if (result) updateStatus(result, state, options);
  return state;
}

function scheduleAutoReload() {
  clearTimeout(reloadTimer);
  if (!autoReload || pendingPaths.size === 0) return;
  reloadTimer = setTimeout(() => runReload([...pendingPaths]), 420);
}

async function runReload(paths) {
  clearTimeout(reloadTimer);
  if (!workbench) return;
  if (compiling) {
    queuedReload = true;
    for (const path of paths) pendingPaths.add(path);
    return;
  }

  const changed = [...new Set(paths.length ? paths : pendingPaths)];
  if (changed.length === 0) return;
  pendingPaths = new Set(pendingPaths);
  for (const path of changed) pendingPaths.delete(path);
  pendingAffected.clear();
  compiling = true;
  elements.compileButton.disabled = true;
  elements.compileState.textContent = `Staging ${changed.length} changed file${
    changed.length === 1 ? "" : "s"
  } · old frame remains live`;
  elements.compileDot.className = "state-dot";
  renderState(null);

  try {
    const result = await workbench.reload(changed, { reason: "edit" });
    renderState(result);
  } catch (error) {
    elements.compileState.textContent = "Reload pipeline failed";
    elements.compileDot.className = "state-dot error";
    showToast("Reload pipeline failed", error.message, "error");
  } finally {
    compiling = false;
    elements.compileButton.disabled = false;
    if (queuedReload || pendingPaths.size > 0) {
      queuedReload = false;
      scheduleAutoReload();
    }
  }
}

function setEditorSelection(line, column = 1) {
  const lines = elements.editor.value.split("\n");
  let offset = 0;
  for (let index = 0; index < Math.min(line - 1, lines.length); index += 1) {
    offset += lines[index].length + 1;
  }
  offset += Math.min(column - 1, lines[line - 1]?.length ?? 0);
  elements.editor.focus();
  elements.editor.setSelectionRange(offset, offset);
  const lineHeight = 21;
  elements.editor.scrollTop = Math.max(0, (line - 3) * lineHeight);
  syncEditorScroll();
  setCursorPosition();
}

function applyScenario(name) {
  const changed = new Set();
  const applyWrite = (path, text) => {
    const result = fileSystem.write(path, text);
    if (result.changed) changed.add(path);
  };
  for (const path of fileSystem.paths()) {
    if (!(path in baseline)) {
      fileSystem.delete(path);
      changed.add(path);
    }
  }
  for (const [path, text] of Object.entries(baseline)) {
    applyWrite(path, text);
  }

  let target = "shaders/scene.frag";
  let summary = "Baseline sources restored";
  activeScenario = name === "restore" ? null : name;
  if (name === "syntax") {
    target = "shaders/lib/common.glsl";
    const lines = baseline[target].split("\n");
    const injectedLine = lines.length + 3;
    applyWrite(
      target,
      `${baseline[target]}\n\nvoid injectSyntaxError() {\n  float broken = ;\n}`,
    );
    summary = `Expected ${target}:${injectedLine} · compile rejected, v${
      workbench.active?.version ?? 0
    } kept`;
  } else if (name === "link") {
    target = "shaders/scene.vert";
    applyWrite(
      target,
      baseline[target]
        .replace("out vec2 vUv;", "out vec3 vUv;")
        .replace(
          "vUv = aPosition * 0.5 + 0.5;",
          "vUv = vec3(aPosition * 0.5 + 0.5, 0.0);",
        ),
    );
    summary = "Vertex out vUv is vec3, fragment in vUv is vec2 · link must fail";
  } else if (name === "cycle") {
    target = "shaders/lib/common.glsl";
    applyWrite(
      target,
      ['#include "common.glsl"', baseline[target]].join("\n"),
    );
    summary = `Expected ${target}:1 · include cycle rejected`;
  }

  for (const button of document.querySelectorAll("[data-scenario]")) {
    button.classList.toggle("active", button.dataset.scenario === activeScenario);
  }
  loadFile(target);
  markDirty(changed);
  elements.statusMessage.textContent = summary;
  elements.statusMessage.classList.remove("error");
  renderState(null);
  if (changed.size > 0) runReload([...changed]);
}

function renderLoop(now) {
  if (!renderer || !workbench) {
    requestAnimationFrame(renderLoop);
    return;
  }
  const rect = elements.canvas.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  if (elements.canvas.width !== width || elements.canvas.height !== height) {
    elements.canvas.width = width;
    elements.canvas.height = height;
  }

  const lease = workbench.beginFrame();
  if (lease) {
    try {
      renderer.draw(lease.snapshot, (now - renderStartedAt) / 1000);
      if (lease.snapshot.version !== lastFrameVersion) {
        lastFrameVersion = lease.snapshot.version;
        elements.frameVersion.textContent = lastFrameVersion;
      }
    } finally {
      workbench.endFrame(lease);
    }
  }
  requestAnimationFrame(renderLoop);
}

elements.editor.addEventListener("input", () => {
  if (!workbench) return;
  fileSystem.write(currentFile, elements.editor.value);
  markDirty([currentFile]);
  updateLineNumbers(workbench.diagnostics);
  renderPrograms(workbench.getState());
  elements.dirtyDot.classList.toggle(
    "visible",
    elements.editor.value !== baseline[currentFile],
  );
  setCursorPosition();
  scheduleAutoReload();
});

elements.editor.addEventListener("scroll", syncEditorScroll);
elements.editor.addEventListener("click", setCursorPosition);
elements.editor.addEventListener("keyup", setCursorPosition);
elements.editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = elements.editor.selectionStart;
    const end = elements.editor.selectionEnd;
    elements.editor.setRangeText("  ", start, end, "end");
    elements.editor.dispatchEvent(new Event("input"));
  }
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    runReload([...pendingPaths]);
  }
});

elements.compileButton.addEventListener("click", () => {
  runReload([...pendingPaths]);
});

elements.autoToggle.addEventListener("click", () => {
  autoReload = !autoReload;
  elements.autoToggle.classList.toggle("enabled", autoReload);
  elements.autoToggle.setAttribute("aria-pressed", String(autoReload));
  if (autoReload) scheduleAutoReload();
});

elements.revertButton.addEventListener("click", () => {
  if (!(currentFile in baseline)) return;
  restoreFile(currentFile);
  markDirty([currentFile]);
  renderState(null);
  scheduleAutoReload();
});

elements.fileTree.addEventListener("click", (event) => {
  const button = event.target.closest("[data-path]");
  if (!button) return;
  loadFile(button.dataset.path);
});

elements.diagnosticList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-diagnostic]");
  if (!button) return;
  const diagnostic = workbench.diagnostics[Number(button.dataset.diagnostic)];
  if (!diagnostic) return;
  if (fileSystem.has(diagnostic.file)) loadFile(diagnostic.file);
  setEditorSelection(diagnostic.line ?? 1, diagnostic.column ?? 1);
});

for (const button of document.querySelectorAll("[data-scenario]")) {
  button.addEventListener("click", () => applyScenario(button.dataset.scenario));
}

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    runReload([...pendingPaths]);
  }
});

window.addEventListener("beforeunload", () => workbench?.dispose());

async function boot() {
  elements.autoToggle.classList.add("enabled");
  elements.autoToggle.setAttribute("aria-pressed", "true");
  loadFile(currentFile);
  renderFileTree();

  try {
    compiler = new WebGLCompiler(elements.canvas);
    renderer = new SceneRenderer(compiler.gl);
  } catch (error) {
    elements.compileDot.className = "state-dot error";
    elements.compileState.textContent = "WebGL2 unavailable";
    elements.statusMessage.textContent = error.message;
    elements.statusMessage.classList.add("error");
    showToast(
      "WebGL2 unavailable",
      "The workbench core is loaded, but compiled previews require WebGL2.",
      "error",
    );
    return;
  }

  workbench = new ShaderWorkbench({
    fileSystem,
    compiler,
    programs: demoPrograms,
  });
  const result = await workbench.initialize();
  renderState(result, { toast: false });
  if (result.status === "rejected") {
    elements.oldFrameBadge.classList.add("visible");
    elements.oldFrameBadge.textContent = "No known-good program set";
  }
  requestAnimationFrame(renderLoop);
}

boot();
