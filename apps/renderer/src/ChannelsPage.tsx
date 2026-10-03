import { useEffect, useMemo, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { ArchiveRestore, ArrowLeft, Check, Clock3, ExternalLink, FileText, Film, FolderOpen, Gauge, Globe2, Layers3, MessageSquareText, Mic2, Pencil, Play, Plus, RefreshCw, Settings, Trash2, UserRound, X } from "lucide-react";
import * as FlagIcons from "country-flag-icons/react/3x2";
import { VisualStyleChooser } from "./VisualStyleChooser";
import { ChannelHeroPanel } from "./ChannelHeroPanel";
import { channelImageStyle, createDefaultProjectSettings, IMAGE_STYLES, estimateNarrationDurationSeconds, TTS_VOICES, ttsLanguageCode, type ChannelDirection, type ChannelProfile, type ChatTopicSummary, type DesktopApi, type Project, type SaveChannelProfileInput, type TrashItemSummary, type VoiceCalibration, type VoicerTemplate } from "@gold-work/shared";

const ISO_COUNTRY_CODES = new Set(`
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/));

interface CountryOption {
  code: string;
  country: string;
  languageCode: string;
  language: string;
}

interface ChannelsPageProps {
  api: DesktopApi;
  channels: ChannelProfile[];
  projects: Project[];
  selectedChannelId: string | null;
  busy: boolean;
  createVideoRequest?: number;
  onCreateVideoRequestHandled?: () => void;
  onSelectChannel: (id: string | null) => void;
  onChannelsChange: () => Promise<void>;
  onProjectsChange?: () => Promise<void>;
  onCreateVideo: (profile: ChannelProfile, input: NewChannelVideoInput) => Promise<void>;
  onOpenProject: (id: string) => void;
  onOpenSettings: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export interface NewChannelVideoInput {
  title: string;
  creationMode: "script";
  content: string;
  voiceProvider: "edge-tts" | "elevenlabs";
  voice: string;
  voiceLabel: string;
  calibration: VoiceCalibration;
  durationMinutes?: number;
  imageStyle?: string;
  /** Пользователь явно выбрал подтверждённого бренд-персонажа этого канала. */
  useChannelCharacter: boolean;
}

const COUNTRIES = buildCountryOptions();

export function ChannelsPage(props: ChannelsPageProps) {
  useEffect(() => { void props.onChannelsChange().catch(reason => props.onError(errorText(reason))); }, []);
  const selected = props.channels.find((channel) => channel.id === props.selectedChannelId);
  const [dialog, setDialog] = useState<"channel" | "video" | "edit" | "trash" | null>(null);
  useEffect(() => {
    if (!props.createVideoRequest) return;
    if (selected) setDialog("video");
    props.onCreateVideoRequestHandled?.();
  }, [props.createVideoRequest]);

  useEffect(() => {
    if (props.selectedChannelId && !selected) props.onSelectChannel(null);
  }, [props.selectedChannelId, selected]);

  return (
    <div className="channels-page">
      {selected ? (
        <ChannelWorkspace
          {...props}
          profile={selected}
          onBack={() => props.onSelectChannel(null)}
          onNewVideo={() => setDialog("video")}
          onEdit={() => setDialog("edit")}
        />
      ) : (
        <ChannelList channels={props.channels} projects={props.projects} onOpen={props.onSelectChannel} onCreate={() => setDialog("channel")} onOpenTrash={() => setDialog("trash")} />
      )}

      {(dialog === "channel" || dialog === "edit") && (
        <ChannelProfileDialog
          api={props.api}
          existing={dialog === "edit" ? selected : undefined}
          onClose={() => setDialog(null)}
          onSaved={async (profile) => {
            await props.onChannelsChange();
            props.onSelectChannel(profile.id);
            setDialog(null);
            props.onNotice(dialog === "edit" ? "Профиль канала обновлён." : "Канал создан. Теперь можно добавить первый ролик.");
          }}
          onError={props.onError}
          onOpenSettings={props.onOpenSettings}
        />
      )}

      {dialog === "video" && selected && (
        <NewVideoDialog
          api={props.api}
          profile={selected}
          busy={props.busy}
          onClose={() => setDialog(null)}
          onCreate={async (input) => {
            await props.onCreateVideo(selected, input);
            setDialog(null);
          }}
          onError={props.onError}
        />
      )}

      {dialog === "trash" && (
        <TrashDialog
          api={props.api}
          onClose={() => setDialog(null)}
          onChanged={async () => {
            await Promise.all([props.onChannelsChange(), props.onProjectsChange?.() ?? Promise.resolve()]);
          }}
          onError={props.onError}
          onNotice={props.onNotice}
        />
      )}
    </div>
  );
}

function ChannelList({ channels, projects, onOpen, onCreate, onOpenTrash }: { channels: ChannelProfile[]; projects: Project[]; onOpen: (id: string) => void; onCreate: () => void; onOpenTrash: () => void }) {
  return (
    <>
      <div className="channels-heading">
        <div>
          <span className="page-kicker">РАБОЧЕЕ ПРОСТРАНСТВО</span>
          <h1>Мои каналы</h1>
          <p>Ролики, визуальный стиль и персонажи каждого канала хранятся отдельно.</p>
        </div>
        <button className="outline-button" onClick={onOpenTrash}><Trash2 size={16} /> Корзина</button>
        <button className="primary-button" onClick={onCreate}><Plus size={17} /> Создать канал</button>
      </div>

      {channels.length === 0 ? (
        <div className="channels-empty">
          <Globe2 size={36} />
          <h2>Создайте первый канал</h2>
          <p>Выберите название, язык и направление. Затем добавьте ролик с готовым сценарием.</p>
          <button className="primary-button" onClick={onCreate}><Plus size={17} /> Создать канал</button>
        </div>
      ) : (
        <div className="channel-card-grid">
          {channels.map((channel) => {
            const channelProjects = projects.filter((project) => project.channelProfileId === channel.id);
            return (
              <button className="channel-card" key={channel.id} onClick={() => onOpen(channel.id)}>
                <div className="channel-card-top">
                  <FlagIcon code={channel.countryCode} />
                  <span className="channel-open-icon"><FolderOpen size={18} /></span>
                </div>
                <strong>{channel.name}</strong>
                <span>{channel.languageLabel} · {directionLabel(channel.direction)}</span>
                <div className="channel-card-meta">
                  <span><Film size={14} /> {channelProjects.length} роликов</span>
                  <span><Mic2 size={14} /> {channel.lumeanTemplateName || "Голос не выбран"}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function ChannelWorkspace(props: ChannelsPageProps & { profile: ChannelProfile; onBack: () => void; onNewVideo: () => void; onEdit: () => void }) {
  const { profile } = props;
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const channelProjects = useMemo(
    () => props.projects.filter((project) => project.channelProfileId === profile.id),
    [props.projects, profile.id]
  );

  async function deleteVideo(project: Project) {
    if (!window.confirm(`Переместить ролик «${project.title}» в корзину? Его можно будет восстановить.`)) return;
    setDeletingId(project.id);
    try {
      await props.api.deleteProject(project.id);
      await (props.onProjectsChange?.() ?? Promise.resolve());
      props.onNotice("Ролик перемещён в корзину.");
    } catch (reason) {
      props.onError(errorText(reason));
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteChannel() {
    const videos = channelProjects.length;
    const detail = videos > 0
      ? ` ${videos} ролик(а/ов) не будут удалены и останутся в разделе проектов; после восстановления канала связь вернётся.`
      : "";
    if (!window.confirm(`Переместить канал «${profile.name}» в корзину?${detail}`)) return;
    setDeletingId(profile.id);
    try {
      await props.api.deleteChannelProfile(profile.id);
      props.onBack();
      await props.onChannelsChange();
      props.onNotice("Канал перемещён в корзину. Ролики сохранены.");
    } catch (reason) {
      props.onError(errorText(reason));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="channel-workspace-heading">
        <button className="icon-button" title="К списку каналов" onClick={props.onBack}><ArrowLeft size={18} /></button>
        <FlagIcon code={profile.countryCode} large />
        <div className="channel-title-block">
          <span>{profile.languageLabel}</span>
          <h1>{profile.name}</h1>
        </div>
        <button className="outline-button" onClick={props.onEdit}><Pencil size={16} /> Изменить профиль</button>
        <button className="outline-button danger-outline" disabled={deletingId === profile.id} onClick={() => void deleteChannel()}><Trash2 size={16} /> Удалить канал</button>
        <button className="primary-button" onClick={props.onNewVideo}><Plus size={17} /> Новый ролик</button>
      </div>

      <div className="channel-profile-strip">
        <span><Mic2 size={16} /><b>Lumean</b>{profile.lumeanTemplateName || "голос не выбран"}</span>
        <span><Clock3 size={16} /><b>Длина</b>{profile.defaultDurationMinutes} мин</span>
        <span><Layers3 size={16} /><b>Направление</b>{directionLabel(profile.direction)}</span>
        <span><Film size={16} /><b>Motion</b>{profile.motionTemplate}</span>
      </div>

      {profile.direction === "ai-story" && (
        <ChannelHeroPanel key={profile.id} profile={profile} projects={channelProjects} api={props.api}
          disabled={props.busy} onChanged={props.onChannelsChange} />
      )}

      <section className="channel-section">
        <div className="channel-section-heading">
          <div><h2>Ролики</h2><span>{channelProjects.length}</span></div>
          <button className="text-button" onClick={props.onNewVideo}><Plus size={16} /> Новый ролик</button>
        </div>
        {channelProjects.length === 0 ? (
          <div className="channel-section-empty"><Film size={28} /><p>В этом канале пока нет роликов.</p></div>
        ) : (
          <div className="channel-project-list">
            {channelProjects.map((project) => (
              <div className="channel-project-row" key={project.id}>
                <button className="channel-project-open" onClick={() => props.onOpenProject(project.id)}>
                  <span className={`project-status-dot ${project.status}`} />
                  <span><strong>{project.title}</strong><small>{project.videoBrief?.prompt || project.topic}</small></span>
                  <em>{new Date(project.updatedAt).toLocaleDateString("ru-RU")}</em>
                </button>
                <button className="channel-project-delete" title="Переместить ролик в корзину" disabled={deletingId === project.id} onClick={() => void deleteVideo(project)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

    </>
  );
}

function ChannelProfileDialog({ api, existing, onClose, onSaved, onError, onOpenSettings }: {
  api: DesktopApi;
  existing?: ChannelProfile;
  onClose: () => void;
  onSaved: (profile: ChannelProfile) => Promise<void>;
  onError: (message: string) => void;
  onOpenSettings: () => void;
}) {
  const [step, setStep] = useState(existing ? 2 : 1);
  const initialCountry = COUNTRIES.find((country) => country.code === existing?.countryCode) ?? COUNTRIES.find((country) => country.code === "RU") ?? COUNTRIES[0]!;
  const [name, setName] = useState(existing?.name ?? "");
  const [countryCode, setCountryCode] = useState(initialCountry.code);
  const [masterPrompt, setMasterPrompt] = useState(existing?.masterPrompt ?? "");
  const [defaultImageStyle, setDefaultImageStyle] = useState(existing?.defaultImageStyle ?? existing?.primaryCharacter?.stylePrompt ?? "");
  const [templates, setTemplates] = useState<VoicerTemplate[]>([]);
  const [templatesBusy, setTemplatesBusy] = useState(false);
  const [templateUuid, setTemplateUuid] = useState(existing?.lumeanTemplateUuid ?? "");
  const [duration, setDuration] = useState(existing?.defaultDurationMinutes ?? 10);
  const [direction, setDirection] = useState<ChannelDirection>(existing?.direction ?? (existing?.defaultMediaMode === "stock" ? "stock-documentary" : "ai-story"));
  const [motionTemplate, setMotionTemplate] = useState(existing?.motionTemplate ?? "Без шаблона");
  const [saving, setSaving] = useState(false);
  const country = COUNTRIES.find((option) => option.code === countryCode) ?? initialCountry;

  async function refreshTemplates() {
    setTemplatesBusy(true);
    try {
      setTemplates(await api.listVoicerTemplates());
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setTemplatesBusy(false);
    }
  }

  useEffect(() => { if (step === 2) void refreshTemplates(); }, [step]);

  async function save() {
    const selectedTemplate = templates.find((template) => template.uuid === templateUuid);
    const input: SaveChannelProfileInput = {
      name,
      countryCode: country.code,
      languageCode: country.languageCode,
      languageLabel: country.language,
      masterPrompt,
      lumeanTemplateUuid: templateUuid || undefined,
      lumeanTemplateName: selectedTemplate?.name || existing?.lumeanTemplateName,
      defaultDurationMinutes: duration,
      direction,
      defaultMediaMode: direction === "ai-story" ? "ai" : "stock",
      defaultImageStyle,
      motionTemplate
    };
    setSaving(true);
    try {
      await onSaved(existing ? await api.updateChannelProfile(existing.id, input) : await api.createChannelProfile(input));
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="channel-dialog" role="dialog" aria-modal="true">
        <div className="channel-dialog-header">
          <div><span>ШАГ {step} ИЗ 2</span><h2>{existing ? "Профиль канала" : "Новый канал"}</h2></div>
          <button className="icon-button" title="Закрыть" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="channel-stepper"><i className={step >= 1 ? "done" : ""} /><i className={step >= 2 ? "done" : ""} /></div>

        {step === 1 && (
          <div className="channel-form">
            <label><span>Название канала</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Истории великих открытий" /></label>
            <div className="channel-field"><span>Язык канала</span><CountryPicker value={countryCode} onChange={setCountryCode} /></div>
            <div className="selected-language"><FlagIcon code={country.code} /><div><strong>{country.language}</strong><small>{country.country}</small></div><Check size={17} /></div>
            <div className="channel-field">
              <span>Направление канала</span>
              <div className="channel-direction-picker" role="radiogroup" aria-label="Направление канала">
                <button type="button" role="radio" aria-checked={direction === "ai-story"} disabled={Boolean(existing)} className={direction === "ai-story" ? "selected" : ""} onClick={() => setDirection("ai-story")}>
                  <UserRound size={18} /><span><strong>AI Story</strong><small>Истории и объяснения из AI-изображений, герой канала и выборочное Veo.</small></span>
                </button>
                <button type="button" role="radio" aria-checked={direction === "stock-documentary"} disabled={Boolean(existing)} className={direction === "stock-documentary" ? "selected" : ""} onClick={() => setDirection("stock-documentary")}>
                  <Film size={18} /><span><strong>Stock Documentary</strong><small>Стоковые видео и изображения с плотным монтажом.</small></span>
                </button>
              </div>
              {existing && <small className="locked-direction-note">Направление закреплено при создании канала и не изменяется.</small>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="channel-form channel-final-step">
            <div className="voice-picker-row">
              <label><span>Сохранённый голос Lumean</span>
                <select value={templateUuid} onChange={(event) => setTemplateUuid(event.target.value)}>
                  <option value="">Голос пока не выбран</option>
                  {existing?.lumeanTemplateUuid && !templates.some((template) => template.uuid === existing.lumeanTemplateUuid) && (
                    <option value={existing.lumeanTemplateUuid}>{existing.lumeanTemplateName || "Сохранённый голос"}</option>
                  )}
                  {templates.map((template) => <option key={template.uuid} value={template.uuid} disabled={template.broken}>{template.name}{template.broken ? " (недоступен)" : ""}</option>)}
                </select>
              </label>
              <button className="icon-button refresh-voice" title="Обновить список голосов" disabled={templatesBusy} onClick={() => void refreshTemplates()}><RefreshCw size={17} className={templatesBusy ? "spin" : ""} /></button>
            </div>
            {templates.length === 0 && <button className="settings-inline-link" onClick={onOpenSettings}><Settings size={15} /> Подключить Lumean API в настройках</button>}
            <div className="channel-default-grid">
              <small>Длительность ролика рассчитывается по готовому тексту и выбранному голосу.</small>
              <label><span>Направление</span><input value={directionLabel(direction)} disabled title="Направление нельзя изменить после создания канала" /></label>
              {direction !== "ai-story" && <label><span>Motion-шаблон</span><select value={motionTemplate} onChange={(event) => setMotionTemplate(event.target.value)}><option>Без шаблона</option><option>Документальный</option><option>Кинематографичный</option><option>Энергичный</option></select></label>}
            </div>
            <details><summary>Дополнительные визуальные правила · необязательно</summary><label><span>Правила оформления, не текст озвучки</span><textarea value={masterPrompt} onChange={event => setMasterPrompt(event.target.value)} placeholder="Постоянные детали внешности, окружения и композиции. Можно оставить пустым." /></label></details>
            {direction === "ai-story" && <label className="channel-style-field">
              <span>Стиль изображений канала</span>
              <textarea data-channel-image-style rows={3} maxLength={2000} value={defaultImageStyle}
                onChange={event => setDefaultImageStyle(event.target.value)}
                placeholder="Например: плоская 2D-иллюстрация, тонкий контур, мягкая акварель, без 3D" />
              <small>Наследуется новыми роликами. Если выбран герой канала, начальный стиль берётся из его портрета. Стиль отдельного ролика можно изменить перед сценарием.</small>
            </label>}
          </div>
        )}

        <div className="channel-dialog-footer">
          <button className="outline-button" onClick={step === 1 ? onClose : () => setStep((value) => value - 1)}><ArrowLeft size={16} /> {step === 1 ? "Отмена" : "Назад"}</button>
          {step < 2 ? (
            <button className="primary-button" disabled={step === 1 && !name.trim()} onClick={() => setStep((value) => value + 1)}>Далее</button>
          ) : (
            <button className="primary-button" disabled={saving || !name.trim()} onClick={() => void save()}><Check size={17} /> {saving ? "Сохраняю…" : "Сохранить канал"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function NewVideoDialog({ api, profile, busy, onClose, onCreate, onError }: {
  api: DesktopApi;
  profile: ChannelProfile;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: NewChannelVideoInput) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const aiStory = profile.direction === "ai-story";
  const creationMode = "script" as const;
  const [content, setContent] = useState("");
  const [imageStyle, setImageStyle] = useState(() => channelImageStyle(profile, createDefaultProjectSettings().image.style, Boolean(profile.primaryCharacter)));
  const [templates, setTemplates] = useState<VoicerTemplate[]>([]);
  const [voicesBusy, setVoicesBusy] = useState(false);
  const [voiceChoice, setVoiceChoice] = useState(() => initialVoiceChoice(profile));
  const [calibration, setCalibration] = useState<VoiceCalibration | null>(null);
  const [calibrationBusy, setCalibrationBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [useChannelCharacter, setUseChannelCharacter] = useState(Boolean(profile.primaryCharacter));

  useEffect(() => {
    let cancelled = false;
    setVoicesBusy(true);
    void api.listVoicerTemplates()
      .then((items) => { if (!cancelled) setTemplates(items); })
      .catch((reason) => { if (!cancelled) setVoiceError(errorText(reason)); })
      .finally(() => { if (!cancelled) setVoicesBusy(false); });
    return () => { cancelled = true; };
  }, [api]);

  const voice = resolveVoiceChoice(voiceChoice, profile, templates);
  const edgeVoices = TTS_VOICES.filter((item) => item.language === "any" || item.language === profile.languageCode);
  const estimatedDurationSeconds = calibration && content.trim() ? estimateNarrationDurationSeconds(content, calibration) : null;

  async function calibrateSelectedVoice() {
    if (!voice) {
      setVoiceError("Сначала выберите конкретный голос");
      return;
    }
    setCalibrationBusy(true);
    setVoiceError(null);
    try {
      const result = await api.calibrateVoice({ provider: voice.provider, voice: voice.id, language: profile.languageLabel });
      setCalibration(result.calibration);
      const audio = new Audio(`data:audio/mpeg;base64,${result.sampleAudioBase64}`);
      await audio.play().catch(() => undefined);
    } catch (reason) {
      const message = errorText(reason);
      setVoiceError(message);
      onError(message);
    } finally {
      setCalibrationBusy(false);
    }
  }

  async function createVideo() {
    if (!voice || !calibration || busy || creating || !title.trim() || !content.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await onCreate({title:title.trim(), creationMode,
        content,
        voiceProvider:voice.provider, voice:voice.id, voiceLabel:voice.label, calibration, useChannelCharacter,
        imageStyle: aiStory ? imageStyle : undefined});
    } catch (reason) {
      const message = errorText(reason);
      setCreateError(message);
      onError(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !creating && !calibrationBusy) onClose(); }}>
      <div className="channel-dialog video-dialog" role="dialog" aria-modal="true">
        <div className="channel-dialog-header"><div><span className="dialog-channel-label"><FlagIcon code={profile.countryCode} /> {profile.name}</span><h2>Новый ролик</h2></div><button className="icon-button" title="Закрыть" disabled={creating || calibrationBusy} onClick={onClose}><X size={18} /></button></div>
        <fieldset className="channel-form video-input-fields" disabled={creating || busy}>
          <div className="video-context-note"><FileText size={19} /><span>{aiStory ? "Вставьте готовый сценарий. Программа сохранит текст и подготовит кадры, персонажей и визуальные промпты." : "Вставьте готовый сценарий. Программа сохранит текст, разделит его на сцены и подготовит поисковые запросы к реальным видео и фото."}</span></div>
          {profile.direction === "ai-story" && profile.primaryCharacter && (
            <label className="reuse-channel-character">
              <input type="checkbox" checked={useChannelCharacter} onChange={(event) => {
                setUseChannelCharacter(event.target.checked);
                setImageStyle(channelImageStyle(profile, createDefaultProjectSettings().image.style, event.target.checked));
              }} />
              <img src={api.mediaUrl(profile.primaryCharacter.imagePath)} alt="Герой канала" />
              <span><strong>Использовать героя «{profile.primaryCharacter.name}»</strong><small>Подтверждённый образ этого канала будет передан во все сцены, где присутствует главный герой.</small></span>
            </label>
          )}
          <label><span>Название проекта</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Рабочее название ролика" /></label>
          <label>
            <span>Готовый сценарий</span>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Вставьте полный текст озвучки. Программа не будет его сокращать или переписывать…"
            />
          </label>
          {aiStory && <details className="new-video-style"><summary>Стиль изображений · {IMAGE_STYLES.find(item => item.promptSuffix === imageStyle)?.label ?? "Свой стиль"}</summary><VisualStyleChooser value={imageStyle} onChange={setImageStyle} compact /></details>}
          <div className="video-voice-calibration">
            <div className="video-voice-heading">
              <div><Mic2 size={18} /><span><strong>Голос и расчёт длительности</strong><small>Перед разбивкой программа озвучит тестовую фразу и измерит скорость выбранного голоса.</small></span></div>
              {calibration && <span className="voice-calibration-ready"><Check size={14} /> Измерено</span>}
            </div>
            <div className="video-voice-controls">
              <select
                value={voiceChoice}
                onChange={(event) => { setVoiceChoice(event.target.value); setCalibration(null); setVoiceError(null); }}
                disabled={calibrationBusy}
              >
                <option value="">Выберите голос</option>
                {profile.lumeanTemplateUuid && !templates.some((item) => item.uuid === profile.lumeanTemplateUuid) && (
                  <option value={`lumean:${profile.lumeanTemplateUuid}`}>{profile.lumeanTemplateName || "Голос канала"} · Lumean</option>
                )}
                {templates.length > 0 && <optgroup label="Lumean">{templates.map((template) => <option key={template.uuid} value={`lumean:${template.uuid}`} disabled={template.broken}>{template.name}{template.broken ? " (недоступен)" : ""}</option>)}</optgroup>}
                <optgroup label="Edge / Google TTS">{edgeVoices.map((item) => <option key={item.id} value={`edge:${item.id}`}>{item.label}</option>)}</optgroup>
              </select>
              <button type="button" className="outline-button" disabled={!voice || calibrationBusy} onClick={() => void calibrateSelectedVoice()}>
                {calibrationBusy ? <RefreshCw size={16} className="spin" /> : <Play size={16} />}
                {calibrationBusy ? "Озвучиваю…" : calibration ? "Проверить ещё раз" : "Озвучить и измерить"}
              </button>
            </div>
            {voicesBusy && <small className="voice-calibration-note">Обновляю список голосов Lumean…</small>}
            {calibration && (
              <div className="voice-calibration-stats">
                <Gauge size={16} />
                <span>
                  <strong>{calibration.charactersPerSecond.toFixed(1)} зн./с</strong>
                  <small>
                    {Math.round(calibration.wordsPerMinute)} слов/мин · тест {calibration.audioDurationSeconds.toFixed(1)} с
                    {estimatedDurationSeconds !== null
                      ? ` · готовый текст ≈ ${formatDuration(estimatedDurationSeconds)}`
                      : ""}
                  </small>
                </span>
              </div>
            )}
            {voiceError && <small className="voice-calibration-error">{voiceError}</small>}
          </div>
          {content.trim() && <div className="video-duration-estimate" role="status">
            <Clock3 size={20} /><div><strong>{estimatedDurationSeconds !== null ? `Примерная длина ролика: ${formatDuration(estimatedDurationSeconds)}` : "Сколько будет длиться ролик?"}</strong>
              <p>{calibration ? `По измеренной скорости выбранного голоса (${calibration.charactersPerSecond.toFixed(1)} зн./с). Фактическая озвучка может немного отличаться.` : "Выберите голос и нажмите «Озвучить и измерить» — появится расчёт для всего вставленного текста."}</p></div>
          </div>}
          <div className="video-context-note"><Check size={16} /><span>{aiStory ? "Готовый текст будет сохранён без переписывания, разделён на смысловые кадры и дополнен визуальными промптами." : "Текст не переписывается. После подготовки в настройках одна кнопка запускает озвучку, подбор материалов и сборку."}</span></div>
        </fieldset>
        {createError && <p className="voice-calibration-error video-create-error" role="alert">{createError}</p>}
        <div className="channel-dialog-footer"><button className="outline-button" disabled={creating || calibrationBusy} onClick={onClose}>Отмена</button><button className="primary-button" disabled={busy || creating || calibrationBusy || !title.trim() || !content.trim() || !voice || !calibration || (aiStory && !imageStyle.trim())} onClick={() => void createVideo()}><Play size={17} /> {busy || creating ? "Создаю…" : "Создать и разбить на кадры"}</button></div>
      </div>
    </div>
  );
}

function TrashDialog({ api, onClose, onChanged, onError, onNotice }: {
  api: DesktopApi;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [items, setItems] = useState<TrashItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setItems(await api.listTrash());
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [api]);

  async function restore(item: TrashItemSummary) {
    setBusyId(item.trashId);
    try {
      await api.restoreTrashItem(item.trashId);
      await Promise.all([refresh(), onChanged()]);
      onNotice(item.kind === "channel" ? "Канал восстановлен." : "Ролик и его локальные файлы восстановлены.");
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setBusyId(null);
    }
  }

  async function purge(item: TrashItemSummary) {
    const description = item.kind === "channel"
      ? `Окончательно удалить запись канала «${item.title}»? Связанные ролики останутся, но восстановить профиль канала будет нельзя.`
      : `Окончательно удалить ролик «${item.title}» и его локальные файлы? Это действие нельзя отменить.`;
    if (!window.confirm(description)) return;
    setBusyId(item.trashId);
    try {
      await api.purgeTrashItem(item.trashId);
      await refresh();
      onNotice("Запись окончательно удалена из корзины.");
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="channel-dialog trash-dialog" role="dialog" aria-modal="true" aria-label="Корзина">
        <div className="channel-dialog-header">
          <div><span>ВОССТАНОВИМОЕ УДАЛЕНИЕ</span><h2>Корзина</h2></div>
          <button className="icon-button" title="Закрыть" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="trash-dialog-body">
          <p>Удалённые ролики и каналы сначала попадают сюда. Окончательное удаление всегда требует отдельного подтверждения.</p>
          {loading ? (
            <div className="channel-section-empty"><RefreshCw className="spin" size={24} /><p>Загружаю корзину…</p></div>
          ) : items.length === 0 ? (
            <div className="channel-section-empty"><Trash2 size={28} /><p>Корзина пуста.</p></div>
          ) : (
            <div className="trash-list">
              {items.map((item) => (
                <article key={item.trashId}>
                  <span className="trash-kind">{item.kind === "channel" ? "КАНАЛ" : "РОЛИК"}</span>
                  <div><strong>{item.title}</strong><small>{new Date(item.deletedAt).toLocaleString("ru-RU")}{item.kind === "channel" && item.relatedProjectCount ? ` · роликов сохранено: ${item.relatedProjectCount}` : ""}</small></div>
                  <button className="outline-button" disabled={busyId === item.trashId} onClick={() => void restore(item)}><ArchiveRestore size={15} /> Восстановить</button>
                  <button className="icon-button trash-purge" title="Удалить окончательно" disabled={busyId === item.trashId} onClick={() => void purge(item)}><Trash2 size={15} /></button>
                </article>
              ))}
            </div>
          )}
        </div>
        <div className="channel-dialog-footer"><span /><button className="outline-button" onClick={onClose}>Закрыть</button></div>
      </div>
    </div>
  );
}

function initialVoiceChoice(profile: ChannelProfile): string {
  if (profile.lumeanTemplateUuid) return `lumean:${profile.lumeanTemplateUuid}`;
  const edge = TTS_VOICES.find((item) => item.language === profile.languageCode)
    ?? TTS_VOICES.find((item) => item.language === "any");
  return edge ? `edge:${edge.id}` : "";
}

function resolveVoiceChoice(value: string, profile: ChannelProfile, templates: VoicerTemplate[]): { provider: "edge-tts" | "elevenlabs"; id: string; label: string } | null {
  if (value.startsWith("lumean:")) {
    const id = value.slice("lumean:".length).trim();
    if (!id) return null;
    const template = templates.find((item) => item.uuid === id);
    return { provider: "elevenlabs", id, label: template?.name || (profile.lumeanTemplateUuid === id ? profile.lumeanTemplateName : undefined) || "Голос Lumean" };
  }
  if (value.startsWith("edge:")) {
    const id = value.slice("edge:".length).trim();
    const option = TTS_VOICES.find((item) => item.id === id && (item.language === "any" || item.language === profile.languageCode || item.language === ttsLanguageCode(profile.languageCode).split("-")[0]));
    return id && option ? { provider: "edge-tts", id, label: option.label } : null;
  }
  return null;
}

function buildCountryOptions(): CountryOption[] {
  const regionNames = new Intl.DisplayNames(["ru"], { type: "region" });
  const languageNames = new Intl.DisplayNames(["ru"], { type: "language" });
  const options: CountryOption[] = [];
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      if (!ISO_COUNTRY_CODES.has(code)) continue;
      const country = regionNames.of(code);
      if (!country || country === code) continue;
      try {
        const languageCode = new Intl.Locale(`und-${code}`).maximize().language;
        const language = languageNames.of(languageCode) || languageCode;
        options.push({ code, country, languageCode, language });
      } catch {
        // Некоторые зарезервированные коды не являются допустимыми Locale.
      }
    }
  }
  return options.sort((a, b) => a.country.localeCompare(b.country, "ru"));
}

function directionLabel(direction: ChannelDirection): string {
  return direction === "ai-story" ? "AI Story" : "Stock Documentary";
}

function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function CountryPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = COUNTRIES.find((country) => country.code === value) ?? COUNTRIES[0]!;
  const filtered = COUNTRIES.filter((country) => `${country.country} ${country.language}`.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));
  return (
    <div className="country-picker">
      <button className="country-picker-trigger" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <FlagIcon code={selected.code} />
        <span><strong>{selected.country}</strong><small>{selected.language}</small></span>
        <Globe2 size={16} />
      </button>
      {open && (
        <div className="country-picker-popover">
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти страну или язык…" />
          <div className="country-picker-list">
            {filtered.map((country) => (
              <button key={country.code} type="button" className={country.code === value ? "selected" : ""} onClick={() => { onChange(country.code); setOpen(false); setQuery(""); }}>
                <FlagIcon code={country.code} />
                <span><strong>{country.country}</strong><small>{country.language}</small></span>
                {country.code === value && <Check size={15} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FlagIcon({ code, large = false }: { code: string; large?: boolean }) {
  const Icon = (FlagIcons as unknown as Record<string, ComponentType<SVGProps<SVGSVGElement>>>)[code.toUpperCase()];
  if (!Icon) return <Globe2 className={`channel-flag${large ? " large" : ""}`} aria-label={code} />;
  return <Icon className={`channel-flag${large ? " large" : ""}`} aria-label={code} />;
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
