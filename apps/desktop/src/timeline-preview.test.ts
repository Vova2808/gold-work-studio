import assert from "node:assert/strict";
import test from "node:test";
import {createDefaultProjectSettings, type Project, type Scene} from "@gold-work/shared";
import {preparePreviewFrames, remapPreviewTime, type PreviewClip} from "../../renderer/src/timeline-preview.js";
import {mergeScenarioDraft, restoreDocumentaryEdit} from "../../renderer/src/scenario-draft-merge.js";
import {prepareDocumentaryScript} from "./documentary-plan.js";
import {createDocumentarySettings, createVoiceCalibration} from "@gold-work/shared";
import {buildDocumentaryTimeline} from "@gold-work/remotion-video";
import {documentaryEditErrors} from "./documentary-validation.js";

const scenes: Scene[] = [0,1,2].map(order => ({id:String(order),order,title:`Frame ${order}`,narration:"Exact text",imagePrompt:"Landscape",animationPrompt:"Push in",durationSeconds:5,status:"ready",kenBurnsDirection:"in"}));
const project = {id:"preview-test",mediaMode:"ai",scenes,settings:createDefaultProjectSettings()} as Project;
function layout(transition: PreviewClip["transition"] = "mix"): PreviewClip[] {
  return scenes.map((scene,index)=>({scene,index,start:index*5,end:(index+1)*5+(index<2?0.4:0),duration:5+(index<2?0.4:0),overlapToNext:index<2?0.4:0,transition}));
}
test("preview paints motion between React updates and dissolves without a black brightness dip", () => {
  const paint=preparePreviewFrames(project,layout());
  assert.notEqual(paint(1).layers[0]!.transform,paint(1+1/60).layers[0]!.transform);
  const frame=paint(5.2);
  assert.equal(frame.layers.length,2);
  assert.equal(frame.layers[0]!.opacity,1);
  assert.ok(Math.abs(frame.layers[1]!.opacity-.5)<1e-8);
  assert.equal(frame.fade,0);
});
test("dip-to-black and instant cut remain distinct in preview", () => {
  const dip=preparePreviewFrames(project,layout("fade"));
  assert.ok(dip(5.2).fade>.9999);
  assert.ok(dip(5.01).fade<.06);
  assert.ok(dip(5.39).fade<.06);
  const cut=preparePreviewFrames(project,layout("none"))(5.2);
  assert.deepEqual(cut.layers.map(layer=>layer.opacity),[0,1]);
  assert.equal(cut.fade,0);
});
test("new TTS duration keeps paused cursor on same scene and limits shortened offsets", () => {
  const before=layout();const after=layout().map((clip,index)=>({...clip,start:clip.start+(index?2:0),end:clip.end+2,duration:clip.duration+(index?0:2)}));
  assert.equal(remapPreviewTime(before,after,8),10);
  assert.equal(remapPreviewTime(before,[],8),0);
  const shorter=after.map(clip=>({...clip,duration:1}));
  assert.equal(remapPreviewTime(before,shorter,9),8);
});
test("background media updates preserve right-panel edits and local reorder without discarding assets", () => {
  const local=structuredClone(scenes);local[1] = {...local[1]!,narrationVolume:64,playbackRate:1.25,trimStartSeconds:1,kenBurnsZoom:1.08};
  const incoming=structuredClone(scenes);incoming[1]!.audioPath="new.wav";incoming[1]!.imagePath="new.png";
  const merged=mergeScenarioDraft([local[1]!,local[0]!,local[2]!],scenes,incoming);
  assert.deepEqual(merged.map(scene=>scene.id),["1","0","2"]);
  assert.equal(merged[0]!.audioPath,"new.wav");assert.equal(merged[0]!.imagePath,"new.png");
  assert.equal(merged[0]!.narrationVolume,64);assert.equal(merged[0]!.playbackRate,1.25);assert.equal(merged[0]!.trimStartSeconds,1);assert.equal(merged[0]!.kenBurnsZoom,1.08);
  assert.equal(merged[0]!.narration,"Exact text");
});

test("Stock composition edits and undo preserve fresh material/voice checkpoints, and video trims cannot shorten narration", () => {
  const stock = structuredClone(project); stock.mediaMode = "stock";
  stock.settings.assembly.documentary = createDocumentarySettings();
  stock.videoBrief = { creationMode: "script", readyScript: "SS United States crossed the Atlantic. Icon of the Seas is a cruise ship." } as Project["videoBrief"];
  const calibration = createVoiceCalibration({ provider: "elevenlabs", voice: "fixture", language: "en", sampleText: "A clear measured voice reads this whole sentence.", audioDurationSeconds: 5 });
  stock.scenes = prepareDocumentaryScript(stock, calibration);
  const old = structuredClone(stock.scenes), edited = structuredClone(old), incoming = structuredClone(old);
  edited[0]!.documentary!.caption = { ...edited[0]!.documentary!.caption, enabled: true, text: "1952" };
  incoming[0]!.audioPath = "new.wav"; incoming[0]!.videoPath = "new.mp4";
  incoming[0]!.documentary!.verified = true;
  incoming[0]!.documentary!.timing = { sourceKey: "new", audioPath: "measured.wav", durationInFrames: 173, speechSeconds: 5.7 };
  const merged = mergeScenarioDraft(edited, old, incoming);
  assert.equal(merged[0]!.documentary!.caption.text, "1952");
  assert.equal(merged[0]!.documentary!.verified, true);
  assert.equal(merged[0]!.documentary!.timing?.sourceKey, "new");
  const undone = restoreDocumentaryEdit(old, merged);
  assert.equal(undone[0]!.documentary!.caption.enabled, false);
  assert.equal(undone[0]!.videoPath, "new.mp4");
  assert.equal(undone[0]!.audioPath, "new.wav");
  assert.equal(undone[0]!.documentary!.timing?.sourceKey, "new");
  stock.scenes = merged; stock.scenes[0]!.trimEndSeconds = 1;
  const timeline = buildDocumentaryTimeline(stock, path => `local:${path}`);
  assert.equal(timeline.scenes[0]!.durationInFrames, 173);
  assert.equal(timeline.scenes[0]!.documentary!.timing!.audioPath, "local:measured.wav");
  stock.scenes[0]!.documentary!.layout = "compare";
  assert.ok(documentaryEditErrors(stock).some(error => error.includes("сравнения")));
});
