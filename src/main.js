import * as THREE from "three";
import "./style.css";
import { PortalWorld } from "./world.js";
import { PortalRenderer } from "./portalRenderer.js";
import { RecursionInspector } from "./inspector.js";
import {
  isInsideAperture,
  portalPairTransform,
  signedPortalDistance,
} from "./portalMath.js";

const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  stencil: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020706);
scene.fog = new THREE.FogExp2(0x03100d, 0.018);

const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.05,
  130,
);
camera.rotation.order = "YXZ";

const world = new PortalWorld(scene);
const portalRenderer = new PortalRenderer(renderer, scene, camera, world);
const inspector = new RecursionInspector(renderer, portalRenderer);

const state = {
  cap: 5,
  room: "A",
  portalId: "A",
  yaw: 0,
  pitch: -0.015,
  keys: new Set(),
  cooldown: 0,
  lastCaptures: [],
  dragging: false,
  pointerX: 0,
  pointerY: 0,
};

const initialPose = {
  position: new THREE.Vector3(0, 1.68, -3.6),
  yaw: 0,
  pitch: -0.018,
};

const toast = document.querySelector("#toast");
const orientationNote = document.querySelector("#orientation-note");
const fpsElement = document.querySelector("#fps");
let toastTimer = 0;

function setCameraPose(position, yaw, pitch) {
  camera.position.copy(position);
  camera.rotation.set(pitch, yaw, 0);
  camera.updateMatrixWorld(true);
  state.yaw = yaw;
  state.pitch = pitch;
}

function syncAnglesFromQuaternion() {
  const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
  state.pitch = euler.x;
  state.yaw = euler.y;
}

function resetView() {
  state.room = "A";
  state.portalId = "A";
  state.cooldown = 0.4;
  setCameraPose(initialPose.position, initialPose.yaw, initialPose.pitch);
  showToast("OBSERVER RESET · ROOM A / GATE A-01");
}

function showToast(message, duration = 1900) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), duration);
}

function activePortal() {
  return world.portals[state.portalId] ?? world.getPortalForRoom(state.room);
}

function updateRoomFromPosition() {
  const detected = world.detectRoom(camera.position);
  if (detected) {
    state.room = detected;
    if (state.portalId !== detected) state.portalId = detected;
  }
}

function performTeleport(portal, crossedMatrix) {
  const sourceMatrix = crossedMatrix.clone();
  const destination = portal.partner;
  const pair = portalPairTransform(portal.group.matrixWorld, destination.group.matrixWorld);
  const transformed = pair.clone().multiply(sourceMatrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  transformed.decompose(position, quaternion, scale);

  const before = camera.position.clone();
  camera.position.copy(position);
  camera.quaternion.copy(quaternion);
  camera.updateMatrixWorld(true);
  syncAnglesFromQuaternion();
  state.room = destination.room;
  state.portalId = destination.id;
  state.cooldown = 0.48;
  updateRoomFromPosition();
  window.__portalDebug.lastTraversal = {
    source: portal.id,
    destination: destination.id,
    before: before.toArray(),
    beforeMatrix: sourceMatrix.elements.slice(),
    after: camera.position.toArray(),
    cameraMatrix: camera.matrixWorld.elements.slice(),
    pairMatrix: pair.elements.slice(),
    at: performance.now(),
  };
  showToast(`TRAVERSAL COMPLETE · ROOM ${destination.room} · CAMERA RECOMPUTED`);
}

function attemptPortalCrossing(previousPosition) {
  if (state.cooldown > 0) return;
  const portal = activePortal();
  if (!portal) return;
  const previousSide = signedPortalDistance(previousPosition, portal.group.matrixWorld);
  const currentSide = signedPortalDistance(camera.position, portal.group.matrixWorld);
  if (
    previousSide > 0 &&
    currentSide <= 0 &&
    isInsideAperture(camera.position, portal.group.matrixWorld, portal.width, portal.height, 0.04)
  ) {
    performTeleport(portal, camera.matrixWorld);
  }
}

function setView(kind) {
  const portal = world.portals.A;
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(portal.group.matrixWorld);
  const center = new THREE.Vector3().setFromMatrixPosition(portal.group.matrixWorld);
  state.cooldown = 0.35;
  state.room = "A";
  state.portalId = "A";

  if (kind === "near") {
    const position = center.clone().addScaledVector(normal, 1.75);
    position.x += 0.08;
    setCameraPose(position, 0, -0.015);
    showToast("NEAR FIELD · APERTURE 1.75 M");
  } else if (kind === "backside") {
    const position = center.clone().addScaledVector(normal, -1.12);
    position.x += 0.25;
    setCameraPose(position, Math.PI, 0.01);
    showToast("BACKSIDE PROBE · OUTSIDE APERTURE REMAINS INTACT");
  } else if (kind === "overlap") {
    const position = center.clone().addScaledVector(normal, 0.96);
    position.x += 1.03;
    setCameraPose(position, 0.22, -0.025);
    showToast("OVERLAP FIELD · NESTED FRAMES ALIGNED");
  } else {
    resetView();
  }
}

function beginTraverse() {
  const portal = activePortal();
  const front = world.getSpawn(portal.id, 0.09);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(portal.group.matrixWorld);
  camera.position.copy(front.position).addScaledVector(normal, -0.18);
  camera.quaternion.copy(front.quaternion);
  camera.updateMatrixWorld(true);
  syncAnglesFromQuaternion();
  performTeleport(portal, camera.matrixWorld);
}

function updateMovement(delta) {
  const speed = state.keys.has("ShiftLeft") || state.keys.has("ShiftRight") ? 5.6 : 2.8;
  const forwardAmount = (state.keys.has("KeyW") ? 1 : 0) - (state.keys.has("KeyS") ? 1 : 0);
  const rightAmount = (state.keys.has("KeyD") ? 1 : 0) - (state.keys.has("KeyA") ? 1 : 0);
  if (!forwardAmount && !rightAmount) return;

  const sine = Math.sin(state.yaw);
  const cosine = Math.cos(state.yaw);
  const direction = new THREE.Vector3(
    -sine * forwardAmount + cosine * rightAmount,
    0,
    -cosine * forwardAmount - sine * rightAmount,
  ).normalize();
  const previousPosition = camera.position.clone();
  camera.position.addScaledVector(direction, speed * delta);
  camera.updateMatrixWorld(true);
  attemptPortalCrossing(previousPosition);
  updateRoomFromPosition();
}

function updateHud(now) {
  inspector.updateChain(portalRenderer.chain);
  inspector.setRoom(state.room, activePortal(), camera);
  document.body.dataset.room = state.room;
  document.body.dataset.cap = String(state.cap);
  document.body.dataset.portal = state.portalId;
}

let lastFrame = performance.now();
let fpsStarted = performance.now();
let frameCount = 0;
let lastHud = 0;
let lastCapture = 0;
const bufferSize = new THREE.Vector2();

function targetDimensions() {
  renderer.getDrawingBufferSize(bufferSize);
  const scale = Math.min(0.8, 1280 / Math.max(1, bufferSize.x));
  return [
    Math.max(320, Math.round(bufferSize.x * scale)),
    Math.max(200, Math.round(bufferSize.y * scale)),
  ];
}

function renderFrame(now) {
  const delta = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;
  state.cooldown = Math.max(0, state.cooldown - delta);
  updateMovement(delta);

  const [targetWidth, targetHeight] = targetDimensions();
  portalRenderer.render(camera, state.portalId, state.cap, targetWidth, targetHeight);
  inspector.rebuild(portalRenderer.chain, state.cap);

  if (now - lastHud > 110) {
    updateHud(now);
    lastHud = now;
  }

  if (now - lastCapture > 620) {
    state.lastCaptures = portalRenderer.captureChain();
    inspector.applyCaptures(state.lastCaptures);
    lastCapture = now;
  }

  frameCount += 1;
  if (now - fpsStarted > 700) {
    fpsElement.textContent = String(Math.max(1, Math.round((frameCount * 1000) / (now - fpsStarted))));
    fpsStarted = now;
    frameCount = 0;
  }
  requestAnimationFrame(renderFrame);
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  state.dragging = true;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
  orientationNote.style.opacity = "0";
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  const movementX = event.clientX - state.pointerX;
  const movementY = event.clientY - state.pointerY;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  state.yaw -= movementX * 0.0032;
  state.pitch -= movementY * 0.0027;
  state.pitch = THREE.MathUtils.clamp(state.pitch, -1.48, 1.48);
  camera.rotation.set(state.pitch, state.yaw, 0);
  camera.updateMatrixWorld(true);
});

for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
  canvas.addEventListener(type, () => {
    state.dragging = false;
  });
}

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    const previousPosition = camera.position.clone();
    camera.position.addScaledVector(direction, -event.deltaY * 0.0022);
    camera.updateMatrixWorld(true);
    attemptPortalCrossing(previousPosition);
    updateRoomFromPosition();
  },
  { passive: false },
);

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  state.keys.add(event.code);
  if (event.code === "KeyR") resetView();
  if (event.code === "KeyT") beginTraverse();
  if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight"].includes(event.code)) {
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  state.keys.delete(event.code);
});

window.addEventListener("blur", () => {
  state.keys.clear();
  state.dragging = false;
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "traverse") beginTraverse();
    else if (action === "reset") resetView();
    else setView(action);
  });
});

const depthInput = document.querySelector("#depth");
depthInput.addEventListener("input", () => {
  state.cap = Number(depthInput.value);
  state.lastCaptures = [];
  lastCapture = 0;
  document.querySelector("#depth-badge").textContent = String(state.cap).padStart(2, "0");
  document.querySelector("#depth-output").textContent = String(state.cap).padStart(2, "0");
});

document.querySelector("#collapse").addEventListener("click", () => {
  document.querySelector(".inspector").classList.toggle("collapsed");
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  lastCapture = 0;
});

window.__portalDebug = {
  get state() {
    return {
      room: state.room,
      portalId: state.portalId,
      cap: state.cap,
      cooldown: state.cooldown,
      camera: {
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        matrixWorld: camera.matrixWorld.elements.slice(),
      },
      layers: portalRenderer.chain.portals.map((portal, index) => ({
        layer: index,
        room: portal.room,
        portal: portal.id,
        matrixWorld: portalRenderer.chain.cameras[index]?.matrixWorld.elements.slice() ?? [],
        stencilPixels: state.lastCaptures[index]?.count ?? 0,
      })),
    };
  },
  setDepth(value) {
    depthInput.value = String(THREE.MathUtils.clamp(value, 0, 7));
    depthInput.dispatchEvent(new Event("input"));
  },
  setView,
  traverse: beginTraverse,
  reset: resetView,
  scene,
  camera,
  renderer,
  portalRenderer,
  THREE,
};

resetView();
showToast("LIVE STENCIL LINK · DRAG TO LOOK / WALK THROUGH GATE", 2600);
requestAnimationFrame(renderFrame);
