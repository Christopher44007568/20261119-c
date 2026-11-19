import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.cwd());
let port = Number(process.env.PORT ?? 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glsl": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const path = normalize(join(root, requested));
    if (!path.startsWith(root)) throw new Error("Path outside workspace");
    const info = await stat(path);
    const file = info.isDirectory() ? join(path, "index.html") : path;
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.on("listening", () => {
  console.log(`Shader Relay listening at http://localhost:${port}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && port < 4200) {
    port += 1;
    server.listen(port, "0.0.0.0");
    return;
  }
  throw error;
});

server.listen(port, "0.0.0.0");
