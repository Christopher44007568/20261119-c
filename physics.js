(function (root) {
  "use strict";

  const LAMBDA_MIN = 380;
  const LAMBDA_MAX = 780;
  const N_AIR = 1.0;
  const N_SUBSTRATE = 1.52;
  const DEG = Math.PI / 180;
  const D65_WHITE = { x: 0.95047, y: 1, z: 1.08883 };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function lobe(x, center, leftWidth, rightWidth) {
    const width = x < center ? leftWidth : rightWidth;
    const t = (x - center) / width;
    return Math.exp(-0.5 * t * t);
  }

  // Wyman, Sloan & Shirley (2013) multi-lobe fit to CIE 1931 2° CMFs.
  function cieXYZ(wavelength) {
    return {
      x: 1.056 * lobe(wavelength, 599.8, 37.9, 31.0)
        + 0.362 * lobe(wavelength, 442.0, 16.0, 26.7)
        - 0.065 * lobe(wavelength, 501.1, 20.4, 26.2),
      y: 0.821 * lobe(wavelength, 568.8, 46.9, 40.5)
        + 0.286 * lobe(wavelength, 530.9, 16.3, 31.1),
      z: 1.217 * lobe(wavelength, 437.0, 11.8, 36.0)
        + 0.681 * lobe(wavelength, 459.0, 26.0, 13.8),
    };
  }

  function linspace(start, end, count) {
    if (count <= 1) return [start];
    const step = (end - start) / (count - 1);
    const result = new Array(count);
    for (let index = 0; index < count; index += 1) {
      result[index] = start + step * index;
    }
    return result;
  }

  function trapezoid(xs, ys) {
    let sum = 0;
    for (let index = 1; index < xs.length; index += 1) {
      sum += 0.5 * (ys[index - 1] + ys[index]) * (xs[index] - xs[index - 1]);
    }
    return sum;
  }

  let whiteCache = null;
  function whiteIntegrals() {
    if (whiteCache) return whiteCache;
    const wavelengths = linspace(LAMBDA_MIN, LAMBDA_MAX, 4001);
    const xbar = new Array(wavelengths.length);
    const ybar = new Array(wavelengths.length);
    const zbar = new Array(wavelengths.length);
    for (let index = 0; index < wavelengths.length; index += 1) {
      const cmf = cieXYZ(wavelengths[index]);
      xbar[index] = cmf.x;
      ybar[index] = cmf.y;
      zbar[index] = cmf.z;
    }
    whiteCache = {
      x: trapezoid(wavelengths, xbar),
      y: trapezoid(wavelengths, ybar),
      z: trapezoid(wavelengths, zbar),
    };
    return whiteCache;
  }

  function cosAfterSnell(nIncident, cosIncident, nTransmitted) {
    const sinIncident = Math.sqrt(Math.max(0, 1 - cosIncident * cosIncident));
    const sinTransmitted = (nIncident / nTransmitted) * sinIncident;
    return Math.sqrt(Math.max(0, 1 - sinTransmitted * sinTransmitted));
  }

  function fresnelAmplitude(ni, nj, cosI, cosT, polarization) {
    if (polarization === "p") {
      return (nj * cosI - ni * cosT) / (nj * cosI + ni * cosT);
    }
    return (ni * cosI - nj * cosT) / (ni * cosI + nj * cosT);
  }

  function interfaceReflectance(ni, nj, cosI, cosT, polarization) {
    const amplitude = fresnelAmplitude(ni, nj, cosI, cosT, polarization);
    return amplitude * amplitude;
  }

  function bareReflectance(nIncident, nSubstrate, angleDeg, polarization) {
    const cosIncident = Math.cos(clamp(angleDeg, 0, 89.999) * DEG);
    const cosSubstrate = cosAfterSnell(nIncident, cosIncident, nSubstrate);
    if (polarization === "s" || polarization === "p") {
      return interfaceReflectance(
        nIncident,
        nSubstrate,
        cosIncident,
        cosSubstrate,
        polarization,
      );
    }
    const rs = interfaceReflectance(nIncident, nSubstrate, cosIncident, cosSubstrate, "s");
    const rp = interfaceReflectance(nIncident, nSubstrate, cosIncident, cosSubstrate, "p");
    return 0.5 * (rs + rp);
  }

  function polarizationReflectance(wavelength, thickness, nFilm, angleDeg, polarization) {
    const cos0 = Math.cos(clamp(angleDeg, 0, 89.999) * DEG);
    const cos1 = cosAfterSnell(N_AIR, cos0, nFilm);
    const cos2 = cosAfterSnell(N_AIR, cos0, N_SUBSTRATE);
    const r01 = fresnelAmplitude(N_AIR, nFilm, cos0, cos1, polarization);
    const r12 = fresnelAmplitude(nFilm, N_SUBSTRATE, cos1, cos2, polarization);
    const beta = (2 * Math.PI * nFilm * Math.max(0, thickness) * cos1) / wavelength;
    const phase = 2 * beta;
    const cosine = Math.cos(phase);
    const sine = Math.sin(phase);
    const product = r01 * r12;
    const numeratorReal = r01 + r12 * cosine;
    const numeratorImag = r12 * sine;
    const denominatorReal = 1 + product * cosine;
    const denominatorImag = product * sine;
    const numerator = numeratorReal * numeratorReal + numeratorImag * numeratorImag;
    const denominator = denominatorReal * denominatorReal + denominatorImag * denominatorImag;
    if (denominator < 1e-30) return 0;
    return clamp(numerator / denominator, 0, 1);
  }

  function reflectanceAt(wavelength, thickness, nFilm, angleDeg) {
    const rs = polarizationReflectance(wavelength, thickness, nFilm, angleDeg, "s");
    const rp = polarizationReflectance(wavelength, thickness, nFilm, angleDeg, "p");
    return clamp(0.5 * (rs + rp), 0, 1);
  }

  function sampleSpectrum(options) {
    const thickness = options.thickness;
    const nFilm = options.nFilm;
    const angle = options.angle;
    const count = Math.max(2, Math.round(options.count || 241));
    const includeNormal = Boolean(options.includeNormal);
    const wavelengths = linspace(LAMBDA_MIN, LAMBDA_MAX, count);
    const reflectance = new Array(count);
    const normal = includeNormal ? new Array(count) : null;
    for (let index = 0; index < count; index += 1) {
      const wavelength = wavelengths[index];
      reflectance[index] = reflectanceAt(wavelength, thickness, nFilm, angle);
      if (normal) normal[index] = reflectanceAt(wavelength, thickness, nFilm, 0);
    }
    return { wavelengths, reflectance, normal, thickness, nFilm, angle, count };
  }

  function spectralIntegrals(wavelengths, reflectance) {
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let weightedR = 0;
    for (let index = 0; index < wavelengths.length; index += 1) {
      const cmf = cieXYZ(wavelengths[index]);
      const delta = index === 0 ? 0 : wavelengths[index] - wavelengths[index - 1];
      const nextDelta = index === wavelengths.length - 1
        ? 0
        : wavelengths[index + 1] - wavelengths[index];
      const weight = 0.5 * (delta + nextDelta);
      sumX += reflectance[index] * cmf.x * weight;
      sumY += reflectance[index] * cmf.y * weight;
      sumZ += reflectance[index] * cmf.z * weight;
      weightedR += reflectance[index] * weight;
    }
    const white = whiteIntegrals();
    return {
      xyz: {
        x: (sumX / white.x) * D65_WHITE.x,
        y: sumY / white.y,
        z: (sumZ / white.z) * D65_WHITE.z,
      },
      averageReflectance: weightedR / (LAMBDA_MAX - LAMBDA_MIN),
    };
  }

  function xyzToLinearSrgb(xyz) {
    return {
      r: 3.2406 * xyz.x - 1.5372 * xyz.y - 0.4986 * xyz.z,
      g: -0.9689 * xyz.x + 1.8758 * xyz.y + 0.0415 * xyz.z,
      b: 0.0557 * xyz.x - 0.2040 * xyz.y + 1.0570 * xyz.z,
    };
  }

  function srgbEncode(channel) {
    const value = clamp(channel, 0, 1);
    return value <= 0.0031308
      ? 12.92 * value
      : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  }

  function acesChannel(channel, exposure) {
    const value = Math.max(0, channel * exposure);
    return clamp(
      (value * (2.51 * value + 0.03)) / (value * (2.43 * value + 0.59) + 0.14),
      0,
      1,
    );
  }

  function displayTransform(linearRgb, exposure) {
    const gain = exposure || 6;
    return {
      r: srgbEncode(acesChannel(linearRgb.r, gain)),
      g: srgbEncode(acesChannel(linearRgb.g, gain)),
      b: srgbEncode(acesChannel(linearRgb.b, gain)),
    };
  }

  function rgbToHex(rgb) {
    const toByte = (value) => Math.round(clamp(value, 0, 1) * 255);
    const channels = [toByte(rgb.r), toByte(rgb.g), toByte(rgb.b)];
    return "#" + channels.map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  function xyzToLab(xyz) {
    const epsilon = 216 / 24389;
    const kappa = 24389 / 27;
    const fx = (value) => {
      const ratio = value / D65_WHITE.x;
      return ratio > epsilon ? Math.cbrt(ratio) : (kappa * ratio + 16) / 116;
    };
    const fy = (value) => {
      const ratio = value / D65_WHITE.y;
      return ratio > epsilon ? Math.cbrt(ratio) : (kappa * ratio + 16) / 116;
    };
    const fz = (value) => {
      const ratio = value / D65_WHITE.z;
      return ratio > epsilon ? Math.cbrt(ratio) : (kappa * ratio + 16) / 116;
    };
    const xr = fx(Math.max(0, xyz.x));
    const yr = fy(Math.max(0, xyz.y));
    const zr = fz(Math.max(0, xyz.z));
    return {
      l: 116 * yr - 16,
      a: 500 * (xr - yr),
      b: 200 * (yr - zr),
    };
  }

  function deltaE76(first, second) {
    const dl = first.l - second.l;
    const da = first.a - second.a;
    const db = first.b - second.b;
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  function colorFromSpectrum(spectrum, exposure) {
    const integrals = spectralIntegrals(spectrum.wavelengths, spectrum.reflectance);
    const linear = xyzToLinearSrgb(integrals.xyz);
    const display = displayTransform(linear, exposure);
    return {
      xyz: integrals.xyz,
      linear,
      display,
      rgb255: {
        r: Math.round(display.r * 255),
        g: Math.round(display.g * 255),
        b: Math.round(display.b * 255),
      },
      hex: rgbToHex(display),
      luminance: clamp(integrals.xyz.y, 0, 1),
      averageReflectance: clamp(integrals.averageReflectance, 0, 1),
      lab: xyzToLab(integrals.xyz),
    };
  }

  function colorContinuity(options) {
    const start = options.start;
    const end = options.end;
    const step = options.step || 0.5;
    const count = options.count || 121;
    const thickness = options.thickness;
    const nFilm = options.nFilm;
    const angles = linspace(start, end, Math.max(2, Math.round((end - start) / step) + 1));
    let previous = null;
    let maxDelta = 0;
    for (let index = 0; index < angles.length; index += 1) {
      const spectrum = sampleSpectrum({ thickness, nFilm, angle: angles[index], count });
      const color = colorFromSpectrum(spectrum);
      if (previous) {
        const delta = Math.max(
          Math.abs(color.rgb255.r - previous.rgb255.r),
          Math.abs(color.rgb255.g - previous.rgb255.g),
          Math.abs(color.rgb255.b - previous.rgb255.b),
        );
        maxDelta = Math.max(maxDelta, delta);
      }
      previous = color;
    }
    return maxDelta;
  }

  function energyRange(options) {
    const wavelengths = linspace(LAMBDA_MIN, LAMBDA_MAX, options.count || 81);
    let min = Infinity;
    let max = -Infinity;
    for (let index = 0; index < wavelengths.length; index += 1) {
      const value = reflectanceAt(
        wavelengths[index],
        options.thickness,
        options.nFilm,
        options.angle,
      );
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    return { min, max };
  }

  function wavelengthCss(wavelength) {
    const cmf = cieXYZ(wavelength);
    const xyz = { x: cmf.x, y: cmf.y, z: cmf.z };
    const linear = xyzToLinearSrgb(xyz);
    const peak = Math.max(linear.r, linear.g, linear.b, 1e-7);
    const lift = smoothstep(LAMBDA_MIN, 430, wavelength)
      * (1 - smoothstep(700, LAMBDA_MAX, wavelength));
    const rgb = {
      r: srgbEncode((linear.r / peak) * (0.34 + 0.66 * lift)),
      g: srgbEncode((linear.g / peak) * (0.34 + 0.66 * lift)),
      b: srgbEncode((linear.b / peak) * (0.34 + 0.66 * lift)),
    };
    return rgbToHex(rgb);
  }

  function detectPeaks(wavelengths, reflectance) {
    const peaks = [];
    for (let index = 1; index < reflectance.length - 1; index += 1) {
      const left = reflectance[index - 1];
      const center = reflectance[index];
      const right = reflectance[index + 1];
      if (center >= left && center > right && center > 0.04) {
        peaks.push({ wavelength: wavelengths[index], reflectance: center });
      }
    }
    if (!peaks.length) return peaks;
    const strongest = Math.max(...peaks.map((peak) => peak.reflectance));
    return peaks
      .filter((peak) => peak.reflectance >= Math.max(0.055, strongest * 0.28))
      .sort((a, b) => b.reflectance - a.reflectance)
      .slice(0, 5)
      .sort((a, b) => a.wavelength - b.wavelength);
  }

  function formatScience(value, digits) {
    if (!Number.isFinite(value)) return "—";
    if (value === 0) return "0";
    if (Math.abs(value) < 0.001) return value.toExponential(1);
    return value.toFixed(digits == null ? 3 : digits);
  }

  function runValidation(options) {
    const thickness = Math.max(0, options.thickness);
    const nFilm = options.nFilm;
    const angleScan = linspace(0, 85, 35);
    const wavelengthScan = linspace(LAMBDA_MIN, LAMBDA_MAX, 81);
    let zeroDeviation = 0;
    let zeroMin = Infinity;
    let zeroMax = -Infinity;

    for (let angleIndex = 0; angleIndex < angleScan.length; angleIndex += 1) {
      const angle = angleScan[angleIndex];
      const bare = 0.5 * (
        bareReflectance(N_AIR, N_SUBSTRATE, angle, "s")
        + bareReflectance(N_AIR, N_SUBSTRATE, angle, "p")
      );
      for (let waveIndex = 0; waveIndex < wavelengthScan.length; waveIndex += 1) {
        const value = reflectanceAt(wavelengthScan[waveIndex], 0, nFilm, angle);
        zeroDeviation = Math.max(zeroDeviation, Math.abs(value - bare));
        zeroMin = Math.min(zeroMin, value);
        zeroMax = Math.max(zeroMax, value);
      }
    }

    const normalEnergy = energyRange({ thickness, nFilm, angle: 0, count: 201 });
    const grazingEnergy = energyRange({ thickness, nFilm, angle: 85, count: 201 });
    const normalContinuity = colorContinuity({
      thickness,
      nFilm,
      start: 0,
      end: 2,
      step: 0.1,
      count: 101,
    });
    const grazingContinuity = colorContinuity({
      thickness,
      nFilm,
      start: 83,
      end: 85,
      step: 0.1,
      count: 101,
    });
    const fullContinuity = colorContinuity({
      thickness,
      nFilm,
      start: 0,
      end: 85,
      step: 0.1,
      count: 121,
    });
    const zeroContinuity = colorContinuity({
      thickness: 0,
      nFilm,
      start: 0,
      end: 85,
      step: 0.5,
      count: 101,
    });

    const energyPass = (range) => (
      range.min >= -1e-10 && range.max <= 1 + 1e-10 && Number.isFinite(range.min + range.max)
    );
    const checks = [
      {
        key: "zero-degeneracy",
        label: "零厚度退化",
        detail: "与空气 / 玻璃裸界面逐角比较",
        value: `ΔR ${formatScience(zeroDeviation, 1)}`,
        pass: zeroDeviation < 1e-10,
      },
      {
        key: "zero-energy",
        label: "零厚度能量范围",
        detail: `0–85° × 380–780 nm · 连续色差 ${zeroContinuity}/255`,
        value: `R ${zeroMin.toFixed(3)}–${zeroMax.toFixed(3)}`,
        pass: energyPass({ min: zeroMin, max: zeroMax }) && zeroContinuity <= 4,
      },
      {
        key: "normal",
        label: "法线入射",
        detail: `能量边界 · 0–2° 连续色差 ${normalContinuity}/255`,
        value: `R ${normalEnergy.min.toFixed(3)}–${normalEnergy.max.toFixed(3)}`,
        pass: energyPass(normalEnergy) && normalContinuity <= 4,
      },
      {
        key: "grazing",
        label: "掠射角 85°",
        detail: `能量边界 · 83–85° 连续色差 ${grazingContinuity}/255`,
        value: `R ${grazingEnergy.min.toFixed(3)}–${grazingEnergy.max.toFixed(3)}`,
        pass: energyPass(grazingEnergy) && grazingContinuity <= 5,
      },
      {
        key: "continuity",
        label: "全角颜色连续性",
        detail: "0–85°，0.1° 采样步长",
        value: `max ΔRGB ${fullContinuity}/255`,
        pass: fullContinuity <= 16 && zeroContinuity <= 4,
      },
    ];

    return {
      checks,
      allPass: checks.every((check) => check.pass),
      metrics: {
        zeroDeviation,
        zeroEnergy: { min: zeroMin, max: zeroMax },
        normalEnergy,
        grazingEnergy,
        normalContinuity,
        grazingContinuity,
        fullContinuity,
        zeroContinuity,
      },
    };
  }

  function compareSampling(options) {
    const thickness = options.thickness;
    const nFilm = options.nFilm;
    const angle = options.angle;
    const densities = options.densities || [16, 31, 61, 121, 241, 481];
    const referenceCount = options.referenceCount || 1201;
    const referenceSpectrum = sampleSpectrum({
      thickness,
      nFilm,
      angle,
      count: referenceCount,
    });
    const reference = colorFromSpectrum(referenceSpectrum);
    const rows = densities.map((count) => {
      const spectrum = sampleSpectrum({ thickness, nFilm, angle, count });
      const color = colorFromSpectrum(spectrum);
      return {
        count,
        color,
        deltaE: deltaE76(reference.lab, color.lab),
        rgbError: Math.max(
          Math.abs(reference.rgb255.r - color.rgb255.r),
          Math.abs(reference.rgb255.g - color.rgb255.g),
          Math.abs(reference.rgb255.b - color.rgb255.b),
        ),
      };
    });
    return { reference, rows, referenceCount };
  }

  const api = {
    LAMBDA_MIN,
    LAMBDA_MAX,
    N_AIR,
    N_SUBSTRATE,
    clamp,
    cieXYZ,
    linspace,
    trapz: trapezoid,
    cosAfterSnell,
    fresnelAmplitude,
    bareReflectance,
    polarizationReflectance,
    reflectanceAt,
    sampleSpectrum,
    spectralIntegrals,
    xyzToLinearSrgb,
    xyzToLab,
    deltaE76,
    colorFromSpectrum,
    colorContinuity,
    energyRange,
    wavelengthCss,
    detectPeaks,
    runValidation,
    compareSampling,
    formatScience,
    rgbToHex,
  };

  root.ThinFilmPhysics = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
