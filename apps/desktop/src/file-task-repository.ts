import { readFile } from "node:fs/promises";
import type { TaskRepository } from "@gold-work/core";
import type { QueueTask, TaskKind, TaskStatus } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";

const taskKinds = new Set<TaskKind>(["director", "image", "video", "speech", "assemble"]);
const taskStatuses = new Set<TaskStatus>(["pending", "running", "retry_wait", "paused", "blocked", "done", "failed", "cancelled"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isId);
}

function isQueueTask(value: unknown): value is QueueTask {
  if (!isRecord(value) || !isId(value.id) || !isId(value.projectId)
    || !taskKinds.has(value.kind as TaskKind) || !taskStatuses.has(value.status as TaskStatus)
    || !Number.isFinite(value.attempts) || !Number.isFinite(value.progress)) return false;

  // Older queues lack fields that load() reconstructs. Keep additional data intact.
  if ([value.runId, value.label, value.createdAt, value.updatedAt].some(field => field != null && typeof field !== "string")
    || (value.maxAttempts != null && !Number.isFinite(value.maxAttempts))
    || (value.dependsOn != null && !isStringList(value.dependsOn))
    || (value.sceneId !== undefined && !isId(value.sceneId))
    || (value.narrationSceneIds !== undefined && (value.kind !== "speech" || !isStringList(value.narrationSceneIds) || !value.narrationSceneIds.length))
    || (value.pausedFrom !== undefined && value.pausedFrom !== "pending" && value.pausedFrom !== "running" && value.pausedFrom !== "retry_wait")
    || (value.retryBlockedReason !== undefined && typeof value.retryBlockedReason !== "string")
    || (value.submissionTrackingVersion !== undefined && value.submissionTrackingVersion !== 1 && value.submissionTrackingVersion !== 2)) return false;

  const pending = value.pendingSubmission;
  if (pending !== undefined) {
    if (!isRecord(pending) || pending.kind !== value.kind || !isId(pending.startedAt)
      || (pending.accountId !== undefined && !isId(pending.accountId))) return false;
    const mediaKind = pending.kind === "image" || pending.kind === "video" || pending.kind === "speech";
    if (pending.provider === "flow" ? pending.kind !== "image" && pending.kind !== "video"
      : pending.provider === "lumean" ? pending.kind !== "speech"
      : pending.provider === "veo" ? pending.kind !== "video"
      : (pending.provider !== "anymodel" && pending.provider !== "legacy-media") || !mediaKind) return false;
  }

  const job = value.remoteJob;
  if (job !== undefined && (!isRecord(job) || job.provider !== "flow"
    || (value.kind === "video" ? job.kind !== undefined && job.kind !== "video" : value.kind !== "image" || job.kind !== "image")
    || !isId(job.accountId) || !isId(job.projectId) || !isId(job.mediaName)
    || typeof job.modelKey !== "string" || typeof job.submittedAt !== "string"
    || (job.workflowId !== undefined && typeof job.workflowId !== "string"))) return false;

  const order = value.lumeanOrder;
  if (order !== undefined && (!isRecord(order) || value.kind !== "speech" || !isId(order.orderId) || !isId(order.inputFingerprint))) return false;

  const video = value.providerVideoJob;
  if (video !== undefined && (!isRecord(video) || value.kind !== "video" || job !== undefined
    || (video.provider === "veo" ? !isId(video.operationName)
      : video.provider !== "anymodel" || !isId(video.jobId) || !isId(video.connectionId)))) return false;
  return pending === undefined || value.status !== "done";
}

function isQueue(value: unknown): value is QueueTask[] {
  return Array.isArray(value) && value.every(isQueueTask) && new Set(value.map(task => task.id)).size === value.length;
}

export class FileTaskRepository implements TaskRepository {
  private corruption?: Error;

  constructor(private readonly filePath: string) {}

  async list(): Promise<QueueTask[]> {
    if (this.corruption) throw this.corruption;
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    try {
      const parsed = JSON.parse(content) as unknown;
      if (isQueue(parsed)) return parsed;
    } catch {
      // Do not include parser output. It can contain fragments of saved data.
    }
    this.corruption = new Error(`Файл очереди повреждён или имеет неизвестный формат. Исходный файл сохранён, запись очереди остановлена. Восстановите проверенную копию с данными незавершённых заказов и перезапустите студию.\n${this.filePath}`);
    throw this.corruption;
  }

  async replace(tasks: QueueTask[]): Promise<void> {
    // Even after a successful load, refuse to overwrite a newly damaged file.
    await this.list();
    if (!isQueue(tasks)) {
      throw new Error("Обновлённая очередь содержит некорректные записи. Предыдущая очередь сохранена.");
    }
    await atomicWrite(this.filePath, JSON.stringify(tasks, null, 2), { allowCopyFallback: false, durable: true });
  }
}
