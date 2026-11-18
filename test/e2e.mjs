// Headless verification: serve the demo, open it in Chromium, read the HUD
// metrics and take screenshots (perturbation on/off, clamp on/off).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript' };

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForTimeout(2500);

const hud1 = await page.textContent('#hud');
console.log('=== HUD (扰动开, 钳制开) ===\n' + hud1);
await page.screenshot({ path: join(root, 'artifacts/demo-perturb-on.png') });

await page.uncheck('#hud-perturb');
await page.waitForTimeout(600);
const hud2 = await page.textContent('#hud');
console.log('=== HUD (扰动关) ===\n' + hud2);
await page.screenshot({ path: join(root, 'artifacts/demo-perturb-off.png') });

await page.check('#hud-perturb');
await page.uncheck('#hud-clamp');
await page.waitForTimeout(600);
await page.screenshot({ path: join(root, 'artifacts/demo-no-clamp.png') });

const webgl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  return !!c.getContext('webgl2');
});
console.log('webgl2 available:', webgl);
console.log('console errors:', errors.length ? errors : 'none');

await browser.close();
server.close();
if (errors.length) process.exit(1);
