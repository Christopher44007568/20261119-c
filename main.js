// Adaptive bicubic Bezier surface tessellation demo.
// Core math lives in src/*.js (pure, node-tested); this file is the
// WebGL front-end: rendering, camera, interaction, stats.

import * as THREE from 'three';
import { buildDemoSurface } from './src/scene.js';

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101418);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

// --- minimal orbit control -------------------------------------------------
const orbit = {
  theta: 0.65,
  phi: 1.05,
  radius: 9.5,
  target: new THREE.Vector3(0, 0.2, 0),
  moved: true,
};
function applyOrbit() {
  const sp = Math.sin(orbit.phi);
  camera.position.set(
    orbit.target.x + orbit.radius * sp * Math.sin(orbit.theta),
    orbit.target.y + orbit.radius * Math.cos(orbit.phi),
    orbit.target.z + orbit.radius * sp * Math.cos(orbit.theta),
  );
  camera.lookAt(orbit.target);
  camera.updateMatrixWorld();
  orbit.moved = true;
}

// --- screen-space projector (pixels), null when behind camera --------------
const projVec = new THREE.Vector3();
function makeProjector() {
  const w = renderer.domElement.width / renderer.getPixelRatio();
  const h = renderer.domElement.height / renderer.getPixelRatio();
  const view = camera.matrixWorldInverse;
  const proj = camera.projectionMatrix;
  return (p) => {
    projVec.set(p[0], p[1], p[2]).applyMatrix4(view);
    if (projVec.z > -0.05) return null; // behind / too close
    projVec.applyMatrix4(proj);
    return [(projVec.x * 0.5 + 0.5) * w, (projVec.y * 0.5 + 0.5) * h];
  };
}

// --- lights -----------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xdfefff, 0x202830, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(4, 8, 5);
scene.add(sun);

// --- surface ----------------------------------------------------------------
const { surface, pts: demoPts, patches } = buildDemoSurface(0.9);
const PATCH_COLORS = { A: 0x2ca6a4, B: 0xe07b39, C: 0x2ca6a4, D: 0xe07b39 };
const patchViews = new Map(); // patch -> { solid, wire }

function makePatchView(patch, color) {
  const solid = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.05,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  const wire = new THREE.Mesh(
    solid.geometry,
    new THREE.MeshBasicMaterial({ color: 0x101418, wireframe: true }),
  );
  scene.add(solid, wire);
  const view = { solid, wire };
  patchViews.set(patch, view);
  return view;
}

for (const [name, patch] of Object.entries(patches)) {
  makePatchView(patch, PATCH_COLORS[name]);
}

function uploadMesh(patch) {
  const view = patchViews.get(patch);
  const { positions, normals, uvs, indices } = patch.mesh;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  view.solid.geometry.dispose();
  view.solid.geometry = geo;
  view.wire.geometry = geo;
}

// --- control net + draggable control points ---------------------------------
const GP = 7;
const ctrlGroup = new THREE.Group();
scene.add(ctrlGroup);

const netGeom = new THREE.BufferGeometry();
const netPos = new Float32Array(GP * GP * 2 * 3 * 2); // upper bound
netGeom.setAttribute('position', new THREE.BufferAttribute(netPos, 3));
const netLines = new THREE.LineSegments(
  netGeom,
  new THREE.LineBasicMaterial({ color: 0x8b98a5, transparent: true, opacity: 0.55 }),
);
ctrlGroup.add(netLines);

const pointSpheres = []; // { mesh, pt }
const sphereGeo = new THREE.SphereGeometry(0.055, 16, 12);
const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
const sphereMatHot = new THREE.MeshBasicMaterial({ color: 0xff5252 });

function buildControlPoints(pts) {
  for (let gx = 0; gx < GP; gx++) {
    for (let gz = 0; gz < GP; gz++) {
      const m = new THREE.Mesh(sphereGeo, sphereMat.clone());
      m.userData.pt = pts[gx][gz];
      ctrlGroup.add(m);
      pointSpheres.push(m);
    }
  }
}

function syncControlVisuals(pts) {
  let k = 0;
  for (let gx = 0; gx < GP; gx++) {
    for (let gz = 0; gz < GP; gz++) {
      const p = pts[gx][gz];
      netPos[k++] = p[0];
      netPos[k++] = p[1];
      netPos[k++] = p[2];
      const q = pts[gx][Math.min(gz + 1, GP - 1)];
      netPos[k++] = q[0];
      netPos[k++] = q[1];
      netPos[k++] = q[2];
      netPos[k++] = p[0];
      netPos[k++] = p[1];
      netPos[k++] = p[2];
      const r = pts[Math.min(gx + 1, GP - 1)][gz];
      netPos[k++] = r[0];
      netPos[k++] = r[1];
      netPos[k++] = r[2];
    }
  }
  netGeom.attributes.position.needsUpdate = true;
  netGeom.setDrawRange(0, k / 3);
  for (const m of pointSpheres) {
    const p = m.userData.pt;
    m.position.set(p[0], p[1], p[2]);
  }
}

// --- pointer interaction: orbit vs control-point drag ------------------------
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragState = { sphere: null, moved: false };
let orbiting = false;
let lastX = 0;
let lastY = 0;

function setNdc(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointerNdc.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  setNdc(e);
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = ctrlGroup.visible
    ? raycaster.intersectObjects(pointSpheres, false)
    : [];
  if (hits.length > 0) {
    dragState.sphere = hits[0].object;
    dragState.sphere.material.color.copy(sphereMatHot.color);
    const n = camera.getWorldDirection(new THREE.Vector3());
    dragPlane.setFromNormalAndCoplanarPoint(n, hits[0].point);
  } else {
    orbiting = true;
  }
  lastX = e.clientX;
  lastY = e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId);
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (dragState.sphere) {
    setNdc(e);
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, hit)) {
      const pt = dragState.sphere.userData.pt;
      pt[0] = hit.x;
      pt[1] = hit.y;
      pt[2] = hit.z;
      // LOCAL update: only affected patches are re-tessellated.
      const t0 = performance.now();
      const rebuilt = surface.movePoints([pt], makeProjector());
      lastRebuildMs = performance.now() - t0;
      lastRebuildCount = rebuilt.length;
      for (const p of rebuilt) uploadMesh(p);
      syncControlVisuals(demoPts);
      dragState.moved = true;
    }
  } else if (orbiting) {
    orbit.theta -= (e.clientX - lastX) * 0.006;
    orbit.phi = Math.max(0.15, Math.min(1.5, orbit.phi - (e.clientY - lastY) * 0.006));
    lastX = e.clientX;
    lastY = e.clientY;
    applyOrbit();
  }
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (dragState.sphere) {
    dragState.sphere.material.color.copy(sphereMat.color);
    dragState.sphere = null;
  }
  orbiting = false;
  renderer.domElement.releasePointerCapture(e.pointerId);
});

renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.radius = Math.max(3, Math.min(25, orbit.radius * (1 + e.deltaY * 0.001)));
  applyOrbit();
}, { passive: false });

// --- stats panel --------------------------------------------------------------
const statsEl = document.getElementById('stats');
let lastRebuildMs = 0;
let lastRebuildCount = 0;
const PATCH_NAMES = new Map(
  Object.entries(patches).map(([name, p]) => [p, name]),
);

function updateStats() {
  const s = surface.stats();
  const tol = surface.tolPx;
  const lines = [];
  for (const ps of s.perPatch) {
    const patch = surface.patches.find((p) => p.id === ps.id);
    const name = PATCH_NAMES.get(patch);
    const kind = name === 'A' || name === 'C' ? '平面' : '弯曲';
    lines.push(
      `patch ${name} (${kind})  三角形 ${String(ps.triangles).padStart(4)}  ` +
        `网格 ${ps.nu}x${ps.nv}  边级 [${ps.edgeLevel}]  偏差 ${ps.maxDevPx.toFixed(2)}px`,
    );
  }
  const ok = s.maxDevPx <= tol;
  lines.push('');
  lines.push(`总三角形数: ${s.triangles}`);
  lines.push(
    `最大屏幕偏差: ${s.maxDevPx.toFixed(3)}px / 容差 ${tol.toFixed(2)}px  ` +
      (ok ? '[OK]' : '[超差]'),
  );
  lines.push(`上次重建: ${lastRebuildCount}/4 个 patch, ${lastRebuildMs.toFixed(2)}ms`);
  statsEl.innerHTML =
    lines.join('\n') +
    `\n<span class="${ok ? 'ok' : 'bad'}">${ok ? '✓ 偏差在容差内, 共享边无 T 接缝' : '✗ 偏差超差'}</span>`;
}

// --- UI bindings ---------------------------------------------------------------
const tolInput = document.getElementById('tol');
const tolVal = document.getElementById('tolVal');
tolInput.addEventListener('input', () => {
  surface.tolPx = parseFloat(tolInput.value);
  tolVal.textContent = surface.tolPx.toFixed(2);
  needsRefit = true;
});
document.getElementById('wire').addEventListener('change', (e) => {
  for (const view of patchViews.values()) view.wire.visible = e.target.checked;
});
document.getElementById('ctrl').addEventListener('change', (e) => {
  ctrlGroup.visible = e.target.checked;
});
const spinInput = document.getElementById('spin');

// --- resize ---------------------------------------------------------------------
let needsRefit = true;
function resize() {
  const w = app.clientWidth;
  const h = app.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  needsRefit = true;
}
window.addEventListener('resize', resize);

// --- main loop --------------------------------------------------------------------
function frame() {
  requestAnimationFrame(frame);
  if (spinInput.checked) {
    orbit.theta += 0.004;
    applyOrbit();
  }
  if (orbit.moved) {
    needsRefit = true;
    orbit.moved = false;
  }
  if (needsRefit) {
    needsRefit = false;
    const t0 = performance.now();
    const rebuilt = surface.refit(makeProjector());
    lastRebuildMs = performance.now() - t0;
    lastRebuildCount = rebuilt.length;
    for (const p of rebuilt) uploadMesh(p);
  }
  updateStats();
  renderer.render(scene, camera);
}

// --- init ---------------------------------------------------------------------------
buildControlPoints(demoPts);
syncControlVisuals(demoPts);
resize();
applyOrbit();
frame();
