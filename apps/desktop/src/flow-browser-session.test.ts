import test from "node:test";
import assert from "node:assert/strict";
import { parseFlowBrowserSession, parseFlowRpc, flowLoginLocation, flowSessionNeedsReload, FlowBrowserStateError, FlowLoginRequiredError } from "./flow-browser-session.js";

const fixture = (credits: unknown[] = [50,3,8,1,null,50], availability: unknown[] = [1], config: unknown[] = []) => ({
  status: 200, email: "synthetic@example.test", body: `)]}'\n\n123\n${JSON.stringify([
    ["wrb.fr", "nzlxg", JSON.stringify(credits)], ["wrb.fr", "KV2T2d", JSON.stringify(availability)], ["wrb.fr", "cPZSdc", JSON.stringify(config)]
  ])}\n`,
});
test("Flow RPC session requires identity, credits and explicit availability, not HTTP 200 alone", () => {
  assert.deepEqual(parseFlowBrowserSession(fixture()), { email: "synthetic@example.test", credits: 50, tier: "FREE" });
  assert.equal(parseFlowBrowserSession(fixture([0,3])).credits, 0);
  for (const result of [{loginRequired:true}, {...fixture(),email:""}, {...fixture(),status:403}, {...fixture(),body:"<html>Sign in</html>"}, fixture([], [1]), fixture([50], [0])]) assert.throws(() => parseFlowBrowserSession(result));
});
test("Flow regional, age and availability refusals remain actionable", () => {
  const config = new Array(32).fill(null); config[30] = false;
  assert.throws(() => parseFlowBrowserSession(fixture([50], [1], config)), /unsupported-country/);
  config[30] = true; config[31] = false;
  assert.throws(() => parseFlowBrowserSession(fixture([50], [1], config)), /age-restricted/);
  assert.throws(() => parseFlowBrowserSession(fixture([50], [7])), /age-restricted/);
  for (const code of [4,5,6,8]) assert.throws(() => parseFlowBrowserSession(fixture([50], [code])), /unavailable/);
});
test("Flow RPC rejects missing, malformed or error envelopes without echoing the body", () => {
  for (const body of ['[["wrb.fr","nzlxg",null]]', '[["wrb.fr","nzlxg","secret-invalid-body"]]', '[["wrb.fr","different","[]"]]']) {
    assert.throws(() => parseFlowRpc(body, "nzlxg"), error => !String(error).includes("secret-invalid-body"));
  }
});
test("Flow login diagnostics omit URL query, hash and project identifiers", () => {
  assert.equal(flowLoginLocation("https://flow.google.com/project/secret-id?token=secret#secret"), "https://flow.google.com/project/[id]");
  assert.equal(flowLoginLocation("https://accounts.google.com/anything?secret=password"), "https://accounts.google.com/[login]");
  assert.equal(flowLoginLocation("invalid"), "about:blank");
});

test("Flow only reloads a stale/login document, not an access refusal or arbitrary network response", () => {
  assert.equal(flowSessionNeedsReload({ loginRequired: true, reason: "identity_missing" }), true);
  assert.equal(flowSessionNeedsReload({ status: 401 }), true);
  for (const response of [fixture(), fixture([50], [4]), { status: 403 }, { status: 503 }, undefined]) {
    assert.equal(flowSessionNeedsReload(response), false);
  }
  assert.throws(() => parseFlowBrowserSession({ loginRequired: true, reason: "session_data_missing" }), FlowBrowserStateError);
  assert.throws(() => parseFlowBrowserSession({ loginRequired: true, reason: "identity_missing" }), FlowLoginRequiredError);
});
