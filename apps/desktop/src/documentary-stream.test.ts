import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { setImmediate as turn } from "node:timers/promises";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createVoiceCalibration } from "@gold-work/shared";
import { AnyModelClient, AnyModelCompletionUncertainError } from "./anymodel-client.js";
import { DocumentaryIntelligence, readAnalysisCheckpoint } from "./documentary-intelligence.js";
import { DocumentaryAnalysisError } from "./documentary-analysis-error.js";
import { prepareDocumentaryScript } from "./documentary-plan.js";

const store = { publicSettings: async () => ({ configured: true, baseUrl: "https://fixture.test/v1", textModel: "fixture" }), apiKey: async () => "fixture" };
const frame = (content: string, finish?: string) => new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish ?? null }] })}\n\n`);

test("empty terminal length response blocks only its candidate and is not submitted again", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-length-response-")); t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const client = new AnyModelClient(store as never, async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(frame(" ", "length")); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
  });
  const intelligence = new DocumentaryIntelligence(client, () => root);
  const complete = () => (intelligence as unknown as { complete: (id: string, purpose: string, system: string, input: string) => Promise<unknown> }).complete("fixture", "candidate-relevance", "JSON", '{"fixture":true}');
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(complete(), error => error instanceof DocumentaryAnalysisError && error.kind === "pending");
  assert.equal(calls, 1);
  const directory = join(root, "Documentary", "Analysis");
  assert.equal((await readAnalysisCheckpoint(join(directory, (await readdir(directory))[0]!)))?.state, "partial");
});

test("broken independent analyses do not retry checkpoints and stop after three consecutive connection failures", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-stream-budget-")); t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { calls++; throw new AnyModelCompletionUncertainError("ECONNRESET"); } }, () => root);
  const complete = (input: string) => (intelligence as unknown as { complete: (id: string, purpose: string, system: string, input: string) => Promise<unknown> }).complete("fixture", "candidate-relevance", "Fixture", input);
  for (let i = 0; i < 3; i++) await assert.rejects(complete(String(i)), error => error instanceof DocumentaryAnalysisError && error.kind === (i < 2 ? "pending" : "unavailable"));
  await assert.rejects(complete("0"), error => error instanceof DocumentaryAnalysisError && error.kind === "pending");
  assert.equal(calls, 3);
});

test("a comparison visual request asks for one source and keeps narration only as editorial context", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-comparison-request-")); t.after(() => rm(root, { recursive: true, force: true }));
  let request: Record<string, unknown> = {};
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (_s, input) => { request = JSON.parse(input); return '{"status":"accepted"}'; } }, () => root);
  await (intelligence as unknown as { complete: (id: string, purpose: string, system: string, input: string) => Promise<unknown> }).complete("fixture", "catalog-range-check", "Fixture", JSON.stringify({ narration: "Compare Tractor A beside Tractor B.", entities: ["Tractor A", "Tractor B"], source: { title: "Tractor A driving" } }));
  assert.deepEqual(request.entities, ["Tractor A"]); assert.equal(request.narration, undefined);
  assert.match(String(request.visualTask), /ONE clean source/); assert.match(String(request.voiceOverContext), /Tractor B/);
});

test("mixed-source final identity is checked without title or earlier catalog assertions", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-mixed-source-")); t.after(() => rm(root, { recursive: true, force: true }));
  const requests: Record<string, unknown>[] = [];
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (_s, input) => { requests.push(JSON.parse(input)); return '{"status":"rejected"}'; } }, () => root);
  const complete = (intelligence as unknown as { complete: (id: string, purpose: string, system: string, input: string, images: string[]) => Promise<unknown> }).complete.bind(intelligence);
  for (const title of ["Tractor A and Tractor B at work", "Tractor A interior"]) await complete("fixture", "catalog-range-check", "Fixture", JSON.stringify({ narration: "Tractor A is larger.", entities: ["Tractor A"], source: { title }, neighboringViews: [{ description: "Prior possibly incorrect identity" }] }), ["data:image/jpeg;base64,fixture"]);
  assert.equal(requests.length, 3);
  assert.equal(requests[0]!.entities, undefined); assert.equal(requests[0]!.narration, undefined, "Independent identity must not be primed by the desired answer");
  assert.equal(requests[1]!.source, undefined); assert.equal(requests[1]!.neighboringViews, undefined);
  assert.deepEqual(requests[1]!.entities, ["Tractor A"]); assert.ok(requests[1]!.independentIdentity);
  assert.ok(requests[2]!.source && requests[2]!.neighboringViews, "Single-subject interiors retain provenance context");
});

test("comparison intent survives a short pronoun-only edit slice", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-comparison-context-")); t.after(() => rm(root, { recursive: true, force: true }));
  let request: Record<string, unknown> = {};
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (_s, input) => { request = JSON.parse(input); return '{"status":"rejected"}'; } }, () => root);
  // Keep the real selection context and request rewriting, without media I/O.
  Object.assign(intelligence, { inspect: async () => (intelligence as unknown as { complete: (id: string, purpose: string, system: string, input: string) => Promise<unknown> }).complete("fixture", "catalog-range-check", "Fixture", JSON.stringify({ narration: "It is not a fair efficiency score.", entities: ["Tractor A", "Tractor B"], source: { title: "Tractor A driving" } })) });
  await intelligence.inspectForSelection({ id: "fixture" } as never, { documentary: { requirement: { text: "It is not a fair efficiency score.", detail: "incompatibility of direct efficiency comparison", entities: ["Tractor A", "Tractor B"], years: [], queries: [] } } } as never);
  assert.deepEqual(request.entities, ["Tractor A"]);
  assert.match(String(request.visualTask), /ONE clean source/);
});

test("mixed-source identity does not spend while a legacy final check is uncertain", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-mixed-source-pending-")); t.after(() => rm(root, { recursive: true, force: true }));
  const input = JSON.stringify({ narration: "Tractor A drives.", entities: ["Tractor A"], source: { title: "Tractor A and Tractor B" } });
  const images = ["data:image/jpeg;base64,fixture"], purpose = "catalog-range-check";
  const key = createHash("sha256").update(JSON.stringify([2, purpose, "Fixture", input, images])).digest("hex");
  await mkdir(join(root, "Documentary/Analysis"), { recursive: true });
  await writeFile(join(root, "Documentary/Analysis", `${key}.json`), JSON.stringify({ state: "pending", purpose }));
  let calls = 0;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { calls++; return '{}'; } }, () => root);
  const complete = (intelligence as unknown as { complete: (id: string, purpose: string, system: string, input: string, images: string[]) => Promise<unknown> }).complete.bind(intelligence);
  await assert.rejects(complete("fixture", purpose, "Fixture", input, images), error => error instanceof DocumentaryAnalysisError && error.kind === "pending");
  assert.equal(calls, 0);
});

test("Stock stop saves an in-flight paid response and prevents the next inspection submission", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-stop-inspection-")); t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0, stopped = false;
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async () => { calls++; stopped = true; return '{"status":"accepted"}'; } }, () => root);
  const complete = (input: string) => (intelligence as unknown as { complete: (id: string, purpose: string, system: string, input: string) => Promise<unknown> }).complete("fixture", "fixture", "Fixture", input);
  Object.assign(intelligence, { inspect: async () => { await complete('{"step":"first"}'); await complete('{"step":"second"}'); } });
  // Selection carries the real requirement context even when inspect itself
  // is replaced here to isolate the paid-response/Stop boundary.
  const scene={documentary:{requirement:{entities:[],queries:[],years:[],text:'Fixture',preferredKind:'video'}}};
  await assert.rejects(intelligence.inspectForSelection({} as never, scene as never, () => {}, () => stopped), { name: "AbortError" });
  assert.equal(calls, 1);
  const directory = join(root, "Documentary", "Analysis"), names = await readdir(directory);
  assert.equal(names.length, 1); assert.equal((await readAnalysisCheckpoint(join(directory, names[0]!)))?.state, "complete");
});

test("Stock keeps an active response beyond 120 seconds and does not submit it twice", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let body!: ReadableStreamDefaultController<Uint8Array>, signal!: AbortSignal, calls = 0;
  const partials: string[] = [];
  const client = new AnyModelClient(store as never, async (_url, init) => {
    calls++; signal = init!.signal!;
    assert.equal(JSON.parse(String(init!.body)).stream, true);
    return new Response(new ReadableStream({ start(controller) { body = controller; } }), { headers: { "content-type": "text/event-stream" } });
  });
  const result = client.documentaryCompletion("JSON", "test", [], undefined, text => partials.push(text));
  await turn();
  t.mock.timers.tick(120_000); assert.equal(signal.aborted, false);
  body.enqueue(frame('{"segments":')); await turn();
  t.mock.timers.tick(120_000); assert.equal(signal.aborted, false);
  body.enqueue(frame("[]}", "stop"));
  assert.equal(await result, '{"segments":[]}');
  assert.equal(partials.at(-1), '{"segments":[]}'); assert.equal(calls, 1);
});

test("Stock reports a local idle timeout even when proxy abort surfaces as ECONNRESET, retaining partial text", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const client = new AnyModelClient(store as never, async (_url, init) => {
    calls++;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(frame('{"segments":['));
      init!.signal!.addEventListener("abort", () => controller.error(Object.assign(new Error("aborted"), { code: "ECONNRESET" })), { once: true });
    } }), { headers: { "content-type": "text/event-stream" } });
  });
  const result = client.documentaryCompletion("JSON", "test");
  const rejected = assert.rejects(result, error => {
    assert.ok(error instanceof AnyModelCompletionUncertainError);
    assert.equal(error.reason, "timeout"); assert.equal(error.partial, '{"segments":[');
    assert.match(error.message, /нет данных от сервиса \(180 с\)/);
    assert.doesNotMatch(error.message, /ECONNRESET/); return true;
  });
  await turn(); t.mock.timers.tick(180_000); await rejected;
  assert.equal(calls, 1);
});

test("interrupted Stock checkpoints keep received bytes and remain non-replayable after restart", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-stream-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const project = await projects.create({ title: "Fixture", topic: "Tractors", language: "English", mediaMode: "stock", mode: "standard", aspectRatio: "16:9" });
  project.videoBrief = { ...project.videoBrief!, creationMode: "script", readyScript: "A tractor works in a field." };
  project.scenes = prepareDocumentaryScript(project, createVoiceCalibration({ provider: "elevenlabs", voice: "fixture", language: "en", sampleText: "This is a measured voice for a local test.", audioDurationSeconds: 4 }));
  let calls = 0;
  const raw = '{"scenes":[]}'; // Even parseable JSON without a terminal event is NOT a confirmed result.
  const client = { configured: async () => true, documentaryCompletion: async (_system: string, _input: string, _images?: string[], _signal?: AbortSignal, onPartial?: (value: string) => void) => {
    calls++; onPartial?.(raw); throw new AnyModelCompletionUncertainError("Local timeout", raw, "timeout");
  } };
  const intelligence = new DocumentaryIntelligence(client, () => root);
  await assert.rejects(intelligence.plan(project, project.scenes), error => error instanceof DocumentaryAnalysisError && error.kind === "pending");
  const directory = join(root, "Documentary", "Analysis"), path = join(directory, (await readdir(directory))[0]!);
  const checkpoint = await readAnalysisCheckpoint(path);
  assert.equal(checkpoint?.state, "partial"); assert.equal(checkpoint.raw, raw);
  assert.equal(checkpoint.result, undefined);
  await assert.rejects(new DocumentaryIntelligence(client, () => root).plan(project, project.scenes), error=>error instanceof DocumentaryAnalysisError&&error.kind==='pending');
  assert.equal(calls, 1);
  assert.equal(JSON.parse(await readFile(path, "utf8")).state, "partial");
});

test("completed malformed Stock JSON stays received, not partial", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-stream-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const project = await projects.create({ title: "Fixture", topic: "Tractors", language: "English", mediaMode: "stock", mode: "standard", aspectRatio: "16:9" });
  const raw = '{"scenes":[';
  const intelligence = new DocumentaryIntelligence({ configured: async () => true, documentaryCompletion: async (_s, _i, _m, _signal, onPartial) => { onPartial?.(raw); return raw; } }, () => root);
  await assert.rejects(intelligence.plan(project, [{ id: "one", narration: "Tractor" } as never]));
  const directory = join(root, "Documentary", "Analysis");
  const checkpoint = await readAnalysisCheckpoint(join(directory, (await readdir(directory))[0]!));
  assert.equal(checkpoint?.state, "received"); assert.equal(checkpoint.raw, raw);
});
