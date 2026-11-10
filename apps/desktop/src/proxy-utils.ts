import { connect as netConnect, isIP, type Socket } from "node:net";
import { createServer, request as httpRequest, type Server } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { domainToASCII } from "node:url";
import { observeNetwork } from "./diagnostics.js";

export interface ProxyResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  text(): string;
  json<T>(): T;
}

/** The proxy tunnel failed before any HTTP request was sent to the destination. */
export class ProxyConnectError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Не удалось подключиться через прокси", { cause });
    this.name = "ProxyConnectError";
  }
}

interface Socks5Target {
  host: string;
  port: number;
}

export interface ProxyConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  /** Отсутствующее значение сохраняет обратную совместимость со SOCKS5-конфигами. */
  protocol?: "http" | "https";
}

export interface BrowserProxyBridge {
  proxyUrl: string;
  close(): Promise<void>;
}

function validatedHost(value: string): string {
  const host = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  if (host !== value && isIP(host) !== 6) throw new Error("SOCKS5: некорректное имя хоста");
  if (isIP(host) && !host.includes("%")) return host;
  if (/[\s:/@?#\\\[\]%]/.test(host)) throw new Error("SOCKS5: некорректное имя хоста");
  const ascii = domainToASCII(host);
  if (!ascii || Buffer.byteLength(ascii) > 255 || !/^[a-z\d.-]+$/i.test(ascii)
    || ascii.replace(/\.$/, "").split(".").some((label) => !label || label.length > 63 || /^-|-$/.test(label))) {
    throw new Error("SOCKS5: некорректное имя хоста");
  }
  return ascii;
}

function validatedPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("SOCKS5: порт должен быть от 1 до 65535");
  return port;
}

function validateCredentials(proxy: ProxyConfig): void {
  if (proxy.user === undefined && proxy.password === undefined) return;
  const userLength = Buffer.byteLength(proxy.user ?? "", "utf8");
  const passwordLength = Buffer.byteLength(proxy.password ?? "", "utf8");
  if (userLength < 1 || userLength > 255 || passwordLength < 1 || passwordLength > 255) {
    throw new Error("SOCKS5: логин и пароль должны содержать от 1 до 255 байт UTF-8");
  }
}

/** Разбирает SOCKS5/HTTP(S) proxy URL. Пустая строка — прокси не используется. */
export function parseProxyUrl(proxyUrl: string | undefined): ProxyConfig | undefined {
  const raw = proxyUrl?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Некорректный адрес прокси. Ожидается socks5://, http:// или https://логин:пароль@хост:порт");
  }
  if (!["socks5:", "socks5h:", "http:", "https:"].includes(url.protocol)) {
    throw new Error("Поддерживаются SOCKS5, HTTP и HTTPS-прокси");
  }
  if (url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw new Error("SOCKS5: адрес прокси не должен содержать путь, параметры или фрагмент");
  }
  let user: string | undefined;
  let password: string | undefined;
  try {
    user = url.username ? decodeURIComponent(url.username) : undefined;
    password = url.password ? decodeURIComponent(url.password) : undefined;
  } catch {
    throw new Error("SOCKS5: некорректная кодировка логина или пароля");
  }
  const protocol = url.protocol === "http:" ? "http" as const : url.protocol === "https:" ? "https" as const : undefined;
  // URL normalisation removes an explicitly supplied default port (for example
  // `http://proxy:80`), therefore the fallback must be the protocol default.
  const defaultPort = protocol === "https" ? 443 : protocol === "http" ? 80 : 1080;
  const proxy: ProxyConfig = {
    host: validatedHost(url.hostname),
    port: validatedPort(Number(url.port || defaultPort)),
    user,
    password,
    ...(protocol ? { protocol } : {})
  };
  validateCredentials(proxy);
  return proxy;
}

/** Безопасное имя для renderer/логов: логин и пароль никогда не возвращаются. */
export function proxyDisplayName(proxyUrl: string | undefined): string | undefined {
  const proxy = parseProxyUrl(proxyUrl);
  if (!proxy) return undefined;
  const protocol = proxy.protocol ?? "socks5";
  const host = isIP(proxy.host) === 6 ? `[${proxy.host}]` : proxy.host;
  return `${protocol}://${host}:${proxy.port}`;
}

function targetAddress(host: string): Buffer {
  if (isIP(host) === 4) return Buffer.from([0x01, ...host.split(".").map(Number)]);
  if (isIP(host) === 6) {
    // Convert a possible IPv4 suffix before expanding the IPv6 zero run.
    const expanded = host.replace(/\d+\.\d+\.\d+\.\d+$/, (suffix) => {
      const bytes = suffix.split(".").map(Number);
      return `${((bytes[0]! << 8) | bytes[1]!).toString(16)}:${((bytes[2]! << 8) | bytes[3]!).toString(16)}`;
    });
    const [left, right] = expanded.split("::");
    const start = left ? left.split(":") : [];
    const end = right ? right.split(":") : [];
    const groups = right === undefined ? start : [...start, ...Array<string>(8 - start.length - end.length).fill("0"), ...end];
    const bytes = Buffer.alloc(17);
    bytes[0] = 0x04;
    groups.forEach((group, index) => bytes.writeUInt16BE(Number.parseInt(group, 16), 1 + index * 2));
    return bytes;
  }
  const bytes = Buffer.from(host, "utf8");
  return Buffer.concat([Buffer.from([0x03, bytes.length]), bytes]);
}

/**
 * SOCKS5-туннель на чистом node:net (RFC 1928 + 1929).
 * Собственная реализация вместо пакетов socks/undici: те ломают ESM-загрузчик Electron.
 */
export function socks5Connect(proxy: ProxyConfig, target: Socks5Target, timeoutMs: number, signal?: AbortSignal): Promise<Socket> {
  return new Promise((resolve, reject) => {
    // Validate before opening any socket; an invalid proxy never means direct mode.
    if (proxy.protocol) throw new Error("SOCKS5: для этого соединения нужен socks5:// адрес");
    const proxyHost = validatedHost(proxy.host);
    const proxyPort = validatedPort(proxy.port);
    const destination = targetAddress(validatedHost(target.host));
    const destinationPort = validatedPort(target.port);
    validateCredentials(proxy);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("SOCKS5: некорректный таймаут");
    if (signal?.aborted) throw new Error("SOCKS5: подключение отменено");
    const socket = netConnect({ host: proxyHost, port: proxyPort });
    let stage: "greeting" | "auth" | "connect" = "greeting";
    let pending: Buffer = Buffer.alloc(0);
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.removeListener("data", onData);
      socket.removeListener("end", onEnd);
      socket.removeListener("close", onEnd);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(new Error(`SOCKS5: ${message}`));
    };
    const onAbort = () => fail("подключение отменено");
    const onEnd = () => fail("прокси закрыл соединение во время согласования");
    const timer = setTimeout(() => fail("таймаут соединения с прокси"), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    // Leave an error listener after handoff to cover the gap before the caller
    // attaches its listener. It does not consume or suppress caller listeners.
    socket.on("error", (error: NodeJS.ErrnoException) => fail(`ошибка подключения (${error.code ?? "NETWORK_ERROR"})`));
    socket.once("end", onEnd);
    socket.once("close", onEnd);
    socket.once("connect", () => {
      // Приветствие: версия 5, методы «без авторизации» и «логин/пароль».
      socket.write(proxy.user ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
    });

    socket.on("data", onData);

    function onData(data: Buffer): void {
      pending = Buffer.concat([pending, data]);
      while (!settled) {
        if (stage === "greeting") {
          if (pending.length < 2) return;
          if (pending[0] !== 0x05) return fail("прокси ответил не по протоколу SOCKS5");
          const method = pending[1];
          pending = pending.subarray(2);
          if (method === 0x02) {
            if (!proxy.user) return fail("прокси требует логин и пароль");
            const user = Buffer.from(proxy.user, "utf8");
            const password = Buffer.from(proxy.password!, "utf8");
            stage = "auth";
            socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([password.length]), password]));
          } else {
            if (method !== 0x00) return fail("прокси не принял способ авторизации");
            stage = "connect";
            writeConnect();
          }
          continue;
        }
        if (stage === "auth") {
          if (pending.length < 2) return;
          if (pending[0] !== 0x01) return fail("неверная версия ответа авторизации прокси");
          if (pending[1] !== 0x00) return fail("прокси отклонил логин или пароль");
          pending = pending.subarray(2);
          stage = "connect";
          writeConnect();
          continue;
        }
        if (pending.length < 4) return;
        if (pending[0] !== 0x05 || pending[2] !== 0x00) return fail("неверный заголовок ответа CONNECT");
        if (pending[1] !== 0x00) return fail(`прокси отказал в подключении (код ${pending[1]})`);
        const addressType = pending[3];
        if (addressType === 0x03 && pending.length < 5) return;
        const addressLength = addressType === 0x01 ? 4 : addressType === 0x04 ? 16
          : addressType === 0x03 && pending[4]! > 0 ? pending[4]! + 1 : 0;
        if (!addressLength) return fail("неверный тип или длина адреса в ответе CONNECT");
        const replyLength = 4 + addressLength + 2;
        if (pending.length < replyLength) return;
        const remainder = pending.subarray(replyLength);
        settled = true;
        socket.pause();
        cleanup();
        if (remainder.length) socket.unshift(remainder);
        resolve(socket);
        // Resume after the promise continuation attaches TLS/pipe/data handlers.
        queueMicrotask(() => { if (!socket.destroyed) socket.resume(); });
      }
    }

    function writeConnect(): void {
      const port = Buffer.alloc(2);
      port.writeUInt16BE(destinationPort);
      socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), destination, port]));
    }
  });
}

function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function connectTarget(authority: string | undefined): Socks5Target {
  if (!authority) throw new Error("браузер не передал адрес назначения");
  let url: URL;
  try {
    // A custom protocol keeps an explicit :80 instead of dropping it as a default.
    url = new URL(`socks5://${authority}`);
  } catch {
    throw new Error("некорректный адрес назначения");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname) {
    throw new Error("некорректный адрес назначения");
  }
  return { host: validatedHost(url.hostname), port: validatedPort(Number(url.port || 443)) };
}

/**
 * Chromium не поддерживает логин/пароль для SOCKS5. Локальный HTTP CONNECT-мост
 * принимает браузер без авторизации и поднимает внешний SOCKS5-туннель сам.
 */
export async function createSocks5BrowserProxyBridge(proxyUrl: string): Promise<BrowserProxyBridge> {
  const proxy = parseProxyUrl(proxyUrl);
  if (!proxy) throw new Error("SOCKS5-прокси не указан");
  if (proxy.protocol) throw new Error("Для браузерного моста нужен socks5:// адрес");
  return createAuthenticatedProxyBridge(proxyUrl, { host: "labs.google", port: 443 });
}

/** Loopback CONNECT bridge keeps upstream credentials out of child-process arguments. */
export async function createAuthenticatedProxyBridge(proxyUrl: string, probeTarget: Socks5Target): Promise<BrowserProxyBridge> {
  const proxy = parseProxyUrl(proxyUrl);
  if (!proxy) throw new Error("Прокси не указан");
  const connect = (target: Socks5Target, signal?: AbortSignal) => proxy.protocol
    ? httpProxyConnect(proxy, target, 30000, signal) : socks5Connect(proxy, target, 30000, signal);

  // Проверяем адрес и авторизацию до открытия BrowserWindow, иначе Chromium
  // оставляет пользователю белую страницу с ERR_SOCKS_CONNECTION_FAILED.
  const probe = await connect(probeTarget);
  probe.destroy();
  return createConnectProxyBridge(connect);
}

export async function createConnectProxyBridge(connect: (target: Socks5Target, signal?: AbortSignal) => Promise<Socket>): Promise<BrowserProxyBridge> {
  const sockets = new Set<Socket>();
  const pendingConnections = new Set<AbortController>();
  let closing = false;
  const server = createServer((_request, response) => {
    response.writeHead(405, { Connection: "close" });
    response.end();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("connect", (request, clientSocket, head) => {
    const controller = new AbortController();
    pendingConnections.add(controller);
    const cancelPending = () => controller.abort();
    clientSocket.once("close", cancelPending);
    void (async () => {
      try {
        if (closing || clientSocket.destroyed) return;
        const upstream = await connect(connectTarget(request.url), controller.signal);
        if (closing || clientSocket.destroyed) {
          upstream.destroy();
          return;
        }
        sockets.add(upstream);
        upstream.once("close", () => {
          sockets.delete(upstream);
          clientSocket.destroy();
        });
        clientSocket.once("close", () => upstream.destroy());
        upstream.once("error", () => clientSocket.destroy());
        clientSocket.once("error", () => upstream.destroy());
        clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: Gold-Work-Studio\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      } catch {
        if (!clientSocket.destroyed) {
          clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
        }
      } finally {
        pendingConnections.delete(controller);
        clientSocket.removeListener("close", cancelPending);
      }
    })();
  });
  // A late listening-server error must not crash the Electron main process.
  server.on("error", () => {
    for (const controller of pendingConnections) controller.abort();
    for (const socket of sockets) socket.destroy();
  });

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => reject(error);
    server.once("error", handleError);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", handleError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server, sockets);
    throw new Error("Не удалось запустить локальный мост SOCKS5");
  }
  return {
    proxyUrl: `http://127.0.0.1:${address.port}`,
    close: () => {
      closing = true;
      for (const controller of pendingConnections) controller.abort();
      return closeServer(server, sockets);
    },
  };
}

function httpProxyConnect(
  proxy: ProxyConfig,
  target: Socks5Target,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const proxyHost = validatedHost(proxy.host);
    const proxyPort = validatedPort(proxy.port);
    const targetHost = validatedHost(target.host);
    const targetPort = validatedPort(target.port);
    if (!proxy.protocol) throw new Error("HTTP proxy: для этого соединения нужен http:// или https:// адрес");
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("HTTP proxy: некорректный таймаут");
    if (signal?.aborted) throw new Error("HTTP proxy: подключение отменено");

    const socket: Socket = proxy.protocol === "https"
      ? tlsConnect({ host: proxyHost, port: proxyPort, servername: isIP(proxyHost) ? undefined : proxyHost })
      : netConnect({ host: proxyHost, port: proxyPort });
    const connectedEvent = proxy.protocol === "https" ? "secureConnect" : "connect";
    let pending = Buffer.alloc(0);
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.removeListener("data", onData);
      socket.removeListener("end", onEnd);
      socket.removeListener("close", onEnd);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(new Error(`HTTP proxy: ${message}`));
    };
    const onAbort = () => fail("подключение отменено");
    const onEnd = () => fail("прокси закрыл соединение во время CONNECT");
    const onData = (data: Buffer) => {
      pending = Buffer.concat([pending, data]);
      if (pending.length > 64 * 1024) return fail("слишком большой ответ CONNECT");
      const boundary = pending.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const header = pending.subarray(0, boundary).toString("latin1");
      const status = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/i.exec(header)?.[1];
      if (!status) return fail("некорректный ответ CONNECT");
      const code = Number(status);
      if (code === 407) return fail("прокси отклонил логин или пароль (407)");
      if (code < 200 || code >= 300) return fail(`прокси отказал в подключении (HTTP ${code})`);
      const remainder = pending.subarray(boundary + 4);
      settled = true;
      socket.pause();
      cleanup();
      if (remainder.length > 0) socket.unshift(remainder);
      resolve(socket);
      queueMicrotask(() => { if (!socket.destroyed) socket.resume(); });
    };
    const timer = setTimeout(() => fail("таймаут соединения с прокси"), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.on("error", (error: NodeJS.ErrnoException) => fail(`ошибка подключения (${error.code ?? "NETWORK_ERROR"})`));
    socket.once("end", onEnd);
    socket.once("close", onEnd);
    socket.on("data", onData);
    socket.once(connectedEvent, () => {
      const authorityHost = isIP(targetHost) === 6 ? `[${targetHost}]` : targetHost;
      const authority = `${authorityHost}:${targetPort}`;
      const authorization = proxy.user
        ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.user}:${proxy.password ?? ""}`, "utf8").toString("base64")}\r\n`
        : "";
      socket.write(
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${authorization}Proxy-Connection: keep-alive\r\nConnection: keep-alive\r\n\r\n`
      );
    });
  });
}

async function proxySocket(
  proxy: ProxyConfig,
  target: Socks5Target,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Socket> {
  const socket = await (proxy.protocol
    ? httpProxyConnect(proxy, target, timeoutMs, signal)
    : socks5Connect(proxy, target, timeoutMs, signal));
  // Длинные reasoning/completion-запросы могут несколько минут не отдавать
  // прикладные байты. TCP keepalive снижает риск, что промежуточный NAT или
  // residential proxy сочтёт исправный CONNECT-туннель брошенным.
  socket.setKeepAlive(true, 15_000);
  socket.setNoDelay(true);
  return socket;
}

async function requestBodyBuffer(body: BodyInit | null | undefined): Promise<string | Buffer | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (body instanceof ReadableStream) return Buffer.from(await new Response(body).arrayBuffer());
  throw new Error("Proxy: этот тип тела запроса пока не поддерживается");
}

async function proxyFetchOnce(url: URL, init: RequestInit, proxy: ProxyConfig): Promise<Response> {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Proxy: поддерживаются только HTTP/HTTPS-запросы");
  if (url.username || url.password) throw new Error("Proxy: логин и пароль в адресе назначения не поддерживаются");
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const socket = await proxySocket(proxy, { host: url.hostname, port }, 30_000, init.signal ?? undefined)
    .catch(error => { throw new ProxyConnectError(error); });
  const headers = new Headers(init.headers);
  // Keep the URL's exact authority: an added default port breaks signed storage URLs.
  headers.set("host", url.host);
  // Proxy credentials belong only in the CONNECT handshake. Never forward a
  // caller-supplied Proxy-Authorization header to the destination service.
  headers.delete("proxy-authorization");
  const body = await requestBodyBuffer(init.body);
  if (init.body instanceof URLSearchParams && !headers.has("content-type")) {
    headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
  }
  if (body !== undefined && !headers.has("content-length")) headers.set("content-length", String(Buffer.byteLength(body)));
  const requestHeaders = Object.fromEntries(headers.entries());
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "https:";
    const request = (secure ? httpsRequest : httpRequest)({
      method: init.method ?? "GET",
      hostname: url.hostname,
      port,
      path: `${url.pathname}${url.search}`,
      headers: requestHeaders,
      signal: init.signal ?? undefined,
      ...(secure
        ? { createConnection: () => tlsConnect({ socket, servername: isIP(url.hostname) ? undefined : url.hostname }) }
        : { createConnection: () => socket })
    }, (incoming) => {
      try {
        const responseHeaders = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          responseHeaders.append(incoming.rawHeaders[index]!, incoming.rawHeaders[index + 1] ?? "");
        }
        const status = incoming.statusCode ?? 500;
        const method = (init.method ?? "GET").toUpperCase();
        const responseHasBody = method !== "HEAD" && ![204, 205, 304].includes(status);
        const stream = responseHasBody
          ? Readable.toWeb(incoming) as ReadableStream<Uint8Array>
          : null;
        const response = new Response(stream, {
          status,
          statusText: incoming.statusMessage,
          headers: responseHeaders
        });
        Object.defineProperty(response, "url", { value: url.toString(), configurable: true });
        if (!responseHasBody) incoming.resume();
        resolve(response);
      } catch (error) {
        incoming.destroy();
        reject(error);
      }
    });
    request.once("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

/** Fetch-совместимый потоковый запрос через SOCKS5/HTTP(S); без proxy сохраняет обычный fetch. */
export async function proxyFetch(input: string | URL | Request, init: RequestInit = {}, proxy?: ProxyConfig): Promise<Response> {
  return observeNetwork(input instanceof Request ? input.url : String(input), init.method ?? (input instanceof Request ? input.method : "GET"),
    proxy ? "proxy" : "system", () => proxyFetchInternal(input, init, proxy));
}

async function proxyFetchInternal(
  input: string | URL | Request,
  init: RequestInit = {},
  proxy?: ProxyConfig
): Promise<Response> {
  if (!proxy) return fetch(input, init);
  let url = input instanceof Request ? new URL(input.url) : new URL(input.toString());
  let requestInit: RequestInit;
  if (input instanceof Request) {
    requestInit = {
      method: input.method,
      headers: input.headers,
      signal: init.signal ?? input.signal,
      redirect: input.redirect,
      ...init
    };
    // A Request exposes its body as a ReadableStream. Buffer it once so 307/308
    // redirects can safely replay the same payload through a new tunnel.
    if (init.body === undefined && input.body !== null) {
      requestInit.body = Buffer.from(await input.arrayBuffer()) as BodyInit;
    }
  } else {
    requestInit = { ...init };
  }
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await proxyFetchOnce(url, requestInit, proxy).catch(error => {
      // After a redirect an earlier HTTP request has already reached a server.
      if (redirectCount > 0 && error instanceof ProxyConnectError) throw new Error(error.message, { cause: error });
      throw error;
    });
    const location = response.headers.get("location");
    const isRedirect = [301, 302, 303, 307, 308].includes(response.status) && Boolean(location);
    if (!isRedirect || requestInit.redirect === "manual") {
      if (redirectCount > 0) Object.defineProperty(response, "redirected", { value: true, configurable: true });
      return response;
    }
    if (requestInit.redirect === "error") {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Proxy: сервер вернул перенаправление");
    }
    if (redirectCount === 5) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Proxy: слишком много перенаправлений");
    }
    const previous = url;
    url = new URL(location!, url);
    const headers = new Headers(requestInit.headers);
    if (url.origin !== previous.origin) {
      headers.delete("authorization");
      headers.delete("cookie");
    }
    const method = (requestInit.method ?? "GET").toUpperCase();
    const switchToGet = (response.status === 303 && method !== "GET" && method !== "HEAD")
      || ((response.status === 301 || response.status === 302) && method === "POST");
    if (switchToGet) {
      headers.delete("content-length");
      headers.delete("content-encoding");
      headers.delete("content-language");
      headers.delete("content-location");
      headers.delete("content-type");
      requestInit = { ...requestInit, method: "GET", body: undefined, headers };
    } else {
      requestInit = { ...requestInit, headers };
    }
    await response.body?.cancel().catch(() => undefined);
  }
  throw new Error("Proxy: слишком много перенаправлений");
}

/** Буферизованный запрос через SOCKS5/HTTP(S) (или напрямую, если proxy не задан). */
export async function proxyRequest(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
    timeoutMs?: number;
    signal?: AbortSignal;
    redirect?: RequestRedirect;
  },
  proxy: ProxyConfig | undefined
): Promise<ProxyResponse> {
  const timeoutMs = init.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Proxy: некорректный таймаут");
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  const response = await proxyFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body as BodyInit | undefined,
    redirect: init.redirect,
    signal
  }, proxy);
  const body = Buffer.from(await response.arrayBuffer());
  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    text: () => body.toString("utf8"),
    json: <T,>() => JSON.parse(body.toString("utf8")) as T
  };
}
