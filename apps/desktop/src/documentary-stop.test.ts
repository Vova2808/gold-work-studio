import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadWithYtDlp } from "./documentary-youtube.js";

test("Stop terminates the actual download child without waiting for its network timeout", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-stop-child-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = process.env.YT_DLP_PATH;
  process.env.YT_DLP_PATH = process.execPath;
  t.after(() => { if (previous === undefined) delete process.env.YT_DLP_PATH; else process.env.YT_DLP_PATH = previous; });
  const marker = join(root, "started.txt");
  const controller = new AbortController();
  const result = downloadWithYtDlp(["-e", "require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)", marker], join(root, "media.download"), controller.signal);
  // Attach the rejection handler immediately; the test still checks that the
  // process really started before Stop and exited before the promise rejects.
  const stopped = assert.rejects(result, { name: "AbortError" });
  let pid = 0;
  for (let i = 0; i < 100 && !pid; i++) {
    pid = await readFile(marker, "utf8").then(Number, () => 0);
    if (!pid) await new Promise(resolve => setTimeout(resolve, 20));
  }
  controller.abort();
  await stopped;
  assert.ok(pid, "Download child must have started");
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});
