import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { sceneImageReferences, sceneStoryCharacters, imageMotionFrame, resolveImageMotionPlan, type Project, type StoryCharacter } from "@gold-work/shared";
import { StoryCharacterService } from "./story-character-service.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { buildImagePrompt } from "./mock-generation-pipeline.js";
import { runFfmpeg } from "./standard-renderer.js";

test("six motion steps repeat and all crop coordinates stay within image bounds", async () => {
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const project = await service.create({ title: "Motion", topic: "Test", language: "Русский", aspectRatio: "16:9", mode: "pro" }, true);
  project.settings.assembly.kenBurns = true;
  project.settings.assembly.kenBurnsDirection = "cycle";
  const directions = [];
  for (let order = 0; order < 12; order++) {
    const plan = resolveImageMotionPlan(project, { ...project.scenes[0]!, order, kenBurnsDirection: "auto" });
    directions.push(plan.direction);
    for (const progress of [0, 0.25, 0.5, 1]) {
      const frame = imageMotionFrame(plan, progress), room = 1 - 1 / frame.zoom;
      assert.ok(frame.cropX >= 0 && frame.cropX <= room + 1e-9);
      assert.ok(frame.cropY >= 0 && frame.cropY <= room + 1e-9);
    }
    if (order === 2) assert.ok(imageMotionFrame(plan, 1).translateYPercent < imageMotionFrame(plan, 0).translateYPercent);
    if (order === 3) assert.ok(imageMotionFrame(plan, 1).translateYPercent > imageMotionFrame(plan, 0).translateYPercent);
  }
  assert.deepEqual(directions.slice(0, 6), ["in", "out", "pan-up", "pan-down", "pan-left", "pan-right"]);
  assert.deepEqual(directions.slice(0, 6), directions.slice(6));
});

test("six project-local portraits, scene-only references, durable retry and explicit replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gws-cast-test-"));
  try {
    const fixture = join(directory, "portrait.png");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64", "-frames:v", "1", fixture]);
    const bytes = await readFile(fixture);
    const repository = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
    let project = await repository.create({ title: "Cast", topic: "Test", language: "Русский", aspectRatio: "16:9", mode: "pro" }, true);
    project = await repository.update(project.id, { mediaMode: "ai", scenes: project.scenes.slice(0, 3) });
    const originalNarration = project.scenes.map(scene => scene.narration);
    const storage = new LocalProjectStorage(directory);
    let descriptions = 0, portraits = 0, failSecond = true;
    const writer = {
      describeStoryCharacters: async () => { descriptions++; return Array.from({ length: 6 }, (_, i) => ({
        name: "Actor " + i, aliases: ["A" + i], prompt: "Unique face " + i,
        sceneNumbers: i === 0 ? [1, 2] : [1],
      })); },
      generateStoryCharacterPortrait: async () => {
        portraits++;
        if (portraits === 2 && failSecond) throw new Error("uncertain paid portrait — do not replay");
        return bytes;
      },
    };
    const service = new StoryCharacterService(repository, writer, storage, async () => bytes);
    project = await service.prepare(project.id);
    assert.equal(portraits, 2);
    assert.equal(project.storyCharacters?.[0]?.status, "ready");
    assert.equal(project.storyCharacters?.[1]?.status, "failed");
    assert.deepEqual(project.scenes.map(scene => scene.narration), originalNarration);
    const firstPath = project.storyCharacters![0]!.imagePath;
    project = await new StoryCharacterService(repository, writer, storage, async () => bytes).prepare(project.id);
    assert.equal(descriptions, 1, "The saved cast plan is reused after service restart");
    assert.equal(portraits, 6, "Only the remaining draft characters are generated, not the failed paid attempt");
    assert.equal(project.storyCharacters![0]!.imagePath, firstPath);
    assert.throws(() => sceneImageReferences(project, project.scenes[0]!), /Actor 1/);
    failSecond = false;
    project = await service.regenerate(project.id, project.storyCharacters![1]!.id, "Updated second face");
    assert.ok(project.storyCharacterSheet?.imagePath);
    assert.ok((await stat(project.storyCharacterSheet!.imagePath)).size > 100);
    assert.deepEqual(sceneImageReferences(project, project.scenes[0]!), [project.storyCharacterSheet!.imagePath]);
    assert.deepEqual(sceneImageReferences(project, project.scenes[1]!), [firstPath]);
    assert.deepEqual(sceneImageReferences(project, project.scenes[2]!), []);
    const prompt = buildImagePrompt(project, project.scenes[1]!);
    assert.match(prompt, /Unique face 0/); assert.doesNotMatch(prompt, /Unique face 2/);
    const emptyShot = buildImagePrompt(project, project.scenes[2]!);
    assert.doesNotMatch(emptyShot, /Unique face/);
    project = await service.regenerate(project.id, project.storyCharacters![0]!.id, "Round glasses and a green coat");
    assert.equal(project.storyCharacters![0]!.imagePath, firstPath, "A candidate never replaces the confirmed face silently");
    assert.ok(project.storyCharacters![0]!.candidate);
    project = await service.confirm(project.id, project.storyCharacters![0]!.id);
    assert.notEqual(project.storyCharacters![0]!.imagePath, firstPath);
    assert.equal(project.storyCharacters![0]!.candidate, undefined);
    assert.ok((await stat(firstPath!)).size, "Old portraits remain recoverable");
    const another = await repository.create({ title: "Other", topic: "Test", language: "Русский", aspectRatio: "16:9", mode: "pro" }, true);
    assert.equal(another.storyCharacters, undefined, "Cast cannot leak into a different project");
    await assert.rejects(() => service.regenerate(another.id, project.storyCharacters![0]!.id, "wrong project"));
    const copy = await repository.duplicate(project.id);
    assert.ok(copy.storyCharacters!.every(character => !character.imagePath), "Duplicating does not depend on the source project's local portrait files");
    const remoteJob = { provider: "flow", kind: "image", accountId: "qa", projectId: "remote-project", mediaName: "known-image", modelKey: "qa", submittedAt: "qa" } as const;
    let submissions = 0;
    const jobWriter = { ...writer, generateStoryCharacterPortrait: async (prompt: string, _style: string, generate?: (prompt: string) => Promise<Buffer>) => generate!(prompt) };
    const interrupted = new StoryCharacterService(repository, jobWriter, storage, async (_project, _prompt, recovery) => {
      submissions++; await recovery.onRemoteJob(remoteJob); throw new Error("Download interrupted");
    });
    project = await interrupted.regenerate(project.id, project.storyCharacters![0]!.id, "Blue shirt");
    assert.deepEqual(project.storyCharacters![0]!.pendingGeneration?.remoteJob, remoteJob);
    const resumed = new StoryCharacterService(repository, jobWriter, storage, async (_project, _prompt, recovery) => {
      assert.deepEqual(recovery.resumeJob, remoteJob, "Resume downloads the same known paid image"); return bytes;
    });
    await assert.rejects(() => resumed.regenerate(project.id, project.storyCharacters![0]!.id, "Different face"), /Сначала получите/);
    project = await resumed.regenerate(project.id, project.storyCharacters![0]!.id, "Blue shirt");
    assert.equal(submissions, 1);
    assert.equal(project.storyCharacters![0]!.pendingGeneration, undefined);
    assert.equal((project.storyCharacters![0] as StoryCharacter).candidate?.prompt, "Blue shirt");
    await repository.update(project.id, { status: "generating" });
    await assert.rejects(() => service.confirm(project.id, project.storyCharacters![0]!.id), /производство/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy alias matching never treats sample as Sam and explicit empty cast stays empty", async () => {
  const character = { id: "sam", name: "Sam", aliases: [], prompt: "round head", stylePrompt: "2D", imagePath: "sam.png", status: "ready" } satisfies StoryCharacter;
  const project = await new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider()).create({ title: "Aliases", topic: "Test", language: "Русский", aspectRatio: "16:9", mode: "pro" }, true);
  project.storyCharacters = [character];
  assert.deepEqual(sceneStoryCharacters(project, { ...project.scenes[0]!, imagePrompt: "A sample on the desk" }), []);
  assert.equal(sceneStoryCharacters(project, { ...project.scenes[0]!, imagePrompt: "Sam at the desk" }).length, 1);
  assert.deepEqual(sceneStoryCharacters(project, { ...project.scenes[0]!, imagePrompt: "Sam at the desk", characterIds: [] }), []);
});
