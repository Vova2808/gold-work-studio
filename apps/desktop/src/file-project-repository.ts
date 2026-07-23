import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProjectRepository } from "@gold-work/core";
import type { Project } from "@gold-work/shared";

export class FileProjectRepository implements ProjectRepository {
  private mutation: Promise<void> = Promise.resolve();

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

  async get(id: string): Promise<Project | undefined> {
    const projects = await this.list();
    return projects.find((project) => project.id === id);
  }

  async save(project: Project): Promise<void> {
    await this.enqueue(async () => {
      const projects = await this.list();
      const index = projects.findIndex((candidate) => candidate.id === project.id);
      if (index >= 0) projects[index] = project;
      else projects.unshift(project);
      await this.write(projects);
    });
  }

  async mutate(id: string, updater: (project: Project) => Project): Promise<Project> {
    return this.enqueue(async () => {
      const projects = await this.list();
      const index = projects.findIndex((project) => project.id === id);
      const current = projects[index];
      if (!current || index < 0) throw new Error(`Проект ${id} не найден`);
      const updated = updater(structuredClone(current));
      projects[index] = updated;
      await this.write(projects);
      return structuredClone(updated);
    });
  }

  async delete(id: string): Promise<void> {
    await this.enqueue(async () => {
      const projects = await this.list();
      await this.write(projects.filter((project) => project.id !== id));
    });
  }

  private async enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(action, action);
    this.mutation = next.then(() => undefined, () => undefined);
    return next;
  }

  private async write(projects: Project[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(projects, null, 2), "utf8");
    await rename(temporaryPath, this.filePath);
  }
}
