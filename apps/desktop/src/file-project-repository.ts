import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProjectRepository } from "@gold-work/core";
import type { Project } from "@gold-work/shared";

export class FileProjectRepository implements ProjectRepository {
  constructor(private readonly filePath: string) {}

  async list(): Promise<Project[]> {
    try {
      const content = await readFile(this.filePath, "utf8");
      const projects = JSON.parse(content) as Project[];
      return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async save(project: Project): Promise<void> {
    const projects = await this.list();
    const index = projects.findIndex((candidate) => candidate.id === project.id);
    if (index >= 0) projects[index] = project;
    else projects.unshift(project);

    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(projects, null, 2), "utf8");
    await rename(temporaryPath, this.filePath);
  }
}

