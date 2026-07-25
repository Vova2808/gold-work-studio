import { readFile } from "node:fs/promises";
import type { TaskRepository } from "@gold-work/core";
import type { QueueTask } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";

export class FileTaskRepository implements TaskRepository {
  constructor(private readonly filePath: string) {}

  async list(): Promise<QueueTask[]> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return JSON.parse(content) as QueueTask[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async replace(tasks: QueueTask[]): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(tasks, null, 2));
  }
}
