import { useEffect, useMemo, useState, type ReactNode } from "react";
import { StorageUsage } from "./StorageUsage";
import { AppUpdatePanel } from "./AppUpdatePanel";
import {
  Check,
  ChevronRight,
  CircleAlert,
  CircleUserRound,
  FileText,
  FolderOpen,
  HardDrive,
  Image,
  KeyRound,
  LoaderCircle,
  Mic2,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Video,
  X,
  Youtube,
} from "lucide-react";
import { MAX_FLOW_ACCOUNTS } from "@gold-work/shared";
import type {
  AnyModelSettings,
  DesktopApi,
  FlowAccountPublic,
  FlowLoginProgress,
  StockProvider,
  StockSettings,
  VoicerSettings,
  YouTubeSettings,
} from "@gold-work/shared";
import { fallbackApi } from "./fallback-api";

type AppInfo = Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null;
type SettingsTab = "overview" | "anymodel" | "lumean" | "flow" | "stock" | "youtube" | "storage";
type ServiceId = "anymodel" | "lumean" | "flow" | "pexels" | "pixabay" | "youtube";
type FeedbackPhase = "saved" | "checking" | "success" | "error";
type StatusTone = "success" | "configured" | "attention" | "error" | "muted" | "checking";

interface ServiceFeedback {
  phase: FeedbackPhase;
  message: string;
}

interface ServiceSummary {
  id: SettingsTab;
  title: string;
  description: string;
  status: string;
  detail: string;
  tone: StatusTone;
  icon: ReactNode;
}

const SETTINGS_TAB_STORAGE_KEY = "gold-work-studio:settings-tab-v2";
const LAST_SUCCESS_STORAGE_KEY = "gold-work-studio:settings-last-success-v1";

const flowStatusLabels: Record<FlowAccountPublic["status"], string> = {
  connecting: "Подключение",
  ready: "Работает",
  expired: "Сессия истекла",
  needs_login: "Нужен вход",
  needs_user_action: "Нужно действие",
  cooldown: "Лимит",
  disabled: "Отключён",
  error: "Ошибка",
};

const tabDefinitions: Array<{ id: SettingsTab; label: string; icon: ReactNode }> = [
  { id: "overview", label: "Обзор", icon: <Settings size={16} /> },
  { id: "anymodel", label: "AnyModel", icon: <KeyRound size={16} /> },
  { id: "lumean", label: "Lumean", icon: <Mic2 size={16} /> },
  { id: "flow", label: "Google Flow", icon: <Video size={16} /> },
  { id: "stock", label: "Stock", icon: <Image size={16} /> },
  { id: "youtube", label: "YouTube", icon: <Youtube size={16} /> },
  { id: "storage", label: "Хранение", icon: <HardDrive size={16} /> },
];

function restoredSettingsTab(): SettingsTab {
  try {
    const stored = window.sessionStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
    if (tabDefinitions.some((tab) => tab.id === stored)) return stored as SettingsTab;
  } catch {
    // Настройки работают и без sessionStorage.
  }
  return "overview";
}

function readLastSuccess(): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAST_SUCCESS_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function errorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "")
    .replace(/ERR_SOCKS_CONNECTION_FAILED\s*\(-120\)[^\n]*/i, "SOCKS5-прокси не смог установить соединение")
    .trim();
}

function formatDate(value?: string): string {
  if (!value) return "ещё не проверялось";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "время неизвестно" : date.toLocaleString("ru-RU");
}

function statusFromFeedback(
  feedback: ServiceFeedback | undefined,
  configured: boolean,
  persistedState?: StockSettings["providers"][StockProvider]["state"],
): Pick<ServiceSummary, "status" | "tone"> {
  if (feedback?.phase === "checking") return { status: "Проверяется", tone: "checking" };
  if (feedback?.phase === "success") return { status: "Работает", tone: "success" };
  if (feedback?.phase === "error") return { status: "Ошибка", tone: "error" };
  if (persistedState === "working") return { status: "Работает", tone: "success" };
  if (persistedState === "error") return { status: "Ошибка", tone: "error" };
  return configured
    ? { status: "Настроен", tone: "configured" }
    : { status: "Не настроен", tone: "muted" };
}

export function SettingsPage({ appInfo, projects = [] }: { appInfo: AppInfo; projects?: Array<{ id: string; title: string }> }) {
  const api = window.goldWork ?? fallbackApi;
  const [activeTab, setActiveTab] = useState<SettingsTab>(restoredSettingsTab);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<Partial<Record<ServiceId, ServiceFeedback>>>({});
  const [lastSuccess, setLastSuccess] = useState<Record<string, string>>(readLastSuccess);
  const [anyModel, setAnyModel] = useState<AnyModelSettings>({
    configured: false,
    proxyConfigured: false,
    baseUrl: "https://anymodel.org/v1",
    textModel: "cc/claude-opus-5",
    imageModel: "ag/gemini-3.1-flash-image",
    imageRefModel: "gpt-image-2",
    transcriptionModel: "gc/gemini-2.5-flash",
    videoModel: "xai/grok-imagine-video",
    ttsModel: "google-tts",
  });
  const [anyModelKey, setAnyModelKey] = useState("");
  const [anyModelProxy, setAnyModelProxy] = useState("");
  const [voicer, setVoicer] = useState<VoicerSettings>({ configured: false, proxyConfigured: false, baseUrl: "https://api.lumean.app/api/public" });
  const [voicerKey, setVoicerKey] = useState("");
  const [voicerProxy, setVoicerProxy] = useState("");
  const [youtube, setYouTube] = useState<YouTubeSettings>({ configured: false, cookiesFileConfigured: false, workDirConfigured: false });
  const [youtubeKey, setYouTubeKey] = useState("");
  const [youtubeProxy, setYouTubeProxy] = useState("");
  const [stock, setStock] = useState<StockSettings>({
    pexelsConfigured: false,
    pixabayConfigured: false,
    providers: {
      pexels: { provider: "pexels", configured: false, state: "not_configured" },
      pixabay: { provider: "pixabay", configured: false, state: "not_configured" },
    },
  });
  const [pexelsKey, setPexelsKey] = useState("");
  const [pixabayKey, setPixabayKey] = useState("");
  const [pexelsProxy, setPexelsProxy] = useState("");
  const [pixabayProxy, setPixabayProxy] = useState("");
  const [flowAccounts, setFlowAccounts] = useState<FlowAccountPublic[]>([]);
  const [flowLabel, setFlowLabel] = useState("");
  const [flowProxy, setFlowProxy] = useState("");
  const [flowCookies, setFlowCookies] = useState("");
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowProgress, setFlowProgress] = useState<FlowLoginProgress | null>(null);
  const [flowOperation, setFlowOperation] = useState<{ accountId: string; kind: "open" | "refresh" | "test" } | null>(null);
  const [flowAccountFeedback, setFlowAccountFeedback] = useState<Record<string, ServiceFeedback>>({});
  const [accountProxy, setAccountProxy] = useState<Record<string, string>>({});
  const flowAccountLimitReached = flowAccounts.length >= MAX_FLOW_ACCOUNTS;
  const [storage, setStorage] = useState<Awaited<ReturnType<DesktopApi["getWorkspaceStorage"]>> | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageError, setStorageError] = useState("");
  const changeStorage = async (cancel = false) => {
    setStorageBusy(true); setStorageError("");
    try {
      const folder = cancel ? undefined : await api.pickDirectory();
      if (!cancel && !folder) return;
      setStorage(await api.scheduleWorkspaceMove(folder));
    } catch (reason) { setStorageError(errorMessage(reason)); }
    finally { setStorageBusy(false); }
  };

  useEffect(() => {
    try {
      window.sessionStorage.setItem(SETTINGS_TAB_STORAGE_KEY, activeTab);
    } catch {
      // Настройки работают и без sessionStorage.
    }
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;
    const reportLoadError = (service: string, reason: unknown) => {
      if (!cancelled) setLoadError((current) => [current, `${service}: ${errorMessage(reason)}`].filter(Boolean).join(" · "));
    };
    void Promise.all([
      api.getAnyModelSettings().then((value) => { if (!cancelled) setAnyModel(value); }).catch((reason) => reportLoadError("AnyModel", reason)),
      api.getVoicerSettings().then((value) => { if (!cancelled) setVoicer(value); }).catch((reason) => reportLoadError("Lumean", reason)),
      api.getStockSettings().then((value) => { if (!cancelled) setStock(value); }).catch((reason) => reportLoadError("Stock", reason)),
      api.getYouTubeSettings().then((value) => { if (!cancelled) setYouTube(value); }).catch((reason) => reportLoadError("YouTube", reason)),
      api.listFlowAccounts().then((value) => { if (!cancelled) setFlowAccounts(value); }).catch((reason) => reportLoadError("Google Flow", reason)),
      api.getWorkspaceStorage().then((value) => { if (!cancelled) setStorage(value); }).catch((reason) => reportLoadError("Хранение", reason)),
    ]).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const stopAccounts = api.onFlowAccountsChanged(setFlowAccounts);
    const stopProgress = api.onFlowLoginProgress(setFlowProgress);
    return () => {
      stopAccounts();
      stopProgress();
    };
  }, []);

  const rememberSuccess = (serviceId: string) => {
    const checkedAt = new Date().toISOString();
    setLastSuccess((current) => {
      const next = { ...current, [serviceId]: checkedAt };
      try {
        window.localStorage.setItem(LAST_SUCCESS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Время проверки необязательно для работы подключения.
      }
      return next;
    });
  };

  const forgetSuccess = (serviceId: string) => {
    setLastSuccess((current) => {
      const next = { ...current };
      delete next[serviceId];
      try {
        window.localStorage.setItem(LAST_SUCCESS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Время проверки необязательно для работы подключения.
      }
      return next;
    });
  };

  const setServiceFeedback = (service: ServiceId, next: ServiceFeedback | undefined) => {
    setFeedback((current) => ({ ...current, [service]: next }));
  };

  const runCheck = async (service: ServiceId, check: () => Promise<{ ok: boolean; message: string }>) => {
    setServiceFeedback(service, { phase: "checking", message: "Проверяю соединение…" });
    try {
      const result = await check();
      setServiceFeedback(service, { phase: result.ok ? "success" : "error", message: result.message });
      if (result.ok) rememberSuccess(service);
    } catch (reason) {
      setServiceFeedback(service, { phase: "error", message: errorMessage(reason) });
    }
  };

  const runSave = async (service: ServiceId, save: () => Promise<void>, message: string) => {
    setServiceFeedback(service, { phase: "checking", message: "Сохраняю настройки…" });
    try {
      await save();
      setServiceFeedback(service, { phase: "saved", message });
    } catch (reason) {
      setServiceFeedback(service, { phase: "error", message: errorMessage(reason) });
    }
  };

  const connectFlow = async () => {
    if (flowAccountLimitReached) {
      setServiceFeedback("flow", { phase: "error", message: `Можно подключить не больше ${MAX_FLOW_ACCOUNTS} Flow-аккаунтов. Удалите ненужный аккаунт, чтобы добавить новый.` });
      return;
    }
    setFlowBusy(true);
    setServiceFeedback("flow", { phase: "checking", message: "Открываю окно входа Google…" });
    try {
      const account = await api.loginFlowAccount({ label: flowLabel || undefined, proxyUrl: flowProxy || undefined });
      setFlowAccounts(await api.listFlowAccounts());
      setFlowLabel("");
      setFlowProxy("");
      setServiceFeedback("flow", { phase: "success", message: `Подключён ${account.email ?? account.label ?? "Google-аккаунт"}` });
      rememberSuccess(`flow:${account.id}`);
    } catch (reason) {
      setServiceFeedback("flow", { phase: "error", message: errorMessage(reason) });
    } finally {
      setFlowBusy(false);
    }
  };

  const importFlowCookies = async () => {
    if (flowAccountLimitReached) {
      setServiceFeedback("flow", { phase: "error", message: `Можно подключить не больше ${MAX_FLOW_ACCOUNTS} Flow-аккаунтов. Удалите ненужный аккаунт, чтобы добавить новый.` });
      return;
    }
    if (!flowCookies.trim()) {
      setServiceFeedback("flow", { phase: "error", message: "Вставьте cookies перед проверкой" });
      return;
    }
    setFlowBusy(true);
    setServiceFeedback("flow", { phase: "checking", message: "Проверяю cookies…" });
    try {
      const account = await api.importFlowCookies({
        label: flowLabel || undefined,
        proxyUrl: flowProxy || undefined,
        cookies: flowCookies,
      });
      setFlowAccounts(await api.listFlowAccounts());
      setFlowCookies("");
      setFlowLabel("");
      setFlowProxy("");
      setServiceFeedback("flow", { phase: "success", message: `Cookies приняты для ${account.email ?? account.label ?? "Google-аккаунта"}` });
      rememberSuccess(`flow:${account.id}`);
    } catch (reason) {
      setServiceFeedback("flow", { phase: "error", message: errorMessage(reason) });
    } finally {
      setFlowBusy(false);
    }
  };

  const runFlowAccountOperation = async (account: FlowAccountPublic, kind: "open" | "refresh" | "test") => {
    if (flowBusy || flowOperation) return;
    setFlowOperation({ accountId: account.id, kind });
    setFlowAccountFeedback((current) => ({
      ...current,
      [account.id]: { phase: "checking", message: kind === "test" ? "Проверяю сессию и доступ к моделям…" : kind === "refresh" ? "Обновляю сессию…" : "Открываю Flow…" },
    }));
    try {
      if (kind === "open") {
        await api.openFlowAccount(account.id);
        setFlowAccountFeedback((current) => ({ ...current, [account.id]: { phase: "saved", message: "Flow открыт в отдельном окне" } }));
        return;
      }
      if (kind === "refresh") {
        const updated = await api.refreshFlowAccount(account.id);
        setFlowAccounts((current) => current.map((item) => item.id === updated.id ? updated : item));
        setFlowAccountFeedback((current) => ({ ...current, [account.id]: { phase: "success", message: "Сессия обновлена и готова к работе" } }));
        rememberSuccess(`flow:${account.id}`);
        return;
      }
      const result = await api.testFlowAccount(account.id);
      setFlowAccounts(await api.listFlowAccounts().catch(() => flowAccounts));
      setFlowAccountFeedback((current) => ({ ...current, [account.id]: { phase: result.ok ? "success" : "error", message: result.message } }));
      if (result.ok) rememberSuccess(`flow:${account.id}`);
    } catch (reason) {
      setFlowAccountFeedback((current) => ({ ...current, [account.id]: { phase: "error", message: errorMessage(reason) } }));
    } finally {
      setFlowOperation(null);
    }
  };

  const reconnectFlow = async (account: FlowAccountPublic) => {
    setFlowBusy(true);
    setFlowAccountFeedback((current) => ({ ...current, [account.id]: { phase: "checking", message: "Ожидаю повторный вход…" } }));
    try {
      const updated = await api.loginFlowAccount({ accountId: account.id });
      setFlowAccounts(await api.listFlowAccounts());
      if (updated.status !== "ready") {
        setFlowAccountFeedback((current) => ({ ...current, [account.id]: { phase: "checking", message: updated.lastError ?? "Окно Flow открыто. Вход ещё не подтверждён приложением." } }));
        return;
      }
      setFlowAccountFeedback((current) => ({ ...current, [account.id]: { phase: "success", message: `Вход восстановлен: ${updated.email ?? updated.label ?? "аккаунт готов"}` } }));
      rememberSuccess(`flow:${account.id}`);
    } catch (reason) {
      setFlowAccounts(await api.listFlowAccounts().catch(() => flowAccounts));
      setFlowAccountFeedback((current) => ({ ...current, [account.id]: { phase: "error", message: errorMessage(reason) } }));
    } finally {
      setFlowBusy(false);
    }
  };

  const saveStockProvider = async (provider: StockProvider) => {
    const key = provider === "pexels" ? pexelsKey.trim() : pixabayKey.trim();
    const proxyUrl = provider === "pexels" ? pexelsProxy.trim() : pixabayProxy.trim();
    if (!key && !proxyUrl) {
      setServiceFeedback(provider, { phase: "error", message: "Введите новый API-ключ или proxy перед сохранением" });
      return;
    }
    await runSave(provider, async () => {
      const saved = await api.saveStockSettings(provider === "pexels"
        ? { pexelsApiKey: key || undefined, pexelsProxyUrl: proxyUrl || undefined }
        : { pixabayApiKey: key || undefined, pixabayProxyUrl: proxyUrl || undefined });
      setStock(saved);
      if (provider === "pexels") {
        setPexelsKey("");
        setPexelsProxy("");
      } else {
        setPixabayKey("");
        setPixabayProxy("");
      }
      forgetSuccess(provider);
    }, `Настройки ${provider === "pexels" ? "Pexels" : "Pixabay"} сохранены. Нажмите «Проверить».`);
  };

  const clearStockProxy = async (provider: StockProvider) => {
    await runSave(provider, async () => {
      const saved = await api.saveStockSettings(provider === "pexels"
        ? { clearPexelsProxy: true }
        : { clearPixabayProxy: true });
      setStock(saved);
      if (provider === "pexels") setPexelsProxy("");
      else setPixabayProxy("");
      forgetSuccess(provider);
    }, `Proxy ${provider === "pexels" ? "Pexels" : "Pixabay"} удалён. Теперь сервис работает напрямую.`);
  };

  const clearStockProvider = async (provider: StockProvider) => {
    await runSave(provider, async () => {
      setStock(await api.clearStockKey(provider));
      if (provider === "pexels") setPexelsKey("");
      else setPixabayKey("");
      forgetSuccess(provider);
    }, `Ключ ${provider === "pexels" ? "Pexels" : "Pixabay"} удалён.`);
  };

  const checkStockProvider = async (provider: StockProvider) => {
    await runCheck(provider, async () => {
      const result = await api.testStockConnection(provider);
      setStock((current) => ({
        ...current,
        pexelsConfigured: provider === "pexels" ? result.status.configured : current.pexelsConfigured,
        pixabayConfigured: provider === "pixabay" ? result.status.configured : current.pixabayConfigured,
        providers: { ...current.providers, [provider]: result.status },
      }));
      return result;
    });
  };

  const readyFlowAccounts = flowAccounts.filter((account) => account.status === "ready" && account.enabled).length;
  const problemFlowAccounts = flowAccounts.filter((account) => ["expired", "needs_login", "needs_user_action", "error"].includes(account.status)).length;
  const summaries = useMemo<ServiceSummary[]>(() => {
    const anyModelStatus = statusFromFeedback(feedback.anymodel, anyModel.configured);
    const lumeanStatus = statusFromFeedback(feedback.lumean, voicer.configured);
    const youtubeStatus = statusFromFeedback(feedback.youtube, youtube.configured);
    const stockConfiguredCount = Number(stock.pexelsConfigured) + Number(stock.pixabayConfigured);
    const stockWorkingCount = Number(stock.providers.pexels.state === "working") + Number(stock.providers.pixabay.state === "working");
    const stockErrorCount = Number(stock.providers.pexels.state === "error") + Number(stock.providers.pixabay.state === "error");
    const stockChecking = feedback.pexels?.phase === "checking" || feedback.pixabay?.phase === "checking";
    const stockHasSuccess = feedback.pexels?.phase === "success" || feedback.pixabay?.phase === "success";
    const stockHasError = feedback.pexels?.phase === "error" || feedback.pixabay?.phase === "error";
    const stockStatus: Pick<ServiceSummary, "status" | "tone"> = stockChecking
      ? { status: "Проверяется", tone: "checking" }
      : stockHasError || stockErrorCount > 0
        ? { status: "Ошибка", tone: "error" }
        : stockHasSuccess || stockWorkingCount > 0
          ? { status: "Работает", tone: "success" }
          : stockConfiguredCount > 0
            ? { status: "Настроен", tone: "configured" }
            : { status: "Не настроен", tone: "muted" };
    let flowStatus: Pick<ServiceSummary, "status" | "tone">;
    if (feedback.flow?.phase === "checking") flowStatus = { status: "Подключение", tone: "checking" };
    else if (feedback.flow?.phase === "error") flowStatus = { status: "Ошибка", tone: "error" };
    else if (readyFlowAccounts > 0) flowStatus = { status: "Работает", tone: "success" };
    else if (problemFlowAccounts > 0) flowStatus = { status: "Нужен вход", tone: "attention" };
    else flowStatus = { status: "Не настроен", tone: "muted" };
    return [
      {
        id: "anymodel",
        title: "AnyModel",
        description: "Разметка готового текста, визуальные промпты и персонажи",
        detail: anyModel.configured ? "API-ключ сохранён" : "Добавьте API-ключ",
        icon: <KeyRound size={18} />,
        ...anyModelStatus,
      },
      {
        id: "lumean",
        title: "Lumean",
        description: "Основная озвучка ElevenLabs",
        detail: voicer.configured ? "API-ключ сохранён" : "Добавьте API-ключ",
        icon: <Mic2 size={18} />,
        ...lumeanStatus,
      },
      {
        id: "flow",
        title: "Google Flow",
        description: "AI-изображения и AI-видео",
        detail: flowAccounts.length ? `${readyFlowAccounts} из ${flowAccounts.length} аккаунтов готовы` : "Добавьте Google-аккаунт",
        icon: <Video size={18} />,
        ...flowStatus,
      },
      {
        id: "stock",
        title: "Stock",
        description: "Фото и видео из Pexels и Pixabay",
        detail: stockConfiguredCount
          ? `${stockWorkingCount} из ${stockConfiguredCount} подключённых источников работают`
          : "Добавьте хотя бы один API-ключ",
        icon: <Image size={18} />,
        ...stockStatus,
      },
      {
        id: "youtube",
        title: "YouTube",
        description: "Метаданные, статистика и транскрипции",
        detail: youtube.configured ? "YouTube Data API настроен" : "API-ключ необязателен для вставленного текста",
        icon: <Youtube size={18} />,
        ...youtubeStatus,
      },
      {
        id: "storage",
        title: "Сборка и хранение",
        description: "FFmpeg, проекты и журнал",
        detail: appInfo?.workspacePath ?? "Путь загружается",
        status: appInfo?.ffmpegAvailable ? "Готово" : "Нужна проверка",
        tone: appInfo?.ffmpegAvailable ? "success" : "attention",
        icon: <HardDrive size={18} />,
      },
    ];
  }, [anyModel, appInfo, feedback, flowAccounts.length, problemFlowAccounts, readyFlowAccounts, stock, voicer.configured, youtube.configured]);

  const currentSummary = summaries.find((summary) => summary.id === activeTab);
  const anyBusy = feedback.anymodel?.phase === "checking";
  const lumeanBusy = feedback.lumean?.phase === "checking";
  const pexelsBusy = feedback.pexels?.phase === "checking";
  const pixabayBusy = feedback.pixabay?.phase === "checking";
  const youtubeBusy = feedback.youtube?.phase === "checking";

  return (
    <div className="clear-settings-page">
      <header className="clear-settings-heading">
        <div className="page-icon"><Settings size={24} /></div>
        <div>
          <h1>Настройки</h1>
          <p>{loading ? "Загружаю подключения…" : "Подключения, генерация и локальные файлы"}</p>
        </div>
      </header>

      {loadError && (
        <div className="settings-load-error" role="alert">
          <CircleAlert size={17} />
          <span>Часть настроек не загрузилась: {loadError}</span>
        </div>
      )}

      <div className="settings-layout settings-layout-v2">
        <nav className="settings-menu settings-menu-v2" aria-label="Разделы настроек">
          {tabDefinitions.map((tab) => {
            const summary = summaries.find((item) => item.id === tab.id);
            return (
              <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
                {tab.icon}
                <span>{tab.label}</span>
                {summary && <i className={`settings-nav-status tone-${summary.tone}`} aria-label={summary.status} />}
              </button>
            );
          })}
        </nav>

        <main className="settings-content settings-content-v2">
          {activeTab === "overview" && (
            <section className="settings-section">
              <SectionHeading title="Состояние подключений" description="Откройте сервис, чтобы настроить или проверить его." />
              <div className="provider-overview-list">
                {summaries.map((summary) => (
                  <button className="provider-overview-row" key={summary.id} onClick={() => setActiveTab(summary.id)}>
                    <span className="provider-overview-icon">{summary.icon}</span>
                    <span className="provider-overview-copy">
                      <strong>{summary.title}</strong>
                      <small>{summary.description}</small>
                    </span>
                    <span className="provider-overview-result">
                      <StatusBadge tone={summary.tone}>{summary.status}</StatusBadge>
                      <small>{summary.detail}</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                ))}
              </div>
              <div className="settings-runtime-strip">
                <span>Версия <b>{appInfo?.version ?? "…"}</b></span>
                <span>FFmpeg <b>{appInfo?.ffmpegAvailable ? "готов" : "недоступен"}</b></span>
                <span>Режим <b>{appInfo?.mockMode ? "демо" : "реальные API"}</b></span>
              </div>
              <AppUpdatePanel api={api} />
            </section>
          )}

          {activeTab === "anymodel" && (
            <section className="settings-section">
              <ProviderHeading
                icon={<KeyRound size={20} />}
                title="AnyModel"
                description="Сценарный план и проверка материалов Stock. Генерация изображений и видео AI Story выполняется через Google Flow."
                status={currentSummary}
                lastCheckedAt={lastSuccess.anymodel}
              />
              <ConnectionFeedback feedback={feedback.anymodel} />
              <div className="settings-form-grid">
                <SettingsField label="API-ключ" hint="Подключает AnyModel для анализа сценария и материалов.">
                  <input type="password" value={anyModelKey} onChange={(event) => setAnyModelKey(event.target.value)} placeholder={anyModel.configured ? "Оставьте пустым, чтобы не менять" : "Вставьте ключ AnyModel"} />
                </SettingsField>
                <SettingsField label="Модель для визуальных промптов" hint="Идентификатор модели AnyModel. Сохраните изменение и нажмите «Проверить».">
                  <input value={anyModel.textModel} onChange={event => setAnyModel(current => ({ ...current, textModel: event.target.value }))} placeholder="Идентификатор модели" />
                </SettingsField>
                <SettingsField
                  label="Proxy для AnyModel"
                  hint={anyModel.proxyConfigured
                    ? `Сейчас используется ${anyModel.proxyDisplayName ?? "сохранённый proxy"}. Введите новый адрес только для замены.`
                    : "Необязательно. Поддерживаются socks5://, http:// и https://; логин и пароль хранятся зашифрованно."}
                >
                  <input
                    type="password"
                    value={anyModelProxy}
                    onChange={(event) => setAnyModelProxy(event.target.value)}
                    placeholder={anyModel.proxyConfigured ? "Оставьте пустым, чтобы не менять" : "socks5://логин:пароль@хост:порт"}
                    autoComplete="off"
                  />
                </SettingsField>
              </div>
              <div className="provider-actions provider-actions-v2">
                <button className="generate-button" disabled={anyBusy} onClick={() => void runSave("anymodel", async () => {
                  const saved = await api.saveAnyModelSettings({
                    baseUrl: anyModel.baseUrl,
                    textModel: anyModel.textModel,
                    imageModel: anyModel.imageModel,
                    imageRefModel: anyModel.imageRefModel,
                    transcriptionModel: anyModel.transcriptionModel,
                    videoModel: anyModel.videoModel,
                    ttsModel: anyModel.ttsModel,
                    apiKey: anyModelKey.trim() || undefined,
                    proxyUrl: anyModelProxy.trim() || undefined,
                  });
                  setAnyModel(saved);
                  setAnyModelKey("");
                  setAnyModelProxy("");
                }, "Настройки сохранены. Нажмите «Проверить», чтобы подтвердить соединение.")}><Save size={15} />Сохранить</button>
                <button className="outline-button small" disabled={!anyModel.configured || anyBusy} onClick={() => void runCheck("anymodel", () => api.testAnyModelConnection())}>
                  {anyBusy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}Проверить
                </button>
                <button className="outline-button small danger" disabled={!anyModel.configured || anyBusy} onClick={() => void runSave("anymodel", async () => {
                  setAnyModel(await api.clearAnyModelKey());
                  forgetSuccess("anymodel");
                }, "Ключ AnyModel удалён.")}><Trash2 size={14} />Удалить ключ</button>
                {anyModel.proxyConfigured && (
                  <button className="outline-button small danger" disabled={anyBusy} onClick={() => void runSave("anymodel", async () => {
                    const saved = await api.saveAnyModelSettings({
                      baseUrl: anyModel.baseUrl,
                      textModel: anyModel.textModel,
                      imageModel: anyModel.imageModel,
                      imageRefModel: anyModel.imageRefModel,
                      transcriptionModel: anyModel.transcriptionModel,
                      videoModel: anyModel.videoModel,
                      ttsModel: anyModel.ttsModel,
                      clearProxy: true,
                    });
                    setAnyModel(saved);
                    setAnyModelProxy("");
                    forgetSuccess("anymodel");
                  }, "Proxy AnyModel удалён. Теперь сервис работает напрямую.")}><Trash2 size={14} />Убрать proxy</button>
                )}
              </div>
            </section>
          )}

          {activeTab === "lumean" && (
            <section className="settings-section">
              <ProviderHeading
                icon={<Mic2 size={20} />}
                title="Lumean"
                description="Основная озвучка роликов голосами ElevenLabs."
                status={currentSummary}
                lastCheckedAt={lastSuccess.lumean}
              />
              <ConnectionFeedback feedback={feedback.lumean} />
              <div className="settings-form-grid">
                <SettingsField label="API-ключ" hint="Ключ из кабинета Lumean, заголовок X-API-KEY.">
                  <input type="password" value={voicerKey} onChange={(event) => setVoicerKey(event.target.value)} placeholder={voicer.configured ? "Оставьте пустым, чтобы не менять" : "Вставьте ключ Lumean"} />
                </SettingsField>
                <SettingsField
                  label="Proxy для Lumean"
                  hint={voicer.proxyConfigured
                    ? `Сейчас используется ${voicer.proxyDisplayName ?? "сохранённый proxy"}. Введите новый адрес только для замены.`
                    : "Необязательно. Поддерживаются socks5://, http:// и https://; логин и пароль хранятся зашифрованно."}
                >
                  <input
                    type="password"
                    value={voicerProxy}
                    onChange={(event) => setVoicerProxy(event.target.value)}
                    placeholder={voicer.proxyConfigured ? "Оставьте пустым, чтобы не менять" : "socks5://логин:пароль@хост:порт"}
                    autoComplete="off"
                  />
                </SettingsField>
              </div>
              <TechnicalDetails title="Параметры подключения">
                <SettingsField label="Base URL">
                  <input value={voicer.baseUrl} onChange={(event) => setVoicer({ ...voicer, baseUrl: event.target.value })} placeholder="https://api.lumean.app/api/public" />
                </SettingsField>
              </TechnicalDetails>
              <div className="provider-actions provider-actions-v2">
                <button className="generate-button" disabled={lumeanBusy} onClick={() => void runSave("lumean", async () => {
                  const saved = await api.saveVoicerSettings({
                    baseUrl: voicer.baseUrl,
                    apiKey: voicerKey.trim() || undefined,
                    proxyUrl: voicerProxy.trim() || undefined,
                  });
                  setVoicer(saved);
                  setVoicerKey("");
                  setVoicerProxy("");
                }, "Настройки сохранены. Нажмите «Проверить», чтобы подтвердить соединение.")}><Save size={15} />Сохранить</button>
                <button className="outline-button small" disabled={!voicer.configured || lumeanBusy} onClick={() => void runCheck("lumean", () => api.testVoicerConnection())}>
                  {lumeanBusy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}Проверить
                </button>
                <button className="outline-button small danger" disabled={!voicer.configured || lumeanBusy} onClick={() => void runSave("lumean", async () => {
                  setVoicer(await api.clearVoicerKey());
                  forgetSuccess("lumean");
                }, "Ключ Lumean удалён.")}><Trash2 size={14} />Удалить ключ</button>
                {voicer.proxyConfigured && (
                  <button className="outline-button small danger" disabled={lumeanBusy} onClick={() => void runSave("lumean", async () => {
                    setVoicer(await api.saveVoicerSettings({ baseUrl: voicer.baseUrl, clearProxy: true }));
                    setVoicerProxy("");
                    forgetSuccess("lumean");
                  }, "Proxy Lumean удалён. Теперь сервис работает напрямую.")}><Trash2 size={14} />Убрать proxy</button>
                )}
              </div>
            </section>
          )}

          {activeTab === "flow" && (
            <section className="settings-section">
              <ProviderHeading
                icon={<Video size={20} />}
                title="Google Flow"
                description="Аккаунты для генерации AI-изображений и AI-видео."
                status={currentSummary}
              />
              <ConnectionFeedback feedback={feedback.flow} />
              <div className={`flow-account-capacity${flowAccountLimitReached ? " limit-reached" : ""}`} role="status" aria-live="polite">
                <span>Подключено аккаунтов</span>
                <strong>{flowAccounts.length} / {MAX_FLOW_ACCOUNTS}</strong>
                <small>{flowAccountLimitReached ? "Достигнут максимум. Для замены сначала удалите один аккаунт." : `Можно добавить ещё ${MAX_FLOW_ACCOUNTS - flowAccounts.length}. Для каждого можно указать отдельный proxy.`}</small>
              </div>
              <div className="flow-connect-form flow-connect-form-v2">
                <SettingsField label="Название аккаунта" hint="Необязательно, но помогает различать несколько аккаунтов.">
                  <input disabled={flowAccountLimitReached} value={flowLabel} onChange={(event) => setFlowLabel(event.target.value)} placeholder="Например: основной Pro" />
                </SettingsField>
                <button className="generate-button flow-connect-button" disabled={flowBusy || flowOperation !== null || flowAccountLimitReached} onClick={() => void connectFlow()}>
                  {flowBusy ? <LoaderCircle className="spin" size={15} /> : <CircleUserRound size={15} />}
                  {flowBusy ? flowProgress?.message ?? "Подключаю…" : flowAccountLimitReached ? `Достигнут максимум: ${MAX_FLOW_ACCOUNTS} аккаунтов` : "Добавить аккаунт через браузер"}
                </button>
                <TechnicalDetails title="Proxy и импорт cookies">
                  <SettingsField
                    label="Proxy нового аккаунта"
                    hint="Для доступа из неподдерживаемого региона укажите рабочий proxy до входа. Он сохраняется отдельно для этого аккаунта; поддерживаются http, https и socks5."
                  >
                    <input disabled={flowAccountLimitReached} type="password" value={flowProxy} onChange={(event) => setFlowProxy(event.target.value)} placeholder="socks5://логин:пароль@хост:порт" />
                  </SettingsField>
                  <SettingsField label="Cookies" hint="JSON, Netscape cookies.txt, Cookie header или session-token.">
                    <textarea disabled={flowAccountLimitReached} rows={5} value={flowCookies} onChange={(event) => setFlowCookies(event.target.value)} spellCheck={false} placeholder="После успешной проверки поле очистится" />
                  </SettingsField>
                  <button className="outline-button small" disabled={flowBusy || flowOperation !== null || flowAccountLimitReached || !flowCookies.trim()} onClick={() => void importFlowCookies()}>
                    <Check size={14} />Проверить и сохранить cookies
                  </button>
                </TechnicalDetails>
              </div>

              <div className="flow-list-heading">
                <div>
                  <h3>Подключённые аккаунты</h3>
                  <p>{flowAccounts.length ? `${readyFlowAccounts} готовы · ${flowAccounts.length} из ${MAX_FLOW_ACCOUNTS} подключено` : `Аккаунты ещё не добавлены · максимум ${MAX_FLOW_ACCOUNTS}`}</p>
                </div>
                <button className="outline-button small" disabled={flowBusy || flowOperation !== null || flowAccounts.length === 0} onClick={() => {
                  setServiceFeedback("flow", { phase: "checking", message: "Обновляю все аккаунты…" });
                  void api.refreshAllFlowAccounts()
                    .then((accounts) => {
                      setFlowAccounts(accounts);
                      setServiceFeedback("flow", { phase: "success", message: "Статусы всех аккаунтов обновлены" });
                    })
                    .catch((reason) => setServiceFeedback("flow", { phase: "error", message: errorMessage(reason) }));
                }}><RefreshCw size={14} />Обновить все</button>
              </div>
              <div className="flow-account-list flow-account-list-v2">
                {flowAccounts.length === 0 && (
                  <div className="settings-empty-state">
                    <CircleUserRound size={24} />
                    <strong>Нет Flow-аккаунтов</strong>
                    <span>Добавьте аккаунт через браузер. После входа здесь появится его реальный статус.</span>
                  </div>
                )}
                {flowAccounts.map((account) => {
                  const operation = flowOperation?.accountId === account.id ? flowOperation.kind : undefined;
                  const locked = flowBusy || flowOperation !== null;
                  const accountFeedback = flowAccountFeedback[account.id];
                  const statusTone: StatusTone = account.status === "ready" ? "success" : account.status === "cooldown" || account.status === "needs_user_action" ? "attention" : account.status === "disabled" ? "muted" : account.status === "connecting" ? "checking" : "error";
                  return (
                    <article className={`flow-account-card flow-account-card-v2 status-${account.status}`} key={account.id}>
                      <header>
                        <div className="flow-account-identity">
                          <span className="provider-overview-icon"><CircleUserRound size={17} /></span>
                          <div>
                            <strong>{account.email ?? account.label ?? "Google-аккаунт"}</strong>
                            <small>{account.label && account.email ? account.label : account.email ? account.id : "Вход ещё не завершён"}</small>
                          </div>
                        </div>
                        <StatusBadge tone={statusTone}>{flowStatusLabels[account.status]}</StatusBadge>
                      </header>
                      <div className="flow-account-meta flow-account-meta-v2">
                        <span>Тариф<b>{account.tier ?? "не определён"}</b></span>
                        <span>Кредиты<b>{account.credits ?? "—"}</b></span>
                        <span>Видео<b>{account.videoEnabled ? "включено" : "отключено"}</b></span>
                        <span>Последняя проверка<b>{formatDate(lastSuccess[`flow:${account.id}`])}</b></span>
                      </div>
                      {account.lastError && !accountFeedback && <div className="flow-account-error"><CircleAlert size={14} />{account.lastError}</div>}
                      <ConnectionFeedback feedback={accountFeedback} compact />
                      <div className="provider-actions provider-actions-v2">
                        <button className="generate-button compact" disabled={locked || account.status === "needs_login"} onClick={() => void runFlowAccountOperation(account, "test")}>
                          {operation === "test" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                          {operation === "test" ? "Проверяю…" : "Проверить"}
                        </button>
                        {["needs_login", "expired", "needs_user_action", "error"].includes(account.status) && (
                          <button className="outline-button small" disabled={locked} onClick={() => void reconnectFlow(account)}><CircleUserRound size={14} />Войти снова</button>
                        )}
                        <label className="settings-checkbox">
                          <input type="checkbox" checked={account.videoEnabled} disabled={locked} onChange={() => {
                            void api.updateFlowAccount(account.id, { videoEnabled: !account.videoEnabled })
                              .then((updated) => setFlowAccounts((current) => current.map((item) => item.id === updated.id ? updated : item)))
                              .catch((reason) => setFlowAccountFeedback((current) => ({ ...current, [account.id]: { phase: "error", message: errorMessage(reason) } })));
                          }} />
                          Использовать для видео
                        </label>
                      </div>
                      <TechnicalDetails title="Сессия, proxy и управление">
                        <div className="settings-inline-actions">
                          <button className="outline-button small" disabled={locked} onClick={() => void runFlowAccountOperation(account, "open")}>{operation === "open" ? "Открываю…" : "Открыть Flow"}</button>
                          <button className="outline-button small" disabled={locked} onClick={() => void runFlowAccountOperation(account, "refresh")}>{operation === "refresh" ? "Обновляю…" : "Обновить сессию"}</button>
                        </div>
                        <div className="flow-session-details">
                          <span>Proxy: <b>{account.proxyDisplayName ?? "прямое соединение"}</b></span>
                          <span>Сессия до: <b>{account.tokenExpiresAt || account.sessionExpiresAt ? formatDate(account.tokenExpiresAt ?? account.sessionExpiresAt) : "срок неизвестен"}</b></span>
                          <span>Последнее обновление: <b>{formatDate(account.lastRefreshAt)}</b></span>
                        </div>
                        <SettingsField label="Новый proxy этого аккаунта">
                          <input type="password" value={accountProxy[account.id] ?? ""} onChange={(event) => setAccountProxy((current) => ({ ...current, [account.id]: event.target.value }))} placeholder="socks5://логин:пароль@хост:порт" />
                        </SettingsField>
                        <div className="settings-inline-actions">
                          <button className="outline-button small" disabled={locked || !(accountProxy[account.id] ?? "").trim()} onClick={() => {
                            void api.updateFlowAccount(account.id, { proxyUrl: accountProxy[account.id] })
                              .then((updated) => {
                                setFlowAccounts((current) => current.map((item) => item.id === updated.id ? updated : item));
                                setAccountProxy((current) => ({ ...current, [account.id]: "" }));
                                setFlowAccountFeedback((current) => ({ ...current, [account.id]: { phase: "saved", message: "Proxy сохранён. Обновите сессию для проверки." } }));
                              })
                              .catch((reason) => setFlowAccountFeedback((current) => ({ ...current, [account.id]: { phase: "error", message: errorMessage(reason) } })));
                          }}>Сохранить proxy</button>
                          <button className="outline-button small" disabled={locked || !account.proxyDisplayName} onClick={() => {
                            void api.updateFlowAccount(account.id, { clearProxy: true })
                              .then((updated) => setFlowAccounts((current) => current.map((item) => item.id === updated.id ? updated : item)))
                              .catch((reason) => setFlowAccountFeedback((current) => ({ ...current, [account.id]: { phase: "error", message: errorMessage(reason) } })));
                          }}>Убрать proxy</button>
                          <button className="outline-button small danger" disabled={locked} onClick={() => {
                            if (!window.confirm(`Удалить Flow-аккаунт ${account.email ?? account.label ?? account.id}?`)) return;
                            void api.removeFlowAccount(account.id)
                              .then(() => {
                                setFlowAccounts((current) => current.filter((item) => item.id !== account.id));
                                forgetSuccess(`flow:${account.id}`);
                              })
                              .catch((reason) => setFlowAccountFeedback((current) => ({ ...current, [account.id]: { phase: "error", message: errorMessage(reason) } })));
                          }}><Trash2 size={13} />Удалить аккаунт</button>
                        </div>
                      </TechnicalDetails>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {activeTab === "stock" && (
            <section className="settings-section">
              <ProviderHeading
                icon={<Image size={20} />}
                title="Stock-медиа"
                description="Подключите Pexels и Pixabay для поиска фото и видео прямо в материалах сцен."
                status={currentSummary}
              />
              <div className="stock-policy-note">
                <Check size={17} />
                <div>
                  <strong>Без лишних скачиваний</strong>
                  <p>Результаты поиска кешируются на 24 часа. Файл скачивается в папку проекта только после того, как вы выбрали его для сцены.</p>
                </div>
              </div>

              <div className="stock-provider-list">
                {([
                  {
                    provider: "pexels" as const,
                    name: "Pexels",
                    description: "Стоковые фотографии и видео",
                    configured: stock.pexelsConfigured,
                    connection: stock.providers.pexels,
                    value: pexelsKey,
                    setValue: setPexelsKey,
                    proxyValue: pexelsProxy,
                    setProxyValue: setPexelsProxy,
                    busy: pexelsBusy,
                    placeholder: "Вставьте ключ Pexels",
                  },
                  {
                    provider: "pixabay" as const,
                    name: "Pixabay",
                    description: "Стоковые изображения и видео",
                    configured: stock.pixabayConfigured,
                    connection: stock.providers.pixabay,
                    value: pixabayKey,
                    setValue: setPixabayKey,
                    proxyValue: pixabayProxy,
                    setProxyValue: setPixabayProxy,
                    busy: pixabayBusy,
                    placeholder: "Вставьте ключ Pixabay",
                  },
                ]).map((item) => {
                  const persistedFeedback: ServiceFeedback | undefined = item.connection.state === "working"
                    ? { phase: "success", message: item.connection.message || `${item.name} подключён` }
                    : item.connection.state === "error"
                      ? { phase: "error", message: item.connection.message || `Проверка ${item.name} завершилась ошибкой` }
                      : undefined;
                  const itemFeedback = feedback[item.provider] ?? persistedFeedback;
                  const itemStatus = statusFromFeedback(itemFeedback, item.configured, item.connection.state);
                  return (
                    <article className="stock-provider-card" key={item.provider}>
                      <header>
                        <span className="provider-overview-icon"><Image size={17} /></span>
                        <div>
                          <strong>{item.name}</strong>
                          <small>{item.description}</small>
                        </div>
                        <StatusBadge tone={itemStatus.tone}>{itemStatus.status}</StatusBadge>
                      </header>
                      <ConnectionFeedback feedback={itemFeedback} compact />
                      <SettingsField label="API-ключ" hint={item.configured ? `Ключ ${item.name} уже сохранён. Введите новый только для замены.` : `Получите ключ в личном кабинете ${item.name}.`}>
                        <input
                          type="password"
                          value={item.value}
                          onChange={(event) => item.setValue(event.target.value)}
                          placeholder={item.configured ? "Оставьте пустым, чтобы не менять" : item.placeholder}
                          autoComplete="off"
                        />
                      </SettingsField>
                      <SettingsField
                        label={`Proxy для ${item.name}`}
                        hint={item.connection.proxyConfigured
                          ? `Сейчас используется ${item.connection.proxyDisplayName ?? "сохранённый proxy"}. Введите новый только для замены.`
                          : "Необязательно. Можно указать отдельный socks5://, http:// или https:// proxy для этого источника."}
                      >
                        <input
                          type="password"
                          value={item.proxyValue}
                          onChange={(event) => item.setProxyValue(event.target.value)}
                          placeholder={item.connection.proxyConfigured ? "Оставьте пустым, чтобы не менять" : "socks5://логин:пароль@хост:порт"}
                          autoComplete="off"
                        />
                      </SettingsField>
                      <div className="provider-actions provider-actions-v2">
                        <button className="generate-button compact" disabled={item.busy || (!item.value.trim() && !item.proxyValue.trim())} onClick={() => void saveStockProvider(item.provider)}>
                          <Save size={14} />Сохранить
                        </button>
                        <button className="outline-button small" disabled={!item.configured || item.busy} onClick={() => void checkStockProvider(item.provider)}>
                          {item.busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}Проверить
                        </button>
                        <button className="outline-button small danger" disabled={!item.configured || item.busy} onClick={() => void clearStockProvider(item.provider)}>
                          <Trash2 size={13} />Удалить ключ
                        </button>
                        {item.connection.proxyConfigured && (
                          <button className="outline-button small danger" disabled={item.busy} onClick={() => void clearStockProxy(item.provider)}>
                            <Trash2 size={13} />Убрать proxy
                          </button>
                        )}
                      </div>
                      {(item.connection.checkedAt || lastSuccess[item.provider]) && (
                        <small className="stock-last-check">
                          Последняя проверка: {formatDate(item.connection.checkedAt || lastSuccess[item.provider])}
                        </small>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {activeTab === "youtube" && (
            <section className="settings-section">
              <ProviderHeading
                icon={<Youtube size={20} />}
                title="YouTube"
                description="Данные каналов, статистика, субтитры и транскрипции."
                status={currentSummary}
                lastCheckedAt={lastSuccess.youtube}
              />
              <ConnectionFeedback feedback={feedback.youtube} />
              <div className="settings-form-grid">
                <SettingsField label="YouTube Data API v3" hint="Используется для метаданных, просмотров, комментариев и статистики канала.">
                  <input type="password" value={youtubeKey} onChange={(event) => setYouTubeKey(event.target.value)} placeholder={youtube.configured ? "Оставьте пустым, чтобы не менять" : "AIza…"} />
                </SettingsField>
                <SettingsField label="Прокси для видео Stock" hint={youtube.proxyConfigured ? `Подключён: ${youtube.proxyDisplayName}` : "Необязательно. Для скачивания оригиналов YouTube."}>
                  <input aria-label="Прокси для видео Stock" type="password" value={youtubeProxy} onChange={event => setYouTubeProxy(event.target.value)} placeholder={youtube.proxyConfigured ? "Оставьте пустым, чтобы не менять" : "socks5://логин:пароль@хост:порт"} autoComplete="off" />
                </SettingsField>
                <SettingsField label="Подключение для видео Stock" hint="Публичный DNS действует только внутри загрузчика и не меняет настройки Windows.">
                  <select aria-label="Подключение для видео Stock" value={youtube.downloadRoute ?? (youtube.proxyConfigured ? "proxy" : "system")} onChange={event => setYouTube({ ...youtube, downloadRoute: event.target.value as YouTubeSettings["downloadRoute"] })}><option value="system">Системное подключение</option><option value="proxy">Сохранённый прокси</option><option value="public-dns">Прямое подключение · публичный DNS</option></select>
                </SettingsField>
              </div>
              <div className="provider-actions provider-actions-v2">
                <button className="generate-button" disabled={youtubeBusy} onClick={() => void runSave("youtube", async () => {
                  const saved = await api.saveYouTubeSettings({ apiKey: youtubeKey || undefined, proxyUrl: youtubeProxy.trim() || undefined, downloadRoute: youtube.downloadRoute });
                  setYouTube(saved);
                  setYouTubeKey("");
                  setYouTubeProxy("");
                }, "Ключ сохранён. Нажмите «Проверить», чтобы подтвердить соединение.")}><Save size={15} />Сохранить</button>
                <button className="outline-button small" disabled={!youtube.configured || youtubeBusy} onClick={() => void runCheck("youtube", () => api.testYouTubeConnection())}>
                  {youtubeBusy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}Проверить
                </button>
                <button className="outline-button small danger" disabled={!youtube.configured || youtubeBusy} onClick={() => void runSave("youtube", async () => {
                  setYouTube(await api.clearYouTubeKey());
                  forgetSuccess("youtube");
                }, "Ключ YouTube удалён.")}><Trash2 size={14} />Удалить ключ</button>
              </div>
              <TechnicalDetails title="Вход YouTube для скачивания и временная папка">
                {youtube.proxyConfigured && <button className="outline-button small" onClick={() => void runSave("youtube", async () => { setYouTube(await api.saveYouTubeSettings({ clearProxy: true })); setYouTubeProxy(""); }, "Прокси для видео отключён.")}>Отключить прокси для видео</button>}
                <div className="settings-detail-row">
                  <div><strong>Вход YouTube · cookies.txt</strong><span>{youtube.cookiesFileConfigured ? `Подключён файл: ${youtube.cookiesFileName ?? "cookies.txt"}` : "Файл сессии не подключён"}</span><span>Если YouTube требует вход, экспортируйте cookies только сайта youtube.com в формате Netscape через Get cookies.txt LOCALLY в Chrome. Сохраните файл на компьютере и выберите его здесь.</span></div>
                  <div className="settings-inline-actions">
                    <button className="outline-button small" disabled={youtubeBusy} onClick={() => void (async () => {
                      try {
                        const [cookiesFilePath] = await api.pickFiles("cookies");
                        if (cookiesFilePath) await runSave("youtube", async () => { setYouTube(await api.saveYouTubeSettings({ cookiesFilePath })); }, "Файл сессии подключён. Доступ к видео будет проверен при скачивании.");
                      } catch (reason) { setServiceFeedback("youtube", { phase: "error", message: errorMessage(reason) }); }
                    })()}>Выбрать cookies.txt</button>
                    <button className="outline-button small" disabled={!youtube.cookiesFileConfigured || youtubeBusy} onClick={() => void runSave("youtube", async () => { setYouTube(await api.saveYouTubeSettings({ clearCookiesFile: true })); }, "Файл сессии отключён от программы и сохранён на компьютере.")}>Отключить файл</button>
                  </div>
                </div>
                <div className="settings-detail-row">
                  <div><strong>Временная папка</strong><span>{youtube.workDirConfigured ? youtube.workDirPath ?? "Настроена" : "Системная временная папка"}</span></div>
                  <div className="settings-inline-actions">
                    <button className="outline-button small" onClick={() => void api.pickDirectory().then(async (workDirPath) => {
                      if (workDirPath) setYouTube(await api.saveYouTubeSettings({ workDirPath }));
                    })}>Выбрать папку</button>
                    <button className="outline-button small" disabled={!youtube.workDirConfigured} onClick={() => void api.saveYouTubeSettings({ clearWorkDir: true }).then(setYouTube)}>Сбросить</button>
                  </div>
                </div>
              </TechnicalDetails>
            </section>
          )}

          {activeTab === "storage" && (
            <section className="settings-section">
              <ProviderHeading
                icon={<HardDrive size={20} />}
                title="Папки и хранение"
                description="Выберите диск для проектов, видео, фотографий, озвучки, результатов и библиотеки материалов."
                status={currentSummary}
              />
              <div className="storage-path-list">
                <PathRow label="Хранилище материалов" value={storage?.path ?? "Загрузка…"} />
                <PathRow label="Свободно на диске" value={storage ? `${(storage.freeBytes / 1024 ** 3).toFixed(1)} ГБ` : "Загрузка…"} />
                <PathRow label="Настройки и ключи" value={appInfo?.dataPath ?? "Загрузка…"} />
                <PathRow label="TXT-журнал" value={appInfo?.logPath ?? "Загрузка…"} />
              </div>
              <p className="storage-help">Выберите пустую папку. Существующие материалы перенесутся при следующем запуске: программа проверит копии и освободит прежнюю папку. Небольшие настройки, ключи и журнал останутся в профиле приложения.</p>
              <StorageUsage projects={projects} />
              {storage?.retainedPath && <p className="storage-help" role="status">Новое хранилище активно. Windows удерживает прежнюю папку {storage.retainedPath}; исходная копия пока сохранена и место на старом диске ещё не освобождено.</p>}
              {storage?.pendingPath && <div role="status"><PathRow label="Папка после переноса" value={storage.pendingPath} /><p className="storage-help">Завершите или остановите производство, затем закройте и снова откройте GoldWork. Во время переноса не выключайте компьютер.</p></div>}
              {(storageError || storage?.error) && <p className="storage-help" role="alert">{storageError || storage?.error}</p>}
              <div className="provider-actions provider-actions-v2 storage-actions">
                <button className="primary-button small" disabled={storageBusy || !storage} onClick={() => void changeStorage()}><FolderOpen size={14} />Выбрать папку хранения</button>
                {storage?.pendingPath && <button className="outline-button small" disabled={storageBusy} onClick={() => void changeStorage(true)}>Отменить перенос</button>}
                <button className="outline-button small" disabled={!appInfo} onClick={() => void api.openLogFile()}><FileText size={14} />Открыть журнал</button>
              </div>
              <TechnicalDetails title="Сборка и очередь">
                <div className="settings-detail-grid">
                  <span>FFmpeg<b>{appInfo?.ffmpegAvailable ? "готов к MP4" : "недоступен"}</b></span>
                  <span>Параллельные задачи<b>{appInfo?.queuePolicy.concurrency ?? "—"}</b></span>
                  <span>Попыток задачи<b>{appInfo?.queuePolicy.maxAttempts ?? "—"}</b></span>
                  <span>Повторы<b>{(appInfo?.queuePolicy.retryDelaysMs ?? []).map((value) => `${value / 1000} с`).join(", ") || "—"}</b></span>
                </div>
              </TechnicalDetails>
            </section>
          )}

        </main>
      </div>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <header className="settings-section-heading">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function ProviderHeading({
  icon,
  title,
  description,
  status,
  lastCheckedAt,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  status?: ServiceSummary;
  lastCheckedAt?: string;
}) {
  return (
    <header className="provider-heading">
      <span className="provider-heading-icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
        {lastCheckedAt && <small>Последнее успешное подключение: {formatDate(lastCheckedAt)}</small>}
      </div>
      {status && <StatusBadge tone={status.tone}>{status.status}</StatusBadge>}
    </header>
  );
}

function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`settings-status-badge tone-${tone}`}><i />{children}</span>;
}

function ConnectionFeedback({ feedback, compact = false }: { feedback?: ServiceFeedback; compact?: boolean }) {
  if (!feedback) return null;
  const icon = feedback.phase === "checking"
    ? <LoaderCircle className="spin" size={15} />
    : feedback.phase === "error"
      ? <X size={15} />
      : <Check size={15} />;
  return (
    <div className={`connection-feedback phase-${feedback.phase}${compact ? " compact" : ""}`} role={feedback.phase === "error" ? "alert" : "status"} aria-live="polite">
      {icon}
      <span>{feedback.message}</span>
    </div>
  );
}

function SettingsField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="settings-field-v2">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function TechnicalDetails({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="settings-technical-details">
      <summary>{title}<ChevronRight size={15} /></summary>
      <div className="settings-technical-body">{children}</div>
    </details>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="storage-path-row">
      <span><FolderOpen size={16} />{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
