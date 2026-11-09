import test from "node:test";
import assert from "node:assert/strict";
import { scenarioQualityFingerprint, type Project, type ReferenceAnalysis, type Scene } from "@gold-work/shared";
import { isReadyStockScript, scenarioReviewBlockReason } from "./ready-script-entrypoint";

function fixture(mediaMode: Project["mediaMode"] = "stock") {
  const scenes = [{ id: "scene-1", order: 0, narration: "Original text.", durationSeconds: 5 }] as Scene[];
  return {
    mediaMode,
    scenes,
    videoBrief: { prompt: "Example", competitorTranscripts: [], creationMode: "script" as const, readyScript: "  Original text.\r\n\n" },
    referenceAnalysis: { provider: "anymodel:claude" } as ReferenceAnalysis,
  };
}

test("Stock ready text does not require a missing or stale editorial audit", () => {
  const project = fixture();
  assert.equal(scenarioReviewBlockReason(project), undefined);
  project.referenceAnalysis.scenarioQuality = {
    fingerprint: "old-fingerprint", complete: false, endingResolved: false,
  } as NonNullable<ReferenceAnalysis["scenarioQuality"]>;
  assert.equal(scenarioReviewBlockReason(project), undefined);
  assert.equal(project.videoBrief.readyScript, "  Original text.\r\n\n");
});

test("AI Story and legacy Mixed retain missing and stale audit gates", () => {
  for (const mode of ["ai", "mixed"] as const) {
    const project = fixture(mode);
    assert.match(scenarioReviewBlockReason(project)!, /финальная проверка/);
    project.referenceAnalysis.scenarioQuality = {
      fingerprint: "old-fingerprint", complete: true, endingResolved: true,
    } as NonNullable<ReferenceAnalysis["scenarioQuality"]>;
    assert.match(scenarioReviewBlockReason(project)!, /изменён после проверки/);
    project.referenceAnalysis.scenarioQuality.fingerprint = scenarioQualityFingerprint(project.scenes);
    assert.equal(scenarioReviewBlockReason(project), undefined);
  }
});

test("generated Stock scripts still require the existing complete-ending audit", () => {
  const project = { ...fixture(), videoBrief: { prompt: "Generate a story", competitorTranscripts: [], creationMode: "prompt" as const } };
  project.referenceAnalysis.scenarioQuality = {
    fingerprint: scenarioQualityFingerprint(project.scenes), complete: false, endingResolved: false,
  } as NonNullable<ReferenceAnalysis["scenarioQuality"]>;
  assert.equal(isReadyStockScript(project), false);
  assert.match(scenarioReviewBlockReason(project)!, /финальная проверка/);
});

test("empty scripts and unspecified media modes do not bypass audits", () => {
  const empty = fixture();
  empty.videoBrief.readyScript = " \r\n\t";
  assert.equal(isReadyStockScript(empty), false);
  assert.match(scenarioReviewBlockReason(empty)!, /финальная проверка/);
  const legacy = { ...fixture(), mediaMode: undefined };
  assert.equal(isReadyStockScript(legacy), false);
  assert.match(scenarioReviewBlockReason(legacy)!, /финальная проверка/);
});
