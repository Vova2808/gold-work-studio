import assert from "node:assert/strict";
import test from "node:test";
import { scenarioFrameProgress, scenarioProgressTopic } from "../../renderer/src/scenario-progress.js";

test("concurrent preparation progress stays with its project, including portrait jobs and unknown events", () => {
  const builds = { a: { running: true, projectId: "one" }, b: { running: true, projectId: "two" } };
  assert.equal(scenarioProgressTopic(builds, { topicId: "a" }), "a");
  assert.equal(scenarioProgressTopic(builds, { projectId: "two" }), "b");
  assert.equal(scenarioProgressTopic(builds), undefined);
  assert.equal(scenarioProgressTopic(builds, { projectId: "unrelated" }), undefined);
  builds.a.running = false;
  assert.equal(scenarioProgressTopic(builds, { topicId: "a" }), undefined);
  assert.equal(scenarioProgressTopic(builds), "b");
});

test("scenario UI progress counts completed frames, not the end of an upcoming batch", () => {
  assert.deepEqual(scenarioFrameProgress("Разбиваю готовый текст по скорости голоса: 156 кадров"), { done: 0, total: 156 });
  assert.deepEqual(scenarioFrameProgress("Создаю промпты для кадров 1–12 из 156"), { done: 0, total: 156 });
  assert.deepEqual(scenarioFrameProgress("Создаю промпты для кадров 121–132 из 156"), { done: 120, total: 156 });
  assert.deepEqual(scenarioFrameProgress("Готовы промпты: 132 из 156 кадров"), { done: 132, total: 156 });
  assert.equal(scenarioFrameProgress("Пишу раздел 2 из 10"), undefined);
  assert.equal(scenarioFrameProgress("Размечаю монтаж, не меняя текст озвучки…"), undefined);
});
