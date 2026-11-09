import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { WorkspaceUsage, WorkspaceUsageEntry } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";

export function workspaceUsagePath(root: string, requested = ""): string {
  const target = resolve(root, requested), rel = relative(resolve(root), target);
  if (isAbsolute(requested) || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Выберите папку внутри хранилища");
  return target;
}

/** Size of unique file identities, not the sum of NTFS hard-link names. No file bodies are read. */
export async function scanWorkspaceUsage(root: string, requested = ""): Promise<WorkspaceUsage> {
  const target = workspaceUsagePath(root, requested);
  type Node = WorkspaceUsageEntry & { identities: Map<string, number> };
  const projects: WorkspaceUsageEntry[] = [];
  const walk = async (path: string, ancestors: Set<string>, depth: number): Promise<{ node: Node; children: WorkspaceUsageEntry[] }> => {
    const info = await stat(path, { bigint: true });
    const node: Node = { path: relative(root, path), name: path === root ? "Хранилище" : path.split(/[\\/]/).at(-1)!, directory: info.isDirectory(), bytes: 0, logicalBytes: 0, files: 0, identities: new Map() };
    const children: WorkspaceUsageEntry[] = [];
    if (info.isFile()) {
      node.identities.set(`${info.dev}:${info.ino}`, Number(info.size)); node.logicalBytes = Number(info.size); node.files = 1;
    } else if (info.isDirectory()) {
      const physical = await realpath(path);
      if (ancestors.has(physical)) throw new Error("Циклическая ссылка в хранилище");
      const next = new Set(ancestors).add(physical);
      for (const name of await readdir(path)) {
        let child: Node;
        try { child = (await walk(join(path, name), next, depth + 1)).node; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        for (const [key, bytes] of child.identities) node.identities.set(key, bytes);
        node.logicalBytes += child.logicalBytes; node.files += child.files;
        const { identities: _, ...entry } = child;
        if (depth === 0) children.push(entry);
        if (relative(root, path).replaceAll("\\", "/") === "projects" && child.directory) projects.push(entry);
      }
    }
    node.bytes = [...node.identities.values()].reduce((sum, bytes) => sum + bytes, 0);
    return { node, children };
  };
  const { node, children } = await walk(target, new Set(), 0);
  for (const entry of children) {
    const checksum = /^([a-f0-9]{64})(?:\.|$)/i.exec(entry.name)?.[1];
    if (!checksum) continue;
    const source = await readFile(join(root, "Materials", "Catalog", `${checksum}.json`), "utf8").then(text => JSON.parse(text) as { title?: string }, () => undefined).catch(() => undefined);
    if (typeof source?.title === "string") entry.label = source.title.slice(0, 180);
  }
  return { path: node.path, bytes: node.bytes, logicalBytes: node.logicalBytes, files: node.files, entries: children.sort((a, b) => b.bytes - a.bytes), projects, scannedAt: new Date().toISOString() };
}

function isUsageEntry(value: unknown): value is WorkspaceUsageEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<WorkspaceUsageEntry>;
  return typeof entry.path === "string" && typeof entry.name === "string"
    && (entry.label === undefined || typeof entry.label === "string")
    && typeof entry.directory === "boolean"
    && Number.isFinite(entry.bytes) && Number.isFinite(entry.logicalBytes) && Number.isFinite(entry.files);
}

function isWorkspaceUsage(value: unknown): value is WorkspaceUsage {
  if (!value || typeof value !== "object") return false;
  const usage = value as Partial<WorkspaceUsage>;
  return usage.path === "" && Number.isFinite(usage.bytes)
    && Number.isFinite(usage.logicalBytes) && Number.isFinite(usage.files)
    && typeof usage.scannedAt === "string" && Number.isFinite(Date.parse(usage.scannedAt))
    && Array.isArray(usage.entries) && usage.entries.every(isUsageEntry)
    && Array.isArray(usage.projects) && usage.projects.every(isUsageEntry);
}

export function workspaceUsageReader(root: string, cacheFile?: string) {
  const cache = new Map<string, WorkspaceUsage>();
  const pending = new Map<string, Promise<WorkspaceUsage>>();
  const rootKey = process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root);
  const loaded = cacheFile ? readFile(cacheFile, "utf8").then(text => {
    const saved = JSON.parse(text) as { root?: string; usage?: WorkspaceUsage };
    if (saved.root === rootKey && isWorkspaceUsage(saved.usage)) cache.set("", saved.usage);
  }).catch(() => undefined) : Promise.resolve();
  return (path = "", refresh = false): Promise<WorkspaceUsage> => loaded.then(() => {
    const previous = cache.get(path);
    if (!refresh && previous) return Promise.resolve(previous);
    const running = pending.get(path);
    if (running) return running;
    const result = scanWorkspaceUsage(root, path).then(usage => {
      cache.set(path, usage);
      if (path === "" && cacheFile) void atomicWrite(cacheFile, JSON.stringify({ root: rootKey, usage })).catch(() => undefined);
      return usage;
    }).finally(() => { pending.delete(path); });
    pending.set(path, result);
    return result;
  });
}
