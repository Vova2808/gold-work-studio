import { createDefaultProjectSettings, createDocumentarySettings, type DocumentaryMontageSettings, type ProjectSettings } from "@gold-work/shared";

export const stockMontagePresets = [
  { id: "expressive", label: "Выразительный", style: "editorial", intensity: "rich",
    description: "Больше смен композиций, движений и графических акцентов по смыслу.", detail: "Для историй с насыщенным визуальным рядом" },
  { id: "calm", label: "Спокойный", style: "clean", intensity: "calm",
    description: "Дольше держит основной материал в кадре, мягче движения, реже графика и переходы.", detail: "Для размеренного рассказа и внимательного просмотра" },
] as const satisfies ReadonlyArray<{ id: string; label: string; style: DocumentaryMontageSettings["style"]; intensity: DocumentaryMontageSettings["intensity"]; description: string; detail: string }>;
export type StockMontagePreset = typeof stockMontagePresets[number]["id"];

export function stockVideoTarget(value: number | undefined): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value! : 60));
}

/** Only explicit selection applies a preset. Opening legacy projects is read-only. */
export function applyStockMontagePreset(assembly: ProjectSettings["assembly"], id: StockMontagePreset): ProjectSettings["assembly"] {
  const choice = stockMontagePresets.find(item => item.id === id)!;
  const doc = assembly.documentary;
  if (!doc) return assembly;
  return {
    ...assembly, kenBurns: true, kenBurnsDirection: "smart", fadeTransitions: false, transitionType: "none",
    documentary: {
      ...doc, autoMotionGraphics: true, autoTransitions: true, montageDensity: choice.intensity, excludedTemplates: [],
      montage: { ...doc.montage, version: 1, style: choice.style, intensity: choice.intensity, hookSeconds: doc.montage?.hookSeconds ?? 30 },
    },
  };
}

export function selectedStockMontagePreset(assembly: ProjectSettings["assembly"]): StockMontagePreset | undefined {
  const doc = assembly.documentary;
  if (!doc?.montage || !assembly.kenBurns || assembly.kenBurnsDirection !== "smart"
    || assembly.fadeTransitions || (assembly.transitionType ?? "none") !== "none"
    || doc.autoMotionGraphics === false || doc.autoTransitions === false || doc.excludedTemplates?.length) return undefined;
  return stockMontagePresets.find(item => item.style === doc.montage!.style && item.intensity === doc.montage!.intensity)?.id;
}

/** Add the required identity when a legacy project first chooses a background/music policy. */
export function stockMontageSettings(assembly: ProjectSettings["assembly"]): DocumentaryMontageSettings {
  const doc = assembly.documentary;
  return doc?.montage ?? {
    version: 1,
    style: doc?.montageDensity === "calm" || (doc?.montageDensity === undefined && doc?.pace === "calm") ? "clean" : "editorial",
    intensity: doc?.montageDensity ?? (doc?.pace === "calm" ? "calm" : "rich"),
    hookSeconds: 30,
  };
}

export function patchStockMontage(assembly: ProjectSettings["assembly"], patch: Partial<DocumentaryMontageSettings>): ProjectSettings["assembly"] {
  if (!assembly.documentary) return assembly;
  return { ...assembly, documentary: { ...assembly.documentary, montage: { ...stockMontageSettings(assembly), ...patch } } };
}

export type StockMusicPolicy = NonNullable<DocumentaryMontageSettings["musicPolicy"]>;

export function selectedStockMusicPolicy(settings: Pick<ProjectSettings, "assembly" | "music">): StockMusicPolicy {
  const policy = settings.assembly.documentary?.montage?.musicPolicy;
  if (policy) return policy;
  return settings.music.enabled !== false && (settings.music.clips !== undefined || settings.music.path) ? "preserve" : "off";
}

export function stockMusicPolicyPatch(settings: Pick<ProjectSettings, "assembly" | "music">, policy: StockMusicPolicy): Pick<ProjectSettings, "assembly" | "music"> {
  return {
    assembly: patchStockMontage(settings.assembly, { musicPolicy: policy }),
    // This helper runs only for an explicit mode choice. Routine assembly keeps
    // authored clips and intentional silence protected by manualEdits / [].
    music: { ...settings.music, enabled: policy !== "off", selectionStatus: undefined, selectionMessage: undefined,
      ...(policy === "automatic" ? {manualEdits:undefined,clips:undefined,path:undefined,name:undefined,assetId:undefined,sourcePage:undefined} : {}) },
  };
}

/** A manual editor file choice wins over automatic music; changing volume alone does not. */
export function stockMusicEditorAssembly(settings: Pick<ProjectSettings, "assembly" | "music">, music: ProjectSettings["music"]): ProjectSettings["assembly"] {
  if (music.enabled === false && settings.music.enabled !== false) return patchStockMontage(settings.assembly, { musicPolicy: "off" });
  if (music.manualEdits || music.clips?.length === 0 || music.path !== settings.music.path || (music.enabled !== false && settings.music.enabled === false)) return patchStockMontage(settings.assembly, { musicPolicy: "preserve" });
  return settings.assembly;
}

export function stockMusicEditorPatch(settings: Pick<ProjectSettings, "assembly" | "music">, music: ProjectSettings["music"]): Pick<ProjectSettings, "assembly" | "music"> {
  return {
    assembly: stockMusicEditorAssembly(settings, music),
    music: music.path !== settings.music.path
      ? { ...music, assetId: undefined, selectionStatus: undefined, selectionMessage: undefined }
      : music,
  };
}

export type StockCreationSettings = Pick<ProjectSettings, "assembly" | "music" | "stockVideoPercent">;

/** Creation only. Never run this as a migration when opening an existing project. */
export function createStockWorkflowSettings(): StockCreationSettings {
  const defaults = createDefaultProjectSettings();
  const assembly = patchStockMontage(applyStockMontagePreset({ ...defaults.assembly, documentary: createDocumentarySettings() }, "expressive"), { graphicsDensity: "sparse" });
  return {
    stockVideoPercent: stockVideoTarget(defaults.stockVideoPercent),
    ...stockMusicPolicyPatch({ assembly: patchStockMontage(assembly, { background: { mode: "automatic" } }), music: defaults.music }, "automatic"),
  };
}
