import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TaskRepository } from "@gold-work/core";
import type { QueueTask } from "@gold-work/shared";

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
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(tasks, null, 2), "utf8");
    await rename(temporaryPath, this.filePath);
  }
}
