import type { ReactNode } from "react";
import { Check, ChevronDown, Clapperboard, Image, Mic2, Settings2, Video, Volume2 } from "lucide-react";
import { IMAGE_STYLES, voiceCalibrationMatches, type Project, type ProjectSettings, type VoicerTemplate } from "@gold-work/shared";

type Props = {
  project: Project;
  disabled: boolean;
  samplePlaying: boolean;
  samplePreparing: boolean;
  templates: VoicerTemplate[] | null;
  voices: Array<{ id: string; label: string; gender?: string }>;
  normalizedVoice: string;
  plannedVeoCount: number;
  styleChooser: ReactNode;
  onSettings: (patch: Partial<ProjectSettings>) => void;
  onAspectRatio: (value: Project["aspectRatio"]) => void;
  onCalibrate: () => void;
  onRefreshTemplates: () => void;
  onReferences: () => void;
  onAccounts: () => void;
};

function Field({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return <label className="ai-settings-field"><span>{title}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function More({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return <details className="ai-settings-more" open={open}><summary>{title}<ChevronDown size={15} /></summary><div>{children}</div></details>;
}

/** Project-only controls. Connection secrets and scenario authoring stay on their own screens. */
export function AiStorySettings({ project, disabled, samplePlaying, samplePreparing, templates, voices, normalizedVoice,
  plannedVeoCount, styleChooser, onSettings, onAspectRatio, onCalibrate, onRefreshTemplates, onReferences, onAccounts }: Props) {
  const { settings } = project;
  const { voice, assembly } = settings;
  const image = {...settings.image, provider:'flow' as const};
  const video = {...settings.video, provider:'flow' as const, model:/veo_3_1/i.test(settings.video.model) ? settings.video.model : 'veo_3_1_i2v_s_fast'};
  const calibrated = voiceCalibrationMatches(voice.calibration, voice.provider, voice.voice, project.language);
  const selectedVoice = voice.provider === "elevenlabs"
    ? templates?.find(template => template.uuid === voice.voice)?.name ?? (voice.voice ? "Сохранённый шаблон Lumean" : "Голос не выбран")
    : voices.find(item => item.id === normalizedVoice)?.label ?? (voice.voice || "Голос не выбран");
  const style = IMAGE_STYLES.find(item => item.promptSuffix === image.style.trim());
  const selectionMode = video.selectionMode ?? "auto";
  const transition = assembly.fadeTransitions ? assembly.transitionType ?? "mix" : "none";
  const transitionSeconds = Math.max(0.15, Math.min(1, assembly.transitionDurationSeconds ?? 0.4));
  const motion = !assembly.kenBurns ? "off" : assembly.kenBurnsDirection === "cycle" ? "cycle" : assembly.kenBurnsDirection === "smart" ? "smart" : "alternate";
  const setAssembly = (patch: Partial<ProjectSettings["assembly"]>) => onSettings({
    assembly: { ...assembly, ...patch, montage: assembly.montage ? { ...assembly.montage, enabled: false } : undefined },
  });
  return <fieldset className="ai-story-settings" disabled={disabled} aria-label="Настройки ролика AI Story">
    <div className="ai-settings-overview">
      <div><strong>Подготовка к генерации</strong><p>Проверьте голос, изображения и сборку. Сценарий уже находится на предыдущем этапе.</p></div>
      <div className="ai-settings-facts"><span>{project.language}</span><span>{project.scenes.length} сцен</span><span>Цель: {settings.durationMinutes.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} мин</span></div>
    </div>
    <div className="ai-settings-grid">
      <div className="ai-settings-column">
      <section className="ai-settings-card" data-settings-card="voice">
        <header><Mic2 size={19} /><h2>Озвучка</h2><label className="ai-settings-switch"><input type="checkbox" checked={voice.enabled}
          onChange={event => onSettings({ voice: { ...voice, enabled: event.target.checked } })} /><span>Включена</span></label></header>
        {voice.enabled ? <>
          <div className="ai-settings-value"><strong>{voice.provider === 'elevenlabs' ? selectedVoice : 'Выберите шаблон Lumean для новой озвучки'}</strong><small>Lumean · ElevenLabs</small></div>
          {calibrated ? <p className="ai-settings-calibrated"><Check size={15} />Скорость измерена: {voice.calibration!.charactersPerSecond.toFixed(1)} зн./с</p>
            : <p className="ai-settings-warning">Выберите голос и измерьте скорость чтения перед генерацией.</p>}
          <More key={voice.enabled ? "voice-on" : "voice-off"} title="Изменить голос и измерить скорость" open={!calibrated}>
            <Field title="Сервис озвучки"><select value={voice.provider} onChange={event => onSettings({ voice: {
              ...voice, provider: event.target.value as typeof voice.provider, voice: "", calibration: undefined,
            } })}>{voice.provider !== 'elevenlabs' && <option value={voice.provider} disabled>Прежний сервис · выберите Lumean</option>}<option value="elevenlabs">Lumean · ElevenLabs</option></select></Field>
            <Field title="Голос"><select value={voice.provider === "elevenlabs" ? voice.voice : normalizedVoice} onChange={event => onSettings({
              voice: { ...voice, voice: event.target.value, calibration: undefined },
            })}>
              <option value="">Выберите голос</option>
              {voice.provider === "elevenlabs" ? <>
                {voice.voice && !templates?.some(item => item.uuid === voice.voice) && <option value={voice.voice}>Сохранённый шаблон</option>}
                {(templates ?? []).map(item => <option key={item.uuid} value={item.uuid}>{item.name}</option>)}
              </> : voices.map(item => <option key={item.id} value={item.id}>{item.label}{item.gender ? ` (${item.gender})` : ""}</option>)}
            </select></Field>
            {voice.provider === "elevenlabs" && <div className="ai-settings-inline"><small>{templates === null ? "Загружаю шаблоны…" : templates.length ? `${templates.length} шаблонов` : "Список недоступен. Сохранённый голос не изменён."}</small><button type="button" className="ghost-button small" onClick={onRefreshTemplates}>Обновить список</button></div>}
            <button type="button" className="outline-button small" disabled={samplePreparing || !voice.voice.trim() || voice.provider !== 'elevenlabs'} onClick={onCalibrate}>
              <Volume2 size={15} />{samplePreparing ? "Готовлю пример…" : samplePlaying ? "Остановить пример" : calibrated ? "Прослушать пример" : "Озвучить тест и измерить скорость"}
            </button>
            <small>При смене голоса калибровку нужно повторить. Текст готового сценария не переписывается.</small>
          </More>
        </> : <p className="ai-settings-note">Ролик будет без озвучки. Настройки выбранного голоса сохранены.</p>}
      </section>

      <section className="ai-settings-card" data-settings-card="images">
        <header><Image size={19} /><h2>Изображения</h2></header>
        <Field title="Генератор изображений"><select value={image.provider} onChange={event => onSettings({ image: { ...image, provider: event.target.value as typeof image.provider } })}>
          <option value="flow">Google Flow · подключённые аккаунты</option>
        </select></Field>
        <small>Картинки создаются через подключённые аккаунты Google Flow.</small>
        <div className="ai-settings-style">{style && <img src={`/styles/${style.id}.jpg`} alt="" />}<div><strong>{style?.label ?? "Свой стиль"}</strong><p>{image.style || "Стиль не указан"}</p></div></div>
        <p className="ai-settings-note">{project.storyCharacters?.length
          ? `Персонажи: ${project.storyCharacters.map(character => character.name).join(", ")}. Образы можно изменить на этапе «Сценарий».`
          : project.characterReference ? `Герой: ${project.characterReference.name}. Образ можно изменить на этапе «Сценарий».` : "Без постоянного героя. При необходимости создайте его на этапе «Сценарий»."}</p>
        <More title="Изменить стиль изображений">{styleChooser}</More>
      </section>

      </div>
      <div className="ai-settings-column">
      <section className="ai-settings-card" data-settings-card="assembly">
        <header><Clapperboard size={19} /><h2>Движение и переходы</h2></header>
        <Field title="Движение картинок"><select value={motion} onChange={event => {
          const value = event.target.value as "off" | "alternate" | "smart" | "cycle";
          setAssembly({ kenBurns: value !== "off", kenBurnsDirection: value === "off" ? assembly.kenBurnsDirection : value });
        }}><option value="off">Без движения</option><option value="alternate">Приближение и отдаление по очереди</option><option value="cycle">Цикл: зум → отдаление → вверх → вниз → вправо → влево</option><option value="smart">Умное движение по смыслу сцены</option></select></Field>
        {motion === "cycle" && <p className="ai-settings-note">Шесть движений повторяются по кадрам. Для панорамирования картинка слегка увеличена, чтобы не появлялись чёрные края.</p>}
        <Field title="Переход между кадрами"><select value={transition} onChange={event => {
          const value = event.target.value as "none" | "mix" | "fade";
          setAssembly({ fadeTransitions: value !== "none", transitionType: value });
        }}><option value="none">Мгновенная склейка</option><option value="mix">Плавное растворение</option><option value="fade">Через чёрный экран</option></select></Field>
        {transition !== "none" && <Field title={`Длительность перехода: ${transitionSeconds.toFixed(2)} с`}><input type="range" min="0.15" max="1" step="0.05"
          value={transitionSeconds} onChange={event => setAssembly({ transitionDurationSeconds: Number(event.target.value) })} /></Field>}
        <div className="ai-settings-pair"><Field title="Формат"><select value={project.aspectRatio} onChange={event => onAspectRatio(event.target.value as Project["aspectRatio"])}>
          <option value="16:9">16:9 · YouTube</option><option value="9:16">9:16 · Shorts</option><option value="1:1">1:1 · Квадрат</option>
        </select></Field><Field title="Качество сборки"><select value={assembly.quality}
          onChange={event => setAssembly({ quality: event.target.value as typeof assembly.quality })}>
          <option value="preview">Черновик · быстрее</option><option value="standard">Стандартное</option><option value="high">Высокое</option></select></Field></div>
        <p className="ai-settings-note">Кадры идут по сценарию, без автоматических титров и инфографики.</p>
      </section>

      <section className="ai-settings-card" data-settings-card="veo">
        <header><Video size={19} /><h2>Оживление через Veo</h2><label className="ai-settings-switch"><input type="checkbox" checked={video.enabled}
          onChange={event => onSettings({ video: { ...video, enabled: event.target.checked } })} /><span>Включено</span></label></header>
        {video.enabled ? <>
          <Field title="Какие кадры оживлять"><select value={selectionMode} onChange={event => onSettings({ video: { ...video, selectionMode: event.target.value as typeof selectionMode } })}>
            <option value="auto">Автоматически по важности</option><option value="key-scenes">Первые ключевые сцены</option>
            <option value="every-second">Каждый второй кадр</option><option value="every-third">Каждый третий кадр</option><option value="manual">Выбрать вручную в «Материалах»</option>
          </select></Field>
          {(selectionMode === "auto" || selectionMode === "key-scenes") && <Field title="Доля оживлённых кадров"><select value={video.animationPercent}
            onChange={event => onSettings({ video: { ...video, animationPercent: Number(event.target.value) } })}>
            {![10, 15, 20, 30, 50, 100].includes(video.animationPercent) && <option value={video.animationPercent}>{video.animationPercent}%</option>}
            {[10, 15, 20, 30, 50, 100].map(value => <option key={value} value={value}>{value}%</option>)}
          </select></Field>}
          <p className="ai-settings-note">{selectionMode === "manual" ? "Сначала создаются картинки. Затем выберите нужные на этапе «Материалы» и нажмите «Оживить через Veo»."
            : `${plannedVeoCount} кадров будут оживлены после генерации всех изображений. Остальные останутся картинками.`}</p>
          <More title="Модель и параметры Veo">
            <Field title="Сервис видео"><select value={video.provider} onChange={event => {
              const provider = event.target.value as typeof video.provider;
              onSettings({ video: { ...video, provider, model: provider === "flow" ? "veo_3_1_i2v_s_fast" : video.model } });
            }}><option value="flow">Google Flow · подключённые аккаунты</option>
            </select></Field>
            {video.provider === "flow" && <Field title="Модель Veo"><select value={video.model} onChange={event => onSettings({ video: { ...video, model: event.target.value } })}>
              {!["veo_3_1_t2v_lite", "veo_3_1_i2v_s_fast", "VEO_3_1_I2V_12STEP"].includes(video.model) && <option value={video.model}>{video.model || "По умолчанию"}</option>}
              <option value="veo_3_1_t2v_lite">Veo 3.1 Lite</option><option value="veo_3_1_i2v_s_fast">Veo 3.1 Fast</option><option value="VEO_3_1_I2V_12STEP">Veo 3.1 Quality</option>
            </select></Field>}
            <label className="ai-settings-check"><input type="checkbox" checked={video.startFrame} onChange={event => onSettings({ video: { ...video, startFrame: event.target.checked } })} />Анимировать исходную картинку сцены</label>
            <label className="ai-settings-check"><input type="checkbox" checked={video.muteSource} onChange={event => onSettings({ video: { ...video, muteSource: event.target.checked } })} />Убрать собственный звук Veo</label>
            {!video.muteSource && <Field title={`Громкость звука Veo: ${video.sourceVolume}%`}><input type="range" min="0" max="100" value={video.sourceVolume}
              onChange={event => onSettings({ video: { ...video, sourceVolume: Number(event.target.value) } })} /></Field>}
          </More>
        </> : <p className="ai-settings-note">Только картинки, выбранное движение и переходы. Настройки Veo сохранены — его можно включить позже.</p>}
      </section>
      </div>
    </div>
    <More title="Дополнительно: референсы и подключения">
      <div className="ai-settings-advanced-grid">
        <div><label className="ai-settings-check"><input type="checkbox" checked={image.sequential} onChange={event => onSettings({ image: { ...image, sequential: event.target.checked } })} />Генерировать картинки по одной</label>
          <p className="ai-settings-note">Выключено — доступные Flow-аккаунты работают параллельно. Включено — каждый кадр ждёт предыдущий.</p>
          <p className="ai-settings-note">Референсы: {image.references.length} из 3. Подтверждённый герой также занимает одно место.</p>
          <button type="button" className="outline-button small" disabled={image.references.length >= 3} onClick={onReferences}>Добавить референс</button>
        </div>
        <div><p className="ai-settings-note">API-ключи, прокси и Flow-аккаунты настраиваются один раз для приложения.</p>
          <button type="button" className="outline-button small" onClick={onAccounts}><Settings2 size={15} />Подключения и аккаунты</button>
          {settings.music.path && <label className="ai-settings-check"><input type="checkbox" checked={settings.music.enabled !== false}
            onChange={event => onSettings({ music: { ...settings.music, enabled: event.target.checked } })} />Использовать ранее добавленную музыку</label>}
        </div>
      </div>
    </More>
  </fieldset>;
}
