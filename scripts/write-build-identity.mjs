import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const createdAt = new Date().toISOString();
let revision = "nogit";
let dirty = false;

try {
  revision = execFileSync("git", ["rev-parse", "--short=10", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim() || revision;
  dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim().length > 0;
} catch {
  // Архивная/portable-сборка может не содержать .git. Время всё равно делает id уникальным.
}

const stamp = createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const buildId = `${stamp}-${revision}${dirty ? "-dirty" : ""}`;
const source = [
  "// Этот файл создаётся scripts/write-build-identity.mjs перед общим dev/build.",
  `export const APP_BUILD_ID = ${JSON.stringify(buildId)};`,
  `export const APP_BUILD_CREATED_AT = ${JSON.stringify(createdAt)};`,
  "",
].join("\n");

for (const relativePath of [
  "apps/desktop/src/generated-build-identity.ts",
  "apps/renderer/src/generated-build-identity.ts",
]) {
  const target = resolve(repositoryRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source, "utf8");
}

console.log(`[build-identity] ${buildId}`);
