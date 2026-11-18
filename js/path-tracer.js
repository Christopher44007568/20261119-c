(function () {
  "use strict";

  const VERT = `#version 300 es
  precision highp float;
  void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;

  const TRACE_FRAG = `#version 300 es
  precision highp float;
  precision highp int;

  uniform vec2 uResolution;
  uniform uint uSample;
  uniform vec3 uEye;
  uniform vec3 uForward;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform float uTanHalfFov;

  out vec4 fragColor;

  const float PI = 3.141592653589793;
  const float EPS = 2.5e-4;
  const float LIGHT_Y = 3.72;
  const vec3 LIGHT_MIN = vec3(-2.25, LIGHT_Y, -1.75);
  const vec3 LIGHT_MAX = vec3(2.25, LIGHT_Y, 1.55);
  const vec3 LIGHT_EMISSION = vec3(7.2, 5.55, 3.75);

  struct Material {
    vec3 albedo;
    float roughness;
    int type;
  };

  struct Hit {
    float t;
    vec3 p;
    vec3 n;
    int id;
  };

  uint pcg(inout uint state) {
    state = state * 747796405u + 2891336453u;
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
  }

  float rand(inout uint state) {
    return float(pcg(state)) * (1.0 / 4294967296.0);
  }

  vec3 safeNormalize(vec3 v, vec3 fallback) {
    float len2 = dot(v, v);
    return len2 > 1e-16 ? v * inversesqrt(len2) : fallback;
  }

  bool sphereHit(vec3 ro, vec3 rd, vec3 center, float radius, out float t) {
    vec3 oc = ro - center;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - radius * radius;
    float disc = b * b - c;
    if (disc < 0.0) return false;
    float root = sqrt(max(disc, 0.0));
    float nearT = -b - root;
    float farT = -b + root;
    t = nearT > EPS ? nearT : farT;
    return t > EPS;
  }

  bool roomHit(vec3 ro, vec3 rd, out float t, out vec3 normal) {
    vec3 lo = vec3(-4.8, 0.0, -4.0);
    vec3 hi = vec3(4.8, 6.0, 5.0);
    vec3 inv = 1.0 / rd;
    vec3 a = (lo - ro) * inv;
    vec3 b = (hi - ro) * inv;
    vec3 tNear = min(a, b);
    vec3 tFar = max(a, b);
    float enter = max(max(tNear.x, tNear.y), tNear.z);
    float exitT = min(min(tFar.x, tFar.y), tFar.z);
    if (exitT < max(enter, 0.0) || exitT <= EPS) return false;
    t = exitT;
    if (abs(exitT - tFar.x) < 1e-5) normal = vec3(-sign(rd.x), 0.0, 0.0);
    else if (abs(exitT - tFar.y) < 1e-5) normal = vec3(0.0, -sign(rd.y), 0.0);
    else normal = vec3(0.0, 0.0, -sign(rd.z));
    return true;
  }

  bool lightHit(vec3 ro, vec3 rd, out float t) {
    if (abs(rd.y) < 1e-7) return false;
    t = (LIGHT_Y - ro.y) / rd.y;
    if (t <= EPS) return false;
    vec3 p = ro + rd * t;
    return p.x >= LIGHT_MIN.x && p.x <= LIGHT_MAX.x &&
           p.z >= LIGHT_MIN.z && p.z <= LIGHT_MAX.z;
  }

  Hit hitScene(vec3 ro, vec3 rd) {
    Hit h;
    h.t = 1e30;
    h.id = -1;
    float t;
    vec3 n;

    if (roomHit(ro, rd, t, n) && t < h.t) {
      h.t = t; h.n = n; h.id = 0;
    }

    if (sphereHit(ro, rd, vec3(-1.34, 0.89, -0.18), 0.89, t) && t < h.t) {
      h.t = t; h.id = 1;
    }
    if (sphereHit(ro, rd, vec3(0.69, 0.70, 0.02), 0.70, t) && t < h.t) {
      h.t = t; h.id = 2;
    }
    if (sphereHit(ro, rd, vec3(1.57, 0.44, 1.03), 0.44, t) && t < h.t) {
      h.t = t; h.id = 3;
    }
    if (lightHit(ro, rd, t) && t < h.t) {
      h.t = t; h.id = 4;
    }

    h.p = ro + rd * h.t;
    if (h.id == 1) h.n = (h.p - vec3(-1.34, 0.89, -0.18)) / 0.89;
    else if (h.id == 2) h.n = (h.p - vec3(0.69, 0.70, 0.02)) / 0.70;
    else if (h.id == 3) h.n = (h.p - vec3(1.57, 0.44, 1.03)) / 0.44;
    else if (h.id == 4) h.n = vec3(0.0, -1.0, 0.0);
    return h;
  }

  Material materialFor(Hit h) {
    Material m;
    m.albedo = vec3(0.5);
    m.roughness = 0.5;
    m.type = 0;
    if (h.id == 1) {
      m.albedo = vec3(0.61, 0.235, 0.095);
      m.roughness = 0.82;
      m.type = 0;
    } else if (h.id == 2) {
      m.albedo = vec3(0.70, 0.72, 0.67);
      m.roughness = 0.105;
      m.type = 1;
    } else if (h.id == 3) {
      m.albedo = vec3(0.105, 0.43, 0.39);
      m.roughness = 0.055;
      m.type = 2;
    } else if (h.id == 4) {
      m.albedo = LIGHT_EMISSION;
      m.roughness = 1.0;
      m.type = 3;
    } else {
      if (h.n.y > 0.5) {
        vec2 cell = floor(h.p.xz * 1.35);
        float variation = fract(sin(dot(cell, vec2(41.3, 289.7))) * 45758.5453);
        m.albedo = vec3(0.40, 0.365, 0.30) * (0.91 + variation * 0.12);
        m.roughness = 0.72;
      } else if (h.n.z < -0.5) {
        m.albedo = vec3(0.115, 0.195, 0.165);
      } else if (h.n.x < -0.5) {
        m.albedo = vec3(0.46, 0.39, 0.30);
      } else if (h.n.x > 0.5) {
        m.albedo = vec3(0.25, 0.285, 0.25);
      } else {
        m.albedo = vec3(0.36, 0.37, 0.33);
      }
    }
    return m;
  }

  float g1(float ndotv, float alpha) {
    float a2 = alpha * alpha;
    return 2.0 * max(ndotv, 0.0) /
      max(max(ndotv, 0.0) + sqrt(a2 + (1.0 - a2) * ndotv * ndotv), 1e-6);
  }

  vec3 fresnel(vec3 f0, float vdotH) {
    float x = clamp(1.0 - vdotH, 0.0, 1.0);
    float x2 = x * x;
    return clamp(f0 + (1.0 - f0) * (x2 * x2 * x), 0.0, 1.0);
  }

  vec3 cosineSample(vec3 n, inout uint state) {
    float u1 = rand(state);
    float u2 = rand(state);
    float phi = 2.0 * PI * u1;
    float radius = sqrt(u2);
    vec3 tangent = abs(n.y) < 0.999
      ? safeNormalize(cross(vec3(0.0, 1.0, 0.0), n), vec3(1.0, 0.0, 0.0))
      : safeNormalize(cross(vec3(1.0, 0.0, 0.0), n), vec3(0.0, 0.0, 1.0));
    vec3 bitangent = cross(n, tangent);
    return safeNormalize(
      tangent * (cos(phi) * radius) +
      bitangent * (sin(phi) * radius) +
      n * sqrt(max(1.0 - u2, 0.0)),
      n
    );
  }

  vec3 sampleSpecular(vec3 wo, vec3 n, float roughnessValue, inout uint state) {
    vec3 mirror = reflect(-wo, n);
    float roughness = max(roughnessValue, 0.0);
    if (roughness <= 1e-4) return mirror;
    float alpha = max(roughness * roughness, 1e-4);
    float u1 = rand(state);
    float u2 = rand(state);
    float phi = 2.0 * PI * u1;
    float cosTheta = sqrt((1.0 - u2) / max(1.0 + (alpha * alpha - 1.0) * u2, 1e-7));
    float sinTheta = sqrt(max(1.0 - cosTheta * cosTheta, 0.0));
    vec3 tangent = abs(n.y) < 0.999
      ? safeNormalize(cross(vec3(0.0, 1.0, 0.0), n), vec3(1.0, 0.0, 0.0))
      : safeNormalize(cross(vec3(1.0, 0.0, 0.0), n), vec3(0.0, 0.0, 1.0));
    vec3 bitangent = cross(n, tangent);
    vec3 h = safeNormalize(
      tangent * (cos(phi) * sinTheta) +
      bitangent * (sin(phi) * sinTheta) +
      n * cosTheta,
      n
    );
    vec3 wi = reflect(-wo, h);
    return dot(wi, n) > EPS ? safeNormalize(wi, mirror) : mirror;
  }

  bool occluded(vec3 ro, vec3 rd, float distanceToLight) {
    float t;
    if (sphereHit(ro, rd, vec3(-1.34, 0.89, -0.18), 0.89, t) && t < distanceToLight - EPS) return true;
    if (sphereHit(ro, rd, vec3(0.69, 0.70, 0.02), 0.70, t) && t < distanceToLight - EPS) return true;
    if (sphereHit(ro, rd, vec3(1.57, 0.44, 1.03), 0.44, t) && t < distanceToLight - EPS) return true;
    vec3 normal;
    if (roomHit(ro, rd, t, normal) && t < distanceToLight - EPS) return true;
    return false;
  }

  vec3 directLight(vec3 p, vec3 n, vec3 albedo, inout uint state) {
    if (p.y >= LIGHT_Y - EPS) return vec3(0.0);
    vec2 uv = vec2(rand(state), rand(state));
    vec3 lp = vec3(
      mix(LIGHT_MIN.x, LIGHT_MAX.x, uv.x),
      LIGHT_Y,
      mix(LIGHT_MIN.z, LIGHT_MAX.z, uv.y)
    );
    vec3 toLight = lp - p;
    float distance2 = dot(toLight, toLight);
    if (distance2 < 1e-8) return vec3(0.0);
    float distanceToLight = sqrt(distance2);
    vec3 wi = toLight / distanceToLight;
    float cosSurface = dot(n, wi);
    float cosLight = (LIGHT_Y - p.y) / distanceToLight;
    if (cosSurface <= 0.0 || cosLight <= 0.0) return vec3(0.0);
    vec3 origin = p + n * EPS;
    if (occluded(origin, wi, distanceToLight)) return vec3(0.0);
    float area = (LIGHT_MAX.x - LIGHT_MIN.x) * (LIGHT_MAX.z - LIGHT_MIN.z);
    return albedo * (1.0 / PI) * LIGHT_EMISSION * (cosSurface * cosLight * area / distance2);
  }

  vec3 tracePath(vec3 ro, vec3 rd, inout uint state) {
    vec3 radiance = vec3(0.0);
    vec3 throughput = vec3(1.0);
    bool lastWasSpecular = true;

    for (int bounce = 0; bounce < 7; bounce++) {
      Hit h = hitScene(ro, rd);
      if (h.id < 0 || h.t >= 1e29) break;

      if (h.id == 4) {
        if (bounce == 0 || lastWasSpecular) {
          radiance += throughput * LIGHT_EMISSION;
        }
        break;
      }

      Material m = materialFor(h);
      vec3 wo = safeNormalize(-rd, h.n);
      vec3 n = safeNormalize(h.n, vec3(0.0, 1.0, 0.0));
      if (dot(n, wo) < 0.0) n = -n;

      if (m.type == 0) {
        radiance += throughput * directLight(h.p, n, m.albedo, state);
        vec3 wi = cosineSample(n, state);
        if (dot(wi, n) <= EPS) break;
        throughput *= m.albedo;
        lastWasSpecular = false;
        ro = h.p + n * EPS;
        rd = wi;
      } else {
        vec3 f0 = m.type == 1
          ? clamp(m.albedo, 0.0, 1.0)
          : mix(vec3(0.055), clamp(m.albedo, 0.0, 1.0), 0.62);
        vec3 wi = sampleSpecular(wo, n, m.roughness, state);
        float ndotl = dot(wi, n);
        if (ndotl <= EPS) break;
        float ndotv = max(dot(wo, n), EPS);
        vec3 hvec = safeNormalize(wo + wi, n);
        float vdoth = clamp(dot(wo, hvec), 0.0, 1.0);
        vec3 F = fresnel(f0, vdoth);
        if (m.roughness <= 1e-4) {
          throughput *= F;
        } else {
          float alpha = max(m.roughness * m.roughness, 1e-4);
          float ndoth = max(dot(n, hvec), 1e-4);
          float ratio = g1(ndotl, alpha) * clamp(vdoth / ndoth, 0.0, 1.0);
          throughput *= clamp(F * ratio, vec3(0.0), vec3(1.0));
        }
        lastWasSpecular = true;
        ro = h.p + n * EPS;
        rd = safeNormalize(wi, n);
      }

      float survival = clamp(max(max(throughput.r, throughput.g), throughput.b), 0.0, 0.99);
      if (bounce >= 3) {
        if (rand(state) > survival || survival <= 1e-5) break;
        throughput /= survival;
      }
      if (max(max(throughput.r, throughput.g), throughput.b) <= 0.0) break;
    }

    if (any(notEqual(radiance, radiance))) radiance = vec3(0.0);
    return clamp(radiance, vec3(0.0), vec3(64.0));
  }

  void main() {
    vec2 pixel = gl_FragCoord.xy;
    uint seed = uint(pixel.x) + 1973u * (uint(pixel.y) + 9277u * (uSample + 1u));
    seed ^= seed >> 16u;
    vec2 jitter = vec2(rand(seed), rand(seed));
    vec2 uv = (pixel + jitter) / uResolution;

    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec3 rd = safeNormalize(
      uForward +
      uRight * ((uv.x * 2.0 - 1.0) * uTanHalfFov * aspect) +
      uUp * ((uv.y * 2.0 - 1.0) * uTanHalfFov),
      uForward
    );
    vec3 color = tracePath(uEye, rd, seed);
    if (any(notEqual(color, color))) color = vec3(0.0);
    fragColor = vec4(clamp(color, vec3(0.0), vec3(64.0)), 1.0);
  }`;

  const ACCUM_FRAG = `#version 300 es
  precision highp float;
  uniform sampler2D uPrevious;
  uniform sampler2D uCurrent;
  out vec4 fragColor;
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec3 previous = texelFetch(uPrevious, p, 0).rgb;
    vec3 sampleColor = texelFetch(uCurrent, p, 0).rgb;
    fragColor = vec4(previous + sampleColor, 1.0);
  }`;

  const DISPLAY_FRAG = `#version 300 es
  precision highp float;
  uniform sampler2D uAccum;
  uniform float uSampleCount;
  uniform vec2 uResolution;
  out vec4 fragColor;

  vec3 acesFilm(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    vec3 color = uSampleCount > 0.0
      ? texelFetch(uAccum, ivec2(gl_FragCoord.xy), 0).rgb / uSampleCount
      : vec3(0.055, 0.063, 0.057);
    color *= 1.18;
    color = acesFilm(color);
    color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
    float vignette = 1.0 - 0.13 * smoothstep(0.32, 0.86, length(uv - 0.5));
    color *= vignette;
    if (any(notEqual(color, color))) color = vec3(0.0);
    fragColor = vec4(color, 1.0);
  }`;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || "Unknown shader error";
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  }

  function makeProgram(gl, vertexSource, fragmentSource) {
    const program = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || "Unknown program error";
      gl.deleteProgram(program);
      throw new Error(log);
    }
    return program;
  }

  function uniforms(gl, program, names) {
    const result = {};
    for (const name of names) result[name] = gl.getUniformLocation(program, name);
    return result;
  }

  class PathTracer {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.onProgress = options.onProgress || function () {};
      this.onError = options.onError || function () {};
      this.accumulation = new window.AccumulationState(options.maxSamples || 1000);
      this.ready = false;
      this.width = 0;
      this.height = 0;
      this.lastFrameTime = 0;
      this.accumIndex = 0;
      this.camera = {
        yaw: 0.035,
        pitch: 0.047,
        distance: 4.72,
        target: [0, 0.98, -0.12],
        fov: 42
      };
      this.defaultCamera = { ...this.camera, target: [...this.camera.target] };
      this._resizePending = true;
      this._raf = 0;
      this._resizeObserver = new ResizeObserver(() => {
        this._resizePending = true;
      });
      this._resizeObserver.observe(canvas);
      this._tick = this._tick.bind(this);
      this._init();
    }

    get samples() { return this.accumulation.samples; }
    get maxSamples() { return this.accumulation.maxSamples; }
    get paused() { return this.accumulation.paused; }
    set paused(value) { this.accumulation.setPaused(value); }
    get accumulationTime() { return this.accumulation.elapsed; }
    get lastReason() { return this.accumulation.reason; }

    _init() {
      const gl = this.canvas.getContext("webgl2", {
        antialias: false,
        alpha: false,
        depth: false,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance"
      });
      if (!gl) throw new Error("WebGL2 is unavailable in this browser.");
      this.gl = gl;
      this.floatTargets = Boolean(gl.getExtension("EXT_color_buffer_float"));
      this.internalFormat = this.floatTargets ? gl.RGBA32F : gl.RGBA8;
      this.textureType = this.floatTargets ? gl.FLOAT : gl.UNSIGNED_BYTE;

      this.traceProgram = makeProgram(gl, VERT, TRACE_FRAG);
      this.accumProgram = makeProgram(gl, VERT, ACCUM_FRAG);
      this.displayProgram = makeProgram(gl, VERT, DISPLAY_FRAG);
      this.traceUniforms = uniforms(gl, this.traceProgram, [
        "uResolution", "uSample", "uEye", "uForward", "uRight", "uUp", "uTanHalfFov"
      ]);
      this.accumUniforms = uniforms(gl, this.accumProgram, ["uPrevious", "uCurrent"]);
      this.displayUniforms = uniforms(gl, this.displayProgram, [
        "uAccum", "uSampleCount", "uResolution"
      ]);

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      this.ready = true;
      this._raf = requestAnimationFrame(this._tick);
    }

    _makeTarget(width, height) {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, this.internalFormat, width, height, 0, gl.RGBA, this.textureType, null);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("Unable to allocate progressive accumulation buffers.");
      }
      return { texture, framebuffer, width, height };
    }

    _deleteTarget(target) {
      if (!target) return;
      this.gl.deleteFramebuffer(target.framebuffer);
      this.gl.deleteTexture(target.texture);
    }

    _resize() {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
      const width = Math.max(2, Math.min(Math.round(rect.width * ratio), 1280));
      const height = Math.max(2, Math.round(width * rect.height / rect.width));
      if (width === this.width && height === this.height) return false;
      this.canvas.width = width;
      this.canvas.height = height;
      this.width = width;
      this.height = height;
      this._deleteTarget(this.sampleTarget);
      this._deleteTarget(this.accumTargets && this.accumTargets[0]);
      this._deleteTarget(this.accumTargets && this.accumTargets[1]);
      this.sampleTarget = this._makeTarget(width, height);
      this.accumTargets = [
        this._makeTarget(width, height),
        this._makeTarget(width, height)
      ];
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this._resizePending = false;
      this.reset("resize");
      return true;
    }

    _clearTarget(target) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    reset(reason = "manual") {
      if (!this.ready || !this.accumTargets) return;
      this.accumulation.reset(reason);
      this.lastFrameTime = performance.now();
      this.accumIndex = 0;
      for (const target of this.accumTargets) this._clearTarget(target);
      this._clearTarget(this.sampleTarget);
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this._display();
      this._notify();
    }

    restart() {
      this.accumulation.setPaused(false);
      this.reset("restart");
    }

    togglePause() {
      const paused = this.accumulation.togglePause();
      this.lastFrameTime = performance.now();
      this._notify();
      return paused;
    }

    setPaused(value) {
      this.accumulation.setPaused(value);
      this.lastFrameTime = performance.now();
      this._notify();
    }

    _cameraFrame() {
      const c = this.camera;
      const cp = Math.cos(c.pitch);
      const eye = [
        c.target[0] + Math.sin(c.yaw) * cp * c.distance,
        c.target[1] + Math.sin(c.pitch) * c.distance,
        c.target[2] + Math.cos(c.yaw) * cp * c.distance
      ];
      let fx = c.target[0] - eye[0];
      let fy = c.target[1] - eye[1];
      let fz = c.target[2] - eye[2];
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      let rx = -fz;
      let ry = 0;
      let rz = fx;
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;
      const ux = ry * fz - rz * fy;
      const uy = rz * fx - rx * fz;
      const uz = rx * fy - ry * fx;
      return {
        eye,
        forward: [fx, fy, fz],
        right: [rx, ry, rz],
        up: [ux, uy, uz]
      };
    }

    orbit(deltaX, deltaY) {
      this.camera.yaw -= deltaX * 0.0048;
      this.camera.pitch = Math.max(-0.08, Math.min(0.38, this.camera.pitch + deltaY * 0.0036));
      this.reset("camera");
    }

    zoom(delta) {
      this.camera.distance = Math.max(3.15, Math.min(4.92, this.camera.distance * Math.exp(delta * 0.001)));
      this.reset("camera");
    }

    resetCamera() {
      this.camera = {
        ...this.defaultCamera,
        target: [...this.defaultCamera.target]
      };
      this.reset("camera");
    }

    _renderSample() {
      const gl = this.gl;
      const frame = this._cameraFrame();
      const aspect = this.width / this.height;
      const tanHalf = Math.tan(this.camera.fov * Math.PI / 360);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sampleTarget.framebuffer);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.traceProgram);
      gl.uniform2f(this.traceUniforms.uResolution, this.width, this.height);
      gl.uniform1ui(this.traceUniforms.uSample, this.samples);
      gl.uniform3fv(this.traceUniforms.uEye, frame.eye);
      gl.uniform3fv(this.traceUniforms.uForward, frame.forward);
      gl.uniform3fv(this.traceUniforms.uRight, frame.right);
      gl.uniform3fv(this.traceUniforms.uUp, frame.up);
      gl.uniform1f(this.traceUniforms.uTanHalfFov, tanHalf);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const previous = this.accumTargets[this.accumIndex];
      const writeIndex = 1 - this.accumIndex;
      const write = this.accumTargets[writeIndex];
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.accumProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, previous.texture);
      gl.uniform1i(this.accumUniforms.uPrevious, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.sampleTarget.texture);
      gl.uniform1i(this.accumUniforms.uCurrent, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.accumIndex = writeIndex;
      this.accumulation.addSample(1);
      this._display();
      this._notify();
    }

    _display() {
      if (!this.accumTargets) return;
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.displayProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.accumTargets[this.accumIndex].texture);
      gl.uniform1i(this.displayUniforms.uAccum, 0);
      gl.uniform1f(this.displayUniforms.uSampleCount, this.samples);
      gl.uniform2f(this.displayUniforms.uResolution, this.width, this.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    _notify() {
      const snapshot = this.accumulation.snapshot();
      this.onProgress({
        ...snapshot,
        width: this.width,
        height: this.height,
        floatTargets: this.floatTargets
      });
    }

    getState() {
      return {
        ...this.accumulation.snapshot(),
        width: this.width,
        height: this.height,
        floatTargets: this.floatTargets
      };
    }

    readCenterPixel() {
      const out = new Float32Array(4);
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumTargets[this.accumIndex].framebuffer);
      gl.readPixels(
        Math.floor(this.width / 2),
        Math.floor(this.height / 2),
        1, 1, gl.RGBA, gl.FLOAT, out
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return Array.from(out);
    }

    _tick(now) {
      this._raf = requestAnimationFrame(this._tick);
      if (this._resizePending) {
        try {
          this._resize();
        } catch (error) {
          this.onError(error);
          return;
        }
      }
      if (!this.paused && this.samples < this.maxSamples) {
        const delta = Math.min(Math.max(now - this.lastFrameTime, 0), 100);
        this.accumulation.addElapsed(delta);
        this.lastFrameTime = now;
        this._renderSample();
        const error = this.gl.getError();
        if (error !== this.gl.NO_ERROR) {
          this.onError(new Error("WebGL error 0x" + error.toString(16)));
        }
      } else {
        this.lastFrameTime = now;
      }
    }

    dispose() {
      cancelAnimationFrame(this._raf);
      this._resizeObserver.disconnect();
      this._deleteTarget(this.sampleTarget);
      if (this.accumTargets) for (const target of this.accumTargets) this._deleteTarget(target);
      const gl = this.gl;
      gl.deleteProgram(this.traceProgram);
      gl.deleteProgram(this.accumProgram);
      gl.deleteProgram(this.displayProgram);
      gl.deleteVertexArray(this.vao);
    }
  }

  window.PathTracer = PathTracer;
})();
