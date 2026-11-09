import type { ReactNode } from "react";
import { voiceCalibrationMatches, type DesktopApi, type Project, type ProjectSettings, type VoicerTemplate } from "@gold-work/shared";
import { materialReady } from "./StockProduction";
import { DocumentaryRecovery } from "./DocumentaryRecovery";
import { StockMontageChoices } from "./StockMontageChoices";
import { StockBackgroundPicker } from "./StockBackgroundPicker";
import { StockMusicControls } from "./StockMusicControls";
import { patchStockMontage, stockVideoTarget } from "./stock-workflow-settings";
import "./stock-workflow.css";

type Props = {
  project: Project;
  api: DesktopApi;
  disabled: boolean;
  samplePlaying: boolean;
  samplePreparing: boolean;
  templates: VoicerTemplate[];
  templatesBusy: boolean;
  templatesStatus: string;
  voices: Array<{ id: string; label: string; gender?: string }>;
  normalizedVoice: string;
  onSettings: (patch: Partial<ProjectSettings>) => void;
  onAspectRatio: (value: Project["aspectRatio"]) => void;
  onCalibrate: () => void;
  onRefreshTemplates: () => void;
  onScenario: () => void;
  onAccounts: () => void;
  onLibrary: () => void;
  onChooseMusic: () => void;
  onRefreshMontage: () => Promise<void>;
};
function Field({ title, children }: { title: string; children: ReactNode }) {
  return <label className="stock-workflow-field"><span>{title}</span>{children}</label>;
}

export function StockWorkflowSettings({ project, api, disabled, samplePlaying, samplePreparing, templates, templatesBusy, templatesStatus, voices, normalizedVoice,
  onSettings, onAspectRatio, onCalibrate, onRefreshTemplates, onScenario, onAccounts, onLibrary, onChooseMusic, onRefreshMontage }: Props) {
  const { settings } = project;
  const { voice, assembly } = settings;
  const doc = assembly.documentary!;
  const percent = stockVideoTarget(settings.stockVideoPercent);
  const narration = project.videoBrief?.readyScript || project.scenes.map(scene => scene.narration).join("\n\n");
  const calibrated = voiceCalibrationMatches(voice.calibration, voice.provider, voice.voice, project.language);
  const changeVoice = (value: string) => onSettings({ voice: { ...voice, voice: value, calibration: undefined } });
  const changeDocumentary = (patch: Partial<typeof doc>) => onSettings({ assembly: { ...assembly, documentary: { ...doc, ...patch } } });
  return <fieldset disabled={disabled} className="stock-workflow" aria-label="Настройки Stock Documentary">
    <section className="stock-workflow-section">
      <h2><span>1</span> Сценарий</h2>
      <p>{project.scenes.length} сцен · {project.language} · около {settings.durationMinutes.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} мин</p>
      <details className="stock-workflow-more"><summary>Прочитать полный текст</summary><p className="stock-workflow-script">{narration || "Добавьте текст сценария."}</p></details>
      <button type="button" className="outline-button small" onClick={onScenario}>Редактировать сценарий</button>
    </section>

    <section className="stock-workflow-section">
      <h2><span>2</span> Голос</h2>
      <Field title="Озвучка"><select aria-label="Озвучка" value={voice.enabled ? "on" : "off"} onChange={e => onSettings({ voice: { ...voice, enabled: e.target.value === "on" } })}><option value="on">Озвучить сценарий</option><option value="off">Без диктора</option></select></Field>
      {voice.enabled && <>
        <div className="stock-workflow-columns">
          <Field title="Сервис озвучки"><select aria-label="Сервис озвучки" value={voice.provider} onChange={e => onSettings({ voice: { ...voice, provider: e.target.value as typeof voice.provider, voice: "", calibration: undefined } })}><option value="edge-tts">Встроенные голоса (Edge / Google)</option><option value="elevenlabs">Lumean (ElevenLabs)</option></select></Field>
          <Field title="Голос"><select aria-label="Голос" value={voice.provider === "elevenlabs" ? voice.voice : normalizedVoice} onChange={e => changeVoice(e.target.value)}>
            <option value="">Выберите голос</option>
            {voice.provider === "elevenlabs" ? <>
              {voice.voice && !templates.some(item => item.uuid === voice.voice) && <option value={voice.voice}>Сохранённый голос Lumean</option>}
              {templates.map(item => <option key={item.uuid} value={item.uuid}>{item.name}</option>)}
            </> : <>
              {normalizedVoice && !voices.some(item => item.id === normalizedVoice) && <option value={normalizedVoice}>Сохранённый голос · {normalizedVoice}</option>}
              {voices.map(item => <option key={item.id} value={item.id}>{item.label}{item.gender ? ` (${item.gender})` : ""}</option>)}
            </>}
          </select></Field>
        </div>
        {voice.provider === "elevenlabs" && <div className="stock-workflow-actions"><button type="button" className="outline-button small" disabled={templatesBusy} onClick={onRefreshTemplates}>Обновить голоса</button><small role="status">{templatesStatus}</small></div>}
        <div className="stock-workflow-actions"><button type="button" className="outline-button small" disabled={samplePreparing || !voice.voice.trim()} onClick={onCalibrate}>{samplePreparing ? "Готовлю пример…" : samplePlaying ? "Остановить пример" : "Прослушать пример голоса"}</button><small>{calibrated ? "Скорость выбранного голоса измерена." : "Пример также измеряет скорость для длительности сцен."} Новый пример расходует баланс сервиса.</small></div>
      </>}
      <button type="button" className="ghost-button" onClick={onAccounts}>Ключи и подключения сервисов</button>
    </section>

    <section className="stock-workflow-section">
      <h2><span>3</span> Видео и фото</h2>
      <Field title={`${percent}% видео · ${100 - percent}% фото`}><input aria-label="Доля видео" type="range" min={0} max={100} step={1} value={percent} onChange={e => onSettings({ stockVideoPercent: Number(e.target.value) })} /></Field>
      <div className="stock-workflow-ratio-labels"><span>Только фото</span><span>Только видео</span></div>
      <p>60% видео / 40% фото — стартовая настройка, её можно свободно менять. Доля по длительности ролика. Фактическую долю и сцены без подходящего материала видно в производстве.</p>
    </section>

    <section className="stock-workflow-section">
      <h2><span>4</span> Монтаж</h2>
      <StockMontageChoices assembly={assembly} onChange={next => onSettings({ assembly: next })} />
      {doc.motionArtworkStatus&&doc.semanticMontageStatus?.status!=='local'&&<p role="status">{doc.motionArtworkStatus.message}</p>}
      {doc.semanticMontageStatus?.status==='local'&&<>
        <p role="status">{doc.semanticMontageStatus.message}</p>
        <DocumentaryRecovery key={project.id} api={api} projectId={project.id} purpose="semantic-montage"
          label="Обновить AI-монтаж после ошибки" onContinue={onRefreshMontage}
          disabled={disabled||!project.scenes.length||project.scenes.some(scene=>scene.includeInAssembly!==false&&!materialReady(scene))} />
      </>}
      <Field title="Формат видео"><select aria-label="Формат видео" value={project.aspectRatio} onChange={e => onAspectRatio(e.target.value as Project["aspectRatio"])}><option value="16:9">16:9 · YouTube</option><option value="9:16">9:16 · Shorts</option><option value="1:1">1:1 · квадрат</option></select></Field>
    </section>

    <section className="stock-workflow-section">
      <h2><span>5</span> Фон</h2>
      <StockBackgroundPicker api={api} value={doc.montage?.background} onChange={background => onSettings({ assembly: patchStockMontage(assembly, { background }) })} onLibrary={onLibrary} />
    </section>

    <section className="stock-workflow-section">
      <h2><span>6</span> Музыка и звуки</h2>
      <StockMusicControls api={api} settings={settings} onSettings={onSettings} onChooseMusic={onChooseMusic} />
      <details className="stock-workflow-more"><summary>Звуковые акценты · {doc.autoEffects === false || doc.sfxVolume === 0 ? "выключены" : `${doc.sfxVolume}%`}</summary>
        <p>Звуки сопровождают смысловые акценты; после вступления используются реже. Добавленные вручную звуки остаются на дорожках редактора.</p>
        <Field title={`Громкость эффектов · ${doc.autoEffects === false ? 0 : doc.sfxVolume}%`}><input aria-label="Громкость эффектов" type="range" min={0} max={100} value={doc.autoEffects === false ? 0 : doc.sfxVolume} onChange={e => changeDocumentary({ sfxVolume: Number(e.target.value), autoEffects: Number(e.target.value) > 0 })} /></Field>
        <button type="button" className="outline-button small" onClick={onLibrary}>Библиотека звуков и эффектов</button>
      </details>
    </section>
  </fieldset>;
}
