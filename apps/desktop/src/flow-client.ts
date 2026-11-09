import { createHash, randomUUID } from "node:crypto";
import type { Session } from "electron";
import type { AspectRatio, FlowAccountPublic } from "@gold-work/shared";
import type { FlowAccountStore } from "./flow-account-store.js";
import type { FlowAuthService } from "./flow-auth-service.js";
import { NO_RETRY_MARKER } from "./google-errors.js";
import { normalizeImageAspect } from "./media-utils.js";
import { FLOW_RPC, FlowRpcError, flowRpcCreateProject, flowRpcImageModels, flowRpcImageRequest, flowRpcImageMedia, flowRpcUploadImage, flowRpcVideoRequest, flowRpcVideoMedia, selectFlowRpcVideoModel } from "./flow-rpc.js";
import { FlowAccountSerialQueue, FlowUserActionError, flowAbortError, runFlowStep } from "./flow-request-control.js";
import {
  FLOW_API_ORIGIN,
  FLOW_ORIGIN,
  FLOW_PROJECT_CREATE_URL,
  FLOW_TOOL_URL,
  buildFlowImagePayload,
  buildFlowVideoPayload,
  findFlowMedia,
  findFlowGeneratedImage,
  findFlowNumber,
  findFlowString,
  flowApiErrorMessage,
  flowImageFileName,
  flowImageMimeType,
  flowMediaStatus,
  flowMediaDownloadUrl,
  flowRetryAfterMs,
  flowTrpcInput,
  flowImagePlans,
  flowVideoPlans,
  shouldTryNextFlowModel,
  type FlowImagePlan,
  type FlowVideoPlan,
} from "./flow-protocol.js";

export interface FlowGenerateInput {
  prompt: string;
  aspectRatio: string;
  durationSeconds: number;
  startFrame?: Buffer;
  endFrame?: Buffer;
  model?: string;
  accountId?: string;
  signal?: AbortSignal;
  resumeJob?: FlowRemoteVideoJob;
  onRemoteJob?: (job: FlowRemoteVideoJob | undefined) => void | Promise<void>;
  onBeforeSubmit?: (accountId: string) => Promise<void>;
  onSubmitRejected?: () => Promise<void>;
  onProgress?: (progress: FlowVideoProgress) => void | Promise<void>;
}

export interface FlowRemoteVideoJob {
  provider: "flow";
  accountId: string;
  projectId: string;
  mediaName: string;
  workflowId?: string;
  modelKey: string;
  submittedAt: string;
}

export interface FlowVideoProgress {
  percent: number;
  stage: string;
  remoteJob?: FlowRemoteVideoJob;
}

export interface FlowGenerateImageInput {
  prompt: string;
  aspectRatio: string;
  references?: Buffer[];
  model?: string;
  accountId?: string;
  signal?: AbortSignal;
  resumeJob?: FlowRemoteImageJob;
  onRemoteJob?: (job: FlowRemoteImageJob | undefined) => void | Promise<void>;
  onBeforeSubmit?: (accountId: string) => Promise<void>;
  onSubmitRejected?: () => Promise<void>;
  onProgress?: (progress: { percent: number; stage: string; remoteJob?: FlowRemoteImageJob }) => void | Promise<void>;
}

export interface FlowRemoteImageJob extends FlowRemoteVideoJob {
  kind: "image";
}

export class FlowSubmissionUncertainError extends Error {
  readonly submissionUncertain = true;

  constructor(stage: string) {
    super(`${NO_RETRY_MARKER}Flow: ${stage}: ответ на запуск потерян; задание могло быть принято. `
      + "Проверьте проект Flow перед новой генерацией, чтобы не списать кредиты повторно.");
    this.name = "FlowSubmissionUncertainError";
  }
}

interface FlowProjectLease {
  projectId: string;
  uses: number;
}

type FlowToolName = "PINHOLE";
const FLOW_PROJECT_TOOL_NAME = "PINHOLE" as const;

interface FlowHttpErrorOptions {
  status: number;
  body: unknown;
  retryAfter?: string | null;
  stage?: string;
}

class FlowHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly retryAfter?: string | null;
  readonly stage?: string;

  constructor(message: string, options: FlowHttpErrorOptions) {
    super(message);
    this.name = "FlowHttpError";
    this.status = options.status;
    this.body = options.body;
    this.retryAfter = options.retryAfter;
    this.stage = options.stage;
  }
}

export class FlowAccountPool {
  private cursor = 0;

  constructor(
    private readonly store: FlowAccountStore,
    private readonly auth: FlowAuthService
  ) {}

  async available(kind: "image" | "video" = "video"): Promise<FlowAccountPublic[]> {
    const now = Date.now();
    return (await this.store.list()).filter((account) =>
      account.enabled
      && (kind === "image" || account.videoEnabled)
      && account.status === "ready"
      && (!account.cooldownUntil || Date.parse(account.cooldownUntil) <= now)
    );
  }

  async candidates(preferredId?: string, kind: "image" | "video" = "video"): Promise<FlowAccountPublic[]> {
    let accounts = await this.available(kind);
    if (accounts.length === 0) {
      // An automatic retry must not resurrect a session already rejected after refresh.
      const recoverable = (await this.store.list()).filter((account) =>
        account.enabled && (kind === "image" || account.videoEnabled)
        && account.status !== "needs_login" && account.status !== "needs_user_action"
        && (!account.cooldownUntil || Date.parse(account.cooldownUntil) <= Date.now())
      );
      await Promise.all(recoverable.map((account) => this.auth.refresh(account.id).catch(() => undefined)));
      accounts = await this.available(kind);
    }
    if (preferredId) {
      const preferred = accounts.find((account) => account.id === preferredId);
      if (!preferred) {
        throw new Error(`${NO_RETRY_MARKER}Выбранный Flow-аккаунт недоступен или требует повторного входа`);
      }
      return [await this.ensureFresh(preferred)];
    }
    if (accounts.length === 0) {
      throw new Error(`${NO_RETRY_MARKER}Нет доступных Flow-аккаунтов. Проверьте вход и ограничения в Настройки → Видео.`);
    }
    const start = this.cursor % accounts.length;
    const ordered = [...accounts.slice(start), ...accounts.slice(0, start)];
    this.cursor = (start + 1) % accounts.length;
    // Every account owns an isolated browser session, so refreshes can safely run
    // together. Starting one-by-one would add the slowest five refresh times before
    // the first generation can be dispatched.
    const refreshed = await Promise.allSettled(ordered.map((account) => this.ensureFresh(account)));
    const fresh = refreshed
      .filter((result): result is PromiseFulfilledResult<FlowAccountPublic> => result.status === "fulfilled")
      .map((result) => result.value);
    if (fresh.length === 0) throw new Error("Ни один Flow-аккаунт не прошёл обновление сессии");
    return fresh;
  }

  async select(preferredId?: string): Promise<FlowAccountPublic> {
    return (await this.candidates(preferredId))[0]!;
  }

  private async ensureFresh(account: FlowAccountPublic): Promise<FlowAccountPublic> {
    const expiry = account.tokenExpiresAt ? Date.parse(account.tokenExpiresAt) : 0;
    return expiry > Date.now() + 60_000 && account.tier
      ? account
      : this.auth.refresh(account.id);
  }
}

export class FlowClient {
  readonly pool: FlowAccountPool;
  private readonly projects = new Map<string, FlowProjectLease>();
  private readonly projectPromises = new Map<string, Promise<FlowProjectLease>>();
  private readonly sessionIds = new Map<string, string>();
  private readonly uploadedImages = new Map<string, string>();
  private readonly uploadPromises = new Map<string, Promise<string>>();
  private readonly accountQueue = new FlowAccountSerialQueue();

  constructor(
    private readonly store: FlowAccountStore,
    private readonly auth: FlowAuthService,
    private readonly redirectFetch?: typeof globalThis.fetch
  ) {
    this.pool = new FlowAccountPool(store, auth);
  }

  async configured(kind: "image" | "video" = "video"): Promise<boolean> {
    return (await this.pool.available(kind)).length > 0;
  }

  async test(accountId?: string): Promise<{ ok: boolean; message: string }> {
    try {
      const account = accountId ? await this.auth.refresh(accountId) : await this.pool.select();
      if (account.status !== "ready") throw new Error(account.lastError ?? "Flow не подтвердил доступность аккаунта");
      await this.auth.prepareRuntime(account.id);
      if ((await this.store.secret(account.id)).sessionOrigin === "https://flow.google.com") {
        const models = flowRpcImageModels(await this.auth.rpc(account.id, FLOW_RPC.models, []));
        if (!models.length) throw new Error("Flow не вернул доступные модели изображений");
        return { ok: true, message: `Вход в новый Flow подтверждён${account.credits === undefined ? "" : `, кредитов: ${account.credits}`}. Генератор изображений подключён (${models.join(", ")}); Veo проверяет доступность выбранной модели перед запуском. Это проверка доступа, без платной генерации.` };
      }
      const browserSession = await this.auth.sessionFor(account.id);
      const project = await this.ensureProject(account, browserSession, "PINHOLE");
      const suffix = [
        account.tier ? `тариф ${account.tier}` : undefined,
        account.credits !== undefined ? `кредитов ${account.credits}` : undefined,
      ].filter(Boolean).join(", ");
      return {
        ok: true,
        message: `Flow готов: ${account.email ?? account.label ?? account.id}${suffix ? ` (${suffix})` : ""}. Проект API: ${project.projectId}.`,
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async generateVideo(input: FlowGenerateInput): Promise<Buffer> {
    this.throwIfAborted(input.signal);
    if (input.resumeJob?.provider === "flow") {
      return this.accountQueue.run(
        input.resumeJob.accountId,
        input.signal,
        () => this.resumeVideoJob(input, input.resumeJob!)
      );
    }
    let submitted = false;
    const onRemoteJob = input.onRemoteJob;
    input = { ...input, onRemoteJob: async (job) => { if (job) submitted = true; await onRemoteJob?.(job); } };
    await this.reportVideoProgress(input, 3, "Flow: подготавливаю аккаунт и проект");
    const accounts = await this.pool.candidates(input.accountId);
    const errors: string[] = [];
    while (accounts.length > 0) {
      let account = accounts[0]!;
      let rotateAfterFailure = false;
      try {
        return await this.accountQueue.runAny(accounts, input.signal, (selected) => {
          account = selected;
          return this.generateWithAccount(input, selected);
        });
      } catch (error) {
        if (submitted || input.signal?.aborted || error instanceof FlowSubmissionUncertainError) throw error;
        const failedIndex = accounts.findIndex((candidate) => candidate.id === account.id);
        if (failedIndex >= 0) accounts.splice(failedIndex, 1);
        if (error instanceof FlowHttpError && error.status === 401) {
          rotateAfterFailure = true;
          try {
            const refreshed = await this.auth.refresh(account.id);
            return await this.accountQueue.run(account.id, input.signal, () => this.generateWithAccount(input, refreshed));
          } catch (refreshError) {
            error = refreshError;
          }
        }
        if (submitted || input.signal?.aborted || error instanceof FlowSubmissionUncertainError) throw error;
        await this.rejectUnusualActivity(account, error);
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${account.email ?? account.label ?? account.id}: ${message}`);
        if (error instanceof FlowHttpError && error.status === 401) await this.invalidateSession(account);
        if ((!rotateAfterFailure && !this.shouldRotateAccount(error)) || input.accountId) throw error;
        if (error instanceof FlowHttpError) await this.cooldown(account, error);
      }
    }
    throw new Error(`${NO_RETRY_MARKER}Все Flow-аккаунты недоступны: ${errors.join(" | ")}`);
  }

  async generateImage(input: FlowGenerateImageInput): Promise<Buffer> {
    this.throwIfAborted(input.signal);
    if (input.resumeJob) {
      return this.accountQueue.run(input.resumeJob.accountId, input.signal, () => this.resumeImageJob(input, input.resumeJob!));
    }
    let submitted = false;
    const onRemoteJob = input.onRemoteJob;
    input = { ...input, onRemoteJob: async (job) => { if (job) submitted = true; await onRemoteJob?.(job); } };
    const accounts = await this.pool.candidates(input.accountId, "image");
    const errors: string[] = [];
    while (accounts.length > 0) {
      let account = accounts[0]!;
      let rotateAfterFailure = false;
      try {
        return await this.accountQueue.runAny(accounts, input.signal, (selected) => {
          account = selected;
          return this.generateImageWithAccount(input, selected);
        });
      } catch (error) {
        if (submitted || input.signal?.aborted || error instanceof FlowSubmissionUncertainError) throw error;
        const failedIndex = accounts.findIndex((candidate) => candidate.id === account.id);
        if (failedIndex >= 0) accounts.splice(failedIndex, 1);
        if (error instanceof FlowHttpError && error.status === 401) {
          rotateAfterFailure = true;
          try {
            const refreshed = await this.auth.refresh(account.id);
            return await this.accountQueue.run(account.id, input.signal, () => this.generateImageWithAccount(input, refreshed));
          } catch (refreshError) {
            error = refreshError;
          }
        }
        if (submitted || input.signal?.aborted || error instanceof FlowSubmissionUncertainError) throw error;
        await this.rejectUnusualActivity(account, error);
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${account.email ?? account.label ?? account.id}: ${message}`);
        if (error instanceof FlowHttpError && error.status === 401) await this.invalidateSession(account);
        if ((!rotateAfterFailure && !this.shouldRotateAccount(error)) || input.accountId) throw error;
        if (error instanceof FlowHttpError) await this.cooldown(account, error);
      }
    }
    throw new Error(`${NO_RETRY_MARKER}Все Flow-аккаунты недоступны для изображений: ${errors.join(" | ")}`);
  }

  private async generateImageWithAccount(
    input: FlowGenerateImageInput,
    initialAccount: FlowAccountPublic
  ): Promise<Buffer> {
    await this.assertUsableAccount(initialAccount.id, input.signal, "image");
    if ((await this.store.secret(initialAccount.id)).sessionOrigin === "https://flow.google.com") {
      return this.generateRpcImage(input, initialAccount);
    }
    let account = initialAccount;
    let secret = await this.store.secret(account.id);
    if (!secret.accessToken) {
      account = await this.auth.refresh(account.id);
      secret = await this.store.secret(account.id);
      await this.assertGenerationProtocol(account.id);
    }
    if (!secret.accessToken) throw new Error("Flow-сессия не содержит access token; обновите аккаунт");

    await this.auth.prepareRuntime(account.id, input.signal);
    const browserSession = await this.auth.sessionFor(account.id);
    const project = await this.ensureProject(account, browserSession, "PINHOLE", input.signal);
    const referenceImageIds: string[] = [];
    for (const reference of (input.references ?? []).filter((item) => item.length > 0).slice(0, 3)) {
      referenceImageIds.push(await this.uploadImage(
        browserSession,
        secret.accessToken,
        project.projectId,
        reference,
        "PINHOLE",
        input.signal
      ));
    }

    const plans = flowImagePlans(input.model);
    let media: Record<string, unknown> | undefined;
    let selectedPlan = plans[0]!;
    let lastError: unknown;
    for (const [index, plan] of plans.entries()) {
      this.throwIfAborted(input.signal);
      try {
        media = await this.submitImage(
          browserSession,
          account,
          secret.accessToken,
          project.projectId,
          plan,
          input,
          referenceImageIds
        );
        selectedPlan = plan;
        break;
      } catch (error) {
        lastError = error;
        if (
          !(error instanceof FlowHttpError)
          || index === plans.length - 1
          || !shouldTryNextFlowModel(error.status, error.message)
        ) {
          throw error;
        }
      }
    }
    if (!media) throw lastError ?? new Error("Flow не вернул изображение");
    const mediaName = typeof media.name === "string" ? media.name : undefined;
    if (!mediaName) {
      try { return await this.downloadImage(browserSession, account.id, media, input.signal); } catch {
        throw new FlowSubmissionUncertainError("получение созданного изображения без mediaId");
      }
    }
    const remoteJob: FlowRemoteImageJob = {
      provider: "flow", kind: "image", accountId: account.id, projectId: project.projectId,
      mediaName, workflowId: typeof media.workflowId === "string" ? media.workflowId : undefined,
      modelKey: selectedPlan.modelKey, submittedAt: new Date().toISOString(),
    };
    try { await input.onRemoteJob?.(remoteJob); } catch {
      throw new FlowSubmissionUncertainError("сохранение созданного изображения");
    }
    await input.onProgress?.({ percent: 90, stage: "Flow: изображение создано, скачиваю файл", remoteJob });
    project.uses += 1;
    return this.downloadImage(browserSession, account.id, media, input.signal);
  }

  private async resumeImageJob(input: FlowGenerateImageInput, job: FlowRemoteImageJob): Promise<Buffer> {
    const account = await this.resumeAccount(job.accountId);
    if ((await this.store.secret(account.id)).sessionOrigin === "https://flow.google.com") {
      return this.downloadRpcImage(input, job);
    }
    const browserSession = await this.auth.sessionFor(account.id);
    await input.onProgress?.({ percent: 90, stage: "Flow: скачиваю созданное изображение без новой генерации", remoteJob: job });
    return this.downloadImage(browserSession, account.id, { name: job.mediaName }, input.signal);
  }

  private async generateRpcImage(input: FlowGenerateImageInput, account: FlowAccountPublic): Promise<Buffer> {
    const signal = input.signal;
    await input.onProgress?.({ percent: 5, stage: "Flow: проверяю модели нового генератора" });
    const models = flowRpcImageModels(await this.auth.rpc(account.id, FLOW_RPC.models, [], signal));
    const requested = input.model?.trim();
    const model = requested || (models.includes("NARWHAL") ? "NARWHAL" : "GEM_PIX_2");
    if (!models.includes(model)) throw new Error(`${NO_RETRY_MARKER}Модель изображений ${model} недоступна в новом Flow. Доступны: ${models.join(", ")}`);
    const key = `rpc-image:${account.id}`;
    let project = this.projects.get(key);
    if (!project || project.uses >= 100) {
      const result = await this.auth.rpc(account.id, FLOW_RPC.createProject, flowRpcCreateProject("Gold Work Studio — изображения"), signal);
      const id = typeof result[0] === "string" ? result[0].replace(/^projects\//, "") : "";
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Flow не вернул ID нового проекта");
      project = { projectId: id, uses: 0 }; this.projects.set(key, project);
    }
    await this.auth.prepareRpcProject(account.id, project.projectId, signal);
    const references: string[] = [];
    for (const bytes of (input.references ?? []).filter(item => item.length).slice(0, 3)) {
      const cacheKey = `rpc:${account.id}:${project.projectId}:${createHash("sha256").update(bytes).digest("hex")}`;
      let name = this.uploadedImages.get(cacheKey);
      if (!name) {
        const mime = flowImageMimeType(bytes);
        if (!mime) throw new Error("Некорректное изображение-референс Flow");
        const token = await this.auth.recaptchaToken(account.id, "UPLOAD_IMAGE", signal);
        const result = await this.auth.rpc(account.id, FLOW_RPC.uploadImage,
          flowRpcUploadImage(project.projectId, token, bytes.toString("base64"), mime), signal, 60_000);
        name = flowRpcImageMedia(result[0]).name;
        this.uploadedImages.set(cacheKey, name);
      }
      references.push(name);
    }
    const token = await this.auth.recaptchaToken(account.id, "IMAGE_GENERATION", signal);
    const payload = flowRpcImageRequest({ projectId: project.projectId, token, model, aspectRatio: input.aspectRatio,
      prompt: input.prompt, batchId: randomUUID(), seed: Math.floor(Math.random() * 2147483647), references });
    await input.onProgress?.({ percent: 15, stage: "Flow: создаю изображение" });
    this.throwIfAborted(signal);
    await input.onBeforeSubmit?.(account.id);
    let result: unknown[];
    try { result = await this.auth.rpc(account.id, FLOW_RPC.generateImages, payload, signal, 120_000); }
    catch (error) {
      // Only a confirmed rejection can clear the submission checkpoint. Never replay timeouts/5xx.
      if (error instanceof FlowRpcError && ([400, 401, 403, 429].includes(error.status) || [3, 7, 8, 9, 16].includes(error.code ?? -1))) {
        await input.onSubmitRejected?.();
        throw new Error(`${NO_RETRY_MARKER}${error.message}. Запрос отклонён новым Flow; автоматического повтора нет.`);
      }
      throw new FlowSubmissionUncertainError("ответ нового генератора изображений");
    }
    let media: ReturnType<typeof flowRpcImageMedia>;
    try { media = flowRpcImageMedia(Array.isArray(result[0]) ? result[0][0] : undefined); }
    catch { throw new FlowSubmissionUncertainError("получение ID нового изображения"); }
    const job: FlowRemoteImageJob = { provider: "flow", kind: "image", accountId: account.id,
      projectId: project.projectId, mediaName: media.name, workflowId: media.workflowId,
      modelKey: model, submittedAt: new Date().toISOString() };
    try { await input.onRemoteJob?.(job); } catch { throw new FlowSubmissionUncertainError("сохранение ID нового изображения"); }
    project.uses++;
    return this.downloadRpcImage(input, job, media.url);
  }

  private async downloadRpcImage(input: FlowGenerateImageInput, job: FlowRemoteImageJob, initialUrl?: string): Promise<Buffer> {
    await input.onProgress?.({ percent: 90, stage: "Flow: скачиваю готовое изображение", remoteJob: job });
    const browser = await this.auth.sessionFor(job.accountId);
    let url = initialUrl;
    for (let attempt = 0; attempt < 12; attempt++) {
      this.throwIfAborted(input.signal);
      if (!url) {
        const media = flowRpcImageMedia(await this.auth.rpc(job.accountId, FLOW_RPC.getMedia, [job.mediaName], input.signal));
        url = media.url;
      }
      if (url) {
        const target = new URL(url, "https://flow.google.com");
        if (target.protocol !== "https:" || !["flow.google.com", "flow-content.google", "googleusercontent.com", "googleapis.com"].some(host => target.hostname === host || target.hostname.endsWith(`.${host}`))) {
          throw new Error("Flow вернул неподдерживаемый адрес изображения");
        }
        return runFlowStep("скачивание изображения нового Flow", 90_000, input.signal, async signal => {
          const response = await browser.fetch(target.href, { credentials: target.hostname === "flow.google.com" ? "include" : "omit", signal });
          if (!response.ok) throw new Error(`Скачивание Flow: HTTP ${response.status}. Изображение сохранено в Flow, повторите скачивание.`);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length < 32 || !flowImageMimeType(bytes)) throw new Error("Flow вернул некорректный файл изображения");
          return bytes;
        });
      }
      await this.delay(3000, input.signal);
    }
    throw new Error("Flow ещё не выдал файл изображения. ID сохранён; продолжение не создаст новую картинку.");
  }

  private async submitImage(
    browserSession: Session,
    account: FlowAccountPublic,
    accessToken: string,
    projectId: string,
    plan: FlowImagePlan,
    input: FlowGenerateImageInput,
    referenceImageIds: string[]
  ): Promise<Record<string, unknown>> {
    const recaptchaToken = await this.auth.recaptchaToken(account.id, "IMAGE_GENERATION", input.signal);
    const payload = buildFlowImagePayload({
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      projectId,
      sessionId: this.sessionId(account.id),
      recaptchaToken,
      modelKey: plan.modelKey,
      referenceImageIds,
    });
    const response = await this.postJson(
      browserSession,
      `${FLOW_API_ORIGIN}/v1/projects/${encodeURIComponent(projectId)}/flowMedia:batchGenerateImages`,
      accessToken,
      payload,
      input.signal,
      `генерация изображения (${plan.modelKey})`,
      { before: () => input.onBeforeSubmit?.(account.id), rejected: input.onSubmitRejected }
    );
    const media = findFlowGeneratedImage(response) ?? findFlowMedia(response);
    if (!media) throw new FlowSubmissionUncertainError("получение созданного изображения");
    return media;
  }

  private async generateWithAccount(input: FlowGenerateInput, initialAccount: FlowAccountPublic): Promise<Buffer> {
    await this.assertUsableAccount(initialAccount.id, input.signal);
    if ((await this.store.secret(initialAccount.id)).sessionOrigin === "https://flow.google.com") return this.generateRpcVideo(input, initialAccount);
    let account = initialAccount;
    let secret = await this.store.secret(account.id);
    if (!secret.accessToken) {
      account = await this.auth.refresh(account.id);
      secret = await this.store.secret(account.id);
      await this.assertGenerationProtocol(account.id);
    }
    if (!secret.accessToken) throw new Error("Flow-сессия не содержит access token; обновите аккаунт");

    await this.auth.prepareRuntime(account.id, input.signal);
    const browserSession = await this.auth.sessionFor(account.id);
    const project = await this.ensureProject(account, browserSession, "PINHOLE", input.signal);
    this.throwIfAborted(input.signal);
    await this.reportVideoProgress(input, 8, "Flow: проект готов, подготавливаю исходный кадр");
    const aspectRatio: AspectRatio = input.aspectRatio === "9:16"
      ? "9:16"
      : input.aspectRatio === "1:1"
        ? "1:1"
        : "16:9";
    const preparedStartFrame = input.startFrame
      ? await this.prepareUploadImage(input.startFrame, aspectRatio)
      : undefined;
    const preparedEndFrame = input.endFrame
      ? await this.prepareUploadImage(input.endFrame, aspectRatio)
      : undefined;
    await this.reportVideoProgress(input, 12, "Flow: загружаю исходный кадр");
    const startImageId = input.startFrame
      ? await this.uploadImage(browserSession, secret.accessToken, project.projectId, preparedStartFrame!, "PINHOLE", input.signal)
      : undefined;
    const endImageId = input.endFrame
      ? await this.uploadImage(browserSession, secret.accessToken, project.projectId, preparedEndFrame!, "PINHOLE", input.signal)
      : undefined;

    const plans = flowVideoPlans(input.model, Boolean(startImageId), Boolean(endImageId));
    let media: Record<string, unknown> | undefined;
    let lastError: unknown;
    for (const [index, plan] of plans.entries()) {
      this.throwIfAborted(input.signal);
      try {
        await this.reportVideoProgress(input, 20, `Flow: запускаю ${this.modelLabel(plan.modelKey)}`);
        media = await this.submitVideo(
          browserSession,
          account,
          secret.accessToken,
          project.projectId,
          plan,
          input,
          startImageId,
          endImageId
        );
        break;
      } catch (error) {
        lastError = error;
        if (
          !(error instanceof FlowHttpError)
          || index === plans.length - 1
          || !shouldTryNextFlowModel(error.status, error.message)
        ) {
          throw error;
        }
      }
    }
    if (!media) throw lastError ?? new Error("Flow не вернул задание генерации");
    const mediaName = typeof media.name === "string" ? media.name : undefined;
    if (!mediaName) throw new Error("Flow не вернул media name задания");
    const workflowId = typeof media.workflowId === "string" ? media.workflowId : undefined;
    const selectedPlan = plans[0]!;
    const remoteJob: FlowRemoteVideoJob = {
      provider: "flow",
      accountId: account.id,
      projectId: project.projectId,
      mediaName,
      workflowId,
      modelKey: selectedPlan.modelKey,
      submittedAt: new Date().toISOString(),
    };
    await input.onRemoteJob?.(remoteJob);
    await this.reportVideoProgress(input, 28, `Flow: ${this.modelLabel(remoteJob.modelKey)} запущена, ожидаю видео`, remoteJob);
    project.uses += 1;
    const ready = await this.pollVideo(
      browserSession,
      account.id,
      secret.accessToken,
      project.projectId,
      media,
      input,
      remoteJob
    );
    await this.reportVideoProgress(input, 95, "Flow: видео готово, получаю ссылку для скачивания", remoteJob);
    const video = await this.downloadVideo(browserSession, account.id, ready, input.signal);
    await this.reportVideoProgress(input, 99, "Flow: видео скачано, сохраняю файл", remoteJob);
    return video;
  }

  private async generateRpcVideo(input: FlowGenerateInput, account: FlowAccountPublic): Promise<Buffer> {
    const models = await this.auth.rpc(account.id, FLOW_RPC.models, [], input.signal);
    const credits = await this.auth.rpc(account.id, FLOW_RPC.credits, [], input.signal);
    const model = selectFlowRpcVideoModel(models, { ...input, start: !!input.startFrame, end: !!input.endFrame, billingTier: Number(credits[3]) });
    const key = `rpc-image:${account.id}`;
    let project = this.projects.get(key);
    if (!project || project.uses >= 100) {
      const result = await this.auth.rpc(account.id, FLOW_RPC.createProject, flowRpcCreateProject("Gold Work Studio — видео"), input.signal);
      const id = typeof result[0] === "string" ? result[0].replace(/^projects\//, "") : "";
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Flow не вернул ID проекта");
      project = { projectId: id, uses: 0 }; this.projects.set(key, project);
    }
    await this.auth.prepareRpcProject(account.id, project.projectId, input.signal);
    const upload = async (bytes?: Buffer): Promise<string | undefined> => {
      if (!bytes) return undefined;
      const mime = flowImageMimeType(bytes);
      if (!mime) throw new Error("Некорректный начальный/конечный кадр Veo");
      const token = await this.auth.recaptchaToken(account.id, "UPLOAD_IMAGE", input.signal);
      const response = await this.auth.rpc(account.id, FLOW_RPC.uploadImage,
        flowRpcUploadImage(project!.projectId, token, bytes.toString("base64"), mime), input.signal, 60_000);
      return flowRpcImageMedia(response[0]).name;
    };
    const start = await upload(input.startFrame), end = await upload(input.endFrame);
    const token = await this.auth.recaptchaToken(account.id, "VIDEO_GENERATION", input.signal);
    const request = flowRpcVideoRequest({ projectId: project.projectId, token, model, aspectRatio: input.aspectRatio,
      prompt: input.prompt, batchId: randomUUID(), mediaSeed: randomUUID(), workflowSeed: randomUUID(), start, end });
    await this.reportVideoProgress(input, 10, `Flow: отправляю видео (${model})`);
    this.throwIfAborted(input.signal);
    await input.onBeforeSubmit?.(account.id);
    let response: unknown[];
    try { response = await this.auth.rpc(account.id, request.rpc, request.payload, input.signal, 60_000); }
    catch (error) {
      if (error instanceof FlowRpcError && ([400, 401, 403, 429].includes(error.status) || [3, 7, 8, 9, 16].includes(error.code ?? -1))) {
        await input.onSubmitRejected?.();
        throw new Error(`${NO_RETRY_MARKER}${error.message}. Запрос Veo отклонён; автоматического повтора нет.`);
      }
      throw new FlowSubmissionUncertainError("ответ нового Veo");
    }
    let media: ReturnType<typeof flowRpcVideoMedia>;
    try { media = flowRpcVideoMedia(Array.isArray(response[3]) ? response[3][0] : undefined); }
    catch { throw new FlowSubmissionUncertainError("получение ID нового видео"); }
    const job: FlowRemoteVideoJob = { provider: "flow", accountId: account.id, projectId: project.projectId,
      mediaName: media.name, workflowId: media.workflowId, modelKey: model, submittedAt: new Date().toISOString() };
    try { await input.onRemoteJob?.(job); } catch { throw new FlowSubmissionUncertainError("сохранение ID нового видео"); }
    project.uses++;
    return this.downloadRpcVideo(input, job);
  }

  private async downloadRpcVideo(input: FlowGenerateInput, job: FlowRemoteVideoJob): Promise<Buffer> {
    const browser = await this.auth.sessionFor(job.accountId);
    const started = Date.now();
    while (Date.now() - started < 12 * 60_000) {
      this.throwIfAborted(input.signal);
      const media = flowRpcVideoMedia(await this.auth.rpc(job.accountId, FLOW_RPC.getMedia, [job.mediaName], input.signal));
      if ([4, 5, 7].includes(media.status)) throw new Error(`${NO_RETRY_MARKER}Flow сообщил, что видео не создано (статус ${media.status}). ID задания сохранён.`);
      if (media.url && media.status === 3) {
        const target = new URL(media.url, "https://flow.google.com");
        if (target.protocol !== "https:" || !["flow.google.com", "flow-content.google", "googleusercontent.com", "googleapis.com"].some(host => target.hostname === host || target.hostname.endsWith(`.${host}`))) throw new Error("Flow вернул неподдерживаемый адрес видео");
        await this.reportVideoProgress(input, 95, "Flow: скачиваю готовое видео", job);
        return runFlowStep("скачивание нового Veo", 120_000, input.signal, async signal => {
          const response = await browser.fetch(target.href, { signal, credentials: target.hostname === "flow.google.com" ? "include" : "omit" });
          if (!response.ok) throw new Error(`Flow: скачивание видео HTTP ${response.status}. ID сохранён, можно продолжить скачивание.`);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length < 32 || bytes.subarray(4, 8).toString() !== "ftyp") throw new Error("Flow вернул некорректный MP4");
          return bytes;
        });
      }
      await this.reportVideoProgress(input, 20, `Flow: видео создаётся, ожидание ${Math.round((Date.now() - started) / 1000)} с`, job);
      await this.delay(5000, input.signal);
    }
    throw new Error("Flow ещё создаёт видео. ID сохранён; продолжение проверит это же задание без повторной генерации.");
  }

  private async resumeVideoJob(input: FlowGenerateInput, job: FlowRemoteVideoJob): Promise<Buffer> {
    await this.reportVideoProgress(input, 30, `Flow: продолжаю готовое задание ${this.modelLabel(job.modelKey)}`, job);
    const account = await this.resumeAccount(job.accountId);
    if ((await this.store.secret(account.id)).sessionOrigin === "https://flow.google.com") return this.downloadRpcVideo(input, job);
    let secret = await this.store.secret(account.id);
    if (!secret.accessToken) {
      await this.auth.refresh(account.id);
      secret = await this.store.secret(account.id);
      await this.assertGenerationProtocol(account.id);
    }
    if (!secret.accessToken) throw new Error("Flow-сессия не содержит access token; обновите аккаунт");
    await this.auth.prepareRuntime(account.id, input.signal);
    const browserSession = await this.auth.sessionFor(account.id);
    const media: Record<string, unknown> = {
      name: job.mediaName,
      workflowId: job.workflowId,
    };
    const ready = await this.pollVideo(
      browserSession,
      account.id,
      secret.accessToken,
      job.projectId,
      media,
      input,
      job
    );
    await this.reportVideoProgress(input, 95, "Flow: найдено готовое видео, скачиваю без новой генерации", job);
    const video = await this.downloadVideo(browserSession, account.id, ready, input.signal);
    await this.reportVideoProgress(input, 99, "Flow: видео скачано, сохраняю файл", job);
    return video;
  }

  private async submitVideo(
    browserSession: Session,
    account: FlowAccountPublic,
    accessToken: string,
    projectId: string,
    plan: FlowVideoPlan,
    input: FlowGenerateInput,
    startImageId: string | undefined,
    endImageId: string | undefined
  ): Promise<Record<string, unknown>> {
    const recaptchaToken = await this.auth.recaptchaToken(account.id, "VIDEO_GENERATION", input.signal);
    const payload = buildFlowVideoPayload({
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      projectId,
      paygateTier: account.tier,
      sessionId: this.sessionId(account.id),
      recaptchaToken,
      modelKey: plan.modelKey,
      startImageId,
      endImageId,
    });
    const response = await this.postJson(
      browserSession,
      `${FLOW_API_ORIGIN}/v1/video:${plan.apiPath}`,
      accessToken,
      payload,
      input.signal,
      `запуск видео (${plan.modelKey})`,
      { before: () => input.onBeforeSubmit?.(account.id), rejected: input.onSubmitRejected }
    );
    const media = findFlowMedia(response);
    if (!media) {
      throw new FlowSubmissionUncertainError("Flow не вернул ID созданного видео");
    }
    return media;
  }

  private async uploadImage(
    browserSession: Session,
    accessToken: string,
    projectId: string,
    image: Buffer,
    tool: FlowToolName = "PINHOLE",
    signal?: AbortSignal
  ): Promise<string> {
    if (image.length === 0) throw new Error("Flow получил пустое изображение");
    const mimeType = flowImageMimeType(image);
    if (!mimeType) {
      throw new Error("Flow получил неподдерживаемый кадр. Разрешены настоящий PNG, JPEG или WebP.");
    }
    const cacheKey = `${projectId}:${createHash("sha256").update(image).digest("hex")}`;
    const cached = this.uploadedImages.get(cacheKey);
    if (cached) return cached;
    const active = this.uploadPromises.get(cacheKey);
    if (active) return active;

    const upload = (async () => {
      const response = await this.postJson(
        browserSession,
        `${FLOW_API_ORIGIN}/v1/flow/uploadImage`,
        accessToken,
        {
          clientContext: {
            projectId,
            tool,
          },
          imageBytes: image.toString("base64"),
          isUserUploaded: true,
          isHidden: false,
          mimeType,
          fileName: flowImageFileName(mimeType),
        },
        signal,
        "загрузка кадра"
      );
      const uploadedMedia = findFlowMedia(response);
      const imageServerId = typeof uploadedMedia?.name === "string"
        ? uploadedMedia.name
        : findFlowString(response, ["name"]);
      if (!imageServerId) {
        throw new Error(`Flow не вернул mediaId загруженного кадра: ${flowApiErrorMessage(response)}`);
      }
      this.uploadedImages.set(cacheKey, imageServerId);
      return imageServerId;
    })();
    this.uploadPromises.set(cacheKey, upload);
    try {
      return await upload;
    } finally {
      this.uploadPromises.delete(cacheKey);
    }
  }

  private async pollVideo(
    browserSession: Session,
    accountId: string,
    initialAccessToken: string,
    projectId: string,
    initialMedia: Record<string, unknown>,
    input: FlowGenerateInput,
    remoteJob: FlowRemoteVideoJob
  ): Promise<Record<string, unknown>> {
    const name = typeof initialMedia.name === "string" ? initialMedia.name : undefined;
    if (!name) throw new Error("Flow не вернул имя задания генерации");
    let media = initialMedia;
    let accessToken = initialAccessToken;
    const deadline = Date.now() + 20 * 60_000;
    const startedAt = Date.parse(remoteJob.submittedAt) || Date.now();
    while (Date.now() < deadline) {
      this.throwIfAborted(input.signal);
      const status = flowMediaStatus(media);
      if (status === "MEDIA_GENERATION_STATUS_SUCCESSFUL") {
        await this.reportVideoProgress(input, 94, "Flow: генерация завершена, проверяю файл", remoteJob);
        return media;
      }
      if (
        status === "MEDIA_GENERATION_STATUS_FAILED"
        || status === "MEDIA_GENERATION_STATUS_CANCELED"
        || status === "MEDIA_GENERATION_STATUS_CANCELLED"
      ) {
        throw new Error(`Flow завершил видео с ошибкой: ${flowApiErrorMessage(media)}`);
      }
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const apiProgress = findFlowNumber(media, [
        "progressPercent",
        "mediaGenerationProgress",
        "percentComplete",
        "progress",
      ]);
      const normalizedApiProgress = apiProgress === undefined
        ? undefined
        : Math.max(0, Math.min(100, apiProgress <= 1 ? apiProgress * 100 : apiProgress));
      const percent = normalizedApiProgress === undefined
        ? Math.min(92, 28 + Math.round((elapsedMs / 120_000) * 64))
        : Math.min(92, 28 + Math.round(normalizedApiProgress * 0.64));
      const remainingSeconds = normalizedApiProgress !== undefined && normalizedApiProgress > 2
        ? Math.max(1, Math.round((elapsedMs / normalizedApiProgress) * (100 - normalizedApiProgress) / 1_000))
        : Math.max(1, Math.round((120_000 - Math.min(120_000, elapsedMs)) / 1_000));
      await this.reportVideoProgress(
        input,
        percent,
        `Flow: ${this.modelLabel(remoteJob.modelKey)} — ${percent}% · осталось примерно ${remainingSeconds} сек.`,
        remoteJob
      );
      await this.delay(5_000, input.signal);
      try {
        const response = await this.postJson(
          browserSession,
          `${FLOW_API_ORIGIN}/v1/video:batchCheckAsyncVideoGenerationStatus`,
          accessToken,
          { media: [{ name, projectId }] },
          input.signal,
          "проверка статуса видео"
        );
        media = findFlowMedia(response, name) ?? media;
      } catch (error) {
        if (error instanceof FlowHttpError && error.status === 401) {
          await this.auth.refresh(accountId);
          const refreshedToken = (await this.store.secret(accountId)).accessToken;
          if (!refreshedToken) throw error;
          accessToken = refreshedToken;
          continue;
        }
        if (error instanceof FlowHttpError && (error.status === 429 || error.status >= 500)) {
          await this.delay(
            error.status === 429
              ? flowRetryAfterMs(error.message, 15_000)
              : 10_000,
            input.signal
          );
          continue;
        }
        if (error instanceof TypeError) {
          await this.delay(10_000, input.signal);
          continue;
        }
        throw error;
      }
    }
    throw new Error("Flow не завершил генерацию видео за 20 минут");
  }

  private async downloadVideo(
    browserSession: Session,
    accountId: string,
    media: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Buffer> {
    const name = typeof media.name === "string" ? media.name : undefined;
    if (!name) throw new Error("Flow не вернул media name для скачивания");
    const { bytes, contentType } = await this.downloadMediaBytes(
      browserSession,
      accountId,
      name,
      "video/*,application/octet-stream;q=0.9,*/*;q=0.8",
      "видео",
      signal
    );
    if (bytes.length < 1_024) {
      const body = bytes.toString("utf8");
      throw new Error(`Flow вернул некорректный видеофайл (${bytes.length} байт): ${body.slice(0, 300)}`);
    }
    const looksLikeHtml = /^\s*</.test(bytes.subarray(0, 100).toString("utf8"));
    const looksLikeMp4 = bytes.subarray(4, 8).toString("ascii") === "ftyp";
    const looksLikeWebm = bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (looksLikeHtml || (!contentType.startsWith("video/") && !looksLikeMp4 && !looksLikeWebm)) {
      throw new Error(`Flow вместо видео вернул ${contentType || "неизвестный формат"}`);
    }
    return bytes;
  }

  private async downloadImage(
    browserSession: Session,
    accountId: string,
    media: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Buffer> {
    const name = typeof media.name === "string" ? media.name : undefined;
    const generated = (media.image as { generatedImage?: { encodedImage?: string; fifeUrl?: string } } | undefined)?.generatedImage;
    if (generated?.encodedImage) {
      const bytes = Buffer.from(generated.encodedImage.replace(/^data:image\/[^;]+;base64,/, ""), "base64");
      if (bytes.length < 32 || !flowImageMimeType(bytes)) throw new FlowSubmissionUncertainError("проверка встроенного изображения");
      return bytes;
    }
    if (generated?.fifeUrl && new URL(generated.fifeUrl).protocol === "https:") {
      try {
        return await runFlowStep("скачивание готового изображения", 120_000, signal, async (requestSignal) => {
          const response = await browserSession.fetch(generated.fifeUrl!, {
            method: "GET", credentials: "omit", signal: requestSignal, headers: { Accept: "image/*" },
          });
          if (!response.ok) throw new Error(`Flow: скачивание изображения HTTP ${response.status}`);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length < 32 || !flowImageMimeType(bytes)) throw new Error("Flow вернул некорректное изображение");
          return bytes;
        });
      } catch (error) { if (signal?.aborted || !name) throw error; }
    }
    if (!name) throw new FlowSubmissionUncertainError("получение ссылки на созданное изображение");
    const { bytes, contentType } = await this.downloadMediaBytes(
      browserSession,
      accountId,
      name,
      "image/*,application/octet-stream;q=0.9,*/*;q=0.8",
      "изображение",
      signal
    );
    const looksLikeHtml = /^\s*</.test(bytes.subarray(0, 100).toString("utf8"));
    const looksLikePng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const looksLikeJpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const looksLikeWebp = bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (
      bytes.length < 32
      || looksLikeHtml
      || (!looksLikePng && !looksLikeJpeg && !looksLikeWebp)
    ) {
      throw new Error(`Flow вместо изображения вернул ${contentType || "неизвестный формат"} (${bytes.length} байт)`);
    }
    return bytes;
  }

  /**
   * Flow не отдаёт файл прямо: сначала возвращает redirect на временную
   * подписанную ссылку Google Storage. Electron иногда падает с net::ERR_FAILED,
   * если пройти оба адреса одним fetch. Поэтому redirect и файл скачиваются
   * двумя отдельными запросами, как это делает web-клиент Flow.
   */
  private async downloadMediaBytes(
    browserSession: Session,
    accountId: string,
    name: string,
    accept: string,
    kind: "видео" | "изображение",
    signal?: AbortSignal
  ): Promise<{ bytes: Buffer; contentType: string }> {
    return runFlowStep(`скачивание ${kind}`, 120_000, signal, (requestSignal) =>
      this.downloadMediaBytesOnce(browserSession, accountId, name, accept, kind, requestSignal)
    );
  }

  private async downloadMediaBytesOnce(
    browserSession: Session,
    accountId: string,
    name: string,
    accept: string,
    kind: "видео" | "изображение",
    signal: AbortSignal
  ): Promise<{ bytes: Buffer; contentType: string }> {
    const redirectUrl = flowMediaDownloadUrl(name);
    const requestRedirect = async (): Promise<Response> => {
      const accessToken = (await this.store.secret(accountId)).accessToken;
      const init: RequestInit = {
        method: "GET",
        credentials: "include",
        redirect: "manual",
        cache: "no-store",
        signal,
        headers: {
          Accept: accept,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          Origin: FLOW_ORIGIN,
          Referer: FLOW_TOOL_URL,
        },
      };
      // Only a test transport may be injected. Production uses Electron net with
      // this account's Session, so Bearer/cookies never bypass its configured proxy.
      return this.redirectFetch
        ? this.redirectFetch(redirectUrl, init)
        : this.auth.requestMediaRedirect(accountId, browserSession, redirectUrl, init, signal);
    };

    let response = await requestRedirect();
    if (response.status === 401 || response.status === 403) {
      await this.auth.refresh(accountId);
      response = await requestRedirect();
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`Flow не вернул временную ссылку для скачивания ${kind}`);
      }
      const signedUrl = new URL(location, redirectUrl).toString();
      if (new URL(signedUrl).protocol !== "https:") throw new Error("Flow вернул небезопасную ссылку для скачивания");
      const signedRequest: RequestInit = {
        method: "GET",
        credentials: "omit",
        redirect: "follow",
        cache: "no-store",
        signal,
        headers: { Accept: accept },
      };
      // Never fall back to Node/global fetch: that silently bypasses Flow's proxy.
      response = await browserSession.fetch(signedUrl, signedRequest);
    }
    if (!response.ok) {
      throw new Error(`Flow не отдал готовое ${kind}: HTTP ${response.status}`);
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type")?.toLowerCase() ?? "",
    };
  }

  private async ensureProject(
    account: FlowAccountPublic,
    browserSession: Session,
    tool: FlowToolName,
    signal?: AbortSignal
  ): Promise<FlowProjectLease> {
    const cacheKey = `${account.id}:${tool}`;
    const existing = this.projects.get(cacheKey);
    if (existing && existing.uses < 50) return existing;
    const active = this.projectPromises.get(cacheKey);
    if (active) return active;
    const promise = this.createProject(account, browserSession, tool, signal)
      .finally(() => this.projectPromises.delete(cacheKey));
    this.projectPromises.set(cacheKey, promise);
    return promise;
  }

  private async createProject(
    account: FlowAccountPublic,
    browserSession: Session,
    tool: FlowToolName,
    signal?: AbortSignal
  ): Promise<FlowProjectLease> {
    const { response, data } = await runFlowStep("создание проекта", 45_000, signal, async (requestSignal) => {
      const response = await browserSession.fetch(FLOW_PROJECT_CREATE_URL, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      signal: requestSignal,
      headers: {
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
        Origin: FLOW_ORIGIN,
        Referer: FLOW_TOOL_URL,
      },
      body: JSON.stringify(flowTrpcInput({
        projectTitle: `Gold Work Studio ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
        // В текущем Flow и tRPC создания проекта, и aisandbox clientContext
        // используют значение PINHOLE. Название продукта FLOW здесь не является enum API.
        toolName: FLOW_PROJECT_TOOL_NAME,
      })),
      });
      return { response, data: await this.readResponse(response) };
    });
    if (!response.ok) {
      throw new FlowHttpError(`Flow не создал проект: HTTP ${response.status}: ${flowApiErrorMessage(data)}`, {
        status: response.status,
        body: data,
        retryAfter: response.headers.get("retry-after"),
      });
    }
    const envelope = data as { result?: { data?: { json?: { id?: unknown } } } };
    const responseId = envelope?.result?.data?.json?.id;
    const projectId = findFlowString(data, ["projectId"])
      ?? (typeof responseId === "string" && responseId.trim() ? responseId : undefined);
    if (!projectId) throw new Error(`Flow не вернул projectId: ${flowApiErrorMessage(data)}`);
    const lease = { projectId, uses: 0 };
    this.projects.set(`${account.id}:${tool}`, lease);
    return lease;
  }

  private async prepareUploadImage(image: Buffer, aspectRatio: AspectRatio): Promise<Buffer> {
    if (flowImageMimeType(image)) return image;
    const converted = await normalizeImageAspect(image, aspectRatio);
    if (!flowImageMimeType(converted)) {
      throw new Error(
        "Стартовый кадр Flow имеет неподдерживаемый формат и не преобразовался в PNG. "
        + "Выберите настоящий генератор изображений вместо Mock Image и повторите сцену."
      );
    }
    return converted;
  }

  private async postJson(
    browserSession: Session,
    url: string,
    accessToken: string,
    body: unknown,
    signal?: AbortSignal,
    stage = "API-запрос",
    checkpoint?: { before: () => Promise<void> | undefined; rejected?: () => Promise<void> }
  ): Promise<unknown> {
    this.throwIfAborted(signal);
    let response: Response;
    let data: unknown;
    const isSubmission = /\/flowMedia:batchGenerateImages|\/video:batchAsyncGenerate/.test(url);
    // Persist before sending, not after an order was already accepted. Failure
    // here must not submit anything or be described as a lost provider response.
    if (isSubmission) {
      await checkpoint?.before();
      if (signal?.aborted) { await checkpoint?.rejected?.(); throw flowAbortError(); }
    }
    try {
      const result = await runFlowStep(stage, isSubmission ? 180_000 : 45_000, signal, async (requestSignal) => {
        const response = await browserSession.fetch(url, {
        method: "POST",
        cache: "no-store",
        signal: requestSignal,
        headers: {
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          Origin: FLOW_ORIGIN,
          Referer: `${FLOW_ORIGIN}/`,
        },
        body: JSON.stringify(body),
        });
        return { response, data: await this.readResponse(response) };
      });
      response = result.response;
      data = result.data;
    } catch (error) {
      // Even cancellation after sending POST cannot prove the server cancelled it.
      if (isSubmission) throw new FlowSubmissionUncertainError(stage);
      if (signal?.aborted) throw flowAbortError();
      const cause = (error as { cause?: { code?: string; errno?: string | number } })?.cause;
      const diagnostics = [
        error instanceof Error ? error.name : undefined,
        cause?.code,
        cause?.errno === undefined ? undefined : String(cause.errno)
      ].filter((item, index, items): item is string => Boolean(item) && items.indexOf(item) === index).join("/");
      throw new Error(
        `Flow: ${stage}: соединение временно оборвалось${diagnostics ? ` (${diagnostics})` : ""}. `
        + "Очередь автоматически повторит запрос; если сбой повторяется, проверьте интернет/VPN или прокси Flow."
      );
    }
    if (!response.ok) {
      if (isSubmission) {
        if ([400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(response.status)) {
          await checkpoint?.rejected?.();
        } else {
          throw new FlowSubmissionUncertainError(`${stage}: HTTP ${response.status}`);
        }
      }
      const message = flowApiErrorMessage(data);
      const noRetry = response.status === 400 || response.status === 401 ? NO_RETRY_MARKER : "";
      throw new FlowHttpError(`${noRetry}Flow: ${stage}: HTTP ${response.status}: ${message}`, {
        status: response.status,
        body: data,
        retryAfter: response.headers.get("retry-after"),
        stage,
      });
    }
    return data;
  }

  private async readResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private shouldRotateAccount(error: unknown): boolean {
    if (!(error instanceof FlowHttpError)) return false;
    if (error.status === 401 || error.status === 429) return true;
    return error.status === 403 && /quota|resource.exhausted|credit|rate/i.test(error.message);
  }

  private async cooldown(account: FlowAccountPublic, error: unknown): Promise<void> {
    const httpError = error instanceof FlowHttpError ? error : undefined;
    if (httpError?.status === 401) return;
    const responseRetryMs = httpError?.retryAfter && /^\d+(?:\.\d+)?$/.test(httpError.retryAfter)
      ? Math.ceil(Number(httpError.retryAfter) * 1_000)
      : undefined;
    const daily = /daily|quota exhausted|resource.exhausted/i.test(httpError?.message ?? "");
    const waitMs = responseRetryMs
      ?? flowRetryAfterMs(httpError?.message ?? "", daily ? 24 * 60 * 60_000 : 10 * 60_000);
    await this.store.updateSession(account.id, {
      status: "ready",
      cooldownUntil: new Date(Date.now() + waitMs).toISOString(),
      lastError: httpError?.message,
    });
  }

  private sessionId(accountId: string): string {
    const existing = this.sessionIds.get(accountId);
    if (existing) return existing;
    const created = randomUUID();
    this.sessionIds.set(accountId, created);
    return created;
  }

  private async reportVideoProgress(
    input: FlowGenerateInput,
    percent: number,
    stage: string,
    remoteJob?: FlowRemoteVideoJob
  ): Promise<void> {
    await input.onProgress?.({
      percent: Math.max(0, Math.min(99, Math.round(percent))),
      stage,
      remoteJob,
    });
  }

  private modelLabel(modelKey: string): string {
    if (/12STEP/i.test(modelKey)) return "Veo 3.1 Quality";
    if (/lite/i.test(modelKey)) return "Veo 3.1 Lite";
    if (/veo_3_1/i.test(modelKey)) return "Veo 3.1 Fast";
    return modelKey;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw flowAbortError();
  }

  private async rejectUnusualActivity(account: FlowAccountPublic, error: unknown): Promise<void> {
    if (!(error instanceof FlowHttpError) || ![400, 403].includes(error.status)
      || !/recaptcha.*(?:evaluation failed|failed)|PUBLIC_ERROR_UNUSUAL_ACTIVITY/iu.test(error.message)) return;
    const reason = "Google Flow отклонил проверку активности (reCAPTCHA / unusual activity). "
      + "Автоматические попытки для этого аккаунта остановлены. Откройте Flow в аккаунте, проверьте уведомления Google "
      + "и затем повторите проверку аккаунта. Готовые изображения и сохранённые ID заданий не потеряны.";
    await this.store.updateSession(account.id, {status: "needs_user_action", lastError: reason});
    throw new FlowUserActionError(reason);
  }

  private async invalidateSession(account: FlowAccountPublic): Promise<void> {
    await this.store.updateSession(account.id, {
      status: "needs_login",
      accessToken: "",
      lastError: "Google отклонил Flow-сессию после обновления. Выполните повторный вход в этот аккаунт.",
    });
  }

  private async assertUsableAccount(accountId: string, signal?: AbortSignal, kind: "image" | "video" = "video"): Promise<void> {
    this.throwIfAborted(signal);
    const account = (await this.store.list()).find((item) => item.id === accountId);
    if (!account?.enabled || (kind === "video" && !account.videoEnabled) || account.status !== "ready"
      || (account.cooldownUntil && Date.parse(account.cooldownUntil) > Date.now())) {
      throw new Error(`${NO_RETRY_MARKER}Flow-аккаунт стал недоступен; проверьте вход и ограничения перед повтором`);
    }
  }

  private async assertGenerationProtocol(accountId: string): Promise<void> {
    if ((await this.store.secret(accountId)).sessionOrigin === "https://flow.google.com") {
      throw new Error(`${NO_RETRY_MARKER}Вход в новый Flow подтверждён, но автоматическая генерация через новый Google RPC ещё не поддерживается этой версией приложения. Повторный вход и смена прокси это не исправят. Задания и готовые материалы сохранены.`);
    }
  }

  private async resumeAccount(accountId: string): Promise<FlowAccountPublic> {
    const account = (await this.store.list()).find((item) => item.id === accountId);
    if (!account?.enabled || account.status === "needs_login") {
      throw new Error(`${NO_RETRY_MARKER}Для скачивания готового задания включите исходный Flow-аккаунт и проверьте вход`);
    }
    // Credit/rate cooldown and video-generation toggle do not block an already paid download.
    return account;
  }

  private async delay(ms: number, signal?: AbortSignal): Promise<void> {
    this.throwIfAborted(signal);
    await runFlowStep("ожидание", 0, signal, (waitSignal) => new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(flowAbortError()); };
      const timer = setTimeout(() => { waitSignal.removeEventListener("abort", onAbort); resolve(); }, ms);
      waitSignal.addEventListener("abort", onAbort, { once: true });
    }));
  }
}
