// Read-only source timing probe. Uses one saved public stock candidate, no AI calls.
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import type {DocumentaryCandidate, Project} from '@gold-work/shared';
import {downloadDocumentaryFile} from '../src/documentary-download.js';
import {downloadDirectDocumentaryPreview} from '../src/documentary-preview.js';
import {probeEffectMedia} from '../src/effect-media.js';

const [projectFile, outputDirectory, candidateId = 'pexels:32554208'] = process.argv.slice(2);
if (!projectFile || !outputDirectory) throw Error('Pass a saved project JSON and output directory');
const project = JSON.parse(await readFile(resolve(projectFile), 'utf8')) as Project;
const candidate = project.scenes.flatMap(scene => scene.documentary?.candidates ?? [])
  .find((item): item is DocumentaryCandidate => item.id === candidateId && item.kind === 'video');
if (!candidate || !['pexels', 'pixabay'].includes(candidate.provider) || !candidate.downloadUrl) throw Error('Saved public stock video not found');
const output = resolve(outputDirectory);
await mkdir(output, {recursive: true});
const result: Record<string, unknown> = {
  at: new Date().toISOString(), provider: candidate.provider, id: candidate.id,
  durationSeconds: candidate.durationSeconds, width: candidate.width, height: candidate.height, paidPosts: 0,
};
try {
  const previewStart = performance.now();
  try {
    const preview = await downloadDirectDocumentaryPreview(candidate, join(output, 'preview'), AbortSignal.timeout(45_000));
    result.previewBytes = preview.bytes;
    result.previewTransferBytes = preview.downloadedBytes;
  } catch (error) {
    result.previewError = (error instanceof Error ? `${error.name}: ${error.message}` : String(error))
      .replace(/https?:\/\/\S+/g, '[source]').slice(-400);
  }
  result.previewSeconds = Math.round((performance.now() - previewStart) / 10) / 100;
  const fullPath = join(output, 'original.mp4');
  const fullStart = performance.now();
  await downloadDocumentaryFile(candidate.downloadUrl, fullPath, AbortSignal.timeout(120_000));
  result.fullSeconds = Math.round((performance.now() - fullStart) / 10) / 100;
  result.fullBytes = (await stat(fullPath)).size;
  const media = await probeEffectMedia(fullPath);
  result.actualDurationSeconds = media.durationSeconds;
  result.actualWidth = media.width;
  result.actualHeight = media.height;
} catch (error) {
  result.error = (error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    .replace(/https?:\/\/\S+/g, '[source]').slice(-1400);
  process.exitCode = 1;
}
await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
