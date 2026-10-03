import assert from 'node:assert/strict';
import { app } from 'electron';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Project } from '@gold-work/shared';
import { AnyModelClient } from '../src/anymodel-client.js';
import { AnyModelStore } from '../src/anymodel-store.js';
import { documentaryJson } from '../src/documentary-intelligence.js';
import { effectFfmpeg, probeEffectMedia } from '../src/effect-media.js';
import { atomicWrite } from '../src/fs-utils.js';

assert.ok(process.argv.includes('--paid'));
const id = process.argv.find(value => value.startsWith('--project-id='))?.slice(13);
assert.ok(id && /^project_[a-zA-Z0-9_]+$/.test(id));
const profile = 'C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const registry = join(profile, 'projects.json'), before = await readFile(registry, 'utf8');
  const project = (JSON.parse(before) as Project[]).find(project => project.id === id)!;
  assert.ok(project?.status === 'complete' && project.outputPath, 'Requires an actual completed Final');
  const out = resolve(`captures/review-${id}/final`); await mkdir(out, { recursive: true });
  const audio = join(out, 'final-audio.mp3');
  await effectFfmpeg(['-y', '-i', project.outputPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '96k', audio]);
  const media = await probeEffectMedia(audio), data = await readFile(audio);
  assert.ok(data.length < 25 * 1024 * 1024 && media.durationSeconds > 0);
  const checksum = createHash('sha256').update(data).digest('hex');
  const checkpoint = join(out, `audio-review-${checksum.slice(0, 16)}.json`);
  assert.equal(await stat(checkpoint).catch(() => null), null, 'Read the saved response; do not resubmit an uncertain or completed audio review');
  const startedAt = new Date().toISOString();
  await atomicWrite(checkpoint, JSON.stringify({ state: 'pending', startedAt, checksum, seconds: media.durationSeconds }));
  const client = new AnyModelClient(new AnyModelStore(join(profile, 'credentials/anymodel.json')));
  let writing: Promise<void> | undefined, lastWrite = 0, writeFailure: unknown;
  let raw: string;
  try { raw = await client.documentaryCompletion(
    'Audit the ACTUAL full attached Russian documentary soundtrack. Listen rather than infer from the text. Return JSON only: {"heardEntireAudio":true,"transcript":"verbatim words actually heard, no invented corrections","speechUnderstandable":true,"clippedWords":[{"seconds":0,"detail":"..."}],"maskingEvents":[{"seconds":0,"detail":"sound effect hides narration"}],"unexpectedMusic":false,"ending":"actual last sentence and whether its end is intact","overall":"brief Russian assessment","limitations":[]}. Report audible clicks, excessive pauses, repeated/missing words and abrupt endings with timestamps. Do not infer that music or effects exist unless heard. If audio cannot be decoded/heard completely say so. A model review is not proof of exact sample timing.',
    JSON.stringify({ seconds: media.durationSeconds, expectedLanguage: 'Russian', purpose: 'Final soundtrack quality and independent transcription; no new TTS' }),
    [`data:audio/mpeg;base64,${data.toString('base64')}`], undefined,
    partial => { if (!writing && !writeFailure && Date.now() - lastWrite > 1000) { lastWrite = Date.now(); writing = atomicWrite(checkpoint, JSON.stringify({ state: 'partial', startedAt, checksum, raw: partial })).catch(error => { writeFailure = error; }).finally(() => { writing = undefined; }); } });
  } finally { await writing; }
  await atomicWrite(checkpoint, JSON.stringify({ state: 'received', startedAt, checksum, raw }));
  const review = documentaryJson(raw);
  assert.equal(await readFile(registry, 'utf8'), before, 'Read-only audio audit must preserve every project');
  const result = { state: 'complete', startedAt, seconds: media.durationSeconds, elapsedSeconds: (Date.now() - Date.parse(startedAt)) / 1000,
    checksum, requests: 1, evidence: 'live configured transcription model reviewing the actual Final audio; not human listening', registryUnchanged: true, review };
  await atomicWrite(checkpoint, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ checkpoint, ...result, review: { ...review, transcript: '[saved in report]' } }));
}).then(() => app.exit(0), error => { console.error(String(error).replace(/https?:\/\/\S+/g, '[URL]')); app.exit(1); });
