import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLaserSender } from '../src/laser-channel.ts';
const pointer = (x, button = 'down', tool = 'laser') => ({ pointer: { x, y: 20, tool }, button });
const waitFor = async check => {
  const deadline = Date.now() + 2000;
  while (!check()) {
    assert(Date.now() < deadline, 'timed out waiting for laser messages');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
};
test('a quick drag sends down before up even within one throttle interval', async () => {
  const sent = [];
  const sender = createLaserSender({ sessionId: 'test', interval: 2, send: async item => { sent.push(item); } });
  try {
    sender.update(pointer(10));
    sender.update(pointer(20));
    sender.update(pointer(30, 'up'));
    assert.equal(sent[0]?.active, true, 'first down must be immediate');
    await waitFor(() => sent.at(-1)?.active === false);
    assert.deepEqual(sent.map(item => item.active), [true, true, false]);
    assert.equal(sent.at(-1).x, 30);
  } finally { sender.dispose(); }
});
test('slow requests coalesce motion and preserve separate strokes in order', async () => {
  const sent = [];
  let release;
  const first = new Promise(resolve => { release = resolve; });
  const sender = createLaserSender({ sessionId: 'test', interval: 2, send: async item => { sent.push(item); if (sent.length === 1) await first; } });
  try {
    sender.update(pointer(1));
    for (let x = 2; x <= 100; x++) sender.update(pointer(x));
    sender.update(pointer(101, 'up'));
    sender.update(pointer(200));
    sender.update(pointer(201, 'up'));
    assert.equal(sent.length, 1, 'only one request may be in flight');
    release();
    await waitFor(() => sent.at(-1)?.x === 201);
    assert(sent.length <= 6, 'intermediate motion must be coalesced');
    assert.deepEqual(sent.filter((item, i) => i === 0 || item.active !== sent[i - 1].active).map(item => item.active), [true, false, true, false]);
    assert(sent.some(item => item.x === 100));
  } finally { sender.dispose(); }
});
test('hover does not send, tool changes end a stroke, and disposal cancels queued events', async () => {
  const sent = [];
  const sender = createLaserSender({ sessionId: 'test', interval: 2, send: async item => { sent.push(item); } });
  sender.update(pointer(1, 'up'));
  sender.update(pointer(2, 'down', 'pointer'));
  assert.equal(sent.length, 0);
  sender.update(pointer(3));
  sender.update(pointer(4, 'up', 'pointer'));
  await waitFor(() => sent.at(-1)?.active === false);
  sender.dispose();
  const count = sent.length;
  sender.update(pointer(5));
  assert.equal(sent.length, count);
});
test('delivery failures are reported and do not block later sends', async () => {
  const sent = [];
  let errors = 0;
  const sender = createLaserSender({ sessionId: 'test', interval: 2,
    send: async item => { sent.push(item); if (sent.length === 1) throw new Error('offline'); },
    onError: () => { errors++; },
  });
  try {
    sender.update(pointer(1)); sender.update(pointer(2, 'up'));
    await waitFor(() => sent.length === 2);
    assert.equal(errors, 1);
    assert.equal(sent[1].active, false);
  } finally { sender.dispose(); }
});
