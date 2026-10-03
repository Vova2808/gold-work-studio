export const EFFECT_CATEGORIES = ["background", "particles", "smoke", "light-leak", "transition", "riser", "impact", "subdrop", "glitch", "keyboard", "click", "ding", "dramatic", "review"] as const;
export type EffectCategory = typeof EFFECT_CATEGORIES[number];
export type EffectBlend = "normal" | "screen" | "add" | "multiply";
export interface EffectDefaults {
  blend: EffectBlend;
  opacity: number;
  volume: number;
  sourceAudio: boolean;
  trimStartSeconds: number;
  trimEndSeconds?: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}
export interface EffectAsset {
  id: string;
  version: 1;
  checksum: string;
  name: string;
  kind: "image" | "video" | "audio";
  category: EffectCategory;
  tags: string[];
  favorite: boolean;
  automatic: boolean;
  review: "pending" | "approved" | "rejected";
  rights: "unknown" | "user-confirmed";
  rightsNote: string;
  /** Paths relative to Library; originalPath is attribution, never a playback dependency. */
  file: string;
  origins: { originalPath: string; pack: string }[];
  bytes: number;
  metadata?: {
    durationSeconds: number; width?: number; height?: number; fps?: number;
    videoCodec?: string; audioCodec?: string; hasAudio: boolean; hasAlpha: boolean;
    peakDb?: number; meanDb?: number;
    /** First strong 50 ms RMS transient, in source seconds; aligns automatic accents. */
    accentSeconds?: number;
  };
  poster?: string;
  preview?: string;
  waveform?: string;
  proxy?: string;
  state: "copied" | "ready" | "error";
  error?: string;
  defaults: EffectDefaults;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
export type UpdateEffectInput = Pick<EffectAsset, "name" | "category" | "tags" | "favorite" | "automatic" | "review" | "rights" | "rightsNote" | "defaults">;
export interface EffectImportProgress {
  id: string;
  status: "scanning" | "importing" | "complete" | "cancelled" | "error";
  roots: string[];
  total: number;
  processed: number;
  added: number;
  duplicates: number;
  ignored: number;
  bytes: number;
  current?: string;
  errors: { path: string; message: string }[];
  startedAt: string;
  updatedAt: string;
}
export interface EffectLibrarySnapshot {
  rootPath: string;
  assets: EffectAsset[];
  importProgress?: EffectImportProgress;
}
export interface EffectLibraryApi {
  getEffectLibrary(): Promise<EffectLibrarySnapshot>;
  chooseEffectFolders(): Promise<string[]>;
  importEffectFolders(roots: string[]): Promise<EffectImportProgress>;
  cancelEffectImport(): Promise<void>;
  updateEffect(id: string, input: UpdateEffectInput): Promise<EffectAsset>;
  analyzeEffect(id: string): Promise<{ suitable: boolean; description: string }>;
  trashEffect(id: string, deleted: boolean): Promise<EffectAsset>;
  openEffectLibrary(): Promise<void>;
  onEffectImportProgress(listener: (progress: EffectImportProgress) => void): () => void;
}
