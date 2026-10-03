/** User-authorized proxy checks. Secrets stay in the Electron main process. */
import { app } from "electron";
import { copyFileSync, mkdirSync } from "node:fs";
import { copyFile, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { AnyModelStore } from "../src/anymodel-store.js";
import { VoicerStore } from "../src/voicer-store.js";
import { VoicerClient } from "../src/voicer-client.js";
import { YouTubeStore } from "../src/youtube-store.js";
import { StockStore } from "../src/stock-store.js";
import { FlowAccountStore } from "../src/flow-account-store.js";
import { StockClient } from "../src/stock-client.js";
import { DocumentarySearch } from "../src/documentary-search.js";
import { selectDocumentaryCandidates } from "../src/documentary-project-service.js";
import { parseProxyUrl, proxyFetch } from "../src/proxy-utils.js";

const realProfile = join(process.env.APPDATA!, "@gold-work", "desktop");
const output = resolve("captures/documentary-network");
const profile = join(output, "profile"); mkdirSync(profile, { recursive: true });
copyFileSync(join(realProfile, "Local State"), join(profile, "Local State"));
app.setPath("userData", profile);
app.whenReady().then(async () => {
  const proxyUrl = await new AnyModelStore(join(realProfile, "credentials", "anymodel.json")).proxyUrl();
  if (!proxyUrl) throw new Error("Existing AnyModel proxy is not configured");
  if (process.argv.includes("--stock-download")) {
    const projects = JSON.parse(await readFile(join(realProfile, "projects.json"), "utf8"));
    const project = projects.find((item: any) => item.id === "project_mu1sc77k_kyoo4o9");
    const scene = project.scenes.find((item: any) => item.order === 45);
    const root = join(realProfile, "workspace", "projects", project.id, "Documentary", "Analysis");
    const files = await Promise.all((await readdir(root)).filter(name => name.endsWith('.json')).map(async name => ({ name, modified: (await stat(join(root, name))).mtimeMs })));
    let candidate: any;
    for (const file of files.sort((a, b) => b.modified - a.modified)) {
      const checkpoint = JSON.parse(await readFile(join(root, file.name), "utf8"));
      if (checkpoint.state !== "complete" || !Array.isArray(checkpoint.result?.ids)) continue;
      const matched = checkpoint.result.ids.map((key: string) => scene.documentary.candidates.find((item: any) => createHash("sha256").update(item.downloadUrl || item.localPath || item.id).digest("hex") === key)).filter(Boolean);
      if (matched.length >= 2 && matched[1].provider === "pixabay" && matched[1].kind === "video") { candidate = matched[1]; break; }
    }
    if (!candidate) throw new Error("Cannot identify the exact recorded second Pixabay download; no substitute tested");
    const stock = new StockClient(new StockStore(join(realProfile, "credentials", "stock.json")));
    let peakRss = process.memoryUsage().rss;
    const monitor = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 250);
    try {
      const path = join(output, `stock-stream-${Date.now()}.mp4`);
      console.log(JSON.stringify({ provider: candidate.provider, title: candidate.title, id: candidate.id, method: "stream-to-file", paidAnalysis: false }));
      const result = await stock.downloadToFile({ provider: candidate.provider, id: candidate.id.replace(/^[^:]+:/, ""), mediaType: candidate.kind, query: candidate.query,
        width: candidate.width || 0, height: candidate.height || 0, downloadUrl: candidate.downloadUrl, pageUrl: candidate.pageUrl,
        previewUrl: candidate.previewUrl || candidate.downloadUrl, author: candidate.author, attribution: candidate.attribution }, path, 750 * 1024 * 1024);
      console.log(JSON.stringify({ ...result, path, peakRssMiB: Math.round(peakRss / 1024 ** 2) }));
    } finally { clearInterval(monitor); }
    app.exit(0); return;
  }
  if (process.argv.includes("--stock-search")) {
    const stock = new StockClient(new StockStore(join(realProfile, "credentials", "stock.json")));
    const search = new DocumentarySearch(stock, undefined, join(output, "stock-cache"));
    for (const query of ["Icon of the Seas", "cruise ship"]) {
      const result = await search.search({ query, kind: "video", providers: ["pexels", "pixabay"], entities: ["Icon of the Seas"] });
      await writeFile(join(output, `${query.replaceAll(" ", "-")}.json`), JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ query, count: result.candidates.length, afterMetadataFilter: selectDocumentaryCandidates(result.candidates, ["Icon of the Seas"], new Set()).length,
        sources: result.sources, sample: result.candidates.slice(0, 5).map(item => ({ title: item.title, description: item.description, provider: item.provider })) }));
    }
    app.exit(0); return;
  }
  if (process.argv.includes("--inventory-proxies")) {
    const stock = new StockStore(join(realProfile, "credentials", "stock.json"));
    const configured = [];
    for (const provider of ["pexels", "pixabay"] as const) {
      const candidate = await stock.proxyUrl(provider);
      configured.push({ provider, configured: Boolean(candidate), sameAsAnyModel: candidate === proxyUrl });
    }
    const flow = new FlowAccountStore(join(realProfile, "credentials", "flow", "accounts.json"));
    const flowProxies = [];
    for (const account of await flow.list()) {
      const { proxyUrl: candidate } = await flow.secret(account.id);
      flowProxies.push({ accountId: account.id, configured: Boolean(candidate), sameAsAnyModel: candidate === proxyUrl });
    }
    console.log(JSON.stringify({ configured, flowProxies })); app.exit(0); return;
  }
  const proxy = parseProxyUrl(proxyUrl)!;
  const path = join(realProfile, "credentials", "voicer.json");
  class ProbeStore extends VoicerStore { override async proxyUrl() { return proxyUrl; } }
  const client = new VoicerClient(new ProbeStore(path), { requestTimeoutMs: 25000, safeRetryAttempts: 0 });
  const result: Record<string, unknown> = { checkedAt: new Date().toISOString(), proxyType: proxy.protocol || "socks5", ttsSubmitted: false };
  const checks = await Promise.allSettled([
    client.templates(AbortSignal.timeout(30000)),
    proxyFetch("https://www.youtube.com/watch?v=4_RnIQomVSs", { signal: AbortSignal.timeout(25000) }, proxy).then(async response => {
      const html = await response.text();
      const raw = /(?:var\s+)?ytInitialPlayerResponse\s*=\s*({[\s\S]*?});/.exec(html)?.[1];
      let player: any; try { player = raw ? JSON.parse(raw) : undefined; } catch { /* Discovery only. */ }
      return { status: response.status, bytes: Buffer.byteLength(html), playback: player?.playabilityStatus?.status, reason: player?.playabilityStatus?.reason,
        formats: (player?.streamingData?.formats?.length ?? 0) + (player?.streamingData?.adaptiveFormats?.length ?? 0) };
    })
  ]);
  const [voice, youtube] = checks;
  result.lumean = voice.status === "fulfilled" ? { connected: true, templateCount: voice.value.length, voice1234Found: voice.value.some(item => item.uuid === "01a05b6f-1999-70b4-b7a5-bee6e783c9a4") } : { connected: false, error: String(voice.reason).replace(/https?:\/\/\S+/g, "[URL]").slice(0, 400) };
  result.youtube = youtube.status === "fulfilled" ? youtube.value : { error: String(youtube.reason).replace(/https?:\/\/\S+/g, "[URL]").slice(0, 400) };
  if (youtube.status === "fulfilled" && youtube.value.status === 200 && process.argv.includes("--apply-youtube")) {
    const youtubePath = join(realProfile, "credentials", "youtube.json");
    await copyFile(youtubePath, join(output, `youtube-before-proxy-${Date.now()}.json`));
    await new YouTubeStore(youtubePath).save({ proxyUrl }); result.youtubeProxySaved = true;
  }
  if (voice.status === "fulfilled" && voice.value.some(item => item.uuid === "01a05b6f-1999-70b4-b7a5-bee6e783c9a4") && process.argv.includes("--apply-lumean")) {
    await copyFile(path, join(output, `voicer-before-proxy-${Date.now()}.json`));
    await new VoicerStore(path).save({ proxyUrl });
    result.lumeanProxySaved = true;
  }
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); app.exit(0);
}).catch(error => { console.error(String(error?.message ?? error).replace(/https?:\/\/\S+/g, "[URL]").slice(0, 500)); app.exit(1); });
