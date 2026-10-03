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
