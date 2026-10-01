/** Import the two explicitly requested long examples, without rewriting old projects/channels. App must be closed. */
import assert from "node:assert/strict";
import {readFile, mkdir, copyFile, writeFile} from "node:fs/promises";
import {join, dirname, extname} from "node:path";
import {createId} from "@gold-work/core";
import {projectScenarioQualityIssue, scenarioQualityFingerprint, selectCharacterReference, type Project, type ReferenceAnalysis, type ChannelCharacterReference} from "@gold-work/shared";
import {FileProjectRepository} from "../src/file-project-repository.js";
import {LocalProjectStorage} from "../src/local-project-storage.js";
import {ChannelProfileStore} from "../src/channel-profile-store.js";

assert.ok(process.env.GW_LONG_RESULT, "Select a completed and reviewed result");
const artifact = JSON.parse(await readFile(process.env.GW_LONG_RESULT, "utf8")) as {
  sourceCalibrationProject: string; mode: "authored" | "generated"; masterPrompt: string; videoPrompt: string;
  originalScript?: string; result: ReferenceAnalysis;
};
const review = artifact.mode === "generated"
  ? JSON.parse(await readFile(join(process.cwd(), "scripts", "fixtures", "long-generated-editorial-review.json"), "utf8")) as {publishable: boolean; issues: string[]}
  : undefined;
const dataPath = join(process.env.APPDATA!, "@gold-work", "desktop");
const repository = new FileProjectRepository(join(dataPath, "projects.json"));
const profiles = new ChannelProfileStore(join(dataPath, "database", "channel-profiles.json"));
const storage = new LocalProjectStorage(join(dataPath, "workspace", "projects"));
const before = await repository.list();
const beforeChannels = await profiles.list();
const beforeRawChannels = JSON.parse(await readFile(join(dataPath, "database", "channel-profiles.json"), "utf8"));
for (const original of beforeRawChannels) assert.deepEqual(JSON.parse(JSON.stringify(beforeChannels.find(item => item.id === original.id))), original,
  "Import must not silently normalize unrelated old channels");
const source = before.find(project => project.id === artifact.sourceCalibrationProject)!;
assert.ok(source?.settings.voice.calibration);
const sourceChannel = beforeChannels.find(channel => channel.id === source.channelProfileId)!;
assert.ok(sourceChannel);
assert.ok(artifact.result.scenarioQuality?.complete);
if (artifact.mode === "authored") assert.equal(artifact.result.scenes.map(scene => scene.narration).join(""), artifact.originalScript);
const title = artifact.mode === "authored" ? "20 минут · Авторский сценарий · Максим" : "20 минут · AnyModel · Требует редактуры";
const channelName = "ТЕСТ · Длинные AI Story · Максим";
const already = before.find(project => project.title === title && project.referenceAnalysis?.instructions === artifact.result.instructions);
if (already) {
  console.log(JSON.stringify({alreadyImported: true, projectId: already.id, title}));
} else {
  let channel = beforeChannels.find(item => item.name === channelName && item.masterPrompt.trim() === artifact.masterPrompt.trim());
  if (!channel) channel = await profiles.create({name: channelName, countryCode: sourceChannel.countryCode,
    languageCode: sourceChannel.languageCode, languageLabel: sourceChannel.languageLabel, direction: "ai-story",
    masterPrompt: artifact.masterPrompt, defaultDurationMinutes: 20, defaultImageStyle: source.settings.image.style,
    motionTemplate: source.motionTemplate});
  // Reuse only the already confirmed same hero, copying it into this test channel's own library.
  if (!channel.primaryCharacter && source.characterReference) {
    const versionId = createId("character");
    const imagePath = join(storage.channelCharacterDirectory(channel.id), `${versionId}${extname(source.characterReference.imagePath)}`);
    await mkdir(dirname(imagePath), {recursive: true});
    await copyFile(source.characterReference.imagePath, imagePath);
    const hero: ChannelCharacterReference = {...structuredClone(source.characterReference), channelProfileId: channel.id,
      imagePath, versionId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceProjectId: source.id};
    await profiles.addCharacterVersion(channel.id, hero);
    channel = await profiles.confirmCharacterVersion(channel.id, versionId);
  }
  const scenes = artifact.result.scenes.map((scene, order) => ({...scene, id: createId("scene"), order}));
  const id = createId("project");
  const project: Project = {...structuredClone(source), id, title, topic: artifact.result.suggestedTitle, channelProfileId: channel.id,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: review?.publishable === false ? "draft" : "ready", scenes,
    chatTopicId: undefined, outputPath: undefined, lastRender: undefined,
    videoBrief: {creationMode: artifact.mode === "authored" ? "script" : "prompt", readyScript: artifact.originalScript,
      prompt: artifact.videoPrompt, competitorTranscripts: []},
    settings: {...structuredClone(source.settings), durationMinutes: artifact.mode === "authored" ? artifact.result.recommendedDurationSeconds / 60 : 20,
      script: {...source.settings.script, model: artifact.result.modelId ?? source.settings.script.model},
      video: {...structuredClone(source.settings.video), enabled: false},
      music: {...source.settings.music, enabled: false},
      subtitles: {...source.settings.subtitles, enabled: false},
      assembly: {...source.settings.assembly, kenBurns: true, kenBurnsDirection: "alternate", fadeTransitions: true,
        transitionType: "mix", transitionDurationSeconds: 0.4,
        montage: {...source.settings.assembly.montage!, enabled: false}}},
    referenceAnalysis: {...artifact.result, scenes, improvements: review?.issues ?? artifact.result.improvements,
      scenarioQuality: {...artifact.result.scenarioQuality!, complete: review?.publishable === false ? false : artifact.result.scenarioQuality!.complete,
        fingerprint: scenarioQualityFingerprint(scenes)}},
    montagePlan: artifact.result.montagePlan};
  if (channel.primaryCharacter) Object.assign(project, selectCharacterReference(project, channel.primaryCharacter));
  assert.equal(projectScenarioQualityIssue(project), review?.publishable === false ? "incomplete" : undefined);
  assert.ok(scenes.every(scene => scene.durationSeconds <= 9 && !scene.audioPath && !scene.imagePath && !scene.videoPath));
  await storage.ensureProject(project);
  await repository.save(project);
  const after = await repository.list();
  for (const original of before) assert.deepEqual(after.find(item => item.id === original.id), original);
  const afterChannels = await profiles.list();
  for (const original of beforeChannels) assert.deepEqual(afterChannels.find(item => item.id === original.id), original);
  const afterRawChannels = JSON.parse(await readFile(join(dataPath, "database", "channel-profiles.json"), "utf8"));
  for (const original of beforeRawChannels) assert.deepEqual(afterRawChannels.find((item: {id: string}) => item.id === original.id), original);
  const saved = await repository.get(id);
  assert.equal(projectScenarioQualityIssue(saved!), review?.publishable === false ? "incomplete" : undefined);
  const evidence = {projectId: id, channelId: channel.id, title, scenes: scenes.length,
    estimatedSeconds: artifact.result.recommendedDurationSeconds, manualReviewBlockedProduction: review?.publishable === false,
    oldProjectsAndChannelsUnchanged: true, newTtsImagesVideo: false};
  await writeFile(join(dirname(process.env.GW_LONG_RESULT), "import.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
