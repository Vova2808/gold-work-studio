import {useEffect, useState} from 'react';
import {documentaryAiPlanContext, type Project, type Scene} from '@gold-work/shared';

const sha256 = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

function Queries({label, queries}: {label: string; queries: readonly string[]}) {
  return <label className="field"><span>{label}</span>
    <textarea readOnly aria-label={label} rows={Math.max(2, Math.min(6, queries.length))}
      value={queries.join('\n')} placeholder="Запросы не сохранены" />
  </label>;
}

/** Inspect the saved search contract. Opening this view never plans, saves or calls a provider. */
export function SceneSearchQueries({project, scene}: {project: Project; scene: Scene}) {
  const requirement = scene.documentary?.requirement;
  const plan = requirement?.aiSearchPlan;
  const context = JSON.stringify(documentaryAiPlanContext(project));
  const key = JSON.stringify([context, scene.id, plan?.model, plan?.inputHash, requirement?.text, scene.narration]);
  const [checked, setChecked] = useState<{key: string; current?: boolean}>();
  useEffect(() => {
    let cancelled = false;
    if (plan) void (async () => {
      const inputHash = await sha256(JSON.stringify({version: 1, model: plan.model, context: JSON.parse(context)}));
      const sceneHash = await sha256(JSON.stringify({inputHash, sceneId: scene.id}));
      if (!cancelled) setChecked({key, current: plan.version === 1 && requirement?.text === scene.narration && plan.inputHash === sceneHash});
    })().catch(() => { if (!cancelled) setChecked({key}); });
    return () => { cancelled = true; };
  }, [key]);
  const fallback = requirement?.footageFallback;
  const activeFallback = Boolean(fallback && (!plan || checked?.key === key && checked.current)
    && (fallback.narration ?? requirement?.text) === scene.narration
    && plan && fallback.target === plan.fallbackVisualTarget
      && JSON.stringify(fallback.queries) === JSON.stringify(plan.fallbackVideoQueries));
  return <section className="scene-search-queries" aria-label="Поисковые запросы">
    <h3>Поисковые запросы</h3>
    <p>Сохранённые данные подбора · только чтение · один запрос в строке.</p>
    {plan ? <>
      <p role="status">{checked?.key !== key ? 'Проверяю актуальность сохранённого плана…'
        : checked.current === undefined ? 'Не удалось проверить актуальность плана. Показаны сохранённые запросы.'
        : checked.current ? 'AI-план соответствует текущему сценарию.'
        : 'План устарел: сценарий или его контекст изменился. Эти запросы требуют обновления перед новым подбором.'}</p>
      <p><strong>Визуальная цель:</strong> {plan.visualTarget}</p>
      <Queries label="Запросы для фотографий" queries={plan.imageQueries} />
      <Queries label="Запросы для видео" queries={plan.videoQueries} />
      {!!plan.fallbackVideoQueries.length && <>
        <p><strong>Тематический резерв видео:</strong> {plan.fallbackVisualTarget}. Используется после неудачного точного поиска.</p>
        <Queries label="Резервные запросы для видео" queries={plan.fallbackVideoQueries} />
      </>}
    </> : <>
      <p role="status">Отдельный AI-план запросов для фото и видео не сохранён. Открытие редактора не запускает планирование.</p>
      {!!requirement?.queries.length && <Queries label="Общие сохранённые запросы (прежний или локальный план)" queries={requirement.queries} />}
      {!requirement?.queries.length && scene.stockQuery && <Queries label="Сохранённый поисковый запрос (прежний план)" queries={[scene.stockQuery]} />}
    </>}
    {fallback && (plan ? <>
      <p>{activeFallback ? 'Для подбора выбран тематический резерв' : 'Сохранённый тематический резерв сейчас не активен'}: {fallback.target}</p>
      <Queries label={`Сохранённый резерв для ${fallback.kind === 'image' ? 'фотографий' : 'видео'}`} queries={fallback.queries} />
    </> : <>
      <p>Сохранённый тематический резерв прежнего плана: {fallback.target}. При подборе планировщик может уточнить эти запросы; тип материала определяется на этапе поиска.</p>
      <Queries label="Исходные запросы резерва (прежний план)" queries={fallback.queries} />
    </>)}
  </section>;
}
