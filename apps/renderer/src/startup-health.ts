import type { DesktopApi } from "@gold-work/shared";

export type HealthTone = "checking" | "ok" | "warning" | "error" | "off";
export interface HealthItem { id: string; label: string; tone: HealthTone; message: string; elapsedMs?: number }
const labels = { build: "Версия приложения", assembly: "FFmpeg", anymodel: "AnyModel", lumean: "Lumean",
  flow: "Google Flow", google: "Google API · Veo", pexels: "Pexels", pixabay: "Pixabay", youtube: "YouTube" };
type Id = keyof typeof labels;
export const initialHealth = (): HealthItem[] => Object.entries(labels).map(([id, label]) => ({ id, label, tone: "checking", message: "Проверяется…" }));
const cleanMessage = (value: unknown) => (value instanceof Error ? value.message : String(value))
  .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "").slice(0, 700);

/** Only connection/session checks: never image, video, completion or TTS submissions. */
export async function collectStartupHealth(api: DesktopApi, buildId: string, publish: (item: HealthItem) => void, timeoutMs = 35_000, refreshFlow = false): Promise<void> {
  const info = Promise.resolve().then(() => api.getAppInfo());
  const stock = Promise.resolve().then(() => api.getStockSettings());
  const check = async (id: Id, work: () => Promise<{ tone: HealthTone; message: string }>) => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([Promise.resolve().then(work), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Нет результата проверки за ${timeoutMs / 1000} с. Запрос может ещё выполняться; проверьте VPN/прокси.`)), timeoutMs);
      })]);
      publish({ id, label: labels[id], ...result, elapsedMs: Date.now() - started });
    } catch (error) { publish({ id, label: labels[id], tone: "error", message: cleanMessage(error), elapsedMs: Date.now() - started }); }
    finally { clearTimeout(timer); }
  };
  const connection = async (settings: () => Promise<{ configured: boolean }>, test: () => Promise<{ ok: boolean; message: string }>) => {
    if (!(await settings()).configured) return { tone: "off" as const, message: "Не подключён — необязательно" };
    const result = await test();
    return { tone: result.ok ? "ok" as const : "error" as const, message: result.message };
  };
  await Promise.all([
    check("build", async () => { const v = await info; return v.buildId === buildId
      ? { tone: "ok", message: `Main и интерфейс совпадают · ${v.buildId}` }
      : { tone: "error", message: `Версии не совпадают: main ${v.buildId}; интерфейс ${buildId}. Полностью перезапустите приложение.` }; }),
    check("assembly", async () => ({ tone: (await info).ffmpegAvailable ? "ok" : "error", message: (await info).ffmpegAvailable ? "Локальная сборка доступна" : "FFmpeg не найден: сборка видео недоступна" })),
    check("anymodel", () => connection(() => api.getAnyModelSettings(), () => api.testAnyModelConnection())),
    check("lumean", () => connection(() => api.getVoicerSettings(), () => api.testVoicerConnection())),
    check("google", () => connection(() => api.getGoogleSettings(), () => api.testGoogleConnection())),
    check("youtube", () => connection(() => api.getYouTubeSettings(), () => api.testYouTubeConnection())),
    ...(["pexels", "pixabay"] as const).map(provider => check(provider, () => connection(
      async () => ({ configured: (await stock)[provider === "pexels" ? "pexelsConfigured" : "pixabayConfigured"] }), () => api.testStockConnection(provider)))),
    check("flow", async () => {
      const active = (await api.listFlowAccounts()).filter(a => a.enabled);
      if (!active.length) return { tone: "off", message: "Нет активных аккаунтов" };
      if (!refreshFlow) return {tone:'off',message:`Сохранено аккаунтов: ${active.length}. Проверка сессий — по кнопке «Повторить» или при работе с Flow.`};
      const accounts = (await api.refreshAllFlowAccounts()).filter(a => a.enabled);
      const ready = accounts.filter(a => a.status === "ready").length;
      const problem = accounts.find(a => a.status !== "ready")?.lastError;
      return { tone: ready === active.length ? "ok" : ready ? "warning" : "error",
        message: `Сессии доступны: ${ready}/${active.length}. ${problem || "Генерация и её квоты здесь не проверяются."}` };
    }),
  ]);
}

// One run per renderer/API, including React StrictMode remounts; progress survives hiding.
export function createHealthMonitor(api: DesktopApi, buildId: string) {
  let items = initialHealth(), running: Promise<void> | undefined;
  const listeners = new Set<(items: HealthItem[]) => void>();
  const publish = () => listeners.forEach(listener => listener(items));
  return {
    subscribe(listener: (items: HealthItem[]) => void) { listeners.add(listener); listener(items); return () => { listeners.delete(listener); }; },
    run(refresh = false) {
      if (running) return running;
      if (!refresh && items.every(i => i.tone !== "checking")) return Promise.resolve();
      items = initialHealth(); publish();
      running = collectStartupHealth(api, buildId, item => {
        items = items.map(i => i.id === item.id ? item : i); publish();
        void api.writeLog(item.tone === "error" ? "error" : item.tone === "warning" ? "warn" : "info", "startup.health.check", {
          service: item.id, status: item.tone, elapsedMs: item.elapsedMs, message: item.message,
          ...(item.tone === "error" || item.tone === "warning" ? { error: item.message } : {}),
        }).catch(() => undefined);
      },35_000,refresh).finally(() => { running = undefined; });
      return running;
    },
  };
}
const monitors = new WeakMap<DesktopApi, ReturnType<typeof createHealthMonitor>>();
export function startupHealthMonitor(api: DesktopApi, buildId: string) {
  let monitor = monitors.get(api);
  if (!monitor) { monitor = createHealthMonitor(api, buildId); monitors.set(api, monitor); }
  return monitor;
}
