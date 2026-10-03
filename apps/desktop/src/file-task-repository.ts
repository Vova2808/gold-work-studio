import { readFile, rename } from "node:fs/promises";
import type { TaskRepository } from "@gold-work/core";
import type { QueueTask } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";

export class FileTaskRepository implements TaskRepository {
  constructor(private readonly filePath: string) {}

  async list(): Promise<QueueTask[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    try {
      const parsed = JSON.parse(content) as unknown;
      return Array.isArray(parsed) ? (parsed as QueueTask[]) : [];
    } catch {
      // Битый queue.json не должен «окирпичивать» очередь: откладываем файл и начинаем с пустой.
      await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`).catch(() => undefined);
      return [];
    }
  }

  async replace(tasks: QueueTask[]): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(tasks, null, 2));
  }
}
