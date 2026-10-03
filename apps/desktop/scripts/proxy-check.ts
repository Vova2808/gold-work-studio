/**
 * Проверка SOCKS5-туннеля: локальный минимальный SOCKS5-сервер + реальный HTTPS-запрос через него.
 * Запуск: npx tsx scripts/proxy-check.ts
 */
import { createServer, connect as netConnect, type Socket } from "node:net";
import { proxyRequest, parseProxyUrl } from "../src/proxy-utils.js";

/** Минимальный SOCKS5-сервер без авторизации: принимает CONNECT и прокидывает байты. */
function startShim(port: number): Promise<() => void> {
  const server = createServer((client: Socket) => {
    let greeted = false;
    client.on("data", (data: Buffer) => {
      if (!greeted) {
        greeted = true;
        client.write(Buffer.from([0x05, 0x00]));
        return;
      }
      const host = data.subarray(5, 5 + (data[4] ?? 0)).toString("utf8");
      const targetPort = data.readUInt16BE(5 + (data[4] ?? 0));
      client.removeAllListeners("data"); // дальше идут байты TLS — их только прокидываем
      const upstream = netConnect({ host, port: targetPort }, () => {
        client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
    });
    client.on("error", () => undefined);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(() => server.close())));
}

const stop = await startShim(11080);
try {
  const url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1";
  const direct = await proxyRequest(url, { timeoutMs: 20_000 }, undefined).catch((error: unknown) => error as Error);
  console.log("напрямую:", direct instanceof Error ? `ошибка — ${direct.message}` : `HTTP ${direct.status}`);
  const viaProxy = await proxyRequest(url, { timeoutMs: 20_000 }, parseProxyUrl("socks5://127.0.0.1:11080"))
    .catch((error: unknown) => error as Error);
  if (viaProxy instanceof Error) {
    console.error("через SOCKS5: ошибка —", viaProxy.message);
    process.exitCode = 1;
  } else {
    console.log("через SOCKS5: HTTP", viaProxy.status, "тело", viaProxy.body.byteLength, "байт");
  }
} finally {
  stop();
}
