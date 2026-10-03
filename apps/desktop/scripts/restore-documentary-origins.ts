import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocumentaryCandidate } from "@gold-work/shared";
import { atomicWrite } from "../src/fs-utils.js";

// Legacy versions overwrote download provenance with local:<hash>. Repair only
// from an existing download sidecar, never infer ownership from a remote URL.
// --apply is maintenance-only: close GoldWork first. Media/registry are untouched.
const workspace = process.argv[2]; if (!workspace) throw new Error("Provide workspace path");
const apply = process.argv.includes("--apply"), catalog = join(workspace, "Materials", "Catalog");
const downloaded = new Set(["youtube", "commons", "internet-archive", "loc", "pexels", "pixabay", "web"]);
const pending = new Map<string, DocumentaryCandidate>(), origins = new Map<string, DocumentaryCandidate>(), imports = new Set<string>();
for (const file of await readdir(catalog)) if (/^[a-f0-9]{64}\.json$/.test(file)) {
  const source: DocumentaryCandidate = JSON.parse(await readFile(join(catalog, file), "utf8")), hash = file.slice(0, -5);
  if (source.provider === "local" && source.id === `local:${hash}`) pending.set(hash, source);
}
async function walk(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && !["Backups", "Plans", "Analysis", "VideoCatalog", "RenderCache"].includes(entry.name)) await walk(join(root, entry.name));
    else if (entry.isFile() && /^[a-f0-9]{64}\.source\.json$/.test(entry.name)) {
      const hash = entry.name.slice(0, 64); if (!pending.has(hash)) continue;
      const source: DocumentaryCandidate = JSON.parse(await readFile(join(root, entry.name), "utf8"));
      if (source.id.startsWith("manual:")) imports.add(hash);
      else if (downloaded.has(source.provider)) origins.set(hash, source);
    }
  }
}
await walk(join(workspace, "projects"));
const backup = join(workspace, "Materials", "OriginRecovery", String(Date.now()));
let repaired = 0;
for (const [hash, origin] of origins) {
  if (imports.has(hash)) continue;
  const source = pending.get(hash)!;
  if (apply) {
    await mkdir(backup, { recursive: true });
    await atomicWrite(join(backup, `${hash}.json`), JSON.stringify(source, null, 2));
    await atomicWrite(join(catalog, `${hash}.json`), JSON.stringify({ ...source, id: origin.id, provider: origin.provider }, null, 2));
  }
  repaired++;
}
console.log(JSON.stringify({ mode: apply ? "applied" : "read-only", cachedOrigins: pending.size, recoverable: repaired, manualPreserved: imports.size, backup: apply && repaired ? backup : undefined }));
