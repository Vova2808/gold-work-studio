import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {discoverDocumentaryQueryLanes} from './documentary-query-lanes.js';

test('slow candidate inspection preserves settled sources and later queries without spending search time', async () => {
  const calls: string[] = [];
  const batches = discoverDocumentaryQueryLanes({
    lanes: [{provider:'fast',queries:['first','second','third']},{provider:'other',queries:['alternative']}],
    searchMs: 100,
    stopped: () => false,
    discover: async (query, provider) => {
      calls.push(`${provider}:${query}`);
      if (provider === 'other') await delay(5);
      return [`${provider}:${query}`];
    },
  });
  assert.deepEqual((await batches.next()).value, ['fast:first']);
  assert.ok(calls.includes('fast:second'), 'Next query starts before yielding the first candidate');
  await delay(150); // Consumer download, voice wait and rejection outlast the search budget.
  const alternatives: string[] = [];
  for await (const batch of batches) alternatives.push(...batch);
  assert.deepEqual(alternatives.sort(), ['fast:second','fast:third','other:alternative'].sort());
  assert.equal(calls.length, 4, 'Only the supplied bounded query lanes were searched');
});

test('a stalled source exhausts its search budget while independent results remain usable', async () => {
  const calls: string[] = [];
  let stalledSignal: AbortSignal | undefined;
  const batches = discoverDocumentaryQueryLanes({
    lanes: [{provider:'stalled',queries:['first','must-not-start']},{provider:'ready',queries:['useful']}],
    searchMs: 25,
    stopped: () => false,
    discover: async (query, provider, signal) => {
      calls.push(`${provider}:${query}`);
      if (provider === 'stalled') {
        stalledSignal = signal;
        return new Promise<string[]>(() => {});
      }
      return ['usable'];
    },
  });
  assert.deepEqual((await batches.next()).value, ['usable']);
  assert.equal((await batches.next()).done, true);
  assert.equal(stalledSignal?.aborted, true);
  assert.deepEqual(calls, ['stalled:first','ready:useful']);
});

test('explicit Stop discards buffered results and aborts the next query', async () => {
  const controller = new AbortController();
  let nextSignal: AbortSignal | undefined;
  const batches = discoverDocumentaryQueryLanes({
    lanes: [{provider:'source',queries:['first','next']}],
    searchMs: 1000,
    signal: controller.signal,
    stopped: () => false,
    discover: async (query, _provider, signal) => {
      if (query === 'next') nextSignal = signal;
      return [query];
    },
  });
  assert.deepEqual((await batches.next()).value, ['first']);
  controller.abort();
  assert.equal((await batches.next()).done, true);
  assert.equal(nextSignal?.aborted, true);
});

test('ready drain consumes settled sources once without waiting for a stalled lane', async () => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  let stalledSignal: AbortSignal | undefined;
  const batches = discoverDocumentaryQueryLanes({
    lanes: [{provider:'fast',queries:['first']},{provider:'commons',queries:['one','two']},{provider:'stalled',queries:['wait']}],
    searchMs: 1000,
    stopped: () => false,
    discover: async (query, provider, signal) => {
      if (provider === 'stalled') { stalledSignal = signal; return new Promise<string[]>(() => {}); }
      if (provider === 'commons') await ready;
      return [`${provider}:${query}`];
    },
  });
  assert.deepEqual((await batches.next()).value, ['fast:first']);
  assert.deepEqual(batches.takeReady(), []);
  release();
  await delay(0);
  assert.deepEqual(batches.takeReady(), ['commons:one']);
  assert.deepEqual(batches.takeReady(), [], 'Draining never returns an already consumed package');
  assert.deepEqual((await batches.next()).value, ['commons:two']);
  await batches.return(undefined);
  assert.equal(stalledSignal?.aborted, true);
  assert.deepEqual(batches.takeReady(), []);
});
