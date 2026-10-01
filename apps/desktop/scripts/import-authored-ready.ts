/** Add only the explicitly requested authored demo. Run while the desktop app is closed. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createId } from "@gold-work/core";
import { projectScenarioQualityIssue, scenarioQualityFingerprint, type Project, type ReferenceAnalysis, type Scene } from "@gold-work/shared";
import { FileProjectRepository } from "../src/file-project-repository.js";
import { LocalProjectStorage } from "../src/local-project-storage.js";

const dataPath = join(process.env.APPDATA!, "@gold-work", "desktop");
assert.ok(process.env.GW_READY_RESULT, "Choose the verified ready-script result");
const verified = JSON.parse(await readFile(process.env.GW_READY_RESULT, "utf8")) as {
  sourceCalibrationProject: string; originalScript: string; result: ReferenceAnalysis;
};
assert.equal(verified.result.scenes.map(scene => scene.narration).join(""), verified.originalScript);
assert.ok(verified.result.scenes.every(scene => scene.durationSeconds <= 9 && scene.imagePrompt && scene.animationPrompt));
const path = join(dataPath, "projects.json");
const before: Project[] = JSON.parse(await readFile(path, "utf8"));
assert.ok(Array.isArray(before));
const source = before.find(project => project.id === verified.sourceCalibrationProject)!;
assert.ok(source?.settings.voice.calibration, "Use the existing real calibration, never fabricate TTS");
const title = "ТЕСТ · Максим — занятость и заработок (готовый сценарий)";
const existing = before.find(project => project.title === title && project.videoBrief?.readyScript === verified.originalScript);
if (existing) {
  console.log(JSON.stringify({ alreadyImported: true, projectId: existing.id, title }));
} else {
  const id = createId("project");
  const scenes: Scene[] = verified.result.scenes.map((scene, order) => ({ ...scene, id: createId("scene"), order,
    status: "draft", imagePath: undefined, audioPath: undefined, videoPath: undefined, narrationSlice: undefined }));
  const duration = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const project: Project = { ...structuredClone(source), id, title, topic: "Почему три заказа не всегда выгоднее одного",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "ready", scenes,
    chatTopicId: undefined, outputPath: undefined, lastRender: undefined,
    videoBrief: { ...source.videoBrief!, creationMode: "script", readyScript: verified.originalScript,
      prompt: "Не менять готовый текст. Максим объясняет условный пример денег после расходов и затраченного времени; простой AI Story без инфографики и коллажей.", competitorTranscripts: [] },
    settings: { ...structuredClone(source.settings), durationMinutes: duration / 60,
      video: { ...structuredClone(source.settings.video), enabled: false } },
    referenceAnalysis: { ...verified.result, scenes, scenarioQuality: { ...verified.result.scenarioQuality!,
      fingerprint: scenarioQualityFingerprint(scenes) } }, montagePlan: verified.result.montagePlan };
  assert.equal(projectScenarioQualityIssue(project), undefined);
  const storage = new LocalProjectStorage(join(dataPath, "workspace", "projects"));
  await storage.ensureProject(project);
  await new FileProjectRepository(path).save(project);
  const after: Project[] = JSON.parse(await readFile(path, "utf8"));
  for (const original of before) assert.deepEqual(after.find(item => item.id === original.id), original, "Existing projects must be untouched");
  assert.equal(after.find(item => item.id === id)?.scenes.length, 30);
  console.log(JSON.stringify({ projectId: id, title, scenes: scenes.length, durationSeconds: duration,
    originalProjectsUnchanged: true, copiedExistingVoiceCalibration: true, newTtsRequested: false }));
}
