import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { LogLevel } from "@gold-work/shared";

export type DiagnosticContext = Record<string, unknown> & { operationId: string };
const context = new AsyncLocalStorage<DiagnosticContext>();
export const currentDiagnosticContext = () => context.getStore();
export function withDiagnosticContext<T>(value: DiagnosticContext, work: () => T): T { return context.run(value, work); }

/** Only extract technical IDs, never prompts, API keys or free-form string arguments. */
export function ipcDiagnosticContext(channel: string, args: unknown[]): DiagnosticContext {
  const result: DiagnosticContext = { operationId: `op-${randomUUID()}`, channel };
  const first = args[0];
  if (typeof first === "string" && /^[\w-]{1,100}$/.test(first)) {
    if (channel.startsWith("projects:") || /^queue:(start|pause|resume|stop|regenerate|assemble)/.test(channel)) result.projectId = first;
    else if (channel.startsWith("chat-topics:")) result.topicId = first;
    else if ((channel.startsWith("flow:accounts:") && !/import|login/.test(channel)) || channel === "flow:test") result.accountId = first;
    if (typeof args[1] === "string" && /^[\w-]{1,100}$/.test(args[1])) {
      if (channel === "projects:apply-chat-topic") result.topicId = args[1];
      if (channel.includes("regenerate") || channel.includes("improve-scene")) result.sceneId = args[1];
    }
  } else if (first && typeof first === "object") {
    for (const key of ["projectId", "sceneId", "topicId", "accountId"]) {
      const value = (first as Record<string, unknown>)[key];
      if (typeof value === "string" && /^[\w-]{1,100}$/.test(value)) result[key] = value;
    }
  }
  const service = channel.split(":")[0];
  if (["anymodel", "voicer", "flow", "google", "youtube", "stock"].includes(service!)) result.service = service === "voicer" ? "lumean" : service;
  return result;
}

export function diagnoseFailure(error: unknown): { category: string; summary: string; nextAction: string; codes: string[] } {
  const parts: string[] = [], codes: string[] = [], visited = new Set<unknown>();
  function visit(value: unknown, depth = 0) {
    if (depth > 6 || visited.has(value)) return;
    visited.add(value);
    if (typeof value === "string") { parts.push(value); return; }
    if (!value || typeof value !== "object") return;
    const e = value as Record<string, unknown>;
    for (const key of ["name", "message", "code", "status", "statusCode", "errno"]) {
      const v = e[key];
      if (typeof v === "string" || typeof v === "number") {
        parts.push(String(v));
        if (key !== "message" && key !== "name" && String(v).length < 80) codes.push(String(v));
      }
    }
    visit(e.cause, depth + 1);
    if (Array.isArray(e.errors)) e.errors.slice(0, 10).forEach(e => visit(e, depth + 1));
  }
  visit(error);
  const text = parts.join(" ");
  const make = (category: string, summary: string, nextAction: string) => ({ category, summary, nextAction, codes: [...new Set(codes)] });
  if(parts.includes('DocumentarySelectionIncompleteError'))return make('material-selection', 'Подбор материалов не завершён', 'Откройте обзор производства: причины и дальнейшие действия сохранены по каждой незавершённой сцене. Готовые материалы и озвучку не удаляйте.');
  if (/CompletionUncertain|SubmissionUncertain|результат.*неизвест|неопределён|unknown.*submission/i.test(text)) return make("uncertain-submission", "Результат отправленного запроса неизвестен", "Не отправляйте платное задание повторно вслепую. Проверьте сохранённый ID и статус заказа у провайдера.");
  if (/AbortError|\baborted\b|отмен[аё]н/i.test(text)) return make("cancelled", "Операция отменена", "Проверьте, нажимались ли пауза или остановка. Это не обязательно сбой сервиса.");
  if (/ENOSPC|disk.*full|мест[ао].*диск/i.test(text)) return make("disk-full", "Недостаточно места на диске", "Освободите место на диске проекта и во временной папке, затем продолжите незавершённую задачу.");
  if (/EACCES|EPERM|EBUSY|access.*denied/i.test(text)) return make("file-access", "Файл недоступен или занят", "Проверьте путь, права, антивирус и программы, открывшие файл. Готовые материалы не удаляйте.");
  if (/ENOENT|file.*not found|файл.*не найден/i.test(text)) return make("file-missing", "Не найден локальный файл", "Проверьте путь из события и доступность диска. Восстановите исходный файл или пересоздайте только этот материал.");
  if (/FlowBrowserStateError|FLOW_BROWSER_STATE_MISSING|страница не предоставила данные сессии/i.test(text)) return make("browser-session", "Страница Flow не предоставила данные сессии", "Обновите сессию Flow. Если вход в браузере есть, проверьте события flow.session.reloading/failed; удалять аккаунт или менять прокси не требуется.");
  if (/FlowLoginRequiredError|FLOW_LOGIN_REQUIRED|Войдите в Google|needs.login/i.test(text)) return make("authentication", "Страница Flow не подтвердила вход в Google", "Откройте «Войти снова». Если аккаунт уже открыт, проверьте flow.session.failed: там указаны окно проверки и результат обновления страницы. Аккаунт и готовые задания не удаляйте.");
  if (/unsupported.country|region.*not.*support|регион|recaptcha|unusual.activity/i.test(text)) return make("access-restriction", "Провайдер ограничил доступ", "Проверьте доступность сервиса в браузере этого аккаунта. Автоматические повторы не устраняют такое ограничение.");
  if (/OutputFormat|finish_reason|обрезал ответ/i.test(text)) return make("response-format", "Ответ провайдера не соответствует формату", "Проверьте этап, модель и сохранённый черновик. Продолжайте с незавершённого блока, не удаляя готовые сцены.");
  if (/\b429\b|quota|rate.?limit|лимит|квот/i.test(text)) return make("quota", "Ограничение квоты или частоты запросов", "Проверьте лимиты аккаунта/модели и время следующей попытки. Не перезапускайте весь проект.");
  if (/\b(401|403|407)\b|unauthori[sz]ed|forbidden|keyInvalid|API key not valid|ключ.*невер/i.test(text)) return make("authentication", "Запрос отклонён при проверке доступа", "Проверьте ключ/аккаунт и авторизацию прокси. 403 может означать права или регион, а не только неверный ключ.");
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return make("dns", "Не удалось определить адрес сервиса", "Проверьте DNS и выбранный сетевой маршрут. Сравните хост и режим прокси в связанных сетевых событиях.");
  if (/CERT_|TLS|SSL|certificate/i.test(text)) return make("tls", "Ошибка защищённого соединения", "Проверьте дату Windows, сертификаты и перехват HTTPS антивирусом/прокси. Не отключайте проверку сертификата.");
  if (/ETIMEDOUT|TimeoutError|UND_ERR_.*TIMEOUT|timeout|таймаут|не ответил за|превысила.*секунд/i.test(text)) return make("timeout", "Сервис не ответил вовремя", "Проверьте маршрут и доступность сервиса. Для принятого платного запроса сначала выясните статус заказа.");
  if (/ECONNRESET|EPIPE|UND_ERR_SOCKET|socket|fetch failed|ошибка сети|соединени.*оборв|нет соединения/i.test(text)) return make("network", "Соединение оборвалось или не установилось", "Проверьте VPN/прокси и сервис; не переключайте маршрут во время запроса. Код ошибки не доказывает, какая сторона оборвала соединение.");
  if (/\b5\d\d\b|service unavailable|bad gateway/i.test(text)) return make("upstream", "Ошибка на стороне сервиса или шлюза", "Посмотрите HTTP-статус и хост. Дождитесь восстановления, сохранив текущие задания.");
  if (/JSON|OutputFormat|finish_reason|неполный.*ответ|обрезал ответ/i.test(text)) return make("response-format", "Ответ провайдера не соответствует формату", "Проверьте этап, модель и сохранённый черновик. Продолжайте с незавершённого блока, не удаляя готовые сцены.");
  return make("unknown", "Причину нужно уточнить по цепочке событий", "Откройте события этой операции или скопируйте отчёт о сбое: сообщение, вложенная причина, стек и последние этапы.");
}

type Sink = (level: LogLevel, message: string, details: Record<string, unknown>) => void;
let sink: Sink | undefined;
export function setDiagnosticSink(value?: Sink): void { sink = value; }
export function recordDiagnosticEvent(level: LogLevel, event: string, details: Record<string, unknown>): void {
  try { sink?.(level, event, details); } catch { /* Logging cannot change operation/retry behavior. */ }
}

/** Observe headers/status only. Does not read, buffer or retry a response body. */
export async function observeNetwork<T extends { status: number; ok: boolean }>(
  url: string, method: string, route: string, work: () => Promise<T>
): Promise<T> {
  if (!sink) return work();
  let host = "unknown";
  try { host = new URL(url).host; } catch { /* The actual transport reports an invalid URL. */ }
  const meta = { requestId: `net-${randomUUID()}`, host, method, route };
  const started = Date.now();
  const emit = (level: LogLevel, event: string, extra: Record<string, unknown> = {}) => {
    try { sink?.(level, event, { ...meta, ...extra }); } catch { /* Diagnostics must never break the request. */ }
  };
  emit("debug", "network.request");
  try {
    const response = await work();
    emit(response.ok ? "debug" : "warn", "network.response", { status: response.status, elapsedMs: Date.now() - started,
      ...(response.ok ? {} : { diagnostic: diagnoseFailure({ status: response.status }) }) });
    return response;
  } catch (error) {
    emit("error", "network.failed", { elapsedMs: Date.now() - started, error });
    throw error;
  }
}
