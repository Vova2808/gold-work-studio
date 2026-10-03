import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {createHash} from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import ffmpeg from "ffmpeg-static";
import { resolveProjectSceneTransition, resolveProjectSceneTransitionDuration, type Project, type Scene } from "@gold-work/shared";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { StandardRenderer, mediaDurationSeconds, shouldUseAiVideo } from "../src/standard-renderer.js";
import { applyMeasuredStoryTiming, measuredStoryTimingExpansion } from "../src/measured-story-timing.js";

// Read existing real assets; never update the source project or call a provider.
const input = process.env.GW_PROJECT_JSON;
if (!input) throw new Error("Set GW_PROJECT_JSON to an existing AI Story project.json");
const raw: Project = JSON.parse(await readFile(input, "utf8"));
const originalBytes=await readFile(input);
const withVideo=process.argv.includes("--include-existing-video");
assert.equal(raw.mediaMode, "ai", "Only AI Story is in scope");
const limit = Number(process.env.GW_SMOKE_SCENES) || raw.scenes.length;
const scenes = raw.scenes.filter(scene => scene.includeInAssembly !== false).sort((a, b) => a.order - b.order).slice(0, limit);
const root = resolve("captures", "ai-story-render", String(Date.now()));
const project: Project = structuredClone({ ...raw, id: `ai-story-qa-${Date.now()}`, outputPath: undefined,
  scenes: scenes.map((scene, order) => ({ ...scene, order })), settings: { ...raw.settings,
    video: { ...raw.settings.video, enabled: withVideo }, music: { ...raw.settings.music, enabled: false },
    assembly: { ...raw.settings.assembly, quality: "preview", montage: { ...raw.settings.assembly.montage, enabled: false } },
  } });
const storage = new LocalProjectStorage(root);
const renderer = new StandardRenderer(storage);
const selectedVideoPaths=project.scenes.filter(scene=>shouldUseAiVideo(project,scene)).map(scene=>scene.videoPath!);
if(withVideo) assert.ok(selectedVideoPaths.length>0,"An existing generated video must actually be selected for assembly");
const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const sourceVideoHashes=await Promise.all(selectedVideoPaths.map(async path=>({path,hash:sha(await readFile(path))})));
const normalizedVideoPaths:string[]=[];
const traced=renderer as unknown as {normalizeVideoClip:(...args:unknown[])=>Promise<string>};
const normalizeVideoClip=traced.normalizeVideoClip.bind(renderer);
traced.normalizeVideoClip=async(...args)=>{
  normalizedVideoPaths.push((args[1] as Scene).videoPath!);
  return normalizeVideoClip(...args);
};
let additionalTestImages = 0;
if (process.argv.includes("--split-long")) {
  const originalText = project.scenes.map(scene => scene.narration).join("");
  const expansion = await measuredStoryTimingExpansion(project, storage);
  if (expansion) Object.assign(project, applyMeasuredStoryTiming(project, expansion));
  assert.equal(project.scenes.map(scene => scene.narration).join(""), originalText);
  for (const scene of project.scenes) {
    if (!scene.imagePath) {
      // Diagnostic local image, NOT evidence of provider/visual-quality acceptance.
      scene.imagePath = await storage.createPlaceholderImage(project, scene);
      additionalTestImages++;
    }
  }
}
const timings: Array<{order:number; planned:number; actual:number}> = [];
const inspect = renderer as unknown as { baseTimelineDuration(project: Project, scene: Scene): Promise<number> };
for (const scene of project.scenes) {
  assert.ok(scene.imagePath && (await stat(scene.imagePath)).size, `Missing image for scene ${scene.order+1}`);
  if (project.settings.voice.enabled) assert.ok(scene.audioPath && (await stat(scene.audioPath)).size, `Missing audio for scene ${scene.order+1}`);
  timings.push({ order: scene.order+1, planned: scene.durationSeconds, actual: await inspect.baseTimelineDuration(project, scene) });
}
const expectedSeconds = timings.reduce((sum, timing) => sum + timing.actual, 0);
const targetSeconds = (project.settings.durationMinutes || 0) * 60;
const transitionGraph = project.scenes.slice(0,-1).some(scene=>resolveProjectSceneTransition(project,scene)!=="none");
const visibleTimings = timings.map((timing,index)=>{
  const next = timings[index+1];
  const current = project.scenes[index]!;
  const requested = resolveProjectSceneTransition(project,current)==="none"?0.02:resolveProjectSceneTransitionDuration(project,current);
  const overlap = transitionGraph && next ? Math.max(0.02,Math.min(requested,timing.actual-0.1,next.actual-0.1)):0;
  return {...timing,visibleSeconds:timing.actual+overlap};
});
const report = { sourceProject: raw.id, scenes: project.scenes.length, additionalTestImages, expectedSeconds, targetSeconds,
  includeExistingVideo:withVideo,selectedVideoPaths,normalizedVideoPaths,sourceFilesUnchanged:false,
  deviationPercent: targetSeconds ? (expectedSeconds / targetSeconds - 1) * 100 : null,
  framesOverNineSeconds: visibleTimings.filter(t => t.visibleSeconds > 9.001), render: null as null | {path:string;seconds:number;decodePassed:boolean} };
if (process.argv.includes("--split-long")) assert.equal(report.framesOverNineSeconds.length,0,"Measured visual frames must include their outgoing overlap and stay <=9s");
console.log(JSON.stringify({sourceProject:raw.id, scenes:project.scenes.length, additionalTestImages, expectedSeconds, targetSeconds,
  deviationPercent:report.deviationPercent, framesOverNineSeconds:report.framesOverNineSeconds.length}));
await mkdir(root, {recursive:true});
await writeFile(join(root, "audit.json"), JSON.stringify(report, null, 2));
if (process.argv.includes("--render")) {
  let lastProgress = -1;
  const output = await renderer.render(project, (stage, progress) => {
    if (Math.floor(progress / 5) > lastProgress) {
      lastProgress = Math.floor(progress / 5);
      console.log(`[ai-story-render ${progress}%] ${stage}`);
    }
  });
  const seconds = await mediaDurationSeconds(output);
  assert.ok(Math.abs(seconds - expectedSeconds) < Math.max(1, scenes.length / 30 + 0.1), "Assembly altered narration timing");
  assert.ok(ffmpeg);
  await new Promise<void>((resolveDecode, reject) => {
    const child = spawn(ffmpeg!, ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"], {windowsHide:true});
    let error = "";
    child.stderr.on("data", data => { error = (error + data.toString()).slice(-1500); });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolveDecode() : reject(new Error(`Full decode failed (${code}): ${error}`)));
  });
  report.render = {path:output, seconds, decodePassed:true};
  assert.deepEqual(normalizedVideoPaths,selectedVideoPaths,"The real video-normalization branch must consume every selected AI video");
  assert.equal(sha(await readFile(input)),sha(originalBytes));
  for(const source of sourceVideoHashes) assert.equal(sha(await readFile(source.path)),source.hash,"The generated Veo source must not be overwritten");
  report.sourceFilesUnchanged=true;
  await writeFile(join(root, "audit.json"), JSON.stringify(report, null, 2));
  console.log(`[ai-story-render] RENDER_AND_DECODE_PASS ${output}`);
}
console.log(`[ai-story-render] AUDIT ${join(root, "audit.json")}`);
