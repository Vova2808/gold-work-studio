import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChannelCharacterReference, SaveChannelProfileInput } from "@gold-work/shared";
import { ChannelProfileStore } from "./channel-profile-store.js";

const baseInput: SaveChannelProfileInput = {
  name: "AI истории",
  countryCode: "RU",
  languageCode: "ru",
  languageLabel: "Русский",
  masterPrompt: "Рассказывай цельные истории.",
  defaultDurationMinutes: 10,
  direction: "ai-story",
  defaultMediaMode: "ai",
  motionTemplate: "Без шаблона"
};

test("channel master prompt is optional and can be added or removed later", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gws-optional-master-"));
  try {
    const path = join(directory, "channels.json");
    const store = new ChannelProfileStore(path);
    const channel = await store.create({ ...baseInput, masterPrompt: "   " });
    assert.equal(channel.masterPrompt, "");
    await store.update(channel.id, { ...baseInput, masterPrompt: "Visual rules only" });
    assert.equal((await new ChannelProfileStore(path).get(channel.id))?.masterPrompt, "Visual rules only");
    await store.update(channel.id, { ...baseInput, masterPrompt: "" });
    assert.equal((await store.get(channel.id))?.masterPrompt, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("channel direction is immutable and generated hero versions are promoted explicitly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gws-channel-store-"));
  try {
    const store = new ChannelProfileStore(join(directory, "channels.json"));
    const channel = await store.create(baseInput);
    assert.equal(channel.direction, "ai-story");
    assert.equal(channel.defaultMediaMode, "ai");

    await assert.rejects(
      store.update(channel.id, { ...baseInput, direction: "stock-documentary", defaultMediaMode: "stock" }),
      /нельзя изменить/
    );

    const first: ChannelCharacterReference = {
      versionId: "hero-v1",
      channelProfileId: channel.id,
      sourceProjectId: "project-1",
      name: "Максим",
      prompt: "Герой в серой рубашке",
      imagePath: join(directory, "hero-v1.png"),
      createdAt: "2026-09-07T10:00:00.000Z",
      updatedAt: "2026-09-07T10:00:00.000Z"
    };
    const second = { ...first, versionId: "hero-v2", imagePath: join(directory, "hero-v2.png"), createdAt: "2026-09-07T11:00:00.000Z", updatedAt: "2026-09-07T11:00:00.000Z" };
    await store.addCharacterVersion(channel.id, first);
    await store.confirmCharacterVersion(channel.id, first.versionId);
    await store.addCharacterVersion(channel.id, second);

    const beforeConfirmation = await store.get(channel.id);
    assert.equal(beforeConfirmation?.primaryCharacter?.versionId, "hero-v1", "regeneration must not replace the confirmed hero");
    assert.deepEqual(beforeConfirmation?.characterVersions.map((item) => item.versionId), ["hero-v2", "hero-v1"]);

    await store.confirmCharacterVersion(channel.id, second.versionId);
    assert.equal((await store.get(channel.id))?.primaryCharacter?.versionId, "hero-v2");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("channel deletion is recoverable and legacy mixed profiles migrate to stock documentary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gws-channel-trash-"));
  try {
    const filePath = join(directory, "channels.json");
    const store = new ChannelProfileStore(filePath);
    const channel = await store.create(baseInput);
    const deleted = await store.moveToTrash(channel.id);
    assert.equal((await store.list()).length, 0);
    assert.equal((await store.listTrash())[0]?.profile.id, channel.id);
    assert.equal((await store.restore(deleted.trashId)).id, channel.id);

    const stored = JSON.parse(await readFile(filePath, "utf8")) as unknown[];
    await writeFile(filePath, JSON.stringify([{ ...(stored[0] as object), direction: undefined, defaultMediaMode: "mixed" }]), "utf8");
    const migrated = (await store.list())[0];
    assert.equal(migrated?.direction, "stock-documentary");
    assert.equal(migrated?.defaultMediaMode, "stock");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("channel image style persists across a fresh store and never leaks to another channel", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gws-channel-style-"));
  try {
    const path = join(directory, "channels.json");
    const store = new ChannelProfileStore(path);
    const input = { ...baseInput, defaultImageStyle: "  Watercolor ink illustration, flat 2D  " };
    const first = await store.create(input);
    const second = await store.create({ ...baseInput, name: "Другой канал" });
    const reloaded = new ChannelProfileStore(path);
    assert.equal((await reloaded.get(first.id))?.defaultImageStyle,
      "Watercolor ink illustration, flat 2D");
    assert.equal((await reloaded.get(second.id))?.defaultImageStyle, undefined);
    await reloaded.update(first.id, { ...baseInput, name: "Переименован" });
    assert.equal((await store.get(first.id))?.defaultImageStyle, "Watercolor ink illustration, flat 2D", "old callers must not erase style");
    await reloaded.update(first.id, { ...baseInput, defaultImageStyle: "" });
    assert.equal((await store.get(first.id))?.defaultImageStyle, undefined, "explicit clearing is supported");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
