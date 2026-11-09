import { projectScenarioQualityIssue, type Project } from "@gold-work/shared";

type ScenarioReviewProject = Pick<Project, "mediaMode" | "scenes" | "referenceAnalysis" | "videoBrief">;

export function isReadyStockScript(project: Pick<Project, "mediaMode" | "videoBrief">): boolean {
  return project.mediaMode === "stock"
    && project.videoBrief?.creationMode === "script"
    && Boolean(project.videoBrief.readyScript?.trim());
}

export function scenarioReviewBlockReason(project: ScenarioReviewProject): string | undefined {
  // The user's Stock narration needs scene preparation, not an editorial audit.
  if (isReadyStockScript(project)) return undefined;
  const issue = projectScenarioQualityIssue(project);
  if (!issue) return undefined;
  return issue === "stale"
    ? "Сценарий изменён после проверки. Откройте «Сценарий» и завершите проверку перед генерацией."
    : "Черновик сохранён, но финальная проверка сценария не завершена. Откройте «Сценарий» и нажмите «Продолжить проверку сценария».";
}
