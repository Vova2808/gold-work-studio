import type { DocumentaryRequirement, Project, Scene } from "@gold-work/shared";

export function documentaryComparisonSubjects(requirement: DocumentaryRequirement): string[] {
  // Keep elliptical comparisons such as "one fifth longer."; an adjective
  // inside "an alternative longer route" does not itself request two panels.
  return requirement.entities.length === 2 && /\bboth\b|compar(?:e|ison)|contrast|differences?\s+between|different\s+from|side.by.side|\bbeside\b|\b(?:longer|shorter|larger|smaller|wider|taller)(?:\s+than\b|\s*[.!?](?:\s|$)|\s*$)|сравн|отлич\S*\s+(?:от|между)|длиннее|короче|шире|выше|в отличие от/iu.test(`${requirement.detail ?? ""} ${requirement.text}`) ? requirement.entities : [];
}

/** An editorial relation is a layout instruction, not an unrelated stock subject. */
export function groundDocumentaryScenes(scenes: Scene[]): Scene[] {
  let previous: DocumentaryRequirement | undefined;
  let previousNarration = "";
  return [...scenes].sort((a, b) => a.order - b.order).map(scene => {
    const doc = scene.documentary;
    if (!doc || doc.requirement.plannedBy !== "semantic") return scene;
    let requirement = doc.requirement;
    const continuesSentence = Boolean(previousNarration.trim()) && !/[.!?]["'”’)]*\s*$/.test(previousNarration);
    const reference = continuesSentence || /\b(?:neither|both|these|those|their|its)\b|^(?:she|he|they|it|this|that)\b|\bthe (?:ship|car|aircraft|building|machine|animal|person)(?:'s)?\b/i.test(scene.narration.trim());
    const abstract = /temporal transition|timeline|design philosophy|conceptual|abstract|passage of time/i.test(`${requirement.detail} ${requirement.queries.join(" ")}`);
    // The full-script semantic pass already resolved the referent, including
    // an explicit [] for a new general subject. A local fragment heuristic
    // must not overwrite that answer with the last named part many scenes ago.
    const resolvedContext = requirement.identityContextVersion === 3 && Array.isArray(requirement.identities);
    const missingContext = !resolvedContext && !doc.pinned && !requirement.entities.length && Boolean(previous?.entities.length) && (reference || abstract);
    if (missingContext) {
      requirement = { ...requirement, entities: previous!.entities, identities: previous!.identities, queries: previous!.entities.slice(0, 3),
        preferredKind: reference ? requirement.preferredKind : "image",
        detail: `View of ${previous!.entities.join(" / ")} for the original narration's continuing reference` };
    }
    if (!doc.verified && !doc.pinned) {
      const years = [...new Set([...requirement.years, ...scene.narration.match(/\b(?:18|19|20)\d{2}\b/g) ?? []])];
      requirement = { ...requirement, years };
    }
    if (requirement.entities.length || resolvedContext) previous = requirement;
    previousNarration = scene.narration;
    const reviewNote = "Уточнён объект из предыдущей реплики. Материал, одобренный без этого контекста, требует повторной проверки.";
    return { ...scene, documentary: { ...doc, requirement, ...(missingContext && doc.verified ? {
      verified: false, reviewNote, autoError: reviewNote,
      visualReview: doc.visualReview ? { ...doc.visualReview, status: "uncertain", reason: reviewNote } : undefined
    } : {}) } };
  });
}

/** Each side retains its own reviewed source, trim and provenance. */
export function planDocumentaryComparisons(project: Project): Scene[] {
  const uses = new Map<string, number>();
  for (const scene of project.scenes) if (scene.documentary?.comparison) {
    const id = scene.documentary.comparison.sceneId; uses.set(id, (uses.get(id) ?? 0) + 1);
  }
  return project.scenes.map(scene => {
    const doc = scene.documentary;
    if (!doc?.verified || doc.pinned || doc.comparison) return scene;
    const subjects = documentaryComparisonSubjects(doc.requirement);
    // Older plans treated "an alternative longer route" as a side-by-side
    // instruction. Undo only that unfinished automatic layout, identified by
    // this function's own error. Saved comparisons and pinned choices stay intact.
    if (!subjects.length && doc.layout === 'compare' && doc.autoError?.startsWith('Для сравнения нужен отдельно проверенный материал: ')) {
      return { ...scene, documentary: { ...doc, layout: 'full', autoError: undefined } };
    }
    const own = doc.visualReview?.identifiedEntity;
    if (!own || !subjects.includes(own)) return scene;
    const target = subjects.find(entity => entity !== own)!;
    const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const other = project.scenes.filter(candidate => candidate.id !== scene.id && candidate.includeInAssembly !== false && candidate.documentary?.verified && (candidate.imagePath || candidate.videoPath)
      && (candidate.documentary.visualReview?.identifiedEntity === target || candidate.documentary.requirement.entities.length === 1 && candidate.documentary.requirement.entities[0] === target)
      && normalize(`${candidate.documentary.selected?.title} ${candidate.documentary.selected?.description}`).includes(normalize(target)))
      .sort((a, b) => (uses.get(a.id) ?? 0) - (uses.get(b.id) ?? 0) || Math.abs(a.order - scene.order) - Math.abs(b.order - scene.order))[0];
    if (other) uses.set(other.id, (uses.get(other.id) ?? 0) + 1);
    return { ...scene, documentary: { ...doc, layout: "compare", comparison: other ? { sceneId: other.id, leftLabel: own, rightLabel: target } : undefined,
      autoError: other ? undefined : `Для сравнения нужен отдельно проверенный материал: ${target}` } };
  });
}
