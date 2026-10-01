import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Project } from "@gold-work/shared";
import { documentaryVideoCoverage } from "@gold-work/shared";
import { scanWorkspaceUsage } from "../src/workspace-usage.js";
import { planDocumentaryCleanup } from "../src/documentary-cleanup.js";

const workspace = process.argv[2], id = process.argv[3];
if (!workspace || !id?.startsWith("project_")) throw new Error("Usage: tsx scripts/stock-storage-audit.ts <workspace> <project-id>");
const profile = "C:/Users/rosup/AppData/Roaming/@gold-work/desktop";
const projects: Project[] = JSON.parse(await readFile(join(profile, "projects.json"), "utf8"));
const project = projects.find(project => project.id === id); if (!project) throw new Error("Project not found");
const trash = await readFile(join(profile, "projects.json.trash"), "utf8").then(JSON.parse, error => { if (error.code === "ENOENT") return []; throw error; });
const usage = await scanWorkspaceUsage(workspace, `projects/${id}`);
const cleanup = await planDocumentaryCleanup({ materialRoot: join(workspace, "Materials"), projects: [...projects, ...trash.map((entry: { project: Project }) => entry.project)], projectDirectory: id => join(workspace, "projects", id) });
const paths = [...new Set(project.scenes.flatMap(scene => [scene.videoPath, scene.imagePath, scene.audioPath, scene.documentary?.selected?.localPath]).filter((path): path is string => Boolean(path)))];
const missing = [], identities = new Map<string, number>();
for (const path of paths) {
  const info = await stat(path).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
  if (!info) missing.push(path); else identities.set(`${info.dev}:${info.ino}`, info.size);
}
const result = { at: new Date().toISOString(), projectId: id, status: project.status, coverage: documentaryVideoCoverage(project.scenes), excerpts: project.scenes.filter(scene => scene.documentary?.selected?.excerpt).length,
  activeMediaBytes: [...identities.values()].reduce((sum, size) => sum + size, 0), missing, usage,
  cleanupPreview: { files: cleanup.files.length, logicalBytes: cleanup.files.reduce((sum, file) => sum + file.bytes, 0), reclaimableBytes: cleanup.reclaimableBytes } };
const out = resolve("captures/stock-storage-20260926"); await mkdir(out, { recursive: true });
await writeFile(join(out, `${id}-${Date.now()}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, usage: { ...usage, entries: usage.entries.slice(0, 10) } }, null, 2));
