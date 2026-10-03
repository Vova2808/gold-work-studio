import { randomUUID } from "node:crypto";
import { copyFile, link, rename, rm, stat, statfs } from "node:fs/promises";
import { resolve } from "node:path";
import { checksumFile } from "./effect-library.js";

export const DOCUMENTARY_STORAGE_RESERVE = 512 * 1024 * 1024;
export class DocumentaryStorageUnavailableError extends Error {}
export function documentaryStorageBudget(availableBytes: number): number {
  return Math.max(0, availableBytes - DOCUMENTARY_STORAGE_RESERVE);
}
export async function documentaryAvailableBytes(directory: string): Promise<number> {
  const disk = await statfs(directory);
  return documentaryStorageBudget(disk.bavail * disk.bsize);
}
export async function ensureDocumentarySpace(directory: string, requiredBytes = 0): Promise<void> {
  if (await documentaryAvailableBytes(directory) <= requiredBytes) throw new DocumentaryStorageUnavailableError("Недостаточно места для материала: освободите диск рабочего пространства или перенесите хранилище в настройках. Предыдущие файлы сохранены.");
}

/** Only for app-owned immutable originals/derivatives, never for a user's mutable import. */
export async function copyImmutableDocumentaryFile(source: string, destination: string): Promise<void> {
  if (resolve(source) === resolve(destination)) return;
  const original = await stat(source);
  const existing = await stat(destination).catch(() => undefined);
  if (existing && original.ino !== 0 && original.dev === existing.dev && original.ino === existing.ino) return;
  if (existing?.size === original.size && await checksumFile(source) === await checksumFile(destination)) return;
  const temporary = `${destination}.${randomUUID()}.copy`;
  try {
    try { await link(source, temporary); }
    catch (error) {
      if (!["EXDEV", "EPERM", "EACCES", "ENOTSUP", "EMLINK"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await copyFile(source, temporary);
    }
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}
