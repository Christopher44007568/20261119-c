const COMMON = /* wgsl */ `
struct Uniforms {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  lightViewProj: mat4x4f,
  cameraPos: vec4f,
  lightPos: vec4f,
  lightDir: vec4f,
  lightColor: vec4f,
  resolution: vec4f,
  volume: vec4f,
  volumeB: vec4f,
  weight: vec4f,
  shadow: vec4f,
};

@group(0) @binding(0) var<uniform> U: Uniforms;

fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn worldFromPixel(pixel: vec2f, dims: vec2f, depth: f32) -> vec3f {
  let ndc = vec2f(
    (pixel.x + 0.5) / dims.x * 2.0 - 1.0,
    1.0 - (pixel.y + 0.5) / dims.y * 2.0
  );
  let clip = U.invViewProj * vec4f(ndc, depth, 1.0);
  return clip.xyz / clip.w;
}

fn sceneDistanceAt(pixel: vec2f, dims: vec2f, depth: f32) -> f32 {
  if (depth >= 0.99999) {
    return U.volumeB.z;
  }
  let world = worldFromPixel(pixel, dims, depth);
  return length(world - U.cameraPos.xyz);
}

fn shadowCoord(position: vec3f) -> vec4f {
  return U.lightViewProj * vec4f(position, 1.0);
}
`;

const SHADOW = /* wgsl */ `
${COMMON}

@vertex
fn vsMain(@location(0) position: vec3f) -> @builtin(position) vec4f {
  return U.lightViewProj * vec4f(position, 1.0);
}

@fragment
fn fsMain() {}
`;

const SCENE = /* wgsl */ `
${COMMON}

@group(1) @binding(0) var shadowTex: texture_depth_2d;
@group(1) @binding(1) var shadowSampler: sampler_comparison;

struct VSIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec3f,
  @location(3) emissive: f32,
};

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec3f,
  @location(3) emissive: f32,
};

@vertex
fn vsMain(input: VSIn) -> VSOut {
  var out: VSOut;
  out.clip = U.viewProj * vec4f(input.position, 1.0);
  out.world = input.position;
  out.normal = input.normal;
  out.color = input.color;
  out.emissive = input.emissive;
  return out;
}

fn spotVisibility(position: vec3f) -> f32 {
  let clip = shadowCoord(position);
  if (clip.w <= 0.0) { return 0.0; }
  let ndc = clip.xyz / clip.w;
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { return 0.0; }
  let referenceDepth = ndc.z - U.shadow.y;
  return textureSampleCompareLevel(shadowTex, shadowSampler, uv, referenceDepth);
}

@fragment
fn fsMain(input: VSOut) -> @location(0) vec4f {
  let normal = normalize(input.normal);
  let base = input.color;
  if (input.emissive > 0.5) {
    return vec4f(base * 6.5, 1.0);
  }

  let toLight = U.lightPos.xyz - input.world;
  let dist2 = dot(toLight, toLight);
  let invDist = inverseSqrt(max(dist2, 0.0001));
  let toLightN = toLight * invDist;
  let lightOut = normalize(input.world - U.lightPos.xyz);
  let cone = smoothstep(U.lightPos.w, U.lightDir.w, dot(lightOut, U.lightDir.xyz));
  let ndotl = max(dot(normal, toLightN), 0.0);
  let vis = spotVisibility(input.world + normal * U.shadow.w);
  let spot = U.lightColor.rgb * U.lightColor.w * cone * ndotl * vis / (dist2 + 0.35);

  let sky = 0.020 + 0.018 * max(normal.y, 0.0);
  let bounce = U.lightColor.rgb * 0.006 * max(-normal.y + 0.25, 0.0);
  return vec4f(base * (sky + 0.012) + base * spot + bounce, 1.0);
}
`;

const VOLUME = /* wgsl */ `
${COMMON}

@group(0) @binding(1) var shadowTex: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var halfDepth: texture_depth_2d;
@group(0) @binding(4) var outputVolume: texture_storage_2d<rgba16float, write>;

fn spotVisibility(position: vec3f) -> f32 {
  let clip = shadowCoord(position);
  if (clip.w <= 0.0) { return 0.0; }
  let ndc = clip.xyz / clip.w;
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { return 0.0; }
  return textureSampleCompareLevel(
    shadowTex,
    shadowSampler,
    uv,
    ndc.z - U.shadow.y
  );
}

fn phaseHG(cosTheta: f32, g: f32) -> f32 {
  let denom = max(1.0 + g * g - 2.0 * g * cosTheta, 0.0001);
  return (1.0 - g * g) / (12.566370614 * denom * sqrt(denom));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2u(textureDimensions(halfDepth));
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let pixel = vec2f(gid.xy);
  let dimsf = vec2f(dims);
  let depth = textureLoad(halfDepth, vec2i(gid.xy), 0);
  let world = worldFromPixel(pixel, dimsf, depth);
  let camera = U.cameraPos.xyz;
  let delta = world - camera;
  let rawDistance = length(delta);
  let maxDistance = select(rawDistance, U.volumeB.z, depth >= 0.99999);
  if (maxDistance <= 0.001) {
    textureStore(outputVolume, vec2i(gid.xy), vec4f(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let rayDir = delta / max(rawDistance, 0.0001);
  let steps = max(i32(U.volume.z), 1);
  let dt = maxDistance / f32(steps);
  var jitter = 0.5;
  if (U.volume.w > 0.5) {
    jitter = hash12(pixel + fract(U.cameraPos.w) * vec2f(37.0, 17.0));
  }

  let sigma = max(U.volume.y * U.volume.x, 0.000001);
  let segmentT = exp(-sigma * dt);
  let scatteredFraction = 1.0 - segmentT;
  var transmittance = 1.0;
  var radiance = vec3f(0.0);

  for (var i = 0; i < steps; i++) {
    let t = (f32(i) + jitter) * dt;
    if (t >= maxDistance) { break; }
    let p = camera + rayDir * t;
    let toLight = U.lightPos.xyz - p;
    let dist2 = dot(toLight, toLight);
    let dist = sqrt(max(dist2, 0.0001));
    let toLightN = toLight / dist;
    let lightRay = normalize(p - U.lightPos.xyz);
    let cone = smoothstep(U.lightPos.w, U.lightDir.w, dot(lightRay, U.lightDir.xyz));
    if (cone > 0.0001) {
      let vis = spotVisibility(p);
      let cosTheta = dot(rayDir, toLightN);
      let phase = phaseHG(cosTheta, U.volumeB.y);
      let light = U.lightColor.rgb * U.lightColor.w * cone * vis;
      radiance += transmittance * scatteredFraction * light * phase / (dist2 + 0.35);
    }
    transmittance *= segmentT;
  }

  textureStore(outputVolume, vec2i(gid.xy), vec4f(radiance, transmittance));
}
`;

const COMPOSITE = /* wgsl */ `
${COMMON}

@group(1) @binding(0) var sceneColor: texture_2d<f32>;
@group(1) @binding(1) var fullDepth: texture_depth_2d;
@group(1) @binding(2) var halfDepth: texture_depth_2d;
@group(1) @binding(3) var halfVolume: texture_2d<f32>;
@group(1) @binding(4) var shadowTex: texture_depth_2d;

struct FSIn {
  @builtin(position) position: vec4f,
};

@vertex
fn vsMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  return vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
}

struct Tap {
  color: vec3f,
  weight: f32,
  depthWeight: f32,
};

fn sampleTap(
  coord: vec2i,
  baseWeight: f32,
  fullDistance: f32,
  halfDims: vec2f
) -> Tap {
  let halfDepthValue = textureLoad(halfDepth, coord, 0);
  let halfDistance = sceneDistanceAt(vec2f(coord), halfDims, halfDepthValue);
  let sigma = max(U.weight.y, fullDistance * U.weight.x);
  let delta = (halfDistance - fullDistance) / max(sigma, 0.0001);
  let depthWeight = 1.0 - smoothstep(0.38, 1.15, abs(delta));
  var tap: Tap;
  tap.color = textureLoad(halfVolume, coord, 0).rgb;
  tap.weight = baseWeight * depthWeight;
  tap.depthWeight = depthWeight;
  return tap;
}

fn acesFilm(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

fn finishColor(hdr: vec3f, exposure: f32, pixel: vec2f) -> vec3f {
  let vignette = 1.0 - 0.16 * dot(pixel / U.resolution.xy - 0.5, pixel / U.resolution.xy - 0.5);
  let mapped = acesFilm(max(hdr, vec3f(0.0)) * exposure * vignette);
  let encoded = pow(mapped, vec3f(1.0 / 2.2));
  let grain = (hash12(pixel) - 0.5) / 255.0;
  return encoded + grain;
}

@fragment
fn fsMain(input: FSIn) -> @location(0) vec4f {
  let fullPixel = floor(input.position.xy);
  let fullCoord = vec2i(fullPixel);
  let fullDims = U.resolution.xy;
  let halfDims = U.resolution.zw;
  let debugMode = i32(U.weight.w);
  let scene = textureLoad(sceneColor, fullCoord, 0).rgb;

  if (debugMode == 4) {
    let shadowDims = vec2f(textureDimensions(shadowTex));
    let shadowUv = fullPixel / fullDims;
    let shadowDepth = textureLoad(shadowTex, vec2i(shadowUv * shadowDims), 0);
    let contour = abs(fract(shadowDepth * 48.0) - 0.5) * 2.0;
    let base = pow(1.0 - shadowDepth, 1.7) * 0.9;
    let edge = smoothstep(0.93, 1.0, contour) * 0.16;
    return vec4f(vec3f(base + edge), 1.0);
  }

  let depth = textureLoad(fullDepth, fullCoord, 0);
  let fullDistance = sceneDistanceAt(fullPixel, fullDims, depth);
  let halfPos = (fullPixel + 0.5) * 0.5 - 0.5;
  let base = floor(halfPos);
  let frac = halfPos - base;
  let maxHalf = vec2i(textureDimensions(halfDepth)) - vec2i(1);
  let c00 = clamp(vec2i(base), vec2i(0), maxHalf);
  let c10 = clamp(vec2i(base) + vec2i(1, 0), vec2i(0), maxHalf);
  let c01 = clamp(vec2i(base) + vec2i(0, 1), vec2i(0), maxHalf);
  let c11 = clamp(vec2i(base) + vec2i(1, 1), vec2i(0), maxHalf);

  let bw00 = (1.0 - frac.x) * (1.0 - frac.y);
  let bw10 = frac.x * (1.0 - frac.y);
  let bw01 = (1.0 - frac.x) * frac.y;
  let bw11 = frac.x * frac.y;
  let t00 = sampleTap(c00, bw00, fullDistance, halfDims);
  let t10 = sampleTap(c10, bw10, fullDistance, halfDims);
  let t01 = sampleTap(c01, bw01, fullDistance, halfDims);
  let t11 = sampleTap(c11, bw11, fullDistance, halfDims);

  let halfVolumePlain =
    t00.color * bw00 + t10.color * bw10 +
    t01.color * bw01 + t11.color * bw11;
  let weightSum = t00.weight + t10.weight + t01.weight + t11.weight;
  let safeSum = max(weightSum, 0.00001);
  let guidedVolume =
    (t00.color * t00.weight + t10.color * t10.weight +
     t01.color * t01.weight + t11.color * t11.weight) / safeSum;

  if (debugMode == 3) {
    let p0 = t00.weight / safeSum;
    let p1 = t10.weight / safeSum;
    let p2 = t01.weight / safeSum;
    let p3 = t11.weight / safeSum;
    let weightColor =
      p0 * vec3f(0.92, 0.10, 0.05) +
      p1 * vec3f(0.05, 0.95, 0.24) +
      p2 * vec3f(0.12, 0.28, 1.00) +
      p3 * vec3f(1.00, 0.84, 0.08);
    let rejected = clamp(1.0 - weightSum, 0.0, 1.0);
    if (U.shadow.z > 0.5) {
      let meanDepthWeight =
        (t00.depthWeight + t10.depthWeight + t01.depthWeight + t11.depthWeight) * 0.25;
      return vec4f(rejected, weightSum * 0.5, meanDepthWeight, 1.0);
    }
    let smoothColor = vec3f(0.5225, 0.5425, 0.3425);
    let edge = abs(weightColor - smoothColor);
    let baseColor = vec3f(0.009, 0.014, 0.055);
    let weights = baseColor + edge * 1.8;
    let guard = vec3f(0.0, 0.55, 0.95) * (1.0 - exp(-rejected * 9.0));
    return vec4f(weights + guard, 1.0);
  }

  if (debugMode == 2) {
    return vec4f(finishColor(halfVolumePlain * 4.0, U.volumeB.w, fullPixel), 1.0);
  }

  if (debugMode == 5) {
    return vec4f(finishColor(guidedVolume * 5.5, U.volumeB.w, fullPixel), 1.0);
  }

  if (debugMode == 1) {
    return vec4f(finishColor(scene, U.volumeB.w, fullPixel), 1.0);
  }

  let hdr = scene + guidedVolume * 5.5;
  return vec4f(finishColor(hdr, U.volumeB.w, fullPixel), 1.0);
}
`;

export const shaderModules = {
  shadow: SHADOW,
  scene: SCENE,
  volume: VOLUME,
  composite: COMPOSITE,
};
