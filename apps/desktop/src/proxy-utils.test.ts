import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, createServer as createNetServer, type Socket } from "node:net";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  createSocks5BrowserProxyBridge,
  createAuthenticatedProxyBridge,
  parseProxyUrl,
  proxyDisplayName,
  proxyFetch,
  proxyRequest,
  ProxyConnectError,
  socks5Connect,
  type ProxyConfig
} from "./proxy-utils.js";
import { VoicerClient, VoicerClientError } from "./voicer-client.js";

class SocketReader {
  private buffer: Buffer = Buffer.alloc(0);
  private waiting?: { size: number; resolve: (bytes: Buffer) => void; reject: (error: Error) => void };
  private ended = false;

  constructor(socket: Socket) {
    socket.on("data", (data: Buffer) => { this.buffer = Buffer.concat([this.buffer, data]); this.drain(); });
    socket.on("error", () => this.finish());
    socket.on("close", () => this.finish());
  }

  read(size: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      assert.equal(this.waiting, undefined);
      this.waiting = { size, resolve, reject };
      this.drain();
    });
  }

  private drain(): void {
    const request = this.waiting;
    if (!request) return;
    if (this.buffer.length >= request.size) {
      this.waiting = undefined;
      const bytes = this.buffer.subarray(0, request.size);
      this.buffer = this.buffer.subarray(request.size);
      request.resolve(bytes);
    } else if (this.ended) {
      this.waiting = undefined;
      request.reject(new Error("local mock closed"));
    }
  }

  private finish(): void { this.ended = true; this.drain(); }
}

async function localProxy(context: TestContext, handler: (socket: Socket, reader: SocketReader, index: number) => Promise<void>): Promise<ProxyConfig> {
  const sockets = new Set<Socket>();
  const failures: unknown[] = [];
  let index = 0;
  const server = createNetServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    void handler(socket, new SocketReader(socket), index++).catch((error: unknown) => {
      if (!(error instanceof Error && error.message === "local mock closed")) failures.push(error);
      socket.destroy();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.deepEqual(failures, []);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { host: "127.0.0.1", port: address.port };
}

async function localHttpTarget(
  context: TestContext,
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<{ url: string; port: number }> {
  const sockets = new Set<Socket>();
  const server = createHttpServer(handler);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}`, port: address.port };
}

async function localHttpConnectProxy(context: TestContext): Promise<{
  config: ProxyConfig;
  connects: Array<{ authority: string; authorization?: string }>;
}> {
  const sockets = new Set<Socket>();
  const connects: Array<{ authority: string; authorization?: string }> = [];
  const server = createHttpServer((_request, response) => {
    response.writeHead(405, { Connection: "close" });
    response.end();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("connect", (request, rawClientSocket, head) => {
    const clientSocket = rawClientSocket as Socket;
    const authority = request.url ?? "";
    connects.push({
      authority,
      authorization: typeof request.headers["proxy-authorization"] === "string"
        ? request.headers["proxy-authorization"]
        : undefined
    });
    const destination = new URL(`http://${authority}`);
    const upstream = connect({
      host: destination.hostname.replace(/^\[|\]$/g, ""),
      port: Number(destination.port || 80)
    });
    sockets.add(upstream);
    upstream.once("close", () => sockets.delete(upstream));
    upstream.once("error", () => clientSocket.destroy());
    clientSocket.once("error", () => upstream.destroy());
    clientSocket.once("close", () => upstream.destroy());
    upstream.once("connect", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: local-test\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    config: { host: "127.0.0.1", port: address.port, protocol: "http" },
    connects
  };
}

async function greeting(reader: SocketReader): Promise<Buffer> {
  const header = await reader.read(2);
  assert.equal(header[0], 5);
  return reader.read(header[1]!);
}

async function connectRequest(reader: SocketReader): Promise<{ type: number; address: Buffer; port: number }> {
  const header = await reader.read(4);
  assert.deepEqual([...header.subarray(0, 3)], [5, 1, 0]);
  const type = header[3]!;
  const length = type === 1 ? 4 : type === 4 ? 16 : (await reader.read(1))[0]!;
  const address = await reader.read(length);
  const port = (await reader.read(2)).readUInt16BE();
  return { type, address, port };
}

async function fragmented(socket: Socket, bytes: Buffer): Promise<void> {
  for (const byte of bytes) { socket.write(Buffer.from([byte])); await delay(2); }
}

const ipv4Reply = Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0x01, 0xbb]);
const target = { host: "example.invalid", port: 443 };

test("Lumean proxy refusal before HTTP clears pending creation and permits a safe retry", { timeout: 4000 }, async context => {
  let tunnels = 0;
  const proxy = await localProxy(context, async (socket, reader) => {
    await greeting(reader); socket.write(Buffer.from([5, 0]));
    await connectRequest(reader); tunnels++;
    socket.write(Buffer.from([5, 5, 0, 1]));
  });
  const client = new VoicerClient({
    publicSettings: async () => ({ configured: true, baseUrl: "https://lumean.invalid/api/public" }),
    apiKey: async () => "fixture-key", proxyUrl: async () => `socks5://${proxy.host}:${proxy.port}`,
  } as never);
  let pending = false;
  await assert.rejects(client.tts("Text", "fixture-template", undefined, {
    onBeforeOrderCreate: async () => { pending = true; },
    onOrderRejected: async () => { pending = false; },
  }), error => error instanceof VoicerClientError && error.retryable && !error.creationUncertain && error.cause instanceof ProxyConnectError);
  assert.equal(pending, false);
  assert.equal(tunnels, 1, "One failed handshake, not multiple HTTP submissions");
});

test("proxy refusal after a redirect does not claim the original request was unsent", { timeout: 4000 }, async context => {
  let posts = 0;
  const server = await localHttpTarget(context, (request, response) => {
    if (request.method === "POST") posts++;
    response.writeHead(307, { Location: "http://other.invalid/result" }); response.end();
  });
  const proxy = await localProxy(context, async (socket, reader, index) => {
    await greeting(reader); socket.write(Buffer.from([5, 0]));
    await connectRequest(reader);
    if (index > 0) { socket.write(Buffer.from([5, 5, 0, 1])); return; }
    const upstream = connect(server.port, "127.0.0.1");
    await once(upstream, "connect");
    socket.once("close", () => upstream.destroy());
    socket.write(ipv4Reply); socket.pipe(upstream).pipe(socket);
  });
  await assert.rejects(proxyRequest(`${server.url}/orders`, { method: "POST", body: "fixture" }, proxy),
    error => error instanceof Error && !(error instanceof ProxyConnectError) && error.cause instanceof ProxyConnectError);
  assert.equal(posts, 1);
});

test("proxy URL validates protocols, defaults and UTF-8 credentials without exposing them", () => {
  assert.deepEqual(parseProxyUrl("socks5h://u%40ser:p%3Ass@[::1]:1081"), { host: "::1", port: 1081, user: "u@ser", password: "p:ss" });
  assert.deepEqual(parseProxyUrl("http://local-user:local-pass@proxy.invalid:80"), {
    host: "proxy.invalid", port: 80, user: "local-user", password: "local-pass", protocol: "http"
  });
  assert.deepEqual(parseProxyUrl("https://proxy.invalid"), {
    host: "proxy.invalid", port: 443, user: undefined, password: undefined, protocol: "https"
  });
  assert.equal(proxyDisplayName("http://local-user:local-pass@proxy.invalid:80"), "http://proxy.invalid:80");
  assert.equal(proxyDisplayName("socks5://local-user:local-pass@[::1]:1080"), "socks5://[::1]:1080");
  assert.equal(parseProxyUrl("  "), undefined);
  const secret = "do-not-print-this";
  for (const value of [
    `not-a-url-${secret}`, `ftp://user:${secret}@localhost:1080`, `socks://user:${secret}@localhost:1080`,
    `socksh://user:${secret}@localhost:1080`, `socks5://user:${secret}@localhost:0`,
    `socks5://user:${secret}@localhost:65536`, `socks5://user:${secret}@localhost/path`,
    `socks5://user:${secret}@localhost?x=1`, `socks5://%ZZ:${secret}@localhost`,
    `socks5://${"u".repeat(256)}:${secret}@localhost`, `socks5://user:${secret.repeat(30)}@localhost`,
    `socks5://user:${secret}@${"a".repeat(64)}.invalid`,
  ]) {
    assert.throws(() => parseProxyUrl(value), (error: unknown) => error instanceof Error && !error.message.includes(secret));
  }
  assert.throws(() => parseProxyUrl("socks5://user@localhost"), /логин и пароль/);
});

test("SOCKS no-auth handles fragmented greeting and variable-length reply", { timeout: 4000 }, async (context) => {
  const proxy = await localProxy(context, async (socket, reader) => {
    assert.deepEqual([...await greeting(reader)], [0]);
    await fragmented(socket, Buffer.from([5, 0]));
    const request = await connectRequest(reader);
    assert.equal(request.address.toString(), target.host);
    assert.equal(request.port, 443);
    await fragmented(socket, Buffer.concat([Buffer.from([5, 0, 0, 3, 5]), Buffer.from("bound"), Buffer.from([0, 80])]));
  });
  const socket = await socks5Connect(proxy, target, 2000);
  socket.destroy();
});

test("SOCKS password auth handles fragmented replies and preserves bytes after CONNECT", { timeout: 4000 }, async (context) => {
  const tlsBytes = Buffer.from([0x16, 3, 3, 0, 4, 1, 2, 3, 4]);
  const proxy = await localProxy(context, async (socket, reader) => {
    assert.deepEqual([...await greeting(reader)], [0, 2]);
    await fragmented(socket, Buffer.from([5, 2]));
    const auth = await reader.read(2);
    assert.equal(auth[0], 1);
    assert.equal((await reader.read(auth[1]!)).toString(), "local-user");
    const length = (await reader.read(1))[0]!;
    assert.equal((await reader.read(length)).toString(), "local-pass");
    await fragmented(socket, Buffer.from([1, 0]));
    await connectRequest(reader);
    await fragmented(socket, ipv4Reply.subarray(0, 7));
    socket.write(Buffer.concat([ipv4Reply.subarray(7), tlsBytes]));
  });
  const socket = await socks5Connect({ ...proxy, user: "local-user", password: "local-pass" }, target, 2000);
  const [received] = await once(socket, "data");
  assert.deepEqual(received, tlsBytes);
  socket.destroy();
});

test("SOCKS consumes coalesced protocol replies without dropping application bytes", { timeout: 4000 }, async (context) => {
  const proxy = await localProxy(context, async (socket, reader) => {
    await greeting(reader);
    socket.write(Buffer.concat([Buffer.from([5, 0]), ipv4Reply, Buffer.from("ready")]));
    await connectRequest(reader);
  });
  const socket = await socks5Connect(proxy, target, 2000);
  const [received] = await once(socket, "data");
  assert.equal(received.toString(), "ready");
  socket.destroy();
});

test("SOCKS encodes IP targets and fully reads IPv6 bind replies", { timeout: 4000 }, async (context) => {
  const expected = [Buffer.from([127, 0, 0, 1]), Buffer.from("00000000000000000000ffff7f000001", "hex")];
  const proxy = await localProxy(context, async (socket, reader, index) => {
    await greeting(reader);
    socket.write(Buffer.from([5, 0]));
    const request = await connectRequest(reader);
    assert.equal(request.type, index === 0 ? 1 : 4);
    assert.deepEqual(request.address, expected[index]);
    await fragmented(socket, Buffer.concat([Buffer.from([5, 0, 0, 4]), Buffer.alloc(16), Buffer.from([0, 80])]));
  });
  for (const host of ["127.0.0.1", "::ffff:127.0.0.1"]) {
    const socket = await socks5Connect(proxy, { host, port: 80 }, 2000);
    socket.destroy();
  }
});

for (const [label, reply] of [
  ["method denied", Buffer.from([5, 255])],
  ["wrong SOCKS version", Buffer.from([4, 0])],
  ["unoffered auth method", Buffer.from([5, 2])],
] as const) {
  test(`SOCKS rejects ${label}`, { timeout: 3000 }, async (context) => {
    const proxy = await localProxy(context, async (socket, reader) => { await greeting(reader); socket.write(reply); });
    await assert.rejects(socks5Connect(proxy, target, 1500), /SOCKS5/);
  });
}

for (const [label, reply] of [
  ["wrong auth version", Buffer.from([5, 0])],
  ["password denied", Buffer.from([1, 1])],
] as const) {
  test(`SOCKS rejects ${label}`, { timeout: 3000 }, async (context) => {
    const proxy = await localProxy(context, async (socket, reader) => {
      await greeting(reader);
      socket.write(Buffer.from([5, 2]));
      const header = await reader.read(2);
      await reader.read(header[1]!);
      const length = (await reader.read(1))[0]!;
      await reader.read(length);
      socket.write(reply);
    });
    await assert.rejects(socks5Connect({ ...proxy, user: "u", password: "p" }, target, 1500), /SOCKS5/);
  });
}

test("SOCKS denies malformed CONNECT replies and never connects directly to the target", { timeout: 4000 }, async (context) => {
  let directConnections = 0;
  const destination = await localProxy(context, async () => { directConnections++; });
  const replies = [
    Buffer.from([5, 2, 0, 1]), Buffer.from([4, 0, 0, 1]), Buffer.from([5, 0, 1, 1]),
    Buffer.from([5, 0, 0, 9]), Buffer.from([5, 0, 0, 3, 0]),
  ];
  const proxy = await localProxy(context, async (socket, reader, index) => {
    await greeting(reader);
    socket.write(Buffer.from([5, 0]));
    await connectRequest(reader);
    socket.write(replies[index]!);
  });
  for (const _reply of replies) await assert.rejects(socks5Connect(proxy, destination, 1500), /SOCKS5/);
  assert.equal(directConnections, 0);
});

test("SOCKS rejects invalid configuration before any connection", async (context) => {
  let attempts = 0;
  const proxy = await localProxy(context, async () => { attempts++; });
  for (const input of [{ ...proxy, port: 0 }, { ...proxy, host: "user:password@localhost" }, { ...proxy, password: "only-password" }]) {
    await assert.rejects(socks5Connect(input, target, 500), /SOCKS5/);
  }
  for (const host of ["https://invalid/", "localhost/path", "[localhost]", "host?query", "host#fragment"]) {
    await assert.rejects(socks5Connect(proxy, { host, port: 443 }, 500), /SOCKS5/);
  }
  await assert.rejects(socks5Connect(proxy, target, 0), /SOCKS5/);
  assert.equal(attempts, 0);
});

test("SOCKS timeout covers partial replies and close rejects immediately", { timeout: 3000 }, async (context) => {
  const proxy = await localProxy(context, async (socket, reader, index) => {
    await greeting(reader);
    if (index === 0) socket.write(Buffer.from([5]));
    else socket.end();
  });
  await assert.rejects(socks5Connect(proxy, target, 80), /таймаут/);
  await assert.rejects(socks5Connect(proxy, target, 1500), /закрыл соединение/);
});

test("SOCKS abort closes an in-flight handshake", { timeout: 3000 }, async (context) => {
  let announce!: () => void;
  const connected = new Promise<void>((resolve) => { announce = resolve; });
  let announceClosed!: () => void;
  const closed = new Promise<void>((resolve) => { announceClosed = resolve; });
  const proxy = await localProxy(context, async (socket, reader) => {
    socket.once("close", announceClosed);
    await greeting(reader);
    announce();
  });
  const controller = new AbortController();
  const rejection = assert.rejects(socks5Connect(proxy, target, 1500, controller.signal), /отменено/);
  await connected;
  controller.abort();
  await rejection;
  await closed;
});

test("browser bridge closes both live and pending upstream sockets", { timeout: 5000 }, async (context) => {
  let announcePending!: () => void;
  const pending = new Promise<void>((resolve) => { announcePending = resolve; });
  const remoteSockets: Socket[] = [];
  const proxy = await localProxy(context, async (socket, reader, index) => {
    remoteSockets.push(socket);
    await greeting(reader);
    if (index === 2) { announcePending(); return; }
    socket.write(Buffer.from([5, 0]));
    const request = await connectRequest(reader);
    if (index === 1) assert.equal(request.port, 80);
    socket.write(ipv4Reply);
  });
  const bridge = await createSocks5BrowserProxyBridge(`socks5://127.0.0.1:${proxy.port}`);
  context.after(() => bridge.close());
  const url = new URL(bridge.proxyUrl);
  const live = connect({ host: url.hostname, port: Number(url.port) });
  context.after(() => live.destroy());
  const liveResponse = once(live, "data");
  live.write("CONNECT example.invalid:80 HTTP/1.1\r\nHost: example.invalid:80\r\n\r\n");
  assert.match((await liveResponse)[0].toString(), /200 Connection Established/);
  const waiting = connect({ host: url.hostname, port: Number(url.port) });
  context.after(() => waiting.destroy());
  waiting.write("CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n");
  await pending;
  const closed = remoteSockets.filter((socket) => !socket.destroyed).map((socket) => once(socket, "close"));
  await bridge.close();
  await Promise.all(closed);
  assert.ok(remoteSockets.every((socket) => socket.destroyed));
});

test("browser bridge preserves CONNECT head and upstream application bytes", { timeout: 4000 }, async (context) => {
  const proxy = await localProxy(context, async (socket, reader, index) => {
    await greeting(reader);
    socket.write(Buffer.from([5, 0]));
    await connectRequest(reader);
    socket.write(index === 0 ? ipv4Reply : Buffer.concat([ipv4Reply, Buffer.from("server-hello")]));
    if (index === 1) assert.equal((await reader.read(12)).toString(), "client-hello");
  });
  const bridge = await createSocks5BrowserProxyBridge(`socks5://127.0.0.1:${proxy.port}`);
  context.after(() => bridge.close());
  const url = new URL(bridge.proxyUrl);
  const client = connect({ host: url.hostname, port: Number(url.port) });
  context.after(() => client.destroy());
  const received = new Promise<string>((resolve, reject) => {
    let bytes = "";
    client.on("error", reject);
    client.on("data", (chunk: Buffer) => {
      bytes += chunk.toString();
      if (bytes.includes("server-hello")) resolve(bytes);
    });
  });
  client.write("CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\nclient-hello");
  assert.match(await received, /^HTTP\/1.1 200 Connection Established\r\n[\s\S]*\r\n\r\nserver-hello$/);
  await bridge.close();
});

test("download bridge supports HTTP proxy authentication without exposing upstream credentials locally", { timeout: 5000 }, async (context) => {
  const destination = await localHttpTarget(context, (request, response) => {
    assert.equal(request.headers["proxy-authorization"], undefined);
    response.end("actual tunneled response");
  });
  const upstream = await localHttpConnectProxy(context);
  const bridge = await createAuthenticatedProxyBridge(`http://local-user:local-pass@127.0.0.1:${upstream.config.port}`, { host: "127.0.0.1", port: destination.port });
  context.after(() => bridge.close());
  const local = new URL(bridge.proxyUrl);
  assert.equal(local.username, ""); assert.equal(local.password, ""); assert.equal(local.hostname, "127.0.0.1");
  const response = await proxyFetch(destination.url, {}, parseProxyUrl(bridge.proxyUrl));
  assert.equal(await response.text(), "actual tunneled response");
  assert.ok(upstream.connects.every(item => item.authorization === `Basic ${Buffer.from("local-user:local-pass").toString("base64")}`));
});

test("HTTP CONNECT fetch authenticates only to proxy, follows redirect and streams response", { timeout: 5000 }, async (context) => {
  const seen: Array<{ path: string; method?: string; authorization?: string; cookie?: string; proxyAuthorization?: string; contentType?: string }> = [];
  const targetServer = await localHttpTarget(context, (request, response) => {
    seen.push({
      path: request.url ?? "",
      method: request.method,
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
      proxyAuthorization: request.headers["proxy-authorization"] as string | undefined,
      contentType: request.headers["content-type"]
    });
    request.resume();
    request.once("end", () => {
      if (request.url === "/start") {
        response.writeHead(302, { Location: "/final" });
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.write("stream-");
      setImmediate(() => response.end("complete"));
    });
  });
  const proxy = await localHttpConnectProxy(context);
  proxy.config.user = "local-user";
  proxy.config.password = "local-pass";

  const response = await proxyFetch(`${targetServer.url}/start`, {
    method: "POST",
    headers: {
      authorization: "Bearer destination-token",
      cookie: "session=destination-cookie",
      "content-type": "text/plain",
      "proxy-authorization": "must-not-reach-destination"
    },
    body: "payload"
  }, proxy.config);

  assert.equal(await response.text(), "stream-complete");
  assert.equal(response.redirected, true);
  assert.equal(response.url, `${targetServer.url}/final`);
  assert.equal(proxy.connects.length, 2);
  assert.ok(proxy.connects.every((entry) => entry.authority === `127.0.0.1:${targetServer.port}`));
  assert.ok(proxy.connects.every((entry) => entry.authorization === `Basic ${Buffer.from("local-user:local-pass").toString("base64")}`));
  assert.deepEqual(seen, [
    {
      path: "/start",
      method: "POST",
      authorization: "Bearer destination-token",
      cookie: "session=destination-cookie",
      proxyAuthorization: undefined,
      contentType: "text/plain"
    },
    {
      path: "/final",
      method: "GET",
      authorization: "Bearer destination-token",
      cookie: "session=destination-cookie",
      proxyAuthorization: undefined,
      contentType: undefined
    }
  ]);
});

test("proxy storage requests preserve URL authority and encoded signed query", { timeout: 5000 }, async (context) => {
  const query = "/audio%20track.mp3?credential=test%2Fscope&signature=a%2Bb%3D";
  const targetServer = await localHttpTarget(context, (request, response) => {
    assert.equal(request.headers.host, new URL(targetServer.url).host);
    assert.equal(request.url, query);
    response.end("audio bytes");
  });
  const proxy = await localHttpConnectProxy(context);
  const result = await proxyFetch(`${targetServer.url}${query}`, { headers: { host: "stale.example:443" } }, proxy.config);
  assert.equal(await result.text(), "audio bytes");
});

test("cross-origin redirect removes destination authorization and cookies", { timeout: 5000 }, async (context) => {
  let redirectedHeaders: IncomingMessage["headers"] | undefined;
  const destination = await localHttpTarget(context, (request, response) => {
    redirectedHeaders = request.headers;
    response.end("ok");
  });
  const source = await localHttpTarget(context, (_request, response) => {
    response.writeHead(302, { Location: `${destination.url}/destination` });
    response.end();
  });
  const proxy = await localHttpConnectProxy(context);
  const response = await proxyFetch(`${source.url}/source`, {
    headers: { authorization: "Bearer private", cookie: "private=value" }
  }, proxy.config);
  assert.equal(await response.text(), "ok");
  assert.equal(redirectedHeaders?.authorization, undefined);
  assert.equal(redirectedHeaders?.cookie, undefined);
});

test("HTTP CONNECT fetch represents HEAD and 204 responses without an invalid body", { timeout: 5000 }, async (context) => {
  const targetServer = await localHttpTarget(context, (request, response) => {
    request.resume();
    if (request.url === "/empty") {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Length": "4" });
    response.end(request.method === "HEAD" ? undefined : "body");
  });
  const proxy = await localHttpConnectProxy(context);
  const empty = await proxyFetch(`${targetServer.url}/empty`, {}, proxy.config);
  assert.equal(empty.status, 204);
  assert.equal(empty.body, null);
  assert.equal(await empty.text(), "");
  const head = await proxyFetch(`${targetServer.url}/head`, { method: "HEAD" }, proxy.config);
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.equal(await head.text(), "");
});

test("buffered HTTP request works end-to-end through SOCKS5", { timeout: 5000 }, async (context) => {
  const targetServer = await localHttpTarget(context, (request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.once("end", () => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ method: request.method, body: Buffer.concat(chunks).toString("utf8") }));
    });
  });
  const proxy = await localProxy(context, async (socket, reader) => {
    assert.deepEqual([...await greeting(reader)], [0]);
    socket.write(Buffer.from([5, 0]));
    const request = await connectRequest(reader);
    assert.equal(request.type, 1);
    assert.deepEqual([...request.address], [127, 0, 0, 1]);
    assert.equal(request.port, targetServer.port);
    const upstream = connect({ host: "127.0.0.1", port: targetServer.port });
    upstream.once("error", () => socket.destroy());
    socket.once("error", () => upstream.destroy());
    socket.once("close", () => upstream.destroy());
    await once(upstream, "connect");
    socket.write(ipv4Reply);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const response = await proxyRequest(`${targetServer.url}/data`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: Buffer.from("through-socks")
  }, proxy);
  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), { method: "POST", body: "through-socks" });
});

test("HTTP CONNECT rejection and abort stay credential-safe and close the tunnel", { timeout: 5000 }, async (context) => {
  const sockets = new Set<Socket>();
  let mode: "reject" | "hang" = "reject";
  let announceConnect!: () => void;
  let connected = new Promise<void>((resolve) => { announceConnect = resolve; });
  let announceClose!: () => void;
  let closed = new Promise<void>((resolve) => { announceClose = resolve; });
  const server = createHttpServer();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("connect", (_request, rawSocket) => {
    const socket = rawSocket as Socket;
    if (mode === "reject") {
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\n\r\n");
      return;
    }
    const announceClosedOrEnded = () => announceClose();
    socket.once("end", announceClosedOrEnded);
    socket.once("close", announceClosedOrEnded);
    announceConnect();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const secret = "local-secret-never-in-errors";
  const proxy: ProxyConfig = { host: "127.0.0.1", port: address.port, protocol: "http", user: "local-user", password: secret };
  await assert.rejects(
    proxyRequest("http://127.0.0.1:9/rejected", { timeoutMs: 1000 }, proxy),
    (error: unknown) => error instanceof Error && /407/.test(error.message) && !error.message.includes(secret)
  );

  mode = "hang";
  connected = new Promise<void>((resolve) => { announceConnect = resolve; });
  closed = new Promise<void>((resolve) => { announceClose = resolve; });
  const controller = new AbortController();
  const pending = proxyRequest("http://127.0.0.1:9/hanging", { timeoutMs: 4000, signal: controller.signal }, proxy);
  await connected;
  controller.abort();
  await assert.rejects(pending, /отменено|abort/i);
  await closed;
});
