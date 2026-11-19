import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const artifacts = join(root, "artifacts");
await mkdir(artifacts, { recursive: true });

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent((request.url || "/").split("?")[0]);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  try {
    const body = await readFile(normalize(join(root, relative)));
    response.writeHead(200, { "content-type": mime[extname(relative)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
  "/home/hj/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = candidates.find((path) => existsSync(path));
const browser = await chromium.launch({
  executablePath,
  args: [
    "--enable-unsafe-webgpu",
    "--use-angle=vulkan",
    "--enable-features=Vulkan",
    "--enable-unsafe-swiftshader",
  ],
});

const errors = [];
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

async function openPage(query) {
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/?${query}`);
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent?.includes("ready"),
    null,
    { timeout: 20000 },
  );
  await page.waitForTimeout(800);
  return page;
}

async function capture(page, filename) {
  const result = await page.evaluate(async () => {
    const capture = await window.__volumetric.renderer.capture();
    const rgba = new Uint8ClampedArray(capture.data);
    if (capture.format === "bgra8unorm") {
      for (let i = 0; i < rgba.length; i += 4) {
        const red = rgba[i];
        rgba[i] = rgba[i + 2];
        rgba[i + 2] = red;
      }
    }
    let luma = 0;
    let redPixels = 0;
    let bright = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      const value = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
      luma += value;
      if (rgba[i] > 24) redPixels++;
      if (value > 180) bright++;
    }
    const canvas = new OffscreenCanvas(capture.width, capture.height);
    canvas.getContext("2d").putImageData(
      new ImageData(rgba, capture.width, capture.height),
      0,
      0,
    );
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return {
      url: `data:image/png;base64,${btoa(binary)}`,
      meanLuma: luma / (rgba.length / 4),
      redPixels,
      bright,
      width: capture.width,
      height: capture.height,
    };
  });
  await writeFile(join(artifacts, filename), Buffer.from(result.url.split(",")[1], "base64"));
  return {
    artifact: filename,
    width: result.width,
    height: result.height,
    meanLuma: result.meanLuma,
    redPixels: result.redPixels,
    bright: result.bright,
  };
}

async function measureGpuConvergence(page) {
  return page.evaluate(async () => {
    const renderer = window.__volumetric.renderer;
    async function snapshot(steps) {
      renderer.settings.steps = steps;
      const capture = await renderer.capture();
      const data = new Uint8ClampedArray(capture.data);
      const luma = new Float32Array(capture.width * capture.height);
      for (let i = 0, pixel = 0; i < data.length; i += 4, pixel++) {
        luma[pixel] = (data[i] + data[i + 1] + data[i + 2]) / 3;
      }
      return luma;
    }
    function meanDifference(a, b) {
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
      return sum / a.length;
    }
    const steps32 = await snapshot(32);
    const steps96 = await snapshot(96);
    const steps192 = await snapshot(192);
    const reference = await snapshot(384);
    return {
      steps32ToReference: meanDifference(steps32, reference),
      steps96ToReference: meanDifference(steps96, reference),
      steps192ToReference: meanDifference(steps192, reference),
    };
  });
}

const metrics = { views: {}, convergence: {}, errors };
try {
  for (const view of ["final", "half", "guided", "weights", "shadow"]) {
    const page = await openPage(`view=${view}&hud=0`);
    metrics.views[view] = await capture(page, `e2e_${view}.png`);
    await page.close();
  }

  const probePage = await openPage("view=weights&wdebug=1&hud=0");
  const probe = await capture(probePage, "e2e_weights_raw.png");
  metrics.rejectedPixels = probe.redPixels;
  await probePage.close();

  const convergencePage = await openPage("view=guided&dither=0&hud=0");
  metrics.gpuConvergence = await measureGpuConvergence(convergencePage);
  await convergencePage.close();

  const uiPage = await openPage("view=final");
  await uiPage.locator("#steps").fill("16");
  await uiPage.locator("#steps").dispatchEvent("input");
  const error16 = parseFloat(await uiPage.textContent("#conv-error"));
  await uiPage.locator("#steps").fill("192");
  await uiPage.locator("#steps").dispatchEvent("input");
  const error192 = parseFloat(await uiPage.textContent("#conv-error"));
  metrics.convergence = { steps16Percent: error16, steps192Percent: error192 };
  metrics.transmittanceError = await uiPage.textContent("#trans-error");
  metrics.volumeResolution = await uiPage.textContent("#vol-res");
  await uiPage.close();

  assert.equal(metrics.views.final.width, 1280);
  assert.equal(metrics.views.final.height, 720);
  assert.equal(metrics.volumeResolution, "640×360");
  assert.ok(metrics.views.final.meanLuma > 4, "final composite should not be blank");
  assert.ok(metrics.views.final.meanLuma < 180, "final composite should retain shadow detail");
  assert.ok(metrics.views.final.bright < 0.08 * 1280 * 720, "highlight area should stay local");
  assert.ok(metrics.rejectedPixels > 200, "raw weight probe should expose rejected edge taps");
  assert.ok(error192 < error16, "scattering error should decrease with more steps");
  assert.ok(
    metrics.gpuConvergence.steps96ToReference <
      metrics.gpuConvergence.steps32ToReference,
    "GPU image at 96 steps should be closer to 384-step reference than 32 steps",
  );
  assert.ok(
    metrics.gpuConvergence.steps192ToReference <
      metrics.gpuConvergence.steps96ToReference,
    "GPU image at 192 steps should be closer to 384-step reference than 96 steps",
  );
  assert.equal(errors.length, 0, errors.join("\n"));

  await writeFile(join(artifacts, "e2e_metrics.json"), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  await browser.close();
  server.close();
}
