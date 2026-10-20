#!/usr/bin/env node
/**
 * Minimal static file server for local development / e2e tests.
 * Usage: node scripts/serve.mjs [port] [dir]
 * Binds to 0.0.0.0 so it is reachable from sandboxed/preview environments.
 */
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const port = Number(process.argv[2] || process.env.PORT || 8080);
const root = resolve(process.argv[3] || ".");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (path.endsWith("/")) path += "index.html";
  const file = join(root, path);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  let st;
  try { st = statSync(file); } catch { res.writeHead(404); return res.end("Not found"); }
  if (st.isDirectory()) { res.writeHead(301, { Location: url.pathname + "/" }); return res.end(); }
  res.writeHead(200, {
    "Content-Type": MIME[extname(file)] || "application/octet-stream",
    "Content-Length": st.size,
    "Cache-Control": "no-store"
  });
  createReadStream(file).pipe(res);
}).listen(port, "0.0.0.0", () => console.log(`Serving ${root} at http://0.0.0.0:${port}`));
