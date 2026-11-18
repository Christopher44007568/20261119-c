"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer((request, response) => {
  const rawPath = decodeURIComponent((request.url || "/").split("?")[0]);
  const relative = rawPath === "/" ? "index.html" : rawPath.replace(/^\/+/, "");
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(root + path.sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.stat(filename, (statError, stat) => {
    if (statError || !stat.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    const headers = {
      "Content-Type": mime[path.extname(filename)] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache"
    };
    response.writeHead(200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    fs.createReadStream(filename).pipe(response);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Lumen is running at http://127.0.0.1:${port}`);
});
