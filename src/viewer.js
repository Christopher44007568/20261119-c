import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const COLORS = {
  base: new THREE.Color('#5d8f86'),
  muted: new THREE.Color('#3a5b54'),
  nonmanifold: new THREE.Color('#ff6258'),
  duplicates: new THREE.Color('#d7ec62'),
  isolated: new THREE.Color('#bd8cff'),
  normals: new THREE.Color('#ffb454'),
  boundary: new THREE.Color('#54cfff'),
  selected: new THREE.Color('#55f5cf'),
  edge: new THREE.Color('#213a35'),
  white: new THREE.Color('#e9fff9'),
};

const DEFECT_COLORS = {
  nonmanifold: COLORS.nonmanifold,
  duplicates: COLORS.duplicates,
  isolated: COLORS.isolated,
  normals: COLORS.normals,
  boundary: COLORS.boundary,
};

export class MeshViewer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#080c0b');
    this.scene.fog = new THREE.FogExp2('#080c0b', 0.034);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
    this.camera.position.set(0.7, 3.4, 5.2);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.8;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 24;

    this.meshGroup = new THREE.Group();
    this.scene.add(this.meshGroup);
    this.setupLights();
    this.setupStage();
    this.state = {
      mesh: null,
      analysis: null,
      selection: null,
      showNormals: false,
      showEdges: true,
      showDefects: true,
      wireframe: false,
    };
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
  }

  setupLights() {
    this.scene.add(new THREE.HemisphereLight('#bfe5dc', '#07110e', 1.5));
    const key = new THREE.DirectionalLight('#e7fff8', 3.4);
    key.position.set(4, 7, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#43bba5', 2.2);
    rim.position.set(-5, 2, -4);
    this.scene.add(rim);
    const fill = new THREE.PointLight('#ffb454', 12, 14);
    fill.position.set(-3, -2, 4);
    this.scene.add(fill);
  }

  setupStage() {
    this.grid = new THREE.GridHelper(12, 24, '#294740', '#14211e');
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.52;
    this.scene.add(this.grid);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.7, 2.72, 96),
      new THREE.MeshBasicMaterial({
        color: '#27443d',
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -1.31;
    this.scene.add(ring);
    this.stageRing = ring;
  }

  setData(mesh, analysis, selection = null) {
    this.state.mesh = mesh;
    this.state.analysis = analysis;
    this.state.selection = selection;
    this.rebuild();
  }

  setSelection(selection) {
    this.state.selection = selection;
    this.rebuild(false);
  }

  setDisplayOptions(options) {
    Object.assign(this.state, options);
    this.rebuild(false);
  }

  faceColor(index) {
    const { analysis, selection, showDefects } = this.state;
    if (!showDefects) return COLORS.base;
    if (selection) {
      if (selection.faces?.includes(index)) return COLORS.selected;
      return COLORS.muted;
    }
    const isolated = analysis.isolatedFaces.includes(index);
    const nonManifold = analysis.nonManifoldGroups.some((group) =>
      group.faces.includes(index),
    );
    const flipped = analysis.normalGroups.some((group) => group.faces.includes(index));
    if (nonManifold) return COLORS.nonmanifold;
    if (isolated) return COLORS.isolated;
    if (flipped) return COLORS.normals;
    return COLORS.base;
  }

  edgeColor(edge) {
    const { analysis, selection, showDefects } = this.state;
    if (!showDefects) return COLORS.edge;
    if (selection?.edges?.some((item) => item.key === edge.key)) {
      return DEFECT_COLORS[selection.key] || COLORS.selected;
    }
    if (selection) {
      return edge.faces.some((face) => selection.faces?.includes(face))
        ? COLORS.selected
        : COLORS.muted;
    }
    if (edge.faces.length > 2) return COLORS.nonmanifold;
    if (edge.faces.length === 1) return COLORS.boundary;
    const flipped = analysis.normalGroups.some((group) =>
      edge.faces.some((face) => group.faces.includes(face)),
    );
    return flipped ? COLORS.normals : COLORS.edge;
  }

  rebuild(refit = true) {
    this.meshGroup.clear();
    const { mesh, analysis } = this.state;
    if (!mesh || !analysis) return;
    this.buildSurface();
    if (this.state.showEdges) this.buildEdges();
    this.buildVertexMarkers();
    if (this.state.showNormals) this.buildNormals();
    if (refit) this.fit();
  }

  buildSurface() {
    const { mesh } = this.state;
    if (!mesh.faces.length) return;
    const positions = new Float32Array(mesh.faces.length * 9);
    const colors = new Float32Array(mesh.faces.length * 9);
    mesh.faces.forEach((face, faceIndex) => {
      const color = this.faceColor(faceIndex);
      face.forEach((vertex, corner) => {
        const offset = faceIndex * 9 + corner * 3;
        const point = mesh.positions[vertex];
        positions[offset] = point[0];
        positions[offset + 1] = point[1];
        positions[offset + 2] = point[2];
        colors[offset] = color.r;
        colors[offset + 1] = color.g;
        colors[offset + 2] = color.b;
      });
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.56,
      metalness: 0.18,
      side: THREE.DoubleSide,
      flatShading: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      transparent: Boolean(this.state.selection),
      opacity: this.state.selection ? 0.9 : 0.97,
    });
    this.surface = new THREE.Mesh(geometry, material);
    this.meshGroup.add(this.surface);

    const shadow = new THREE.Mesh(
      geometry.clone(),
      new THREE.MeshBasicMaterial({
        color: '#06100d',
        transparent: true,
        opacity: 0.13,
        side: THREE.BackSide,
      }),
    );
    shadow.scale.setScalar(1.006);
    shadow.position.y = -0.018;
    this.meshGroup.add(shadow);
  }

  buildEdges() {
    const { mesh, analysis } = this.state;
    const positions = new Float32Array(analysis.topology.edgeList.length * 6);
    const colors = new Float32Array(analysis.topology.edgeList.length * 6);
    analysis.topology.edgeList.forEach((edge, index) => {
      const a = mesh.positions[edge.a];
      const b = mesh.positions[edge.b];
      const color = this.edgeColor(edge);
      positions.set([a[0], a[1], a[2], b[0], b[1], b[2]], index * 6);
      colors.set(
        [color.r, color.g, color.b, color.r, color.g, color.b],
        index * 6,
      );
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: this.state.selection ? 0.7 : 0.62,
      depthWrite: false,
    });
    this.meshGroup.add(new THREE.LineSegments(geometry, material));
  }

  buildVertexMarkers() {
    const { mesh, analysis, selection } = this.state;
    const groups = [];
    if (selection) {
      groups.push({
        vertices: selection.vertices || [],
        color: COLORS.white,
        size: 7,
      });
    } else {
      const duplicates = analysis.duplicateGroups
        .filter((group) => !group.intentional)
        .flatMap((group) => group.vertices);
      groups.push({ vertices: duplicates, color: COLORS.duplicates, size: 6 });
      groups.push({
        vertices: analysis.isolatedFaces.flatMap((face) => mesh.faces[face]),
        color: COLORS.isolated,
        size: 5,
      });
    }
    groups.forEach(({ vertices, color, size }) => {
      const unique = [...new Set(vertices)].slice(0, 400);
      if (!unique.length) return;
      const positions = new Float32Array(unique.length * 3);
      unique.forEach((vertex, index) => {
        positions.set(mesh.positions[vertex], index * 3);
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color,
        size,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.98,
        depthWrite: false,
      });
      this.meshGroup.add(new THREE.Points(geometry, material));
    });
  }

  buildNormals() {
    const { mesh, analysis, selection } = this.state;
    const issueFaces = new Set(analysis.normalGroups.flatMap((group) => group.faces));
    const faceIndices = selection
      ? [...new Set(selection.faces || [])]
      : mesh.faces.map((_, index) => index);
    faceIndices.slice(0, 90).forEach((faceIndex) => {
      const face = mesh.faces[faceIndex];
      if (!face) return;
      const a = new THREE.Vector3(...mesh.positions[face[0]]);
      const b = new THREE.Vector3(...mesh.positions[face[1]]);
      const c = new THREE.Vector3(...mesh.positions[face[2]]);
      const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const length = Math.min(0.34, Math.max(0.18, a.distanceTo(b) * 0.42));
      const color =
        issueFaces.has(faceIndex) || selection
          ? selection
            ? COLORS.selected
            : COLORS.normals
          : COLORS.base;
      this.meshGroup.add(
        new THREE.ArrowHelper(normal, center, length, color, length * 0.36, length * 0.2),
      );
    });
  }

  fit() {
    const { mesh } = this.state;
    if (!mesh?.positions.length) return;
    const box = new THREE.Box3().setFromPoints(
      mesh.positions.map((point) => new THREE.Vector3(...point)),
    );
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center.clone();
    const distance = Math.max(3.3, sphere.radius / Math.tan((this.camera.fov * Math.PI) / 360));
    const direction = new THREE.Vector3(0.17, 0.63, 1.5).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance * 1.08);
    this.camera.near = Math.max(0.01, distance / 100);
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = distance * 3;
    this.grid.position.y = box.min.y - 0.28;
    this.grid.scale.setScalar(Math.max(0.8, Math.min(1.8, sphere.radius * 0.62)));
    this.stageRing.position.y = box.min.y - 0.265;
    this.stageRing.scale.setScalar(Math.max(0.7, sphere.radius * 0.7));
    this.controls.update();
  }

  setView(view) {
    const target = this.controls.target.clone();
    const distance = this.camera.position.distanceTo(target);
    const directions = {
      iso: new THREE.Vector3(0.17, 0.63, 1.5),
      top: new THREE.Vector3(0.001, 1, 0.001),
      front: new THREE.Vector3(0, 0.22, 1),
    };
    const direction = (directions[view] || directions.iso).normalize();
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.controls.update();
  }

  resize() {
    const { clientWidth, clientHeight } = this.container;
    if (!clientWidth || !clientHeight) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
