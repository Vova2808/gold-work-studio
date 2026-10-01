const cdpPort = Number(process.env.GOLD_WORK_CDP_PORT ?? "9333");
const action = process.argv[2] ?? "snapshot";
const title = process.env.GOLD_WORK_E2E_TITLE ?? "Stock Remotion UI E2E";
const projectId = process.env.GOLD_WORK_E2E_PROJECT_ID ?? "";
const channelName = process.env.GOLD_WORK_E2E_CHANNEL ?? "тест 2";
const prompt = process.env.GOLD_WORK_E2E_PROMPT
  ?? "Как отель организует быструю уборку номера: тележка горничной, ключ-карта, коридор и проверка качества. Короткий практический ролик на русском.";

const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page" && candidate.title === "Gold Work Studio") ?? targets[0];
if (!target?.webSocketDebuggerUrl) throw new Error(`Gold Work Studio CDP page not found on port ${cdpPort}`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let requestId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function call(method, params = {}) {
  const id = ++requestId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(source) {
  const result = await call("Runtime.evaluate", {
    expression: source,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

const helpers = `
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (test, label, timeout = 30000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = test();
      if (value) return value;
      await wait(100);
    }
    throw new Error("Timed out waiting for " + label);
  };
  const clickText = (text, exact = false, root = document) => {
    const item = [...root.querySelectorAll("button")].find((button) => {
      const label = button.textContent?.trim() ?? "";
      return exact ? label === text : label.includes(text);
    });
    if (!item) throw new Error("Button not found: " + text);
    if (item.disabled) throw new Error("Button is disabled: " + text);
    item.click();
    return item;
  };
  const setValue = (element, value) => {
    if (!element) throw new Error("Input not found");
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  };
`;

const expressionByAction = {
  flowSummary: `(async () => {
    const info = await window.goldWork.getAppInfo();
    const accounts = (await window.goldWork.listFlowAccounts()).map((account, index) => ({
      account: index + 1, id: account.id, status: account.status,
      proxyConfigured: Boolean(account.proxyDisplayName), lastError: account.lastError
    }));
    const tasks = await window.goldWork.getQueue();
    const queueStates = tasks.reduce((counts, task) => { counts[task.status] = (counts[task.status] || 0) + 1; return counts; }, {});
    return { info, accounts, queueStates, runtimeMismatchVisible: document.body.innerText.includes("Версии интерфейса и приложения не совпадают") };
  })()`,
  flowCapacity: `(async () => { ${helpers}
    document.querySelector('[data-nav-key="settings"]')?.click();
    await waitFor(() => document.querySelector('.settings-menu'), "settings page");
    clickText("Google Flow", true, document.querySelector('.settings-menu'));
    const capacity = await waitFor(() => document.querySelector('.flow-account-capacity'), "Flow account capacity");
    const addButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes("Добавить аккаунт через браузер") || button.textContent?.includes("Достигнут максимум"));
    const accounts = await window.goldWork.listFlowAccounts();
    return {
      accounts: accounts.length,
      capacity: capacity.textContent?.replace(/\s+/g, " ").trim(),
      addDisabled: Boolean(addButton?.disabled),
      addLabel: addButton?.textContent?.replace(/\s+/g, " ").trim(),
      perAccountProxyInputs: document.querySelectorAll('.flow-account-card input[type="password"]').length,
    };
  })()`,
  snapshot: `(async () => { ${helpers}
    const info = await window.goldWork.getAppInfo();
    return { info, body: document.body.innerText.slice(0, 12000) };
  })()`,
  open: `(async () => { ${helpers}
    document.querySelector('[data-nav-key="projects"]')?.click();
    const project = (await window.goldWork.listProjects()).find((candidate) => candidate.id === ${JSON.stringify(projectId)} || candidate.title === ${JSON.stringify(title)});
    if (!project) throw new Error("Project not found");
    const name = await waitFor(() => [...document.querySelectorAll(".projects-table-row .cell-name")].find((item) => item.textContent?.trim() === project.title), "project table row");
    name.closest("button").click();
    const expanded = await waitFor(() => name.closest("div")?.querySelector(".project-expand"), "expanded project row");
    clickText("Настроить", true, expanded);
    await waitFor(() => document.body.innerText.includes("Основные настройки ролика"), "project settings");
    return { projectId: project.id, title: project.title, body: document.body.innerText.slice(-3000) };
  })()`,
  create: `(async () => { ${helpers}
    const expectedTitle = ${JSON.stringify(title)};
    document.querySelector('[data-nav-key="channels"]')?.click();
    await waitFor(() => [...document.querySelectorAll(".channel-card strong")].find((item) => item.textContent?.trim() === ${JSON.stringify(channelName)}), "channel card");
    const channelLabel = [...document.querySelectorAll(".channel-card strong")].find((item) => item.textContent?.trim() === ${JSON.stringify(channelName)});
    channelLabel.closest(".channel-card").click();
    await waitFor(() => [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Новый ролик")), "new video button");
    clickText("Новый ролик");
    const dialog = await waitFor(() => document.querySelector(".video-dialog"), "new video dialog");
    setValue(dialog.querySelector('input[placeholder="Рабочее название ролика"]'), expectedTitle);
    setValue(dialog.querySelector("textarea"), ${JSON.stringify(prompt)});
    clickText("Создать и открыть AI Генератор", false, dialog);
    await waitFor(() => document.body.innerText.includes("Собрать сценарий в этот ролик"), "linked director topic", 30000);
    const projects = await window.goldWork.listProjects();
    const project = projects.find((candidate) => candidate.title === expectedTitle);
    if (!project) throw new Error("Created project not found");
    return { projectId: project.id, title: project.title, chatTopicId: project.chatTopicId, body: document.body.innerText.slice(-5000) };
  })()`,
  resume: `(async () => { ${helpers}
    document.querySelector('[data-nav-key="director"]')?.click();
    await waitFor(() => [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "История"), "director history button");
    clickText("История", true);
    const history = await waitFor(() => document.querySelector(".chat-history-panel"), "chat history");
    const topicLabel = [...history.querySelectorAll("button strong")].find((item) => item.textContent?.trim() === ${JSON.stringify(title)});
    if (!topicLabel) throw new Error("Chat topic not found: " + ${JSON.stringify(title)});
    topicLabel.closest("button").click();
    await waitFor(() => document.body.innerText.includes("Собрать сценарий в этот ролик"), "linked director topic", 30000);
    return { opened: ${JSON.stringify(title)}, body: document.body.innerText.slice(-5000) };
  })()`,
  scenario: `(async () => { ${helpers}
    clickText("Собрать сценарий в этот ролик");
    const modal = await waitFor(() => document.querySelector(".scenario-duration-modal"), "duration modal");
    setValue(modal.querySelector('input[type="number"]'), "0.5");
    clickText("Начать сборку сценария", false, modal);
    await waitFor(() => document.body.innerText.includes("Основные настройки ролика") || document.body.innerText.includes("ОСНОВНЫЕ"), "project settings after scenario", 180000);
    const projects = await window.goldWork.listProjects();
    const project = projects.find((candidate) => candidate.id === ${JSON.stringify(projectId)} || candidate.title === ${JSON.stringify(title)});
    return { projectId: project?.id, scenes: project?.scenes.length, montagePlan: project?.montagePlan, body: document.body.innerText.slice(-7000) };
  })()`,
  configure: `(async () => { ${helpers}
    const panels = () => [...document.querySelectorAll(".settings-panel")];
    const mainPanel = panels().find((item) => item.querySelector("h2")?.textContent?.includes("ОСНОВНЫЕ"));
    if (!mainPanel) throw new Error("Main settings panel not found");
    const stockButton = [...mainPanel.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Stock");
    if (!stockButton?.classList.contains("selected")) stockButton?.click();
    const ratioField = [...mainPanel.querySelectorAll(".field")].find((item) => item.textContent?.includes("СООТНОШЕНИЕ STOCK"));
    setValue(ratioField?.querySelector('input[type="range"]'), "100");
    const montagePanel = panels().find((item) => item.querySelector("h2")?.textContent?.includes("РЕЖИМ МОНТАЖА"));
    if (!montagePanel) throw new Error("Montage mode panel not found");
    if (montagePanel.classList.contains("collapsed")) montagePanel.querySelector("header button")?.click();
    await wait(100);
    const qualityMode = [...montagePanel.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Качественный монтаж");
    if (qualityMode?.getAttribute("aria-pressed") !== "true") qualityMode?.click();
    await wait(50);
    const plannerField = [...montagePanel.querySelectorAll(".field")].find((item) => item.textContent?.includes("КТО ВЫБИРАЕТ ПРИЁМЫ"));
    setValue(plannerField?.querySelector("select"), "ai-bounded");
    const dynamic = [...montagePanel.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Динамичный");
    dynamic?.click();
    const graphicsField = [...montagePanel.querySelectorAll(".field")].find((item) => item.textContent?.includes("ГРАФИЧЕСКИЕ АКЦЕНТЫ"));
    setValue(graphicsField?.querySelector('input[type="range"]'), "35");
    await wait(100);
    clickText("Сохранить", true);
    await waitFor(() => ![...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Сохраняем")), "settings save", 30000);
    const project = await window.goldWork.getProject((await window.goldWork.listProjects()).find((candidate) => candidate.id === ${JSON.stringify(projectId)} || candidate.title === ${JSON.stringify(title)}).id);
    return { projectId: project.id, mediaMode: project.mediaMode, stockVideoPercent: project.settings.stockVideoPercent, montage: project.settings.assembly.montage };
  })()`,
  montageModes: `(async () => { ${helpers}
    const panel = [...document.querySelectorAll(".settings-panel")].find((item) => item.querySelector("h2")?.textContent?.includes("РЕЖИМ МОНТАЖА"));
    if (!panel) throw new Error("Montage mode panel not found");
    if (panel.classList.contains("collapsed")) panel.querySelector("header button")?.click();
    await wait(80);
    const button = (label) => [...panel.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
    const quality = button("Качественный монтаж");
    const slideshow = button("Слайд-шоу");
    if (!quality || !slideshow) throw new Error("Montage mode choices not found");
    const originalQuality = quality.getAttribute("aria-pressed") === "true";
    slideshow.click();
    await wait(80);
    const slideshowState = {
      selected: slideshow.getAttribute("aria-pressed") === "true",
      summary: panel.querySelector("header p")?.textContent?.trim(),
      plannerHidden: ![...panel.querySelectorAll(".field")].some((item) => item.textContent?.includes("КТО ВЫБИРАЕТ ПРИЁМЫ")),
      replanHidden: ![...panel.querySelectorAll("button")].some((item) => item.textContent?.includes("Пересоздать план монтажа")),
    };
    quality.click();
    await wait(80);
    const qualityState = {
      selected: quality.getAttribute("aria-pressed") === "true",
      summary: panel.querySelector("header p")?.textContent?.trim(),
      plannerVisible: [...panel.querySelectorAll(".field")].some((item) => item.textContent?.includes("КТО ВЫБИРАЕТ ПРИЁМЫ")),
      replanVisible: [...panel.querySelectorAll("button")].some((item) => item.textContent?.includes("Пересоздать план монтажа")),
    };
    if (!originalQuality) slideshow.click();
    return { originalQuality, slideshow: slideshowState, quality: qualityState };
  })()`,
  stock: `(async () => { ${helpers}
    const button = await waitFor(() => [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Подобрать stock без запуска") || item.textContent?.includes("Переподобрать по новому соотношению")), "stock-only button");
    window.confirm = () => true;
    button.click();
    await waitFor(() => [...document.querySelectorAll("button")].some((item) => item.textContent?.includes("Подбираю stock") || item.textContent?.includes("Переподбираю stock")), "stock selection start", 10000);
    await waitFor(() => ![...document.querySelectorAll("button")].some((item) => item.textContent?.includes("Подбираю stock") || item.textContent?.includes("Переподбираю stock")), "stock selection", 240000);
    const project = await window.goldWork.getProject((await window.goldWork.listProjects()).find((candidate) => candidate.id === ${JSON.stringify(projectId)} || candidate.title === ${JSON.stringify(title)}).id);
    const included = project.scenes.filter((scene) => scene.includeInAssembly !== false);
    return {
      projectId: project.id,
      scenes: included.length,
      video: included.filter((scene) => scene.stockSource?.mediaType === "video" && scene.videoPath).length,
      image: included.filter((scene) => scene.stockSource?.mediaType === "image" && scene.imagePath).length,
      alternates: included.reduce((sum, scene) => sum + (scene.stockAlternates ?? []).filter((variant) => variant.videoPath || variant.imagePath).length, 0),
      missing: included.filter((scene) => !scene.stockSource || (scene.stockSource.mediaType === "video" ? !scene.videoPath : !scene.imagePath)).length,
      body: document.body.innerText.slice(-5000),
    };
  })()`,
  replan: `(async () => { ${helpers}
    clickText("Пересоздать план монтажа");
    await waitFor(() => [...document.querySelectorAll("button")].some((item) => item.textContent?.includes("Пересоздаю план монтажа")), "montage replan start", 10000);
    await waitFor(() => ![...document.querySelectorAll("button")].some((item) => item.textContent?.includes("Пересоздаю план монтажа")), "montage replan", 180000);
    const project = await window.goldWork.getProject((await window.goldWork.listProjects()).find((candidate) => candidate.id === ${JSON.stringify(projectId)} || candidate.title === ${JSON.stringify(title)}).id);
    return { projectId: project.id, montagePlan: project.montagePlan, visualBeatCount: project.scenes.reduce((sum, scene) => sum + (scene.visualBeats?.length ?? 0), 0), body: document.body.innerText.slice(-5000) };
  })()`,
  start: `(async () => { ${helpers}
    clickText("Собрать ролик");
    await waitFor(() => document.body.innerText.includes("Очередь генерации"), "queue page", 30000);
    const project = (await window.goldWork.listProjects()).find((candidate) => candidate.id === ${JSON.stringify(projectId)} || candidate.title === ${JSON.stringify(title)});
    return { projectId: project?.id, body: document.body.innerText.slice(-6000) };
  })()`,
  fallbackVoice: `(async () => { ${helpers}
    const project = (await window.goldWork.listProjects()).find((candidate) => candidate.id === ${JSON.stringify(projectId)} || candidate.title === ${JSON.stringify(title)});
    if (!project) throw new Error("Project not found");
    await window.goldWork.stopGeneration(project.id);
    const fresh = await window.goldWork.getProject(project.id);
    const settings = structuredClone(fresh.settings);
    settings.voice = {
      ...settings.voice,
      enabled: true,
      provider: "edge-tts",
      voice: "edge-tts/ru-RU-DmitryNeural",
      singleTrack: true,
    };
    await window.goldWork.updateProject(project.id, { settings, status: "ready" });
    const tasks = await window.goldWork.startGeneration(project.id);
    return {
      projectId: project.id,
      voice: settings.voice,
      startedTaskIds: tasks.map((task) => task.id),
    };
  })()`,
  playFinal: `(async () => { ${helpers}
    document.querySelector('[data-nav-key="projects"]')?.click();
    const project = (await window.goldWork.listProjects()).find((candidate) => candidate.id === ${JSON.stringify(projectId)} || candidate.title === ${JSON.stringify(title)});
    if (!project?.outputPath) throw new Error("Completed project not found");
    const name = await waitFor(() => [...document.querySelectorAll(".projects-table-row .cell-name")].find((item) => item.textContent?.trim() === project.title), "project table row");
    name.closest("button").click();
    const expanded = await waitFor(() => name.closest("div")?.querySelector(".project-expand"), "expanded project row");
    clickText("Предпросмотр", true, expanded);
    const video = await waitFor(() => document.querySelector(".preview-player video"), "Final.mp4 preview", 30000);
    await waitFor(() => video.readyState >= HTMLMediaElement.HAVE_METADATA, "Final.mp4 metadata", 30000);
    video.muted = false;
    video.volume = 1;
    video.currentTime = 1;
    const before = video.currentTime;
    await video.play();
    await wait(4000);
    const after = video.currentTime;
    const result = {
      source: project.outputPath,
      before,
      after,
      advancedSeconds: after - before,
      paused: video.paused,
      muted: video.muted,
      volume: video.volume,
      duration: video.duration,
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      error: video.error ? { code: video.error.code, message: video.error.message } : null,
    };
    video.pause();
    return result;
  })()`,
  inspect: `(async () => { ${helpers}
    const project = (await window.goldWork.listProjects()).find((candidate) => candidate.id === ${JSON.stringify(projectId)} || candidate.title === ${JSON.stringify(title)});
    if (!project) throw new Error("Project not found: " + ${JSON.stringify(title)});
    const fresh = await window.goldWork.getProject(project.id);
    const tasks = (await window.goldWork.getQueue()).filter((task) => task.projectId === project.id);
    const included = fresh.scenes.filter((scene) => scene.includeInAssembly !== false);
    return {
      id: fresh.id,
      title: fresh.title,
      status: fresh.status,
      outputPath: fresh.outputPath,
      lastRender: fresh.lastRender,
      montagePlan: fresh.montagePlan,
      settings: { mediaMode: fresh.mediaMode, stockVideoPercent: fresh.settings.stockVideoPercent, montage: fresh.settings.assembly.montage, voice: fresh.settings.voice },
      counts: {
        scenes: included.length,
        stockVideo: included.filter((scene) => scene.stockSource?.mediaType === "video" && scene.videoPath).length,
        stockImage: included.filter((scene) => scene.stockSource?.mediaType === "image" && scene.imagePath).length,
        stockAlternates: included.reduce((sum, scene) => sum + (scene.stockAlternates ?? []).filter((variant) => variant.videoPath || variant.imagePath).length, 0),
        missingMedia: included.filter((scene) => !scene.stockSource || (scene.stockSource.mediaType === "video" ? !scene.videoPath : !scene.imagePath)).length,
        visualBeats: included.reduce((sum, scene) => sum + (scene.visualBeats?.length ?? 0), 0),
        audio: included.filter((scene) => scene.audioPath).length,
      },
      tasks: tasks.map((task) => ({ id: task.id, kind: task.kind, status: task.status, progress: task.progress, stage: task.stage, error: task.error })),
      body: document.body.innerText.slice(-5000),
    };
  })()`,
};

if (!expressionByAction[action]) throw new Error(`Unknown action: ${action}`);
try {
  const output = await evaluate(expressionByAction[action]);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  socket.close();
}
