import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiChatMessage, AnalyzeReferenceInput, Project, ReferenceAnalysis, Scene, SuggestedTopic, TranscriptSegment, YouTubeAnalysisContext, YouTubeChannelContext } from "@gold-work/shared";
import { createId } from "@gold-work/core";
import { AnyModelStore } from "./anymodel-store.js";

export class AnyModelClient {
  constructor(private readonly store: AnyModelStore) {}

  async configured(): Promise<boolean> {
    return (await this.store.publicSettings()).configured;
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await this.request("/v1/models");
      if (!response.ok) throw new Error(await this.error(response));
      return { ok: true, message: "AnyModel подключён, ключ работает" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async chatMessage(messages: AiChatMessage[]): Promise<string> {
    const settings = await this.store.publicSettings();
    return this.chat(settings.textModel, [
      { role: "system", content: "Ты AI-режиссёр Gold Work Studio. Помогай создавать оригинальные ролики: анализируй нишу, улучшай хук, сценарий, структуру и удержание. Отвечай на языке пользователя." },
      ...messages
    ]);
  }

  async streamChatMessage(messages: AiChatMessage[], onChunk: (chunk: string) => void): Promise<string> {
    const settings = await this.store.publicSettings();
    return this.streamChat(settings.textModel, [
      { role: "system", content: "Ты AI-режиссёр Gold Work Studio. Помогай создавать оригинальные ролики: анализируй нишу, улучшай хук, сценарий, структуру и удержание. Отвечай на языке пользователя." },
      ...messages
    ], onChunk);
  }

  async analyzeReference(input: AnalyzeReferenceInput, pastProjects: string[] = []): Promise<ReferenceAnalysis> {
    const settings = await this.store.publicSettings();
    const metadata = await this.referenceMetadata(input.url);
    const content = await this.chat(settings.textModel, [
      { role: "system", content: "Ты сценарный аналитик. Верни только JSON без markdown. Не утверждай, что видел ролик, если дан только заголовок и описание. Создай самостоятельный сценарий, не копируй чужой текст или брендинг." },
      { role: "user", content: `Ссылка: ${input.url}\nМетаданные: ${JSON.stringify(metadata)}\nПожелания: ${input.instructions || "нет"}\nЯзык: ${input.language || "Русский"}${memoryNote(pastProjects)}\nВерни JSON: sourceTitle,niche,targetAudience,hook,structure[],strengths[],improvements[],suggestedAngle,suggestedTitle,recommendedDurationSeconds,scenes[{title,narration,imagePrompt,animationPrompt,durationSeconds}]` }
    ], undefined, "medium");
    const parsed = extractJson<Partial<ReferenceAnalysis> & { scenes?: Array<Partial<Scene>> }>(content, "разборе референса");
    const scenes = (parsed.scenes ?? []).map((scene, order) => ({
      id: createId("scene"), order, title: scene.title || `Сцена ${order + 1}`, narration: scene.narration || "",
      imagePrompt: scene.imagePrompt || "", animationPrompt: scene.animationPrompt || "", durationSeconds: scene.durationSeconds || 8, status: "draft" as const
    }));
    if (!scenes.length) throw new Error("Модель не вернула сцены");
    return {
      sourceUrl: input.url, sourceTitle: parsed.sourceTitle || metadata.title || "Референс",
      niche: parsed.niche || "Не определена", targetAudience: parsed.targetAudience || "Не определена",
      hook: parsed.hook || scenes[0]!.narration, structure: toStringList(parsed.structure), strengths: toStringList(parsed.strengths),
      improvements: toStringList(parsed.improvements), suggestedAngle: parsed.suggestedAngle || input.instructions || "Самостоятельный ролик",
      suggestedTitle: parsed.suggestedTitle || "Новый ролик", recommendedDurationSeconds: parsed.recommendedDurationSeconds || scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
      language: input.language || "Русский", instructions: input.instructions, scenes, provider: `anymodel:${settings.textModel}`
    };
  }

  async analyzeYouTube(context: YouTubeAnalysisContext, input: AnalyzeReferenceInput, pastProjects: string[] = []): Promise<ReferenceAnalysis> {
    const settings = await this.store.publicSettings();
    const transcript = context.transcript
      .map((segment) => `[${clock(segment.startSeconds)}] ${segment.text}`)
      .join("\n")
      .slice(0, 90_000);
    const compactContext = {
      video: {
        title: context.title,
        description: context.description.slice(0, 8_000),
        publishedAt: context.publishedAt,
        durationSeconds: context.durationSeconds,
        views: context.views,
        likes: context.likes,
        comments: context.commentCount
      },
      channel: {
        title: context.channelTitle,
        subscribers: context.channelSubscribers,
        views: context.channelViews,
        videos: context.channelVideoCount
      },
      topComments: context.topComments,
      topChannelVideosByViews: context.topVideos,
      transcriptSource: context.transcriptSource,
      transcript
    };
    // Длина улучшенного ролика = длина оригинала + ~1.5 мин; сцены по 5 секунд (число сцен от реального тайминга).
    const sceneDurationSeconds = 5;
    const targetDurationSeconds = context.durationSeconds > 0 ? context.durationSeconds + 90 : 0;
    const targetScenes = targetDurationSeconds > 0
      ? Math.min(200, Math.max(6, Math.round(targetDurationSeconds / sceneDurationSeconds)))
      : 0;

    // Шаг 1: лёгкий запрос — только анализ и план (без сцен), чтобы не перегружать провайдера тяжёлым ответом.
    const planContent = await this.chat(settings.textModel, [
      {
        role: "system",
        content: "Ты YouTube-аналитик и сценарный режиссёр. Верни только JSON без markdown. На основе статистики, комментариев и (если есть) транскрипта объясни, почему ролик работает и что улучшить, и предложи самостоятельный улучшенный замысел. Не копируй чужой текст, персонажей или брендинг. Визуальные кадры не анализировались, не утверждай обратное."
      },
      {
        role: "user",
        content: `Данные YouTube:\n${JSON.stringify(compactContext)}\nПожелание пользователя: ${input.instructions || "улучшить хук, удержание и сценарий"}\nЯзык: ${input.language || "Русский"}\n${targetScenes > 0 ? `Улучшенный ролик будет ~${targetDurationSeconds} секунд (оригинал плюс ~1.5 минуты), примерно ${targetScenes} сцен по ${sceneDurationSeconds} секунд — сами сцены запросим отдельно.` : ""}${memoryNote(pastProjects)}\nТакже предложи ровно 3 темы для НОВЫХ роликов этого направления, опираясь на топ-ролики канала и комментарии: для каждой — цепляющий заголовок, хук (1–2 предложения) и угол подачи.\nВерни JSON БЕЗ поля scenes: niche,targetAudience,hook,structure[],strengths[],improvements[],suggestedAngle,suggestedTitle,recommendedDurationSeconds,topics[{title,hook,angle}]`
      }
    ], 6_000, "medium");
    const plan = extractJson<Partial<ReferenceAnalysis> & { topics?: Array<Partial<SuggestedTopic>> }>(planContent, "анализе YouTube-ролика");
    const suggestedTopics: SuggestedTopic[] = (Array.isArray(plan.topics) ? plan.topics : [])
      .map((topic) => ({
        title: typeof topic?.title === "string" ? topic.title : "",
        hook: typeof topic?.hook === "string" ? topic.hook : "",
        angle: typeof topic?.angle === "string" ? topic.angle : ""
      }))
      .filter((topic) => topic.title.trim().length > 0)
      .slice(0, 3);

    // Сцены при разборе НЕ строим: сначала пользователь видит разбор и темы,
    // полный сценарий собирается при выборе темы или подтверждении (regenerateScenes).
    return {
      sourceUrl: input.url,
      sourceTitle: context.title,
      niche: plan.niche || "YouTube-контент",
      targetAudience: plan.targetAudience || "Аудитория исходного канала",
      hook: plan.hook || "Сильный хук появится при сборке сценария",
      structure: toStringList(plan.structure),
      strengths: toStringList(plan.strengths),
      improvements: toStringList(plan.improvements),
      suggestedAngle: plan.suggestedAngle || input.instructions || "Самостоятельная улучшенная подача",
      suggestedTitle: plan.suggestedTitle || `Новый ролик: ${context.title}`,
      recommendedDurationSeconds: plan.recommendedDurationSeconds || targetDurationSeconds || 300,
      language: input.language || "Русский",
      instructions: input.instructions,
      scenes: [],
      provider: `anymodel:${settings.textModel}+youtube-data-v3`,
      youtubeContext: context,
      suggestedTopics
    };
  }

  /** Анализ КАНАЛА: ниша, аудитория, что заходит по таймлайну и комментариям — и ровно 3 темы для новых роликов. */
  async analyzeYouTubeChannel(context: YouTubeChannelContext, input: AnalyzeReferenceInput, pastProjects: string[] = []): Promise<ReferenceAnalysis> {
    const settings = await this.store.publicSettings();
    const compact = {
      channel: {
        title: context.title,
        description: context.description.slice(0, 4_000),
        subscribers: context.subscribers,
        totalViews: context.totalViews,
        videoCount: context.videoCount
      },
      videosTimeline: context.videos.slice(0, 100),
      topComments: context.topComments.slice(0, 60)
    };
    const content = await this.chat(settings.textModel, [
      {
        role: "system",
        content: "Ты YouTube-аналитик ниш и каналов. Верни только JSON без markdown. По статистике канала, таймлайну роликов (просмотры, даты, длительности) и комментариям объясни, что работает в нише и чего хотят зрители. Видеокадры не анализировались — не утверждай обратное."
      },
      {
        role: "user",
        content: `Данные канала YouTube:\n${JSON.stringify(compact)}\nПожелание пользователя: ${input.instructions || "проанализируй канал и нишу"}\nЯзык: ${input.language || "Русский"}${memoryNote(pastProjects)}\nВерни JSON БЕЗ поля scenes: niche,targetAudience,hook(главный вывод — что цепляет зрителей этой ниши),structure[](что повторяется в успешных роликах канала),strengths[],improvements[],suggestedAngle,suggestedTitle,recommendedDurationSeconds(оптимальная длительность по таймлайну),topics[{title,hook,angle}] — ровно 3 темы для НОВЫХ роликов, опираясь на желания зрителей из комментариев и самые успешные ролики.`
      }
    ], 6_000, "medium");
    const plan = extractJson<Partial<ReferenceAnalysis> & { topics?: Array<Partial<SuggestedTopic>> }>(content, "анализе канала");
    const suggestedTopics: SuggestedTopic[] = (Array.isArray(plan.topics) ? plan.topics : [])
      .map((topic) => ({
        title: typeof topic?.title === "string" ? topic.title : "",
        hook: typeof topic?.hook === "string" ? topic.hook : "",
        angle: typeof topic?.angle === "string" ? topic.angle : ""
      }))
      .filter((topic) => topic.title.trim().length > 0)
      .slice(0, 3);
    return {
      sourceUrl: input.url,
      sourceTitle: context.title,
      niche: plan.niche || "YouTube-канал",
      targetAudience: plan.targetAudience || "Аудитория канала",
      hook: plan.hook || "Главный вывод по нише появится после уточнения",
      structure: toStringList(plan.structure),
      strengths: toStringList(plan.strengths),
      improvements: toStringList(plan.improvements),
      suggestedAngle: plan.suggestedAngle || input.instructions || "Стратегия по данным канала",
      suggestedTitle: plan.suggestedTitle || `Новый ролик для «${context.title}»`,
      recommendedDurationSeconds: plan.recommendedDurationSeconds || 300,
      language: input.language || "Русский",
      instructions: input.instructions,
      scenes: [],
      provider: `anymodel:${settings.textModel}+youtube-channel`,
      youtubeChannelContext: context,
      suggestedTopics
    };
  }

  /** Пересобирает сцены существующего разбора под заданную пользователем длину (сцены по 5 секунд). */
  async regenerateScenes(analysis: ReferenceAnalysis, targetSeconds: number, onProgress?: (done: number, total: number) => void): Promise<ReferenceAnalysis> {
    const sceneDurationSeconds = 5;
    const targetScenes = Math.min(200, Math.max(6, Math.round(targetSeconds / sceneDurationSeconds)));
    const planBrief = {
      suggestedTitle: analysis.suggestedTitle,
      suggestedAngle: analysis.suggestedAngle || analysis.instructions,
      hook: analysis.hook,
      niche: analysis.niche,
      targetAudience: analysis.targetAudience,
      structure: analysis.structure,
      improvements: analysis.improvements,
      // Образцы для качества сценария: транскрипт референса и живые комментарии зрителей.
      transcriptSample: analysis.youtubeContext?.transcript?.map((segment) => segment.text).join(" ").slice(0, 6_000) || undefined,
      audienceComments: (analysis.youtubeContext?.topComments ?? analysis.youtubeChannelContext?.topComments ?? [])
        .slice(0, 8)
        .map((comment) => comment.text)
    };
    const scenes = await this.buildScenes(planBrief, targetScenes, analysis.language || "Русский", onProgress);
    if (scenes.length === 0) throw new Error("Не удалось собрать сцены сценария");
    return { ...analysis, scenes, recommendedDurationSeconds: scenes.length * sceneDurationSeconds };
  }

  /** Генерация сцен батчами (targetScenes>0) или одним лёгким запросом (иначе). Каждая сцена ~5 секунд при батчах. */
  private async buildScenes(planBrief: Record<string, unknown>, targetScenes: number, language: string, onProgress?: (done: number, total: number) => void): Promise<Scene[]> {
    const settings = await this.store.publicSettings();
    const sceneDurationSeconds = 5;
    const scenes: Scene[] = [];
    const push = (scene: { narration?: string; imagePrompt?: string; durationSeconds?: number }, duration: number): void => {
      scenes.push({
        id: createId("scene"),
        order: scenes.length,
        title: `Сцена ${scenes.length + 1}`,
        narration: scene.narration || "",
        imagePrompt: scene.imagePrompt || "",
        animationPrompt: "Плавное движение камеры и естественное движение объектов",
        durationSeconds: duration,
        status: "draft"
      });
    };
    if (targetScenes > 0) {
      const batchSize = 30;
      const maxBatches = Math.ceil(targetScenes / batchSize) + 2;
      for (let batch = 0; batch < maxBatches && scenes.length < targetScenes; batch += 1) {
        const from = scenes.length + 1;
        const count = Math.min(batchSize, targetScenes - scenes.length);
        const last = scenes.at(-1)?.narration ?? "";
        let batchContent: string;
        try {
          batchContent = await this.chat(settings.textModel, [
            { role: "system", content: SCENE_WRITER_SYSTEM },
            {
              role: "user",
              content: [
                `# План ролика`,
                JSON.stringify(planBrief),
                ``,
                `# Задание`,
                `Язык озвучки: ${language}. Всего сцен в ролике: ${targetScenes}, каждая ≈${sceneDurationSeconds} секунд.`,
                `Сейчас нужны сцены с ${from} по ${from + count - 1} — ровно ${count} штук.`,
                `Позиция в ролике: ${describePosition(from, targetScenes)}.`,
                last ? `Последняя написанная фраза: «${last}». Продолжай мысль дальше, без повторов и без пересказа сказанного.` : `Это начало ролика — первая фраза обязана цеплять с первой секунды.`,
                ``,
                `# Формат ответа`,
                `Только JSON-массив из ${count} объектов: [{"narration":"...","imagePrompt":"..."}]`
              ].join("\n")
            }
          ], 6_000, "low");
        } catch (error) {
          if (scenes.length > 0) break; // частичный сценарий лучше полного отказа
          throw error;
        }
        const batchScenes = parseSceneArray(batchContent);
        if (batchScenes.length === 0) break;
        for (const scene of batchScenes) {
          if (scenes.length >= targetScenes) break;
          push(scene, sceneDurationSeconds);
        }
        onProgress?.(scenes.length, targetScenes);
      }
    } else {
      const fallbackContent = await this.chat(settings.textModel, [
        { role: "system", content: "Ты сценарист коротких видео. Верни только JSON-массив без markdown." },
        { role: "user", content: `План: ${JSON.stringify(planBrief)}\nЯзык: ${language}\nРазбей на 8–12 сцен. Верни JSON-массив [{"narration":"...","imagePrompt":"...","durationSeconds":8}]` }
      ], 6_000, "low");
      for (const scene of parseSceneArray(fallbackContent)) push(scene, Math.max(3, Number(scene.durationSeconds) || 8));
    }
    return scenes;
  }

  async transcribeAudio(audio: Buffer, format: string): Promise<TranscriptSegment[]> {
    if (audio.byteLength > 25 * 1024 * 1024) throw new Error("Аудио больше 25 МБ. Выберите более короткий ролик или добавьте субтитры.");
    const settings = await this.store.publicSettings();
    const response = await this.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        // Аудио умеют только Gemini-модели; textModel (Claude) input_audio не принимает.
        model: settings.transcriptionModel,
        messages: [
          {
            role: "system",
            content: "Транскрибируй аудио. Верни только JSON-массив без markdown: [{startSeconds,durationSeconds,text}]. Сохраняй язык оригинала и реальные таймкоды."
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Сделай полный транскрипт с таймкодами." },
              { type: "input_audio", input_audio: { data: audio.toString("base64"), format } }
            ]
          }
        ],
        temperature: 0
      })
    });
    if (!response.ok) throw new Error(`Gemini-аудио через AnyModel: ${await this.error(response)}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Gemini вернул пустой транскрипт");
    const parsed = extractJson<Array<Partial<TranscriptSegment>> | { segments?: Array<Partial<TranscriptSegment>> }>(content, "транскрибации аудио");
    const segments = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.segments) ? parsed.segments : null;
    if (!segments) throw new Error("Модель вернула не массив сегментов транскрипта");
    return segments.map((segment) => ({
      startSeconds: Math.max(0, Number(segment.startSeconds) || 0),
      durationSeconds: Math.max(0, Number(segment.durationSeconds) || 0),
      text: String(segment.text ?? "").trim()
    })).filter((segment) => segment.text);
  }

  async refine(analysis: ReferenceAnalysis, instructions: string): Promise<ReferenceAnalysis> {
    return this.analyzeReference({ url: analysis.sourceUrl, language: analysis.language, instructions: `${analysis.instructions || ""}\nТекущий разбор: ${JSON.stringify(analysis)}\nИзмени по просьбе: ${instructions}` });
  }

  async createProjectPlanFromChat(messages: AiChatMessage[], language: string): Promise<{ title: string; topic: string; scenes: Scene[] }> {
    const settings = await this.store.publicSettings();
    const content = await this.chat(settings.textModel, [
      {
        role: "system",
        content: "Ты AI-режиссёр. Преврати сохранённый разговор в готовый оригинальный сценарный пресет. Верни только валидный JSON без markdown: title, topic, scenes[{title,narration,imagePrompt,animationPrompt,durationSeconds}]. Не копируй чужой текст дословно."
      },
      {
        role: "user",
        content: `Язык проекта: ${language}\nСохранённый разговор:\n${messages.map((message) => `${message.role}: ${message.content}`).join("\n\n")}`
      }
    ]);
    const parsed = extractJson<{
      title?: string;
      topic?: string;
      scenes?: Array<Partial<Scene>>;
    }>(content, "создании проекта из темы чата");
    const scenes = (parsed.scenes ?? []).map((scene, order) => ({
      id: createId("scene"),
      order,
      title: scene.title || `Сцена ${order + 1}`,
      narration: scene.narration || "",
      imagePrompt: scene.imagePrompt || "",
      animationPrompt: scene.animationPrompt || "",
      durationSeconds: Math.max(3, Number(scene.durationSeconds) || 8),
      status: "draft" as const
    }));
    if (scenes.length === 0) throw new Error("Модель не вернула сцены для темы чата");
    return {
      title: parsed.title?.trim() || "Проект из темы чата",
      topic: parsed.topic?.trim() || [...messages].reverse().find((message) => message.role === "user")?.content || "Сценарий из сохранённого диалога",
      scenes
    };
  }

  async generateImage(prompt: string, size: string, references: string[] = []): Promise<Buffer> {
    const settings = await this.store.publicSettings();
    const refs = references.map((ref) => ref.trim()).filter(Boolean).slice(0, 3);
    // С референсами нужна модель с поддержкой опорных изображений (gpt-image); без них — дешёвый Gemini.
    const model = refs.length > 0 ? settings.imageRefModel : settings.imageModel;
    // У gpt-image свой набор размеров — Gemini-размеры (1920x1080 и т.п.) он отвергает.
    const effectiveSize = refs.length > 0 ? gptImageSize(size) : size;
    const image = refs.length > 0 ? await referencePayload(refs) : undefined;
    const response = await this.request("/v1/images/generations", {
      method: "POST",
      body: JSON.stringify({
        model, prompt, n: 1, size: effectiveSize, quality: "auto", background: "auto", image_detail: "high", output_format: "png",
        ...(image !== undefined ? { image } : {})
      })
    });
    if (!response.ok) throw new Error(await this.error(response));
    const data = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = data.data?.[0];
    if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
    if (item?.url) {
      const image = await fetch(item.url);
      if (!image.ok) throw new Error(`Не удалось скачать сгенерированное изображение: ${image.status}`);
      return Buffer.from(await image.arrayBuffer());
    }
    throw new Error("AnyModel не вернул изображение");
  }

  /** Озвучка текста через AnyModel. Голос проекта (overrideModel) важнее глобальной настройки. Возвращает MP3. */
  async textToSpeech(text: string, languageCode: string, overrideModel?: string): Promise<Buffer> {
    const input = text.trim().slice(0, 5_000);
    if (!input) throw new Error("Пустой текст для озвучки");
    const settings = await this.store.publicSettings();
    const response = await this.request("/v1/audio/speech", {
      method: "POST",
      body: JSON.stringify({ model: ttsModelId(overrideModel?.trim() || settings.ttsModel, languageCode), input })
    });
    if (!response.ok) throw new Error(await this.error(response));
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await response.json() as { audio?: string };
      if (!data.audio) throw new Error("AnyModel не вернул аудио озвучки");
      return Buffer.from(data.audio, "base64");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0) throw new Error("AnyModel вернул пустую озвучку");
    return buffer;
  }

  /** Переписывает одну сцену по пожеланию пользователя, сохраняя место сцены в сценарии. */
  async improveScene(project: Project, scene: Scene, instructions: string): Promise<{ narration: string; imagePrompt: string }> {
    const settings = await this.store.publicSettings();
    const neighbours = project.scenes
      .filter((item) => Math.abs(item.order - scene.order) === 1)
      .map((item) => `${item.order + 1}: ${item.narration}`);
    const content = await this.chat(settings.textModel, [
      { role: "system", content: SCENE_WRITER_SYSTEM },
      {
        role: "user",
        content: [
          `# Контекст ролика`,
          `Тема: ${project.topic}. Язык озвучки: ${project.language}. Стиль кадров: ${project.settings.image.style || "не задан"}.`,
          neighbours.length > 0 ? `Соседние сцены:\n${neighbours.join("\n")}` : "",
          ``,
          `# Текущая сцена ${scene.order + 1}`,
          `narration: ${scene.narration}`,
          `imagePrompt: ${scene.imagePrompt}`,
          ``,
          `# Что нужно изменить`,
          instructions.trim() || "Усилить сцену: сделать текст живее и конкретнее, а кадр — выразительнее и точнее по смыслу.",
          ``,
          `# Формат ответа`,
          `Только JSON-объект: {"narration":"...","imagePrompt":"..."} — сцена должна остаться на своём месте по смыслу.`
        ].filter(Boolean).join("\n")
      }
    ], 1_500, "low");
    const parsed = extractJson<{ narration?: string; imagePrompt?: string }>(content, "улучшении сцены");
    return {
      narration: parsed.narration?.trim() || scene.narration,
      imagePrompt: parsed.imagePrompt?.trim() || scene.imagePrompt
    };
  }

  /** Портрет главного героя по сценарию: текстовая модель описывает персонажа, дешёвая модель рисует. */
  async characterReference(project: Project): Promise<{ name: string; prompt: string; image: Buffer }> {
    const settings = await this.store.publicSettings();
    const scenario = project.scenes
      .map((scene) => `${scene.narration} | ${scene.imagePrompt}`)
      .join("\n")
      .slice(0, 12_000);
    const content = await this.chat(settings.textModel, [
      {
        role: "system",
        content: "Ты художник-постановщик. Верни только JSON без markdown: {\"name\":\"имя героя\",\"prompt\":\"развёрнутый визуальный промпт на английском\"}. Промпт описывает ОДНОГО главного повторяющегося персонажа сценария: внешность, лицо (5–8 конкретных визуальных якорей), одежду, телосложение — так, чтобы по нему персонажа можно было рисовать одинаково во всех сценах. Без фона и без действия."
      },
      { role: "user", content: `Тема: ${project.topic}\nСценарий:\n${scenario}` }
    ], 2_000, "low");
    const parsed = extractJson<{ name?: string; prompt?: string }>(content, "описании главного героя");
    if (!parsed.prompt?.trim()) throw new Error("Модель не вернула описание героя");
    const style = project.settings.image.style.trim();
    const fullPrompt = `Character reference sheet, full body portrait, neutral plain background. ${parsed.prompt}${style ? `\nStyle: ${style}` : ""}`;
    const image = await this.generateImage(fullPrompt, "1024x1024");
    return { name: parsed.name?.trim() || "Главный герой", prompt: parsed.prompt, image };
  }

  private static readonly SAMPLE_TEXTS: Record<string, string> = {
    ru: "Так звучит этот голос. Отлично подходит для озвучки роликов.",
    en: "This is how this voice sounds. A great fit for video narration.",
    es: "Así suena esta voz. Perfecta para narrar videos.",
    de: "So klingt diese Stimme. Ideal für Video-Vertonung.",
    fr: "Voici comment sonne cette voix. Parfaite pour la narration vidéo.",
    it: "Ecco come suona questa voce. Perfetta per la narrazione video.",
    pt: "É assim que esta voz soa. Perfeita para narração de vídeos.",
    uk: "Так звучить цей голос. Чудово підходить для озвучення роликів."
  };

  /** Короткий пример голоса (base64 MP3) с кэшем на диске: одна генерация на голос, дальше мгновенно. */
  async ttsSample(voice: string, languageCode: string, cacheDir: string): Promise<string> {
    const safeVoice = voice.replace(/[^a-z0-9-]/gi, "_");
    const safeLanguage = languageCode.replace(/[^a-zA-Z-]/g, "").toLowerCase() || "en";
    const cachePath = join(cacheDir, `${safeVoice}-${safeLanguage}.mp3`);
    try {
      return (await readFile(cachePath)).toString("base64");
    } catch {
      // кэша нет — генерируем ниже
    }
    const short = safeLanguage.split("-")[0] ?? "en";
    const text = AnyModelClient.SAMPLE_TEXTS[short] ?? AnyModelClient.SAMPLE_TEXTS.en!;
    const audio = await this.textToSpeech(text, languageCode, voice);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, audio);
    return audio.toString("base64");
  }

  async generateVideo(prompt: string, duration: number, aspectRatio: string, sourceImage?: Buffer): Promise<Buffer> {
    const settings = await this.store.publicSettings();
    const create = await this.request("/v1/videos/generations", { method: "POST", headers: { "Idempotency-Key": randomUUID() }, body: JSON.stringify({
      model: settings.videoModel,
      prompt,
      duration: [5, 8, 10, 15].reduce((a, b) => Math.abs(b - duration) < Math.abs(a - duration) ? b : a),
      resolution: "720p",
      aspect_ratio: aspectRatio,
      // Задел под image-to-video: стартовый кадр сцены; точное имя параметра сверим при подключении видео-провайдера.
      ...(sourceImage ? { input_image: `data:image/png;base64,${sourceImage.toString("base64")}` } : {})
    }) });
    if (!create.ok) throw new Error(await this.error(create));
    const ticket = create.headers.get("x-9router-connection-id");
    const created = await create.json() as { request_id?: string; id?: string };
    const id = created.request_id || created.id;
    if (!id || !ticket) throw new Error("AnyModel не вернул идентификатор видео-задачи");
    for (let attempt = 0; attempt < 180; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const poll = await this.request(`/v1/videos/${encodeURIComponent(id)}`, { headers: { "x-9router-connection-id": ticket } });
      if (!poll.ok) throw new Error(await this.error(poll));
      const status = await poll.json() as { status?: string; url?: string; result_url?: string; error?: string };
      const url = status.result_url || status.url;
      if (url) {
        const result = await fetch(url);
        if (!result.ok) throw new Error("Не удалось скачать готовое видео");
        return Buffer.from(await result.arrayBuffer());
      }
      if (status.status === "failed") throw new Error(status.error || "Генерация видео завершилась ошибкой");
    }
    throw new Error("Истекло время ожидания видео");
  }

  private async chat(model: string, messages: Array<{ role: string; content: string }>, maxTokens?: number, reasoningEffort: "low" | "medium" | "high" = "high"): Promise<string> {
    const response = await this.request("/v1/chat/completions", { method: "POST", body: JSON.stringify({ model, messages, reasoning_effort: reasoningEffort, temperature: 0.4, ...(maxTokens ? { max_tokens: maxTokens } : {}) }) });
    if (!response.ok) throw new Error(await this.error(response));
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("AnyModel вернул пустой ответ");
    return content;
  }

  private async streamChat(model: string, messages: Array<{ role: string; content: string }>, onChunk: (chunk: string) => void): Promise<string> {
    const response = await this.request("/v1/chat/completions", { method: "POST", body: JSON.stringify({ model, messages, stream: true, reasoning_effort: "high", temperature: 0.4 }) });
    if (!response.ok) throw new Error(await this.error(response));
    if (!response.body) throw new Error("AnyModel не вернул поток ответа");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let event: { choices?: Array<{ delta?: { content?: string | Array<{ text?: string }> } }> };
        try {
          event = JSON.parse(data) as typeof event;
        } catch {
          continue; // битый SSE-фрейм не должен обрывать весь стрим
        }
        const content = event.choices?.[0]?.delta?.content;
        const chunk = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part.text ?? "").join("") : "";
        if (!chunk) continue;
        answer += chunk;
        onChunk(chunk);
      }
      if (done) break;
    }
    if (!answer) throw new Error("AnyModel вернул пустой поток");
    return answer;
  }

  private static readonly RETRIABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
  private static readonly MAX_RETRIES = 3;

  private async request(path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
    const settings = await this.store.publicSettings();
    const key = await this.store.apiKey();
    if (!key) throw new Error("Сначала сохраните новый API-ключ AnyModel в настройках");
    const base = settings.baseUrl.replace(/\/+$/, "");
    const normalizedPath = base.toLowerCase().endsWith("/v1") && path.toLowerCase().startsWith("/v1/")
      ? path.slice(3)
      : path;
    const url = `${base}${normalizedPath}`;
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers };
    const host = (() => { try { return new URL(base).host; } catch { return "anymodel.org"; } })();
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers });
    } catch (networkError) {
      // Сетевой сбой — повторяем с бэкоффом.
      if (attempt < AnyModelClient.MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        return this.request(path, init, attempt + 1);
      }
      const cause = (networkError as { cause?: { code?: string } })?.cause;
      const code = cause?.code ?? "";
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
        throw new Error(`Не удалось найти сервер ${host} (DNS). Проверьте интернет — в некоторых сетях он открывается только через VPN.`);
      }
      throw new Error(`Нет соединения с ${host} после ${AnyModelClient.MAX_RETRIES + 1} попыток. Проверьте интернет/VPN и повторите.`);
    }
    // Временная недоступность провайдера — ждём и повторяем (учитываем retry_after).
    if (AnyModelClient.RETRIABLE_STATUSES.has(response.status) && attempt < AnyModelClient.MAX_RETRIES) {
      const bodyText = await response.text().catch(() => "");
      await sleep(retryAfterMs(response, bodyText, attempt));
      return this.request(path, init, attempt + 1);
    }
    return response;
  }

  private async error(response: Response): Promise<string> {
    const text = await response.text();
    if (/model_not_found|The selected model is unavailable/i.test(text)) {
      const settings = await this.store.publicSettings().catch(() => undefined);
      return `Модель «${settings?.textModel ?? "выбранная"}» недоступна на вашем ключе AnyModel. Откройте Настройки → AI и сценарии и укажите модель из вашего каталога AnyModel (например ag/claude-sonnet-4-6 или cc/claude-opus-4-8), затем нажмите «Проверить подключение».`;
    }
    if (response.status === 401 || response.status === 403) {
      return "AnyModel отклонил ключ API. Проверьте ключ в Настройки → AI и сценарии (возможно, он был отозван) и сохраните новый.";
    }
    if (/insufficient|balance|quota|credit/i.test(text)) {
      return "На балансе AnyModel недостаточно средств для запроса. Пополните баланс и повторите.";
    }
    return `AnyModel ${response.status}: ${text.slice(0, 300)}`;
  }

  private async referenceMetadata(url: string): Promise<{ title?: string; author?: string }> {
    try {
      const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const response = await fetch(endpoint);
      if (!response.ok) return {};
      const data = await response.json() as { title?: string; author_name?: string };
      return { title: data.title, author: data.author_name };
    } catch {
      return {};
    }
  }
}

/** Системный промпт сценариста: удержание, ритм, конкретика и жёсткие требования к промптам кадров. */
const SCENE_WRITER_SYSTEM = [
  "Ты — сценарист вирусных YouTube-роликов и художник-постановщик в одном лице.",
  "",
  "ОЗВУЧКА (narration):",
  "1. Одна сцена = одна законченная мысль, 12–16 слов, разговорный живой язык, короткие предложения.",
  "2. Пиши ГОТОВЫЙ текст для диктора: без ремарок, пометок, номеров сцен и слов «сцена», «кадр», «голос за кадром».",
  "3. Держи удержание: конкретика вместо общих слов, факты, цифры, детали, приёмы «а вот что было дальше», микро-интрига в конце каждой 3–4 сцены.",
  "4. Нельзя повторять одну мысль дважды и нельзя пересказывать уже сказанное другими словами.",
  "5. Если в плане есть transcriptSample и audienceComments — бери оттуда приёмы, ритм и запросы аудитории, но текст пиши полностью свой, без дословных заимствований и чужого брендинга.",
  "",
  "КАДР (imagePrompt):",
  "6. Пиши промпт НА АНГЛИЙСКОМ, одним предложением-описанием: субъект, действие, окружение, свет, ракурс, настроение.",
  "7. Кадр должен показывать то, о чём говорит narration этой сцены, а не абстракцию.",
  "8. Повторяющегося героя описывай ОДИНАКОВО в каждой сцене (возраст, внешность, одежда) — это критично для консистентности.",
  "9. Запрещено: текст, надписи, субтитры, логотипы, интерфейсы, коллажи, рамки, водяные знаки в кадре.",
  "10. Не указывай в промпте стиль и соотношение сторон — приложение добавит их само.",
  "",
  "Верни только JSON-массив без markdown и без пояснений."
].join("\n");

/** Подсказка модели, в какой части ролика находится батч сцен: начало держит, середина развивает, финал закрывает. */
function describePosition(from: number, total: number): string {
  const share = from / Math.max(1, total);
  if (share < 0.15) return "начало — хук и обещание, ради чего смотреть дальше";
  if (share < 0.75) return "основная часть — раскрытие по шагам, факты и примеры, микро-интриги для удержания";
  if (share < 0.92) return "кульминация — самый сильный вывод или поворот";
  return "финал — короткий вывод и призыв к действию (подписка/комментарий), без затянутого прощания";
}

/** «Память режиссёра»: список уже сделанных роликов, чтобы новые темы не повторялись. */
function memoryNote(pastProjects: string[]): string {
  if (pastProjects.length === 0) return "";
  return `\nУже созданные пользователем ролики (НЕ повторяй их темы, предлагай новое с учётом этой истории): ${JSON.stringify(pastProjects.slice(0, 30))}`;
}

/** Достаёт JSON из ответа модели: срезает markdown-фенсы, при неудаче берёт фрагмент между крайними скобками. */
function extractJson<T>(content: string, what: string): T {
  const cleaned = content.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "").trim();
  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) candidates.push(cleaned.slice(firstBracket, lastBracket + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // пробуем следующий вариант
    }
  }
  throw new Error(`Модель вернула не-JSON при ${what}. Начало ответа: ${cleaned.slice(0, 160)}`);
}

/** Размеры, которые принимает gpt-image: ближайший к запрошенному формату кадра. */
function gptImageSize(size: string): string {
  if (/^(1920x1080|1792x1024|1536x1024)$/.test(size)) return "1536x1024";
  if (/^(1080x1920|1024x1792|1024x1536)$/.test(size)) return "1024x1536";
  return "1024x1024";
}

/** Референсы для images/generations: URL идёт как есть, локальный файл превращается в data:URI. */
async function referencePayload(references: string[]): Promise<string | string[]> {
  const payloads = await Promise.all(references.map(async (ref) => {
    if (/^https?:\/\//i.test(ref) || ref.startsWith("data:")) return ref;
    const data = await readFile(ref);
    const mime = /\.jpe?g$/i.test(ref) ? "image/jpeg" : /\.webp$/i.test(ref) ? "image/webp" : "image/png";
    return `data:${mime};base64,${data.toString("base64")}`;
  }));
  return payloads.length === 1 ? payloads[0]! : payloads;
}

/** Нейроголоса Edge TTS по языкам проекта — используются, когда в настройках указан просто "edge-tts". */
const EDGE_TTS_VOICES: Record<string, string> = {
  ru: "ru-RU-DmitryNeural",
  en: "en-US-ChristopherNeural",
  uk: "uk-UA-OstapNeural",
  de: "de-DE-ConradNeural",
  es: "es-ES-AlvaroNeural",
  fr: "fr-FR-HenriNeural",
  it: "it-IT-DiegoNeural",
  pt: "pt-BR-AntonioNeural"
};

/** Полный id модели озвучки: значение с "/" идёт как есть, "edge-tts" получает голос по языку, иначе провайдер+язык. */
function ttsModelId(setting: string, languageCode: string): string {
  const value = (setting || "google-tts").trim();
  if (value.includes("/")) return value;
  // Голое имя голоса вида "ru-RU-DmitryNeural" (старые проекты) — это Edge TTS.
  if (/^[a-z]{2,3}-[A-Za-z]{2,4}-\w+/.test(value)) return `edge-tts/${value}`;
  if (value === "edge-tts") {
    const voice = EDGE_TTS_VOICES[languageCode.split("-")[0]?.toLowerCase() ?? ""];
    if (voice) return `edge-tts/${voice}`;
    return `google-tts/${languageCode}`;
  }
  return `${value}/${languageCode}`;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(15_000, 1_000 * 2 ** attempt);
}

/** Пауза перед повтором: retry_after из заголовка или тела ответа, иначе экспоненциальный бэкофф (не больше 20с). */
function retryAfterMs(response: Response, bodyText: string, attempt: number): number {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(20_000, header * 1_000);
  const match = /"retry_after_seconds"\s*:\s*(\d+)/.exec(bodyText);
  if (match) return Math.min(20_000, Number(match[1]) * 1_000);
  return backoffMs(attempt);
}

/** Приводит поле-список (strengths/improvements/structure) к массиву строк, даже если модель вернула объекты. */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const parts = Object.values(item as Record<string, unknown>).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
        return parts.join(" — ");
      }
      return item == null ? "" : String(item);
    })
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Разбирает ответ модели в массив сцен: принимает и голый JSON-массив, и объект { scenes: [...] }, и массив внутри текста. */
function parseSceneArray(content: string): Array<{ narration?: string; imagePrompt?: string; durationSeconds?: number }> {
  const cleaned = content.replace(/^```json\s*|```$/g, "").trim();
  const attempts = [cleaned, cleaned.match(/\[[\s\S]*\]/)?.[0] ?? ""];
  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) return parsed as Array<{ narration?: string; imagePrompt?: string; durationSeconds?: number }>;
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { scenes?: unknown[] }).scenes)) {
        return (parsed as { scenes: Array<{ narration?: string; imagePrompt?: string; durationSeconds?: number }> }).scenes;
      }
    } catch {
      // пробуем следующий вариант
    }
  }
  return [];
}
