import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../dist/client/", import.meta.url);
const paths = (await readdir(root, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile())
  .map(entry => join(entry.parentPath, entry.name));
const hash = createHash("sha256");
const assets = [];
for (const path of paths.sort()) {
  const assetPath = relative(fileURLToPath(root), path);
  if (assetPath === "sw.js") continue;
  hash.update(assetPath).update(await readFile(path));
  assets.push(`/${assetPath}`);
}
const cache = `draw-shell-${hash.digest("hex").slice(0, 16)}`;
await writeFile(new URL("sw.js", root), `
const CACHE = ${JSON.stringify(cache)};
const ASSETS = ${JSON.stringify(assets)};
const STATIC = new Set(ASSETS);
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
// Updates wait for existing tabs to close, keeping each editor on one build.
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("draw-shell-") && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Do not store API responses, account data, or shared-link URLs.
  if (request.mode === "navigate" && !url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request).catch(async () => {
      return (await caches.open(CACHE)).match("/index.html");
    }));
  } else if (STATIC.has(url.pathname) && !url.search) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      return (await cache.match(url.pathname)) || fetch(request);
    }));
  }
});
`);
console.log(`PWA: ${assets.length} application files cached (${cache}).`);
