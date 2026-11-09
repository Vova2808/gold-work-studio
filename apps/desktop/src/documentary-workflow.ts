import { stat } from 'node:fs/promises';
import type { ProjectService } from '@gold-work/core';
import { documentaryMaterialUsable, projectEditorReady, type Project, type QueueTask, type StockProductionRun } from '@gold-work/shared';
import { hasPreparedDocumentaryNarration, usesContinuousDocumentaryNarration } from './documentary-narration.js';

type Projects = Pick<ProjectService, 'get' | 'mutate' | 'list'>;
export const isDocumentaryWorkflow = (project: Project) => project.mediaMode === 'stock' && project.settings.assembly.documentary?.version === 2;

export async function saveDocumentaryWorkflow(projects: Pick<Projects, 'mutate'>, projectId: string, run: StockProductionRun) {
  return projects.mutate(projectId, () => ({ stockProduction: run }));
}

/** Bind both automatic and editor exports to the current queue attempt. */
export async function startDocumentaryWorkflowExport(projectId: string, projects: Pick<Projects, 'mutate'>,
  startExport: () => Promise<QueueTask[]>, signal?: AbortSignal): Promise<QueueTask[]> {
  const save = (status: StockProductionRun['status'], message: string, assemblyTaskId?: string) =>
    saveDocumentaryWorkflow(projects, projectId, { phase: 'export', status, message, assemblyTaskId, updatedAt: new Date().toISOString() });
  await save('running', 'Монтаж подготовлен. Запускаю экспорт Final.mp4');
  try {
    signal?.throwIfAborted();
    const tasks = await startExport();
    const assembly = tasks.find(task => task.projectId === projectId && task.kind === 'assemble' && !task.prepareOnly);
    if (!assembly) throw new Error('Очередь не создала задание экспорта. Готовые материалы сохранены.');
    await save('running', 'Собираю и сохраняю Final.mp4', assembly.id);
    return tasks;
  } catch (error) {
    await save(signal?.aborted ? 'stopped' : 'failed', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** A reviewable fallback is editable, but is never automatically exported as approved footage. */
export function assertDocumentaryAutoExport(project: Project): void {
  const scenes = project.scenes.filter(scene => scene.includeInAssembly !== false);
  if (!scenes.length) throw new Error('В проекте нет включённых сцен для экспорта.');
  const unverified = scenes.filter(scene => !scene.documentary?.verified || !documentaryMaterialUsable(scene));
  if (unverified.length) throw new Error(`Автоматический экспорт остановлен: проверьте материалы сцен ${unverified.slice(0, 12).map(scene => `№${scene.order + 1}`).join(', ')}. Готовые кадры и озвучка сохранены; откройте «Видео и фото».`);
}

/** Queue and provider receipts remain the source of truth for paid work. */
export async function runDocumentaryWorkflow(projectId: string, options: {
  projects: Projects;
  signal: AbortSignal;
  prepareScript: () => Promise<unknown>;
  prepareProduction: () => Promise<unknown>;
  startExport: () => Promise<QueueTask[]>;
}): Promise<QueueTask[]> {
  const { projects, signal } = options;
  let phase: StockProductionRun['phase'] = 'script';
  const save = (status: StockProductionRun['status'], message: string, assemblyTaskId?: string) =>
    saveDocumentaryWorkflow(projects, projectId, { phase, status, message, assemblyTaskId, updatedAt: new Date().toISOString() });
  try {
    let project = await projects.get(projectId, { omitCandidates: true });
    if (!project || !isDocumentaryWorkflow(project)) throw new Error('Полный запуск доступен только для Stock Documentary.');
    const resumeExport = project.stockProduction?.phase === 'export' && projectEditorReady(project)
      && (!usesContinuousDocumentaryNarration(project) || await hasPreparedDocumentaryNarration(project));
    signal.throwIfAborted();
    if (!project.scenes.length) {
      await save('running', 'Разбиваю исходный сценарий на сцены и готовлю поисковые запросы');
      await options.prepareScript();
    }
    signal.throwIfAborted();
    if (!resumeExport) {
      phase = 'materials';
      await save('running', 'Готовлю материалы, озвучку и монтаж. Затем автоматически сохраню Final.mp4');
      await options.prepareProduction();
    }
    signal.throwIfAborted();
    project = await projects.get(projectId, { omitCandidates: true });
    if (!project) throw new Error('Проект не найден');
    assertDocumentaryAutoExport(project);
    phase = 'export';
    return await startDocumentaryWorkflowExport(projectId, projects, options.startExport, signal);
  } catch (error) {
    const message = signal.aborted ? 'Производство остановлено. Готовые сцены, материалы и озвучка сохранены.'
      : error instanceof Error ? error.message : String(error);
    await save(signal.aborted ? 'stopped' : 'failed', message);
    throw error;
  }
}

/** Called on startup and queue changes; never submits new remote work. */
export async function reconcileDocumentaryWorkflows(projects: Projects, tasks: QueueTask[], startup = false,
  outputExists = async (path: string) => { try { const file = await stat(path); return file.isFile() && file.size > 0; } catch { return false; } }) {
  for (const project of await projects.list({ omitCandidates: true })) {
    const saved = project.stockProduction;
    if (!isDocumentaryWorkflow(project) || !saved || !['running', 'interrupted'].includes(saved.status)) continue;
    let status = saved.status, message = saved.message, assemblyTaskId = saved.assemblyTaskId;
    if (saved.phase === 'export') {
      const task = tasks.find(task => task.projectId === project.id && task.kind === 'assemble' && !task.prepareOnly
        && (assemblyTaskId ? task.id === assemblyTaskId : task.createdAt >= saved.updatedAt));
      assemblyTaskId = task?.id ?? assemblyTaskId;
      if (task?.status === 'done') {
        const ready = Boolean(task.resultPath && project.status === 'complete' && project.outputPath === task.resultPath && await outputExists(task.resultPath));
        status = ready ? 'complete' : 'failed';
        message = ready ? 'Ролик готов: Final.mp4 сохранён' : 'Очередь завершилась, но готовый MP4 не подтверждён. Повторите экспорт.';
      } else if (task && ['failed', 'blocked'].includes(task.status)) {
        status = 'failed'; message = task.error || 'Экспорт требует внимания. Готовые материалы сохранены.';
      } else if (task?.status === 'cancelled') {
        status = 'stopped'; message = 'Экспорт остановлен. Готовые материалы и озвучка сохранены.';
      } else if (task?.status === 'paused') {
        status = 'interrupted'; message = 'Экспорт на паузе. Нажмите «Продолжить» — сохранённая очередь будет использована снова.';
      } else if (task) {
        status = 'running'; message = 'Собираю и сохраняю Final.mp4';
      } else if (startup) {
        status = 'interrupted'; message = 'Запуск экспорта был прерван. Нажмите «Собрать ролик» для продолжения.';
      }
    } else if (startup) {
      status = 'interrupted'; message = 'Приложение было закрыто во время подготовки. Нажмите «Собрать ролик» для продолжения; готовые файлы и ответы сохранятся.';
    }
    if (status !== saved.status || message !== saved.message || assemblyTaskId !== saved.assemblyTaskId) {
      await projects.mutate(project.id, current => JSON.stringify(current.stockProduction) !== JSON.stringify(saved) ? {} : ({
        stockProduction: { ...saved, status, message, assemblyTaskId, updatedAt: new Date().toISOString() },
        ...(startup && saved.phase !== 'export' && !tasks.some(task => task.projectId === project.id && task.status === 'paused') ? { status: 'draft' as const } : {}) }));
    }
  }
}
