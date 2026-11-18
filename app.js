(() => {
  'use strict';

  const canvas = document.querySelector('#scene');
  const errorPanel = document.querySelector('#error');
  const specimensRoot = document.querySelector('#specimens');
  const absorptionInput = document.querySelector('#absorption');
  const absorptionOutput = document.querySelector('#absorption-output');
  const absorptionReadout = document.querySelector('#absorb-value');
  const activePlates = document.querySelector('#active-plates');
  const fpsReadout = document.querySelector('#fps');
  const resetButton = document.querySelector('#reset-view');

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });

  if (!gl) {
    showError('WebGL 2 is required to render the refractive glass study.');
    return;
  }

  const SPECIMENS = [
    { id: 'A', label: 'Float', color: '#d8d4ff', thickness: 6, max: 60 },
    { id: 'B', label: 'Crown', color: '#9ef4e3', thickness: 18, max: 60 },
    { id: 'C', label: 'Dense', color: '#ffb39d', thickness: 42, max: 60 },
  ];

  const state = {
    thickness: SPECIMENS.map((specimen) => specimen.thickness),
    absorption: 1,
    orbit: { yaw: 0.035, pitch: 0.018, radius: 7.45 },
    targetOrbit: { yaw: 0.035, pitch: 0.018, radius: 7.45 },
    pointerId: null,
    lastPointer: { x: 0, y: 0 },
    lastTime: performance.now(),
    frames: 0,
    fpsElapsed: 0,
  };

  buildSpecimenControls();
  bindPointerControls();
  bindResetControl();
  updateReadouts();

  const vertexSource = `#version 300 es
    precision highp float;

    void main() {
      vec2 corner = vec2(
        (gl_VertexID == 1) ? 3.0 : -1.0,
        (gl_VertexID == 2) ? 3.0 : -1.0
      );
      gl_Position = vec4(corner, 0.0, 1.0);
    }
  `;

  const fragmentSource = `#version 300 es
    precision highp float;
    precision highp int;

    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec3 uThickness;
    uniform float uAbsorption;
    uniform vec3 uCamera;
    uniform vec3 uTarget;

    out vec4 outColor;

    const float PI = 3.14159265359;
    const float EPSILON = 1e-5;
    const float IOR = 1.46;
    const int MAX_DEPTH = 6;
    const int MAX_INTERNAL_BOUNCES = 5;
    const int MAX_SCENE_STEPS = 8;
    const vec3 ABSORPTION_SPECTRUM = vec3(0.95, 0.30, 0.19) * 1.35;
    const vec3 TRUNCATED_CONTRIBUTION = vec3(1.0, 0.30, 0.09);

    struct Pane {
      vec3 center;
      vec3 halfSize;
      float yaw;
    };

    struct Hit {
      bool valid;
      float distance;
      int paneIndex;
      vec3 point;
      vec3 normal;
      vec3 localPoint;
      vec3 localDirection;
    };

    struct SlabResult {
      bool escaped;
      bool truncated;
      vec3 origin;
      vec3 direction;
      vec3 transmittance;
      float pathLength;
    };

    float hash21(vec2 value) {
      value = fract(value * vec2(123.34, 456.21));
      value += dot(value, value + 45.32);
      return fract(value.x * value.y);
    }

    vec3 rotateFromLocal(vec3 value, float yaw) {
      float cosine = cos(yaw);
      float sine = sin(yaw);
      return vec3(
        cosine * value.x + sine * value.z,
        value.y,
        -sine * value.x + cosine * value.z
      );
    }

    vec3 rotateToLocal(vec3 value, float yaw) {
      float cosine = cos(yaw);
      float sine = sin(yaw);
      return vec3(
        cosine * value.x - sine * value.z,
        value.y,
        sine * value.x + cosine * value.z
      );
    }

    Pane paneAt(int index) {
      if (index == 0) {
        return Pane(
          vec3(-1.56, 0.34, 0.72),
          vec3(0.81, 1.64, max(uThickness.x, 0.0) * 0.5),
          -0.27
        );
      }
      if (index == 1) {
        return Pane(
          vec3(0.08, 0.03, 0.03),
          vec3(1.14, 1.90, max(uThickness.y, 0.0) * 0.5),
          0.07
        );
      }
      return Pane(
        vec3(1.78, -0.17, -0.72),
        vec3(0.86, 1.57, max(uThickness.z, 0.0) * 0.5),
        0.30
      );
    }

    float softEllipse(vec2 point, vec2 center, vec2 radius) {
      vec2 local = (point - center) / radius;
      return exp(-dot(local, local));
    }

    vec3 reflectedStudio(vec3 direction) {
      float height = direction.y;
      vec3 color = mix(
        vec3(0.003, 0.006, 0.010),
        vec3(0.021, 0.035, 0.047),
        smoothstep(-0.45, 0.86, height)
      );

      float warmKey = softEllipse(
        vec2(direction.x, direction.y),
        vec2(-0.40, 0.54),
        vec2(0.20, 0.28)
      );
      float coolFill = softEllipse(
        vec2(direction.x, direction.y),
        vec2(0.62, -0.08),
        vec2(0.27, 0.40)
      );
      float overhead = smoothstep(0.50, 0.98, height);
      float narrowStrip = exp(-pow((direction.x - 0.18) / 0.028, 2.0));
      narrowStrip *= smoothstep(-0.45, 0.30, height) * smoothstep(0.72, 0.35, abs(height - 0.12));
      float frontSoftbox = exp(
        -pow((direction.x + 0.06) / 0.48, 2.0) -
        pow((direction.y - 0.05) / 0.42, 2.0)
      );
      frontSoftbox *= smoothstep(0.15, 0.92, direction.z);

      color += vec3(1.0, 0.46, 0.30) * warmKey * 1.55;
      color += vec3(0.27, 0.88, 0.81) * coolFill * 0.68;
      color += vec3(0.30, 0.44, 0.48) * overhead * 0.20;
      color += vec3(0.66, 0.96, 0.92) * narrowStrip * 0.24;
      float warmPanel = exp(
        -pow((direction.x + 0.28) / 0.30, 2.0) -
        pow((direction.y - 0.12) / 0.36, 2.0)
      );
      warmPanel *= smoothstep(0.12, 0.86, direction.z);

      color += vec3(0.36, 0.78, 0.72) * frontSoftbox * 2.60;
      color += vec3(0.94, 0.39, 0.22) * warmPanel * 0.42;
      return color;
    }

    vec3 backdrop(vec3 direction) {
      float azimuth = atan(direction.x, -direction.z);
      float elevation = asin(clamp(direction.y, -1.0, 1.0));
      vec2 spherical = vec2(azimuth, elevation);

      vec3 color = mix(
        vec3(0.006, 0.011, 0.018),
        vec3(0.030, 0.038, 0.056),
        smoothstep(-0.85, 0.95, elevation)
      );

      float centralGlow = softEllipse(
        spherical,
        vec2(-0.15, 0.015),
        vec2(0.27, 0.20)
      );
      float warmCore = softEllipse(
        spherical,
        vec2(-0.12, 0.01),
        vec2(0.13, 0.11)
      );
      float aquaVeil = softEllipse(
        spherical,
        vec2(0.63, -0.06),
        vec2(0.31, 0.25)
      );

      color += vec3(0.94, 0.18, 0.045) * centralGlow * 0.30;
      color += vec3(1.0, 0.38, 0.12) * warmCore * 0.44;
      color += vec3(0.055, 0.54, 0.48) * aquaVeil * 0.31;

      float ringRadius = length(spherical / vec2(0.47, 0.31));
      float ring = smoothstep(0.024, 0.002, abs(ringRadius - 1.0));
      ring *= smoothstep(-0.25, 0.10, elevation);
      color += mix(
        vec3(1.0, 0.31, 0.12),
        vec3(0.27, 0.94, 0.80),
        smoothstep(-0.7, 0.7, azimuth)
      ) * ring * 0.18;

      float columnCoordinate = spherical.x * 5.4 + 0.16 * sin(spherical.y * 3.0 + uTime * 0.07);
      float columns = smoothstep(0.014, 0.0, abs(fract(columnCoordinate + 0.5) - 0.5));
      columns *= smoothstep(0.75, -0.10, abs(elevation));
      color += mix(
        vec3(0.95, 0.29, 0.12),
        vec3(0.28, 0.92, 0.80),
        0.5 + 0.5 * sin(spherical.x * 4.4)
      ) * columns * 0.072;

      float horizon = exp(-pow((elevation + 0.14) / 0.075, 2.0));
      horizon *= 0.28 + 0.72 * exp(-pow(azimuth / 1.25, 2.0));
      color += vec3(0.50, 0.12, 0.04) * horizon * 0.08;

      vec2 dustGrid = spherical * vec2(96.0, 58.0);
      vec2 dustCell = floor(dustGrid);
      float dust = step(0.992, hash21(dustCell));
      dust *= smoothstep(0.17, 0.0, length(fract(dustGrid) - 0.5));
      color += vec3(0.72, 0.98, 0.94) * dust * 0.55;

      return color;
    }

    bool intersectPane(Pane pane, vec3 rayOrigin, vec3 rayDirection, out Hit hit) {
      hit = Hit(false, 1e20, -1, vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
      if (pane.halfSize.z <= EPSILON) return false;

      vec3 localOrigin = rotateToLocal(rayOrigin - pane.center, pane.yaw);
      vec3 localDirection = rotateToLocal(rayDirection, pane.yaw);
      vec3 inverseDirection = 1.0 / localDirection;
      vec3 boundsA = (-pane.halfSize - localOrigin) * inverseDirection;
      vec3 boundsB = (pane.halfSize - localOrigin) * inverseDirection;
      vec3 nearBounds = min(boundsA, boundsB);
      vec3 farBounds = max(boundsA, boundsB);

      float nearDistance = max(max(nearBounds.x, nearBounds.y), nearBounds.z);
      float farDistance = min(min(farBounds.x, farBounds.y), farBounds.z);
      if (farDistance <= nearDistance || nearDistance <= EPSILON) return false;

      vec3 localNormal;
      if (nearDistance == nearBounds.x) {
        localNormal = vec3(-sign(localDirection.x), 0.0, 0.0);
      } else if (nearDistance == nearBounds.y) {
        localNormal = vec3(0.0, -sign(localDirection.y), 0.0);
      } else {
        localNormal = vec3(0.0, 0.0, -sign(localDirection.z));
      }

      hit.valid = true;
      hit.distance = nearDistance;
      hit.point = rayOrigin + rayDirection * nearDistance;
      hit.normal = rotateFromLocal(localNormal, pane.yaw);
      hit.localPoint = localOrigin + localDirection * nearDistance;
      hit.localDirection = localDirection;
      return true;
    }

    Hit findNearestPane(vec3 rayOrigin, vec3 rayDirection) {
      Hit nearest = Hit(false, 1e20, -1, vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));

      for (int index = 0; index < 3; index++) {
        Pane pane = paneAt(index);
        Hit candidate;
        if (intersectPane(pane, rayOrigin, rayDirection, candidate)) {
          if (candidate.distance < nearest.distance) {
            candidate.paneIndex = index;
            nearest = candidate;
          }
        }
      }

      return nearest;
    }

    float fresnelReflectance(float cosine, float incidentIor) {
      float f0 = pow((incidentIor - 1.0) / (incidentIor + 1.0), 2.0);
      return clamp(f0 + (1.0 - f0) * pow(1.0 - cosine, 5.0), 0.0, 1.0);
    }

    bool refractDirection(
      vec3 incident,
      vec3 facingNormal,
      float eta,
      out vec3 transmitted
    ) {
      float cosine = dot(facingNormal, incident);
      float discriminant = 1.0 - eta * eta * (1.0 - cosine * cosine);
      if (discriminant < 0.0) {
        transmitted = vec3(0.0);
        return false;
      }
      transmitted = normalize(
        eta * incident - (eta * cosine + sqrt(discriminant)) * facingNormal
      );
      return true;
    }

    bool parallelSlabExit(
      vec3 localPoint,
      vec3 localDirection,
      vec3 halfSize,
      out vec3 exitPoint,
      out vec3 exitNormal,
      out float travel
    ) {
      if (abs(localDirection.z) <= EPSILON) return false;

      float exitPlane = sign(localDirection.z) * halfSize.z;
      travel = (exitPlane - localPoint.z) / localDirection.z;
      if (travel <= EPSILON) return false;

      exitPoint = localPoint + localDirection * travel;
      if (
        abs(exitPoint.x) > halfSize.x - EPSILON ||
        abs(exitPoint.y) > halfSize.y - EPSILON
      ) {
        return false;
      }

      exitNormal = vec3(0.0, 0.0, sign(localDirection.z));
      return true;
    }

    bool nextBoxFace(
      vec3 localPoint,
      vec3 localDirection,
      vec3 halfSize,
      out vec3 exitPoint,
      out vec3 exitNormal,
      out float travel
    ) {
      vec3 targets = sign(localDirection) * halfSize;
      vec3 distances = (targets - localPoint) / localDirection;
      distances.x = abs(localDirection.x) > EPSILON ? distances.x : 1e20;
      distances.y = abs(localDirection.y) > EPSILON ? distances.y : 1e20;
      distances.z = abs(localDirection.z) > EPSILON ? distances.z : 1e20;
      distances = mix(distances, vec3(1e20), lessThan(distances, vec3(EPSILON)));

      travel = min(min(distances.x, distances.y), distances.z);
      if (travel >= 1e19) return false;

      exitPoint = localPoint + localDirection * travel;
      if (travel == distances.x) {
        exitNormal = vec3(sign(localDirection.x), 0.0, 0.0);
      } else if (travel == distances.y) {
        exitNormal = vec3(0.0, sign(localDirection.y), 0.0);
      } else {
        exitNormal = vec3(0.0, 0.0, sign(localDirection.z));
      }
      return true;
    }

    SlabResult traceSlab(Pane pane, Hit entry, vec3 refractedDirection) {
      SlabResult result;
      result.escaped = false;
      result.truncated = false;
      result.origin = entry.point;
      result.direction = refractedDirection;
      result.transmittance = vec3(1.0);
      result.pathLength = 0.0;

      vec3 localPoint = entry.localPoint;
      vec3 localDirection = rotateToLocal(refractedDirection, pane.yaw);
      vec3 transmittance = vec3(1.0);
      float pathLength = 0.0;

      for (int bounce = 0; bounce < MAX_INTERNAL_BOUNCES; bounce++) {
        vec3 exitPoint;
        vec3 exitNormal;
        float segment;
        bool foundExit = parallelSlabExit(
          localPoint,
          localDirection,
          pane.halfSize,
          exitPoint,
          exitNormal,
          segment
        );
        if (!foundExit) {
          foundExit = nextBoxFace(
            localPoint,
            localDirection,
            pane.halfSize,
            exitPoint,
            exitNormal,
            segment
          );
        }
        if (!foundExit) {
          result.truncated = true;
          break;
        }

        localPoint = exitPoint;
        pathLength += segment;
        transmittance *= exp(-ABSORPTION_SPECTRUM * uAbsorption * segment);

        vec3 outgoingDirection;
        bool exits = refractDirection(
          localDirection,
          -exitNormal,
          IOR,
          outgoingDirection
        );

        if (exits) {
          float cosine = clamp(dot(localDirection, exitNormal), 0.0, 1.0);
          transmittance *= 1.0 - fresnelReflectance(cosine, IOR);
          vec3 worldExitPoint = pane.center + rotateFromLocal(localPoint, pane.yaw);
          result.escaped = true;
          result.direction = rotateFromLocal(outgoingDirection, pane.yaw);
          result.origin = worldExitPoint + result.direction * EPSILON * 8.0;
          result.transmittance = transmittance;
          result.pathLength = pathLength;
          return result;
        }

        localDirection = reflect(localDirection, -exitNormal);
      }

      result.truncated = true;
      result.transmittance = transmittance;
      result.pathLength = pathLength;
      return result;
    }

    vec3 traceGlassScene(vec3 rayOrigin, vec3 rayDirection) {
      vec3 radiance = vec3(0.0);
      vec3 throughput = vec3(1.0);

      for (int step = 0; step < MAX_SCENE_STEPS; step++) {
        if (step >= MAX_DEPTH) {
          radiance += throughput * TRUNCATED_CONTRIBUTION * 0.045;
          break;
        }

        Hit hit = findNearestPane(rayOrigin, rayDirection);
        if (!hit.valid) {
          radiance += throughput * backdrop(rayDirection);
          break;
        }

        Pane pane = paneAt(hit.paneIndex);
        vec3 facingNormal = dot(rayDirection, hit.normal) > 0.0
          ? -hit.normal
          : hit.normal;
        float cosine = clamp(-dot(rayDirection, facingNormal), 0.0, 1.0);
        float reflectance = fresnelReflectance(cosine, IOR);
        vec3 reflectedDirection = reflect(rayDirection, facingNormal);

        radiance += throughput * reflectance * reflectedStudio(reflectedDirection);

        float edgeX = pane.halfSize.x - abs(hit.localPoint.x);
        float edgeY = pane.halfSize.y - abs(hit.localPoint.y);
        float edge = smoothstep(0.028, 0.0, min(edgeX, edgeY));
        radiance += throughput * edge * vec3(0.22, 0.91, 0.80) * 0.38;

        vec3 refractedDirection;
        if (!refractDirection(
          rayDirection,
          facingNormal,
          1.0 / IOR,
          refractedDirection
        )) {
          rayOrigin = hit.point + facingNormal * EPSILON * 8.0;
          rayDirection = reflectedDirection;
          throughput *= (1.0 - reflectance) * 0.92;
          continue;
        }

        throughput *= 1.0 - reflectance;
        SlabResult slab = traceSlab(pane, hit, refractedDirection);

        if (slab.escaped) {
          throughput *= slab.transmittance;
          rayOrigin = slab.origin;
          rayDirection = slab.direction;
          continue;
        }

        radiance +=
          throughput *
          slab.transmittance *
          TRUNCATED_CONTRIBUTION *
          0.11;
        break;
      }

      return radiance;
    }

    vec3 acesToneMap(vec3 color) {
      const float a = 2.51;
      const float b = 0.03;
      const float c = 2.43;
      const float d = 0.59;
      const float e = 0.14;
      return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
    }

    void main() {
      vec2 screen = (gl_FragCoord.xy * 2.0 - uResolution) / uResolution.y;
      vec3 forward = normalize(uTarget - uCamera);
      vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
      vec3 up = cross(right, forward);
      float aspect = uResolution.x / uResolution.y;
      float focalLength = tan(radians(38.0) * 0.5) * max(1.0, 1.0 / aspect);
      vec3 rayDirection = normalize(
        forward + screen.x * right * focalLength + screen.y * up * focalLength
      );

      vec3 color = traceGlassScene(uCamera, rayDirection);
      color = acesToneMap(color * 1.15);
      color = pow(color, vec3(1.0 / 2.2));

      float vignette = 1.0 - 0.18 * dot(screen * 0.48, screen * 0.48);
      color *= clamp(vignette, 0.72, 1.0);
      float dither = (hash21(gl_FragCoord.xy + uTime) - 0.5) / 255.0;
      outColor = vec4(max(color + dither, vec3(0.0)), 1.0);
    }
  `;

  const program = createProgram(vertexSource, fragmentSource);
  if (!program) return;

  const uniforms = {
    resolution: gl.getUniformLocation(program, 'uResolution'),
    time: gl.getUniformLocation(program, 'uTime'),
    thickness: gl.getUniformLocation(program, 'uThickness'),
    absorption: gl.getUniformLocation(program, 'uAbsorption'),
    camera: gl.getUniformLocation(program, 'uCamera'),
    target: gl.getUniformLocation(program, 'uTarget'),
  };

  gl.useProgram(program);
  resize();
  requestAnimationFrame(frame);

  function buildSpecimenControls() {
    specimensRoot.innerHTML = SPECIMENS.map((specimen, index) => `
      <label class="specimen" style="--specimen-color: ${specimen.color}">
        <span class="specimen-head">
          <span class="specimen-name"><span>${specimen.id}</span> / ${specimen.label}</span>
          <span class="specimen-value"><output id="thickness-${index}">${specimen.thickness}</output> mm</span>
        </span>
        <input
          id="thickness-input-${index}"
          type="range"
          min="0"
          max="${specimen.max}"
          step="1"
          value="${specimen.thickness}"
          aria-label="Specimen ${specimen.id} thickness in millimetres"
        />
      </label>
    `).join('');

    specimensRoot.querySelectorAll('input[type="range"]').forEach((input, index) => {
      input.addEventListener('input', () => {
        const value = Number(input.value);
        state.thickness[index] = value;
        document.querySelector(`#thickness-${index}`).textContent = String(value);
        updateReadouts();
      });
    });
  }

  function bindPointerControls() {
    canvas.addEventListener('pointerdown', (event) => {
      state.pointerId = event.pointerId;
      state.lastPointer.x = event.clientX;
      state.lastPointer.y = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('dragging');
    });

    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerId !== state.pointerId) return;
      const dx = event.clientX - state.lastPointer.x;
      const dy = event.clientY - state.lastPointer.y;
      state.lastPointer.x = event.clientX;
      state.lastPointer.y = event.clientY;
      state.targetOrbit.yaw = clamp(state.targetOrbit.yaw + dx * 0.0017, -0.42, 0.42);
      state.targetOrbit.pitch = clamp(state.targetOrbit.pitch + dy * 0.0012, -0.2, 0.24);
    });

    const releasePointer = (event) => {
      if (event.pointerId !== state.pointerId) return;
      state.pointerId = null;
      canvas.classList.remove('dragging');
    };

    canvas.addEventListener('pointerup', releasePointer);
    canvas.addEventListener('pointercancel', releasePointer);
  }

  function bindResetControl() {
    resetButton.addEventListener('click', () => {
      state.targetOrbit.yaw = 0.035;
      state.targetOrbit.pitch = 0.018;
      state.targetOrbit.radius = 7.45;
    });
  }

  absorptionInput.addEventListener('input', () => {
    state.absorption = Number(absorptionInput.value);
    updateReadouts();
  });

  function updateReadouts() {
    const active = state.thickness.filter((value) => value > 0).length;
    activePlates.textContent = String(active).padStart(2, '0');
    absorptionOutput.value = `${state.absorption.toFixed(2)}×`;
    absorptionReadout.textContent = `${state.absorption.toFixed(2)}×`;
  }

  function frame(timestamp) {
    const delta = Math.min((timestamp - state.lastTime) / 1000, 0.05);
    state.lastTime = timestamp;
    state.frames += 1;
    state.fpsElapsed += delta;

    if (state.fpsElapsed > 0.5) {
      fpsReadout.textContent = `${Math.round(state.frames / state.fpsElapsed)} fps`;
      state.frames = 0;
      state.fpsElapsed = 0;
    }

    state.orbit.yaw += (state.targetOrbit.yaw - state.orbit.yaw) * 0.09;
    state.orbit.pitch += (state.targetOrbit.pitch - state.orbit.pitch) * 0.09;
    state.orbit.radius += (state.targetOrbit.radius - state.orbit.radius) * 0.09;

    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.time, timestamp / 1000);
    gl.uniform3f(
      uniforms.thickness,
      state.thickness[0] * 0.009,
      state.thickness[1] * 0.009,
      state.thickness[2] * 0.009,
    );
    gl.uniform1f(uniforms.absorption, state.absorption);

    const camera = orbitCamera(state.orbit);
    gl.uniform3f(uniforms.camera, camera.x, camera.y, camera.z);
    gl.uniform3f(uniforms.target, 0, 0.04, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  }

  function orbitCamera(orbit) {
    const horizontal = Math.cos(orbit.pitch);
    return {
      x: Math.sin(orbit.yaw) * orbit.radius * horizontal,
      y: 0.04 + Math.sin(orbit.pitch) * orbit.radius,
      z: Math.cos(orbit.yaw) * orbit.radius * horizontal,
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function createProgram(vertexText, fragmentText) {
    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexText);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentText);
    if (!vertexShader || !fragmentShader) return null;

    const nextProgram = gl.createProgram();
    gl.attachShader(nextProgram, vertexShader);
    gl.attachShader(nextProgram, fragmentShader);
    gl.linkProgram(nextProgram);

    if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
      showError(`Shader link failed:\n\n${gl.getProgramInfoLog(nextProgram)}`);
      return null;
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return nextProgram;
  }

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const stage = type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment';
      showError(`${stage} shader compilation failed:\n\n${gl.getShaderInfoLog(shader)}`);
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  function showError(message) {
    errorPanel.hidden = false;
    errorPanel.textContent = message;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }
})();
