import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDefaultProjectSettings, type Project } from "@gold-work/shared";
import { FileProjectRepository } from "./file-project-repository.js";
import { LocalProjectStorage } from "./local-project-storage.js";

function fixtureProject(id: string): Project {
  const now = "2026-09-07T10:00:00.000Z";
  return {
    id,
    title: "Удаляемый ролик",
    topic: "Проверка корзины",
    aspectRatio: "16:9",
    language: "Русский",
    mode: "standard",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    scenes: [],
    settings: createDefaultProjectSettings(),
    channelProfileId: "channel-1",
    mediaMode: "ai"
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("project record and local files can be moved to trash, restored and purged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gws-project-trash-"));
  try {
    const repository = new FileProjectRepository(join(directory, "projects.json"));
    const storage = new LocalProjectStorage(join(directory, "workspace", "projects"));
    const project = fixtureProject("project-trash-test");
    await repository.save(project);
    await storage.ensureProject(project);

    const deleted = await repository.moveToTrash(project.id);
    assert.equal(await storage.moveProjectToTrash(project.id, deleted.trashId), true);
    assert.equal((await repository.list()).length, 0);
    assert.equal(await exists(storage.projectDirectory(project.id)), false);
    assert.equal(await exists(storage.trashedProjectDirectory(deleted.trashId)), true);

    assert.equal(await storage.restoreProjectFromTrash(project.id, deleted.trashId), true);
    await repository.restore(deleted.trashId);
    assert.equal((await repository.list())[0]?.id, project.id);
    assert.equal(await exists(storage.projectDirectory(project.id)), true);

    const deletedAgain = await repository.moveToTrash(project.id);
    await storage.moveProjectToTrash(project.id, deletedAgain.trashId);
    await storage.purgeTrashedProject(deletedAgain.trashId);
    await repository.purge(deletedAgain.trashId);
    assert.equal(await exists(storage.trashedProjectDirectory(deletedAgain.trashId)), false);
    assert.equal((await repository.listTrash()).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
