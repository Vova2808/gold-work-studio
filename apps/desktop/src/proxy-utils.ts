import { connect as netConnect, type Socket } from "node:net";
import { request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";

export interface ProxyResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  text(): string;
  json<T>(): T;
}

interface Socks5Target {
  host: string;
  port: number;
}

interface ProxyConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
}

/** Разбирает socks5://user:pass@host:port. Пустая строка — прокси не используется. */
export function parseProxyUrl(proxyUrl: string | undefined): ProxyConfig | undefined {
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
  return {
    host: url.hostname,
    port: Number(url.port || 1080),
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined
  };
}

/**
 * SOCKS5-туннель на чистом node:net (RFC 1928 + 1929).
 * Собственная реализация вместо пакетов socks/undici: те ломают ESM-загрузчик Electron.
 */
function socks5Connect(proxy: ProxyConfig, target: Socks5Target, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: proxy.host, port: proxy.port });
    socket.setTimeout(timeoutMs);
    let stage: "greeting" | "auth" | "connect" = "greeting";
    const fail = (message: string) => {
      socket.destroy();
      reject(new Error(`SOCKS5 ${proxy.host}:${proxy.port}: ${message}`));
    };

    socket.once("error", (error) => fail(error.message));
    socket.once("timeout", () => fail("таймаут соединения с прокси"));

    socket.on("connect", () => {
      // Приветствие: версия 5, методы «без авторизации» и «логин/пароль».
      socket.write(proxy.user ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
    });

    socket.on("data", (data: Buffer) => {
      if (stage === "greeting") {
        if (data[0] !== 0x05) return fail("прокси ответил не по протоколу SOCKS5");
        const method = data[1];
        if (method === 0x02) {
          if (!proxy.user) return fail("прокси требует логин и пароль");
          const user = Buffer.from(proxy.user, "utf8");
          const password = Buffer.from(proxy.password ?? "", "utf8");
          stage = "auth";
          socket.write(Buffer.concat([
            Buffer.from([0x01, user.length]), user,
            Buffer.from([password.length]), password
          ]));
          return;
        }
        if (method !== 0x00) return fail("прокси не принял способ авторизации");
        stage = "connect";
        writeConnect();
        return;
      }
      if (stage === "auth") {
        if (data[1] !== 0x00) return fail("прокси отклонил логин или пароль");
        stage = "connect";
        writeConnect();
        return;
      }
      // Ответ на CONNECT: 0x00 — успех.
      if (data[1] !== 0x00) return fail(`прокси отказал в подключении (код ${data[1]})`);
      socket.removeAllListeners("data");
      socket.setTimeout(0);
      socket.removeAllListeners("timeout");
      resolve(socket);
    });

    function writeConnect(): void {
      const host = Buffer.from(target.host, "utf8");
      const request = Buffer.alloc(7 + host.length);
      request[0] = 0x05; // версия
      request[1] = 0x01; // команда CONNECT
      request[2] = 0x00; // резерв
      request[3] = 0x03; // адрес как доменное имя
      request[4] = host.length;
      host.copy(request, 5);
      request.writeUInt16BE(target.port, 5 + host.length);
      socket.write(request);
    }
  });
}

/** HTTPS-запрос через SOCKS5 (или напрямую, если прокси не задан). */
export function proxyRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number },
  proxy: ProxyConfig | undefined
): Promise<ProxyResponse> {
  const timeoutMs = init.timeoutMs ?? 120_000;
  const target = new URL(url);
  const port = Number(target.port || 443);
  return new Promise((resolve, reject) => {
    const start = async (): Promise<void> => {
      const socket = proxy ? await socks5Connect(proxy, { host: target.hostname, port }, 30_000) : undefined;
      const request = httpsRequest({
        method: init.method ?? "GET",
        hostname: target.hostname,
        port,
        path: `${target.pathname}${target.search}`,
        headers: init.headers,
        timeout: timeoutMs,
        // Через прокси идёт сырой TCP-туннель — TLS поднимаем сами, иначе в 443 уходит открытый HTTP
        // и Google просто закрывает соединение («socket hang up»).
        ...(socket ? { createConnection: () => tlsConnect({ socket, servername: target.hostname }) } : {})
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          const status = response.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: response.headers,
            body,
            text: () => body.toString("utf8"),
            json: <T,>() => JSON.parse(body.toString("utf8")) as T
          });
        });
        response.on("error", reject);
      });
      request.on("timeout", () => {
        request.destroy(new Error("Истекло время ожидания ответа"));
      });
      request.on("error", reject);
      if (init.body) request.write(init.body);
      request.end();
    };
    start().catch(reject);
  });
}
