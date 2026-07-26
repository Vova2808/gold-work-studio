import { connect as tlsConnect } from "node:tls";
import { Agent, type Dispatcher } from "undici";
import { SocksClient } from "socks";

/**
 * Диспетчер запросов через SOCKS5-прокси: нужен там, где провайдер блокирует по региону (Google/Gemini).
 * Формат строки: socks5://user:pass@host:port. Пустая строка — прямое соединение (undefined).
 */
export function createProxyDispatcher(proxyUrl: string | undefined): Dispatcher | undefined {
  const raw = proxyUrl?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Некорректный адрес прокси: ${raw}. Ожидается socks5://логин:пароль@хост:порт`);
  }
  if (!/^socks5?h?:$/i.test(url.protocol)) {
    throw new Error(`Поддерживается только SOCKS5-прокси, получено: ${url.protocol}`);
  }
  const proxy = {
    host: url.hostname,
    port: Number(url.port || 1080),
    type: 5 as const,
    ...(url.username ? { userId: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {})
  };
  return new Agent({
    connect: (options, callback) => {
      const port = Number(options.port || (options.protocol === "https:" ? 443 : 80));
      const host = String(options.hostname ?? "");
      SocksClient.createConnection({ proxy, command: "connect", destination: { host, port } })
        .then(({ socket }) => {
          if (options.protocol !== "https:") {
            callback(null, socket);
            return;
          }
          const secure = tlsConnect({
            socket,
            servername: typeof options.servername === "string" ? options.servername : host
          });
          secure.once("secureConnect", () => callback(null, secure));
          secure.once("error", (error) => callback(error, null));
        })
        .catch((error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), null));
    }
  });
}
