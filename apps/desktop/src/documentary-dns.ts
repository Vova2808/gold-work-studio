import { connect, isIP, type Socket } from "node:net";
import { createConnectProxyBridge } from "./proxy-utils.js";

const allowedHosts = ["youtube.com", "googlevideo.com", "ytimg.com", "youtubei.googleapis.com", "youtube-nocookie.com"];
export async function resolveYouTubeIpv4(host: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<string> {
  host = host.toLowerCase();
  if (!allowedHosts.some(domain => host === domain || host.endsWith(`.${domain}`))) throw new Error("Публичный DNS разрешён только для загрузки YouTube");
  const url = new URL("https://dns.google/resolve"); url.searchParams.set("name", host); url.searchParams.set("type", "A");
  const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Публичный DNS недоступен (${response.status})`);
  const body = await response.json() as { Status?: number; Answer?: Array<{ type: number; data: string }> };
  const address = body.Status === 0 ? body.Answer?.find(item => item.type === 1 && isIP(item.data) === 4)?.data : undefined;
  if (!address || /^(?:0|10|127|169\.254|172\.(?:1[6-9]|2\d|3[01])|192\.168|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./.test(address) || Number(address.split(".")[0]) >= 224) throw new Error("Публичный DNS не вернул доступный внешний адрес YouTube");
  return address;
}

/** Process-local DNS route; Windows DNS and hosts files remain untouched. TLS is still end-to-end. */
export async function createYouTubeDnsBridge() {
  const cache = new Map<string, { address: string; expires: number }>();
  return createConnectProxyBridge(async (target, signal) => {
    if (target.port !== 443) throw new Error("Загрузчик YouTube использует только HTTPS");
    const previous = cache.get(target.host);
    const address = previous && previous.expires > Date.now() ? previous.address : await resolveYouTubeIpv4(target.host, fetch, signal);
    cache.set(target.host, { address, expires: Date.now() + 60000 });
    return new Promise<Socket>((resolve, reject) => {
      if (signal?.aborted) { reject(new Error("Соединение отменено")); return; }
      const socket = connect({ host: address, port: target.port });
      const abort = () => socket.destroy(new Error("Соединение отменено"));
      const timeout = setTimeout(() => socket.destroy(new Error("YouTube: таймаут прямого соединения")), 15000);
      const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); };
      signal?.addEventListener("abort", abort, { once: true });
      socket.once("connect", () => { cleanup(); resolve(socket); });
      socket.once("error", error => { cleanup(); reject(error); });
    });
  });
}
