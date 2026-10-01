import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentaryIntelligence } from "./documentary-intelligence.js";
import { documentaryRangeEditorialPolicy } from "./documentary-visual-relevance.js";

test("new temporal sampling keeps its checkpoint identity after an interrupted request and restart", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-sampling-paid-")); t.after(() => rm(root, { recursive: true, force: true }));
  let submissions = 0;
  const client = { configured: async () => true, documentaryCompletion: async () => { submissions++; throw new Error("connection lost after submission"); } };
  const create = () => new DocumentaryIntelligence(client, id => join(root, id));
  const call = (instance: DocumentaryIntelligence) => Reflect.get(instance, "completeRequest").call(instance, "new", "visual-overview", "Inspect frames.", JSON.stringify({ narration: "Canal", sampleSeconds: [.03, .5, .97] }), ["data:image/jpeg;base64,fixture"], [], 2);
  await assert.rejects(call(create()), /connection lost/);
  const restarted = create();
  assert.equal(await Reflect.get(restarted, "hasUnresolvedLegacyOverview").call(restarted, "new"), false, "A new pending overview must retain temporal sampling on resume");
  await assert.rejects(call(restarted), /Автоповтор отключён/);
  assert.equal(submissions, 1);
  const legacy = join(root, "old", "Documentary", "Analysis"); await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "old.json"), JSON.stringify({ state: "pending", purpose: "visual-overview" }));
  assert.equal(await Reflect.get(restarted, "hasUnresolvedLegacyOverview").call(restarted, "old"), true);
});

test("search frame evidence does not repay an uncertain overview with original source metadata", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-evidence-paid-")); t.after(() => rm(root, { recursive: true, force: true }));
  let submittedSystem = "", submittedInput = "", submissions = 0;
  const images = ["data:image/jpeg;base64,fixture"];
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (system: string, input: string) => {
    submissions++; submittedSystem = system; submittedInput = input; return JSON.stringify({ status: "rejected" });
  } }, id => join(root, id));
  const call = (id: string, description: string) => Reflect.get(intelligence, "completeRequest").call(intelligence, id, "visual-overview", "Inspect source.", JSON.stringify({ source: { title: "Canal", description }, narration: "Открываются ворота.", sampleSeconds: [1] }), images, []);
  await call("fresh", "Original canal description");
  const dir = join(root, "pending", "Documentary", "Analysis"); await mkdir(dir, { recursive: true });
  const key = createHash("sha256").update(JSON.stringify([2, "visual-overview", submittedSystem, submittedInput, images])).digest("hex");
  await writeFile(join(dir, `${key}.json`), JSON.stringify({ state: "pending", purpose: "visual-overview" }));
  await assert.rejects(call("pending", "Previous frame review, a search hint requiring new visual verification: Gates opening\nOriginal source description:\nOriginal canal description"), /неизвестный результат/);
  assert.equal(submissions, 1);
});

test("projection policy keeps fully contextualized old and interim paid checkpoints protected", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-projection-paid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let capturedSystem = "", capturedInput = "", submissions = 0;
  const client = { configured: async () => true, documentaryCompletion: async (system: string, input: string) => {
    submissions++; capturedSystem = system; capturedInput = input; return JSON.stringify({ status: "rejected" });
  } };
  const call = (instance: DocumentaryIntelligence, id: string) => Reflect.get(instance, "inspection").run({ identities: [{ name: "Canal", aliases: [] }], comparisonSubjects: [], submissions: 0, shouldStop: () => false },
    () => Reflect.get(instance, "completeRequest").call(instance, id, "catalog-range-check", "Inspect actual frames.", JSON.stringify({ source: { title: "Canal" }, entities: ["lock"], narration: "За кормой закрываются ворота." }), ["data:image/jpeg;base64,fixture"], []));
  const intelligence = new DocumentaryIntelligence(client as never, id => join(root, id));
  await call(intelligence, "fresh");
  const marker = " Unconverted equirectangular/360-degree panoramas";
  const boundary = capturedSystem.lastIndexOf(marker);
  assert.ok(boundary > 0);
  const priorSystem = capturedSystem.slice(0, boundary), policy = capturedSystem.slice(boundary);
  assert.match(priorSystem, /actionMatch/);
  assert.match(priorSystem, /Identity answer names/);
  for (const [id, system] of [["old", priorSystem], ["interim", priorSystem.replace(documentaryRangeEditorialPolicy, documentaryRangeEditorialPolicy + policy)]]) {
    const directory = join(root, id!, "Documentary", "Analysis"); await mkdir(directory, { recursive: true });
    const key = createHash("sha256").update(JSON.stringify([2, "catalog-range-check", system, capturedInput, ["data:image/jpeg;base64,fixture"]])).digest("hex");
    await writeFile(join(directory, `${key}.json`), JSON.stringify({ state: "pending", purpose: "catalog-range-check" }));
    await assert.rejects(call(intelligence, id!), /неизвестный результат/);
  }
  assert.equal(submissions, 1, "Neither pending version may trigger another submission");
});

test("named-list clarification does not repay an old contextualized pending check", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-list-paid-")); t.after(() => rm(root, { recursive: true, force: true }));
  let submittedSystem = "", submittedInput = "", submissions = 0;
  const images = ["data:image/jpeg;base64,fixture"];
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (system: string, input: string) => {
    submissions++; submittedSystem = system; submittedInput = input; return JSON.stringify({ status: "rejected" });
  } } as never, id => join(root, id));
  const call = (id: string) => Reflect.get(intelligence, "inspection").run({ identities: [{ name: "Alpha", aliases: [] }, { name: "Beta", aliases: [] }], comparisonSubjects: [], submissions: 0, shouldStop: () => false },
    () => Reflect.get(intelligence, "completeRequest").call(intelligence, id, "catalog-range-check", "Inspect actual frames.", JSON.stringify({ source: { title: "Alpha" }, entities: ["Alpha", "Beta"], narration: "Alpha and Beta are two locks." }), images, []));
  await call("fresh");
  const boundary = submittedSystem.lastIndexOf(" This sentence explicitly enumerates"); assert.ok(boundary > 0);
  const directory = join(root, "pending", "Documentary", "Analysis"); await mkdir(directory, { recursive: true });
  const key = createHash("sha256").update(JSON.stringify([2, "catalog-range-check", submittedSystem.slice(0, boundary), submittedInput, images])).digest("hex");
  await writeFile(join(directory, `${key}.json`), JSON.stringify({ state: "pending", purpose: "catalog-range-check" }));
  await assert.rejects(call("pending"), /неизвестный результат/);
  assert.equal(submissions, 1);
});
