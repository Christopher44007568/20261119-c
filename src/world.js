import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);

function canvasTexture(width, height, painter) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  painter(context, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function noiseTexture(base, fleck, size = 256) {
  const texture = canvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    let seed = 9137;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let index = 0; index < 1800; index += 1) {
      const alpha = 0.025 + random() * 0.09;
      ctx.fillStyle = `${fleck}${alpha})`;
      ctx.fillRect(random() * w, random() * h, 1 + random() * 3, 1 + random() * 2);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    for (let y = 32; y < h; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function labelTexture(title, subline, accent, width = 512, height = 192) {
  return canvasTexture(width, height, (ctx, w, h) => {
    ctx.fillStyle = "#071210";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(113, 193, 174, 0.32)";
    ctx.strokeRect(9, 9, w - 18, h - 18);
    ctx.fillStyle = accent;
    ctx.fillRect(24, 25, 42, 3);
    ctx.font = "500 19px monospace";
    ctx.fillText(subline.toUpperCase(), 24, 56);
    ctx.font = "300 44px sans-serif";
    ctx.fillText(title.toUpperCase(), 24, 111);
    ctx.fillStyle = "rgba(155, 202, 190, 0.65)";
    ctx.font = "12px monospace";
    ctx.fillText("THRESHOLD LINK / 8-BIT STENCIL / LIVE", 25, 151);
    ctx.strokeStyle = "rgba(113, 193, 174, 0.18)";
    for (let x = 25; x < w - 24; x += 15) {
      ctx.beginPath();
      ctx.moveTo(x, 164);
      ctx.lineTo(x + 5, 164);
      ctx.stroke();
    }
  });
}

function addBox(parent, size, position, material, rotation = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addGlowBar(parent, size, position, material, rotation = null) {
  const mesh = addBox(parent, size, position, material, rotation);
  mesh.castShadow = false;
  return mesh;
}

function addCeilingLights(parent, room, materials) {
  const count = 4;
  const zStep = room.depth / (count + 1);
  const zStart = -room.depth * 0.5 + zStep;
  for (let index = 0; index < count; index += 1) {
    const z = zStart + zStep * index;
    addBox(parent, [room.width * 0.24, 0.05, 0.18], [0, room.height - 0.08, z], materials.lightHousing);
    addGlowBar(
      parent,
      [room.width * 0.21, 0.018, 0.1],
      [0, room.height - 0.115, z],
      materials.lightStrip,
    );
  }
}

function addWallRibs(parent, room, materials) {
  const step = 2.6;
  for (let z = -room.depth * 0.5 + 1.1; z < room.depth * 0.5; z += step) {
    addBox(parent, [0.09, room.height, 0.16], [-room.width * 0.5 + 0.09, room.height * 0.5, z], materials.rib);
    addBox(parent, [0.09, room.height, 0.16], [room.width * 0.5 - 0.09, room.height * 0.5, z], materials.rib);
  }
}

function createPortalFrame(portal, materials) {
  const outer = 0.17;
  const depth = 0.32;
  const halfWidth = portal.width * 0.5;
  const halfHeight = portal.height * 0.5;
  const group = portal.group;
  addBox(group, [outer, portal.height + outer * 2, depth], [-halfWidth - outer * 0.5, 0, 0], materials.frame);
  addBox(group, [outer, portal.height + outer * 2, depth], [halfWidth + outer * 0.5, 0, 0], materials.frame);
  addBox(group, [portal.width + outer * 2, outer, depth], [0, halfHeight + outer * 0.5, 0], materials.frame);
  addBox(group, [portal.width + outer * 2, outer, depth], [0, -halfHeight - outer * 0.5, 0], materials.frame);
  addBox(group, [0.025, portal.height + 0.05, 0.36], [-halfWidth - 0.015, 0, 0.015], materials.trim);
  addBox(group, [0.025, portal.height + 0.05, 0.36], [halfWidth + 0.015, 0, 0.015], materials.trim);
  addBox(group, [portal.width + 0.05, 0.025, 0.36], [0, halfHeight + 0.015, 0.015], materials.trim);
  addBox(group, [portal.width + 0.05, 0.025, 0.36], [0, -halfHeight - 0.015, 0.015], materials.trim);

  const consolePanel = addBox(
    group,
    [0.28, 0.5, 0.1],
    [halfWidth + 0.24, 0.62, 0.14],
    materials.frame,
  );
  consolePanel.castShadow = false;
  addGlowBar(
    group,
    [0.17, 0.025, 0.012],
    [halfWidth + 0.24, 0.69, 0.197],
    materials.trim,
  );
  addGlowBar(
    group,
    [0.1, 0.018, 0.012],
    [halfWidth + 0.24, 0.62, 0.197],
    materials.trimDim,
  );
}

function createPortal({ id, room, position, rotationY, width, height, accent, frameColor }) {
  const group = new THREE.Group();
  group.name = `Portal ${id}`;
  group.position.set(position[0], position[1], position[2]);
  group.rotation.y = rotationY;

  const materials = {
    frame: new THREE.MeshStandardMaterial({
      color: frameColor,
      roughness: 0.36,
      metalness: 0.76,
    }),
    trim: new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 1.25,
      roughness: 0.28,
    }),
    trimDim: new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.3,
      roughness: 0.5,
    }),
  };

  const portal = {
    id,
    room,
    width,
    height,
    group,
    accent,
    materials,
    partner: null,
    surface: null,
  };
  createPortalFrame(portal, materials);

  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }),
  );
  surface.name = `Portal ${id} aperture`;
  surface.userData.portal = portal;
  group.add(surface);
  portal.surface = surface;

  const glow = new THREE.PointLight(accent, 10, 7, 2.2);
  glow.position.set(0, 0.4, 0.7);
  group.add(glow);
  portal.glow = glow;
  return portal;
}

function createRoomShell(group, spec, palette, portal) {
  const { width, height, depth } = spec;
  const wall = new THREE.MeshStandardMaterial({
    color: palette.wall,
    map: noiseTexture(palette.wallTexture, palette.fleck),
    roughness: 0.82,
    metalness: 0.14,
  });
  const floor = new THREE.MeshStandardMaterial({
    color: palette.floor,
    map: noiseTexture(palette.floorTexture, palette.fleck, 512),
    roughness: 0.71,
    metalness: 0.26,
  });
  const ceiling = new THREE.MeshStandardMaterial({
    color: palette.ceiling,
    roughness: 0.8,
    metalness: 0.2,
  });
  const rib = new THREE.MeshStandardMaterial({
    color: palette.rib,
    roughness: 0.48,
    metalness: 0.68,
  });
  const lightHousing = new THREE.MeshStandardMaterial({
    color: 0x151b1a,
    roughness: 0.42,
    metalness: 0.75,
  });
  const lightStrip = new THREE.MeshStandardMaterial({
    color: palette.light,
    emissive: palette.light,
    emissiveIntensity: 2.6,
    roughness: 0.2,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: palette.accent,
    emissive: palette.accent,
    emissiveIntensity: 0.5,
    roughness: 0.4,
  });
  const materials = { wall, floor, ceiling, rib, lightHousing, lightStrip, trim };
  const wallDepth = 0.28;
  const portalBottom = portal.group.position.y - portal.height * 0.5;
  const portalTop = portal.group.position.y + portal.height * 0.5;
  const portalCenterX = portal.group.position.x;
  const sideSegment = (width - portal.width - 0.34) * 0.5;

  addBox(group, [width, 0.26, depth], [0, -0.13, 0], floor);
  addBox(group, [width, 0.24, depth], [0, height + 0.12, 0], ceiling);
  addBox(group, [wallDepth, height, depth], [-width * 0.5, height * 0.5, 0], wall);
  addBox(group, [wallDepth, height, depth], [width * 0.5, height * 0.5, 0], wall);
  addBox(group, [width, height, wallDepth], [0, height * 0.5, depth * 0.5], wall);

  addBox(
    group,
    [sideSegment, height, wallDepth],
    [portalCenterX - portal.width * 0.5 - sideSegment * 0.5, height * 0.5, -depth * 0.5],
    wall,
  );
  addBox(
    group,
    [sideSegment, height, wallDepth],
    [portalCenterX + portal.width * 0.5 + sideSegment * 0.5, height * 0.5, -depth * 0.5],
    wall,
  );
  addBox(
    group,
    [portal.width + 0.34, portalBottom, wallDepth],
    [portalCenterX, portalBottom * 0.5, -depth * 0.5],
    wall,
  );
  addBox(
    group,
    [portal.width + 0.34, height - portalTop, wallDepth],
    [portalCenterX, (height + portalTop) * 0.5, -depth * 0.5],
    wall,
  );

  addBox(group, [width - 0.5, 0.36, 0.24], [0, 0.18, -depth * 0.5 + 0.34], rib);
  addBox(group, [4.3, 0.2, 0.26], [-3.5, height - 0.32, -depth * 0.5 + 0.33], rib);
  addBox(group, [3.8, 0.2, 0.26], [3.9, height - 0.32, -depth * 0.5 + 0.33], rib);
  addBox(group, [0.07, height - 0.4, 0.1], [-width * 0.37, height * 0.5, -depth * 0.5 + 0.18], trim);
  addBox(group, [0.07, height - 0.4, 0.1], [width * 0.37, height * 0.5, -depth * 0.5 + 0.18], trim);

  addWallRibs(group, { width, height, depth }, materials);
  addCeilingLights(group, { width, height, depth }, materials);

  const grid = new THREE.GridHelper(Math.max(width, depth), 28, palette.grid, palette.grid);
  grid.position.y = 0.012;
  grid.material.transparent = true;
  grid.material.opacity = 0.19;
  grid.material.depthWrite = false;
  group.add(grid);

  if (spec.id === "A") {
    const consoleMat = new THREE.MeshStandardMaterial({
      color: 0x183a34,
      emissive: palette.accent,
      emissiveIntensity: 0.12,
      roughness: 0.5,
      metalness: 0.5,
    });
    addBox(group, [0.6, 1.2, 2.4], [-width * 0.5 + 0.55, 0.6, -1.7], consoleMat);
    for (let index = 0; index < 5; index += 1) {
      addGlowBar(
        group,
        [0.03, 0.06, 0.28],
        [-width * 0.5 + 0.88, 0.43 + index * 0.13, -2.1],
        materials.lightStrip,
      );
    }
    addBox(group, [3.9, 0.16, 0.8], [3.2, 0.3, 4.1], rib);
    addBox(group, [0.16, 0.6, 0.16], [1.5, 0.3, 4.1], rib);
    addBox(group, [0.16, 0.6, 0.16], [4.9, 0.3, 4.1], rib);
  } else {
    addBench(group, width, palette, materials);
  }

  return materials;
}

function addBench(group, width, palette, materials) {
  const warmMetal = new THREE.MeshStandardMaterial({
    color: 0x4f4033,
    roughness: 0.54,
    metalness: 0.58,
  });
  const top = new THREE.MeshStandardMaterial({
    color: 0xa06d3e,
    roughness: 0.65,
    metalness: 0.15,
  });
  addBox(group, [3.1, 0.12, 0.9], [-2.45, 0.82, 3.7], top);
  addBox(group, [0.12, 0.75, 0.7], [-3.82, 0.4, 3.7], warmMetal);
  addBox(group, [0.12, 0.75, 0.7], [-1.08, 0.4, 3.7], warmMetal);
  addBox(group, [0.82, 0.7, 0.82], [2.8, 0.35, 1.6], warmMetal, [0, 0.28, 0]);
  addBox(group, [0.7, 0.55, 0.72], [3.55, 0.275, 1.3], warmMetal, [0, -0.16, 0]);
  addBox(group, [0.9, 1.35, 0.9], [width * 0.5 - 1.2, 0.675, -4.2], warmMetal);
  addGlowBar(group, [0.36, 0.11, 0.01], [-2.45, 0.95, 3.25], materials.trim);
}

function addPortalSign(portal) {
  const roomLabel = portal.room === "A" ? "SECTOR A" : "SECTOR B";
  const title = portal.room === "A" ? "GATE A-01" : "GATE B-02";
  const texture = labelTexture(title, roomLabel, `#${portal.accent.toString(16).padStart(6, "0")}`);
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const signWidth = THREE.MathUtils.clamp(portal.width + 0.44, 1.9, 3.7);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(signWidth, 0.64), material);
  sign.position.set(0, portal.height * 0.5 + 0.47, -0.03);
  portal.group.add(sign);
  portal.sign = sign;
}

export class PortalWorld {
  constructor(scene) {
    this.scene = scene;
    this.roomA = new THREE.Group();
    this.roomB = new THREE.Group();
    this.roomA.name = "Room A";
    this.roomB.name = "Room B";
    this.roomB.position.set(20.5, 0, 1.5);
    this.roomB.rotation.y = THREE.MathUtils.degToRad(68);
    scene.add(this.roomA, this.roomB);
    this.roomSpecs = {
      A: { id: "A", width: 13, height: 4.6, depth: 17.2 },
      B: { id: "B", width: 14.5, height: 5.1, depth: 18.5 },
    };
    this.portals = {};
    this.roomMaterials = {};
    this.create();
  }

  create() {
    const paletteA = {
      wall: 0x0a1d19,
      wallTexture: "#0b211c",
      fleck: "rgba(116, 201, 181, ",
      floor: 0x0b1715,
      floorTexture: "#0c1a17",
      ceiling: 0x07110f,
      rib: 0x18352f,
      light: 0xb3fff0,
      accent: 0x58e0b8,
      grid: 0x3b8c79,
    };
    const paletteB = {
      wall: 0x4a3022,
      wallTexture: "#432b1f",
      fleck: "rgba(226, 162, 98, ",
      floor: 0x2b1a13,
      floorTexture: "#321f17",
      ceiling: 0x1b100c,
      rib: 0x4a2d21,
      light: 0xffc483,
      accent: 0xe3a15a,
      grid: 0x8e5a34,
    };

    const portalA = createPortal({
      id: "A",
      room: "A",
      position: [0, 1.72, -8.36],
      rotationY: 0,
      width: 2.12,
      height: 3.18,
      accent: 0x58e0b8,
      frameColor: 0x122e29,
    });
    const portalB = createPortal({
      id: "B",
      room: "B",
      position: [0, 2.3, -9.02],
      rotationY: 0,
      width: 5.0,
      height: 4.45,
      accent: 0xe3a15a,
      frameColor: 0x38251b,
    });
    portalA.partner = portalB;
    portalB.partner = portalA;
    portalA.roomGroup = this.roomA;
    portalB.roomGroup = this.roomB;
    this.roomA.add(portalA.group);
    this.roomB.add(portalB.group);
    this.portals.A = portalA;
    this.portals.B = portalB;

    this.roomMaterials.A = createRoomShell(this.roomA, this.roomSpecs.A, paletteA, portalA);
    this.roomMaterials.B = createRoomShell(this.roomB, this.roomSpecs.B, paletteB, portalB);
    addPortalSign(portalA);
    addPortalSign(portalB);

    this.addLights(paletteA, paletteB);
    this.roomA.updateMatrixWorld(true);
    this.roomB.updateMatrixWorld(true);
  }

  addLights(paletteA, paletteB) {
    this.scene.add(new THREE.HemisphereLight(0x8cc8b8, 0x020504, 1.1));
    const lightA = new THREE.PointLight(paletteA.light, 38, 21, 1.6);
    lightA.position.set(0, 4.1, -2.2);
    lightA.castShadow = true;
    lightA.shadow.mapSize.set(1024, 1024);
    this.roomA.add(lightA);
    const lightB = new THREE.PointLight(paletteB.light, 88, 26, 1.55);
    lightB.position.set(-2.2, 4.4, -1.3);
    lightB.castShadow = true;
    lightB.shadow.mapSize.set(1024, 1024);
    this.roomB.add(lightB);
    const fillA = new THREE.PointLight(paletteA.accent, 12, 12, 2);
    fillA.position.set(3.8, 2.4, 3.6);
    this.roomA.add(fillA);
    const fillB = new THREE.PointLight(paletteB.accent, 34, 15, 1.8);
    fillB.position.set(3.3, 2.2, 2.9);
    this.roomB.add(fillB);
  }

  getPortalForRoom(room) {
    return this.portals[room];
  }

  detectRoom(worldPosition) {
    const candidates = [
      { id: "A", group: this.roomA, spec: this.roomSpecs.A },
      { id: "B", group: this.roomB, spec: this.roomSpecs.B },
    ];
    for (const candidate of candidates) {
      const local = candidate.group.worldToLocal(worldPosition.clone());
      if (
        Math.abs(local.x) < candidate.spec.width * 0.58 &&
        Math.abs(local.z) < candidate.spec.depth * 0.61
      ) {
        return candidate.id;
      }
    }
    return null;
  }

  getSpawn(portalId, distance = 2.2) {
    const portal = this.portals[portalId];
    const worldNormal = new THREE.Vector3(0, 0, 1).transformDirection(portal.group.matrixWorld);
    const worldPosition = new THREE.Vector3().setFromMatrixPosition(portal.group.matrixWorld);
    worldPosition.addScaledVector(worldNormal, distance);
    const lookTarget = worldPosition.clone().addScaledVector(worldNormal, -2);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(worldPosition, lookTarget, UP),
    );
    return { position: worldPosition, quaternion };
  }
}

export function setPortalSurfacesVisible(world, visible) {
  world.portals.A.surface.visible = visible;
  world.portals.B.surface.visible = visible;
}
