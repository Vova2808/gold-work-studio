import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createVoiceCalibration, type DocumentaryCandidate } from "@gold-work/shared";
import { prepareDocumentaryScript } from "./documentary-plan.js";
import { DocumentaryProjectService, documentaryCandidateAttempts, selectDocumentaryCandidates } from "./documentary-project-service.js";
import { DocumentarySearch } from "./documentary-search.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { prepareDocumentaryRangePoster } from "./documentary-media-cache.js";
import { effectFfmpeg } from "./effect-media.js";
import { checksumFile } from "./effect-library.js";
import { DocumentaryIntelligence } from "./documentary-intelligence.js";
import { documentaryNarrativeEvidenceIssue } from "./documentary-scene-context.js";

test("saved accepted frame evidence keeps a specific excerpt searchable beyond generic catalog hits", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-excerpt-evidence-")); t.after(() => rm(root, { recursive: true, force: true }));
  const materialRoot = join(root, "Materials"), catalogRoot = join(materialRoot, "Catalog");
  await mkdir(catalogRoot, { recursive: true });
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  let project = await projects.create({ title: "Canal", topic: "Canal", mediaMode: "stock", mode: "standard", language: "English", aspectRatio: "16:9" });
  project.videoBrief = { creationMode: "script", readyScript: "The next gates open." } as NonNullable<typeof project.videoBrief>;
  project.scenes = prepareDocumentaryScript(project, createVoiceCalibration({ provider: "elevenlabs", voice: "test", language: "en", sampleText: "A measured voice reads every word at a natural pace.", audioDurationSeconds: 5 }));
  const target = "f".repeat(64), rejected = "e".repeat(64);
  for (const checksum of [...Array.from({ length: 45 }, (_, i) => i.toString(16).padStart(64, "0")), target, rejected]) {
    const localPath = join(root, `${checksum}.mp4`); await writeFile(localPath, "search fixture, not media acceptance");
    await writeFile(join(catalogRoot, `${checksum}.json`), JSON.stringify({ id: `excerpt:${checksum}`, kind: "video", provider: "commons", title: "Canal transit", description: "Canal lock", localPath }));
  }
  const review = { status: "accepted" as const, confidence: .95, reason: "Verified frames", quality: "clear", checkedAt: "now", sampleSeconds: [0, 1, 2], viewDescription: "An archival photograph of the 1965 canal gates", actionMatch: true, actionEvidence: "Canal lock gates moved from shut to fully open." };
  project.scenes = [target, rejected].map((checksum, order) => ({ ...structuredClone(project.scenes[0]!), id: `clip-${order}`, order,
    documentary: { ...project.scenes[0]!.documentary!, checksum, verified: order === 0, visualReview: review } }));
  await projects.mutate(project.id, () => project);
  const before = JSON.stringify(await projects.list());
  const service = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "projects")), new DocumentarySearch(), materialRoot,
    { download: async () => { throw new Error("Search hints must not download"); } });
  const matches = await service.localCandidates("Canal lock gates opening");
  assert.equal(matches[0]?.id, `local:${target}`);
  assert.equal((await service.localCandidates("gates opening")).some(candidate => candidate.id === `local:${rejected}`), false, "Unverified selections must not contribute review hints");
  assert.equal(matches[0]!.description, "Canal lock");
  assert.match(matches[0]!.previousFrameSearchHint!, /1965/);
  assert.equal((await service.localCandidates("1965 gates"))[0]?.id, `local:${target}`, "Generated observations remain searchable without becoming source metadata");
  const narrativeEvidence = { subjectMatch: true, eraMatch: true, detailMatch: true, requiredEra: "none", observedEra: "none", evidence: "The requested canal gates are clearly visible.", eraEvidenceQuote: review.viewDescription };
  assert.match(documentaryNarrativeEvidenceIssue({ narrativeEvidence }, { ...matches[0]! }, { current: { scene: 1, text: "An archival photograph shows canal gates." }, preceding: [], following: [], earlierTimeReferences: [] }) ?? "", /Архивное/, "A generated prior caption cannot prove archival source provenance");
  const action = { ...matches[0]!, excerpt: { sourceChecksum: "a".repeat(64), startSeconds: 30, endSeconds: 34, sourceDurationSeconds: 70 } };
  const generic = { ...action, id: `local:${"b".repeat(64)}`, description: "Canal locks", previousFrameSearchHint: undefined, excerpt: undefined };
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { throw new Error("Ranking saved evidence must not submit a paid request"); } }, id => join(root, id));
  const ranked = await intelligence.rankLocalCandidates(project, { ...project.scenes[0]!, narration: "Открываются следующие ворота." }, [generic, action]);
  assert.equal(ranked[0]?.id, action.id, "A checked action excerpt must reach inspection before general material");
  assert.equal(JSON.stringify(await projects.list()), before, "Search must preserve every saved project");
});

test("cache distinguishes whole video from excerpts and restores a removed range poster", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-excerpt-cache-")); t.after(() => rm(root, { recursive: true, force: true }));
  const clips = [join(root, "blue.mp4"), join(root, "red.mp4"), join(root, "whole.mp4")];
  for (let i = 0; i < clips.length; i++) await effectFfmpeg(["-y", "-f", "lavfi", "-i", `color=c=${i === 0 ? "blue" : "red"}:s=160x90:r=30:d=${i === 2 ? 15 : 5}`, "-an", "-c:v", "libx264", clips[i]!]);
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider()), storage = new LocalProjectStorage(join(root, "projects"));
  let project = await projects.create({ title: "Excerpt cache", topic: "Ships", mediaMode: "stock", mode: "standard", language: "English", aspectRatio: "16:9" });
  project.videoBrief = { creationMode: "script", readyScript: "SS United States crossed the Atlantic in 1952." } as NonNullable<typeof project.videoBrief>;
  project.scenes = prepareDocumentaryScript(project, createVoiceCalibration({ provider: "elevenlabs", voice: "test", language: "en", sampleText: "A measured voice reads every word at a natural pace.", audioDurationSeconds: 5 }));
  project.scenes = [0, 1, 2].map(order => ({ ...structuredClone(project.scenes[0]!), id: `clip-${order}`, order }));
  project = await projects.mutate(project.id, () => project);
  let downloads = 0;
  const service = new DocumentaryProjectService(projects, storage, new DocumentarySearch(), join(root, "Materials"), {
    download: async () => { throw new Error("Use streaming download"); },
    downloadToFile: async (_asset, target) => { downloads++; await copyFile(clips[2]!, target); return { extension: ".mp4", bytes: (await stat(target)).size, contentType: "video/mp4" }; },
  });
  const base: DocumentaryCandidate = { id: "pexels:whole", provider: "pexels", kind: "video", title: "Ship", description: "A ship", pageUrl: "https://example.test/ship", downloadUrl: "https://example.test/ship.mp4", author: "Fixture", license: "CC0", licenseUrl: "", rights: "public-domain", attribution: "Fixture", query: "Ship", retrievedAt: "now", match: "unverified", concerns: [] };
  const alternatives = [0, 1].map(i => ({ ...base, excerpt: { sourceChecksum: "a".repeat(64), startSeconds: i * 5, endSeconds: i * 5 + 5, sourceDurationSeconds: 15 } }));
  assert.equal(selectDocumentaryCandidates([...alternatives, base, alternatives[0]!], [], new Set()).length, 3);
  assert.equal(documentaryCandidateAttempts([...alternatives, base, alternatives[0]!]).length, 3);
  const choose = async (order: number, candidate: DocumentaryCandidate) => {
    await projects.mutate(project.id, current => ({ scenes: current.scenes.map(scene => scene.order === order ? { ...scene, documentary: { ...scene.documentary!, candidates: [candidate] } } : scene) }));
    return service.applyCandidate(project.id, `clip-${order}`, candidate.id);
  };
  for (let i = 0; i < 2; i++) {
    project = await choose(i, { ...base, localPath: clips[i], excerpt: { sourceChecksum: "a".repeat(64), startSeconds: i * 5, endSeconds: i * 5 + 5, sourceDurationSeconds: 15 } });
    assert.equal(project.scenes[i]!.documentary!.checksum, await checksumFile(clips[i]!));
    assert.equal(project.scenes[i]!.documentary!.selected!.excerpt!.startSeconds, i * 5);
  }
  project = await choose(2, base);
  assert.equal(downloads, 1, "A saved excerpt must not masquerade as the entire online video");
  assert.equal(project.scenes[2]!.documentary!.selected!.durationSeconds, 15);
  assert.equal(project.scenes[2]!.documentary!.selected!.excerpt, undefined);
  const prepared = await prepareDocumentaryRangePoster(storage.projectDirectory(project.id), project.scenes[2]!);
  await rm(prepared.imagePath!);
  const restored = await prepareDocumentaryRangePoster(storage.projectDirectory(project.id), prepared);
  assert.equal(restored.imagePath, prepared.imagePath); assert.ok((await stat(restored.imagePath!)).size > 0);
});
