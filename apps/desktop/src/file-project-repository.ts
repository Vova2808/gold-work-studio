import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from 'node:util';
import { open, readFile, rename, stat, type FileHandle } from "node:fs/promises";
import type { ProjectRepository, ProjectMutationOptions } from "@gold-work/core";
import type { Project } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";
import {projectForDisplay} from './project-display.js';
import {projectJsonChunks} from './project-json.js';
import {indexProjectRegistry, readRegistryProject, registryProjectBytes, type ProjectRegistryEntry} from './project-registry.js';

interface RegistrySnapshot {
  file?: FileHandle;
  revision?: string;
  entries: ProjectRegistryEntry[];
}

type SavedEntry = ProjectRegistryEntry | {replacement: Project};

export interface ProjectTrashEntry {
  trashId: string;
  deletedAt: string;
  project: Project;
}

export class FileProjectRepository implements ProjectRepository {
  private mutation: Promise<void> = Promise.resolve();
  private cached?: { revision: string; entries: ProjectRegistryEntry[] };
  private loading?: { revision: string; promise: Promise<ProjectRegistryEntry[]> };

  constructor(private readonly filePath: string) {}

  async list(options?: {omitCandidates?: boolean}): Promise<Project[]> {
    return this.withSnapshot(async snapshot => {
      if (options?.omitCandidates) return structuredClone(snapshot.entries.map(entry => entry.display));
      const projects: Project[] = [];
      for (const entry of snapshot.entries) projects.push(await readRegistryProject(snapshot.file!, entry));
      return projects;
    });
  }

  async listForDisplay(baseline?: Map<string, string>): Promise<{projects: Project[]; versions: Map<string,string>}> {
    return this.withSnapshot(async ({entries}) => {
      const projects = entries.map(entry => entry.display);
      return {projects: structuredClone(projects.filter(project => !baseline || baseline.get(project.id) !== project.updatedAt)),
        versions: new Map(projects.map(project => [project.id, project.updatedAt]))};
    });
  }

  private async withSnapshot<T>(action: (snapshot: RegistrySnapshot) => Promise<T>): Promise<T> {
    let file: FileHandle;
    try {
      file = await open(this.filePath, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.cached = undefined; return action({entries: []}); }
      throw error;
    }
    try {
      const info = await file.stat({bigint: true});
      const revision = `${info.ino}:${info.mtimeNs}:${info.size}`;
      let entries = this.cached?.revision === revision ? this.cached.entries : undefined;
      if (!entries) {
        if (this.loading?.revision !== revision) {
          const promise = indexProjectRegistry(file);
          this.loading = {revision, promise};
        }
        const loading = this.loading;
        try {
          entries = await loading.promise;
          this.cached = {revision, entries};
        } catch (error) {
          // Never replace a damaged/partially written registry with an empty one.
          // Keep its bytes at the original path for recovery and report the error.
          if (error instanceof SyntaxError) throw new Error('Реестр проектов повреждён. Исходный файл сохранён; запись остановлена.', {cause: error});
          throw error;
        } finally {
          if (this.loading === loading) this.loading = undefined;
        }
      }
      return await action({file, revision, entries});
    } finally { await file.close(); }
  }

  async get(id: string, options?: {omitCandidates?: boolean}): Promise<Project | undefined> {
    return this.withSnapshot(async snapshot => {
      const entry = snapshot.entries.find(entry => entry.display.id === id);
      if (!entry) return undefined;
      return options?.omitCandidates ? structuredClone(entry.display) : readRegistryProject(snapshot.file!, entry);
    });
  }

  async save(project: Project): Promise<void> {
    const replacement = structuredClone(project);
    await this.enqueue(() => this.withSnapshot(async snapshot => {
      const entries: SavedEntry[] = [...snapshot.entries];
      const index = snapshot.entries.findIndex(entry => entry.display.id === replacement.id);
      if (index >= 0) entries[index] = {replacement};
      else entries.unshift({replacement});
      await this.write(snapshot, entries);
    }));
  }

  async mutate(id: string, updater: (project: Project) => Project, options?: ProjectMutationOptions): Promise<Project> {
    return this.enqueue(() => this.withSnapshot(async snapshot => {
      const index = snapshot.entries.findIndex(entry => entry.display.id === id);
      if (index < 0) throw new Error(`Проект ${id} не найден`);
      const current = await readRegistryProject(snapshot.file!, snapshot.entries[index]!);
      const included = options?.candidateSceneIds && new Set(options.candidateSceneIds);
      const input = included ? {...current, scenes: projectForDisplay(current).scenes.map((scene, i) => included.has(scene.id) ? current.scenes[i]! : scene)} : current;
      // Detach caller-owned metadata before attaching immutable evidence from
      // the current snapshot. Neither a retained updater reference nor a thrown updater
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
      const entries: SavedEntry[] = [...snapshot.entries];
      entries[index] = {replacement: updated};
      await this.write(snapshot, entries);
      return structuredClone(updated);
    }));
  }

  async delete(id: string): Promise<void> {
    await this.enqueue(() => this.withSnapshot(snapshot => this.write(snapshot, snapshot.entries.filter(entry => entry.display.id !== id))));
  }

  async moveToTrash(id: string): Promise<ProjectTrashEntry> {
    return this.enqueue(() => this.withSnapshot(async snapshot => {
      const stored = snapshot.entries.find(entry => entry.display.id === id);
      if (!stored) throw new Error("Проект не найден");
      const project = await readRegistryProject(snapshot.file!, stored);
      const entry: ProjectTrashEntry = {
        trashId: randomUUID(),
        deletedAt: new Date().toISOString(),
        project
      };
      const trash = await this.readTrash();
      // Восстанавливаемая копия записывается раньше удаления из активного списка.
      await this.writeTrash([entry, ...trash]);
      await this.write(snapshot, snapshot.entries.filter(entry => entry.display.id !== id));
      return structuredClone(entry);
    }));
  }

  async listTrash(): Promise<ProjectTrashEntry[]> {
    return structuredClone(await this.readTrash());
  }

  async restore(trashId: string): Promise<Project> {
    return this.enqueue(() => this.withSnapshot(async snapshot => {
      const trash = await this.readTrash();
      const entry = trash.find((item) => item.trashId === trashId);
      if (!entry) throw new Error("Проект в корзине не найден");
      if (snapshot.entries.some(item => item.display.id === entry.project.id)) throw new Error("Проект с таким ID уже существует");
      const restored = { ...entry.project, updatedAt: new Date().toISOString() };
      await this.write(snapshot, [{replacement: restored}, ...snapshot.entries]);
      await this.writeTrash(trash.filter((item) => item.trashId !== trashId));
      return structuredClone(restored);
    }));
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

  private async write(snapshot: RegistrySnapshot, entries: SavedEntry[]): Promise<void> {
    const indexed: ProjectRegistryEntry[] = [];
    const assertUnchanged = async () => {
      let revision: string | undefined;
      try {
        const info = await stat(this.filePath, {bigint: true});
        revision = `${info.ino}:${info.mtimeNs}:${info.size}`;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (revision !== snapshot.revision) throw new Error('Проекты изменены другим процессом; сохранение отменено. Повторите действие после обновления.');
    };
    async function* chunks(): AsyncGenerator<string | Buffer> {
      let position = 1;
      yield '[';
      for (const entry of entries) {
        if (indexed.length) { yield ','; position++; }
        const start = position;
        const source = 'replacement' in entry ? projectJsonChunks(entry.replacement) : registryProjectBytes(snapshot.file!, entry);
        for await (const chunk of source) {
          position += Buffer.byteLength(chunk);
          yield chunk;
        }
        indexed.push({display: 'replacement' in entry ? projectForDisplay(entry.replacement) : entry.display, start, end: position});
      }
      yield ']';
      // Windows cannot replace the destination while our own read handle is open.
      // All source bytes are already in the temporary file at this point.
      await snapshot.file?.close();
      await assertUnchanged();
    }
    await atomicWrite(this.filePath, chunks(), {allowCopyFallback: false});
    const info = await stat(this.filePath, {bigint: true});
    indexed.sort((a,b) => (b.display.updatedAt ?? '').localeCompare(a.display.updatedAt ?? ''));
    this.cached = {revision: `${info.ino}:${info.mtimeNs}:${info.size}`, entries: indexed};
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
