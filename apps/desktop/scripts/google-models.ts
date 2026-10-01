/**
 * Показывает, какие модели видит ключ Google AI Studio и какие из них умеют видео.
 * Ключ и прокси берутся из аргументов: npx tsx scripts/google-models.ts <apiKey> [socks5://...]
 */
import { parseProxyUrl, proxyRequest } from "../src/proxy-utils.js";

const [key, proxyUrl] = process.argv.slice(2);
if (!key) {
  console.error("Укажите ключ: npx tsx scripts/google-models.ts <apiKey> [socks5://логин:пароль@хост:порт]");
  process.exit(1);
}

const proxy = parseProxyUrl(proxyUrl);
const response = await proxyRequest(
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
  { headers: { "x-goog-api-key": key }, timeoutMs: 30_000 },
  proxy
);
if (!response.ok) {
  console.error(`HTTP ${response.status}: ${response.text().slice(0, 400)}`);
  process.exit(1);
}

interface Model {
  name?: string;
  supportedGenerationMethods?: string[];
}
const models = response.json<{ models?: Model[] }>().models ?? [];
console.log(`всего моделей: ${models.length}\n`);
for (const model of models) {
  const id = (model.name ?? "").replace("models/", "");
  const methods = model.supportedGenerationMethods ?? [];
  if (/veo|omni|video/i.test(id) || methods.some((method) => /Video|predictLongRunning|interactions/i.test(method))) {
    console.log(`${id}  →  ${methods.join(", ") || "методы не указаны"}`);
  }
}
