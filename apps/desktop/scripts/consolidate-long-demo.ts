/** Correct only the duplicate test channel created by this run's untrimmed prompt comparison. */
import assert from "node:assert/strict";
import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {selectCharacterReference, projectScenarioQualityIssue} from "@gold-work/shared";
import {FileProjectRepository} from "../src/file-project-repository.js";
import {ChannelProfileStore} from "../src/channel-profile-store.js";
import {LocalProjectStorage} from "../src/local-project-storage.js";
const dataPath = join(process.env.APPDATA!, "@gold-work", "desktop");
const repository = new FileProjectRepository(join(dataPath, "projects.json"));
const profiles = new ChannelProfileStore(join(dataPath, "database", "channel-profiles.json"));
const targetId = "40de3e27-ef11-47c4-af03-1a09b06dcc69";
const duplicateId = "b003ea72-6882-46fd-a1cd-e2f87d4917d6";
const projectId = "project_mtubo75j_rsceh22";
const before = await repository.list();
const oldChannels = await profiles.list();
const target = await profiles.get(targetId);
const duplicate = await profiles.get(duplicateId);
assert.ok(target && duplicate && target.primaryCharacter);
assert.equal(target.name, "ТЕСТ · Длинные AI Story · Максим");
assert.equal(duplicate.name, target.name);
assert.equal(duplicate.masterPrompt.trim(), target.masterPrompt.trim());
assert.deepEqual(before.filter(project => project.channelProfileId === duplicateId).map(project => project.id), [projectId]);
const project = await repository.mutate(projectId, current => {
  const moved = {...current, channelProfileId: targetId};
  return {...moved, ...selectCharacterReference(moved, target.primaryCharacter!)};
});
await new LocalProjectStorage(join(dataPath, "workspace", "projects")).ensureProject(project);
assert.equal(projectScenarioQualityIssue(project), "incomplete");
const trash = await profiles.moveToTrash(duplicateId);
const after = await repository.list();
for (const original of before.filter(project => project.id !== projectId)) assert.deepEqual(after.find(project => project.id === original.id), original);
const afterChannels = await profiles.list();
for (const original of oldChannels.filter(channel => channel.id !== duplicateId)) assert.deepEqual(afterChannels.find(channel => channel.id === original.id), original);
const evidencePath = join(process.cwd(), "captures", "long-story-live", "1788970718595-generated", "import.json");
const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
await writeFile(evidencePath, JSON.stringify({...evidence, channelId: targetId, duplicateTestChannelRecoverableInTrash: trash.trashId}, null, 2));
console.log(JSON.stringify({projectId, channelId: targetId, duplicateTestChannelMovedToTrash: duplicateId,
  recoverable: true, unrelatedProjectsAndChannelsUnchanged: true}));
