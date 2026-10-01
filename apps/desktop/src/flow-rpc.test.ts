import test from "node:test";
import assert from "node:assert/strict";
import { FlowClient, FlowSubmissionUncertainError, type FlowRemoteImageJob } from "./flow-client.js";
import { FLOW_RPC, FlowRpcError, flowRpcImageRequest, flowRpcUploadImage, flowRpcImageMedia, parseFlowRpcResponse, flowRpcVideoRequest, selectFlowRpcVideoModel } from "./flow-rpc.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const image = ["media/test", "project1", "workflow1", null, null, null,
  [[null, null, null, null, null, null, null, null, null, null, null, null, null, "https://lh3.googleusercontent.com/test"]]];
const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.alloc(40)]);
const video = ["media/video", "project1", "workflow-video", null, null,
  [null, null, null, null, null, null, null, null, [3]],
  null, [[null, null, null, null, null, null, null, null, "https://flow-content.google/video/test"]]];
const videoUsage = ["veo_3_1_i2v_s_fast_4s", null, null, null, [[1, [[null, 10]]], [2, [null, []]]], null, null, [[[[1, 5]]]], null, null, null, null, [[2, 1]], null, null, null, 4];
const modelConfig = [[null, null, null, null, [["Fast", [videoUsage], true, "veo_3_1_fast"]], [["Nano Banana 2", [["NARWHAL"]]]]]];
function fixture(failure?: Error) {
  const calls: { rpc: string; payload: unknown[] }[] = [];
  const account = { id: "one", status: "ready", enabled: true, videoEnabled: true, tier: "FREE" };
  const store = { list: async () => [account], secret: async () => ({ sessionOrigin: "https://flow.google.com" }) };
  const auth = {
    refresh: async () => account,
    prepareRpcProject: async () => undefined,
    prepareRuntime: async () => undefined,
    recaptchaToken: async () => "private-test-token",
    sessionFor: async () => ({ fetch: async (url: string) => new Response(url.includes("/video/") ? mp4 : png) }),
    rpc: async (_id: string, rpc: string, payload: unknown[]) => {
      calls.push({ rpc, payload });
      switch (rpc) {
        case FLOW_RPC.models: return modelConfig;
        case FLOW_RPC.credits: return [50, 3, 8, 1];
        case FLOW_RPC.createProject: return ["project1"];
        case FLOW_RPC.uploadImage: return [image];
        case FLOW_RPC.generateImages: if (failure) throw failure; return [[image]];
        case FLOW_RPC.videoStart: if (failure) throw failure; return [null, null, [], [video]];
        case FLOW_RPC.getMedia: return payload[0] === "media/video" ? video : image;
        default: throw new Error("Unexpected RPC");
      }
    },
  };
  return { calls, client: new FlowClient(store as never, auth as never) };
}

test("new image wire contract has one request, exact prompt, aspect and reference roles", () => {
  const prompt = "A character with a hat.\nDo not rewrite.";
  const body = flowRpcImageRequest({ projectId: "p", token: "secret", model: "NARWHAL", aspectRatio: "16:9", prompt, seed: 9, batchId: "batch", references: ["ref"] }) as any[];
  assert.equal(body[1].length, 1);
  assert.deepEqual(body[1][0][2], [["ref", null, null, null, 1]]);
  assert.equal(body[1][0][4], 3);
  assert.deepEqual(body[1][0][8], [[[prompt]]]);
  assert.equal(body[3][5], "p");
  assert.deepEqual(body[3][10], ["secret", 1]);
  assert.deepEqual(body[4], ["batch"]);
  assert.equal(flowRpcUploadImage("p", "secret", "bytes", "image/png")[7], true);
});

test("RPC parser accepts framed response and preserves explicit provider rejection", () => {
  assert.deepEqual(parseFlowRpcResponse(FLOW_RPC.getMedia, { status: 200, body: `)]}'\n123\n${JSON.stringify([["wrb.fr", FLOW_RPC.getMedia, JSON.stringify(image)]])}` }), image);
  assert.throws(() => parseFlowRpcResponse(FLOW_RPC.generateImages, { status: 200, body: JSON.stringify([["wrb.fr", FLOW_RPC.generateImages, null, null, null, [7]]]) }), (error: unknown) => error instanceof FlowRpcError && error.code === 7);
  assert.throws(() => parseFlowRpcResponse(FLOW_RPC.generateImages, { status: 200, body: "incomplete" }), /unknown/);
  assert.equal(flowRpcImageMedia(image).name, "media/test");
});

test("modern image uploads reference, persists receipt before download, and resumes without generating", async () => {
  const f = fixture(); let job: FlowRemoteImageJob | undefined; let submits = 0;
  const bytes = await f.client.generateImage({ prompt: "Test character", aspectRatio: "16:9", references: [png],
    onBeforeSubmit: async () => { submits++; }, onRemoteJob: async value => { job = value; } });
  assert.deepEqual(bytes, png); assert.equal(submits, 1); assert.equal(job?.mediaName, "media/test");
  assert.equal(f.calls.filter(call => call.rpc === FLOW_RPC.uploadImage).length, 1);
  const count = f.calls.length;
  assert.deepEqual(await f.client.generateImage({ prompt: "unused", aspectRatio: "16:9", resumeJob: job }), png);
  assert.deepEqual(f.calls.slice(count).map(call => call.rpc), [FLOW_RPC.getMedia]);
});

test("uncertain submission is neither retried nor cleared", async () => {
  const f = fixture(new Error("Connection lost")); let rejected = 0;
  await assert.rejects(f.client.generateImage({ prompt: "test", aspectRatio: "16:9", onSubmitRejected: async () => { rejected++; } }), FlowSubmissionUncertainError);
  assert.equal(f.calls.filter(call => call.rpc === FLOW_RPC.generateImages).length, 1);
  assert.equal(rejected, 0);
});

test("explicit RPC refusal clears checkpoint without a second generation", async () => {
  const f = fixture(new FlowRpcError(FLOW_RPC.generateImages, 200, 7)); let rejected = 0;
  await assert.rejects(f.client.generateImage({ prompt: "test", aspectRatio: "16:9", onSubmitRejected: async () => { rejected++; } }), /no-retry/);
  assert.equal(rejected, 1);
  assert.equal(f.calls.filter(call => call.rpc === FLOW_RPC.generateImages).length, 1);
});

test("Veo wire contract and model selection match input mode instead of guessing another model", () => {
  const input = { projectId: "p", token: "secret", model: "veo_3_1_i2v_s_fast_4s", aspectRatio: "16:9", prompt: "slow camera", batchId: "b", mediaSeed: "m", workflowSeed: "w", start: "image1" };
  const request = flowRpcVideoRequest(input) as { rpc: string; payload: any[] };
  assert.equal(request.rpc, FLOW_RPC.videoStart);
  assert.deepEqual(request.payload[0][0][4], [null, "image1"]);
  assert.deepEqual(request.payload[0][0][5], [null, null, null, null, "m", "w"]);
  assert.deepEqual(request.payload[0][0][0], [null, null, [[["slow camera"]]]]);
  assert.equal(selectFlowRpcVideoModel(modelConfig, { ...input, durationSeconds: 4, start: true, end: false, billingTier: 1 }), input.model);
  assert.throws(() => selectFlowRpcVideoModel(modelConfig, { ...input, durationSeconds: 4, start: false, end: false, billingTier: 1 }), /нет доступного/);
  assert.throws(() => selectFlowRpcVideoModel(modelConfig, { ...input, durationSeconds: 4, start: true, end: false, billingTier: 2 }), /нет доступного/);
  assert.throws(() => flowRpcVideoRequest({ ...input, aspectRatio: "1:1" }), /16:9/);
});

test("new Veo preserves receipt and resume only fetches the existing media", async () => {
  const f = fixture(); let job: any; let submits = 0;
  assert.deepEqual(await f.client.generateVideo({ prompt: "slow camera", aspectRatio: "16:9", durationSeconds: 4,
    model: "veo_3_1_i2v_s_fast_4s", startFrame: png, onBeforeSubmit: async () => { submits++; }, onRemoteJob: async value => { job = value; } }), mp4);
  assert.equal(submits, 1); assert.equal(job.mediaName, "media/video");
  const count = f.calls.length;
  assert.deepEqual(await f.client.generateVideo({ prompt: "unused", aspectRatio: "16:9", durationSeconds: 4, resumeJob: job }), mp4);
  assert.deepEqual(f.calls.slice(count).map(call => call.rpc), [FLOW_RPC.getMedia]);
});
