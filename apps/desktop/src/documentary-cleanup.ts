import { lstat, readdir, readFile, realpath, unlink } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { Project } from "@gold-work/shared";

const hashInName = /^([a-f0-9]{64})(?:[.-]|$)/i;
const mediaExtension = /\.(?:mp4|mov|webm|mkv|wmv|avi|ogv|jpe?g|png|webp|tiff?)$/i;
const downloadedProviders = new Set(["youtube", "commons", "internet-archive", "loc", "pexels", "pixabay", "web"]);
// Selection can finish analysis without assigning a source (Stop, connection
// failure, or another candidate winning). A restart must retain its recent
// download, otherwise the saved paid result points at bytes we just deleted.
const recentDownloadRetentionMs = 24 * 3600_000;
const normalized = (path: string) => resolve(path).toLowerCase();
const inside = (root: string, path: string) => { const part = relative(root, path); return part !== "" && !part.startsWith("..") && !isAbsolute(part); };

export interface DocumentaryCleanupFile { path: string; bytes: number; mtimeMs: number; identity: string; links: number }
export interface DocumentaryCleanupPlan {
  roots: string[];
  files: DocumentaryCleanupFile[];
  /** Physical file data, counting an inode only if all of its links will be removed. */
  reclaimableBytes: number;
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

/** Never traverse nested junctions/symlinks, and never enumerate the user's import folders. */
async function filesBelow(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (["Analysis", "VideoCatalog", "Backups"].includes(entry.name)) continue;
      result.push(...await filesBelow(path));
    } else if (entry.isFile()) result.push(path);
  }
  return result;
}

/** Read only. Call with all active AND trashed projects; unreadable backups abort cleanup. */
export async function planDocumentaryCleanup(input: {
  materialRoot: string;
  projects: Project[];
  projectDirectory: (id: string) => string;
  now?: number;
}): Promise<DocumentaryCleanupPlan> {
  const roots: string[] = [], protectedPaths = new Set<string>(), protectedHashes = new Set<string>(), retainedHashes = new Set<string>(), downloadedHashes = new Set<string>(), cachedHashes = new Set<string>();
  const protect = (value: unknown): void => {
    if (typeof value === "string" && isAbsolute(value)) {
      protectedPaths.add(normalized(value));
      const hash = basename(value).match(hashInName)?.[1]?.toLowerCase();
      if (hash) protectedHashes.add(hash);
    } else if (Array.isArray(value)) value.forEach(protect);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        // Search results are suggestions, not selected/pinned material. All actual
        // selections, cuts, effects, alternates, disabled scenes and outputs stay.
        if (key !== "candidates") protect(child);
        if (key === "checksum" && typeof child === "string" && /^[a-f0-9]{64}$/i.test(child)) protectedHashes.add(child.toLowerCase());
      }
    }
  };
  input.projects.forEach(protect);
  const requestedRoots = new Set<string>([resolve(input.materialRoot)]);
  for (const project of input.projects) {
    const directory = input.projectDirectory(project.id), root = join(directory, "Documentary");
    requestedRoots.add(resolve(root));
    // The on-disk manifest may be newer than a registry snapshot.
    const manifest = join(directory, "project.json");
    if (await exists(manifest)) protect(JSON.parse(await readFile(manifest, "utf8")));
    for (const name of ["Backups", "Plans"]) {
      const backups = join(root, name);
      if (await exists(backups)) {
        for (const path of await filesBelow(backups)) if (path.endsWith(".json")) protect(JSON.parse(await readFile(path, "utf8")));
      }
    }
  }
  // Resolve configured root junctions once. Descendant links remain excluded.
  for (const root of requestedRoots) if (await exists(root)) roots.push(await realpath(root));
  for (const root of roots) {
    const catalogs = join(root, "VideoCatalog");
    if (!await exists(catalogs)) continue;
    for (const entry of await readdir(catalogs, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/i.test(entry.name)) continue;
      const path = join(catalogs, entry.name, "catalog-v1.json");
      if (!await exists(path)) continue;
      const catalog = JSON.parse(await readFile(path, "utf8")) as { pendingIds?: number[] };
      if (catalog.pendingIds?.length) { protectedHashes.add(entry.name.toLowerCase()); retainedHashes.add(entry.name.toLowerCase()); }
    }
  }
  for (const path of [...protectedPaths]) if (await exists(path)) protectedPaths.add(normalized(await realpath(path)));
  const entries = [...new Set((await Promise.all(roots.map(filesBelow))).flat())];
  const lastSourceUse = new Map<string, number>();
  for (const path of entries) {
    if (!/(?:[a-f0-9]{64}\.source\.json|[\\/]Catalog[\\/][a-f0-9]{64}\.json)$/i.test(path)) continue;
    const source = JSON.parse(await readFile(path, "utf8")) as { id?: string; provider?: string; localPath?: string };
    const hash = basename(path).match(hashInName)?.[1]?.toLowerCase();
    if (!hash) continue;
    // Hard links retain the original file's timestamp. A newly written source
    // sidecar records a later reuse even when those bytes are several days old.
    const touched = (await lstat(path)).mtimeMs;
    lastSourceUse.set(hash, Math.max(lastSourceUse.get(hash) ?? 0, touched));
    // A cache selection changes provider/id to local:<hash>, not the origin.
    // Only authoritative download provenance may make that cache disposable.
    if (source.provider === "local" && source.id === `local:${hash}`) cachedHashes.add(hash);
    else if (source.id?.startsWith("manual:") || !downloadedProviders.has(source.provider ?? "")) { protectedHashes.add(hash); retainedHashes.add(hash); }
    else downloadedHashes.add(hash);
  }
  for (const hash of cachedHashes) if (!downloadedHashes.has(hash)) { protectedHashes.add(hash); retainedHashes.add(hash); }
  // Redundant project hard-link names need not survive just because another
  // project still uses the same bytes. Keep every referenced name, the shared
  // library original, imports and unfinished paid-analysis sources.
  const protectedIdentities = new Set<string>(), protectedCopies = new Set<string>();
  for (const path of protectedPaths) if (await exists(path)) {
    const info = await lstat(await realpath(path));
    if (info.isFile()) {
      if (info.ino) protectedIdentities.add(`${info.dev}:${info.ino}`);
      // Migration across volumes can leave separate immutable copies of the
      // same content-addressed download. Retain the referenced copy, not every
      // obsolete project copy merely because its checksum is still in use.
      const hash = /^([a-f0-9]{64})\.[a-z0-9]+$/i.exec(basename(path))?.[1]?.toLowerCase();
      if (hash) protectedCopies.add(`${hash}:${extname(path).toLowerCase()}:${info.size}`);
    }
  }
  const libraryFiles = normalized(join(input.materialRoot, "Files"));
  const files: DocumentaryCleanupFile[] = [];
  const now = input.now ?? Date.now();
  for (const path of entries) {
    if (protectedPaths.has(normalized(path))) continue;
    const hash = basename(path).match(hashInName)?.[1]?.toLowerCase();
    const ownedDownload = hash && downloadedHashes.has(hash) && !retainedHashes.has(hash) && mediaExtension.test(path);
    const oldTemporary = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}(?:\.temp)?\.download(?:\.ytdl|-Frag\d+(?:\.part)?)?$/i.test(basename(path));
    if (!ownedDownload && !oldTemporary) continue;
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || oldTemporary && now - info.mtimeMs < 24 * 3600_000) continue;
    if (ownedDownload && now - Math.max(info.mtimeMs, lastSourceUse.get(hash!) ?? 0) < recentDownloadRetentionMs) continue;
    if (ownedDownload && protectedHashes.has(hash!) && (inside(libraryFiles, normalized(path))
      || !protectedIdentities.has(`${info.dev}:${info.ino}`) && !protectedCopies.has(`${hash}:${extname(path).toLowerCase()}:${info.size}`))) continue;
    files.push({ path, bytes: info.size, mtimeMs: info.mtimeMs, identity: `${info.dev}:${info.ino}`, links: info.nlink });
  }
  const physical = new Map<string, { count: number; bytes: number; links: number }>();
  for (const file of files) {
    const entry = physical.get(file.identity) ?? { count: 0, bytes: file.bytes, links: file.links };
    entry.count++; physical.set(file.identity, entry);
  }
  return { roots, files, reclaimableBytes: [...physical.values()].reduce((sum, file) => sum + (file.count >= file.links ? file.bytes : 0), 0) };
}

/** Only call while production/selection is idle, immediately after a fresh plan.
 * Files are individually checked and unlinked; no recursive directory deletion.
 * JSON provenance, paid checkpoints, imports, voice and final renders are never targets.
 */
export async function executeDocumentaryCleanup(plan: DocumentaryCleanupPlan): Promise<{ removed: number; bytes: number }> {
  let removed = 0, bytes = 0;
  for (const file of plan.files) {
    const actual = await realpath(file.path);
    if (!plan.roots.some(root => inside(root, actual))) throw new Error("Путь очистки вышел за пределы хранилища материалов");
    const info = await lstat(file.path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes || info.mtimeMs !== file.mtimeMs || `${info.dev}:${info.ino}` !== file.identity) continue;
    await unlink(file.path); removed++;
    if (info.nlink === 1) bytes += info.size;
  }
  return { removed, bytes };
}
