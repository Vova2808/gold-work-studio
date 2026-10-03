import assert from 'node:assert/strict';
import test from 'node:test';
import { installStockMainApi } from './stock-main-api.mjs';

test('stop and progress remain available while production awaits a paid response and renderer cannot evaluate', async () => {
  const registered = new Map();
  const ipc = { handle: (channel, handler) => registered.set(channel, handler) };
  const api = installStockMainApi(ipc);
  let finish, calls = 0, stopped = false;
  const paid = new Promise(resolve => { finish = resolve; });
  ipc.handle('queue:start', async () => { calls++; await paid; return ['saved']; });
  ipc.handle('queue:stop', async () => { stopped = true; await paid; return ['drained']; });
  const sent = [];
  const sender = { send: (...args) => sent.push(args), executeJavaScript: () => new Promise(() => {}) };
  api.attach(sender);
  const run = api.call('startGeneration', 'project');
  sender.send('stock:auto-progress', { selected: 82 });
  assert.deepEqual(api.progress(), { selected: 82 });
  assert.equal(sent.length, 1);
  const stop = api.call('stopGeneration', 'project');
  assert.equal(stopped, true);
  finish();
  assert.deepEqual(await run, ['saved']);
  assert.deepEqual(await stop, ['drained']);
  assert.equal(calls, 1);
  assert.equal(registered.size, 2);
});

test('uncertain paid failure propagates without retry; IPC value isolation is retained', async () => {
  const api = installStockMainApi({ handle() {} });
  // A separate fake main models registration; neither test contacts a provider.
  const ipc = { handle() {} };
  const main = installStockMainApi(ipc);
  let calls = 0;
  const input = { title: 'keep' };
  const uncertain = new Error('remote response unknown');
  ipc.handle('projects:create', (_event, value) => { calls++; value.title = 'changed'; throw uncertain; });
  main.attach({ send() {} });
  await assert.rejects(main.call('createProject', input), error => error === uncertain);
  assert.equal(input.title, 'keep');
  assert.equal(calls, 1);
  await assert.rejects(api.call('getProject', 'project'), /unavailable/);
});
