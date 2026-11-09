import type { DesktopApi, ProjectSettings } from "@gold-work/shared";
import { selectedStockMusicPolicy, stockMusicPolicyPatch, type StockMusicPolicy } from "./stock-workflow-settings";

export function StockMusicControls({ api, settings, onSettings, onChooseMusic }: {
  api: DesktopApi;
  settings: Pick<ProjectSettings, "assembly" | "music">;
  onSettings: (patch: Pick<ProjectSettings, "assembly" | "music">) => void;
  onChooseMusic: () => void;
}) {
  const policy = selectedStockMusicPolicy(settings);
  const { music } = settings;
  return <div className="stock-music-controls">
    <div className="stock-music-policy" role="group" aria-label="Музыка">
      {([['automatic', 'Автоматически'], ['off', 'Выключена']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={policy === value} onClick={() => onSettings(stockMusicPolicyPatch(settings, value as StockMusicPolicy))}>{label}</button>)}
    </div>
    {policy === "preserve" && <p role="status">Сохранена своя музыка или ручная раскладка. Открытие и сохранение настроек её не заменяет. «Автоматически» явно заменит её автоподбором.</p>}
    {policy === "automatic" && <p>Выбор этого режима заменяет ручную раскладку автоподбором при сборке. Музыка подбирается по смысловым участкам и приглушается под диктором. Если подходящего трека нет, участок останется без музыки с пояснением.</p>}
    {policy === "automatic" && music.selectionStatus && music.selectionStatus !== "off" && <p role="status">{music.selectionMessage || (music.selectionStatus === "ready" ? "Музыка подобрана." : music.selectionStatus === "local-fallback" ? "Выбран музыкальный трек из локальной библиотеки." : "Подходящей музыки пока нет. Можно выбрать свой файл.")}</p>}
    {policy === "off" && <small>Ролик будет без фоновой музыки. Озвучка и звуковые акценты остаются независимыми.</small>}
    <div className="stock-workflow-actions">
      <button type="button" className="outline-button small" onClick={onChooseMusic}>{music.clips!==undefined?"Добавить файл":music.path ? "Заменить файл" : "Выбрать аудиофайл"}</button>
      <span>{music.clips!==undefined?`Фрагментов: ${music.clips.length}. Редактирование — на таймлайне.`:music.path ? music.name || music.path.split(/[\\/]/).at(-1) : "Файл пока не выбран"}</span>
    </div>
    {policy !== "off" && music.clips===undefined && music.path && <><small>{policy === "automatic" ? "Последний выбранный трек: " : ""}{policy === "automatic" ? music.name || music.path.split(/[\\/]/).at(-1) : "Прослушать свой файл"}</small><audio aria-label={policy === "automatic" ? "Прослушать последний выбранный трек" : "Прослушать свой трек"} controls preload="none" src={api.mediaUrl(music.path)} /></>}
    {policy !== "off" && <label className="stock-workflow-field"><span>Громкость музыки · {music.volume}%</span><input aria-label="Громкость музыки" type="range" min={0} max={100} value={music.volume} onChange={event => onSettings({ assembly: settings.assembly, music: { ...music, volume: Number(event.target.value) } })} /></label>}
  </div>;
}
