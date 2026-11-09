/** Explicit integrator command. Never imported by the application.
 * Prepares music only; no Electron, render, paid API or project.json mutation.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { Project } from '@gold-work/shared';
import { documentaryMusicProfile, MUSIC_RETRIEVAL_BUDGET, prepareDocumentaryMusic } from './documentary-auto-music.js';

const [projectDirectory, directory, evidencePath] = process.argv.slice(2);
if (![projectDirectory, directory, evidencePath].every(path => path && isAbsolute(path))) {
  throw new Error('Usage: tsx documentary-music-recovery-live.ts <absolute project directory> <absolute Music library> <absolute evidence.json>');
}
const project = JSON.parse(await readFile(join(projectDirectory!, 'project.json'), 'utf8')) as Project;
const montage = project.settings.assembly.documentary?.montage;
if (montage?.musicPolicy !== 'automatic') throw new Error('Project has not opted into automatic music.');
// Match the existing engine input exactly so assembly reuses selection.json.
const input = {directory: directory!, projectDirectory: projectDirectory!, mode: 'auto' as const,
  theme: project.videoBrief?.readyScript?.slice(0, 2400) ?? project.scenes.slice(0, 6).map(scene => scene.narration).join(' '),
  emotion: montage.style === 'cinematic' ? 'cinematic tension' : 'documentary instrumental',
  hook: project.scenes.slice(0, 3).map(scene => scene.narration).join(' '),
};
const started = Date.now();
const result = await prepareDocumentaryMusic(input);
const evidence = {at: new Date().toISOString(), projectId: project.id, profile: documentaryMusicProfile(input),
  elapsedMs: Date.now() - started, budget: MUSIC_RETRIEVAL_BUDGET, ...result,
  acceptance: 'Music preparation only. Final render and listening remain integrator-owned.'};
await writeFile(evidencePath!, JSON.stringify(evidence, null, 2), {flag: 'wx'});
console.log(JSON.stringify(evidence, null, 2));
if (!result.music) process.exitCode = 1;
