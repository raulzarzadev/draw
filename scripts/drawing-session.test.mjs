import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasDraftContent, selectDrawingId, loadAccountLibrary, draftImportId, createDraftImporter } from '../src/drawing-session.ts';

const draft = (elements = []) => ({ id: 'local-free-drawing', owner: '', created: '2026-11-04T10:00:00.000Z', scene: { elements } });
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };

test('empty and erased guest boards are never imported', async () => {
  const importer = createDraftImporter();
  for (const scene of [draft(), draft([{ id: 'erased', isDeleted: true }])]) {
    assert.equal(hasDraftContent(scene), false);
    assert.equal(await importer(scene, 'owner', { create: () => assert.fail('blank import'), find: () => assert.fail('blank lookup'), isCurrent: () => true }), null);
  }
  assert.equal(hasDraftContent(draft([{ id: 'visible' } ])), true);
});

test('saved boards publish before quota loads and survive quota failure', async () => {
  const limit = deferred();
  let published;
  const task = loadAccountLibrary({
    loadDrawings: async () => [{ id: 'saved' }], loadLimit: () => limit.promise,
    publish: items => published = items, isCurrent: () => true,
  });
  await Promise.resolve();
  assert.deepEqual(published, [{ id: 'saved' }]);
  limit.resolve(3);
  assert.equal((await task).limit, 3);
  const failed = await loadAccountLibrary({
    loadDrawings: async () => [{ id: 'saved' }], loadLimit: async () => { throw new Error('unavailable'); },
    publish: items => published = items, isCurrent: () => true,
  });
  assert.equal(failed.limit, null);
  assert.deepEqual(published, [{ id: 'saved' }]);
});

test('responses from a previous account cannot publish its library', async () => {
  const list = deferred();
  let current = true;
  const task = loadAccountLibrary({ loadDrawings: () => list.promise, loadLimit: async () => 3,
    publish: () => assert.fail('stale account published'), isCurrent: () => current });
  current = false; list.resolve([{ id: 'other-account' }]);
  assert.equal(await task, null);
});

test('selection recovers from an absent guest or deleted board ID', () => {
  assert.equal(selectDrawingId('local-free-drawing', [{ id: 'saved' }]), 'saved');
  assert.equal(selectDrawingId('second', [{ id: 'first' }, { id: 'second' }]), 'second');
  assert.equal(selectDrawingId('deleted', []), null);
});

test('concurrent imports create once; retry after a lost response finds the saved record', async () => {
  const importer = createDraftImporter();
  const drawing = draft([{ id: 'shape' }]);
  const gate = deferred();
  let creates = 0;
  const records = new Map();
  const io = {
    create: async id => {
      creates++;
      await gate.promise;
      const record = { ...drawing, id, owner: 'owner' };
      records.set(id, record);
      throw new Error('response lost after commit');
    },
    find: async id => records.get(id), isCurrent: () => true,
  };
  const first = importer(drawing, 'owner', io);
  const second = importer(drawing, 'owner', io);
  // Wait for Web Crypto to compute the draft ID, then release the create.
  while (!creates) await new Promise(resolve => setImmediate(resolve));
  gate.resolve();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(creates, 1);
  assert.equal(one.id, two.id);
  const retry = await createDraftImporter()(drawing, 'owner', {
    ...io, create: async () => { throw new Error('already exists'); },
  });
  assert.equal(retry.id, one.id);
  assert.equal(records.size, 1);
  assert.match(one.id, /^[a-f0-9]{15}$/);
  assert.notEqual(await draftImportId('other-owner', drawing.created), one.id);
});

test('a failed import is retryable, and a stale account cannot start an import', async () => {
  const importer = createDraftImporter();
  const drawing = draft([{ id: 'shape' }]);
  await assert.rejects(importer(drawing, 'owner', {
    create: async () => { throw new Error('offline'); }, find: async () => { throw new Error('offline'); }, isCurrent: () => true,
  }), /offline/);
  assert.equal(await importer(drawing, 'owner', {
    create: () => assert.fail('stale import'), find: () => assert.fail('stale lookup'), isCurrent: () => false,
  }), null);
  const result = await importer(drawing, 'owner', {
    create: async id => ({ ...drawing, id, owner: 'owner' }), find: () => assert.fail('unnecessary lookup'), isCurrent: () => true,
  });
  assert.equal(result.owner, 'owner');
});
