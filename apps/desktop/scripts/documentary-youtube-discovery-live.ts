/** Bounded CC-video discovery; explicit flags allow one download and applying its tested connection. No AI calls. */
import { app } from "electron";
import { copyFileSync, mkdirSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { YouTubeStore } from "../src/youtube-store.js";
import { DocumentaryYouTube } from "../src/documentary-youtube.js";

const realProfile = join(process.env.APPDATA!, "@gold-work", "desktop");
const output = resolve("captures/documentary-youtube-discovery");
const profile = join(output, "profile"); mkdirSync(profile, { recursive: true });
copyFileSync(join(realProfile, "Local State"), join(profile, "Local State"));
app.setPath("userData", profile);
app.whenReady().then(async () => {
  const downloadId = process.argv.find(value => value.startsWith("--download="))?.slice(11);
  if (downloadId) {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(downloadId)) throw new Error("Invalid video id");
    const query = process.argv.find(value => value.startsWith("--topic="))?.slice(8);
    if (!query) throw new Error("A download needs an explicit topic");
    const storePath = join(realProfile, "credentials", "youtube.json");
    const publicDns = process.argv.includes("--public-dns");
    const cookiesFile = process.argv.find(value => value.startsWith("--cookies-file="))?.slice(15);
    class ProbeStore extends YouTubeStore {
      override async downloadRoute() { return publicDns ? "public-dns" as const : super.downloadRoute(); }
      override async cookiesFilePath() { return cookiesFile ? resolve(cookiesFile) : super.cookiesFilePath(); }
    }
    const youtube = new DocumentaryYouTube(new ProbeStore(storePath));
    const candidates = await youtube.search(query);
    const candidate = candidates.find(candidate => candidate.id === `youtube:${downloadId}`);
    if (!candidate) throw new Error("The source is not in the live licensed search results");
    const destination = join(output, `${downloadId}${cookiesFile ? `-session-${Date.now()}` : ""}.mp4`);
    await youtube.download(candidate, destination);
    if (cookiesFile && process.argv.includes("--apply-cookies")) {
      await copyFile(storePath, join(output, `youtube-before-cookies-${Date.now()}.json`));
      await new YouTubeStore(storePath).save({ cookiesFilePath: resolve(cookiesFile) });
    }
    if (publicDns && process.argv.includes("--apply-route")) {
      await copyFile(storePath, join(output, `youtube-before-direct-dns-${Date.now()}.json`));
      await new YouTubeStore(storePath).save({ downloadRoute: "public-dns" });
    }
    await writeFile(join(output, `${downloadId}.source.json`), JSON.stringify({ ...candidate, localPath: destination }, null, 2));
    console.log(JSON.stringify({ downloaded: destination, title: candidate.title, license: candidate.license }));
    app.exit(0); return;
  }
  const key = await new YouTubeStore(join(realProfile, "credentials", "youtube.json")).apiKey();
  if (!key) throw new Error("Existing YouTube key is not configured");
  const api = async (resource: string, params: Record<string, string>) => {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    for (const [name, value] of Object.entries({ ...params, key })) url.searchParams.set(name, value);
    const response = await fetch(url, { signal: AbortSignal.timeout(18000) });
    const body = await response.json() as { items?: any[]; error?: { message?: string } };
    if (!response.ok) throw new Error(`YouTube ${response.status}: ${(body.error?.message ?? "Request failed").replaceAll(key, "[redacted]")}`);
    return body.items ?? [];
  };
  const requested = process.argv.find(value => value.startsWith("--topic="))?.slice(8);
  const topics = requested ? [requested] : ["SS United States", "Icon of the Seas"];
  const result = [];
  for (const query of topics) {
    const hits = await api("search", { part: "id", type: "video", q: query, videoLicense: "creativeCommon", maxResults: "12" });
    const ids = hits.map(item => item.id?.videoId).filter((id): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(id));
    const videos = ids.length ? await api("videos", { part: "snippet,status,contentDetails", id: ids.join(",") }) : [];
    const candidates = videos.map(video => ({ id: video.id, title: video.snippet?.title, description: video.snippet?.description,
      author: video.snippet?.channelTitle, license: video.status?.license, privacy: video.status?.privacyStatus,
      duration: video.contentDetails?.duration, definition: video.contentDetails?.definition, pageUrl: `https://www.youtube.com/watch?v=${video.id}` }));
    result.push({ query, candidates });
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ query, count: candidates.length, candidates: candidates.map(({ description, ...candidate }) => candidate) }));
  }
  app.exit(0);
}).catch(error => { console.error(String(error instanceof Error ? error.message : error).replace(/https?:\/\/\S+/g, "[URL]").slice(0, 600)); app.exit(1); });
