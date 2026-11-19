// Renders a solved preset to a static SVG so results are viewable without
// opening the browser UI. Output: artifacts/<preset>.svg
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const Solver = require(join(root, "src/solver.js"));
const { PRESETS, cloneScene } = require(join(root, "src/presets.js"));

const W = 920;
const H = 640;
const VIEW = { scale: 58, ox: 250, oy: 470 };
const w2s = (p) => ({ x: VIEW.ox + p.x * VIEW.scale, y: VIEW.oy - p.y * VIEW.scale });

const COLORS = ["#57e389", "#57c7e3", "#c09bf5", "#f5c26b", "#8be9fd", "#ff9edb"];

function line(a, b, attrs) {
  const pa = w2s(a);
  const pb = w2s(b);
  return `<line x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" ` +
    `x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}" ${attrs}/>`;
}

function circle(p, r, fill, extra = "") {
  const q = w2s(p);
  const stroke = extra.includes("stroke=") ? "" : 'stroke="#0f1420"';
  return `<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${r}" ` +
    `fill="${fill}" ${stroke} ${extra}/>`;
}

function render(key) {
  const preset = PRESETS[key];
  const scene = cloneScene(preset);
  const result = Solver.enumeratePaths(scene, preset.maxBounces);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
      `viewBox="0 0 ${W} ${H}" font-family="sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#161d2e"/>`,
  ];

  for (let x = -10; x <= 14; x++) {
    const p = w2s({ x, y: 0 });
    parts.push(`<line x1="${p.x}" y1="0" x2="${p.x}" y2="${H}" stroke="#1d2740"/>`);
  }
  for (let y = -6; y <= 10; y++) {
    const p = w2s({ x: 0, y });
    parts.push(`<line x1="0" y1="${p.y}" x2="${W}" y2="${p.y}" stroke="#1d2740"/>`);
  }

  for (const rej of result.rejected) {
    if (rej.points) {
      for (let i = 1; i < rej.points.length; i++) {
        parts.push(line(rej.points[i - 1], rej.points[i],
          'stroke="rgba(255,90,90,0.55)" stroke-width="1.2" stroke-dasharray="5 4"'));
      }
    }
    if (rej.rejectedPoint) parts.push(circle(rej.rejectedPoint, 7, "none",
      'stroke="#ff5a5a" stroke-width="2"'));
  }

  result.valid.forEach((path, i) => {
    const color = COLORS[i % COLORS.length];
    for (let k = 1; k < path.points.length; k++) {
      parts.push(line(path.points[k - 1], path.points[k],
        `stroke="${color}" stroke-width="2.2"`));
    }
    for (let k = 1; k < path.points.length - 1; k++) {
      parts.push(circle(path.points[k], 5, color));
    }
    const mid = w2s(path.points[Math.floor(path.points.length / 2)]);
    parts.push(`<text x="${mid.x + 8}" y="${mid.y - 8}" fill="${color}" font-size="12">` +
      `#${i + 1} L=${path.length.toFixed(2)}</text>`);
  });

  for (const m of scene.mirrors) {
    parts.push(line(m.a, m.b, 'stroke="#9fd8ff" stroke-width="5" stroke-linecap="round"'));
    parts.push(line(m.a, m.b, 'stroke="#d9efff" stroke-width="2"'));
    parts.push(circle(m.a, 8, "#9fd8ff"), circle(m.b, 8, "#9fd8ff"));
  }
  for (const o of scene.occluders) {
    parts.push(line(o.a, o.b, 'stroke="#8a6d5c" stroke-width="6" stroke-dasharray="7 5"'));
  }
  parts.push(circle(scene.source, 8, "#ffe066"));
  parts.push(`<rect x="${w2s(scene.receiver).x - 7}" y="${w2s(scene.receiver).y - 7}" ` +
    `width="14" height="14" fill="#ff7a90" stroke="#0f1420"/>`);
  parts.push(`<text x="18" y="28" fill="#7fd1ff" font-size="16">${preset.name}：` +
    `${result.valid.length} 条有效光路，${result.rejected.length} 条被拒，` +
    `去重 ${result.duplicates || 0} 条</text>`);
  parts.push("</svg>");

  mkdirSync(join(root, "artifacts"), { recursive: true });
  const out = join(root, "artifacts", `${key}.svg`);
  writeFileSync(out, parts.join("\n"));
  return out;
}

const written = Object.keys(PRESETS).map(render);
process.stdout.write(written.join("\n") + "\n");
