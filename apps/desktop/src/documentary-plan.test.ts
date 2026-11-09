import assert from "node:assert/strict";
import test from "node:test";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createVoiceCalibration } from "@gold-work/shared";
import { documentaryEntities, documentaryRequirement, prepareDocumentaryScript } from "./documentary-plan.js";

const calibration = createVoiceCalibration({ provider: "elevenlabs", voice: "test-template", language: "en",
  sampleText: "A measured voice reads the original words at a consistent and natural pace.", audioDurationSeconds: 5, calibratedAt: "2026-09-14T00:00:00Z" });

test("Stock ready script preserves every byte and explicit subjects without AI/Flow or card cycles", async () => {
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const project = await service.create({ title: "SS United States versus Icon of the Seas", topic: "Ships", mode: "standard", mediaMode: "stock", language: "English", aspectRatio: "16:9" });
  const script = "SS United States crossed the Atlantic in 1952.\r\n\r\nHer engines powered four propellers. Icon of the Seas carries modern vacationers.  It has multiple decks and pools.\n";
  project.videoBrief = { creationMode: "script", readyScript: script } as NonNullable<typeof project.videoBrief>;
  const scenes = prepareDocumentaryScript(project, calibration);
  assert.equal(scenes.map(scene => scene.narration).join(""), script);
  assert.ok(scenes.length >= 2, "Phrase pacing may combine short sentences while retaining distinct subject units");
  assert.ok(scenes.every(scene => scene.documentary?.version === 2 && scene.visualBeats?.every(beat => beat.template === "full-media" && beat.overlay === "none")));
  assert.ok(scenes.some(scene => scene.documentary!.requirement.entities.includes("SS United States")));
  assert.ok(scenes.some(scene => scene.documentary!.requirement.entities.includes("Icon of the Seas")));
  assert.ok(scenes.every(scene => scene.sourceVolume === 0 && !scene.documentary!.verified));
  assert.ok(scenes[0]!.documentary!.requirement.queries.every(query => query.includes("SS United States")));
  scenes[0]!.imagePath = "local-image.png";
  scenes[0]!.documentary!.pinned = true;
  scenes[0]!.documentary!.caption.text = "1952";
  project.scenes = scenes;
  assert.deepEqual(prepareDocumentaryScript(project, calibration), scenes);
});

test('documentary segmentation needs no paid calibration and preserves the original script',async()=>{
  const service=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  const project=await service.create({title:'Train',topic:'Train',mode:'standard',mediaMode:'stock',language:'English',aspectRatio:'16:9'});
  const script='A train enters the station.\nPassengers wait on the platform.\n';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:script};
  project.settings.voice.calibration=undefined;
  const scenes=prepareDocumentaryScript(project);
  assert.equal(scenes.map(scene=>scene.narration).join(''),script);
  assert.ok(scenes.length>0);
  assert.equal(project.settings.voice.calibration,undefined,'A provisional pace must not be saved as a measured sample');
});

test("subject/era constraints stay visible, and stock planning rejects AI and old projects", async () => {
  assert.deepEqual(documentaryEntities("SS United States versus Icon of the Seas.").sort(), ["Icon of the Seas", "SS United States"]);
  const requirement = documentaryRequirement("The engine room in 1952.", ["SS United States"], ["SS United States"]);
  assert.deepEqual(requirement.entities, ["SS United States"]);
  assert.deepEqual(requirement.years, ["1952"]);
  assert.match(requirement.queries[0]!, /SS United States engine 1952/);
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const ai = await service.create({ title: "AI", topic: "Test", mode: "pro", mediaMode: "ai", language: "English", aspectRatio: "16:9" });
  assert.throws(() => prepareDocumentaryScript(ai, calibration), /Stock Documentary v2/);
});

test("Cutty Sark search scenes keep sentences that fit, and resume keeps previously submitted scene IDs", async () => {
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const project = await service.create({ title: "Cutty Sark", topic: "Tea clipper", mode: "standard", mediaMode: "stock", language: "English", aspectRatio: "16:9" });
  const script = "But five days earlier, something had happened in Egypt that threatened the entire business she was built for.\n\n"
    + "The Suez Canal had opened.\n\nBefore Cutty Sark began her first voyage, steamships had gained a shortcut she could not practically use. "
    + "How could a sailing ship compete when her rivals could travel thousands of miles less?\n\n"
    + "Yet steam continued to advance. In 1895, Cutty Sark was sold to Portuguese owners and renamed Ferreira.";
  project.videoBrief = { ...project.videoBrief!, creationMode: "script", readyScript: script };
  project.settings.assembly.documentary!.pace = "dynamic";
  for (const charactersPerSecond of [14, 17.078]) {
    const scenes = prepareDocumentaryScript(project, { charactersPerSecond });
    assert.equal(scenes.map(scene => scene.narration).join(""), script);
    for (const sentence of [script.slice(0, script.indexOf(".") + 1), "Before Cutty Sark began her first voyage, steamships had gained a shortcut she could not practically use.",
      "In 1895, Cutty Sark was sold to Portuguese owners and renamed Ferreira."]) {
      assert.ok(scenes.some(scene => scene.narration.includes(sentence)), sentence);
    }
  }
  // The app saved the old boundaries before any response was applied to the project.
  const base = prepareDocumentaryScript(project)[0]!;
  const cut = script.indexOf("business she");
  project.scenes = [script.slice(0, cut), script.slice(cut)].map((narration, order) => ({
    ...base, id: `submitted-${order}`, order, narration, documentary: {
      ...base.documentary!, requirement: { ...base.documentary!.requirement, text: narration }
    }
  }));
  project.referenceAnalysis = { sourceUrl: `script://${project.id}`, sourceTitle: project.title, niche: "Stock Documentary",
    targetAudience: "", hook: script, structure: [], strengths: [], improvements: [], suggestedAngle: "", suggestedTitle: project.title,
    recommendedDurationSeconds: 30, language: project.language, scenes: project.scenes, provider: "local:stock-documentary-v2" };
  assert.deepEqual(prepareDocumentaryScript(project), project.scenes);
});

test("new phrase pacing keeps exact text and never repartitions saved paid short scenes", async () => {
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const project = await service.create({ title: "Phrases", topic: "Canal", mode: "standard", mediaMode: "stock", language: "English", aspectRatio: "16:9" });
  const script = "The vessel enters the chamber and the water slowly rises around its hull. The next gates open when the levels match. ";
  project.videoBrief = { creationMode: "script", readyScript: script } as NonNullable<typeof project.videoBrief>;
  project.settings.assembly.documentary!.pace = "dynamic";
  const planned = prepareDocumentaryScript(project, calibration);
  assert.equal(planned.map(scene=>scene.narration).join(""),script);
  assert.ok(planned.length <= 3, "Whole phrases should not become six separate paid production units");
  const splitAt = script.indexOf("and");
  project.scenes = [script.slice(0,splitAt),script.slice(splitAt)].map((narration,order)=>({ ...structuredClone(planned[0]!),
    id:`saved-${order}`,order,narration,audioPath:`paid-${order}.wav`,durationSeconds:2 }));
  assert.deepEqual(prepareDocumentaryScript(project, calibration), project.scenes);
});
