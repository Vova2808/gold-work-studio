import type { ProxyResponse } from "./proxy-utils.js";

/**
 * Метка в начале текста ошибки: повторять запрос бессмысленно (нет доступа, а не временный сбой).
 * Очередь видит её и сразу помечает задачу проваленной, не тратя 3 попытки.
 */
export const NO_RETRY_MARKER = "[no-retry] ";

/** Ошибка, которую нельзя исправить повтором. */
export function isPermanentFailure(message: string): boolean {
  return message.startsWith(NO_RETRY_MARKER);
}

/** Текст ошибки для показа пользователю — без служебной метки. */
export function cleanErrorMessage(message: string): string {
  return message.startsWith(NO_RETRY_MARKER) ? message.slice(NO_RETRY_MARKER.length) : message;
}

/** Человеческое объяснение отказа Google вместо сырого JSON. */
export function googleError(response: ProxyResponse): string {
  const text = response.text();
  let message = "";
  try {
    message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? "";
  } catch {
    // не JSON
  }
  if (/User location is not supported/i.test(message)) {
    return "Google не обслуживает запросы из вашего региона. Укажите SOCKS5-прокси в Настройки → Google AI Studio (или включите VPN) — ключ при этом рабочий.";
  }
  if (response.status === 429) {
    const retryAfter = response.headers["retry-after"];
    const canRetry = /retry in\s+[\d.]+s/i.test(message) || retryAfter !== undefined;
    // Veo доступна только на paid tier. Если Google не дал время повтора и просит проверить
    // plan/billing, это не кратковременный RPM-limit: у проекта нет платной квоты или баланса.
    if (!canRetry && (/quota|plan and billing|resource_exhausted/i.test(message))) {
      return `${NO_RETRY_MARKER}У проекта Google нет доступной платной квоты Veo. Откройте aistudio.google.com/projects, найдите проект этого API-ключа и нажмите Set up billing. Для Prepay пополните баланс минимум на $10. После активации подождите до 10 минут и повторите одну сцену.`;
    }
    return `Google временно ограничил запросы видео (${message}). Софт дождётся разрешённого времени и повторит.`;
  }
  if (response.status === 400 && /API key|API_KEY/i.test(message)) return "Google отклонил ключ API. Проверьте ключ в Настройках.";
  if (response.status === 403) return `${NO_RETRY_MARKER}Google отказал в доступе: ${message || "проверьте, что у аккаунта есть доступ к модели"}`;
  if (response.status === 404) {
    return `${NO_RETRY_MARKER}Google не знает такую модель видео (${message || "404"}). Проверьте название модели в Настройки → Google AI Studio.`;
  }
  return `Google ${response.status}: ${message || text.slice(0, 200)}`;
}

/** Сетевые сбои: понятный текст вместо "socket hang up" и прочей внутренней кухни. */
export function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError" || /aborted/i.test(error.message)) {
    return "Google не ответил за отведённое время. Проверьте VPN/интернет и повторите.";
  }
  if (/socket hang up|ECONNRESET|before secure TLS/i.test(error.message)) {
    return "Соединение с Google оборвалось. Обычно это прокси: проверьте адрес, логин и пароль в Настройки → Google AI Studio (нужен рабочий SOCKS5).";
  }
  return error.message;
}
