/** Read-only audit of actual live artifacts. No service requests, no synthetic quality score. */
import assert from "node:assert/strict";
import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {countNarrationCharacters, type ReferenceAnalysis, type Scene} from "@gold-work/shared";
import {splitReadyScriptNarration} from "../src/ready-script.js";

const directory = process.env.GW_LONG_DIRECTORY!;
assert.ok(directory);
const input = JSON.parse(await readFile(join(directory, "input.json"), "utf8"));
const full = await readFile(join(directory, "result.json"), "utf8").then(text => JSON.parse(text) as {result: ReferenceAnalysis; originalScript?: string}).catch(error => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});
const scenes: Scene[] = full?.result.scenes ?? JSON.parse(await readFile(join(directory, "scenes.json"), "utf8"));
const anchor = input.masterPrompt.match(/MAKSIM,.*?left wrist\./s)?.[0]?.replace(/\.$/, "");
const cleanPositive = (prompt: string) => prompt.replace(/\b(?:no|without|avoid)\b[^.;\n]*/gi, "");
const flags = (pattern: RegExp) => scenes.filter(scene => pattern.test(cleanPositive(scene.imagePrompt))).map(scene => scene.order + 1);
const durations = scenes.map(scene => scene.durationSeconds).sort((a, b) => a - b);
const narration = scenes.map(scene => scene.narration).join("");
const visibleHero = scenes.filter(scene => /\bmaksim\b/i.test(scene.imagePrompt
  .replace(/\b(?:different from|unlike|not|without)\s+MAKSIM\b/gi, "")));
const metrics = {
  complete: Boolean(full), frames: scenes.length, narrationCharacters: countNarrationCharacters(narration),
  estimatedSpeechSeconds: countNarrationCharacters(narration) / input.charactersPerSecond,
  timelineSeconds: durations.reduce((sum, value) => sum + value, 0),
  durationMin: durations[0], durationMedian: durations[Math.floor(durations.length / 2)], durationMax: durations.at(-1),
  over8: durations.filter(value => value > 8).length, over9: durations.filter(value => value > 9).length,
  missingVisuals: scenes.filter(scene => !scene.imagePrompt.trim() || !scene.animationPrompt.trim()).map(scene => scene.order + 1),
  heroFrames: visibleHero.length, heroAnchorMissing: visibleHero.filter(scene => !anchor || !scene.imagePrompt.includes(anchor)).map(scene => scene.order + 1),
  possibleSplitCollage: flags(/\bsplit[ -]?(?:screen|view)\b|\bcollage\b|\binfographic\b/i),
  possibleVisibleText: flags(/\b(?:readable|written|text|lettering|labelled|labeled|caption|numerals|digits|equation|numbers)\b/i),
  possible3D: flags(/\b3d\b|\bphotorealistic\b/i),
  exactReadyText: full?.originalScript === undefined ? undefined : narration === full.originalScript,
  sceneNumbersSequential: scenes.every((scene, index) => scene.order === index),
  uniqueImagePrompts: new Set(scenes.map(scene => scene.imagePrompt.toLowerCase())).size
};
if (full?.originalScript) {
  const local = splitReadyScriptNarration(full.originalScript, {charactersPerSecond: input.charactersPerSecond}, 5);
  assert.deepEqual(scenes.map(scene => [scene.narration, scene.durationSeconds]), local.map(scene => [scene.narration, scene.durationSeconds]));
}
await writeFile(join(directory, "audit.json"), JSON.stringify(metrics, null, 2));
// Full review-friendly prompt sheet: repeated 500-character anchor is replaced, content is not truncated.
await writeFile(join(directory, "prompt-review.txt"), scenes.map(scene => `${scene.order + 1}. ${scene.title} [${scene.durationSeconds}s]\n${scene.narration.trim()}\nIMAGE: ${anchor ? scene.imagePrompt.replace(anchor, "[MAKSIM]") : scene.imagePrompt}\nMOVE: ${scene.animationPrompt}`).join("\n\n"));
console.log(JSON.stringify(metrics));
