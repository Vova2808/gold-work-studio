import { randomUUID } from "node:crypto";
import type { AiChatMessage, AnalyzeReferenceInput, ReferenceAnalysis, Scene, TranscriptSegment, YouTubeAnalysisContext } from "@gold-work/shared";
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

  async analyzeReference(input: AnalyzeReferenceInput): Promise<ReferenceAnalysis> {
    const settings = await this.store.publicSettings();
    const metadata = await this.referenceMetadata(input.url);
    const content = await this.chat(settings.textModel, [
      { role: "system", content: "Ты сценарный аналитик. Верни только JSON без markdown. Не утверждай, что видел ролик, если дан только заголовок и описание. Создай самостоятельный сценарий, не копируй чужой текст или брендинг." },
      { role: "user", content: `Ссылка: ${input.url}\nМетаданные: ${JSON.stringify(metadata)}\nПожелания: ${input.instructions || "нет"}\nЯзык: ${input.language || "Русский"}\nВерни JSON: sourceTitle,niche,targetAudience,hook,structure[],strengths[],improvements[],suggestedAngle,suggestedTitle,recommendedDurationSeconds,scenes[{title,narration,imagePrompt,animationPrompt,durationSeconds}]` }
    ]);
    const parsed = JSON.parse(content.replace(/^```json\s*|```$/g, "").trim()) as Partial<ReferenceAnalysis> & { scenes?: Array<Partial<Scene>> };
    const scenes = (parsed.scenes ?? []).map((scene, order) => ({
      id: createId("scene"), order, title: scene.title || `Сцена ${order + 1}`, narration: scene.narration || "",
      imagePrompt: scene.imagePrompt || "", animationPrompt: scene.animationPrompt || "", durationSeconds: scene.durationSeconds || 8, status: "draft" as const
    }));
    if (!scenes.length) throw new Error("Модель не вернула сцены");
    return {
      sourceUrl: input.url, sourceTitle: parsed.sourceTitle || metadata.title || "Референс",
      niche: parsed.niche || "Не определена", targetAudience: parsed.targetAudience || "Не определена",
      hook: parsed.hook || scenes[0]!.narration, structure: parsed.structure || [], strengths: parsed.strengths || [],
      improvements: parsed.improvements || [], suggestedAngle: parsed.suggestedAngle || input.instructions || "Самостоятельный ролик",
      suggestedTitle: parsed.suggestedTitle || "Новый ролик", recommendedDurationSeconds: parsed.recommendedDurationSeconds || scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
      language: input.language || "Русский", instructions: input.instructions, scenes, provider: `anymodel:${settings.textModel}`
    };
  }

  async analyzeYouTube(context: YouTubeAnalysisContext, input: AnalyzeReferenceInput): Promise<ReferenceAnalysis> {
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
    const content = await this.chat(settings.textModel, [
      {
        role: "system",
        content: "Ты YouTube-аналитик и сценарный режиссёр. Верни только JSON без markdown. На основе транскрипта с таймкодами, официальной статистики и комментариев объясни, почему ролик работает, что зрителям нравится и что улучшить. Создай новый самостоятельный сценарий — не копируй оригинальный текст, персонажей или брендинг. Визуальные кадры не анализировались, не утверждай обратное."
      },
      {
        role: "user",
        content: `Данные YouTube:\n${JSON.stringify(compactContext)}\nПожелание пользователя: ${input.instructions || "улучшить хук, удержание и сценарий"}\nЯзык: ${input.language || "Русский"}\nВерни JSON: niche,targetAudience,hook,structure[],strengths[],improvements[],suggestedAngle,suggestedTitle,recommendedDurationSeconds,scenes[{title,narration,imagePrompt,animationPrompt,durationSeconds}]`
      }
    ]);
    const parsed = JSON.parse(content.replace(/^```json\s*|```$/g, "").trim()) as Partial<ReferenceAnalysis> & { scenes?: Array<Partial<Scene>> };
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
    if (scenes.length === 0) throw new Error("Модель не вернула сцены после YouTube-анализа");
    return {
      sourceUrl: input.url,
      sourceTitle: context.title,
      niche: parsed.niche || "YouTube-контент",
      targetAudience: parsed.targetAudience || "Аудитория исходного канала",
      hook: parsed.hook || scenes[0]!.narration,
      structure: parsed.structure || [],
      strengths: parsed.strengths || [],
      improvements: parsed.improvements || [],
      suggestedAngle: parsed.suggestedAngle || input.instructions || "Самостоятельная улучшенная подача",
      suggestedTitle: parsed.suggestedTitle || `Новый ролик: ${context.title}`,
      recommendedDurationSeconds: parsed.recommendedDurationSeconds || scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
      language: input.language || "Русский",
      instructions: input.instructions,
      scenes,
      provider: `anymodel:${settings.textModel}+youtube-data-v3`,
      youtubeContext: context
    };
  }

  async transcribeAudio(audio: Buffer, format: string): Promise<TranscriptSegment[]> {
    if (audio.byteLength > 25 * 1024 * 1024) throw new Error("Аудио больше 25 МБ. Выберите более короткий ролик или добавьте субтитры.");
    const settings = await this.store.publicSettings();
    const response = await this.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: settings.textModel,
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
    const parsed = JSON.parse(content.replace(/^```json\s*|```$/g, "").trim()) as Array<Partial<TranscriptSegment>>;
    return parsed.map((segment) => ({
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
    const parsed = JSON.parse(content.replace(/^```json\s*|```$/g, "").trim()) as {
      title?: string;
      topic?: string;
      scenes?: Array<Partial<Scene>>;
    };
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

  async generateImage(prompt: string, size: string): Promise<Buffer> {
    const settings = await this.store.publicSettings();
    const response = await this.request("/v1/images/generations", { method: "POST", body: JSON.stringify({ model: settings.imageModel, prompt, n: 1, size, quality: "high", output_format: "png", response_format: "b64_json" }) });
    if (!response.ok) throw new Error(await this.error(response));
    const data = await response.json() as { data?: Array<{ b64_json?: string }> };
    const encoded = data.data?.[0]?.b64_json;
    if (!encoded) throw new Error("AnyModel не вернул изображение");
    return Buffer.from(encoded, "base64");
  }

  async generateVideo(prompt: string, duration: number, aspectRatio: string): Promise<Buffer> {
    const settings = await this.store.publicSettings();
    const create = await this.request("/v1/videos/generations", { method: "POST", headers: { "Idempotency-Key": randomUUID() }, body: JSON.stringify({ model: settings.videoModel, prompt, duration: [5, 8, 10, 15].reduce((a, b) => Math.abs(b - duration) < Math.abs(a - duration) ? b : a), resolution: "720p", aspect_ratio: aspectRatio }) });
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

  private async chat(model: string, messages: Array<{ role: string; content: string }>): Promise<string> {
    const response = await this.request("/v1/chat/completions", { method: "POST", body: JSON.stringify({ model, messages, reasoning_effort: "high", temperature: 0.4 }) });
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
        const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string | Array<{ text?: string }> } }> };
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

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const settings = await this.store.publicSettings();
    const key = await this.store.apiKey();
    if (!key) throw new Error("Сначала сохраните новый API-ключ AnyModel в настройках");
    const base = settings.baseUrl.replace(/\/+$/, "");
    const normalizedPath = base.toLowerCase().endsWith("/v1") && path.toLowerCase().startsWith("/v1/")
      ? path.slice(3)
      : path;
    return fetch(`${base}${normalizedPath}`, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers } });
  }

  private async error(response: Response): Promise<string> {
    const text = await response.text();
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

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
