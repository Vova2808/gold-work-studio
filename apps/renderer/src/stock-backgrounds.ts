import { selectedDocumentaryBackgroundIds, type DocumentaryMontageSettings, type EffectAsset } from "@gold-work/shared";

export function toggleStockBackground(background: DocumentaryMontageSettings['background'], assetId: string): NonNullable<DocumentaryMontageSettings['background']> {
  const selected = selectedDocumentaryBackgroundIds(background);
  const assetIds = selected.includes(assetId) ? selected.filter(id => id !== assetId) : [...selected, assetId];
  return { mode: 'library', assetIds, assetId: assetIds[0] };
}

export function selectableStockBackgrounds(assets: EffectAsset[]): EffectAsset[] {
  return assets.filter(asset => asset.category === "background" && asset.kind !== "audio" && asset.state === "ready" && !asset.deletedAt);
}

/** Library paths are relative. Persist the asset ID, never this playback URL. */
export function libraryMediaUrl(root: string, path?: string): string | undefined {
  return path ? `gw-media://local/${encodeURIComponent(`${root}/${path}`)}` : undefined;
}
