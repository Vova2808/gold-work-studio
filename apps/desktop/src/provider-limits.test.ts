import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as tick} from 'node:timers/promises';
import {StockClient, StockApiRateLimitError} from './stock-client.js';
import {DocumentarySearch} from './documentary-search.js';

const keys = {apiKey: async () => 'offline-fixture'};
const input = {provider: 'pexels' as const, mediaType: 'image' as const, query: 'historic car'};
const photo = {id: 1, url: 'https://pexels.com/photo/1/', width: 1920, height: 1080,
  photographer: 'Fixture', alt: 'Historic car', src: {medium: 'https://images.pexels.com/1.jpg', original: 'https://images.pexels.com/1.jpg'}};

test('concurrent cold stock searches share one request and return isolated candidates', async () => {
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const client = new StockClient(keys, async () => {
    calls++; await gate;
    return Response.json({photos: [photo], total_results: 1});
  });
  const jobs = Array.from({length: 12}, () => client.search(input));
  await tick(); release();
  const results = await Promise.all(jobs);
  assert.equal(calls, 1);
  results[0]!.items[0]!.description = 'mutated';
  assert.equal(results[1]!.items[0]!.description, 'Historic car');
  assert.equal((await client.search(input)).items[0]!.description, 'Historic car');
});

test('parallel cold searches await the persisted stock cache and quota boundary', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gws-provider-cache-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'stock.json'), now = Date.parse('2026-10-14T12:00:00Z');
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({photos: [photo], total_results: 1}, {headers: {
      'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 3600),
    }});
  };
  await new StockClient(keys, fetcher, path, () => now).search(input);
  const restarted = new StockClient(keys, fetcher, path, () => now);
  const results = await Promise.all(Array.from({length: 12}, () => restarted.search(input)));
  assert.ok(results.every(result => result.items.length === 1));
  await assert.rejects(restarted.search({...input, query: 'different object'}), StockApiRateLimitError);
  assert.equal(calls, 1, 'cache loading must finish before any caller decides to fetch');
});

test('a refused explicit stock refresh keeps the usable saved candidates', async () => {
  let calls = 0;
  const client = new StockClient(keys, async () => ++calls === 1
    ? Response.json({photos: [photo], total_results: 1})
    : new Response('rate limited', {status: 429, headers: {'retry-after': '3600'}}));
  await client.search(input);
  await assert.rejects(client.search(input, true), StockApiRateLimitError);
  assert.equal((await client.search(input)).items.length, 1);
  assert.equal(calls, 2);
});

test('shared stock failures do not become permanent negative cache entries', async () => {
  let now = Date.parse('2026-10-14T12:00:00Z'), calls = 0;
  const client = new StockClient(keys, async () => ++calls === 1
    ? new Response('rate limited', {status: 429, headers: {'retry-after': '60'}})
    : Response.json({photos: [photo], total_results: 1}), undefined, () => now);
  const refused = await Promise.allSettled(Array.from({length: 8}, () => client.search(input)));
  assert.ok(refused.every(result => result.status === 'rejected'));
  assert.equal(calls, 1);
  now += 60_001;
  assert.equal((await client.search(input)).items.length, 1);
  assert.equal(calls, 2);
});

test('archive Retry-After seconds and dates survive later scene queries and recover on time', async t => {
  let now = Date.parse('2026-10-14T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  for (const header of ['3600', 'Wed, 14 Oct 2026 13:00:00 GMT']) {
    now = Date.parse('2026-10-14T12:00:00Z');
    let calls = 0, local = 0;
    const search = new DocumentarySearch(undefined, async () => ++calls === 1
      ? new Response('rate limited', {status: 429, headers: {'retry-after': header}})
      : Response.json({query: {pages: []}}), undefined, async () => {local++; return [];});
    const request = (query: string) => search.search({query, kind: 'image', providers: ['commons', 'local']});
    assert.match((await request('first query')).sources.find(source => source.provider === 'commons')?.error ?? '', /429/);
    assert.equal(search.nextRetryDelayMs(), 3600_000);
    now += 121_000;
    await request('second query');
    assert.equal(calls, 1, 'a later scene must not probe before the header boundary');
    now += 3480_000;
    assert.equal((await request('third query')).sources.find(source => source.provider === 'commons')?.error, undefined);
    assert.equal(calls, 2); assert.equal(local, 3, 'other providers keep working during the pause');
  }
});

test('a later shorter archive refusal cannot erase a longer shared pause', async t => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const search = new DocumentarySearch(undefined, async () => {
    const call = ++calls;
    if (call === 2) await gate;
    return new Response('rate limited', {status: 429, headers: {'retry-after': call === 1 ? '3600' : '10'}});
  });
  const first = search.search({query: 'first query', kind: 'image', providers: ['commons']});
  const second = search.search({query: 'second query', kind: 'image', providers: ['commons']});
  await first; release(); await second;
  assert.equal(calls, 2);
  assert.equal(search.nextRetryDelayMs(), 3600_000);
});

test('concurrent archive refusal prevents an extra SVG metadata request', async () => {
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const search = new DocumentarySearch(undefined, async () => {
    const call = ++calls;
    if (call === 1) {
      await gate;
      return Response.json({query: {pages: [{pageid: 1, imageinfo: [{mime: 'image/svg+xml'}]}]}});
    }
    return new Response('rate limited', {status: 429, headers: {'retry-after': '3600'}});
  });
  const first = search.search({query: 'svg query', kind: 'image', providers: ['commons']});
  await tick();
  await search.search({query: 'second query', kind: 'image', providers: ['commons']});
  release(); await first;
  assert.equal(calls, 2, 'the SVG follow-up must respect the concurrent provider cooldown');
});
