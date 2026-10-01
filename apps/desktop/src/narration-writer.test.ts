import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { countNarrationCharacters, type NarrationDraftCheckpoint, type ReferenceAnalysis } from "@gold-work/shared";
import { applyEditorialEdit, narrationDraftFingerprint, writeNarrationFirst } from "./narration-writer.js";
import { splitReadyScriptNarration } from "./ready-script.js";

test("редактор применяет точные непересекающиеся правки атомарно и сохраняет остальной текст", () => {
  const original = ["Работа 50 минут, дорога 35 минут. Всего 90 минут.", "Этот заказ отдельный."];
  const edit = { accepted: true, notes: [], replacements: [], patches: [
    { section: 1, find: "50 минут", replace: "40 минут" },
    { section: 1, find: "35 минут", replace: "50 минут" }
  ] };
  assert.deepEqual(applyEditorialEdit(original, edit), ["Работа 40 минут, дорога 50 минут. Всего 90 минут.", original[1]]);
  assert.throws(() => applyEditorialEdit(original, { ...edit, patches: [...edit.patches, { section: 3, find: "x", replace: "y" }] }), /вне диапазона 1–2/);
  assert.throws(() => applyEditorialEdit(original, { ...edit, patches: [{ section: 1, find: "минут", replace: "часов" }] }), /однозначно/);
  assert.throws(() => applyEditorialEdit(original, { ...edit, patches: [...edit.patches, { section: 1, find: "Работа 50 минут", replace: "Отдых" }] }), /пересекающиеся/);
  assert.equal(original[0], "Работа 50 минут, дорога 35 минут. Всего 90 минут.");
  assert.deepEqual(applyEditorialEdit(["Условие: работа  50 минут."], { accepted: true, notes: [], replacements: [],
    patches: [{ section: 1, find: "Работа 50 минут", replace: "работа 40 минут" }] }), ["Условие: работа 40 минут."]);
  assert.throws(() => applyEditorialEdit(["Работа 50 минут. работа  50 минут."], { accepted: true, notes: [], replacements: [],
    patches: [{ section: 1, find: "Работа 50 минут", replace: "работа 40 минут" }] }), /однозначно/);
});

test("неверный ответ редактора сохраняется вместе с исходным длинным черновиком; продолжение не пишет его заново", async () => {
  const analysis = { suggestedTitle: "Пример", suggestedAngle: "Причина", language: "ru", instructions: "Исходное условие, которого нет в кратком плане" } as ReferenceAnalysis;
  const paragraphs = ["Герой замечает ошибку в расписании.", "Он исправляет время и успевает к поезду."];
  const timing = { targetSeconds: 60, charactersPerSecond: countNarrationCharacters(paragraphs.join("\n\n")) / 60, wordsPerMinute: 100, targetWordCount: 100, targetCharacterCount: 100 };
  let saved: NarrationDraftCheckpoint = { version: 1, contextFingerprint: narrationDraftFingerprint(analysis, timing),
    plan: { title: "Пример", promise: "Успеть", tone: "Рассказ", writingBrief: "Найти ошибку", visualBible: "Герой",
      narrator: "Наблюдатель", requiredBeats: [], continuityRules: [], endingResolution: "Успел", sectionWeights: [1, 1],
      sections: paragraphs.map((_, i) => ({ title: String(i), goal: "Событие", keyPoints: [], transition: "Далее" })) },
    sections: paragraphs, visuals: [] };
  let calls = 0;
  const run = () => writeNarrationFirst({ analysis, timing, state: saved, save: async state => { saved = state; }, complete: async messages => {
    calls++;
    assert.match(messages[0]!.content, /выпускающий редактор/);
    assert.equal(JSON.parse(messages[1]!.content).originalBrief, analysis.instructions);
    return calls === 1 ? '{"accepted":true,"notes":[],"replacements":[{"section":3,"narration":"плохой индекс"}]}'
      : '{"accepted":true,"notes":[],"patches":[],"replacements":[]}';
  } });
  await assert.rejects(run(), /номер раздела 3 вне диапазона 1–2/);
  assert.match(saved.editorialResponse!, /плохой индекс/);
  assert.deepEqual(saved.sections, paragraphs);
  assert.equal(saved.editorial?.accepted, false);
  const final = await run();
  assert.equal(calls, 2);
  assert.equal(final.editorial?.accepted, true);

  saved.editorial = { accepted: false, notes: [] };
  let lengthCalls = 0;
  const expanded = await writeNarrationFirst({ analysis, timing, state: saved, save: async state => { saved = state; },
    complete: async messages => {
      lengthCalls++;
      if (lengthCalls === 2) {
        const task = JSON.parse(messages[1]!.content).focusedRevision;
        assert.equal(task.section, 1);
        assert.equal(task.action, "расширить");
        assert.equal(task.targetSectionCharacters, countNarrationCharacters(paragraphs[0]!));
      }
      return JSON.stringify({ accepted: true, notes: [], replacements: [{ section: 1, narration: lengthCalls === 1 ? "Герой." : paragraphs[0] }] });
    } });
  assert.equal(lengthCalls, 2);
  assert.deepEqual(expanded.sections, paragraphs);
  assert.equal(expanded.editorial?.accepted, true);

  saved.editorial = { accepted: false, notes: ["Осталась авторская ошибка"] };
  saved.editorialCorrectionAttempted = false;
  let corrections = 0;
  const failedCorrection = () => writeNarrationFirst({ analysis, timing, state: saved, save: async state => { saved = state; },
    complete: async () => { corrections++; return '{"accepted":false,"notes":["Нужен проверяемый факт"],"replacements":[]}'; } });
  await assert.rejects(failedCorrection(), /Нужен проверяемый факт/);
  assert.equal(corrections, 2, "one review plus at most one automatic correction");
  assert.equal(saved.editorialCorrectionAttempted, true);
  await assert.rejects(failedCorrection(), /Нужен проверяемый факт/);
  assert.equal(corrections, 3, "manual continuation does not restart the automatic correction loop");
});

test("двадцатиминутный готовый текст не растягивает короткие реплики до девяти секунд", async () => {
  const script = await readFile(new URL("../scripts/fixtures/ready-story-maksim-long.txt", import.meta.url), "utf8");
  const speed = 12.789;
  const chunks = splitReadyScriptNarration(script, { charactersPerSecond: speed }, 5);
  assert.equal(chunks.map(chunk => chunk.narration).join(""), script);
  assert.ok(chunks.length > 200);
  for (const chunk of chunks) {
    const excess = chunk.durationSeconds - countNarrationCharacters(chunk.narration) / speed;
    assert.ok(excess < 0.1, `Лишняя пауза ${excess}: ${chunk.narration.slice(0, 50)}`);
    assert.ok(chunk.durationSeconds <= 9);
  }
  assert.ok(Math.abs(chunks.reduce((sum, chunk) => sum + chunk.durationSeconds, 0) - countNarrationCharacters(script) / speed) < 0.002);
});
