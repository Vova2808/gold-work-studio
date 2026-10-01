import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { WorkspaceUsage, WorkspaceUsageEntry } from "@gold-work/shared";

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

export function workspaceUsageReader(root: string) {
  const cache = new Map<string, { at: number; result: Promise<WorkspaceUsage> }>();
  return (path = "", refresh = false) => {
    const previous = cache.get(path);
    if (!refresh && previous && Date.now() - previous.at < 60_000) return previous.result;
    const result = scanWorkspaceUsage(root, path).catch(error => { cache.delete(path); throw error; });
    cache.set(path, { at: Date.now(), result });
    return result;
  };
}
