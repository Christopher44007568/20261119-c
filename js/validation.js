import { NEUTRAL_TEXEL, decodeNormal, encodeNormal } from "./bake.js";
import { dot, normalize } from "./math.js";

function angleDegrees(a, b) {
  return (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;
}

function roundDegrees(value) {
  return value < 0.005 ? 0 : value;
}

export function createKnownFixture() {
  const highNormal = normalize([-0.35, 0.15, 1]);
  const left = {
    tangent: [1, 0, 0],
    bitangent: [0, 1, 0],
    normal: [0, 0, 1],
    handedness: 1,
    uv: [0.08, 0.08, 0.92, 0.92],
  };
  const mirrored = {
    tangent: [-1, 0, 0],
    bitangent: [0, 1, 0],
    normal: [0, 0, 1],
    handedness: -1,
    uv: [0.92, 0.08, 0.08, 0.92],
  };

  const encode = (basis, tangentSign = 1) => {
    const bitangent = [
      (basis.normal[1] * basis.tangent[2] - basis.normal[2] * basis.tangent[1]) *
        tangentSign,
      (basis.normal[2] * basis.tangent[0] - basis.normal[0] * basis.tangent[2]) *
        tangentSign,
      (basis.normal[0] * basis.tangent[1] - basis.normal[1] * basis.tangent[0]) *
        tangentSign,
    ];
    const vector = normalize([
      dot(highNormal, basis.tangent),
      dot(highNormal, bitangent),
      dot(highNormal, basis.normal),
    ]);
    return { vector, rgb: encodeNormal(vector) };
  };

  const leftEncoded = encode(left, 1);
  const mirroredEncoded = encode(mirrored, mirrored.handedness);

  return {
    highNormal,
    left,
    mirrored,
    leftEncoded,
    mirroredEncoded,
  };
}

function decodeWithBasis(encoded, basis, tangentSign) {
  const bitangent = [
    (basis.normal[1] * basis.tangent[2] - basis.normal[2] * basis.tangent[1]) * tangentSign,
    (basis.normal[2] * basis.tangent[0] - basis.normal[0] * basis.tangent[2]) * tangentSign,
    (basis.normal[0] * basis.tangent[1] - basis.normal[1] * basis.tangent[0]) * tangentSign,
  ];
  const decoded = decodeNormal(...encoded.rgb);
  return normalize([
    basis.tangent[0] * decoded[0] + bitangent[0] * decoded[1] + basis.normal[0] * decoded[2],
    basis.tangent[1] * decoded[0] + bitangent[1] * decoded[1] + basis.normal[1] * decoded[2],
    basis.tangent[2] * decoded[0] + bitangent[2] * decoded[1] + basis.normal[2] * decoded[2],
  ]);
}

function neutralCheck(bakeResult) {
  let tested = 0;
  let correct = 0;
  for (let index = 0; index < bakeResult.missMask.length; index += 1) {
    if (!bakeResult.missMask[index]) continue;
    tested += 1;
    const offset = index * 4;
    if (
      bakeResult.texture[offset] === NEUTRAL_TEXEL[0] &&
      bakeResult.texture[offset + 1] === NEUTRAL_TEXEL[1] &&
      bakeResult.texture[offset + 2] === NEUTRAL_TEXEL[2]
    ) {
      correct += 1;
    }
  }
  return { tested, correct, pass: tested === 0 || tested === correct };
}

export function runValidation(bakeResult, mirrorCorrection = true) {
  const fixture = createKnownFixture();
  const leftWorld = decodeWithBasis(fixture.leftEncoded, fixture.left, 1);
  const mirrorWorld = decodeWithBasis(
    fixture.mirroredEncoded,
    fixture.mirrored,
    mirrorCorrection ? fixture.mirrored.handedness : 1,
  );
  const leftError = roundDegrees(angleDegrees(leftWorld, fixture.highNormal));
  const mirrorError = roundDegrees(angleDegrees(mirrorWorld, fixture.highNormal));
  const neutral = neutralCheck(bakeResult);
  const redReversed =
    fixture.leftEncoded.rgb[0] < 128 && fixture.mirroredEncoded.rgb[0] > 128;
  const bakeError = roundDegrees(bakeResult.metrics.meanError);

  const tests = [
    {
      key: "fixture",
      label: "已知高低模对 / 世界回贴",
      value: `Δ ${leftError.toFixed(2)}°`,
      pass: leftError < 0.5,
    },
    {
      key: "mirror",
      label: "镜像 U / 副切线手性",
      value: mirrorCorrection
        ? `w ${fixture.mirrored.handedness > 0 ? "+" : ""}${fixture.mirrored.handedness}`
        : "未校正",
      pass: mirrorCorrection && redReversed && mirrorError < 0.5,
    },
    {
      key: "neutral",
      label: "零命中 / 中性法线",
      value: neutral.tested > 0 ? `${neutral.correct} / ${neutral.tested}` : "静态常量",
      pass: neutral.pass,
    },
    {
      key: "bake",
      label: "当前烘焙 / 高模法线误差",
      value: `P95 ${bakeResult.metrics.errorP95.toFixed(2)}°`,
      pass: bakeError < 5 && bakeResult.metrics.errorP95 < 12,
    },
  ];

  return {
    tests,
    fixture,
    leftError,
    mirrorError,
    bakeError,
    maxError: Math.max(leftError, mirrorError),
    allPass: tests.every((test) => test.pass),
    summary:
      tests.every((test) => test.pass)
        ? "世界空间重建与镜像手性一致"
        : "检测到 TBN 或回贴不一致",
  };
}
