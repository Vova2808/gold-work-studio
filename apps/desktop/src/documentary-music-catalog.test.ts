import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DOCUMENTARY_MUSIC_CATALOG, MUSIC_CATALOG_VERSION, catalogMusicForMood } from './documentary-music-catalog.js';
import { commonsMusicCandidate, documentaryMusicProfile, MUSIC_RETRIEVAL_BUDGET, prepareDocumentaryMusic } from './documentary-auto-music.js';
import { listImportedMusic } from './documentary-music-import.js';

// Captures the real Commons response shape (utm query, slashless license,
// HTML author and no instrumental keyword). No network or music download here.
function reviewedPage(track: (typeof DOCUMENTARY_MUSIC_CATALOG)[number] = DOCUMENTARY_MUSIC_CATALOG[0]) {
  return { title: String(track.title), imageinfo: [{
    url: track.url + '?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
    descriptionurl: 'https://commons.wikimedia.org/wiki/' + track.title.replaceAll(' ', '_'),
    mime: 'audio/mpeg', size: 10712421, duration: Number(track.durationSeconds), sha1: String(track.sha1),
    extmetadata: {
      Artist: {value: '<bdi><a href="https://en.wikipedia.org/wiki/Kevin_MacLeod">Kevin MacLeod</a></bdi>'},
      ImageDescription: {value: 'Mechanistic, electronic and organic. This piece gets very big around 1:46.'},
      LicenseShortName: {value: 'CC BY 3.0'}, LicenseUrl: {value: 'https://creativecommons.org/licenses/by/3.0'},
      Attribution: {value: `${track.name} Kevin MacLeod (incompetech.com)`},
    },
  }] };
}
async function fixture(t: {after(fn: () => Promise<void>): void}) {
  const root = await mkdtemp(join(tmpdir(), 'gws-music-catalog-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'gws-music-catalog-'));
    await rm(root, {recursive: true, force: true});
  });
  const directory = join(root, 'Music'), projectDirectory = join(root, 'project');
  await mkdir(directory);
  return {directory, projectDirectory, mode: 'auto' as const, theme: 'Ford Ferrari endurance racing speed'};
}
function wav(seconds = 32) {
  const samples = seconds * 8000, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(36 + samples * 2, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(1000 * Math.sin(i * .3)), 44 + i * 2);
  return bytes;
}

test('reviewed recordings retain exact source, license, author and hash despite sparse descriptions', () => {
  for (const track of DOCUMENTARY_MUSIC_CATALOG) {
    const candidate = commonsMusicCandidate(reviewedPage(track));
    assert.ok(candidate);
    assert.equal(candidate.url, track.url);
    assert.equal(candidate.expectedSha1, track.sha1);
    assert.equal(candidate.provenance.author, 'Kevin MacLeod');
    assert.equal(candidate.provenance.license, 'CC BY 3.0');
    assert.equal(candidate.provenance.attribution, `${track.name} Kevin MacLeod (incompetech.com)`);
    assert.ok(track.durationSeconds >= 30 && track.durationSeconds <= 1200);
  }
  for (const mood of ['calm', 'reflective', 'tension', 'energetic', 'discovery']) assert.ok(catalogMusicForMood(mood));
});

test('pinned titles cannot bless changed recordings, authors, licenses or arbitrary URL queries', () => {
  for (const mutate of [
    (p: ReturnType<typeof reviewedPage>) => {p.imageinfo[0]!.sha1 = '0'.repeat(40);},
    (p: ReturnType<typeof reviewedPage>) => {p.imageinfo[0]!.duration = 1;},
    (p: ReturnType<typeof reviewedPage>) => {p.imageinfo[0]!.extmetadata.Artist.value = 'Someone else';},
    (p: ReturnType<typeof reviewedPage>) => {p.imageinfo[0]!.extmetadata.LicenseUrl.value = 'https://creativecommons.org/licenses/by/4.0';},
    (p: ReturnType<typeof reviewedPage>) => {p.imageinfo[0]!.url += '&download=other';},
    (p: ReturnType<typeof reviewedPage>) => {p.imageinfo[0]!.url = p.imageinfo[0]!.url.replace('upload.wikimedia.org', 'example.com');},
  ]) {const page = reviewedPage(); mutate(page); assert.equal(commonsMusicCandidate(page), undefined);}
});

test('unreviewed Ogg still needs instrumental evidence and rejects speech, SFX and vocals', () => {
  const page = reviewedPage(); page.title = 'File:Driving instrumental.ogg';
  page.imageinfo[0]!.url = 'https://upload.wikimedia.org/wikipedia/commons/1/11/Driving.ogg?utm_source=commons.wikimedia.org';
  page.imageinfo[0]!.mime = 'application/ogg';
  page.imageinfo[0]!.extmetadata.ImageDescription.value = 'Driving instrumental electronic music without vocals';
  assert.ok(commonsMusicCandidate(page));
  for (const text of ['Instrumental with vocals', 'Spoken speech over piano', 'Instrumental whoosh sound effect']) {
    page.imageinfo[0]!.extmetadata.ImageDescription.value = text;
    assert.equal(commonsMusicCandidate(page), undefined);
  }
});

test('racing profile is not mistaken for tragedy by toward, reward, warning or intensity', () => {
  assert.equal(documentaryMusicProfile({theme: 'Ford racing toward victory. Warning: high intensity sport.'}).mood, 'energetic');
  assert.equal(documentaryMusicProfile({theme: 'True crime: tragic loss'}).mood, 'tension');
  assert.equal(documentaryMusicProfile({theme: 'Tragedy at a motor race'}).mood, 'reflective');
});

test('reviewed lookup precedes discovery, changed audio is rejected once, and failures cool down', async t => {
  const input = await fixture(t), requested: string[] = [];
  const request: typeof fetch = async url => {
    requested.push(String(url));
    return String(url).startsWith('https://commons.wikimedia.org/') ? Response.json({query: {pages: [reviewedPage()]}}) : new Response(wav());
  };
  const first = await prepareDocumentaryMusic(input, {fetch: request});
  assert.equal(new URL(requested[0]!).searchParams.get('titles'), DOCUMENTARY_MUSIC_CATALOG[0].title);
  assert.equal(new URL(requested[0]!).searchParams.has('generator'), false);
  assert.equal(requested[1], DOCUMENTARY_MUSIC_CATALOG[0].url);
  assert.equal(requested.length, 2);
  assert.equal(first.status, 'unavailable');
  assert.equal(first.diagnostics?.reason, 'invalid-audio');
  assert.equal(first.diagnostics?.downloads, 1);
  assert.deepEqual(await listImportedMusic(input.directory), []);
  assert.deepEqual(await readdir(join(input.directory, 'Downloads')), []);
  const again = await prepareDocumentaryMusic(input, {fetch: request});
  assert.equal(again.diagnostics?.cached, 'cooldown'); assert.equal(requested.length, 2);
});

test('old failure cache does not block recovery; missing catalog record uses one discovery and one download', async t => {
  const input = await fixture(t), requested: string[] = [];
  await mkdir(join(input.directory, 'Queries'));
  const oldKey = createHash('sha256').update('energetic').digest('hex');
  await writeFile(join(input.directory, 'Queries', `${oldKey}.json`), JSON.stringify({until: Date.now() + 1800000, message: 'old metadata rejection'}));
  const page = reviewedPage(); page.title = 'File:Driving instrumental.wav';
  page.imageinfo[0]!.url = 'https://upload.wikimedia.org/wikipedia/commons/1/11/Driving.wav?utm_source=commons.wikimedia.org';
  page.imageinfo[0]!.extmetadata.ImageDescription.value = 'Instrumental electronic soundtrack, driving and epic.';
  const request: typeof fetch = async url => {
    const parsed = new URL(String(url)); requested.push(String(url));
    if (parsed.hostname !== 'commons.wikimedia.org') return new Response(wav());
    return Response.json({query: {pages: parsed.searchParams.has('titles') ? [] : [page]}});
  };
  const result = await prepareDocumentaryMusic(input, {fetch: request});
  assert.equal(result.status, 'ready'); assert.equal(requested.length, 3);
  assert.equal(result.diagnostics?.searches, 2); assert.equal(result.diagnostics?.downloads, 1);
  assert.equal(result.music?.volume, 10); assert.equal(result.music?.ducking, true);
  const attribution = await readFile(join(input.projectDirectory, 'Documentary', 'Music', `${result.music!.assetId}.attribution.txt`), 'utf8');
  assert.match(attribution, /Kevin MacLeod/); assert.match(attribution, /creativecommons.org\/licenses\/by\/3.0/);
  assert.match(attribution, /looped, faded and ducked/);
  const newKey = createHash('sha256').update(`${MUSIC_CATALOG_VERSION}:energetic`).digest('hex');
  assert.ok(await readFile(join(input.directory, 'Queries', `${newKey}.json`)));
  const cached = await prepareDocumentaryMusic({...input, projectDirectory: input.projectDirectory + '-second'}, {fetch: request});
  assert.equal(cached.music?.assetId, result.music?.assetId); assert.equal(requested.length, 3);
});

test('metadata timeout is classified and cached; off stays entirely offline', async t => {
  const input = await fixture(t); let requests = 0;
  const request: typeof fetch = async (_url, init) => {
    requests++; assert.ok(init?.signal);
    throw new DOMException('bounded metadata timeout', 'TimeoutError');
  };
  const result = await prepareDocumentaryMusic(input, {fetch: request});
  assert.equal(result.diagnostics?.reason, 'timeout'); assert.equal(result.diagnostics?.downloads, 0);
  assert.equal(MUSIC_RETRIEVAL_BUDGET.metadataMilliseconds, 5000); assert.equal(MUSIC_RETRIEVAL_BUDGET.milliseconds, 25000);
  const again = await prepareDocumentaryMusic(input, {fetch: request});
  assert.equal(again.diagnostics?.cached, 'cooldown'); assert.equal(requests, 1);
  assert.equal((await prepareDocumentaryMusic({...input, mode: 'off'}, {fetch: request})).status, 'off');
  assert.equal(requests, 1);
});
