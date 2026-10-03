import { createHash } from "node:crypto";
import { countNarrationCharacters, type NarrationDraftCheckpoint, type NarrationTimingBudget, type ReferenceAnalysis } from "@gold-work/shared";

type Plan = NarrationDraftCheckpoint["plan"];
export type NarrationCompletion = (messages: Array<{role: string; content: string}>, tokens: number, effort?: "medium" | "high") => Promise<string>;
export interface NarrationWriterOptions {
  analysis: ReferenceAnalysis;
  timing: NarrationTimingBudget;
  complete: NarrationCompletion;
  state?: NarrationDraftCheckpoint;
  save?: (state: NarrationDraftCheckpoint) => Promise<void>;
  stage?: (message: string) => void;
  signal?: AbortSignal;
}

function json<T>(text: string): T {
  try { return JSON.parse(text.replace(/^```(?:json)?\s*|```\s*$/g, "").trim()) as T; }
  catch { throw new Error("Модель вернула повреждённый JSON. Написанные разделы сохранены; продолжите с текущего этапа."); }
}

export function narrationDraftText(draft: NarrationDraftCheckpoint): string { return draft.sections.join("\n\n"); }

export function narrationDraftFingerprint(analysis: ReferenceAnalysis, timing: NarrationTimingBudget): string {
  // A different available model may continue the same brief. Model choice does
  // not invalidate content; language, brief and voice speed do.
  return createHash("sha256").update(JSON.stringify({ version: 1, title: analysis.suggestedTitle,
    angle: analysis.suggestedAngle, instructions: analysis.instructions, language: analysis.language,
    target: timing.targetSeconds, speed: timing.charactersPerSecond })).digest("hex");
}

const PLAN_SYSTEM = `Ты шеф-редактор сценариев, а не покадровый генератор. Спроектируй связный текст озвучки под заданную аудиторию и жанр.
Извлеки из исходного задания все обязательные темы, примеры, ограничения, тон и позицию рассказчика в writingBrief.
Определи genre по заданию: объяснение, вымышленная история, документальный рассказ или иной подходящий жанр. Строй развитие по его логике, а не по шаблону другой ниши.
В factLedger запиши краткие неизменные условия: имена/роли, события/даты, исходные числа с единицами и периодом, какие примеры отдельные, что известно и что нельзя утверждать. Перепроверь сложение составляющих времени. Если исходные сведения противоречат друг другу, явно отметь это, не маскируй красивым выводом. Для новости нужны предоставленные источники/даты, модель не имеет доступа к текущим событиям сама по себе.
Визуальные якоря, внешний вид героя и стиль сохрани отдельно в visualBible; не включай их в writingBrief.
Технические требования исходного промта о количестве сцен и формате imagePrompt относятся к следующему этапу и не ограничивают литературный текст.
Для объяснения нужны механизм, конкретные примеры, ограничения и вывод; для вымышленной истории — причинные действия и последствия; для фактического рассказа не выдумывай источники и события.
Каждый раздел добавляет новые сведения. Хук и обещание — один раз в начале; сравнение — один раздел; вывод — один раз в конце. Не придумывай искусственный детектив для обычного объяснения.
Начальная секция ставит вопрос через конкретный момент/действие и его значение для зрителя. НЕ включай в её keyPoints полные расчёты, все ответы и краткий пересказ следующих секций. Расположи доказательство/разбор после вступления. В visualBible задай постоянное краткое описание каждого повторяющегося персонажа, включая второстепенных.
Учитывай разную смысловую нагрузку разделов через sectionWeights; не дели время поровну. Хук/вывод короче содержательных примеров. В списке услуг/вариантов каждый вариант получает собственный раздел; не сливай последние два пункта ради формальной квоты разделов. Обычно достаточно 4–8 содержательных разделов для длинного ролика; не создавай главы ради количества. В goal укажи новую мысль/изменение ситуации, в keyPoints — конкретный пример, причину и следствие. Если материал слишком узкий для длительности, раскрывай разные последствия и исключения, не повторяй тезис.
Верни только JSON: {"title":"...","promise":"...","tone":"...","narrator":"единая позиция рассказчика и обращение к зрителю","writingBrief":"содержательные требования без визуальных инструкций","visualBible":"каноническое описание визуала","continuityRules":["неизменяемые факты и хронология"],"requiredBeats":["обязательства перед зрителем"],"endingResolution":"конкретный ответ в финале","sections":[{"title":"...","goal":"что нового узнает зритель","keyPoints":["конкретный пункт"],"transition":"логическая связь со следующим разделом"}],"sectionWeights":[1,3,1]}.
Добавь в JSON поля "genre":"..." и "factLedger":["краткий неизменный факт с единицами/условиями"]. Не пиши narration, сценарий или промты изображений. План компактный, без повторного перечисления одних требований в разных полях.`;

const WRITER_SYSTEM = `Ты опытный автор разговорных YouTube-сценариев. Напиши озвучку порученных разделов как связный рассказ, естественный вслух.
Соблюдай writingBrief и единого рассказчика. Не начинай новый ролик на границе раздела. Не повторяй уже рассказанное, не вставляй анонс предыдущих критериев и не подводи финал до последнего раздела.
Исходное задание originalBrief важнее его краткого пересказа: сохраняй числовые условия, имена, факты и ограничения, которые план мог опустить. Команды про imagePrompt и JSON из него относятся к визуальному этапу. factLedger фиксирует условия; не меняй их между разделами. Новую ситуацию явно отделяй от уже рассчитанного примера.
Перед новым абзацем реши, что именно он добавляет. Чередуй ситуацию, объяснение причины, проверку/возражение и последствие, если это подходит жанру. Не используй одну и ту же связку и искусственные загадки каждые полминуты. В вымышленной истории показывай решения и их цену, а не проговаривай учебную мораль после каждого действия.
Наполняй текст новыми деталями, причинными объяснениями, ясными примерами и ограничениями, а не синонимами прошлых фраз. В списке сравнивай варианты по одинаковым критериям.
Числовой пример должен содержать исходные числа и правильный результат; различай выручку, расходы и остаток. Интерес и согласие не равны оплате. Не придумывай реальные факты, статистику, цитаты или источники. Вымышленный пример прямо обозначай условным.
Не добавляй числовые итоги ради убедительности: для каждого нового результата должны быть понятны исходные данные, включая расходы и всё время. Если их нет, объясни ситуацию словами без придуманного точного результата. Маленькая проверка на одном-двух случаях показывает наблюдение, а не доказывает стабильный эффект; сохраняй условия, при которых ответа пока нет.
В истории удерживай хронологию, инвентарь, знания и мотивы героев; новое событие должно иметь причину. Не требуй этих художественных элементов от объясняющего ролика без сюжета.
Пиши на языке задания. Никаких названий разделов, списков, ремарок, таймкодов, номера сцены, imagePrompt или инструкций оператору внутри narration. Внешний вид героя здесь не нужен.
Не зачитывай бриф словами «проблема клиента», «ваш узкий сегмент», «минимальное предложение», «главный риск», «действие для проверки». Передай эти сведения через конкретную жизненную ситуацию, действие и объяснение. Не начинай все примеры одинаково.
Избегай пустых оценок «потенциал хороший», «высокий чек», «простой старт». Вместо них назови условие, ограничение или конкретное сравнение. Хук должен давать узнаваемую ситуацию или интересное противоречие, а не общую лекционную фразу.
Начальная часть: начни с предметного действия/ситуации. В объясняющем ролике дай почувствовать вопрос до ответа; не перечисляй сразу все числа и выводы, которые далее будут подробно разобраны. Начало — не аннотация ролика. Повторный числовой разбор в следующей части не нужен: один раз показать расчёт достаточно. В основной части не напоминай заново всю завязку; конкретное последствие лучше фразы «это важно понимать».
Верни только JSON указанной в задании формы.`;

const EDITOR_SYSTEM = `Ты выпускающий редактор. Прочитай ВЕСЬ текст как один ролик и исходное литературное задание.
Одним проходом исправь смысловые повторы, потерянные обязательные детали, хронологию, ошибочные расчёты, смену рассказчика и финал. Сверяй с originalBrief, а не только с пересказом планировщика. Не делай косметических замен хороших разделов.
Сначала выпиши checks — конкретные результаты проверки: 1) каждый расчёт (включая сумму минут, единицы, знаменатель и период сравнения); 2) одни и те же герои, предметы и события между разделами; 3) обещание хука и доказанный в финале ответ; 4) места, где повторяется смысл или меняется голос рассказчика. Для отсутствующей категории напиши «не применимо», не выдумывай арифметику в художественной истории. Каждая проверка ссылается на номера разделов и реальные утверждения, не ограничивайся «всё верно».
Проверь первые 30–45 секунд: есть ли наблюдаемая ситуация и понятный вопрос или автор сразу зачитывает конспект всего ролика? Если начальный расчёт целиком повторяется дальше, перепиши вступление через ситуацию, а подробный разбор оставь один раз. Найди хотя бы потенциально затянутый переход/повтор и реши по реальному тексту, нужно ли исправление. Не добавляй объём за счёт повторного объяснения уже доказанного.
Проверь особенно: вывод о деньгах за час не доказывает заработок за день; составляющие времени должны давать названный итог; одна услуга не меняет цену без нового эпизода; навык/надежда на будущий заказ не равны гарантированной прибыли. Это примеры проверок при наличии соответствующего содержания, не обязательные темы ролика.
Проверяй ВСЕ побочные числовые примеры, а не только основную таблицу из factLedger. Нельзя выводить остаток из одной оплаты без расходов, объявлять результат за час без полного времени или называть вывод стабильным по двум наблюдениям. Если исходных данных для необязательного числового примера нет, убери точный результат и объясни качественно. Сохраняй оговорку о недостатке данных, если её требует originalBrief. Эпизод с новой ценой/длительностью должен быть явно отдельным, не менять задним числом уже показанный день.
Исправления делай во всех связанных местах, включая хук, а не только в последнем абзаце. Если условие задано пользователем, сохрани его и исправь ошибку автора. Не добавляй новые неподтверждённые факты для удобного ответа.
Не ставь оценку самому себе. accepted=true означает, что после твоих замен нет существенных незакрытых проблем и обещание хука выполнено.
notes оценивает текст ПОСЛЕ применения patches/replacements. Не копируй туда уже исправленные ошибки из checks. Явные авторские ошибки исправляй сейчас, не оставляй просьбу «требуется исправление». Если переданы previousNotes, это задание на конкретную доработку: устрани каждую проблему, включая все связанные упоминания. Не начинай новую общую рецензию. При недостатке исходных фактов честно оставь нерешённую проблему; не подделывай готовность.
Если текста слишком много — убрать дубли и воду, не удалять обязательный пример. Если мало — добавить конкретный механизм/контрпример, не растянуть повторениями и не выдумывать подтверждённые факты. Сохрани единый естественный разговорный язык.
Учти измеренный объём и целевое число знаков ПОСЛЕ исправлений. В replacements верни только изменённые разделы целиком; остальные разделы не возвращай. Не используй поиск/замену цитат, patches или сокращения «остальное без изменений» внутри narration. Это позволяет применить редактуру без догадок о том, какую фразу ты имел в виду.
Верни только JSON {"checks":["конкретное сопоставление и расчёт с номерами разделов"],"accepted":true,"notes":["только оставшиеся существенные проблемы, пусто если исправлены"],"replacements":[{"section":1,"narration":"весь исправленный раздел"}]}.
Номера разделов начинаются с 1, последний указан в задании. Не создавай новых номеров, не нумеруй только изменённые разделы заново. Никаких imagePrompt и покадровой разбивки. Если не хватает проверяемых сведений для важного факта — не выдумывай его.`;

export async function writeNarrationFirst(options: NarrationWriterOptions): Promise<NarrationDraftCheckpoint> {
  const { analysis, timing, complete, signal, stage } = options;
  const target = Math.round(timing.targetSeconds * timing.charactersPerSecond);
  if (!Number.isFinite(target) || target <= 0) throw new Error("Сначала измерьте скорость выбранного голоса");
  const fingerprint = narrationDraftFingerprint(analysis, timing);
  let draft = options.state?.version === 1 && options.state.contextFingerprint === fingerprint ? structuredClone(options.state) : undefined;
  const save = async () => { signal?.throwIfAborted(); await options.save?.(structuredClone(draft!)); };
  if (!draft) {
    stage?.("Строю литературный план: темы, развитие и завершение — без квоты кадров…");
    const plan = json<Plan>(await complete([{ role: "system", content: PLAN_SYSTEM }, { role: "user", content: JSON.stringify({
      title: analysis.suggestedTitle, angle: analysis.suggestedAngle, language: analysis.language,
      audience: analysis.targetAudience, brief: analysis.instructions, targetSeconds: timing.targetSeconds,
      targetCharacters: target, recommendedSections: Math.max(3, Math.min(12, Math.ceil(target / 3000) + 1)),
      durationRule: "Длительность из настроек уже подтверждена пользователем и имеет приоритет над старым упоминанием минут в промте."
    }) }], 4500));
    if (!plan.writingBrief?.trim() || !plan.narrator?.trim() || !plan.endingResolution?.trim()
      || !Array.isArray(plan.sections) || !plan.sections.length || plan.sections.length > 30
      || plan.sections.some(section => !section.title?.trim() || !section.goal?.trim() || !Array.isArray(section.keyPoints))
      || !Array.isArray(plan.requiredBeats) || !Array.isArray(plan.continuityRules)) throw new Error("Литературный план неполон. Повторите создание плана.");
    plan.sectionWeights = plan.sections.map((_, index) => Math.max(0.25, Math.min(10, Number(plan.sectionWeights?.[index]) || 1)));
    draft = { version: 1, contextFingerprint: fingerprint, plan, sections: [], visuals: [] };
    await save();
  }
  const { plan } = draft;
  // Short narration can be written coherently in one response. For a long
  // video, measured section budgets prevent the model from returning a short essay.
  if (!draft.sections.length && target <= 12000) {
    stage?.("Пишу цельную озвучку: от хука до завершения, без покадровых ограничений…");
    const result = json<{sections: string[]}>(await complete([{role: "system", content: WRITER_SYSTEM}, {role: "user", content: JSON.stringify({
      language: analysis.language, originalBrief: analysis.instructions, genre: plan.genre, factLedger: plan.factLedger,
      writingBrief: plan.writingBrief, narrator: plan.narrator, tone: plan.tone,
      promise: plan.promise, requiredBeats: plan.requiredBeats, rules: plan.continuityRules, ending: plan.endingResolution,
      outline: plan.sections, weights: plan.sectionWeights, targetCharacters: target,
      approximateWords: timing.targetWordCount,
      allowedCharacters: [Math.ceil(target * 0.95), Math.floor(target * 1.05)],
      instruction: "Напиши ВЕСЬ ролик как единое произведение. Следи за общим ритмом, нарастанием пользы/событий и единственным завершением. Объём указан в знаках с пробелами, НЕ в словах. Не повторяй выводы между разделами.",
      format: `{"sections":["озвучка раздела 1","озвучка раздела 2",...]} — ровно ${plan.sections.length} строк в порядке плана, без заголовков внутри текста`
    })}], Math.min(26000, Math.max(4500, Math.ceil(target * 0.9) + 2000))));
    if (!Array.isArray(result.sections) || result.sections.length !== plan.sections.length || result.sections.some(text => typeof text !== "string" || !text.trim())) {
      throw new Error("Ответ не содержит всех разделов озвучки. План сохранён; повторите написание текста.");
    }
    draft.sections = result.sections.map(text => text.trim());
    await save();
  }
  while (draft.sections.length < plan.sections.length) {
    signal?.throwIfAborted();
    const index = draft.sections.length;
    const used = countNarrationCharacters(narrationDraftText(draft));
    const weightLeft = plan.sectionWeights.slice(index).reduce((sum, weight) => sum + weight, 0);
    const budget = Math.max(100, Math.round((target - used) * plan.sectionWeights[index]! / weightLeft));
    stage?.(`Пишу озвучку: ${index + 1}/${plan.sections.length} — ${plan.sections[index]!.title}`);
    const previous = draft.sections.map((text, i) => ({ section: i + 1, title: plan.sections[i]!.title,
      // Ordinary 13-minute stories fit here in full. For very long stories keep
      // the recent exact text plus older summaries instead of two isolated lines.
      text: used <= 48000 || i >= index - 3 ? text : text.slice(0, 700) }));
    const result = json<{narration: string}>(await complete([{ role: "system", content: WRITER_SYSTEM }, { role: "user", content: JSON.stringify({
      language: analysis.language, originalBrief: analysis.instructions, genre: plan.genre, factLedger: plan.factLedger,
      writingBrief: plan.writingBrief, narrator: plan.narrator, tone: plan.tone,
      promise: plan.promise, rules: plan.continuityRules, outline: plan.sections, ending: plan.endingResolution,
      previousSections: previous, currentSection: index + 1, lastSection: index === plan.sections.length - 1,
      sectionRole: index === 0 ? "Вступление через конкретную ситуацию; НЕ пересказ чисел и ответов из всего плана"
        : index === plan.sections.length - 1 ? "Последняя часть: закрыть вопрос и завершить ролик один раз"
          : "Развитие: только новая ситуация, механизм, следствие или проверка; не пересказывать предыдущие разделы",
      targetCharacters: budget, approximateWords: Math.round(budget * timing.targetWordCount / target),
      instruction: `Около ${budget} знаков с пробелами (ориентировочно ${Math.round(budget * timing.targetWordCount / target)} слов). Напиши несколько развёрнутых абзацев, раскрывающих разные пункты текущего раздела. Не ограничивайся аннотацией из одного абзаца. Не трать объём на повторные обещания и расчёты из предыдущих разделов.`,
      format: '{"narration":"полный текст текущего раздела"}'
    }) }], Math.min(12000, Math.max(2000, Math.ceil(budget * 0.9) + 1000)), "high"));
    if (!result.narration?.trim()) throw new Error(`Раздел ${index + 1} пуст. Предыдущие разделы сохранены.`);
    draft.sections.push(result.narration.trim());
    await save();
  }
  let durationOnlyCorrection = false;
  for (let pass = 0; !draft.editorial?.accepted && pass < 2; pass++) {
    if (pass === 1) {
      if (draft.editorialCorrectionAttempted) break;
      // Only a completed response may reach this point. Persist before sending
      // so a crash/uncertain paid submission cannot trigger another auto-loop.
      draft.editorialCorrectionAttempted = true;
      await save();
    }
    stage?.(pass === 0 ? "Редактирую весь текст: убираю повторы, сверяю примеры, логику и финал…"
      : "Дорабатываю конкретные замечания редактора; готовые разделы сохраняются…");
    const characters = countNarrationCharacters(narrationDraftText(draft));
    // Once content is accepted, do not ask a critic to shorten it again while
    // also asking for more runtime. Give the author one exact local length task.
    const focus = durationOnlyCorrection ? plan.sections.map((_, index) => index)
      .filter(index => plan.sections.length < 3 || (index > 0 && index < plan.sections.length - 1))
      .sort((a, b) => plan.sectionWeights[b]! - plan.sectionWeights[a]!)[0] : undefined;
    const focusTarget = focus === undefined ? undefined : Math.max(1, countNarrationCharacters(draft.sections[focus]!) + target - characters);
    const response = await complete([
      { role: "system", content: focus === undefined ? EDITOR_SYSTEM : `${WRITER_SYSTEM}\nТекст уже прошёл содержательную редактуру. Исправь ТОЛЬКО объём указанного раздела до заданного количества знаков. Остальные разделы не менять. Сохрани исходные числа, события и порядок; развивай существующие объяснения/действия конкретными деталями, без новых расчётов, выдуманных фактов и повторов. Не сокращай текст, если задано расширение. Верни JSON {"accepted":true,"notes":[],"patches":[],"replacements":[{"section":${focus + 1},"narration":"полный текст этого раздела"}]}. Это доработка текста, не новая рецензия.` }, { role: "user", content: JSON.stringify({
        language: analysis.language, originalBrief: analysis.instructions, genre: plan.genre, factLedger: plan.factLedger,
        writingBrief: plan.writingBrief, narrator: plan.narrator, promise: plan.promise,
        requiredBeats: plan.requiredBeats, rules: plan.continuityRules, ending: plan.endingResolution,
        currentCharacters: characters, targetCharacters: target, allowedCharacters: [Math.ceil(target * 0.95), Math.floor(target * 1.05)],
        focusedRevision: focus === undefined ? undefined : { section: focus + 1, targetSectionCharacters: focusTarget,
          characterChange: target - characters, action: characters < target ? "расширить" : "сократить",
          instruction: `Нужен раздел примерно на ${focusTarget} знаков с пробелами, не слов. Все остальные разделы остаются прежними.` },
        previousNotes: draft.editorial?.notes, lastSection: draft.sections.length,
        sections: draft.sections.map((narration, i) => ({ section: i + 1, title: plan.sections[i]!.title, narration }))
      }) }
    ], Math.min(16000, Math.max(5000, Math.ceil(target * 0.85))), "high");
    draft.editorialResponse = response;
    await save();
    let edit: EditorialEdit;
    let sections: string[];
    try {
      edit = json<EditorialEdit>(response);
      sections = applyEditorialEdit(draft.sections, edit);
      if (focus !== undefined && (edit.replacements.length !== 1 || edit.replacements[0]!.section !== focus + 1 || edit.patches?.length)) {
        throw new Error(`доработка объёма должна менять только раздел ${focus + 1}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Неверный формат редактуры";
      draft.editorial = { accepted: false, notes: [message] };
      await save();
      throw new Error(`Редактор: ${message}. Исходный текст и полученный ответ сохранены. Продолжите проверку сценария.`);
    }
    draft.sections = sections;
    draft.visuals = [];
    const actual = countNarrationCharacters(narrationDraftText(draft));
    const fits = actual >= target * 0.95 && actual <= target * 1.05;
    draft.editorial = { accepted: edit.accepted && edit.notes.length === 0 && fits, notes: edit.notes.map(String) };
    durationOnlyCorrection = edit.accepted && edit.notes.length === 0 && !fits;
    if (!fits) draft.editorial.notes.push(`Оценка озвучки ${Math.round(actual / timing.charactersPerSecond)} с при цели ${timing.targetSeconds} с. Нужны ${target} знаков ±5%, сейчас ${actual}.`);
    await save();
  }
  if (!draft.editorial?.accepted) throw new Error(`Черновик сохранён. Остались замечания редактора: ${draft.editorial?.notes.slice(0, 4).join("; ") || "нужна доработка содержания"}. Продолжите проверку сценария.`);
  return draft;
}

interface EditorialEdit {
  accepted: boolean;
  notes: string[];
  patches?: Array<{ section: number; find: string; replace: string }>;
  replacements: Array<{ section: number; narration: string }>;
}

/** Apply atomically. Only whitespace/case differences in otherwise identical quotes are tolerated. */
export function applyEditorialEdit(original: string[], edit: EditorialEdit): string[] {
  if (!edit || typeof edit.accepted !== "boolean" || !Array.isArray(edit.notes)
    || edit.notes.some(note => typeof note !== "string") || !Array.isArray(edit.replacements)
    || (edit.patches !== undefined && !Array.isArray(edit.patches))) throw new Error("неполный формат редакторского ответа");
  const sections = [...original];
  const replaced = new Set<number>();
  const indexOf = (section: number): number => {
    if (!Number.isInteger(section) || section < 1 || section > sections.length) {
      throw new Error(`номер раздела ${String(section).slice(0, 20)} вне диапазона 1–${sections.length}`);
    }
    return section - 1;
  };
  for (const replacement of edit.replacements) {
    const index = indexOf(replacement?.section);
    if (replaced.has(index)) throw new Error(`две полные замены раздела ${index + 1}`);
    if (typeof replacement.narration !== "string" || !replacement.narration.trim()) throw new Error(`пустая замена раздела ${index + 1}`);
    replaced.add(index);
    sections[index] = replacement.narration.trim();
  }
  const ranges = new Map<number, Array<{ start: number; end: number; text: string }>>();
  for (const patch of edit.patches ?? []) {
    const index = indexOf(patch?.section);
    if (replaced.has(index)) throw new Error(`смешаны полная и точечная замены раздела ${index + 1}`);
    if (typeof patch.find !== "string" || !patch.find || typeof patch.replace !== "string") throw new Error(`неверная цитата/замена раздела ${index + 1}`);
    const text = original[index]!;
    // A model may capitalize a quote taken after a colon, or collapse newlines.
    // Match all occurrences so an exact quote cannot hide a second normalized match.
    const pattern = patch.find.split(/\s+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    const matches = [...text.matchAll(new RegExp(pattern, "giu"))];
    if (matches.length !== 1) throw new Error(`цитата не найдена однозначно в разделе ${index + 1}`);
    const start = matches[0]!.index!;
    const end = start + matches[0]![0].length;
    const changes = ranges.get(index) ?? [];
    if (changes.some(change => start < change.end && end > change.start)) throw new Error(`пересекающиеся исправления раздела ${index + 1}`);
    changes.push({ start, end, text: patch.replace });
    ranges.set(index, changes);
  }
  for (const [index, changes] of ranges) {
    for (const change of changes.sort((a, b) => b.start - a.start)) {
      sections[index] = sections[index]!.slice(0, change.start) + change.text + sections[index]!.slice(change.end);
    }
    if (!sections[index]!.trim()) throw new Error(`после исправления пуст раздел ${index + 1}`);
  }
  return sections;
}
