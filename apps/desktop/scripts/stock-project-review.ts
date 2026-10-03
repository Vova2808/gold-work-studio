import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Project } from '@gold-work/shared';
import { buildDocumentaryTimeline } from '@gold-work/remotion-video';
import { runFfmpeg, mediaDurationSeconds } from '../src/standard-renderer.js';

const id = process.argv[2]; assert.ok(id?.startsWith('project_'));
const final = process.argv.includes('--final');
const project: Project = JSON.parse(await readFile('C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json', 'utf8')).find((project: Project) => project.id === id);
assert.ok(project);
const root = resolve('captures', `review-${id}`, final ? 'final' : 'materials'); await mkdir(root, { recursive: true });
const timeline = buildDocumentaryTimeline(project);
if (final) {
  assert.ok(project.outputPath);
  assert.ok(Math.abs(await mediaDurationSeconds(project.outputPath) - timeline.durationInFrames / timeline.fps) < .08, 'Export must match measured timeline');
}
const scenes = project.scenes.filter(scene => scene.includeInAssembly !== false && scene.documentary?.verified);
let next = 0;
async function worker() {
  for (;;) {
    const index = next++, scene = scenes[index]; if (!scene) return;
    const shot = timeline.scenes.find(item => item.id === scene.id)!;
    const time = final ? (shot.fromFrame + shot.durationInFrames / 2) / timeline.fps
      : scene.videoPath ? (scene.trimStartSeconds ?? 0) + (scene.documentary?.timing?.durationInFrames ?? scene.durationSeconds * 30) / 60 : 0;
    const source = final ? project.outputPath! : scene.videoPath || scene.imagePath!;
    await runFfmpeg(['-y', '-threads', '1', ...(final || scene.videoPath ? ['-ss', String(time)] : []), '-i', source, '-frames:v', '1', '-vf',
      `scale=400:226:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=400:226:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuvj420p,drawtext=text='${scene.order + 1}':fontcolor=white:fontsize=23:box=1:boxcolor=black@0.8:x=8:y=8`, join(root, `scene-${String(index).padStart(3, '0')}.jpg`)]);
  }
}
await Promise.all([worker(), worker()]);
const pages: string[] = [];
for (let offset = 0; offset < scenes.length; offset += 24) {
  const count = Math.min(24, scenes.length - offset), path = join(root, `page-${offset / 24 + 1}.jpg`);
  // Mixed video/photo decoders can choose different JPEG pixel formats/SAR.
  // Normalize above so tile is not reinitialized and loses earlier thumbnails.
  await runFfmpeg(['-y', '-framerate', '1', '-start_number', String(offset), '-i', join(root, 'scene-%03d.jpg'), '-vf', `tile=4x${Math.ceil(count / 4)}:nb_frames=${count}`, '-frames:v', '1', path]);
  pages.push(path);
}
await writeFile(join(root, 'review.json'), JSON.stringify({ projectId: id, final, capturedAt: new Date().toISOString(), pages, scenes: scenes.map(scene => ({ order: scene.order + 1, narration: scene.narration, template: scene.documentary?.template, source: scene.documentary?.selected?.title, checksum: scene.documentary?.checksum, start: scene.trimStartSeconds, end: scene.trimEndSeconds, review: scene.documentary?.visualReview?.reason })) }, null, 2));
console.log(JSON.stringify({ scenes: scenes.length, pages }));
