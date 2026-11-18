// Headless browser smoke test: loads the demo, fails on console errors,
// verifies stats render, and captures a screenshot.
// Usage: node test/browser.smoke.mjs [chromePath]
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const CHROME =
  process.argv[2] || '/tmp/chromium/linux-1748503/chrome-linux/chrome';
const PORT = 8123;

const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForFunction(
    () => {
      const el = document.getElementById('stats');
      return el && el.innerText.includes('总三角形数');
    },
    { timeout: 20000 },
  );
  await new Promise((r) => setTimeout(r, 1000));

  const stats = await page.evaluate(() => {
    const el = document.getElementById('stats');
    return el ? el.innerText : '';
  });
  console.log('--- stats panel ---');
  console.log(stats);

  if (errors.length) {
    console.error('CONSOLE ERRORS:', errors);
    process.exitCode = 1;
  }
  if (!stats.includes('总三角形数') || !stats.includes('OK')) {
    console.error('stats panel did not report a passing tessellation');
    process.exitCode = 1;
  }

  // Simulate a control-point drag near the bump to exercise local updates.
  await page.mouse.move(760, 330);
  await page.mouse.down();
  await page.mouse.move(760, 260, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 800));
  const statsAfter = await page.evaluate(
    () => document.getElementById('stats').innerText,
  );
  console.log('--- stats after drag ---');
  console.log(statsAfter);
  if (statsAfter.includes('超差')) {
    console.error('deviation exceeded tolerance after control-point drag');
    process.exitCode = 1;
  }

  await page.screenshot({ path: 'artifacts/demo.png' });
  console.log('screenshot: artifacts/demo.png');
} finally {
  await browser.close();
  server.kill();
}
