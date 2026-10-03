/** Bounded live audio analysis of an existing Lumean clip; never orders speech or edits a user project. */
import { app } from "electron";
import { copyFileSync, mkdtempSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import type { Project } from "@gold-work/shared";
import { AnyModelStore } from "../src/anymodel-store.js";
import { AnyModelClient } from "../src/anymodel-client.js";
import { DocumentaryIntelligence } from "../src/documentary-intelligence.js";
import { inspectNarration } from "../src/standard-renderer.js";

const profile = join(process.env.APPDATA!, "@gold-work", "desktop");
const temporary = mkdtempSync(join(tmpdir(), "gws-documentary-alignment-"));
copyFileSync(join(profile, "Local State"), join(temporary, "Local State"));
app.setPath("userData", temporary);
app.on("window-all-closed", () => undefined);
const output = resolve("captures/documentary-control/alignment-check");
const clean = (value: unknown) => String(value instanceof Error ? value.message : value).replace(/(?:https?|socks5h?):\/\/[^\s]+/gi, "[URL]").slice(0, 600);
app.whenReady().then(async () => {
  await mkdir(output, { recursive: true });
  const projects = JSON.parse(await readFile(join(profile, "projects.json"), "utf8")) as Project[];
  const source = projects.find(project => project.id === "project_mu04dsry_gxx759k")!;
  assert.ok(source);
  const clip = source.scenes[0]!; assert.ok(clip.audioPath);
  const pieces = ["All right, let's go. ", "Number eight, just watch the streaming cheat code. "];
  assert.equal(pieces.join(""), clip.narration);
  const project = { ...source, id: "existing-voice-clip-alignment", scenes: pieces.map((narration, order) => ({ ...clip, id: `clip-${order}`, order, narration, includeInAssembly: true })) };
  const timing = await inspectNarration(clip.audioPath);
  const client = new AnyModelClient(new AnyModelStore(join(profile, "credentials", "anymodel.json")));
  const intelligence = new DocumentaryIntelligence(client, () => output);
  try {
    const starts = await intelligence.alignNarration(project, clip.audioPath, timing);
    const result = { status: "aligned", sourceProjectId: source.id, sourceSceneId: clip.id, narration: clip.narration, timing, starts,
      limitation: "One existing four-second voice clip; not proof of five-minute alignment or final montage quality." };
    await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result)); app.exit(0);
  } catch (error) {
    await writeFile(join(output, "result.json"), JSON.stringify({ status: "failed", timing, error: clean(error) }, null, 2));
    console.error(clean(error)); app.exit(1);
  }
}).catch(error => { console.error(clean(error)); app.exit(1); });
