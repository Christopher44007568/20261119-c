/* node tests/run-all.js — 依次运行全部测试套件 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const suites = ['clip.test.js', 'smoke.test.js', 'raster.test.js', 'render.test.js'];
let failed = 0;
suites.forEach((suite) => {
  process.stdout.write('\n=== ' + suite + ' ===\n');
  try {
    execFileSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit' });
  } catch (e) {
    failed++;
  }
});
process.exit(failed ? 1 : 0);
