/** Bounded, user-authorized text-only acceptance. Never submits TTS/images or updates provider settings. */
import assert from "node:assert/strict";
import { app } from "electron";
import { copyFileSync, mkdtempSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { countNarrationCharacters, createNarrationTimingBudget, type Project, type ReferenceAnalysis, type NarrationDraftCheckpoint } from "@gold-work/shared";
import { AnyModelClient } from "../src/anymodel-client.js";
import { AnyModelStore } from "../src/anymodel-store.js";
import { proxyFetch } from "../src/proxy-utils.js";
import { narrationDraftFingerprint, writeNarrationFirst } from "../src/narration-writer.js";
import { splitReadyScriptNarration } from "../src/ready-script.js";

const data = join(process.env.APPDATA!, "@gold-work", "desktop");
const profile = mkdtempSync(join(tmpdir(), "gws-narration-quality-"));
copyFileSync(join(data, "Local State"), join(profile, "Local State"));
app.setPath("userData", profile);
app.on("window-all-closed", () => undefined);
const mode = process.argv.includes("--repair-text") ? "repair" : process.argv.includes("--history-text") ? "history" : "new";
const resumeArgument = process.argv.indexOf("--edit-checkpoint");
const output = resolve("captures", "narration-quality", `${Date.now()}-${mode}`);
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(new Error("Text check deadline")), 25 * 60_000);
let submissions = 0;
const maxSubmissions = mode === "repair" || resumeArgument >= 0 ? 2 : mode === "history" ? 4 : 13;

app.whenReady().then(async () => {
  await mkdir(output, { recursive: true });
  console.log(`[quality] ${mode}: ${output}`);
  const projects: Project[] = JSON.parse(await readFile(join(data, "projects.json"), "utf8"));
  const calibration = projects.find(project => project.id === "project_mtt2h2px_5li701i")?.settings.voice.calibration;
  assert.ok(calibration?.charactersPerSecond, "Existing real voice calibration is required");
  const master = await readFile(resolve("../../prompts/maksim-channel-master.txt"), "utf8");
  const video = await readFile(resolve("../../prompts/maksim-20min-video.txt"), "utf8");
  const history = "Канал спокойных, но увлекательных вымышленных историй о жизни людей прошлого. Русский язык, рассказчик наблюдатель. Это исторически правдоподобный вымысел, не документальная реконструкция и не пересказ финансового канала. Один раз обозначь вымысел при введении, затем рассказывай через решения, действия и последствия. Не выдумывай цитаты реальных людей и точные исторические даты. Без списков советов, морали после каждого события и призывов подписаться. Визуал: реалистичная живописная иллюстрация; внешность героев постоянна.\nЗадание: небольшой условный речной посёлок начала XX века. Подросток Павел учится у своей тёти Веры чинить рыбацкие сети. Весенний подъём воды угрожает запасу сухих дров на нижнем берегу. Павел хочет сразу унести всё один, но плотина из веток у ручья мешает отводу воды. Он должен сам заметить причину по тому, как меняется течение, попросить помощи и выбрать, что спасать первым. Не добавляй внезапного злодея, тайник с золотом и чудесное спасение. Тётя не знает причину заранее; она учит наблюдать, а не предсказывает события. В начале покажи конкретную неприятность; дальше — ошибочный первый подход, его последствие, наблюдение и совместное действие. Финал: часть дров намокла, сухой запас перенесён, ручей течёт свободнее; герои всё ещё должны просушить мокрое, но непосредственная угроза закрыта. Эпоха раскрывается через предметы и работу, без лекции. Цель 5 минут.";
  const seed = { suggestedTitle: mode === "history" ? "Павел и весенняя вода" : "Почему много заказов ещё не означает хороший заработок",
    suggestedAngle: mode === "history" ? "Решение через наблюдение и совместное действие" : "Остаток за час и реальное время работы",
    language: "Русский", targetAudience: "Взрослые зрители", instructions: mode === "history" ? history : `MASTER PROMPT:\n${master}\nVIDEO PROMPT:\n${video}`,
    scenes: [], provider: "anymodel-live", sourceUrl: "qa://narration-quality", sourceTitle: "Проверка сценариста", niche: mode === "history" ? "Вымышленная история" : "Бытовая экономика", hook: "", structure: [], strengths: [], improvements: [], recommendedDurationSeconds: mode === "history" ? 300 : 1200 } satisfies ReferenceAnalysis;
  const timing = createNarrationTimingBudget(calibration, mode === "history" ? 300 : 1200);
  let state: NarrationDraftCheckpoint | undefined;
  if (mode === "repair") {
    state = JSON.parse(await readFile(resolve("captures/long-story-live/1788970718595-generated/narration.json"), "utf8"));
    state!.contextFingerprint = narrationDraftFingerprint(seed, timing);
    state!.visuals = [];
    state!.editorial = { accepted: false, notes: [] };
    await writeFile(join(output, "before.txt"), state!.sections.join("\n\n"));
  }
  if (resumeArgument >= 0) {
    state = JSON.parse(await readFile(resolve(process.argv[resumeArgument + 1]!), "utf8"));
    assert.equal(state!.contextFingerprint, narrationDraftFingerprint(seed, timing), "Only the same brief/voice may resume");
    state!.editorial = { accepted: false, notes: state!.editorial?.notes ?? [] };
    await writeFile(join(output, "before.txt"), state!.sections.join("\n\n"));
  }
  await writeFile(join(output, "input.json"), JSON.stringify({ seed, timing, mode, maxSubmissions }, null, 2));
  const transport: typeof proxyFetch = async (input, init = {}, proxy) => {
    if (init.method?.toUpperCase() === "POST") {
      assert.match(new URL(input instanceof Request ? input.url : input.toString()).pathname, /\/chat\/completions$/);
      assert.ok(submissions < maxSubmissions, "Paid request cap reached");
      const body = JSON.parse(String(init.body));
      console.log(`[quality] request ${++submissions}/${maxSubmissions}, model=${body.model}`);
    }
    return proxyFetch(input, init, proxy);
  };
  const store = new AnyModelStore(join(data, "credentials", "anymodel.json"));
  const client = new AnyModelClient(store, transport);
  const { textModel } = await store.publicSettings();
  const chat = client as unknown as { chat: (model: string, messages: Array<{ role: string; content: string }>, tokens: number, effort: string, signal: AbortSignal, timeout: number) => Promise<string> };
  const draft = await client.withTextModelFallback(() => writeNarrationFirst({ analysis: seed, timing, state,
    signal: controller.signal, stage: message => console.log(`[quality] ${message}`),
    save: async checkpoint => {
      await writeFile(join(output, "narration.json"), JSON.stringify(checkpoint, null, 2));
      await writeFile(join(output, "narration.txt"), checkpoint.sections.join("\n\n"));
    }, complete: async (messages, tokens, effort = "medium") => {
      const response = await chat.chat(textModel, messages, tokens, effort, controller.signal, 180_000);
      await writeFile(join(output, `response-${submissions}.txt`), response);
      return response;
    }
  }), change => console.log(`[quality] ${change.message}`));
  const narration = draft.sections.join("\n\n");
  const scenes = splitReadyScriptNarration(narration, calibration, 5);
  assert.equal(scenes.map(scene => scene.narration).join(""), narration);
  assert.ok(scenes.every(scene => scene.durationSeconds <= 9));
  const result = { mode, submissions, model: textModel, characters: countNarrationCharacters(narration),
    estimatedSeconds: countNarrationCharacters(narration) / calibration.charactersPerSecond, sections: draft.sections.length,
    frames: scenes.length, maximumFrameSeconds: Math.max(...scenes.map(scene => scene.durationSeconds)), editorial: draft.editorial };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(`[quality] PASS ${JSON.stringify(result)}`);
}).catch(async error => {
  const message = String(error instanceof Error ? `${error.name}: ${error.message}` : error).replace(/(?:https?|socks5h?):\/\/[^\s]+/gi, "[URL]").slice(0, 1500);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "failure.json"), JSON.stringify({ mode, submissions, error: message }, null, 2));
  console.error(`[quality] STOP ${message}`);
  process.exitCode = 1;
}).finally(() => { clearTimeout(deadline); app.exit(process.exitCode ?? 0); });
