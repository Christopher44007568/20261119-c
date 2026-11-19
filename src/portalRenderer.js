import * as THREE from "three";
import { portalPairTransform } from "./portalMath.js";
import { setPortalSurfacesVisible } from "./world.js";

const MASK_REF = 1;

function createTerminationTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(512, 320, 20, 512, 320, 480);
  gradient.addColorStop(0, "#2d1b12");
  gradient.addColorStop(0.42, "#150d09");
  gradient.addColorStop(1, "#060504");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 640);

  ctx.strokeStyle = "rgba(229, 164, 95, 0.2)";
  ctx.lineWidth = 1;
  for (let radius = 82; radius < 370; radius += 29) {
    ctx.beginPath();
    ctx.arc(512, 320, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let y = 36; y < 610; y += 24) {
    ctx.fillStyle = "rgba(225, 163, 95, 0.035)";
    ctx.fillRect(36, y, 952, 1);
  }
  ctx.strokeStyle = "rgba(225, 163, 95, 0.45)";
  ctx.strokeRect(35.5, 35.5, 953, 569);
  ctx.setLineDash([7, 8]);
  ctx.strokeStyle = "rgba(225, 163, 95, 0.23)";
  ctx.strokeRect(47.5, 47.5, 929, 545);
  ctx.setLineDash([]);

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(229, 164, 95, 0.74)";
  ctx.font = "14px monospace";
  ctx.fillText("TERMINAL IMAGE / RECURSION CAP REACHED", 512, 89);
  ctx.font = "300 66px sans-serif";
  ctx.fillStyle = "#e3ac70";
  ctx.fillText("RECURSION", 512, 281);
  ctx.fillText("LIMIT", 512, 349);
  ctx.fillStyle = "rgba(239, 201, 158, 0.72)";
  ctx.font = "18px monospace";
  ctx.fillText("NO FURTHER LIVE VIEW IS COMPOSITED", 512, 403);
  ctx.fillStyle = "rgba(224, 163, 95, 0.22)";
  ctx.fillRect(316, 435, 392, 2);
  ctx.font = "13px monospace";
  ctx.fillText("A ↔ B / STENCIL BUFFER SEALED", 512, 469);
  ctx.strokeStyle = "rgba(238, 178, 112, 0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(512, 510);
  ctx.lineTo(545, 546);
  ctx.lineTo(530, 546);
  ctx.lineTo(530, 574);
  ctx.lineTo(494, 574);
  ctx.lineTo(494, 546);
  ctx.lineTo(479, 546);
  ctx.closePath();
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

export class PortalRenderer {
  constructor(renderer, scene, camera, world) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.chain = { cameras: [], portals: [] };
    this.targets = [];
    this.compositeMaterials = new Map();
    this.captures = [];
    this.captureSize = { width: 192, height: 120 };
    this.capturePixels = new Uint8Array(this.captureSize.width * this.captureSize.height * 4);
    this.debugCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.overlayScene = new THREE.Scene();
    this.debugScene = new THREE.Scene();
    this.maskScene = new THREE.Scene();
    this.overlayGeometry = new THREE.PlaneGeometry(2, 2);
    this.terminationTexture = createTerminationTexture();
    this.createMaterials();
    this.createMaskScene();
    this.createOverlay();
    this.createDebugTarget();
  }

  createMaterials() {
    this.maskMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      colorWrite: false,
      stencilWrite: true,
      stencilRef: MASK_REF,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    this.debugMaskMaterial = this.maskMaterial.clone();
    this.debugMaskMaterial.depthTest = false;

    this.compositeMaterial = new THREE.MeshBasicMaterial({
      map: null,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      transparent: false,
      stencilWrite: true,
      stencilRef: MASK_REF,
      stencilFunc: THREE.EqualStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });
    this.debugCompositeMaterial = new THREE.MeshBasicMaterial({
      color: 0x63d8ea,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      stencilWrite: true,
      stencilRef: MASK_REF,
      stencilFunc: THREE.EqualStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });
  }

  createMaskScene() {
    this.maskMeshes = {};
    for (const id of ["A", "B"]) {
      const portal = this.world.portals[id];
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(portal.width, portal.height),
        this.maskMaterial,
      );
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.maskMeshes[id] = mesh;
      this.maskScene.add(mesh);
    }
  }

  createOverlay() {
    this.overlayMesh = new THREE.Mesh(this.overlayGeometry, this.compositeMaterial);
    this.overlayMesh.frustumCulled = false;
    this.overlayMesh.renderOrder = 1000;
    this.overlayMesh.visible = false;
    this.overlayScene.add(this.overlayMesh);

    this.debugMaskMesh = new THREE.Mesh(this.overlayGeometry, this.debugMaskMaterial);
    this.debugMaskMesh.frustumCulled = false;
    this.debugMaskMesh.visible = false;
    this.debugScene.add(this.debugMaskMesh);

    this.debugCompositeMesh = new THREE.Mesh(this.overlayGeometry, this.debugCompositeMaterial);
    this.debugCompositeMesh.frustumCulled = false;
    this.debugCompositeMesh.renderOrder = 1000;
    this.debugCompositeMesh.visible = false;
    this.debugScene.add(this.debugCompositeMesh);
  }

  createDebugTarget() {
    this.debugTarget = new THREE.WebGLRenderTarget(
      this.captureSize.width,
      this.captureSize.height,
      {
        depthBuffer: true,
        stencilBuffer: true,
        format: THREE.RGBAFormat,
      },
    );
    this.debugTarget.texture.colorSpace = THREE.SRGBColorSpace;
  }

  ensureTargets(count, width, height) {
    const safeWidth = Math.max(2, width);
    const safeHeight = Math.max(2, height);
    while (this.targets.length < count) {
      const target = new THREE.WebGLRenderTarget(safeWidth, safeHeight, {
        depthBuffer: true,
        stencilBuffer: true,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
      target.texture.colorSpace = THREE.SRGBColorSpace;
      target.texture.generateMipmaps = false;
      this.targets.push(target);
    }
    for (let index = 0; index < count; index += 1) {
      const target = this.targets[index];
      if (target.width !== safeWidth || target.height !== safeHeight) {
        target.setSize(safeWidth, safeHeight);
      }
    }
  }

  buildChain(baseCamera, portalId, cap) {
    const startPortal = this.world.getPortalForRoom(portalId);
    const cameras = [baseCamera];
    const portals = [startPortal];
    for (let depth = 1; depth <= cap; depth += 1) {
      const sourcePortal = portals[depth - 1];
      const destinationPortal = sourcePortal.partner;
      const pair = portalPairTransform(
        sourcePortal.group.matrixWorld,
        destinationPortal.group.matrixWorld,
      );
      const worldMatrix = pair.multiply(cameras[depth - 1].matrixWorld);
      const camera = cameras[depth - 1].clone();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      worldMatrix.decompose(position, quaternion, scale);
      camera.position.copy(position);
      camera.quaternion.copy(quaternion);
      camera.fov = Math.min(104, baseCamera.fov + depth * 6.5);
      camera.updateProjectionMatrix();
      camera.matrixAutoUpdate = true;
      camera.updateMatrixWorld(true);
      cameras.push(camera);
      portals.push(destinationPortal);
    }
    this.chain = { cameras, portals };
    return this.chain;
  }

  render(baseCamera, portalId, cap, targetWidth, targetHeight) {
    setPortalSurfacesVisible(this.world, false);
    const chain = this.buildChain(baseCamera, portalId, cap);
    this.ensureTargets(cap, targetWidth, targetHeight);
    this.renderer.autoClear = false;
    this.lastRenderRooms = [];

    for (let depth = cap; depth >= 1; depth -= 1) {
      const target = this.targets[depth - 1];
      this.bindAndClear(target);
      this.setRoomVisibility(chain.portals[depth].room);
      this.lastRenderRooms.push({
        depth,
        room: chain.portals[depth].room,
        visibleA: this.world.roomA.visible,
        visibleB: this.world.roomB.visible,
      });
      this.renderer.render(this.scene, chain.cameras[depth]);
      if (depth < cap) {
        this.composePortal(
          chain.portals[depth],
          chain.cameras[depth],
          this.targets[depth].texture,
        );
      } else {
        this.composePortal(
          chain.portals[depth],
          chain.cameras[depth],
          this.terminationTexture,
        );
      }
    }

    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(this.scene.background ?? 0x020706, 1);
    this.renderer.clear(true, true, true);
    this.setRoomVisibility(chain.portals[0].room);
    this.renderer.render(this.scene, baseCamera);
    if (cap > 0) {
      this.composePortal(chain.portals[0], baseCamera, this.targets[0].texture);
    } else {
      this.composePortal(chain.portals[0], baseCamera, this.terminationTexture);
    }
    this.renderer.state.buffers.stencil.setTest(false);
  }

  setRoomVisibility(room) {
    this.world.roomA.visible = room === "A";
    this.world.roomB.visible = room === "B";
  }

  bindAndClear(target) {
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(this.scene.background ?? 0x020706, 1);
    this.renderer.clear(true, true, true);
  }

  syncMaskMesh(portal) {
    const mesh = this.maskMeshes[portal.id];
    mesh.matrix.copy(portal.surface.matrixWorld);
    mesh.matrixWorld.copy(portal.surface.matrixWorld);
    return mesh;
  }

  hideMaskMeshes() {
    this.maskMeshes.A.visible = false;
    this.maskMeshes.B.visible = false;
  }

  composePortal(portal, camera, texture) {
    this.hideMaskMeshes();
    const mesh = this.syncMaskMesh(portal);
    mesh.visible = true;

    this.renderer.clearStencil();
    this.renderer.state.buffers.stencil.setTest(true);
    this.renderer.render(this.maskScene, camera);
    mesh.visible = false;

    const material = this.getCompositeMaterial(texture);
    this.overlayMesh.material = material;
    this.lastCompose = {
      portal: portal.id,
      texture: texture.uuid,
      termination: texture === this.terminationTexture,
      material: material.uuid,
      materialMap: material.map?.uuid,
    };
    this.overlayMesh.visible = true;
    this.renderer.render(this.overlayScene, this.debugCamera);
    this.overlayMesh.visible = false;
    this.renderer.clearStencil();
  }

  getCompositeMaterial(texture) {
    let material = this.compositeMaterials.get(texture.uuid);
    if (!material) {
      material = this.compositeMaterial.clone();
      material.map = texture;
      material.needsUpdate = true;
      this.compositeMaterials.set(texture.uuid, material);
    }
    return material;
  }

  captureMask(portal, camera, terminal = false) {
    this.hideMaskMeshes();
    const mesh = this.syncMaskMesh(portal);
    mesh.visible = true;
    mesh.material = this.debugMaskMaterial;

    this.renderer.setRenderTarget(this.debugTarget);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear(true, true, true);
    this.renderer.state.buffers.stencil.setTest(true);
    this.renderer.render(this.maskScene, camera);
    mesh.visible = false;
    mesh.material = this.maskMaterial;

    this.debugCompositeMaterial.color.setHex(terminal ? 0xe3a15a : 0x63d8ea);
    this.debugCompositeMesh.visible = true;
    this.renderer.render(this.debugScene, this.debugCamera);
    this.debugCompositeMesh.visible = false;

    const { width, height } = this.captureSize;
    this.renderer.readRenderTargetPixels(
      this.debugTarget,
      0,
      0,
      width,
      height,
      this.capturePixels,
    );
    const image = new ImageData(width, height);
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      const sourceRow = height - 1 - y;
      for (let x = 0; x < width; x += 1) {
        const source = (sourceRow * width + x) * 4;
        const destination = (y * width + x) * 4;
        const value = this.capturePixels[source];
        image.data[destination] = this.capturePixels[source];
        image.data[destination + 1] = this.capturePixels[source + 1];
        image.data[destination + 2] = this.capturePixels[source + 2];
        image.data[destination + 3] = 255;
        if (value > 12) count += 1;
      }
    }
    this.renderer.clearStencil();
    this.renderer.setRenderTarget(null);
    return { imageData: image, count };
  }

  captureChain() {
    const { cameras, portals } = this.chain;
    if (!cameras.length || !portals.length) return [];
    const captures = [];
    for (let index = 0; index < portals.length; index += 1) {
      captures.push(this.captureMask(portals[index], cameras[index], index === portals.length - 1));
    }
    this.renderer.setClearColor(this.scene.background ?? 0x020706, 1);
    return captures;
  }
}
