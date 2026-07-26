import { app, BrowserWindow } from "electron";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const targetUrl = process.env.GOLD_WORK_SMOKE_URL ?? "http://127.0.0.1:5173/";
const captureDirectory = join(process.cwd(), "captures");
const capturePath = join(captureDirectory, "ui-smoke.png");
const previewCapturePath = join(captureDirectory, "ui-preview.png");
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
  if (!initialText.includes("Dashboard")) fail("Dashboard не открылся");
  await trace("dashboard-ready");

  const created = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Новый проект"));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!created) fail("кнопка создания проекта не найдена");
  await wait(350);

  const scenarioOpened = await window.webContents.executeJavaScript("document.body.innerText.includes('Редактор сценария')");
  if (!scenarioOpened) fail("редактор сценария не открылся");
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

  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Сохранить сценарий"));
    button?.click();
  })()`);
  await wait(350);

  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll(".nav-item")].find((item) => item.textContent?.trim() === "Субтитры");
    button?.click();
  })()`);
  await wait(250);
  const subtitlesOpened = await window.webContents.executeJavaScript("document.body.innerText.includes('Студия субтитров')");
  if (!subtitlesOpened) fail("студия субтитров не открылась");
  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Сохранить стиль"));
    button?.click();
  })()`);
  await wait(250);
  await trace("subtitles-ready");

  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll(".nav-item")].find((item) => item.textContent?.trim() === "Проект");
    button?.click();
  })()`);
  await wait(250);

  const generated = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Генерировать видео"));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!generated) fail("кнопка запуска генерации не найдена");
  await trace("generation-clicked");
  await wait(200);
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

  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll(".nav-item")].find((item) => item.textContent?.trim() === "Dashboard");
    button?.click();
  })()`);
  await wait(250);
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
  const timelineOpened = await window.webContents.executeJavaScript("Boolean(document.querySelector('.timeline-tracks'))");
  if (!timelineOpened) fail("таймлайн не открылся");
  window.webContents.invalidate();
  await wait(250);
  const previewImage = await window.webContents.capturePage();
  await writeFile(previewCapturePath, previewImage.toPNG());
  await trace("preview-capture-written");
  await window.webContents.executeJavaScript("document.querySelector('.modal-close')?.click()");
  await wait(150);

  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll(".nav-item")].find((item) => item.textContent?.includes("AI Генератор"));
    button?.click();
  })()`);
  await wait(250);
  const directorOpened = await window.webContents.executeJavaScript(
    "document.body.innerText.includes('AI Генератор пресетов')",
  );
  if (!directorOpened) fail("AI-генератор не открылся");

  await window.webContents.executeJavaScript("document.querySelector('.settings-link')?.click()");
  await wait(100);
  await window.webContents.executeJavaScript(`(() => {
    [...document.querySelectorAll(".settings-menu button")].find((item) => item.textContent?.includes("AI и сценарии"))?.click();
  })()`);
  await wait(100);
  const youtubeCookiesSettingsReady = await window.webContents.executeJavaScript(
    "document.body.innerText.includes('Авторизация yt-dlp') && document.body.innerText.includes('Выбрать cookies.txt')",
  );
  if (!youtubeCookiesSettingsReady) fail("настройка YouTube cookies.txt не отображается");
  const mockProviderConfigured = await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.settings-content input[type="password"]');
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
    [...document.querySelectorAll(".nav-item")].find((item) => item.textContent?.includes("AI Генератор"))?.click();
  })()`);
  await wait(100);
  const streamPromptReady = await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(".chat-composer input");
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Проверка потокового ответа");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!streamPromptReady) fail("поле потокового чата не найдено");
  await wait(50);
  await window.webContents.executeJavaScript("document.querySelector('.chat-composer .send')?.click()");
  await wait(10);
  const thinkingVisible = await window.webContents.executeJavaScript("Boolean(document.querySelector('.thinking-message'))");
  if (!thinkingVisible) fail("индикатор «Нейронка думает» не появился");
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
    "Boolean(document.querySelector('.chat-composer input')?.value.includes('Проанализируй нишу'))",
  );
  if (!directorControlsReady) fail("кнопки AI-генератора не работают");
  await trace("director-controls-ready");

  const referenceSent = await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(".chat-composer input");
    const send = document.querySelector(".chat-composer .send");
    if (!input || !send) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "https://youtube.com/watch?v=smoke сделай сильный хук");
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
  await trace("reference-analysis-ready");

  // Кнопка разблокируется после «допечатывания» ответа чата — ждём активную и кликаем.
  let referenceProjectCreated = false;
  for (let attempt = 0; attempt < 20 && !referenceProjectCreated; attempt += 1) {
    referenceProjectCreated = await window.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll(".reference-analysis button")].find((item) => (item.textContent?.includes("Написать сценарий") || item.textContent?.includes("Согласен")) && !item.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!referenceProjectCreated) await wait(300);
  }
  if (!referenceProjectCreated) fail("кнопка создания проекта из YouTube-разбора не активировалась");
  await wait(1200);
  // Генерация больше не стартует сама: после выбора темы открывается проект с кнопкой запуска.
  await wait(1500);
  const afterBuildText = await window.webContents.executeJavaScript("document.body.innerText");
  if (!afterBuildText.includes("Генерировать видео") && !afterBuildText.includes("Сценарий собирается")) {
    const chatTail = await window.webContents.executeJavaScript("document.querySelector('.chat-area')?.innerText.slice(-700) ?? 'нет .chat-area'");
    await trace(`after-build chat tail: ${chatTail.replace(/\n+/g, " | ")}`);
    fail("проект из YouTube-разбора не открылся");
  }
  await trace("youtube-analysis-project-opened");

  await window.webContents.executeJavaScript(`(() => {
    [...document.querySelectorAll(".nav-item")].find((item) => item.textContent?.trim() === "Проект")?.click();
  })()`);
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
  await window.webContents.executeJavaScript("document.querySelector('.chat-topic-source .generate-button')?.click()");
  await wait(300);
  const topicGenerationStarted = await window.webContents.executeJavaScript(`(() => {
    const text = document.body.innerText;
    return text.includes("Локальный конвейер") && text.includes("Сборка Final.mp4");
  })()`);
  if (!topicGenerationStarted) fail("generation did not start from saved chat topic");
  await trace("chat-topic-generation-ready");

  await window.webContents.executeJavaScript("document.querySelector('.settings-link')?.click()");
  await wait(250);
  const settingsTabClicked = await window.webContents.executeJavaScript(`(() => {
    const ai = [...document.querySelectorAll(".settings-menu button")].find((item) => item.textContent?.includes("AI и сценарии"));
    if (!ai) return false;
    ai.click();
    return true;
  })()`);
  if (!settingsTabClicked) fail("вкладка AI и сценарии не найдена");
  await wait(100);
  const settingsTabsReady = await window.webContents.executeJavaScript(
    "Boolean(document.querySelector('.settings-content')?.textContent?.includes('AnyModel API') && document.querySelector('.settings-content')?.textContent?.includes('YouTube Data API v3'))",
  );
  if (!settingsTabsReady) fail("вкладки настроек не переключаются");
  await window.webContents.executeJavaScript(`(() => {
    const storage = [...document.querySelectorAll(".settings-menu button")].find((item) => item.textContent?.includes("Папки и хранение"));
    storage?.click();
  })()`);
  await wait(150);
  const logControlsReady = await window.webContents.executeJavaScript(`(() => {
    const text = document.body.innerText;
    return text.includes("TXT-лог программы") && text.includes("Открыть TXT-лог");
  })()`);
  if (!logControlsReady) fail("путь и кнопка TXT-лога не появились в настройках");
  await trace("log-controls-ready");
    console.log(`[ui-smoke] OK ${capturePath}`);
  } finally {
    window.destroy();
    app.quit();
  }
}
