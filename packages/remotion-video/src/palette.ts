export interface DocumentaryPalette {
  id: "atlantic" | "coral" | "teal" | "violet" | "slate";
  backgroundColor: string;
  foregroundColor: string;
  accentColor: string;
  surfaceColor: string;
  surfaceForegroundColor: string;
  mutedColor: string;
}

/**
 * Calm documentary palettes shared by Player preview and final render.
 * The seed is deliberately stable: a project keeps one visual identity across
 * machines and renders, while different projects do not all look identical.
 */
export const DOCUMENTARY_PALETTES: readonly DocumentaryPalette[] = [
  {
    id: "atlantic",
    backgroundColor: "#173047",
    foregroundColor: "#f5f2ea",
    accentColor: "#5c91b5",
    surfaceColor: "#e8edf0",
    surfaceForegroundColor: "#173047",
    mutedColor: "#aec2ce",
  },
  {
    id: "coral",
    backgroundColor: "#49312d",
    foregroundColor: "#fff5ee",
    accentColor: "#dc735f",
    surfaceColor: "#f7e5dc",
    surfaceForegroundColor: "#4b2f2a",
    mutedColor: "#d6b3a8",
  },
  {
    id: "teal",
    backgroundColor: "#173b3c",
    foregroundColor: "#f0f6f1",
    accentColor: "#45a098",
    surfaceColor: "#dcebe6",
    surfaceForegroundColor: "#173f3b",
    mutedColor: "#a9c8c2",
  },
  {
    id: "violet",
    backgroundColor: "#302d48",
    foregroundColor: "#f6f2fa",
    accentColor: "#8277b8",
    surfaceColor: "#eae5f2",
    surfaceForegroundColor: "#322e4a",
    mutedColor: "#bdb5d2",
  },
  {
    id: "slate",
    backgroundColor: "#38444d",
    foregroundColor: "#f7f4ec",
    accentColor: "#9aafbd",
    surfaceColor: "#ece9e0",
    surfaceForegroundColor: "#26313a",
    mutedColor: "#c3c8c7",
  },
] as const;

const stableHash = (value: string): number => {
  let hash = 0x811c9dc5;
  for (const character of value.trim().toLocaleLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const selectDocumentaryPalette = (seed: string): DocumentaryPalette =>
  DOCUMENTARY_PALETTES[stableHash(seed || "gold-work-documentary") % DOCUMENTARY_PALETTES.length]!;

export const selectProjectDocumentaryPalette = (projectId: string, title = ""): DocumentaryPalette =>
  selectDocumentaryPalette(`${projectId.trim()}|${title.trim()}`);
