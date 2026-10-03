import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createVoiceCalibration } from "@gold-work/shared";
import { buildDocumentaryTimeline } from "@gold-work/remotion-video";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { prepareDocumentaryScript } from "../src/documentary-plan.js";
import { prepareDocumentaryTiming } from "../src/documentary-timing.js";
import { StandardRenderer, mediaDurationSeconds, runFfmpeg } from "../src/standard-renderer.js";
import { RemotionMontageRenderer } from "../src/remotion-montage-renderer.js";

const continuous = process.argv.includes("--continuous");
const hybrid = process.argv.includes("--hybrid");
const editing = process.argv.includes("--editing");
const root = resolve(editing ? "captures/documentary-editing-render-smoke" : hybrid ? "captures/documentary-hybrid-render-smoke" : continuous ? "captures/documentary-continuous-render-smoke" : "captures/documentary-render-smoke");
await mkdir(root, { recursive: true });
const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
let project = await service.create({ title: "Documentary local-media render smoke", topic: "Local fixtures", mediaMode: "stock", mode: "standard", language: "English", aspectRatio: "16:9" });
project.videoBrief = { creationMode: "script", readyScript: "The first scene shows a measured reference. The second scene shows a narrow document. The last scene contains moving footage." } as NonNullable<typeof project.videoBrief>;
const calibration = createVoiceCalibration({ provider: "elevenlabs", voice: "fixture-only", language: "en", sampleText: "A measured voice reads every sentence.", audioDurationSeconds: 2.5 });
project.scenes = prepareDocumentaryScript(project, calibration).slice(0, 3);
assert.equal(project.scenes.length, 3);
const audio = join(root, "voice-fixture.wav"), sound = join(root, "sound-fixture.wav"), image = join(root, "image.png"), vertical = join(root, "document.png"), video = join(root, "video.mp4"), overlay = join(root, "overlay.png");
if (continuous) await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-f", "lavfi", "-i", "sine=frequency=660:duration=2", "-f", "lavfi", "-i", "sine=frequency=880:duration=2", "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]", "-map", "[out]", audio]);
else await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-af", "afade=t=in:d=0.03,afade=t=out:st=1.9:d=0.1", audio]);
await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=1400:duration=0.25", sound]);
await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-frames:v", "1", image]);
await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=0xf0eee4:size=480x720", "-vf", "drawgrid=w=90:h=90:t=2:c=0x303a49", "-frames:v", "1", vertical]);
await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=black:size=640x360", "-vf", "drawbox=x=50:y=0:w=60:h=360:c=white:t=fill", "-frames:v", "1", overlay]);
for (const [index, scene] of project.scenes.entries()) {
  scene.audioPath = audio; scene.imagePath = index === 1 ? vertical : image; scene.videoPath = index === 2 ? video : undefined;
  if (continuous) scene.narrationSlice = { sourceSceneId: project.scenes[0]!.id, startSeconds: index * 2, endSeconds: (index + 1) * 2, last: index === 2 };
  scene.durationSeconds = 2; scene.durationOverrideSeconds = undefined;
  scene.stockSource = { provider: "local", assetId: `fixture-${index}`, mediaType: index === 2 ? "video" : "image", query: "fixture", pageUrl: "", author: "local fixture", attribution: "local fixture", licenseUrl: "", downloadedAt: new Date().toISOString() };
  scene.documentary!.verified = true;
  scene.documentary!.caption = { ...scene.documentary!.caption, enabled: true, text: ["1952 · Technical fixture", "ARCHIVE DOCUMENT", "Moving footage"][index]!, animation: index === 1 ? "slide" : "fade" };
  scene.documentary!.layout = index === 1 ? "contain" : "full";
  scene.transition = index === 0 ? "mix" : index === 1 ? "fade" : "none";
  scene.documentary!.effects = index === 0 ? [{ id: "overlay", assetId: "fixture", assetVersion: 1, name: "screen overlay", filePath: overlay, kind: "image", role: "overlay", enabled: true,
    startSeconds: 0, durationSeconds: 2, x: 0, y: 0, scale: 1, blend: "screen", defaults: { blend: "screen", opacity: 20, volume: 0, sourceAudio: false, trimStartSeconds: 0, fadeInSeconds: 0.1, fadeOutSeconds: 0.2 } },
    { id: "sound", assetId: "fixture-sound", assetVersion: 1, name: "sound accent", filePath: sound, kind: "audio", role: "sound", enabled: true,
      startSeconds: 0.5, durationSeconds: 0.25, x: 0, y: 0, scale: 1, blend: "normal", defaults: { blend: "normal", opacity: 100, volume: 35, sourceAudio: false, trimStartSeconds: 0, fadeInSeconds: 0.02, fadeOutSeconds: 0.05 } }] : [];
}
project.settings.assembly.quality = "preview";
project.scenes[1]!.documentary!.illustrative = true;
project.scenes[1]!.documentary!.caption.enabled = false;
project.scenes[2]!.documentary!.layout = "compare";
project.scenes[2]!.documentary!.comparison = { sceneId: project.scenes[1]!.id, leftLabel: "VIDEO", rightLabel: "DOCUMENT" };
project.scenes[2]!.trimEndSeconds = 1;
if (hybrid) {
  // Plain moving footage followed by a real Remotion comparison. Global SFX,
  // voices and the freeze tail must survive the mixed render path unchanged.
  project.scenes[0]!.videoPath = video;
  project.scenes[0]!.documentary!.selected = { ...project.scenes[0]!.documentary!.selected!, width: 640, height: 360, durationSeconds: 3 };
  project.scenes[0]!.documentary!.caption.enabled = false;
  project.scenes[0]!.documentary!.effects = project.scenes[0]!.documentary!.effects.filter(e=>e.kind==="audio");
  project.scenes[0]!.transition = "none";
}
const storage = new LocalProjectStorage(join(root, "projects"));
await storage.ensureProject(project);
project.scenes = await prepareDocumentaryTiming(project, storage);
if(editing){
  const a=project.scenes[0]!,b=project.scenes[1]!,c=project.scenes[2]!;
  a.documentary!.template="chapter-breathe";a.documentary!.caption.text="THE NEXT CHAPTER";a.documentary!.caption.fontSize=100;
  a.documentary!.templateMotion={amountPercent:24,curve:"dramatic"};
  c.documentary!.selected={...c.documentary!.selected!,width:640,height:360,durationSeconds:3};
  b.documentary!.cuts=[{id:"part-video",fromFrame:0,durationInFrames:30,sourceSceneId:c.id,trimStartSeconds:.5,playbackRate:1},
    {id:"part-photo",fromFrame:30,durationInFrames:b.documentary!.timing!.durationInFrames-30,trimStartSeconds:0,playbackRate:1}];
  a.documentary!.texts=[{id:"cross-scene-title",text:"INDEPENDENT TEXT",enabled:true,startSeconds:1.7,durationSeconds:2.5,x:50,y:75,fontSize:80,color:"#ffffff",backgroundColor:"#101318",backgroundOpacity:65,opacity:100,animation:"zoom",fadeInSeconds:.3,fadeOutSeconds:.3}];
  const longSound=join(root,"long-sound.wav");await runFfmpeg(["-y","-f","lavfi","-i","sine=frequency=2200:duration=1.5",longSound]);
  a.documentary!.effects.push({...a.documentary!.effects.find(e=>e.kind==="audio")!,id:"whole-tail",filePath:longSound,startSeconds:1.7,durationSeconds:1.5});
}
await storage.ensureProject(project);
const expected = buildDocumentaryTimeline(project).durationInFrames / 30;
const renderer = new StandardRenderer(storage, new RemotionMontageRenderer(id => storage.projectDirectory(id)));
let last = -1;
const output = await renderer.render(project, (stage, percent) => { if (Math.floor(percent / 10) !== last) { last = Math.floor(percent / 10); console.log(stage); } });
if(hybrid||editing){
  const events: string[]=[];const started=Date.now();
  await renderer.render(project,stage=>events.push(stage));
  assert.ok(events.some(stage=>stage.includes("без повторного рендера")),"Unchanged complex visual chunks must be reused after a restart/retry");
  assert.ok(events.some(stage=>stage.includes("готовый звуковой микс")),"Warm assembly must reuse unchanged audio, too");
  assert.ok(!events.some(stage=>stage.includes("новые фрагменты")||stage.includes("графика и анимация")),"Warm cache must avoid excerpt extraction and Chromium rendering");
  console.log(`Warm visual cache: ${((Date.now()-started)/1000).toFixed(1)}s`);
}
assert.ok(Math.abs(await mediaDurationSeconds(output) - expected) <= 1 / 30 + 0.02);
assert.equal(renderer.lastRenderReport(project.id)?.engine, "remotion");
const timeline = JSON.parse(await readFile(join(storage.projectDirectory(project.id), "Documentary", "timeline.json"), "utf8"));
assert.equal(timeline.version, 2); assert.equal(timeline.scenes.length, 3);
assert.equal(timeline.illustrationLabel, "Illustrative footage");
assert.equal(timeline.scenes[1].documentary.illustrative, true);
assert.equal(timeline.scenes[1].documentary.caption.enabled, false);
assert.equal(timeline.scenes[2].documentary.comparison.illustrative, true);
assert.equal(buildDocumentaryTimeline({ ...project, language: "Русский" }).illustrationLabel, "Иллюстративные кадры");
assert.ok(timeline.scenes.every((scene: { documentary: { timing: { audioPath: string } } }) => scene.documentary.timing.audioPath));
await copyFile(output, join(root, "Final.mp4"));
const pcmPath = join(root, "audio-check.f32");
await runFfmpeg(["-y", "-i", output, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", pcmPath]);
const pcm = await readFile(pcmPath);
const samples = Array.from({ length: pcm.length / 4 }, (_, i) => pcm.readFloatLE(i * 4));
function toneAt(seconds: number, frequency: number) {
  const start = Math.round(seconds * 48000), count = 2400;
  let real = 0, imaginary = 0;
  for (let i = 0; i < count; i++) {
    const phase = 2 * Math.PI * frequency * i / 48000;
    real += samples[start + i]! * Math.cos(phase); imaginary += samples[start + i]! * Math.sin(phase);
  }
  return Math.hypot(real, imaginary) * 2 / count;
}
assert.ok(samples.every(sample => Number.isFinite(sample) && Math.abs(sample) < .999), "Decoded mix must not clip");
for (const [index, at] of [.25, 2.45, 4.65].entries()) {
  const frequency = continuous ? [440, 660, 880][index]! : 440;
  assert.ok(toneAt(at, frequency) > .01, `Narration fixture must be audible in scene at ${at}s`);
  if (continuous && index > 0) assert.ok(toneAt(at, 440) < .001, "Each scene must play its range, not restart the whole track");
}
assert.ok(toneAt(.6, 1400) > Math.max(toneAt(.3, 1400), toneAt(1, 1400)) * 5, "SFX must occur at its selected time, not throughout narration");
if(editing)assert.ok(toneAt(2.6,2200)>.002&&toneAt(3.5,2200)<.001,"An effect tail must survive the visual scene boundary, then stop at its own end");
assert.ok(toneAt(continuous ? 6.1 : 6.5, continuous ? 880 : 440) < .001, "Final voice fixture finishes before the measured tail; no repeated narration");
await writeFile(join(root, "audio-check.json"), JSON.stringify({ durationSeconds: samples.length / 48000, peak: samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0), narrationWindows: [.25, 2.45, 4.65], sfxAtSeconds: .6, tailSilent: true, evidence: "Decoded synthetic tones verify audio timing/mixing, not live Lumean or speech quality." }, null, 2));
await runFfmpeg(["-y", "-ss", "1", "-i", output, "-frames:v", "1", join(root, "frame-01.png")]);
await runFfmpeg(["-y", "-ss", "3.2", "-i", output, "-frames:v", "1", join(root, "frame-02.png")]);
await runFfmpeg(["-y", "-ss", "6", "-i", output, "-frames:v", "1", join(root, "frame-03.png")]);
console.log(`PASS: Documentary v2 real local-media render, shared frame/audio timeline, caption, screen overlay, SFX, transitions. Duration ${expected.toFixed(3)} s. ${join(root, "Final.mp4")}`);
