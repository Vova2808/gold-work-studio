import { useState } from "react";
import { Check, RefreshCw, UserRound, X } from "lucide-react";
import type { DesktopApi, Project, StoryCharacter } from "@gold-work/shared";

export function StoryCharactersPanel({ project, api, disabled, readOnly = false, onUpdated }: {
  project: Project; api: DesktopApi; disabled: boolean; readOnly?: boolean; onUpdated: (project: Project) => void | Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<{ path: string; name: string }>();
  const [channelCharacterId, setChannelCharacterId] = useState("");
  const [channelNotice, setChannelNotice] = useState<string>();
  const run = async (operation: () => Promise<Project>) => {
    if (working || disabled) return;
    setWorking(true); setError(undefined);
    try { await onUpdated(await operation()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setWorking(false); }
  };
  const characters = project.storyCharacters ?? [];
  const locked = disabled || working || project.status === "generating" || project.status === "paused";
  return <section className="story-cast-panel">
    <header><div><h2><UserRound size={20} /> Персонажи ролика {characters.length ? `· ${characters.length}` : ""}</h2>
      <p>У каждого свой образ. В кадр передаются только персонажи, которые участвуют в этой сцене.</p></div>
      {!readOnly && (!characters.length || characters.some(character => !character.imagePath) || project.storyCharacterPlan?.status !== "ready" || project.storyCharacterPlan?.error) && <button className="outline-button" disabled={locked} onClick={() => void run(() => api.prepareStoryCharacters(project.id))}>
        <RefreshCw size={15} className={working ? "spin" : ""} />{working ? "Подготавливаю…" : characters.length ? "Создать недостающие образы" : "Определить персонажей"}
      </button>}</header>
    {(error || project.storyCharacterPlan?.error) && <p className="story-cast-error" role="alert">{error || project.storyCharacterPlan?.error}</p>}
    {project.storyCharacterPlan?.status === "ready" && !characters.length && <p>В этом сценарии не найден постоянный персонаж. Кадры будут создаваться без вымышленного ведущего.</p>}
    <div className="story-cast-strip">{characters.map(character => <button key={character.id} disabled={!character.imagePath} onClick={() => setPreview({ path: character.imagePath!, name: character.name })}>
      {character.imagePath ? <img src={api.mediaUrl(character.imagePath)} alt={character.name} /> : <UserRound size={32} />}
      <span>{character.name}</span><small>{character.error ? "Нужна проверка" : character.imagePath ? "Образ создан" : "Образ не готов"}</small>
    </button>)}</div>
    {project.channelProfileId && !readOnly && characters.some(character => character.imagePath && character.status === "ready") && <div className="story-channel-hero-picker">
      <label>Главный герой для следующих роликов<select value={channelCharacterId} disabled={locked} onChange={event => setChannelCharacterId(event.target.value)}>
        <option value="">Выберите персонажа</option>
        {characters.filter(character => character.imagePath && character.status === "ready").map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
      </select></label>
      <button className="outline-button" disabled={locked || !channelCharacterId} onClick={async () => {
        if (!window.confirm("Сохранить выбранного персонажа главным героем канала? Прежние версии и готовые ролики останутся без изменений.")) return;
        setWorking(true); setError(undefined); setChannelNotice(undefined);
        try {
          const profile = await api.saveStoryCharacterToChannel(project.id, channelCharacterId);
          setChannelNotice(`«${profile.primaryCharacter?.name}» сохранён в канале. Его можно выбрать при создании следующего ролика.`);
          window.dispatchEvent(new Event("gws:channel-character-changed"));
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setWorking(false); }
      }}>Сделать главным героем канала</button>
      {channelNotice && <p role="status">{channelNotice}</p>}
    </div>}
    {!!characters.length && !readOnly && <details className="story-cast-details"><summary>Изменить образы и описания персонажей</summary>
    <div className="story-cast-grid">{characters.map(character => <CharacterCard key={`${character.id}:${character.imagePath ?? "draft"}`}
      character={character} count={project.scenes.filter(scene => scene.characterIds?.includes(character.id)).length}
      api={api} disabled={locked} onPreview={(path) => setPreview({ path, name: character.name })}
      onGenerate={prompt => void run(() => api.regenerateStoryCharacter(project.id, character.id, prompt))}
      onConfirm={() => void run(() => api.confirmStoryCharacter(project.id, character.id))} />)}</div></details>}
    <details className="story-prompt-help"><summary>Как описывать стиль, персонажей и кадры</summary>
      <p><b>Стиль:</b> техника, контур, палитра и свет. Например: «Плоская 2D-иллюстрация, чёткий тёмный контур, спокойные цвета, без объёмного рендера».</p>
      <p><b>Персонаж:</b> возраст, форма лица, глаза, волосы, телосложение, одежда и 1–2 отличительных признака. Например: «Анна, 35 лет, овальное лицо, зелёные глаза, короткие каштановые волосы, стройная, синяя куртка и охристый шарф». Без фона и действий.</p>
      <p><b>Кадр:</b> кто, где, что делает и какой план камеры. Например: «Анна открывает дверь мастерской, средний план, пасмурное утро». Стиль и сохранённая внешность добавятся отдельно.</p>
      <p>Не смешивайте противоречащие техники («плоский рисунок» и «фотореализм»), не меняйте одежду случайно. Референсы помогают удерживать внешность, но результат генератора всё равно нужно просмотреть. Изменение образа не перерисовывает уже готовые кадры автоматически.</p>
    </details>
    {preview && <div className="modal-backdrop" onClick={() => setPreview(undefined)}><section className="cast-preview-modal" role="dialog" aria-modal="true" aria-label={preview.name} onClick={event => event.stopPropagation()}>
      <header><strong>{preview.name}</strong><button className="icon-button" title="Закрыть портрет" onClick={() => setPreview(undefined)}><X size={18} /></button></header>
      <img src={api.mediaUrl(preview.path)} alt={preview.name} />
    </section></div>}
  </section>;
}

function CharacterCard({ character, count, api, disabled, onPreview, onGenerate, onConfirm }: {
  character: StoryCharacter; count: number; api: DesktopApi; disabled: boolean; onPreview: (path: string) => void;
  onGenerate: (prompt: string) => void; onConfirm: () => void;
}) {
  const [prompt, setPrompt] = useState(character.candidate?.prompt ?? character.prompt);
  return <article className="story-character-card" data-story-character={character.id}>
    <header><strong>{character.name}</strong><small>{count} кадров</small></header>
    {character.imagePath ? <button className="story-character-portrait" onClick={() => onPreview(character.imagePath!)}><img src={api.mediaUrl(character.imagePath)} alt={character.name} /></button>
      : <div className="story-character-placeholder"><UserRound size={36} /><span>{character.status === "generating" ? "Создаётся образ…" : "Образ ещё не создан"}</span></div>}
    <label>Описание внешности<textarea value={character.pendingGeneration?.remoteJob ? character.pendingGeneration.prompt : prompt} maxLength={4000} rows={4} disabled={disabled || !!character.pendingGeneration?.remoteJob} onChange={event => setPrompt(event.target.value)} /></label>
    <button className="outline-button" disabled={disabled || !prompt.trim()} onClick={() => onGenerate(character.pendingGeneration?.remoteJob ? character.pendingGeneration.prompt : prompt)}><RefreshCw size={15} />{character.pendingGeneration?.remoteJob ? "Получить готовый образ из Flow" : character.imagePath ? "Создать новый вариант" : "Создать образ"}</button>
    {character.error && <p className="story-cast-error" role="alert">{character.error}</p>}
    {character.pendingGeneration?.remoteJob ? <small>Изображение уже создано. Будет загружен прежний результат, без новой генерации.</small>
      : character.pendingGeneration && !disabled && <small>Предыдущая попытка была прервана. Новый запуск может расходовать лимит повторно.</small>}
    {character.candidate && <div className="story-character-candidate"><strong>Новый вариант · ещё не применён</strong>
      <button className="story-character-portrait" onClick={() => onPreview(character.candidate!.imagePath)}><img src={api.mediaUrl(character.candidate.imagePath)} alt={`Новый образ ${character.name}`} /></button>
      <button className="generate-button" disabled={disabled} onClick={onConfirm}><Check size={15} />Использовать этот образ</button>
    </div>}
  </article>;
}
