import assert from "node:assert/strict";
import test from "node:test";
import type { Scene } from "@gold-work/shared";
import { applyAutomaticMontageGrammar } from "./anymodel-client.js";

function scene(order: number, stockQuery: string, patch: Partial<Scene> = {}): Scene {
  return {
    id: `scene-${order}`,
    order,
    title: `Сцена ${order + 1}`,
    narration: `Законченная реплика сцены номер ${order + 1}.`,
    imagePrompt: stockQuery,
    stockQuery,
    animationPrompt: "Slow camera movement",
    durationSeconds: 8,
    status: "draft",
    ...patch
  };
}

test("автомонтаж: хук ускоряется, улики приближаются, акты разделяются, ручные настройки сохраняются", () => {
  const scenes = [
    scene(0, "police car arriving"),
    scene(1, "old key evidence"),
    scene(2, "empty motel room"),
    scene(3, "detective walking corridor"),
    scene(4, "printed receipt"),
    scene(5, "warehouse exterior"),
    scene(6, "police opening door", { transition: "mix", transitionDurationSeconds: 0.7, kenBurnsDirection: "off" }),
    scene(7, "security camera record"),
    scene(8, "city street night")
  ];

  const result = applyAutomaticMontageGrammar(scenes);
  assert.equal(result[0]?.autoTransition, "none", "первые кадры хука получают быстрые склейки");
  assert.equal(result[1]?.autoKenBurnsDirection, "in", "улика показывается приближением");
  assert.equal(result[2]?.autoTransition, "fade", "граница первого акта отделяется коротким fade");
  assert.equal(result[2]?.autoTransitionDurationSeconds, 0.17, "fade остаётся быстрым");
  assert.equal(result[2]?.autoKenBurnsDirection, "out", "локация раскрывается отдалением");
  assert.equal(result[5]?.autoTransition, "fade", "граница второго акта тоже отделена");
  assert.equal(result[4]?.autoTransitionDurationSeconds, 0.16, "mix не затягивает смену кадра");
  assert.equal(result[6]?.transition, "mix", "ручной переход не перезаписывается");
  assert.equal(result[6]?.transitionDurationSeconds, 0.7);
  assert.equal(result[6]?.kenBurnsDirection, "off", "ручное движение не перезаписывается");
  assert.equal(result.at(-1)?.autoTransition, "none", "после последней сцены переход не нужен");
  assert.equal(scenes[0]?.transition, undefined, "исходный массив не мутируется");
});
