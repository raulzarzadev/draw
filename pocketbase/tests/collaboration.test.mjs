import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import PocketBase from "pocketbase";

const { mergeScenes, sceneFingerprint } = createRequire(import.meta.url)("../hooks/lib/scene.cjs");
const element = (id, version = 1, versionNonce = 1, extra = {}) => ({ id, version, versionNonce, ...extra });

test("concurrent scenes converge and retain deletion tombstones and images", () => {
  const first = { elements: [element("a"), element("deleted", 3, 3, { isDeleted: true })], files: { imageA: {} } };
  const second = { elements: [element("b"), element("deleted", 2)], files: { imageB: {} } };
  assert.deepEqual(mergeScenes(first, second), mergeScenes(second, first));
  const merged = mergeScenes(first, second);
  assert.equal(merged.elements.length, 3);
  assert.equal(merged.elements.find(e => e.id === "deleted").isDeleted, true);
  assert.deepEqual(Object.keys(merged.files).sort(), ["imageA", "imageB"]);
  assert.deepEqual(mergeScenes(merged, merged), merged);
});

test("equal versions use Excalidraw nonce ordering; viewport changes do not save", () => {
  assert.equal(mergeScenes({ elements: [element("a", 2, 9)] }, { elements: [element("a", 2, 4)] }).elements[0].versionNonce, 4);
  const scene = { elements: [element("a")], appState: { scrollX: 0, viewBackgroundColor: "#fff" } };
  assert.equal(sceneFingerprint(scene), sceneFingerprint({ ...scene, appState: { ...scene.appState, scrollX: 500 } }));
  assert.notEqual(sceneFingerprint(scene), sceneFingerprint({ elements: [element("a", 2)] }));
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) { if (await check()) return; await delay(50); }
  assert.fail("Timed out waiting for realtime event");
}

test("PocketBase merges simultaneous saves and protects scene and laser subscriptions", {
  skip: !process.env.POCKETBASE_BIN,
  timeout: 30000,
}, async () => {
  assert.equal(typeof EventSource, "function", "Run Node with --experimental-eventsource");
  const dir = mkdtempSync(join(tmpdir(), "draw-realtime-"));
  const flags = ["--dir=" + dir,
    "--migrationsDir=" + fileURLToPath(new URL("../migrations", import.meta.url)),
    "--hooksDir=" + fileURLToPath(new URL("../hooks", import.meta.url))];
  const password = randomBytes(24).toString("hex");
  execFileSync(process.env.POCKETBASE_BIN, ["migrate", "up", ...flags], { stdio: "pipe" });
  execFileSync(process.env.POCKETBASE_BIN, ["superuser", "upsert", "test@example.com", password, ...flags], { stdio: "pipe" });
  const port = await new Promise(resolve => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
  const baseURL = `http://127.0.0.1:${port}`;
  const server = spawn(process.env.POCKETBASE_BIN, ["serve", "--http=127.0.0.1:" + port, ...flags], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  server.stdout.on("data", data => { output += data; });
  server.stderr.on("data", data => { output += data; });
  const clients = [];
  try {
    await waitFor(async () => { try { return (await fetch(baseURL + "/api/health")).ok; } catch { return false; } });
    const admin = new PocketBase(baseURL);
    await admin.collection("_superusers").authWithPassword("test@example.com", password);
    const user = await admin.collection("users").create({ email: "owner@example.com", password, passwordConfirm: password });
    const owner = await admin.collection("users").impersonate(user.id, 600);
    const editor = new PocketBase(baseURL), viewer = new PocketBase(baseURL), outsider = new PocketBase(baseURL);
    clients.push(owner, editor, viewer, outsider);
    const drawing = await owner.collection("drawings").create({ owner: user.id, title: "Realtime test", scene: { elements: [] } });
    const token = randomBytes(24).toString("hex");
    await owner.collection("drawings").update(drawing.id, { share_mode: "edit", share_token: token });
    const options = { query: { share_token: token }, requestKey: null };
    const mergeOptions = { query: { share_token: token, scene_merge: "1" }, requestKey: null };
    const events = [], denied = [], lasers = [], deniedLasers = [];
    await viewer.collection("drawings").subscribe(drawing.id, event => events.push(event), options);
    await outsider.collection("drawings").subscribe(drawing.id, event => denied.push(event));
    await viewer.realtime.subscribe("draw-laser/" + drawing.id, event => lasers.push(event), options);
    await outsider.realtime.subscribe("draw-laser/" + drawing.id, event => deniedLasers.push(event));
    await Promise.all([
      owner.collection("drawings").update(drawing.id, { scene: { elements: [element("a")] } }, mergeOptions),
      editor.collection("drawings").update(drawing.id, { scene: { elements: [element("b")] } }, mergeOptions),
    ]);
    const merged = await owner.collection("drawings").getOne(drawing.id);
    assert.ok(merged.scene, output);
    assert.deepEqual(merged.scene.elements.map(e => e.id).sort(), ["a", "b"]);
    await waitFor(() => events.some(e => e.record.scene.elements.length === 2));
    await owner.collection("drawings").update(drawing.id, { scene: { elements: [element("a", 2, 1, { isDeleted: true })] } }, mergeOptions);
    await editor.collection("drawings").update(drawing.id, { scene: { elements: [element("a"), element("c")] } }, mergeOptions);
    assert.equal((await owner.collection("drawings").getOne(drawing.id)).scene.elements.find(e => e.id === "a").isDeleted, true);
    await owner.send(`/api/drawings/${drawing.id}/laser`, { method: "POST", body: { sessionId: "test-owner", x: 20, y: 30, active: true } });
    await waitFor(() => lasers.length === 1);
    assert.equal(lasers[0].pointer.tool, "laser");
    assert.equal(denied.length, 0);
    assert.equal(deniedLasers.length, 0);
    await owner.collection("drawings").update(drawing.id, { share_mode: "view" });
    await assert.rejects(() => editor.collection("drawings").update(drawing.id, { scene: { elements: [] } }, mergeOptions));
    await assert.rejects(() => viewer.send(`/api/drawings/${drawing.id}/laser`, { ...options, method: "POST", body: { sessionId: "viewer", x: 1, y: 1, active: true } }));
    await owner.collection("drawings").update(drawing.id, { share_mode: "restricted", share_token: "" });
    await delay(100);
    const eventCount = events.length, laserCount = lasers.length;
    await owner.collection("drawings").update(drawing.id, { title: "Revoked" });
    await owner.send(`/api/drawings/${drawing.id}/laser`, { method: "POST", body: { sessionId: "test-owner", x: 99, y: 99, active: true } });
    await delay(200);
    assert.equal(events.length, eventCount);
    assert.equal(lasers.length, laserCount);
    await assert.rejects(() => viewer.collection("drawings").getOne(drawing.id, options));
  } finally {
    await Promise.allSettled(clients.map(client => client.realtime.unsubscribe()));
    server.kill();
    await new Promise(resolve => server.once("exit", resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
