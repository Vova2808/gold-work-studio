import assert from "node:assert/strict";
import test from "node:test";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "./index.js";

test("mock director creates a ready project with three scenes", async () => {
  const repository = new MemoryProjectRepository();
  const service = new ProjectService(repository, new MockDirectorProvider());
  const project = await service.create(
    {
      title: "Demo",
      topic: "Test topic",
      aspectRatio: "9:16",
      language: "Русский",
      mode: "standard"
    },
    true
  );

  assert.equal(project.status, "ready");
  assert.equal(project.scenes.length, 3);
  assert.deepEqual(await service.list(), [project]);
});

