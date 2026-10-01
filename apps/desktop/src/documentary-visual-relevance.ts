import type { DocumentaryCandidate, DocumentaryRequirement, Scene } from "@gold-work/shared";
import type { VideoSegment } from "./documentary-video-catalog.js";
import { documentaryComparisonSubjects } from "./documentary-comparison.js";

const words = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).map(word => word.replace(/s$/, ""));
const normalizedName = (name: string) => name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The flat-video renderer has no spherical projection conversion. Keep these
 * sources out of automatic selection instead of treating warped pixels as HD. */
export function documentaryProjectionIssue(candidate?: Pick<DocumentaryCandidate, "kind" | "title">): string | undefined {
  if (candidate?.kind === "video" && /\b360\s*(?:[°º]|degrees?\b|videos?\b|vr\b)|\b(?:equirectangular|spherical video|dual[- ]fisheye)\b|360\s*градус|сферическ\p{L}* видео/iu.test(candidate.title)) {
    return "Панорамное 360°-видео требует преобразования проекции и не подходит для автоматического плоского монтажа. Нужен обычный ракурс; исходник и голос сохранены.";
  }
}

/** An explicit list can be illustrated one member at a time. Relational
 * claims still need evidence of the relation, not an arbitrary list member. */
export function documentaryListsNamedSubjects(requirement: Pick<DocumentaryRequirement, "text" | "identities" | "detail">): boolean {
  const identities = requirement.identities;
  if (identities?.length !== 2) return false;
  const text = ` ${normalizedName(requirement.text)} `;
  if (/\b(?:between|connecting|alongside|together|versus|compar\w*|intersection|side.by.side)\b|между|соединя|вместе|рядом|на фоне|сравн/iu.test(`${requirement.text} ${requirement.detail ?? ""}`)) return false;
  const names = identities.map(identity => [identity.name, ...identity.aliases].map(normalizedName));
  return names[0]!.some(left => names[1]!.some(right => ["и", "and"].some(joiner => text.includes(` ${left} ${joiner} ${right} `) || text.includes(` ${right} ${joiner} ${left} `))));
}
export function documentaryIdentityNames(requirement: DocumentaryRequirement): string[] {
  return requirement.identities === undefined ? requirement.entities
    : requirement.identities.flatMap(identity => [identity.name, ...identity.aliases]);
}
export function documentaryIdentityMatches(requirement: DocumentaryRequirement, name: string): boolean {
  const actual = normalizedName(name);
  if (/\b(?:not|unknown|unidentified|possibly|maybe|probably)\b|неизвест|возможно|вероятно/iu.test(actual)) return false;
  return documentaryIdentityNames(requirement).some(alias => {
    const expected = normalizedName(alias);
    if (expected === actual) return true;
    // Vision often names the rider together with the vehicle. Permit a
    // complete name followed by a relation, not arbitrary substring matches
    // (M1 must not approve M1000, Panama must not approve Panama City).
    return expected.length > 2 && new RegExp(`(?:^|,\\s*|\\band\\s+|\\bи\\s+)${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|(?=,)|\\s+(?:on|in|at|with|riding|aboard|на|в|за|and|и)\\s+)`, 'u').test(
      name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N},]+/gu, ' ').trim());
  });
}

/** An automatic approval made without the newly resolved subject constraint
 * cannot silently approve that subject. Keep files/voice and manual pins. */
export function applyDocumentaryRequirement(scene: Scene, requirement: DocumentaryRequirement): Scene {
  const doc = scene.documentary;
  if (!doc || doc.pinned) return scene;
  const previousNames = (doc.requirement.identities ?? []).flatMap(identity => [identity.name, ...identity.aliases]).map(normalizedName);
  const addedSubject = requirement.identities?.some(identity => ![identity.name, ...identity.aliases].some(name => previousNames.includes(normalizedName(name))));
  return { ...scene, stockQuery: requirement.queries[0], documentary: { ...doc, requirement,
    ...(addedSubject && doc.verified ? { verified: false, autoError: "Уточнён именованный объект из контекста сценария. Сохранённый материал требует проверки этого объекта." } : {}) } };
}

/** Only explicit contradictions in an old verdict revoke approval locally.
 * Missing evidence is not silently upgraded to a new-policy visual approval. */
export function documentarySavedIdentityIssue(scene: Scene): string | undefined {
  const doc = scene.documentary;
  if (!doc?.verified || doc.pinned) return;
  const projectionIssue = documentaryProjectionIssue(doc.selected);
  if (projectionIssue) return projectionIssue;
  const actionIssue = documentaryActionReviewIssue(scene, doc.visualReview ?? {});
  if (actionIssue) return actionIssue;
  const contradiction = documentaryNarrationContradiction(doc.visualReview?.reason);
  if (contradiction) return contradiction;
  if (!doc.requirement.identities?.length) return;
  const reason = normalizedName(doc.visualReview?.reason ?? "");
  for (const name of documentaryIdentityNames(doc.requirement)) {
    const alias = normalizedName(name);
    if ([`not ${alias}`, `not the ${alias}`, `not of ${alias}`, `not footage of ${alias}`, `не ${alias}`, `вместо ${alias}`]
      .some(denial => ` ${reason} `.includes(` ${denial} `))) return "Сохранённая проверка прямо указывает другой именованный объект. Нужен новый подбор; исходник и голос сохранены.";
  }
}

/** Literal operations need separate ordered-frame evidence, beyond a place
 * match or a coarse catalog label. This detects the requirement, not pixels. */
export function documentaryGeneralActionIssue(scene: Pick<Scene, "narration">): string | undefined {
  const text = scene.narration.toLowerCase();
  if (/\b(?:cannot|must not|never|hypothetical)\b|нельзя|не следует|^\s*если показывать|^\s*if (?:we|you) (?:only )?show/.test(text)) return;
  if (/\b(?:dredg\w*|remov\w* sediment|gates? (?:clos\w*|open\w*)|(?:clos\w*|open\w*) (?:the )?gates?)\b|земснаряд|убира\p{L}* отложени|(?:открыва|закрыва)\p{L}* (?:следующие |массивные )?ворота|ворота\p{L}* (?:открыва|закрыва)/u.test(text)) {
    return "В озвучке названо конкретное действие, а каталог предлагает только общий план. Нужен читаемый предмет и действие; совпадения места недостаточно.";
  }
}

export function documentaryActionReviewIssue(scene: Scene, value: { actionMatch?: unknown; actionEvidence?: unknown }): string | undefined {
  if (!documentaryGeneralActionIssue(scene)) return;
  if (value.actionMatch !== true || typeof value.actionEvidence !== "string" || !value.actionEvidence.trim()) {
    return "Не подтверждено названное действие по реальным кадрам. Наличие нужного объекта или места не доказывает движение ворот/работу оборудования.";
  }
}

export function documentaryIdentityReviewIssue(requirement: DocumentaryRequirement, value: Record<string, unknown>): string | undefined {
  const contradiction = documentaryNarrationContradiction(value.reason);
  if (contradiction) return contradiction;
  if (!requirement.identities?.length) return;
  if (value.identityMatch !== true || !documentaryIdentityMatches(requirement, String(value.identifiedEntity ?? ""))) {
    return "Не подтверждён обязательный именованный объект; общая категория не заменяет нужное место или модель.";
  }
}

/** A high-confidence place match cannot override the review's own explicit
 * statement that the visible subject differs from what the narration names.
 * Do not reject benign comparisons such as "canal rather than open sea". */
function documentaryNarrationContradiction(reason: unknown): string | undefined {
  if (typeof reason === 'string' && /\b(?:rather than|instead of)\s+[^.!?\n]{1,100}\s+as\s+(?:narrated|requested|specified|described)\b/i.test(reason)) {
    return 'Проверка прямо указывает подмену предмета из озвучки. Совпадения места недостаточно; нужен другой материал.';
  }
}
const nearSample = (scene: Scene, range: VideoSegment) => {
  const duration = (scene.documentary?.timing?.durationInFrames ?? (scene.durationSeconds || 0) * 30) / 30;
  return duration > 0 ? Math.max(range.start,Math.min(range.end-duration,range.sample-duration/2)) : range.start;
};

function catalogSubjectEntities(segment: VideoSegment, catalog: VideoSegment[]): string[] {
  // Catalog vision also lists persistent broadcast logos as entities. A name
  // appearing across nearly every shot, but never in a shot description, is
  // not sufficient evidence that the depicted subject contradicts narration.
  // Keep it for the actual-frame reviewer; this filter never grants approval.
  const incidental = (entity: string) => {
    const name = normalizedName(entity);
    return catalog.length >= 3 && catalog.filter(other => other.entities.some(value => normalizedName(value) === name)).length >= Math.ceil(catalog.length * .8)
      && !catalog.some(other => ` ${normalizedName(other.description)} `.includes(` ${name} `));
  };
  return segment.entities.filter(entity => !incidental(entity));
}

/** A source title cannot establish identity when this actual part of a mixed
 * video names another subject. An unnamed adjacent shot stays ambiguous. */
export function documentaryCatalogIdentityConflict(scene: Scene, segment: VideoSegment, catalog: VideoSegment[]): boolean {
  const requirement=scene.documentary!.requirement;
  const wanted=documentaryIdentityNames(requirement);
  if(!wanted.length)return false;
  const matches=(entity:string)=>documentaryIdentityMatches(requirement,entity);
  if(segment.entities.some(matches))return false;
  const currentNames = catalogSubjectEntities(segment, catalog);
  const named=currentNames.length?currentNames:catalog.filter(other=>Math.abs(other.id-segment.id)===1&&Math.abs(other.sample-segment.sample)<10).flatMap(other=>catalogSubjectEntities(other,catalog));
  return named.length>0&&!named.some(matches);
}

/** Obvious distractions described by the saved vision catalog, not guessed from a title. */
export function documentaryDistraction(scene: Scene, description: string): string | undefined {
  const intent = `${scene.narration} ${scene.documentary?.requirement.detail ?? ""}`;
  if (/\b(?:belly|stomach|bare torso|feet|legs|lying on (?:their |his |her )?back)\b/i.test(description)
    && !/\b(?:body|anatomy|stomach|medical|patient|exercise|athlete|human feet|human legs)\b/i.test(intent)) return "Кадр занят телом/ногами оператора, а не предметом рассказа";
  if (/\b(?:toasting|drinking|selfie|vlogger|talking[- ]head)\b/i.test(description)
    && !/\b(?:drink|beer|bar|toast|passenger|people|visitor|tourist|vlog|interview|person|crew|celebrat)\w*\b/i.test(intent)) return "В центре кадра люди/напитки; нужный объект на фоне не иллюстрирует эту сцену";
}

/** A cheap shortlist, never an approval: five real frames still require vision. */
export function directCatalogChoices(scene: Scene, ranges: VideoSegment[]): Array<{ id: number; startSeconds: number }> {
  const req = scene.documentary!.requirement;
  const ignored = new Set([...documentaryIdentityNames(req).flatMap(words), "video", "footage", "photo", "view", "archive", "archival", "the", "and", "with", "detail"]);
  // Repeating category words ("cruise ship", "car", "building") do not
  // establish the requested detail such as propulsion, brakes or an entrance.
  const frequency=new Map<string,number>();
  for(const range of ranges)for(const word of new Set(words(range.description)))frequency.set(word,(frequency.get(word)??0)+1);
  for(const [word,count] of frequency)if(count>Math.max(2,ranges.length*.2))ignored.add(word);
  const details = [...new Set(words(`${req.detail ?? ""} ${req.queries[0] ?? ""}`))].filter(word => !ignored.has(word));
  return ranges.map((range, id) => {
    const visible = new Set(words(range.description));
    return { id, startSeconds: nearSample(scene,range), score: details.filter(word => visible.has(word)).length };
  }).filter(choice => choice.score >= 2).sort((a, b) => b.score - a.score).slice(0, 3).map(({ id, startSeconds }) => ({ id, startSeconds }));
}

/** Measurements need a clean view of the subject, not another model call to
 * choose a view "proving" the number. This still requires actual-frame vision. */
export function representativeCatalogChoices(scene: Scene, ranges: VideoSegment[]): Array<{ id: number; startSeconds: number }> {
  const requirement = scene.documentary!.requirement;
  const generalView = /\b(?:overview|general view|establishing|profile|silhouette|design philosophy|general characteristics)\b/i.test(requirement.detail ?? "");
  if (!generalView && requirement.motionGraphic?.kind !== "statistic" && !documentaryComparisonSubjects(requirement).length
    && !/\b(?:tons?|tonnage|mass|volume|length|width|height|weight|size|scale|dimensions?|larger|bigger|wider|taller|longer|heavier)\b/i.test(`${scene.narration} ${requirement.detail}`)) return [];
  const names = documentaryIdentityNames(requirement);
  const namedSource = names.some(wanted => scene.documentary?.selected?.title.toLowerCase().includes(wanted.toLowerCase()));
  return ranges.map((range,id)=>({id,startSeconds:nearSample(scene,range),description:range.description,
    // An unlabelled wide shot from a named source is worth checking, not an
    // approval. Contradictory catalogue identities were filtered earlier; the
    // five-frame visual check still establishes the actual visible subject.
    subject: !catalogSubjectEntities(range, ranges).length && namedSource || names.some(wanted=>range.entities.some(entity=>documentaryIdentityMatches(requirement,entity))||range.description.toLowerCase().includes(wanted.toLowerCase())),
    establishing: /\b(?:aerial|wide|profile|exterior|establishing|full[- ]length|side view|low angle)\b/i.test(range.description),
    score: (range.description.match(/\b(?:aerial|wide|profile|exterior|establishing|full[- ]length|side view|low angle)\b/gi)??[]).length
      + (namedSource ? 1 : 0)
      + (range.entities.some(entity=>documentaryIdentityMatches(requirement,entity))?2:0)
  })).filter(choice=>choice.subject && choice.establishing && choice.score>=2 && !documentaryDistraction(scene,choice.description)
    && !/\b(?:distant|obscured|signage|selfie|foreground people)\b/i.test(choice.description))
    .sort((a,b)=>b.score-a.score).slice(0,3).map(({id,startSeconds})=>({id,startSeconds}));
}

/** Rank proposals locally; a grouped actual-frame check decides suitability.
 * A word match alone never becomes a visual approval. */
export function proposedCatalogChoices(scene: Scene, ranges: VideoSegment[]): Array<{ id: number; startSeconds: number }> {
  const direct = directCatalogChoices(scene, ranges), representative = representativeCatalogChoices(scene, ranges);
  const req = scene.documentary!.requirement;
  const ignored = new Set([...documentaryIdentityNames(req).flatMap(words), "the", "and", "with", "video", "footage", "view", "shot"]);
  const detail = new Set(words(`${req.detail ?? ""} ${req.queries.join(" ")}`).filter(word => !ignored.has(word)));
  const ranked = ranges.map((range, id) => ({ id, startSeconds: nearSample(scene, range),
    score: words(range.description).reduce((score, word) => score + Number(detail.has(word)), 0)
      + Number(range.entities.some(entity => documentaryIdentityMatches(req, entity))) * 2 }));
  const seen = new Set<number>();
  return [...direct, ...representative, ...ranked.sort((a,b) => b.score-a.score)]
    .filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }).slice(0,3)
    .map(({id,startSeconds}) => ({id,startSeconds}));
}

export const documentarySubjectPolicy = " Editorial relevance: the narrated subject or its relevant detail must be the dominant readable subject, not an incidental logo or object behind foreground vloggers, people drinking, a selfie, a rider's belly or feet. Reject body-dominated POV and distracting foreground activity unless the narration specifically concerns that activity/body part. Abstract statistics do not require a visible ruler, but an unrelated activity in front of the object does not illustrate its size or engineering. Favor clean establishing/detail/action footage suitable for a documentary, not merely any shot filmed at the same location.";

export const documentaryRangeEditorialPolicy = " Before deciding relevance, independently inspect the entire image canvas, including borders, and add these JSON fields: mediaType (camera|render|still|uncertain), presentation (clean|promo|obscured|uncertain), physicalEvidence (brief visible evidence, not source metadata). Camera movement is NOT evidence of camera footage: CGI and animated stills also move. Look for physically plausible surroundings, support/waterline, lighting, surface detail and real parallax. A photorealistic animated cutaway, impossible floating/unsupported object or synthetic engineering visualization is render, even when a prior catalog calls it camera footage. A close view of a hull in a real dry dock can be camera footage when its real surroundings establish this. Judge pixels before using the title or neighboring catalog descriptions; do not repeat those descriptions as evidence. A video embedded in a promotional card with large black borders, calls to watch/subscribe/full video, or dominant unrelated editorial text is promo. Ordinary source watermarks and documentary archive markings alone are not promo. Accept only mediaType=camera AND presentation=clean. If either is uncertain do not approve.";

export function documentaryRangeEditorialIssue(value: Record<string, unknown>): string | undefined {
  if (value.mediaType !== "camera") return value.mediaType === "render"
    ? "Вместо натурной съёмки обнаружена компьютерная визуализация."
    : "Не подтверждено, что выбранный диапазон является натурной съёмкой.";
  if (value.presentation !== "clean") return value.presentation === "promo"
    ? "Рекламная карточка или крупные посторонние надписи вместо чистого футажа."
    : "Не подтверждена пригодность полного кадра для монтажа.";
}
