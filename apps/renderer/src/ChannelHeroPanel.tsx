import { useState } from "react";
import { ArchiveRestore, Check, Pencil, RefreshCw, Trash2, UserRound, X } from "lucide-react";
import type { ChannelCharacterGenerationInput, ChannelCharacterReference, ChannelProfile, DesktopApi, Project } from "@gold-work/shared";

export function ChannelHeroPanel({ profile, projects, api, disabled, onChanged }: {
  profile: ChannelProfile; projects: Project[]; api: DesktopApi; disabled: boolean; onChanged: () => Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [preview, setPreview] = useState<ChannelCharacterReference>();
  const hero = profile.primaryCharacter;
  const source = profile.characterVersions.find(version => version.versionId === (editing || profile.characterGeneration?.sourceVersionId));
  const available = projects.filter(project => project.channelProfileId === profile.id && project.mediaMode === "ai")
    .flatMap(project => (project.storyCharacters ?? []).filter(character => character.status === "ready" && character.imagePath)
      .map(character => ({ project, character })));
  const locked = disabled || working;
  const neededForGeneration = (versionId: string) => !!profile.characterGeneration
    && [profile.characterGeneration.sourceVersionId, profile.characterGeneration.versionId].includes(versionId);

  function remove(version: ChannelCharacterReference) {
    if (locked || neededForGeneration(version.versionId)) return;
    const mainNotice = version.versionId === hero?.versionId ? " Новые ролики будут без главного героя, пока вы не выберете другого." : "";
    if (!window.confirm(`Удалить образ «${version.name}» из канала?${mainNotice} Готовые ролики и их портреты не изменятся. Образ можно восстановить в разделе «Удалённые образы».`)) return;
    setPreview(undefined);
    void run(() => api.deleteChannelCharacterVersion(profile.id, version.versionId), "Образ удалён из библиотеки канала. Готовые ролики сохранены; восстановление доступно в «Удалённых образах».");
  }

  async function run(operation: () => Promise<ChannelProfile>, message: string) {
    if (locked) return;
    setWorking(true); setError(undefined); setNotice(undefined);
    try { await operation(); setNotice(message); setEditing(undefined); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally {
      try { await onChanged(); } catch { setError("Не удалось обновить канал. Откройте его снова."); }
      setWorking(false);
    }
  }

  return <section className="channel-section channel-character-section" data-channel-hero>
    <div className="channel-section-heading"><div><h2>Главный герой канала</h2><span>{hero ? 1 : 0}</span></div></div>
    {hero ? <div className="channel-character-card">
      <button className="channel-hero-portrait" title="Посмотреть героя" onClick={() => setPreview(hero)}>
        <img src={api.mediaUrl(hero.imagePath)} alt={`Главный герой ${hero.name}`} />
      </button>
      <div><strong>{hero.name}</strong><p>{hero.characterPrompt || hero.prompt}</p>
        <small>Доступен при создании нового ролика. Готовые ролики сохраняют свои образы.</small>
        <div className="channel-hero-editor-actions">
          <button className="outline-button" disabled={locked || !!profile.characterGeneration} onClick={() => setEditing(hero.versionId)}><Pencil size={15} />Изменить образ</button>
          <button className="outline-button danger-outline" data-delete-hero={hero.versionId} disabled={locked || neededForGeneration(hero.versionId)}
            title={neededForGeneration(hero.versionId) ? "Сначала завершите создание нового образа" : "Удалить этот образ из канала"} onClick={() => remove(hero)}><Trash2 size={15} />Удалить из канала</button>
        </div>
      </div>
    </div> : <div className="channel-section-empty"><UserRound size={28} /><p>{available.length
      ? "Персонажи уже созданы в роликах. Выберите ниже, кто станет постоянным героем канала."
      : "Сначала создайте персонажа на этапе «Сценарий». Затем здесь можно сохранить его главным героем канала."}</p></div>}
    {error && <p className="story-cast-error" role="alert">{error}</p>}
    {notice && <p className="channel-hero-notice" role="status">{notice}</p>}
    {working && <p role="status"><RefreshCw size={15} className="spin" /> Обрабатываю образ… Можно перейти в другой раздел.</p>}
    {source && <ChannelHeroEditor key={`${source.versionId}:${profile.characterGeneration?.versionId ?? "new"}`}
      source={source} profile={profile} disabled={locked} onClose={() => setEditing(undefined)}
      onGenerate={input => void run(() => api.generateChannelCharacter(profile.id, input), "Новый вариант готов. Просмотрите его и нажмите «Сделать основным» — старый образ пока не изменён.")} />}
    {!!profile.characterVersions.filter(version => version.versionId !== hero?.versionId).length && <details className="channel-hero-options" open>
      <summary>Сохранённые варианты · {profile.characterVersions.length - (hero ? 1 : 0)}</summary>
      <div className="channel-hero-options-grid">{profile.characterVersions.filter(version => version.versionId !== hero?.versionId).map(version =>
        <article key={version.versionId} data-hero-version={version.versionId}>
          <button className="channel-hero-portrait" onClick={() => setPreview(version)}><img src={api.mediaUrl(version.imagePath)} alt={version.name} /></button>
          <strong>{version.name}</strong><small>{new Date(version.createdAt).toLocaleString("ru-RU")}</small>
          <button className="outline-button" disabled={locked} onClick={() => void run(() => api.selectChannelCharacterVersion(profile.id, version.versionId), "Основной герой канала обновлён. Уже созданные ролики не изменены.")}><Check size={14} />Сделать основным</button>
          <button className="outline-button danger-outline" data-delete-hero={version.versionId} disabled={locked || neededForGeneration(version.versionId)}
            title={neededForGeneration(version.versionId) ? "Сначала завершите создание нового образа" : "Удалить этот вариант"} onClick={() => remove(version)}><Trash2 size={14} />Удалить</button>
        </article>)}</div>
    </details>}
    {!!available.length && <details className="channel-hero-options" open={!hero}>
      <summary>Выбрать главного героя из роликов</summary>
      <div className="channel-hero-options-grid">{available.map(({ project, character }) => <article key={`${project.id}:${character.id}`} data-hero-source={character.id}>
        <img src={api.mediaUrl(character.imagePath!)} alt={character.name} />
        <strong>{character.name}</strong><small>Ролик: {project.title}</small>
        <button className="outline-button" disabled={locked} onClick={() => {
          if (hero && !window.confirm(`Сделать «${character.name}» главным героем канала? Прежняя версия и готовые ролики сохранятся.`)) return;
          void run(() => api.saveStoryCharacterToChannel(project.id, character.id), "Герой сохранён в канале. Теперь его можно выбрать для следующего ролика.");
        }}>Сделать главным</button>
      </article>)}</div>
    </details>}
    {!!profile.deletedCharacterVersions?.length && <details className="channel-hero-options" data-deleted-heroes>
      <summary>Удалённые образы · {profile.deletedCharacterVersions.length}</summary>
      <p>Они больше не предлагаются новым роликам. Файлы сохранены, чтобы не повредить старые проекты.</p>
      <div className="channel-hero-options-grid">{profile.deletedCharacterVersions.map(version => <article key={version.versionId} data-deleted-hero={version.versionId}>
        <button className="channel-hero-portrait" onClick={() => setPreview(version)}><img src={api.mediaUrl(version.imagePath)} alt={version.name} /></button>
        <strong>{version.name}</strong>
        <button className="outline-button" disabled={locked} onClick={() => void run(() => api.restoreChannelCharacterVersion(profile.id, version.versionId), "Образ восстановлен в сохранённых вариантах. Чтобы использовать его в новых роликах, нажмите «Сделать основным».")}><ArchiveRestore size={14} />Восстановить</button>
      </article>)}</div>
    </details>}
    {preview && <div className="modal-backdrop" onClick={() => setPreview(undefined)}><section className="cast-preview-modal" role="dialog" aria-modal="true" aria-label={`Образ ${preview.name}`} onClick={event => event.stopPropagation()}>
      <header><strong>{preview.name}</strong><button className="icon-button" title="Закрыть портрет" onClick={() => setPreview(undefined)}><X size={18} /></button></header>
      <img src={api.mediaUrl(preview.imagePath)} alt={preview.name} /><p>{preview.characterPrompt || preview.prompt}</p>
    </section></div>}
  </section>;
}

function ChannelHeroEditor({ source, profile, disabled, onClose, onGenerate }: {
  source: ChannelCharacterReference; profile: ChannelProfile; disabled: boolean; onClose: () => void;
  onGenerate: (input: ChannelCharacterGenerationInput) => void;
}) {
  const pending = profile.characterGeneration;
  const [name, setName] = useState(pending?.name ?? source.name);
  const [prompt, setPrompt] = useState(pending?.prompt ?? source.characterPrompt ?? source.prompt);
  return <div className="channel-hero-editor">
    <strong>Новый вариант героя</strong>
    <p>Измените внешность и создайте портрет через Flow. Он заменит героя канала только после вашего подтверждения.</p>
    <label>Имя героя<input value={name} maxLength={100} disabled={disabled || !!pending?.remoteJob} onChange={event => setName(event.target.value)} /></label>
    <label>Описание внешности<textarea rows={5} maxLength={4000} value={prompt} disabled={disabled || !!pending?.remoteJob} onChange={event => setPrompt(event.target.value)} /></label>
    <small>Сохраняется стиль исходного портрета. Уже готовые кадры и ролики не перерисовываются.</small>
    {pending?.error && <p className="story-cast-error" role="alert">{pending.error}</p>}
    {pending && <p>{pending.remoteJob ? "В Flow уже есть результат. Будет загружен прежний портрет, без новой генерации."
      : "Предыдущая попытка могла быть принята сервисом. Повтор может снова израсходовать лимит."}</p>}
    <div className="channel-hero-editor-actions"><button className="primary-button" disabled={disabled || !name.trim() || !prompt.trim()} onClick={() => {
      if (pending && !pending.remoteJob && !window.confirm("Результат предыдущей попытки неизвестен. Отправить новый запрос? Это может повторно израсходовать лимит.")) return;
      onGenerate({ sourceVersionId: source.versionId, name, prompt });
    }}><RefreshCw size={15} />{pending?.remoteJob ? "Получить готовый образ из Flow" : "Создать новый вариант"}</button>
      {!pending && <button className="outline-button" disabled={disabled} onClick={onClose}>Отмена</button>}</div>
  </div>;
}
