import assert from "node:assert/strict";
import test from "node:test";
import type { Scene, VisualBeat } from "@gold-work/shared";
import {
  applyMontagePlanToScenes,
  createLocalMontagePlan,
  sanitizeMontagePlan,
  validateAiMontageProposal
} from "./montage-planner.js";

function scenes(count = 23, durationSeconds = 8): Scene[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `scene-${index + 1}`,
    order: index,
    title: `Часть ${index + 1}: автомобиль и водитель`,
    imagePrompt: "car driving on road",
    stockQuery: index % 2 === 0 ? "car driving road" : "driver inside car",
    animationPrompt: "slow camera move",
    narration: `Водитель продолжает путь, а автомобиль раскрывает новую деталь номер ${index + 1}.`,
    durationSeconds,
    status: "ready"
  }));
}

function maximumRun<T>(values: readonly T[]): number {
  let maximum = 0;
  let current = 0;
  let previous: T | undefined;
  for (const value of values) {
    current = value === previous ? current + 1 : 1;
    maximum = Math.max(maximum, current);
    previous = value;
  }
  return maximum;
}

test("local planner creates denser balanced beats and preserves exact scene duration", () => {
  const input = scenes();
  const plan = createLocalMontagePlan(input);

  assert.equal(plan.stats.sceneCount, input.length);
  assert.ok(plan.stats.beatCount >= 45 && plan.stats.beatCount <= 55, `unexpected beat count ${plan.stats.beatCount}`);
  for (const scene of input) {
    const beats = plan.beatsByScene[scene.id]!;
    assert.ok(beats.length >= 1 && beats.length <= 5);
    assert.equal(Number(beats.reduce((sum, beat) => sum + beat.durationSeconds, 0).toFixed(3)), scene.durationSeconds);
    assert.equal(beats[0]!.startSeconds, 0);
    for (let index = 1; index < beats.length; index += 1) {
      assert.equal(
        beats[index]!.startSeconds,
        Number((beats[index - 1]!.startSeconds + beats[index - 1]!.durationSeconds).toFixed(3))
      );
    }
  }

  assert.deepEqual(plan.beats.slice(0, 4).map((beat) => beat.durationSeconds), [2, 2, 2, 2]);
});

test("63-second narration gets VidRush-like cadence with density-specific local caps", () => {
  const input = scenes(4, 15.825);
  const calm = createLocalMontagePlan(input, { density: "calm" });
  const balanced = createLocalMontagePlan(input, { density: "balanced" });
  const dynamic = createLocalMontagePlan(input, { density: "dynamic" });

  assert.ok(calm.beatsByScene[input[0]!.id]!.length <= 4);
  assert.ok(balanced.beatsByScene[input[0]!.id]!.length <= 5);
  assert.ok(dynamic.beatsByScene[input[0]!.id]!.length <= 6);
  assert.ok(balanced.stats.beatCount > 12, `expected more than 12 beats, got ${balanced.stats.beatCount}`);
  assert.ok(dynamic.stats.beatCount > balanced.stats.beatCount);
  for (const plan of [calm, balanced, dynamic]) {
    assert.equal(Number(plan.beats.reduce((sum, beat) => sum + beat.durationSeconds, 0).toFixed(3)), 63.3);
    assert.ok(plan.stats.graphicBeatPercent <= 35);
    assert.ok(plan.stats.hardCutPercent >= 70 && plan.stats.hardCutPercent <= 85);
  }
});

test("universal grammar caps graphics, prevents three identical templates and bounds transitions", () => {
  const plan = createLocalMontagePlan(scenes(), { graphicBeatPercent: 35, hardCutPercent: 78 });
  assert.ok(plan.stats.graphicBeatPercent <= 35);
  assert.ok(plan.stats.hardCutPercent >= 70 && plan.stats.hardCutPercent <= 85);
  assert.ok(maximumRun(plan.beats.map((beat) => beat.template)) <= 2);
  assert.ok(plan.beats.every((beat) => beat.transition !== "mix" || beat.relatedToPrevious));
  assert.equal(plan.beats[0]!.transition, "hard");
  assert.equal(plan.stats.fadeCount, 2);

  const allFullMedia = Object.fromEntries(scenes().map((scene) => [
    scene.id,
    Array.from({ length: 3 }, () => ({ template: "full-media" }))
  ]));
  const normalized = createLocalMontagePlan(scenes(), { aiProposals: allFullMedia });
  assert.ok(maximumRun(normalized.beats.map((beat) => beat.template)) <= 2);
});

test("bounded AI proposal ignores arbitrary code, timing, coordinates and unknown effects", () => {
  const fallback = {
    role: "explain",
    template: "full-media",
    overlay: "none",
    dimming: "none",
    motion: "push-in",
    transition: "hard"
  } as const;
  const result = validateAiMontageProposal({
    role: "superhero",
    template: "custom-react-component",
    overlay: "fact",
    dimming: "soft",
    motion: "spin-forever",
    transition: "wipe",
    durationSeconds: 999,
    x: -500,
    css: "position:fixed",
    react: "eval(userCode)"
  }, fallback);

  assert.deepEqual(result.proposal, {
    role: "explain",
    template: "full-media",
    overlay: "fact",
    dimming: "soft",
    motion: "push-in",
    transition: "hard"
  });
  assert.ok(result.issues.some((issue) => issue.includes("durationSeconds")));
  assert.ok(result.issues.some((issue) => issue.includes("allowlist")));
});

test("editorial templates are allow-listed and semantic-only cards are guarded", () => {
  const fallback = {
    role: "explain",
    template: "full-media",
    overlay: "none",
    dimming: "none",
    motion: "push-in",
    transition: "hard"
  } as const;
  assert.equal(validateAiMontageProposal({ template: "stat-callout" }, fallback).proposal.template, "stat-callout");
  assert.equal(validateAiMontageProposal({ template: "editorial-panel" }, fallback).proposal.template, "editorial-panel");
  assert.equal(validateAiMontageProposal({ template: "chapter-card" }, fallback).proposal.template, "chapter-card");
  assert.equal(validateAiMontageProposal({ template: "quote-card" }, fallback).proposal.template, "quote-card");
  assert.equal(validateAiMontageProposal({ template: "checklist-grid" }, fallback).proposal.template, "checklist-grid");

  const proseOnly = scenes().map((scene, index) => ({
    ...scene,
    title: `Сцена ${index + 1}: спокойная дорога`,
    narration: "Водитель спокойно продолжает путь и замечает важную перемену без числовой оценки."
  }));
  const numeric = proseOnly.map((scene) => ({
    ...scene,
    narration: "Расходы снизились на 25%, и это заметно меняет решение водителя."
  }));

  const numericPlan = createLocalMontagePlan(numeric, { graphicBeatPercent: 35 });
  assert.ok(numericPlan.beats.some((beat) => beat.template === "stat-callout"));

  const localProsePlan = createLocalMontagePlan(proseOnly, { graphicBeatPercent: 35 });
  assert.ok(localProsePlan.beats.every((beat) => beat.template !== "stat-callout"));
  assert.ok(localProsePlan.beats.some((beat) => beat.template === "editorial-panel"));

  const forcedStats = Object.fromEntries(proseOnly.map((scene) => [
    scene.id,
    Array.from({ length: 3 }, () => ({ template: "stat-callout" }))
  ]));
  const sanitized = createLocalMontagePlan(proseOnly, { graphicBeatPercent: 35, aiProposals: forcedStats });
  assert.ok(sanitized.beats.every((beat) => beat.template !== "stat-callout"));
  assert.ok(sanitized.issues.some((issue) => issue.includes("requires a number")));

  const proposalForEveryBeat = (input: Scene[], template: VisualBeat["template"]) => {
    const local = createLocalMontagePlan(input);
    return Object.fromEntries(input.map((scene) => [
      scene.id,
      Array.from({ length: local.beatsByScene[scene.id]!.length }, () => ({ template }))
    ]));
  };
  const forcedQuotes = createLocalMontagePlan(proseOnly, {
    graphicBeatPercent: 35,
    aiProposals: proposalForEveryBeat(proseOnly, "quote-card")
  });
  assert.ok(forcedQuotes.beats.every((beat) => beat.template !== "quote-card"));
  assert.ok(forcedQuotes.issues.some((issue) => issue.includes("explicit quotation")));

  const quoted = proseOnly.map((scene) => ({ ...scene, narration: "Он прямо сказал: «Старая машина может быть разумным выбором». Затем объяснил причину." }));
  const acceptedQuotes = createLocalMontagePlan(quoted, {
    graphicBeatPercent: 35,
    aiProposals: proposalForEveryBeat(quoted, "quote-card")
  });
  assert.ok(acceptedQuotes.beats.some((beat) => beat.template === "quote-card"));

  const forcedChecklists = createLocalMontagePlan(proseOnly, {
    graphicBeatPercent: 35,
    aiProposals: proposalForEveryBeat(proseOnly, "checklist-grid")
  });
  assert.ok(forcedChecklists.beats.every((beat) => beat.template !== "checklist-grid"));
  assert.ok(forcedChecklists.issues.some((issue) => issue.includes("explicit list or ordered process")));

  const ordinaryTwoSentenceProse = proseOnly.map((scene) => ({
    ...scene,
    narration: "Водитель изучил историю автомобиля и поговорил с владельцем. Машина выглядела ухоженной и спокойно прошла обычную проверку."
  }));
  const ordinaryTwoSentencePlan = createLocalMontagePlan(ordinaryTwoSentenceProse, {
    graphicBeatPercent: 35,
    aiProposals: proposalForEveryBeat(ordinaryTwoSentenceProse, "checklist-grid")
  });
  assert.ok(ordinaryTwoSentencePlan.beats.every((beat) => beat.template !== "checklist-grid"));

  const listed = proseOnly.map((scene) => ({ ...scene, narration: "Сначала проверяют историю автомобиля. Затем осматривают кузов и двигатель." }));
  const acceptedChecklists = createLocalMontagePlan(listed, {
    graphicBeatPercent: 35,
    aiProposals: proposalForEveryBeat(listed, "checklist-grid")
  });
  assert.ok(acceptedChecklists.beats.some((beat) => beat.template === "checklist-grid"));

  const forcedChapters = createLocalMontagePlan(proseOnly.slice(0, 6), {
    graphicBeatPercent: 35,
    aiProposals: proposalForEveryBeat(proseOnly.slice(0, 6), "chapter-card")
  });
  const allowedChapterScenes = new Set(["scene-1", "scene-3", "scene-5"]);
  assert.ok(forcedChapters.beats.filter((beat) => beat.template === "chapter-card").every((beat) => allowedChapterScenes.has(beat.sceneId)));
  assert.ok(forcedChapters.issues.some((issue) => issue.includes("hook or an act boundary")));
});

test("AI may tune allowlisted style, while validator restores timing and global grammar", () => {
  const input = scenes();
  const allGraphicAi = Object.fromEntries(input.map((scene) => [scene.id, Array.from({ length: 3 }, () => ({
    template: "focus-text",
    role: "emphasize",
    overlay: "quote",
    dimming: "strong",
    motion: "push-in",
    transition: "fade",
    durationSeconds: 1000
  }))]));
  const plan = createLocalMontagePlan(input, { graphicBeatPercent: 35, aiProposals: allGraphicAi });

  assert.ok(plan.stats.graphicBeatPercent <= 35);
  assert.ok(maximumRun(plan.beats.map((beat) => beat.template)) <= 2);
  assert.equal(plan.stats.fadeCount, 2);
  for (const scene of input) {
    assert.equal(
      Number(plan.beatsByScene[scene.id]!.reduce((sum, beat) => sum + beat.durationSeconds, 0).toFixed(3)),
      scene.durationSeconds
    );
  }
});

test("saved plan sanitizer restores missing beats and never trusts saved geometry", () => {
  const input = scenes(6, 9);
  const original = createLocalMontagePlan(input);
  const corruptBeat = {
    ...original.beatsByScene["scene-1"]![0],
    startSeconds: -100,
    durationSeconds: 999,
    transition: "mix"
  } as VisualBeat;
  const sanitized = sanitizeMontagePlan({ beatsByScene: { "scene-1": [corruptBeat] } }, input);

  assert.equal(sanitized.beatsByScene["scene-1"]![0]!.startSeconds, 0);
  assert.notEqual(sanitized.beatsByScene["scene-1"]![0]!.durationSeconds, 999);
  assert.equal(sanitized.beatsByScene["scene-1"]![0]!.transition, "hard");
  assert.equal(sanitized.stats.sceneCount, input.length);
  assert.ok(sanitized.issues.some((issue) => issue.includes("missing beat restored")));
});

test("same input yields byte-for-byte deterministic plan and can be persisted on scenes", () => {
  const input = scenes(8, 7);
  const first = createLocalMontagePlan(input);
  const second = createLocalMontagePlan(input);
  assert.deepEqual(first, second);

  const withBeats = applyMontagePlanToScenes(input, first);
  assert.deepEqual(withBeats[0]!.visualBeats, first.beatsByScene[input[0]!.id]);
  assert.notEqual(withBeats[0]!.visualBeats, first.beatsByScene[input[0]!.id]);
});
