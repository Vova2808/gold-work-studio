import { randomUUID } from "node:crypto";
import { readFile, rename } from "node:fs/promises";
import type { ChannelCharacterReference, ChannelDirection, ChannelProfile, SaveChannelProfileInput, TrashItemSummary } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";

interface ChannelTrashEntry {
  trashId: string;
  deletedAt: string;
  profile: ChannelProfile;
}

export class ChannelProfileStore {
  private mutation: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<ChannelProfile[]> {
    try {
      const raw = (await readFile(this.filePath, "utf8")).replace(/^﻿/, "");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return (parsed as ChannelProfile[])
        .map(normalizeStoredProfile)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      if (error instanceof SyntaxError) {
        await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`).catch(() => undefined);
        return [];
      }
      throw error;
    }
  }

  async get(id: string): Promise<ChannelProfile | undefined> {
    return (await this.list()).find((profile) => profile.id === id);
  }

  async create(input: SaveChannelProfileInput): Promise<ChannelProfile> {
    return this.enqueue(async () => {
      const profiles = await this.list();
      const now = new Date().toISOString();
      const profile = normalizeStoredProfile({
        id: randomUUID(),
        ...normalizeInput(input),
        characterVersions: [],
        createdAt: now,
        updatedAt: now
      });
      profiles.unshift(profile);
      await this.write(profiles);
      return structuredClone(profile);
    });
  }

  async update(id: string, input: SaveChannelProfileInput): Promise<ChannelProfile> {
    return this.enqueue(async () => {
      const profiles = await this.list();
      const index = profiles.findIndex((profile) => profile.id === id);
      const current = profiles[index];
      if (index < 0 || !current) throw new Error("Канал не найден");
      const normalizedInput = normalizeInput({ ...input,
        defaultImageStyle: input.defaultImageStyle === undefined ? current.defaultImageStyle : input.defaultImageStyle }, current.direction);
      const updated = normalizeStoredProfile({
        ...current,
        ...normalizedInput,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString()
      });
      profiles[index] = updated;
      await this.write(profiles);
      return structuredClone(updated);
    });
  }

  async addCharacterVersion(channelId: string, character: ChannelCharacterReference): Promise<ChannelProfile> {
    return this.enqueue(async () => {
      const profiles = await this.list();
      const index = profiles.findIndex((profile) => profile.id === channelId);
      const current = profiles[index];
      if (index < 0 || !current) throw new Error("Канал не найден");
      if (character.channelProfileId !== channelId) throw new Error("Версия героя принадлежит другому каналу");
      const versions = [character, ...current.characterVersions.filter((item) => item.versionId !== character.versionId)];
      const updated = normalizeStoredProfile({ ...current, characterVersions: versions,
        deletedCharacterVersions: current.deletedCharacterVersions?.filter(item => item.versionId !== character.versionId),
        updatedAt: new Date().toISOString() });
      profiles[index] = updated;
      await this.write(profiles);
      return structuredClone(updated);
    });
  }

  async confirmCharacterVersion(channelId: string, versionId: string): Promise<ChannelProfile> {
    return this.enqueue(async () => {
      const profiles = await this.list();
      const index = profiles.findIndex((profile) => profile.id === channelId);
      const current = profiles[index];
      if (index < 0 || !current) throw new Error("Канал не найден");
      const character = current.characterVersions.find((item) => item.versionId === versionId);
      if (!character) throw new Error("Версия героя не найдена в этом канале");
      const updated = normalizeStoredProfile({ ...current, primaryCharacter: character, updatedAt: new Date().toISOString() });
      profiles[index] = updated;
      await this.write(profiles);
      return structuredClone(updated);
    });
  }

  async setCharacterGeneration(channelId: string, generation: ChannelProfile["characterGeneration"]): Promise<ChannelProfile> {
    return this.enqueue(async () => {
      const profiles = await this.list();
      const index = profiles.findIndex(profile => profile.id === channelId);
      const current = profiles[index];
      if (!current) throw new Error("Канал не найден");
      const updated = { ...current, characterGeneration: generation, updatedAt: new Date().toISOString() };
      profiles[index] = updated;
      await this.write(profiles);
      return structuredClone(updated);
    });
  }

  async deleteCharacterVersion(channelId: string, versionId: string): Promise<ChannelProfile> {
    return this.enqueue(async () => {
      const profiles = await this.list();
      const index = profiles.findIndex(profile => profile.id === channelId);
      const current = profiles[index];
      if (!current) throw new Error("Канал не найден");
      const pending = current.characterGeneration;
      if (pending && [pending.sourceVersionId, pending.versionId].includes(versionId)) {
        throw new Error("Этот образ связан с незавершённой генерацией. Сначала получите её результат — данные Flow нельзя потерять.");
      }
      const character = current.characterVersions.find(item => item.versionId === versionId);
      if (!character) {
        if (current.deletedCharacterVersions?.some(item => item.versionId === versionId)) return structuredClone(current);
        throw new Error("Версия героя не найдена в этом канале");
      }
      const updated = normalizeStoredProfile({ ...current,
        primaryCharacter: current.primaryCharacter?.versionId === versionId ? undefined : current.primaryCharacter,
        characterVersions: current.characterVersions.filter(item => item.versionId !== versionId),
        deletedCharacterVersions: [character, ...(current.deletedCharacterVersions ?? []).filter(item => item.versionId !== versionId)],
        updatedAt: new Date().toISOString() });
      profiles[index] = updated;
      await this.write(profiles);
      // Do not remove/rename image files: existing and trashed videos can still reference them.
      return structuredClone(updated);
    });
  }

  async restoreCharacterVersion(channelId: string, versionId: string): Promise<ChannelProfile> {
    return this.enqueue(async () => {
      const profiles = await this.list();
      const index = profiles.findIndex(profile => profile.id === channelId);
      const current = profiles[index];
      if (!current) throw new Error("Канал не найден");
      const character = current.deletedCharacterVersions?.find(item => item.versionId === versionId);
      if (!character) throw new Error("Удалённая версия не найдена в этом канале");
      const updated = normalizeStoredProfile({ ...current,
        characterVersions: [character, ...current.characterVersions.filter(item => item.versionId !== versionId)],
        deletedCharacterVersions: current.deletedCharacterVersions!.filter(item => item.versionId !== versionId),
        updatedAt: new Date().toISOString() });
      profiles[index] = updated;
      await this.write(profiles);
      return structuredClone(updated);
    });
  }

  async moveToTrash(id: string): Promise<ChannelTrashEntry> {
    return this.enqueue(async () => {
      const profiles = await this.list();
      const profile = profiles.find((item) => item.id === id);
      if (!profile) throw new Error("Канал не найден");
      const entry: ChannelTrashEntry = { trashId: randomUUID(), deletedAt: new Date().toISOString(), profile };
      const trash = await this.readTrash();
      // Сначала сохраняем восстанавливаемую копию и только затем скрываем активную запись.
      await this.writeTrash([entry, ...trash]);
      await this.write(profiles.filter((item) => item.id !== id));
      return structuredClone(entry);
    });
  }

  async listTrash(): Promise<ChannelTrashEntry[]> {
    return structuredClone(await this.readTrash());
  }

  async restore(trashId: string): Promise<ChannelProfile> {
    return this.enqueue(async () => {
      const trash = await this.readTrash();
      const entry = trash.find((item) => item.trashId === trashId);
      if (!entry) throw new Error("Канал в корзине не найден");
      const profiles = await this.list();
      if (profiles.some((item) => item.id === entry.profile.id)) throw new Error("Канал с таким ID уже существует");
      const restored = normalizeStoredProfile({ ...entry.profile, updatedAt: new Date().toISOString() });
      await this.write([restored, ...profiles]);
      await this.writeTrash(trash.filter((item) => item.trashId !== trashId));
      return structuredClone(restored);
    });
  }

  async purge(trashId: string): Promise<void> {
    await this.enqueue(async () => {
      const trash = await this.readTrash();
      if (!trash.some((item) => item.trashId === trashId)) throw new Error("Канал в корзине не найден");
      await this.writeTrash(trash.filter((item) => item.trashId !== trashId));
    });
  }

  static trashSummary(entry: ChannelTrashEntry, relatedProjectCount = 0): TrashItemSummary {
    return {
      trashId: entry.trashId,
      kind: "channel",
      originalId: entry.profile.id,
      title: entry.profile.name,
      deletedAt: entry.deletedAt,
      relatedProjectCount
    };
  }

  private async enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(action, action);
    this.mutation = next.then(() => undefined, () => undefined);
    return next;
  }

  private async write(profiles: ChannelProfile[]): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(profiles, null, 2));
  }

  private async readTrash(): Promise<ChannelTrashEntry[]> {
    const trashPath = `${this.filePath}.trash`;
    try {
      const parsed = JSON.parse((await readFile(trashPath, "utf8")).replace(/^﻿/, "")) as unknown;
      if (!Array.isArray(parsed)) return [];
      return (parsed as ChannelTrashEntry[])
        .filter((entry) => Boolean(entry?.trashId && entry?.profile?.id))
        .map((entry) => ({ ...entry, profile: normalizeStoredProfile(entry.profile) }))
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      if (error instanceof SyntaxError) {
        await rename(trashPath, `${trashPath}.corrupt-${Date.now()}`).catch(() => undefined);
        return [];
      }
      throw error;
    }
  }

  private async writeTrash(entries: ChannelTrashEntry[]): Promise<void> {
    await atomicWrite(`${this.filePath}.trash`, JSON.stringify(entries, null, 2));
  }
}

function normalizeInput(input: SaveChannelProfileInput, lockedDirection?: ChannelDirection): Omit<ChannelProfile, "id" | "createdAt" | "updatedAt" | "primaryCharacter" | "characterVersions"> {
  const name = input.name.replace(/\s+/g, " ").trim();
  const masterPrompt = input.masterPrompt.trim();
  if (!name) throw new Error("Укажите название канала");
  if (!input.countryCode.trim() || !input.languageCode.trim()) throw new Error("Выберите язык канала");
  const requestedDirection = input.direction
    ?? (input.defaultMediaMode ? directionFromMediaMode(input.defaultMediaMode) : lockedDirection)
    ?? "stock-documentary";
  if (lockedDirection && requestedDirection !== lockedDirection) {
    throw new Error("Направление канала нельзя изменить после создания");
  }
  const direction = lockedDirection ?? requestedDirection;
  return {
    name: name.slice(0, 100),
    countryCode: input.countryCode.trim().toUpperCase().slice(0, 2),
    languageCode: input.languageCode.trim().toLowerCase().slice(0, 12),
    languageLabel: input.languageLabel.replace(/\s+/g, " ").trim().slice(0, 80),
    masterPrompt,
    lumeanTemplateUuid: input.lumeanTemplateUuid?.trim() || undefined,
    lumeanTemplateName: input.lumeanTemplateName?.replace(/\s+/g, " ").trim().slice(0, 120) || undefined,
    defaultDurationMinutes: clampDuration(input.defaultDurationMinutes),
    direction,
    defaultMediaMode: direction === "ai-story" ? "ai" : "stock",
    defaultImageStyle: input.defaultImageStyle?.trim().slice(0, 2_000) || undefined,
    motionTemplate: input.motionTemplate?.trim().slice(0, 100) || "Без шаблона"
  };
}

function normalizeStoredProfile(profile: ChannelProfile): ChannelProfile {
  const direction = profile.direction === "ai-story" || profile.direction === "stock-documentary"
    ? profile.direction
    : directionFromMediaMode(profile.defaultMediaMode);
  const versions = Array.isArray(profile.characterVersions)
    ? profile.characterVersions.filter((item) => Boolean(item?.versionId && item?.imagePath))
    : [];
  const primaryCharacter = profile.primaryCharacter?.versionId
    ? versions.find((item) => item.versionId === profile.primaryCharacter?.versionId) ?? profile.primaryCharacter
    : undefined;
  if (primaryCharacter && !versions.some(item => item.versionId === primaryCharacter.versionId)) versions.unshift(primaryCharacter);
  return {
    ...profile,
    countryCode: profile.countryCode?.toUpperCase() || "RU",
    languageCode: profile.languageCode?.toLowerCase() || "ru",
    languageLabel: profile.languageLabel || "Русский",
    masterPrompt: profile.masterPrompt || "",
    defaultDurationMinutes: clampDuration(profile.defaultDurationMinutes),
    direction,
    defaultMediaMode: direction === "ai-story" ? "ai" : "stock",
    motionTemplate: profile.motionTemplate || "Без шаблона",
    defaultImageStyle: profile.defaultImageStyle?.trim().slice(0, 2_000) || undefined,
    primaryCharacter,
    characterVersions: versions
  };
}

function directionFromMediaMode(mode?: string): ChannelDirection {
  return mode === "ai" ? "ai-story" : "stock-documentary";
}

function clampDuration(value?: number): number {
  return Math.min(720, Math.max(1, Math.round(Number(value) || 10)));
}
