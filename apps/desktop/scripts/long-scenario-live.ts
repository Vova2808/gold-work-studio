/** Explicit user-requested 20-minute comparison. Text-only, bounded, checkpointed. */
import assert from "node:assert/strict";
import {app} from "electron";
import {copyFileSync, mkdtempSync} from "node:fs";
import {readFile, mkdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {countNarrationCharacters, createNarrationTimingBudget, voiceCalibrationMatches, type Project, type Scene, type NarrationDraftCheckpoint, type ReferenceAnalysis} from "@gold-work/shared";
import {AnyModelStore} from "../src/anymodel-store.js";
import {AnyModelClient, inspectGeneratedScenarioReadiness} from "../src/anymodel-client.js";
import {proxyFetch} from "../src/proxy-utils.js";

const dataPath = join(process.env.APPDATA!, "@gold-work", "desktop");
const temporaryProfile = mkdtempSync(join(tmpdir(), "gws-long-story-"));
copyFileSync(join(dataPath, "Local State"), join(temporaryProfile, "Local State"));
app.setPath("userData", temporaryProfile);
app.on("window-all-closed", () => undefined);
const mode = process.argv.includes("--authored") ? "authored" : "generated";
const output = resolve("captures", "long-story-live", `${Date.now()}-${mode}`);
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(new Error("45-minute live-check deadline")), 45 * 60_000);
const maxSubmissions = mode === "generated" ? 48 : 32;
let submissions = 0;
let checkpoint: Scene[] = [];
const clean = (error: unknown) => String(error instanceof Error ? `${error.name}: ${error.message}` : error)
  .replace(/(?:https?|socks5h?):\/\/[^\s]+/gi, "[URL]").slice(0, 1200);

app.whenReady().then(async () => {
  await mkdir(output, {recursive: true});
  console.log(`[long-story] ${mode} artifacts: ${output}`);
  const projects: Project[] = JSON.parse(await readFile(join(dataPath, "projects.json"), "utf8"));
  const project = projects.find(item => item.id === "project_mtt2h2px_5li701i")!;
  const calibration = project?.settings.voice.calibration;
  assert.ok(voiceCalibrationMatches(calibration, project.settings.voice.provider, project.settings.voice.voice, project.language));
  const masterPrompt = await readFile(resolve("scripts/fixtures/long-story-master.txt"), "utf8");
  const videoPrompt = await readFile(resolve("scripts/fixtures/long-story-video.txt"), "utf8");
  const seed: ReferenceAnalysis = {sourceUrl: "qa://long-story", sourceTitle: "Длинный ролик — проверка двух путей", niche: "Бытовая экономика",
    targetAudience: "Взрослые зрители объясняющего рисованного канала", hook: "Телефон не умолкает, а денег и свободного времени меньше",
    structure: [], strengths: [], improvements: [], suggestedTitle: "Почему много заказов ещё не означает хороший заработок",
    suggestedAngle: "Условные примеры, скрытое время, цена услуги и ограниченный опыт без обещаний дохода",
    recommendedDurationSeconds: 1200, language: project.language, scenes: [], provider: "live-long-story",
    instructions: `MASTER PROMPT КАНАЛА:\n${masterPrompt}\n\nЗАДАНИЕ РОЛИКА:\n${videoPrompt}`};
  await writeFile(join(output, "input.json"), JSON.stringify({sourceCalibrationProject: project.id, mode, masterPrompt, videoPrompt, seed,
    targetSeconds: 1200, charactersPerSecond: calibration.charactersPerSecond, maxSubmissions}, null, 2));
  const transport: typeof proxyFetch = async (input, init = {}, proxy) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (init.method?.toUpperCase() === "POST") {
      assert.match(url.pathname, /\/chat\/completions$/u);
      assert.ok(submissions < maxSubmissions, "Live request cap reached; no further request sent");
      const request = JSON.parse(String(init.body));
      submissions++;
      console.log(`[long-story] request ${submissions}/${maxSubmissions}, model=${request.model}, budget=${request.max_tokens}`);
    }
    return proxyFetch(input, init, proxy);
  };
  const client = new AnyModelClient(new AnyModelStore(join(dataPath, "credentials", "anymodel.json")), transport);
  // Capture completed text only: useful for malformed editorial responses, no credentials/headers.
  const diagnostic = client as unknown as {chat: (...args: unknown[]) => Promise<string>};
  const chat = diagnostic.chat.bind(client);
  let completed = 0;
  diagnostic.chat = async (...args) => {
    const content = await chat(...args);
    await writeFile(join(output, `response-${String(++completed).padStart(3, "0")}.txt`), content);
    return content;
  };
  const progress = (_done: number, _total: number, stage?: string) => {if (stage) console.log(`[long-story] ${stage}`);};
  const saveScenes = async (scenes: Scene[]) => {checkpoint = scenes; await writeFile(join(output, "scenes.json"), JSON.stringify(scenes, null, 2));};
  const saved: NarrationDraftCheckpoint | undefined = process.env.GW_LONG_CHECKPOINT
    ? JSON.parse(await readFile(process.env.GW_LONG_CHECKPOINT, "utf8")) : undefined;
  let originalScript: string | undefined;
  if (mode === "authored") originalScript = await readFile(resolve("scripts/fixtures/ready-story-maksim-long.txt"), "utf8");
  const result = await client.withTextModelFallback(() => mode === "authored"
    ? client.prepareReadyScript(seed, originalScript!, calibration, progress, undefined, controller.signal, "local", saveScenes, 5)
    : client.regenerateScenes(seed, 1200, progress, undefined, controller.signal, "local", saveScenes,
      createNarrationTimingBudget(calibration, 1200), undefined, "ai-story", {narrationState: saved,
        onNarrationCheckpoint: async state => {
          await writeFile(join(output, "narration.json"), JSON.stringify(state, null, 2));
          await writeFile(join(output, "narration.txt"), state.sections.join("\n\n"));
          console.log(`[long-story] saved text: ${state.sections.length}/${state.plan.sections.length}, chars=${countNarrationCharacters(state.sections.join("\n\n"))}`);
        }}), change => console.log(`[long-story] ${change.message}`));
  const narration = result.scenes.map(scene => scene.narration).join("");
  if (originalScript !== undefined) assert.equal(narration, originalScript, "Ready narration must remain byte-exact");
  assert.ok(result.scenes.every(scene => scene.durationSeconds > 0 && scene.durationSeconds <= 9 && scene.imagePrompt.trim() && scene.animationPrompt.trim()));
  const readiness = inspectGeneratedScenarioReadiness(result.scenes, 1200, createNarrationTimingBudget(calibration, 1200));
  assert.ok(readiness.ok, JSON.stringify(readiness));
  await writeFile(join(output, "result.json"), JSON.stringify({sourceCalibrationProject: project.id, mode, masterPrompt, videoPrompt, originalScript,
    submissions, targetSeconds: 1200, estimatedSeconds: countNarrationCharacters(narration) / calibration.charactersPerSecond, result}, null, 2));
  await writeFile(join(output, "narration.txt"), narration);
  console.log(`[long-story] PASS ${result.scenes.length} frames; ${output}`);
}).catch(async error => {
  await mkdir(output, {recursive: true});
  await writeFile(join(output, "failure.json"), JSON.stringify({mode, submissions, checkpointScenes: checkpoint.length, error: clean(error)}, null, 2));
  console.error(`[long-story] STOP; no automatic restart: ${clean(error)}; ${output}`);
  process.exitCode = 1;
}).finally(() => {clearTimeout(deadline); app.exit(process.exitCode ?? 0);});
