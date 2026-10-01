import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Project } from "@gold-work/shared";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { RemotionMontageRenderer } from "../src/remotion-montage-renderer.js";
import { StandardRenderer, mediaDurationSeconds } from "../src/standard-renderer.js";

const inputPath = process.env.GW_PROJECT_JSON?.trim();
if (!inputPath) throw new Error("Укажите GW_PROJECT_JSON — путь к project.json готового проекта");
const requestedScenes = Math.max(1, Math.min(50, Number(process.env.GW_SMOKE_SCENES) || 4));
const raw = JSON.parse(await readFile(inputPath, "utf8")) as Project;
const sourceScenes = raw.scenes
  .filter((scene) => scene.includeInAssembly !== false)
  .sort((left, right) => left.order - right.order)
  .slice(0, requestedScenes);
assert.ok(sourceScenes.length > 0, "В project.json нет включённых сцен");

const root = await mkdtemp(join(tmpdir(), "gold-work-real-project-remotion-"));
try {
  const project: Project = {
    ...raw,
    id: `remotion-real-smoke-${Date.now()}`,
    title: `${raw.title} · Remotion smoke`,
    status: "ready",
    outputPath: undefined,
    scenes: sourceScenes.map((scene, order) => ({ ...scene, order, includeInAssembly: true })),
    settings: {
      ...raw.settings,
      music: { ...raw.settings.music, enabled: false },
      assembly: {
        ...raw.settings.assembly,
        montage: {
          enabled: true,
          planner: "local",
          density: "dynamic",
          graphicBeatPercent: 30,
          hardCutPercent: 78
        }
      }
    }
  };
  const storage = new LocalProjectStorage(join(root, "projects"));
  const events: string[] = [];
  const sink = (_level: "info" | "warn" | "error", message: string) => events.push(message);
  const renderer = new StandardRenderer(
    storage,
    new RemotionMontageRenderer((projectId) => storage.projectDirectory(projectId), { eventSink: sink }),
    sink
  );
  const output = await renderer.render(project, (stage, progress) => {
    if (progress % 10 <= 1 || progress >= 98) console.log(`[${progress}%] ${stage}`);
  });
  assert.ok((await stat(output)).size > 100_000);
  assert.ok(await mediaDurationSeconds(output) > 3);
  assert.ok(events.includes("render.remotion.completed"));
  assert.ok(!events.includes("render.remotion.fallback"));

  const captureDirectory = resolve(process.cwd(), "..", "..", "captures", "remotion-real-project");
  await mkdir(captureDirectory, { recursive: true });
  const captured = join(captureDirectory, `Final-${sourceScenes.length}-scenes.mp4`);
  await copyFile(output, captured);
  console.log(`[remotion-project-smoke] OK ${basename(inputPath)} → ${captured}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
