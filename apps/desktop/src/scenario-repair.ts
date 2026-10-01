import {createHash} from "node:crypto";
import type {Project, Scene, ScenarioRepairCheckpoint} from "@gold-work/shared";

export const SCENARIO_REPAIR_SINGLE_LIMIT = 25;
export const SCENARIO_REPAIR_BATCH_SIZE = 12;
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function scenarioRepairSourceFingerprint(scenes: Scene[]): string {
  return fingerprint(scenes.map(scene => [scene.id, scene.order, scene.durationSeconds, scene.title, scene.narration,
    scene.imagePrompt, scene.stockQuery, scene.animationPrompt, scene.includeInAssembly]));
}

export const scenarioRepairContextFingerprint = fingerprint;

export interface ScenarioRepairContract {
  chronology: string[];
  inventory: string[];
  continuityRules: string[];
  endingResolution: string;
  sceneBeats: Array<{sceneNumber: number; beat: string}>;
}

export function parseScenarioRepairContract(text: string, fromIndex: number, total: number): ScenarioRepairContract {
  const value = JSON.parse(text) as ScenarioRepairContract;
  if (!value || ![value.chronology, value.inventory, value.continuityRules].every(items => Array.isArray(items) && items.every(item => typeof item === "string"))
    || !value.chronology.length || typeof value.endingResolution !== "string" || !value.endingResolution.trim()
    || !Array.isArray(value.sceneBeats) || value.sceneBeats.length !== total
    || value.sceneBeats.some((item, index) => !item || item.sceneNumber !== fromIndex + index + 1 || typeof item.beat !== "string" || !item.beat.trim() || item.beat.length > 1000)) {
    throw new Error("AnyModel не вернул полный последовательный покадровый план исправления");
  }
  return value;
}

/** Track our last committed draft, not an obsolete snapshot captured before a long request. */
export function createScenarioDraftGuard(scenes: Scene[]) {
  let expected = scenarioRepairSourceFingerprint(scenes);
  return {
    assertCurrent(current: Pick<Project, "scenes">): void {
      if (scenarioRepairSourceFingerprint(current.scenes) !== expected) {
        throw new Error("Сценарий изменился во время исправления. Ручные правки сохранены и не перезаписаны; повторите проверку новой версии");
      }
    },
    saved(next: Scene[]): void { expected = scenarioRepairSourceFingerprint(next); }
  };
}

export function validScenarioRepairCheckpoint(state: ScenarioRepairCheckpoint | undefined, scenes: Scene[], contextFingerprint: string): state is ScenarioRepairCheckpoint {
  if (!state || state.version !== 1 || state.sourceSceneCount !== scenes.length
    || state.sourceFingerprint !== scenarioRepairSourceFingerprint(scenes) || state.contextFingerprint !== contextFingerprint
    || !Number.isInteger(state.fromIndex) || state.fromIndex < 0 || state.fromIndex >= scenes.length
    || typeof state.continuityContract !== "string" || !state.continuityContract.trim() || state.continuityContract.length > 40_000
    || !state.plan || !Array.isArray(state.plan.sections) || state.plan.sections.length === 0
    || !Array.isArray(state.plan.continuityRules) || !Array.isArray(state.plan.requiredBeats)
    || typeof state.plan.endingResolution !== "string"
    || !state.audit || !Array.isArray(state.audit.missingRequiredBeats) || !Array.isArray(state.audit.unresolvedSetups)
    || !Number.isInteger(state.audit.rewriteFromScene) || state.audit.rewriteFromScene < 1 || state.audit.rewriteFromScene > scenes.length
    || !Array.isArray(state.completedScenes) || state.completedScenes.length > scenes.length - state.fromIndex) return false;
  try { parseScenarioRepairContract(state.continuityContract, state.fromIndex, scenes.length - state.fromIndex); }
  catch { return false; }
  return state.completedScenes.every((scene,index) => {
    const original = scenes[state.fromIndex + index];
    return scene && original && scene.id === original.id && scene.order === original.order && scene.durationSeconds === original.durationSeconds
      && typeof scene.narration === "string" && Boolean(scene.narration.trim())
      && typeof scene.imagePrompt === "string" && Boolean(scene.imagePrompt.trim())
      && typeof scene.animationPrompt === "string" && Boolean(scene.animationPrompt.trim())
      && !scene.imagePath && !scene.videoPath && !scene.audioPath;
  });
}

/** Main-process checkpoint: do not publish a mixed repaired/old story as the user's script. */
export function scenarioRepairCheckpointPatch(project: Project, state: ScenarioRepairCheckpoint | undefined): Pick<Project,"referenceAnalysis" | "status"> {
  if (!project.referenceAnalysis) throw new Error("Сценарный черновик отсутствует; исправление не сохранено");
  if (state && (project.status !== "draft" || scenarioRepairSourceFingerprint(project.scenes) !== state.sourceFingerprint)) {
    throw new Error("Сценарий изменился во время исправления. Новая версия не перезаписана");
  }
  return {status:"draft",referenceAnalysis:{...project.referenceAnalysis,scenarioQuality:undefined,scenarioRepair:state}};
}
