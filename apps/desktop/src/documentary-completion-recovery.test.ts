import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryProjectRepository, MemoryTaskRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createDocumentarySettings, type Scene, type QueueTask } from "@gold-work/shared";
import { LocalProjectStorage } from "./local-project-storage.js";
import { StandardRenderer } from "./standard-renderer.js";
import { MockGenerationPipeline } from "./mock-generation-pipeline.js";

test("restart does not resurrect an invalidated Stock Final, but reconciles a newly finished render", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-completion-recovery-")); t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new MemoryProjectRepository(), projects = new ProjectService(repository, new MockDirectorProvider());
  const project = await projects.create({ title: "Recovery", topic: "Locks", aspectRatio: "16:9", language: "English", mode: "standard", mediaMode: "stock" });
  project.settings.assembly.documentary = createDocumentarySettings();
  const output = join(root, "Final.mp4");
  project.scenes = [{ id: "one", order: 0, narration: "A lock", audioPath: "saved-voice.wav", documentary: { verified: false } }] as Scene[];
  project.status = "ready"; project.outputPath = undefined; project.updatedAt = "2026-09-27T01:00:00Z";
  const task: QueueTask = { id: "assembly", runId: "run", projectId: project.id, kind: "assemble", label: "Final", status: "done", progress: 100, attempts: 1, maxAttempts: 1, dependsOn: [], createdAt: "2026-09-26T23:00:00Z", updatedAt: "2026-09-27T00:00:00Z", resultPath: output };
  const tasks = new MemoryTaskRepository(), storage = new LocalProjectStorage(root);
  const restore = async () => {
    await repository.save(project); await tasks.replace([task]);
    await new MockGenerationPipeline(tasks, projects, storage, new StandardRenderer(storage)).list();
    return (await projects.get(project.id))!;
  };
  let result = await restore();
  assert.equal(result.status, "ready"); assert.equal(result.outputPath, undefined); assert.equal(result.scenes[0]!.audioPath, "saved-voice.wav");
  project.scenes[0]!.documentary!.verified = true;
  result = await restore();
  assert.equal(result.outputPath, undefined, "Even verified replacement media does not make the old render current");
  task.updatedAt = "2026-09-27T02:00:00Z";
  result = await restore();
  assert.equal(result.status, "complete"); assert.equal(result.outputPath, output, "Recover the newer queue completion after a project-save interruption");
});
