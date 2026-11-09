import type { AppUpdateState } from "@gold-work/shared";

export interface UpdateEngine {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

/** Downloads may overlap production; installing must never interrupt it. */
export class AppUpdates {
  private state: AppUpdateState;
  private checking?: Promise<AppUpdateState>;
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  constructor(private readonly engine: UpdateEngine, private readonly options: {
    version: string;
    supported: boolean;
    unsupportedMessage?: string;
    busy: () => Promise<boolean>;
    publish: (state: AppUpdateState) => void;
  }) {
    this.state = { status: options.supported ? "idle" : "unsupported", currentVersion: options.version,
      message: options.supported ? "Проверка обновлений ещё не выполнялась." : options.unsupportedMessage ?? "Автообновления доступны в установленной версии Windows." };
    engine.autoDownload = true;
    engine.autoInstallOnAppQuit = false;
    engine.allowPrerelease = false;
    engine.allowDowngrade = false;
    engine.on("checking-for-update", () => this.set({ status: "checking", message: "Проверяю обновления…", checkedAt: new Date().toISOString() }));
    engine.on("update-available", (info: { version: string }) => this.set({ status: "downloading", availableVersion: info.version, percent: 0, message: `Скачиваю обновление ${info.version}…` }));
    engine.on("download-progress", (progress: { percent: number }) => {
      if (this.state.status !== "installing") this.set({ status: "downloading", percent: Math.max(0, Math.min(100, Math.round(progress.percent))), message: `Скачиваю обновление ${this.state.availableVersion ?? ""}…` });
    });
    engine.on("update-downloaded", (info: { version: string }) => this.set({ status: "downloaded", availableVersion: info.version, percent: 100, message: `Версия ${info.version} готова. Перезапустите приложение для установки.` }));
    engine.on("update-not-available", () => this.set({ status: "up-to-date", availableVersion: undefined, percent: undefined, message: "Установлена последняя версия." }));
    engine.on("error", () => this.set({ status: "error", percent: undefined, message: "Не удалось получить обновление. Проверьте подключение к интернету и повторите проверку." }));
  }

  snapshot(): AppUpdateState { return { ...this.state }; }
  get installing(): boolean { return this.state.status === "installing"; }

  private set(patch: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.options.publish(this.snapshot());
  }

  check(): Promise<AppUpdateState> {
    if (!this.options.supported || ["downloading", "downloaded", "installing"].includes(this.state.status)) return Promise.resolve(this.snapshot());
    if (this.checking) return this.checking;
    const run = (async () => {
      try { await this.engine.checkForUpdates(); }
      catch { this.set({ status: "error", message: "Не удалось проверить обновления. Попробуйте позже." }); }
      return this.snapshot();
    })();
    this.checking = run;
    void run.finally(() => { if (this.checking === run) this.checking = undefined; });
    return run;
  }

  async install(): Promise<AppUpdateState> {
    if (this.state.status !== "downloaded") throw new Error("Сначала дождитесь загрузки обновления.");
    if (await this.options.busy()) {
      this.set({ message: "Дождитесь завершения подбора, генерации и рендера, затем установите обновление." });
      return this.snapshot();
    }
    // Recheck after the asynchronous production guard: concurrent clicks may
    // have already scheduled installation. Only one installer can be launched.
    if (this.state.status !== "downloaded") return this.snapshot();
    this.set({ status: "installing", message: "Перезапускаю приложение для установки обновления…" });
    this.timers.push(setTimeout(() => {
      try { this.engine.quitAndInstall(true, true); }
      catch { this.set({ status: "downloaded", message: "Не удалось запустить установку. Повторите после завершения работы." }); }
    }, 250));
    return this.snapshot();
  }

  start(): void {
    if (!this.options.supported || this.timers.length) return;
    const first = setTimeout(() => { void this.check(); }, 10_000);
    const interval = setInterval(() => { void this.check(); }, 6 * 60 * 60 * 1000);
    first.unref(); interval.unref();
    this.timers.push(first, interval);
  }

  stop(): void { for (const timer of this.timers) clearTimeout(timer); this.timers = []; }
}
