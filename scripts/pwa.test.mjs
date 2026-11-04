import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = new URL('../dist/client/', import.meta.url);
test('manifest icons have the advertised dimensions', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const bytes = await readFile(new URL(icon.src.slice(1), root));
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});
test('worker caches the shell, handles offline navigation, and excludes APIs', async () => {
  const handlers = {};
  let assets;
  const shell = { body: 'offline shell' };
  const removed = [];
  const context = {
    self: { location: { origin: 'https://draw.test' }, clients: { claim: async () => {} }, addEventListener: (name, fn) => handlers[name] = fn },
    caches: {
      open: async () => ({ addAll: async list => { assets = list; }, match: async path => path === '/index.html' ? shell : undefined }),
      keys: async () => ['draw-shell-old', 'unrelated'], delete: async key => removed.push(key),
    },
    fetch: async () => { throw new Error('offline'); }, URL, Set, Promise,
  };
  vm.runInNewContext(await readFile(new URL('sw.js', root), 'utf8'), context);
  let pending;
  handlers.install({ waitUntil: promise => pending = promise }); await pending;
  assert(assets.includes('/index.html'));
  for (const path of assets) {
    assert(!path.startsWith('//'));
    await access(new URL(path.slice(1), root));
  }
  handlers.activate({ waitUntil: promise => pending = promise }); await pending;
  assert.deepEqual(removed, ['draw-shell-old']);
  let response;
  const event = (url, mode = 'navigate', method = 'GET') => ({ request: { url, mode, method }, respondWith: promise => response = promise });
  handlers.fetch(event('https://draw.test/?drawing=secret'));
  assert.equal(await response, shell);
  for (const url of ['https://draw.test/api/users', 'https://database.test/api/drawings']) {
    response = undefined; handlers.fetch(event(url)); assert.equal(response, undefined);
  }
  response = undefined;
  handlers.fetch(event('https://draw.test/api/save', 'cors', 'POST'));
  assert.equal(response, undefined);
});
