import { useState } from "react";
import type { DesktopApi } from "@gold-work/shared";
import { StockMontageChoices } from "./StockMontageChoices";
import { StockBackgroundPicker } from "./StockBackgroundPicker";
import { StockMusicControls } from "./StockMusicControls";
import { patchStockMontage, selectedStockMontagePreset, selectedStockMusicPolicy, stockVideoTarget, type StockCreationSettings } from "./stock-workflow-settings";

export function StockCreationControls({ api, settings, onChange, onBusyChange }: {
  api: DesktopApi; settings: StockCreationSettings; onChange: (settings: StockCreationSettings) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [importingMusic, setImportingMusic] = useState(false);
  const character = selectedStockMontagePreset(settings.assembly) === "calm" ? "спокойный" : "выразительный";
  const music = selectedStockMusicPolicy(settings);
  const background = settings.assembly.documentary?.montage?.background;
  const percent = stockVideoTarget(settings.stockVideoPercent);
  const chooseMusic = async () => {
    setImportingMusic(true); onBusyChange(true); setError("");
    try {
      const [path] = await api.pickFiles("audio");
      if (path) onChange({ ...settings,
        assembly: patchStockMontage(settings.assembly, { musicPolicy: "preserve" }),
        music: { ...settings.music, path: await api.importMusic(path), name: path.split(/[\\/]/).at(-1), sourcePage: undefined, assetId: undefined, selectionStatus: undefined, selectionMessage: undefined, enabled: true },
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setImportingMusic(false); onBusyChange(false); }
  };
  return <details className="stock-creation-controls">
    <summary>Монтаж {character} · фон {background?.mode === "library" ? "из библиотеки" : background?.mode === "off" ? "без материала" : "авто"} · музыка {music === "automatic" ? "авто" : music === "off" ? "выключена" : "свой файл"}</summary>
    <fieldset disabled={importingMusic}>
      <h3>Характер монтажа</h3><StockMontageChoices assembly={settings.assembly} onChange={assembly => onChange({ ...settings, assembly })} />
      <h3>Фон</h3><StockBackgroundPicker api={api} value={background} onChange={value => onChange({ ...settings, assembly: patchStockMontage(settings.assembly, { background: value }) })} />
      <h3>Музыка</h3><StockMusicControls api={api} settings={settings} onSettings={patch => onChange({ ...settings, ...patch })} onChooseMusic={() => void chooseMusic()} />
      <label className="stock-workflow-field"><span>{percent}% видео · {100 - percent}% фото</span><input aria-label="Доля видео" type="range" min={0} max={100} value={percent} onChange={event => onChange({ ...settings, stockVideoPercent: Number(event.target.value) })} /></label>
      {error && <p role="alert" className="voice-calibration-error">{error}</p>}
    </fieldset>
  </details>;
}
