import electron from "electron";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const { app, BrowserWindow } = electron;

const targetUrl = process.env.GOLD_WORK_SMOKE_URL ?? "http://127.0.0.1:5173/";
const captureDirectory = join(process.cwd(), "captures");
const capturePath = join(captureDirectory, "ui-smoke.png");
const previewCapturePath = join(captureDirectory, "ui-preview.png");
const directorCapturePath = join(captureDirectory, "ui-director.png");
const settingsCapturePath = join(captureDirectory, "ui-settings.png");
const logPath = join(captureDirectory, "ui-smoke.log");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const trace = async (message) => {
  await mkdir(captureDirectory, { recursive: true });
  await appendFile(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
};

function fail(message) {
  throw new Error(`[ui-smoke] ${message}`);
}

app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(run).catch((error) => {
  console.error(error);
  app.exit(1);
});

async function run() {
  await trace("app-ready");
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: "#050505",
    webPreferences: { contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false }
  });

  try {
  await window.loadURL(targetUrl);
  await trace("url-loaded");
  await wait(400);

  const initialText = await window.webContents.executeJavaScript("document.body.innerText");
  if (!initialText.includes("Мои каналы") || !initialText.includes("Создайте первый канал")) fail("экран каналов не открылся");
  if (initialText.includes("Студия субтитров")) fail("субтитры не должны быть частью интерфейса");
  const visibleBuildId = await window.webContents.executeJavaScript(`(() => {
    const badge = document.querySelector(".main-build-badge");
    return { text: badge?.textContent ?? "", id: badge?.getAttribute("data-build-id") ?? "" };
  })()`);
  if (!visibleBuildId.text.includes("MAIN") || !visibleBuildId.id || visibleBuildId.id === "source-identity-not-generated") {
    fail(`идентификатор Electron main не виден: ${JSON.stringify(visibleBuildId)}`);
  }
  const navigationKeys = await window.webContents.executeJavaScript(
    "[...document.querySelectorAll('[data-nav-key]')].map((item) => item.dataset.navKey)",
  );
  if (JSON.stringify(navigationKeys) !== JSON.stringify(["channels", "director", "projects", "queue", "settings"])) {
    fail(`основная навигация перегружена или имеет неверный порядок: ${JSON.stringify(navigationKeys)}`);
  }
  if (["dashboard", "project", "scenario", "clone", "thumbnail", "avatar", "seo", "studio", "console"].some((key) => navigationKeys.includes(key))) {
    fail("в основной навигации остались внутренние экраны или заглушки");
  }
  const channelCreated = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const setValue = (element, value) => {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    };
    [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Создать канал"))?.click();
    await wait(60);
    setValue(document.querySelector("input[placeholder*='Истории великих']"), "Smoke Channel");
    [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Продолжить"))?.click();
    await wait(60);
    setValue(document.querySelector("textarea[placeholder*='Master Prompt']"), "Write a documentary script in clear chapters.");
    [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Продолжить"))?.click();
    await wait(60);
    [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Сохранить канал"))?.click();
    await wait(100);
    return document.body.innerText.includes("Smoke Channel") && document.body.innerText.includes("Чаты и использованные темы");
  })()`);
  if (!channelCreated) fail("канал не создался");
  await trace("channels-ready");

  const calibratedVideoDialogReady = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const setValue = (element, value) => {
      if (!element) return false;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    };
    [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Новый ролик"))?.click();
    await wait(80);
    const modal = document.querySelector(".video-dialog");
    const modes = [...(modal?.querySelectorAll(".video-creation-modes button") ?? [])];
    const create = [...(modal?.querySelectorAll(".channel-dialog-footer button") ?? [])]
      .find((button) => button.textContent?.includes("Создать и открыть"));
    if (!modal
      || modes.length !== 2
      || !modal.textContent?.includes("Создать сценарий по промту")
      || !modal.textContent?.includes("Вставить готовый сценарий")
      || !modal.textContent?.includes("Голос и расчёт длительности")
      || !create?.disabled) return false;
    modes.find((button) => button.textContent?.includes("Вставить готовый сценарий"))?.click();
    setValue(modal.querySelector("input[placeholder='Рабочее название ролика']"), "Ready Script Smoke");
    setValue(modal.querySelector("textarea"), "Первая фраза задаёт вопрос. Вторая фраза раскрывает ответ и завершает историю.");
    const calibrate = [...modal.querySelectorAll("button")].find((button) => button.textContent?.includes("Озвучить и измерить"));
    if (!calibrate || calibrate.disabled) return false;
    calibrate.click();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(25);
      if (modal.querySelector(".voice-calibration-stats")) break;
    }
    const ready = Boolean(
      modal.querySelector(".voice-calibration-stats")?.textContent?.includes("готовый текст ≈")
      && create && !create.disabled
    );
    modal.querySelector(".channel-dialog-header .icon-button")?.click();
    return ready;
  })()`);
  if (!calibratedVideoDialogReady) fail("новый ролик не требует голос, тестовую озвучку и один из двух режимов сценария");
  await trace("calibrated-video-dialog-ready");

  await window.webContents.executeJavaScript("document.querySelector('[data-nav-key=\"projects\"]')?.click()");
  await wait(150);
  await trace("projects-ready");

  const created = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Новый ролик"));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!created) fail("кнопка создания проекта не найдена");
  await wait(350);

  const briefReady = await window.webContents.executeJavaScript(`(() => {
    const title = document.querySelector('.project-brief-card input');
    const topic = document.querySelector('.project-brief-card textarea');
    if (document.querySelector('[data-flow-step="brief"]')?.getAttribute("aria-current") !== "step" || !title || !topic) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(title, "Workflow Smoke Project");
    title.dispatchEvent(new Event("input", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(topic, "Проверка понятного пути создания ролика");
    topic.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!briefReady) fail("новый ролик не открылся на этапе задания");
  await wait(80);
  const scenarioStageOpened = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-flow-step="scenario"]');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!scenarioStageOpened) fail("этап сценария не стал доступен после заполнения задания");
  await wait(300);

  const scenarioOpened = await window.webContents.executeJavaScript("document.body.innerText.includes('Редактор сценария')");
  if (!scenarioOpened) fail("редактор сценария не открылся");
  const scenarioWorkflowReady = await window.webContents.executeJavaScript(`(() => {
    const steps = [...document.querySelectorAll("[data-flow-step]")];
    return steps.length === 7
      && document.querySelector('[data-flow-step="scenario"]')?.getAttribute("aria-current") === "step"
      && document.querySelector('[data-flow-step="production"]')?.disabled;
  })()`);
  if (!scenarioWorkflowReady) fail("строка из 7 этапов не появилась в редакторе сценария");
  await trace("scenario-opened");

  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Добавить сцену"));
    button?.click();
  })()`);
  await wait(150);

  const filled = await window.webContents.executeJavaScript(`(() => {
    const setValue = (element, value) => {
      if (!element) return false;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    };
    const title = document.querySelector(".scene-editor input[type='text'], .scene-editor input:not([type])");
    const duration = document.querySelector(".scene-editor input[type='number']");
    const textareas = [...document.querySelectorAll(".scene-editor textarea")];
    return setValue(title, "Тестовая сцена")
      && setValue(duration, "7")
      && setValue(textareas[0], "Тестовый текст озвучки")
      && setValue(textareas[1], "Космический кот у иллюминатора")
      && setValue(textareas[2], "Плавный наезд камеры");
  })()`);
  if (!filled) fail("поля сцены не заполнены");
  await trace("scene-filled");
  await wait(80);

  const materialsOpened = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-flow-step="materials"]');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!materialsOpened) fail("этап материалов не стал доступен после заполнения сценария");
  await wait(250);
  const materialsReady = await window.webContents.executeJavaScript(`document.body.innerText.includes('Проверка stock')
    && document.body.innerText.includes('ручная замена не обязательна')
    && document.body.innerText.includes('Здесь не нужно заполнять сцены вручную')
    && document.body.innerText.includes('Найти stock')
    && document.querySelector('[data-flow-step="materials"]')?.getAttribute("aria-current") === "step"`);
  if (!materialsReady) fail("необязательная ручная проверка Stock не открылась через строку этапов");
  const stockPickerReady = await window.webContents.executeJavaScript(`(async () => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Найти stock"));
    if (!button) return false;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const modal = document.querySelector(".stock-picker-modal");
    const options = [...(modal?.querySelectorAll("select") ?? [])].flatMap((select) => [...select.options].map((option) => option.value));
    const ready = Boolean(modal?.textContent?.includes("Pexels") && modal?.textContent?.includes("Pixabay") && options.includes("image") && options.includes("video"));
    modal?.querySelector(".modal-close")?.click();
    return ready;
  })()`);
  if (!stockPickerReady) fail("ручной выбор Pexels/Pixabay для сцены не открылся");
  await window.webContents.executeJavaScript("document.querySelector('[data-flow-step=\"scenario\"]')?.click()");
  await wait(120);
  await window.webContents.executeJavaScript("document.querySelector('[data-flow-step=\"settings\"]')?.click()");
  await wait(250);

  const simplifiedProjectState = await window.webContents.executeJavaScript(`(() => {
    const collapsed = document.querySelectorAll(".settings-panel.collapsible.collapsed").length;
    const materialsPanel = [...document.querySelectorAll(".settings-panel")]
      .find((item) => item.querySelector("h2")?.textContent?.includes("МАТЕРИАЛЫ И ИЗОБРАЖЕНИЯ"));
    const materialsText = materialsPanel?.textContent ?? "";
    const ready = collapsed >= 1
      && !document.querySelector(".preset-bar")
      && document.body.innerText.includes("Основные настройки ролика")
      && document.body.innerText.includes("Отменить несохранённые изменения")
      && materialsText.includes("Stock подбирается автоматически")
      && materialsText.includes("Pexels + Pixabay")
      && materialsText.includes("ручной выбор не обязателен")
      && materialsText.includes("Проверить / заменить вручную")
      && materialsText.includes("Подобрать stock без запуска")
      && materialsText.includes("Автоподобрать stock и собрать")
      && !materialsText.includes("Mock Image");
    return { ready, collapsed, materialsText };
  })()`);
  if (!simplifiedProjectState.ready) fail(`pure Stock не показывает автоподбор и необязательную ручную замену: ${JSON.stringify(simplifiedProjectState)}`);

  const photoMotionReady = await window.webContents.executeJavaScript(`(() => {
    const panel = [...document.querySelectorAll(".settings-panel")]
      .find((item) => item.querySelector("h2")?.textContent?.includes("ДВИЖЕНИЕ КАРТИНОК"));
    const select = panel?.querySelector("select");
    const options = select ? [...select.options].map((option) => option.value) : [];
    const aiVideoPanel = [...document.querySelectorAll(".settings-panel")]
      .find((item) => item.querySelector("h2")?.textContent?.includes("AI ВИДЕО"));
    return Boolean(panel?.classList.contains("open")
      && !panel.classList.contains("collapsible")
      && select
      && JSON.stringify(options) === JSON.stringify(["off", "alternate", "smart"])
      && !aiVideoPanel
      && !document.body.innerText.includes("AI ВИДЕО И ЭФФЕКТЫ"));
  })()`);
  if (!photoMotionReady) fail("pure Stock должен показывать движение фото и полностью скрывать AI-video panel");

  const projectSaveBeforeLeave = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const input = document.querySelector('.editor-grid .field input');
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Workflow Saved Project");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(30);
    document.querySelector('[data-flow-step="scenario"]')?.click();
    await wait(180);
    if (!document.body.innerText.includes("Редактор сценария")) return false;
    document.querySelector('[data-flow-step="settings"]')?.click();
    await wait(180);
    return document.querySelector('.editor-grid .field input')?.value === "Workflow Saved Project";
  })()`);
  if (!projectSaveBeforeLeave) fail("изменения проекта не сохранились при переходе по этапам");

  const stockStartReady = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")]
      .find((item) => item.textContent?.includes("Автоподобрать stock и собрать"));
    return Boolean(button && !button.disabled);
  })()`);
  if (!stockStartReady) fail("главная кнопка автоподбора Stock должна быть активна до ручного выбора материалов");

  const generated = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")]
      .find((item) => item.textContent?.includes("Автоподобрать stock и собрать"));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!generated) fail("кнопка автоподбора Stock не запустилась");
  await trace("auto-stock-clicked");

  let autoStockProgressVisible = false;
  for (let attempt = 0; attempt < 20 && !autoStockProgressVisible; attempt += 1) {
    autoStockProgressVisible = await window.webContents.executeJavaScript(`(() => {
      const toast = document.querySelector(".auto-stock-toast");
      return Boolean(toast?.textContent?.includes("Автоподбор stock") && toast.textContent?.includes("из 1"));
    })()`);
    if (!autoStockProgressVisible) await wait(12);
  }
  if (!autoStockProgressVisible) fail("прогресс автоматического подбора Stock не появился");
  await trace("auto-stock-progress-ready");

  let stockQueueOpened = false;
  for (let attempt = 0; attempt < 40 && !stockQueueOpened; attempt += 1) {
    stockQueueOpened = await window.webContents.executeJavaScript("document.body.innerText.includes('Локальный конвейер')");
    if (!stockQueueOpened) await wait(25);
  }
  if (!stockQueueOpened) fail("после автоподбора Stock приложение не перешло в очередь");

  const autoStockProjectReady = await window.webContents.executeJavaScript(`(async () => {
    const fallbackModuleUrl = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => name.includes("/src/fallback-api.ts"));
    const { fallbackApi } = await import(fallbackModuleUrl ?? "/src/fallback-api.ts");
    const project = (await fallbackApi.listProjects()).find((item) => item.title === "Workflow Saved Project");
    const included = project?.scenes.filter((scene) => scene.includeInAssembly !== false) ?? [];
    return Boolean(project?.mediaMode === "stock"
      && included.length === 1
      && included.every((scene) => scene.stockSource?.mediaType === "image" && scene.imagePath));
  })()`);
  if (!autoStockProjectReady) fail("автоподбор не сохранил материалы Stock перед постановкой в очередь");

  const globalProgressReady = await window.webContents.executeJavaScript(`(() => {
    const bar = document.querySelector(".global-progress");
    const stages = bar?.querySelectorAll(".global-progress-stages button");
    return Boolean(bar && stages && stages.length >= 2 && bar.textContent?.includes("%"));
  })()`);
  if (!globalProgressReady) fail("global progress bar did not appear");
  await window.webContents.executeJavaScript("document.querySelector('.global-progress-head')?.click()");
  await wait(50);
  const progressCollapsed = await window.webContents.executeJavaScript("Boolean(document.querySelector('.global-progress.collapsed'))");
  if (!progressCollapsed) fail("global progress bar does not collapse");
  await window.webContents.executeJavaScript("document.querySelector('.global-progress-head')?.click()");
  await trace("global-progress-ready");
  await wait(900);

  const queueText = await window.webContents.executeJavaScript("document.body.innerText");
  if (!queueText.includes("Локальный конвейер") || !queueText.includes("Сборка Final.mp4")) fail("задачи не появились в очереди");
  if (queueText.includes("AI-видео · сцена 1") || queueText.includes("Изображение · сцена 1")) fail("pure Stock ошибочно поставил AI-медиа в очередь");
  const productionWorkflowReady = await window.webContents.executeJavaScript(`(() => {
    const current = document.querySelector('[data-flow-step="production"]');
    return document.querySelectorAll('[data-flow-step]').length === 7
      && current?.getAttribute("aria-current") === "step"
      && ["current", "running", "error"].includes(current?.closest("li")?.dataset.flowStatus ?? "");
  })()`);
  if (!productionWorkflowReady) fail("очередь не показывает текущий этап производства");
  await trace("queue-ready");

  const paused = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(".queue-project-controls button");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!paused) fail("кнопка паузы не найдена");
  await wait(250);
  const pauseVisible = await window.webContents.executeJavaScript("document.body.innerText.includes('Продолжить')");
  if (!pauseVisible) fail("очередь не перешла на паузу");
  await trace("pause-ready");

  await window.webContents.executeJavaScript("document.querySelector('.queue-project-controls button')?.click()");
  await wait(350);

  await mkdir(captureDirectory, { recursive: true });
  window.webContents.invalidate();
  await wait(300);
  const image = await window.webContents.capturePage();
  await writeFile(capturePath, image.toPNG());
  await trace("capture-written");

  await window.webContents.executeJavaScript("document.querySelector('[data-nav-key=\"projects\"]')?.click()");
  await wait(250);
  await window.webContents.executeJavaScript("document.querySelector('.projects-table-row')?.click()");
  await wait(80);
  const previewOpened = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Предпросмотр"));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!previewOpened) fail("кнопка предпросмотра не найдена");
  await wait(250);
  const modalOpened = await window.webContents.executeJavaScript("Boolean(document.querySelector('.preview-modal'))");
  if (!modalOpened) fail("окно предпросмотра не открылось");
  const previewWorkflowReady = await window.webContents.executeJavaScript(
    "Boolean(document.querySelector('.preview-modal [data-flow-step=\"editor\"][aria-current=\"step\"], .preview-modal [data-flow-step=\"export\"][aria-current=\"step\"]'))",
  );
  if (!previewWorkflowReady) fail("предпросмотр не показывает этап редактора или экспорта");
  const sceneControlsReady = await window.webContents.executeJavaScript(`(() => {
    const text = document.querySelector(".preview-modal")?.textContent ?? "";
    return text.includes("Перегенерировать сцену") && text.includes("Открыть папку");
  })()`);
  if (!sceneControlsReady) fail("кнопки папки и перегенерации сцены не появились");
  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll(".preview-modal button")].find((item) => item.textContent?.includes("Открыть таймлайн"));
    button?.click();
  })()`);
  await wait(250);
  const timelineOpened = await window.webContents.executeJavaScript("Boolean(document.querySelector('.timeline-studio'))");
  if (!timelineOpened) fail("таймлайн не открылся");
  const editorWorkflowReady = await window.webContents.executeJavaScript(
    "document.querySelector('.timeline-studio [data-flow-step=\"editor\"]')?.getAttribute('aria-current') === 'step'",
  );
  if (!editorWorkflowReady) fail("таймлайн не показывает этап редактора");
  const timelineClean = await window.webContents.executeJavaScript(
    "!document.querySelector('.timeline-transition-marker') && Boolean(document.querySelector('.timeline-grid-track.video-track'))",
  );
  if (!timelineClean) fail("на таймлайне остались мешающие маркеры переходов");
  window.webContents.invalidate();
  await wait(250);
  const previewImage = await window.webContents.capturePage();
  await writeFile(previewCapturePath, previewImage.toPNG());
  await trace("preview-capture-written");
  await window.webContents.executeJavaScript("document.querySelector('.timeline-topbar > .timeline-icon-button')?.click()");
  await wait(150);

  const largeTimelineProjectId = await window.webContents.executeJavaScript(`(async () => {
    const fallbackModuleUrl = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => name.includes("/src/fallback-api.ts"));
    const { fallbackApi } = await import(fallbackModuleUrl ?? "/src/fallback-api.ts");
    const project = await fallbackApi.createProject({
      title: "UI smoke — 200 сцен",
      topic: "Проверка производительности таймлайна",
      aspectRatio: "16:9",
      language: "Русский",
      mode: "standard"
    });
    const scenes = Array.from({ length: 200 }, (_, order) => ({
      id: "perf-scene-" + order,
      order,
      title: "Сцена " + (order + 1),
      narration: "Короткий текст сцены " + (order + 1),
      imagePrompt: "Тестовый кадр " + (order + 1),
      animationPrompt: "Плавное движение камеры",
      durationSeconds: 6,
      status: "draft"
    }));
    await fallbackApi.updateProject(project.id, { scenes });
    return project.id;
  })()`);
  if (!largeTimelineProjectId) fail("не удалось создать проект на 200 сцен для проверки таймлайна");
  await wait(900);
  const largeTimelineOpened = await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-nav-key="projects"]')?.click();
    return true;
  })()`);
  if (!largeTimelineOpened) fail("раздел проектов не открылся");
  await wait(150);
  let largeProjectExpanded = false;
  for (let attempt = 0; attempt < 12 && !largeProjectExpanded; attempt += 1) {
    largeProjectExpanded = await window.webContents.executeJavaScript(`(() => {
      const row = [...document.querySelectorAll(".projects-table-row")].find((item) => item.textContent?.includes("UI smoke — 200 сцен"));
      if (!row) return false;
      row.click();
      return true;
    })()`);
    if (!largeProjectExpanded) await wait(200);
  }
  if (!largeProjectExpanded) {
    const largeProjectDebug = await window.webContents.executeJavaScript(`(async () => {
      const fallbackModuleUrl = performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => name.includes("/src/fallback-api.ts"));
      const { fallbackApi } = await import(fallbackModuleUrl ?? "/src/fallback-api.ts");
      return {
        stored: (await fallbackApi.listProjects()).map((project) => project.title),
        visible: [...document.querySelectorAll(".projects-table-row")].map((row) => row.textContent),
        page: document.body.innerText.slice(0, 800)
      };
    })()`);
    fail(`проект на 200 сцен не появился: ${JSON.stringify(largeProjectDebug)}`);
  }
  await wait(80);
  const largeTimelineClicked = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll(".project-expand button")].find((item) => item.textContent?.includes("Таймлайн"));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!largeTimelineClicked) fail("таймлайн проекта на 200 сцен не открылся");
  await wait(250);
  const largeTimelineReady = await window.webContents.executeJavaScript(`(async () => {
    const clips = document.querySelectorAll(".timeline-grid-track.video-track .timeline-clip").length;
    const markers = document.querySelectorAll(".timeline-transition-marker").length;
    const zoom = document.querySelector(".timeline-zoom input");
    if (!zoom) return { clips, markers, zoomReady: false, elapsed: 9999 };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const startedAt = performance.now();
    for (let value = 8; value <= 160; value += 2) {
      setter.call(zoom, String(value));
      zoom.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const zoomValue = Number(zoom.value);
    const canvas = document.querySelector(".timeline-canvas");
    const scroll = document.querySelector(".timeline-scroll");
    const canvasWidth = parseFloat(canvas?.style.width ?? "0");
    if (scroll) {
      scroll.scrollLeft = canvasWidth / 2;
      scroll.dispatchEvent(new Event("scroll"));
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    const scrolledClips = document.querySelectorAll(".timeline-grid-track.video-track .timeline-clip").length;
    const firstVisibleScene = Number(document.querySelector(".timeline-grid-track.video-track .timeline-clip i")?.textContent ?? "0");
    return { clips, markers, zoomReady: zoomValue === 160 && canvasWidth >= 150000, zoomValue, canvasWidth, scrollLeft: scroll?.scrollLeft ?? -1, scrollWidth: scroll?.scrollWidth ?? -1, clientWidth: scroll?.clientWidth ?? -1, scrolledClips, firstVisibleScene, elapsed: performance.now() - startedAt };
  })()`);
  if (largeTimelineReady.clips < 1 || largeTimelineReady.clips > 80 || largeTimelineReady.scrolledClips < 1 || largeTimelineReady.scrolledClips > 80 || largeTimelineReady.firstVisibleScene < 50 || largeTimelineReady.markers !== 0 || !largeTimelineReady.zoomReady || largeTimelineReady.elapsed > 1500) {
    fail(`таймлайн на 200 сцен работает некорректно: ${JSON.stringify(largeTimelineReady)}`);
  }
  const largeTimelinePlayback = await window.webContents.executeJavaScript(`(async () => {
    const play = document.querySelector(".timeline-transport .play");
    if (!play) return { frames: 0, transform: "" };
    play.click();
    const startedAt = performance.now();
    let frames = 0;
    while (performance.now() - startedAt < 450) {
      await new Promise(requestAnimationFrame);
      frames += 1;
    }
    const transform = document.querySelector(".timeline-playhead")?.style.transform ?? "";
    play.click();
    return { frames, transform };
  })()`);
  if (largeTimelinePlayback.frames < 8 || !largeTimelinePlayback.transform || largeTimelinePlayback.transform === "translateX(0px)") {
    fail(`предпросмотр на 200 сцен не обновляется плавно: ${JSON.stringify(largeTimelinePlayback)}`);
  }
  await trace(`large-timeline-ready ${JSON.stringify({ ...largeTimelineReady, playback: largeTimelinePlayback })}`);
  await window.webContents.executeJavaScript("document.querySelector('.timeline-topbar > .timeline-icon-button')?.click()");
  await wait(100);

  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-nav-key="director"]');
    button?.click();
  })()`);
  await wait(250);
  const directorOpened = await window.webContents.executeJavaScript(
    "document.body.innerText.includes('AI-генератор ролика')",
  );
  if (!directorOpened) fail("AI-генератор не открылся");

  await window.webContents.executeJavaScript("document.querySelector('.settings-link')?.click()");
  await wait(100);
  await window.webContents.executeJavaScript(`(() => {
    [...document.querySelectorAll(".settings-menu button")].find((item) => item.textContent?.includes("Stock"))?.click();
  })()`);
  await wait(100);
  const stockSettingsReady = await window.webContents.executeJavaScript(`(() => {
    const text = document.querySelector(".settings-content-v2")?.textContent ?? "";
    return text.includes("Pexels")
      && text.includes("Pixabay")
      && text.includes("24 часа")
      && document.querySelectorAll(".stock-provider-card input[type='password']").length === 2;
  })()`);
  if (!stockSettingsReady) fail("настройки API-ключей Pexels/Pixabay не отображаются");
  await window.webContents.executeJavaScript(`(() => {
    [...document.querySelectorAll(".settings-menu button")].find((item) => item.textContent?.includes("YouTube"))?.click();
  })()`);
  await wait(100);
  await window.webContents.executeJavaScript("document.querySelector('.settings-technical-details summary')?.click()");
  await wait(50);
  const youtubeCookiesSettingsReady = await window.webContents.executeJavaScript(
    "document.body.innerText.includes('yt-dlp: cookies и временная папка') && document.body.innerText.includes('Выбрать cookies.txt')",
  );
  if (!youtubeCookiesSettingsReady) fail("настройка YouTube cookies.txt не отображается");
  await window.webContents.executeJavaScript(`(() => {
    [...document.querySelectorAll(".settings-menu button")].find((item) => item.textContent?.includes("AnyModel"))?.click();
  })()`);
  await wait(80);
  const mockProviderConfigured = await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.settings-content-v2 input[type="password"]');
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "ui-smoke-key");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!mockProviderConfigured) fail("поле ключа провайдера не найдено");
  await wait(50);
  await window.webContents.executeJavaScript(`(() => {
    [...document.querySelectorAll(".settings-content button")].find((item) => item.textContent?.includes("Сохранить"))?.click();
  })()`);
  await wait(100);
  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-nav-key="director"]')?.click();
  })()`);
  await wait(100);
  const streamPromptReady = await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(".chat-composer textarea");
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, "Проверка потокового ответа");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!streamPromptReady) fail("поле потокового чата не найдено");
  await wait(50);
  await window.webContents.executeJavaScript("document.querySelector('.chat-composer .send')?.click()");
  await wait(10);
  const thinkingVisible = await window.webContents.executeJavaScript("Boolean(document.querySelector('.thinking-message'))");
  if (!thinkingVisible) fail("индикатор «Нейронка думает» не появился");
  const stopButtonVisible = await window.webContents.executeJavaScript("Boolean(document.querySelector('.chat-composer .send.stop'))");
  if (!stopButtonVisible) fail("кнопка остановки AI-запроса не появилась");
  await window.webContents.executeJavaScript("document.querySelector('.chat-composer .send.stop')?.click()");
  await wait(100);
  const cancelledVisible = await window.webContents.executeJavaScript("document.body.innerText.includes('Операция остановлена')");
  if (!cancelledVisible) fail("остановка AI-запроса не завершила активный поток");
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(".chat-composer textarea");
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, "Повторная проверка потокового ответа");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await wait(20);
  await window.webContents.executeJavaScript("document.querySelector('.chat-composer .send')?.click()");
  await wait(55);
  const streamStarted = await window.webContents.executeJavaScript("Boolean(document.querySelector('.streaming-message')?.textContent)");
  if (!streamStarted) fail("потоковый ответ не начал появляться");
  await wait(160);
  const streamFinished = await window.webContents.executeJavaScript("document.body.innerText.includes('Браузерный потоковый mock-ответ.')");
  if (!streamFinished) fail("потоковый ответ не завершился");
  await trace("director-stream-ready");
  await window.webContents.executeJavaScript(`(() => {
    [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("История"))?.click();
  })()`);
  await wait(80);
  const savedTopicReady = await window.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector(".chat-history-panel");
    return Boolean(panel && panel.querySelectorAll(":scope > div").length === 1 && panel.textContent?.includes("сообщ."));
  })()`);
  if (!savedTopicReady) fail("director chat topic was not saved in history");
  await trace("chat-topic-history-ready");
  await window.webContents.executeJavaScript(`(() => {
    [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Новый")?.click();
  })()`);
  await wait(100);

  const nicheClicked = await window.webContents.executeJavaScript(`(() => {
    const niche = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Анализ ниши"));
    if (!niche) return false;
    niche.click();
    return true;
  })()`);
  if (!nicheClicked) fail("кнопка анализа ниши не найдена");
  await wait(100);
  const directorControlsReady = await window.webContents.executeJavaScript(
    "Boolean(document.querySelector('.chat-composer textarea')?.value.includes('Проанализируй нишу'))",
  );
  if (!directorControlsReady) fail("кнопки AI-генератора не работают");
  await trace("director-controls-ready");

  const referenceSent = await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(".chat-composer textarea");
    const send = document.querySelector(".chat-composer .send");
    if (!input || !send) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, "https://youtube.com/watch?v=smoke сделай сильный хук");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!referenceSent) fail("поле ссылки на референс не найдено");
  await wait(100);
  await window.webContents.executeJavaScript("document.querySelector('.chat-composer .send')?.click()");
  await wait(350);
  const referenceReady = await window.webContents.executeJavaScript(`(() => {
    const card = document.querySelector(".reference-analysis");
    const youtube = document.querySelector(".youtube-analysis-details");
    return Boolean(
      card?.textContent?.includes("УЛУЧШЕННЫЙ ХУК")
      && card?.textContent?.includes("6 сцен")
      && youtube?.textContent?.includes("ТРАНСКРИПТ С ТАЙМКОДАМИ")
      && youtube?.textContent?.includes("ТОП-КОММЕНТАРИИ")
      && youtube?.textContent?.includes("подписчиков")
      && youtube?.textContent?.includes("Кадры ролика не анализировались")
    );
  })()`);
  if (!referenceReady) fail("разбор ссылки на ролик не появился");
  const projectBarReady = await window.webContents.executeJavaScript(
    "Boolean(document.querySelector('.director-project-bar')?.textContent?.includes('проект'))",
  );
  if (!projectBarReady) fail("закреплённая кнопка переноса чата в проект не появилась");
  window.webContents.invalidate();
  await wait(150);
  const directorImage = await window.webContents.capturePage();
  await writeFile(directorCapturePath, directorImage.toPNG());
  const projectIntentSent = await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(".chat-composer textarea");
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, "добавь сценарий и промпты из чата в проект");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!projectIntentSent) fail("команда переноса диалога в проект не отправилась");
  await wait(50);
  await window.webContents.executeJavaScript("document.querySelector('.chat-composer .send')?.click()");
  await wait(220);
  const projectIntentHandled = await window.webContents.executeJavaScript(
    "Boolean(document.querySelector('.topic-modal')?.textContent?.includes('Создать и открыть проект'))",
  );
  if (!projectIntentHandled) fail("чат не распознал команду переноса сценария и промптов в проект");
  await window.webContents.executeJavaScript("document.querySelector('.topic-modal .modal-close')?.click()");
  await wait(80);
  await trace("reference-analysis-ready");

  // После готового сценария остаётся одно закреплённое действие, без дублей в карточках.
  const singleProjectAction = await window.webContents.executeJavaScript(`(() => {
    const pinned = document.querySelector(".director-project-bar .generate-button");
    const duplicate = document.querySelector(".reference-analysis footer .generate-button, .chat-ready-scenario .generate-button");
    return Boolean(pinned?.textContent?.includes("Создать и открыть проект") && !duplicate);
  })()`);
  if (!singleProjectAction) fail("действие создания проекта дублируется или имеет непонятное название");
  let referenceProjectCreated = false;
  for (let attempt = 0; attempt < 20 && !referenceProjectCreated; attempt += 1) {
    referenceProjectCreated = await window.webContents.executeJavaScript(`(() => {
      const button = document.querySelector(".director-project-bar .generate-button");
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!referenceProjectCreated) await wait(300);
  }
  if (!referenceProjectCreated) fail("кнопка создания проекта из YouTube-разбора не активировалась");
  await trace("project-action-clicked");
  await wait(1500);
  // Генерация больше не стартует сама: после выбора темы открывается проект с кнопкой запуска.
  await wait(1500);
  const afterBuildText = await window.webContents.executeJavaScript("document.body.innerText");
  if (!afterBuildText.includes("Редактор сценария")
    && !afterBuildText.includes("Генерировать видео")
    && !afterBuildText.includes("Собрать ролик")
    && !afterBuildText.includes("Автоподобрать stock и собрать")
    && !afterBuildText.includes("Сценарий собирается")) {
    const chatTail = await window.webContents.executeJavaScript("document.querySelector('.chat-area')?.innerText.slice(-700) ?? 'нет .chat-area'");
    await trace(`after-build chat tail: ${chatTail.replace(/\n+/g, " | ")}`);
    fail("проект из YouTube-разбора не открылся");
  }
  await trace("youtube-analysis-project-opened");

  // Новый путь намеренно открывает сначала сценарий для проверки текста и героя.
  await window.webContents.executeJavaScript("document.querySelector('[data-flow-step=\"settings\"]')?.click()");
  await wait(220);
  const voiceCalibrated = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const button = [...document.querySelectorAll("button")]
      .find((item) => item.textContent?.includes("Озвучить тест и измерить скорость"));
    if (!button || button.disabled) return false;
    button.click();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(25);
      if (document.querySelector(".voice-calibration-ready-line")) return true;
    }
    return false;
  })()`);
  if (!voiceCalibrated) fail("перед повторной сборкой сценария не удалось измерить выбранный голос");
  await wait(180);
  const chatTopicSelected = await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector(".chat-topic-source select");
    const option = select?.querySelector("option:not([value=''])");
    if (!select || !option) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!chatTopicSelected) fail("saved chat topic is not available in project");
  await wait(60);
  const chatTopicStockStarted = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(".chat-topic-source .generate-button");
    if (!button || button.disabled || !button.textContent?.includes("автоподобрать stock")) return false;
    button.click();
    return true;
  })()`);
  if (!chatTopicStockStarted) fail("поздний сценарий из chat topic не запустил автоподбор Stock");

  let chatTopicQueued = false;
  for (let attempt = 0; attempt < 60 && !chatTopicQueued; attempt += 1) {
    chatTopicQueued = await window.webContents.executeJavaScript(`(() => {
      const production = document.querySelector('[data-flow-step="production"]');
      const materials = document.querySelector('[data-flow-step="materials"]');
      return document.body.innerText.includes("Локальный конвейер")
        && production?.getAttribute("aria-current") === "step"
        && materials?.getAttribute("aria-current") !== "step";
    })()`);
    if (!chatTopicQueued) await wait(25);
  }
  if (!chatTopicQueued) fail("поздний Stock-сценарий из chat topic ошибочно потребовал обязательный этап Materials");

  const chatTopicStockReady = await window.webContents.executeJavaScript(`(async () => {
    const fallbackModuleUrl = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => name.includes("/src/fallback-api.ts"));
    const { fallbackApi } = await import(fallbackModuleUrl ?? "/src/fallback-api.ts");
    const project = (await fallbackApi.listProjects())[0];
    const included = project?.scenes.filter((scene) => scene.includeInAssembly !== false) ?? [];
    return Boolean(project?.mediaMode === "stock"
      && included.length === 3
      && included.every((scene) => scene.stockSource && (scene.imagePath || scene.videoPath)));
  })()`);
  if (!chatTopicStockReady) fail("автоподбор не заполнил сцены позднего chat-topic проекта");
  await trace("chat-topic-stock-auto-queued");

  await window.webContents.executeJavaScript("document.querySelector('.settings-link')?.click()");
  await wait(250);
  const overviewReady = await window.webContents.executeJavaScript(`(() => {
    const overview = [...document.querySelectorAll(".settings-menu button")].find((item) => item.textContent?.includes("Обзор"));
    overview?.click();
    return Boolean(overview);
  })()`);
  if (!overviewReady) fail("обзор настроек не найден");
  await wait(100);
  const providerOverviewReady = await window.webContents.executeJavaScript(`(() => {
    const text = document.querySelector(".provider-overview-list")?.textContent ?? "";
    return ["AnyModel", "Lumean", "Google Flow", "Stock", "YouTube", "Сборка и хранение"].every((label) => text.includes(label));
  })()`);
  if (!providerOverviewReady) fail("обзор не показывает все основные подключения");
  window.webContents.invalidate();
  await wait(120);
  const settingsImage = await window.webContents.capturePage();
  await writeFile(settingsCapturePath, settingsImage.toPNG());
  const settingsTabClicked = await window.webContents.executeJavaScript(`(() => {
    const ai = [...document.querySelectorAll(".settings-menu button")].find((item) => item.textContent?.includes("AnyModel"));
    if (!ai) return false;
    ai.click();
    return true;
  })()`);
  if (!settingsTabClicked) fail("вкладка AnyModel не найдена");
  await wait(100);
  const settingsTabsReady = await window.webContents.executeJavaScript(
    `(() => {
      const content = document.querySelector(".settings-content-v2");
      const navigation = document.querySelector(".settings-menu-v2");
      return Boolean(
        content?.textContent?.includes("Модель выбирается в самом чате")
        && content.querySelectorAll(".settings-field-v2 input").length === 1
        && !content.textContent?.includes("Модель транскрипции")
        && !content.textContent?.includes("Текстовая модель")
        && !navigation?.textContent?.includes("Дополнительно")
      );
    })()`,
  );
  if (!settingsTabsReady) fail("AnyModel содержит лишние поля или вкладка «Дополнительно» всё ещё отображается");
  await window.webContents.executeJavaScript(`(() => {
    [...document.querySelectorAll(".settings-content-v2 button")].find((item) => item.textContent?.trim() === "Проверить")?.click();
  })()`);
  await wait(120);
  const inlineCheckFeedbackReady = await window.webContents.executeJavaScript(
    "Boolean(document.querySelector('.settings-content-v2 .connection-feedback.phase-error'))",
  );
  if (!inlineCheckFeedbackReady) fail("результат проверки AnyModel не появился рядом с сервисом");
  await window.webContents.executeJavaScript(`(() => {
    [...document.querySelectorAll(".settings-menu button")].find((item) => item.textContent?.includes("Google Flow"))?.click();
  })()`);
  await wait(100);
  const flowSettingsReady = await window.webContents.executeJavaScript(
    "document.querySelector('.settings-content-v2')?.textContent?.includes('Подключённые аккаунты')",
  );
  if (!flowSettingsReady) fail("отдельная вкладка Google Flow не открылась");
  await window.webContents.executeJavaScript(`(() => {
    const storage = [...document.querySelectorAll(".settings-menu button")].find((item) => item.textContent?.includes("Хранение"));
    storage?.click();
  })()`);
  await wait(150);
  const logControlsReady = await window.webContents.executeJavaScript(`(() => {
    const text = document.body.innerText;
    return text.includes("TXT-журнал") && text.includes("Открыть журнал");
  })()`);
  if (!logControlsReady) fail("путь и кнопка TXT-лога не появились в настройках");
  await trace("log-controls-ready");
    console.log(`[ui-smoke] OK ${capturePath}`);
  } finally {
    window.destroy();
    app.quit();
  }
}
