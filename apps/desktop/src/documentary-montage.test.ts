import test from "node:test";
import assert from "node:assert/strict";
import type { Project } from "@gold-work/shared";
import { planDocumentaryMontage } from "./documentary-montage.js";

test('CRT is distributed through ordinary modern footage instead of waiting for an archive keyword',()=>{
  const p={settings:{stockVideoPercent:35,assembly:{documentary:{autoMotionGraphics:true,montageDensity:'rich',captionsEnabled:false}}},scenes:Array.from({length:45},(_,order)=>({
    id:`s${order}`,order,narration:'A vehicle travels on the road.',audioPath:`paid${order}.wav`,videoPath:`source${order}.mp4`,durationSeconds:4,
    documentary:{verified:true,pinned:false,layout:'full',effects:[],caption:{enabled:false,text:''},selected:{kind:'video',title:'Modern vehicle'},requirement:{text:'Vehicle',years:[],entities:[],queries:[],identities:[]}}
  }))} as unknown as Project;
  const result=planDocumentaryMontage(p),screens=result.filter(s=>['broadcast-crt','broadcast-scanlines'].includes(s.documentary?.template??''));
  assert.ok(screens.filter(s=>s.documentary?.template==='broadcast-scanlines').length>screens.length/2);
  assert.ok(screens.length>=6&&screens.length<=9);
  for(const third of [0,1,2])assert.ok(screens.some(s=>Math.floor(s.order/15)===third));
  assert.deepEqual(result.map(s=>[s.narration,s.audioPath,s.videoPath,s.durationSeconds]),p.scenes.map(s=>[s.narration,s.audioPath,s.videoPath,s.durationSeconds]));
  assert.deepEqual(planDocumentaryMontage({...p,scenes:result}),result);
  const excluded=planDocumentaryMontage({...p,settings:{...p.settings,assembly:{...p.settings.assembly,documentary:{...p.settings.assembly.documentary!,excludedTemplates:['broadcast-crt','broadcast-scanlines']}}}});
  assert.ok(excluded.every(s=>!s.documentary?.template?.startsWith('broadcast-')));
});

test("automatic chapter designs are sparse, varied, and preserve voice, pins and authored templates", () => {
  const project = { settings: { assembly: { documentary: { captionsEnabled: true } } }, scenes: Array.from({ length: 12 }, (_, order) => ({
    id: `scene-${order}`, order, narration: `Exact narration ${order}`, audioPath: `voice-${order}.wav`, durationSeconds: 5,
    documentary: { verified: true, pinned: order === 10, layout: "full", requirement: { sectionTitle: `Section ${order}` },
      selected: { kind: "video" }, effects: [], caption: { enabled: false, text: "" }, ...(order === 11 ? { template: "archive" } : {}) }
  })) } as unknown as Project;
  const result = planDocumentaryMontage(project);
  assert.deepEqual(result.filter(scene => scene.documentary?.template?.startsWith("chapter")).map(scene => scene.order), [0, 7]);
  assert.notEqual(result[0]!.documentary!.template, result[7]!.documentary!.template);
  assert.equal(result[10], project.scenes[10]); assert.equal(result[11], project.scenes[11]);
  assert.deepEqual(result.map(scene => [scene.narration, scene.audioPath, scene.durationSeconds]), project.scenes.map(scene => [scene.narration, scene.audioPath, scene.durationSeconds]));
  assert.deepEqual(planDocumentaryMontage({ ...project, scenes: result }), result, "Resuming must not redesign finished scenes");
});
