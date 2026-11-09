import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createVoiceCalibration } from "@gold-work/shared";
import { documentaryDownloadBytes, DocumentaryYouTube, downloadWithYtDlp, youtubeDocumentaryCandidates } from "./documentary-youtube.js";
import { DocumentaryProjectService } from "./documentary-project-service.js";
import { DocumentarySearch } from "./documentary-search.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { prepareDocumentaryScript } from "./documentary-plan.js";
import { effectFfmpeg } from "./effect-media.js";

test("download progress counts the active partial and fragments, not an older format or checkpoint JSON", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-part-progress-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const active = join(root, "137.mp4");
  await writeFile(join(root, "active.json"), JSON.stringify(active));
  await writeFile(`${active}.part`, Buffer.alloc(100));
  await writeFile(`${active}.part-Frag4.part`, Buffer.alloc(20));
  await writeFile(`${active}.ytdl`, Buffer.alloc(200));
  await writeFile(join(root, "299.mp4.part"), Buffer.alloc(500));
  assert.equal(await documentaryDownloadBytes("unused", root), 120);
  await writeFile(active, Buffer.alloc(150));
  assert.equal(await documentaryDownloadBytes("unused", root), 150);
  await writeFile(join(root, "active.json"), JSON.stringify(join(root, "..", "outside.mp4")));
  assert.equal(await documentaryDownloadBytes("unused", root), 0);
});

// Opt-in local media integration: actual yt-dlp + HTTP Range + FFmpeg. Only the
// discovery/license response and the URL are fixtures; no external paid calls.
test("Stop preserves a real download and another scene resumes it after a service restart", { skip: !process.env.GWS_LOCAL_YTDLP_CHECK }, async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-real-download-resume-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = join(root, "fixture.mp4");
  await effectFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30", "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-an", "-movflags", "+faststart", fixture]);
  const data = await readFile(fixture);
  assert.ok(data.length > 768 * 1024);
  const requests: { attempt: number; start: number; sent: number }[] = [];
  let attempts = 0;
  const server = createServer((req, res) => {
    const start = Number(req.headers.range?.match(/^bytes=(\d+)-/)?.[1] ?? 0);
    const request = { attempt: attempts, start, sent: 0 }; requests.push(request);
    if (start >= data.length) { res.writeHead(416, { "Content-Range": `bytes */${data.length}` }); res.end(); return; }
    res.writeHead(req.headers.range ? 206 : 200, { "Content-Type": "video/mp4", "Content-Length": data.length - start,
      "Accept-Ranges": "bytes", ...(req.headers.range ? { "Content-Range": `bytes ${start}-${data.length - 1}/${data.length}` } : {}) });
    if (req.method === "HEAD") { res.end(); return; }
    let offset = start;
    const timer = setInterval(() => {
      const end = Math.min(offset + 64 * 1024, data.length);
      request.sent += end - offset; res.write(data.subarray(offset, end)); offset = end;
      if (offset === data.length) { clearInterval(timer); res.end(); }
    }, attempts === 1 ? 40 : 1);
    res.on("close", () => clearInterval(timer));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const video = { id: "abcdefghijk", snippet: { title: "Local test pattern" }, status: { license: "creativeCommon", privacyStatus: "public" }, contentDetails: { duration: "PT4S" } };
  const candidate = youtubeDocumentaryCandidates([video], "test pattern")[0]!;
  const paths: string[] = [];
  let licenseChecks = 0;
  const downloader = () => new DocumentaryYouTube({ apiKey: async () => "local-fixture", resolveValidatedCookies: async () => undefined },
    async () => { licenseChecks++; return Response.json({ items: [video] }); },
    async (args, destination, signal, onProgress, partialDirectory) => {
      attempts++; paths.push(destination);
      const controller = new AbortController();
      const localArgs = [...args.slice(0, -1), `http://127.0.0.1:${address.port}/fixture.mp4`];
      // Generic HTTP has no YouTube height metadata; the fixture itself is 720p.
      localArgs[localArgs.indexOf("-f") + 1] = "best[ext=mp4]";
      await downloadWithYtDlp(localArgs, destination,
        signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
        bytes => { onProgress?.(bytes); if (attempts === 1 && bytes >= 256 * 1024) controller.abort(); }, partialDirectory);
    });
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  let project = await projects.create({ title: "Local resume", topic: "Fixture", mediaMode: "stock", mode: "standard", language: "English", aspectRatio: "16:9" });
  project.videoBrief = { ...project.videoBrief!, creationMode: "script", readyScript: "The red tractor works in a field. Its blue wheels grip the soil." };
  project.scenes = prepareDocumentaryScript(project, createVoiceCalibration({ provider: "elevenlabs", voice: "fixture", language: "en", sampleText: "This is a measured voice for a local test.", audioDurationSeconds: 4 }))
    .slice(0, 2).map(scene => ({ ...scene, audioPath: `preserved-${scene.id}.mp3`, documentary: { ...scene.documentary!, candidates: [candidate] } }));
  assert.equal(project.scenes.length, 2);
  project = await projects.update(project.id, project);
  const before = JSON.stringify(project);
  const service = () => new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, "projects")), new DocumentarySearch(), join(root, "Materials"),
    { download: async () => { throw new Error("Unexpected stock download"); } }, undefined, undefined, undefined, downloader());
  await assert.rejects(service().applyCandidate(project.id, project.scenes[0]!.id, candidate.id), { name: "AbortError" });
  assert.equal(JSON.stringify(await projects.get(project.id)), before, "Stop must not replace a scene with incomplete bytes");
  const partialDirectory = `${paths[0]}.resume`;
  const partial = (await readdir(partialDirectory)).find(name => name.endsWith(".mp4.part")); assert.ok(partial);
  const preservedBytes = (await stat(join(partialDirectory, partial))).size; assert.ok(preservedBytes >= 256 * 1024);
  await assert.rejects(stat(paths[0]!), { code: "ENOENT" });
  const result = await service().applyCandidate(project.id, project.scenes[1]!.id, candidate.id);
  assert.equal(paths[1], paths[0], "Different scenes and service instances reuse the same source checkpoint");
  assert.equal(licenseChecks, 2, "A resumed source still requires its public CC license");
  assert.ok(requests.some(r => r.attempt === 2 && r.start === preservedBytes), `Actual yt-dlp must send the saved byte offset in HTTP Range: ${JSON.stringify({ preservedBytes, requests })}`);
  const selected = result.scenes[1]!.documentary!.selected!;
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash(await readFile(selected.localPath!)), hash(data), "Resumed bytes must exactly match the complete media fixture");
  assert.deepEqual(result.scenes.map(s => s.audioPath), project.scenes.map(s => s.audioPath));
  assert.deepEqual(result.scenes.map(s => s.narration), project.scenes.map(s => s.narration));
  assert.equal(result.scenes[1]!.documentary!.verified, false, "Downloading never substitutes for semantic/pixel acceptance");
  await service().applyCandidate(project.id, project.scenes[0]!.id, candidate.id);
  assert.equal(attempts, 2, "The next scene reuses the registered original, without another download");
  console.log(JSON.stringify({ localDownloadResume: { totalBytes: data.length, preservedBytes, licenseChecks, requests, checksumMatches: true } }));
});
