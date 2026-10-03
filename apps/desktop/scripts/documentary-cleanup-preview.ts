import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Project } from "@gold-work/shared";
import { planDocumentaryCleanup } from "../src/documentary-cleanup.js";
import { LocalProjectStorage } from "../src/local-project-storage.js";

// Read-only audit: never execute a cleanup while the user's app is running.
const profile = process.argv[2];
if (!profile) throw new Error("Usage: tsx scripts/documentary-cleanup-preview.ts <profile-directory>");
const root = resolve(profile);
const projects = JSON.parse(await readFile(join(root, "projects.json"), "utf8")) as Project[];
const trash = await readFile(join(root, "projects.json.trash"), "utf8").then(text => JSON.parse(text) as { project: Project }[], error => {
  if (error.code === "ENOENT") return []; throw error;
});
const storage = new LocalProjectStorage(join(root, "workspace", "projects"));
const plan = await planDocumentaryCleanup({ materialRoot: join(root, "workspace", "Materials"), projects: [...projects, ...trash.map(entry => entry.project)], projectDirectory: id => storage.projectDirectory(id) });
console.log(JSON.stringify({ mode: "read-only", projects: projects.length, trashedProjects: trash.length, candidateFiles: plan.files.length,
  logicalBytes: plan.files.reduce((sum, file) => sum + file.bytes, 0), reclaimableBytes: plan.reclaimableBytes,
  largest: [...plan.files].sort((a, b) => b.bytes - a.bytes).slice(0, 8).map(file => ({ path: file.path, bytes: file.bytes })) }, null, 2));
