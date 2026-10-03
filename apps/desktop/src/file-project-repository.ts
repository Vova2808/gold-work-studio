import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from 'node:util';
import { readFile, rename, stat } from "node:fs/promises";
import type { ProjectRepository, ProjectMutationOptions } from "@gold-work/core";
import type { Project } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";
import {projectForDisplay} from './project-display.js';
import {registryJsonChunks} from './project-json.js';

export interface ProjectTrashEntry {
  trashId: string;
  deletedAt: string;
  project: Project;
}

export class FileProjectRepository implements ProjectRepository {
  private mutation: Promise<void> = Promise.resolve();
  private cached?: { revision: string; projects: Project[] };
  private loading?: { revision: string; promise: Promise<Project[]> };

  constructor(private readonly filePath: string) {}

  async list(options?: {omitCandidates?: boolean}): Promise<Project[]> {
    const projects=await this.readAll();
    return structuredClone(options?.omitCandidates?projects.map(projectForDisplay):projects);
  }

  async listForDisplay(baseline?: Map<string, string>): Promise<{projects: Project[]; versions: Map<string,string>}> {
    const projects = await this.readAll();
    return {projects: structuredClone(projects.filter(project => !baseline || baseline.get(project.id) !== project.updatedAt).map(projectForDisplay)),
      versions: new Map(projects.map(project => [project.id, project.updatedAt]))};
  }

  private async readAll(): Promise<Project[]> {
    let revision: string;
    try {
      const info = await stat(this.filePath, { bigint: true });
      revision = `${info.ino}:${info.mtimeNs}:${info.size}`;
      if (this.cached?.revision === revision) return this.cached.projects;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { this.cached = undefined; return []; }
      throw error;
    }
    // Startup readers often arrive together. Share the same disk read/parse
    // instead of expanding a large registry several times before caching it.
    if (this.loading?.revision === revision) return this.loading.promise;
    const promise = (async () => {
      let content: string;
      try { content = await readFile(this.filePath, "utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      try {
        const parsed = JSON.parse(content) as unknown;
        const projects = Array.isArray(parsed) ? (parsed as Project[]) : [];
        projects.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
        this.cached = { revision, projects };
        return projects;
      } catch {
        // Preserve a malformed registry for recovery instead of blocking startup.
        await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`).catch(() => undefined);
        this.cached = undefined;
        return [];
      }
    })();
    this.loading = { revision, promise };
    try { return await promise; }
    finally { if (this.loading?.promise === promise) this.loading = undefined; }
  }

  async get(id: string, options?: {omitCandidates?: boolean}): Promise<Project | undefined> {
    const project = (await this.readAll()).find((project) => project.id === id);
    return project ? structuredClone(options?.omitCandidates ? projectForDisplay(project) : project) : undefined;
  }

  async save(project: Project): Promise<void> {
    await this.enqueue(async () => {
      const projects = [...await this.readAll()];
      const index = projects.findIndex((candidate) => candidate.id === project.id);
      if (index >= 0) projects[index] = structuredClone(project);
      else projects.unshift(structuredClone(project));
      await this.write(projects);
    });
  }

  async mutate(id: string, updater: (project: Project) => Project, options?: ProjectMutationOptions): Promise<Project> {
    return this.enqueue(async () => {
      const projects = [...await this.readAll()];
      const index = projects.findIndex((project) => project.id === id);
      const current = projects[index];
      if (!current || index < 0) throw new Error(`Проект ${id} не найден`);
      const included = options?.candidateSceneIds && new Set(options.candidateSceneIds);
      const input = included ? {...current, scenes: projectForDisplay(current).scenes.map((scene, i) => included.has(scene.id) ? current.scenes[i]! : scene)} : current;
      // Detach caller-owned metadata before attaching immutable evidence from
      // the cache. Neither a retained updater reference nor a thrown updater
      // can mutate stored candidates for another scene.
      const updated = structuredClone(updater(structuredClone(input)));
      if (included) {
        const byId = new Map(current.scenes.map(scene => [scene.id, scene.documentary]));
        updated.scenes = updated.scenes.map(scene => {
          if (!scene.documentary?.candidatesDeferred) return scene;
          const {candidatesDeferred: _deferred, candidateCount: _count, ...doc} = scene.documentary;
          return {...scene, documentary: {...doc, candidates: byId.get(scene.id)?.candidates ?? []}};
        });
      }
      if (isDeepStrictEqual(updated, current)) return structuredClone(current);
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

  async moveToTrash(id: string): Promise<ProjectTrashEntry> {
    return this.enqueue(async () => {
      const projects = await this.list();
      const project = projects.find((item) => item.id === id);
      if (!project) throw new Error("Проект не найден");
      const entry: ProjectTrashEntry = {
        trashId: randomUUID(),
        deletedAt: new Date().toISOString(),
        project
      };
      const trash = await this.readTrash();
      // Восстанавливаемая копия записывается раньше удаления из активного списка.
      await this.writeTrash([entry, ...trash]);
      await this.write(projects.filter((item) => item.id !== id));
      return structuredClone(entry);
    });
  }

  async listTrash(): Promise<ProjectTrashEntry[]> {
    return structuredClone(await this.readTrash());
  }

  async restore(trashId: string): Promise<Project> {
    return this.enqueue(async () => {
      const trash = await this.readTrash();
      const entry = trash.find((item) => item.trashId === trashId);
      if (!entry) throw new Error("Проект в корзине не найден");
      const projects = await this.list();
      if (projects.some((item) => item.id === entry.project.id)) throw new Error("Проект с таким ID уже существует");
      const restored = { ...entry.project, updatedAt: new Date().toISOString() };
      await this.write([restored, ...projects]);
      await this.writeTrash(trash.filter((item) => item.trashId !== trashId));
      return structuredClone(restored);
    });
  }

  async purge(trashId: string): Promise<ProjectTrashEntry> {
    return this.enqueue(async () => {
      const trash = await this.readTrash();
      const entry = trash.find((item) => item.trashId === trashId);
      if (!entry) throw new Error("Проект в корзине не найден");
      await this.writeTrash(trash.filter((item) => item.trashId !== trashId));
      return structuredClone(entry);
    });
  }

  private async enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(action, action);
    this.mutation = next.then(() => undefined, () => undefined);
    return next;
  }

  private async write(projects: Project[]): Promise<void> {
    // The same registry used to be cloned, pretty-printed, read and parsed
    // again for every scene update (123 MB in the observed long production).
    await atomicWrite(this.filePath, registryJsonChunks(projects));
    const info = await stat(this.filePath, {bigint: true});
    projects.sort((a,b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    this.cached = {revision: `${info.ino}:${info.mtimeNs}:${info.size}`, projects};
  }

  private async readTrash(): Promise<ProjectTrashEntry[]> {
    const trashPath = `${this.filePath}.trash`;
    try {
      const parsed = JSON.parse(await readFile(trashPath, "utf8")) as unknown;
      if (!Array.isArray(parsed)) return [];
      return (parsed as ProjectTrashEntry[])
        .filter((entry) => Boolean(entry?.trashId && entry?.project?.id))
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

  private async writeTrash(entries: ProjectTrashEntry[]): Promise<void> {
    await atomicWrite(`${this.filePath}.trash`, JSON.stringify(entries, null, 2));
  }
}
