import { createHash } from "node:crypto";
import { countNarrationCharacters, createDocumentarySettings, type DocumentaryRequirement, type Project, type Scene, type VoiceCalibration } from "@gold-work/shared";
import { splitReadyScriptNarration } from "./ready-script.js";

/** Literal proper-name candidates, never a generic replacement for a named subject. */
export function documentaryEntities(text: string): string[] {
  const names = text.match(/\b(?:SS|USS|RMS|HMS)\.?\s+[A-Z][a-zA-Z0-9]+(?:\s+(?:[A-Z][a-zA-Z0-9]+|of|the)){0,4}\b|\b[A-Z][a-zA-Z0-9]+(?:\s+(?:of|the|de|van|von))?\s+[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2}\b|\b[A-Z][a-z]+\s+of\s+the\s+[A-Z][a-z]+\b/gu) ?? [];
  const ignored = /^(?:The|This|That|But|In|On|At|From|By|With|And|For|Today|When|Why|How|What|It|Its|They|We|A|An)\s/u;
  return [...new Set(names.map(name => name.replace(ignored, "")).filter(name => name.includes(" ")))].sort((a, b) => b.length - a.length);
}
export function documentaryRequirement(text: string, knownEntities: string[], previousEntities: string[] = []): DocumentaryRequirement {
  const lower = text.toLowerCase();
  const explicit = knownEntities.filter(name => lower.includes(name.toLowerCase()));
  // Preserve referential context visibly in the editable search requirement. It still needs review.
  const entities = explicit.length ? explicit : [...previousEntities];
  const years = [...new Set(text.match(/\b(?:18|19|20)\d{2}\b/gu) ?? [])];
  const detail = /\b(?:engine|turbine|propeller|bridge|funnel|deck|interior|hull|blueprint|document|control|dashboard|screen|wheel|port|launch|construction|wreck|restoration)\w*\b/iu.exec(text)?.[0];
  const queries = entities.length ? entities.flatMap(name => [
    [name, detail, ...years].filter(Boolean).join(" "), name
  ]) : [text.replace(/\s+/gu, " ").trim().slice(0, 120)];
  return { text, entities, years, queries: [...new Set(queries)], detail };
}

export function prepareDocumentaryScript(project: Project, calibration: VoiceCalibration): Scene[] {
  if (project.mediaMode !== "stock" || project.settings.assembly.documentary?.version !== 2) throw new Error("Проект не использует Stock Documentary v2");
  const script = project.videoBrief?.readyScript ?? "";
  const settings = project.settings.assembly.documentary ?? createDocumentarySettings();
  const existing = [...project.scenes].sort((a,b) => a.order-b.order);
  // New editing defaults must never repartition paid narration or saved edits.
  if (existing.length && existing.every(scene => scene.documentary?.version === 2)
    && existing.map(scene => scene.narration).join("") === script
    && existing.some(scene => scene.audioPath || scene.documentary?.selected || scene.documentary?.pinned || scene.documentary?.requirement.plannedBy === "semantic")) return existing;
  // A production unit is a readable phrase, not every visual beat. Two-second
  // units multiplied TTS/search/vision calls and left no time to read graphics.
  const target = { calm: 7.5, balanced: 6.5, dynamic: 5.5 }[settings.pace];
  // AI Story's splitter intentionally allows a whole sentence up to eight seconds.
  // Documentary cuts also split long sentences at word boundaries for the selected pace.
  const split = splitReadyScriptNarration(script, calibration, target).flatMap(chunk => {
    if (chunk.durationSeconds <= target * 1.3) return [chunk];
    const tokens = chunk.narration.match(/\s+|\S+\s*/gu) ?? [];
    const groups: string[] = []; let current = "";
    for (const token of tokens) {
      if (current && countNarrationCharacters(current + token) / calibration.charactersPerSecond > target * 1.12
        && countNarrationCharacters(current) / calibration.charactersPerSecond >= target * .65) {
        groups.push(current); current = "";
      }
      current += token;
    }
    if (current) groups.push(current);
    if (groups.length > 1 && countNarrationCharacters(groups.at(-1)!) / calibration.charactersPerSecond < 1.1) {
      const tail = groups.pop()!; groups[groups.length - 1] += tail;
    }
    const total = groups.reduce((sum, text) => sum + countNarrationCharacters(text), 0);
    return groups.map(narration => ({ narration, durationSeconds: chunk.durationSeconds * countNarrationCharacters(narration) / total }));
  });
  const chunks: typeof split = [];
  for (const chunk of split) {
    const previous = chunks.at(-1);
    if (previous && (chunk.durationSeconds < 1.1 || previous.durationSeconds < 1.1)) {
      previous.narration += chunk.narration;
      previous.durationSeconds += chunk.durationSeconds;
    } else chunks.push({ ...chunk });
  }
  const names = documentaryEntities(script);
  const prior = new Map<string, Scene[]>();
  for (const scene of project.scenes) prior.set(scene.narration, [...prior.get(scene.narration) ?? [], scene]);
  let previousEntities: string[] = [];
  const result = chunks.map((chunk, index): Scene => {
    const id = `doc-${createHash("sha256").update(`${index}:${chunk.narration}`).digest("hex").slice(0, 20)}`;
    const requirement = documentaryRequirement(chunk.narration, names, previousEntities);
    previousEntities = requirement.entities;
    const existing = prior.get(chunk.narration)?.shift();
    // Exact same text/boundaries keep accepted media, TTS and editor checkpoints on resume.
    if (existing?.documentary?.version === 2 && existing.narration === chunk.narration) return { ...existing, order: index };
    return {
      id, order: index, title: chunk.narration.replace(/\s+/gu, " ").trim().slice(0, 70), narration: chunk.narration,
      stockQuery: requirement.queries[0], imagePrompt: "", animationPrompt: "", durationSeconds: chunk.durationSeconds, status: "draft",
      sourceVolume: 0, kenBurnsZoom: 1.06,
      visualBeats: [{ id: `${id}-visual`, sceneId: id, order: 0, startSeconds: 0, durationSeconds: chunk.durationSeconds,
        role: requirement.detail === "document" || requirement.detail === "blueprint" ? "evidence" : "explain", template: "full-media",
        overlay: "none", dimming: "none", motion: index % 2 === 0 ? "push-in" : "pull-out", transition: "hard", relatedToPrevious: false }],
      documentary: { version: 2, requirement, candidates: [], verified: false, pinned: false, illustrative: false, reviewNote: "",
        caption: { text: "", enabled: false, position: "bottom", animation: "fade", fontSize: 52, color: settings.textColor, backgroundColor: "#12171d", opacity: 80 },
        layout: "full", effects: [] }
    };
  });
  if (result.map(scene => scene.narration).join("") !== script) throw new Error("Нарушена целостность исходного сценария");
  return result;
}
