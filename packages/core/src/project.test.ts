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

test("project service updates order, duplicates and deletes projects", async () => {
  const repository = new MemoryProjectRepository();
  const service = new ProjectService(repository, new MockDirectorProvider());
  const source = await service.create(
    {
      title: "Проект",
      topic: "Тема",
      aspectRatio: "16:9",
      language: "Русский",
      mode: "standard"
    },
    true
  );
  const [first, second, third] = source.scenes;
  assert.ok(first && second && third);

  const updated = await service.update(source.id, {
    topic: "Новая тема",
    scenes: [
      { ...first, order: 2 },
      { ...second, order: 0 },
      { ...third, order: 1 }
    ]
  });
  assert.equal(updated.topic, "Новая тема");
  assert.deepEqual(updated.scenes.map((scene) => scene.title), [second.title, third.title, first.title]);
  assert.deepEqual(updated.scenes.map((scene) => scene.order), [0, 1, 2]);

  const duplicate = await service.duplicate(source.id);
  assert.notEqual(duplicate.id, source.id);
  assert.equal(duplicate.title, "Проект — копия");
  assert.equal(duplicate.status, "draft");
  assert.notDeepEqual(duplicate.scenes.map((scene) => scene.id), updated.scenes.map((scene) => scene.id));

  await service.delete(source.id);
  assert.equal(await service.get(source.id), undefined);
  assert.equal((await service.list()).length, 1);
});

test("concurrent patches are merged and active generation locks scene structure", async () => {
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const project = await service.create(
    { title: "Параллельный проект", topic: "Старая тема", aspectRatio: "16:9", language: "Русский", mode: "standard" },
    true
  );

  await Promise.all([
    service.update(project.id, { topic: "Новая тема" }),
    service.update(project.id, { language: "English" })
  ]);
  const merged = await service.get(project.id);
  assert.equal(merged?.topic, "Новая тема");
  assert.equal(merged?.language, "English");

  await service.update(project.id, { status: "generating" });
  await assert.rejects(
    service.update(project.id, { scenes: project.scenes.slice(0, 1) }),
    /Нельзя менять состав сцен/
  );
});
