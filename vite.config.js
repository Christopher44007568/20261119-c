const { defineConfig } = require('vite');
const path = require('path');
const fs = require('fs');

// Serve the CommonJS/UMD core files to the browser as ESM modules without
// duplicating their source. The UMD wrapper sets globalThis.DOF when `module`
// is undefined, so a shimmed module object keeps Node semantics intact while
// the named API is re-exported.
function umdBridge() {
  const root = path.resolve(__dirname, 'src');
  return {
    name: 'umd-bridge',
    resolveId(id, importer) {
      if (id.endsWith('.js') && importer && importer.startsWith(root) === false &&
          fs.existsSync(path.join(root, path.basename(id)))) {
        return path.join(root, path.basename(id));
      }
      return null;
    },
    transform(code, id) {
      if (id.startsWith(root) && id.endsWith('.js')) {
        return {
          code:
            'const module = { exports: {} };\n' +
            code +
            '\nexport default module.exports;\n',
          map: null,
        };
      }
      return null;
    },
  };
}

module.exports = defineConfig({
  root: path.resolve(__dirname, 'web'),
  server: { fs: { allow: [path.resolve(__dirname)] } },
  plugins: [umdBridge()],
  build: { outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true },
});
