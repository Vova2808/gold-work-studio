import { readFile, rename } from "node:fs/promises";
import type { ProjectRepository } from "@gold-work/core";
import type { Project } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";

export class FileProjectRepository implements ProjectRepository {
  private mutation: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<Project[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    try {
      const parsed = JSON.parse(content) as unknown;
      const projects = Array.isArray(parsed) ? (parsed as Project[]) : [];
      return projects.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    } catch {
      // Битый projects.json не должен «окирпичивать» приложение: файл откладывается, список начинается заново.
      await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`).catch(() => undefined);
      return [];
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
    await atomicWrite(this.filePath, JSON.stringify(projects, null, 2));
  }
}
