window.CONVERGENCE_METRICS = {
  "scene": "Three Forms / Fixed Study 04",
  "renderer": "unbiased path tracing, area-light NEE, GGX specular",
  "resolution": [
    640,
    400
  ],
  "referenceSamples": 2048,
  "referenceFile": "reference.png",
  "colorSpace": "linear RGB before ACES tone mapping",
  "errorDefinition": "RGB RMSE and mean absolute linear error relative to reference",
  "checkpoints": [
    {
      "samples": 10,
      "file": "samples-010.png",
      "rmse": 0.05525551852704549,
      "mae": 0.029378337598378105,
      "relativeL1": 0.16678230888758372,
      "psnr": 25.15248682483562,
      "linearColors": true,
      "finite": true
    },
    {
      "samples": 100,
      "file": "samples-100.png",
      "rmse": 0.01698960200785319,
      "mae": 0.00939579768113881,
      "relativeL1": 0.053340418798490774,
      "psnr": 35.39633589268112,
      "linearColors": true,
      "finite": true
    },
    {
      "samples": 1000,
      "file": "samples-1000.png",
      "rmse": 0.003959435602674408,
      "mae": 0.002226974344771095,
      "relativeL1": 0.012642646024833011,
      "psnr": 48.047334322465495,
      "linearColors": true,
      "finite": true
    }
  ],
  "finiteChecks": {
    "zeroRoughness": true,
    "grazingFresnel": true,
    "nonFinitePixels": 0
  },
  "generatedInMs": 161592
};
