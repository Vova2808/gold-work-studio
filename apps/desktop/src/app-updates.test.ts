import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { AppUpdates } from "./app-updates.js";

class Engine extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  allowDowngrade = true;
  checks = 0;
  installations = 0;
  action = async () => { this.emit("update-not-available"); };
  async checkForUpdates() { this.checks++; this.emit("checking-for-update"); await this.action(); }
  quitAndInstall() { this.installations++; }
}

test("unsupported portable/dev builds never request or install an update", async () => {
  const engine = new Engine();
  const service = new AppUpdates(engine, { version: "0.2.1", supported: false, busy: async () => false, publish: () => {} });
  assert.equal((await service.check()).status, "unsupported");
  await assert.rejects(service.install(), /дождитесь загрузки/);
  assert.equal(engine.checks, 0);
  assert.equal(engine.autoInstallOnAppQuit, false);
});

test("simultaneous checks share one request, report no update, and permit retry after network failure", async () => {
  const engine = new Engine();
  const service = new AppUpdates(engine, { version: "0.2.1", supported: true, busy: async () => false, publish: () => {} });
  engine.action = async () => { await delay(15); engine.emit("update-not-available"); };
  await Promise.all([service.check(), service.check(), service.check()]);
  assert.equal(engine.checks, 1);
  assert.equal(service.snapshot().status, "up-to-date");
  engine.action = async () => { throw Error("network"); };
  assert.equal((await service.check()).status, "error");
  engine.action = async () => { engine.emit("update-not-available"); };
  assert.equal((await service.check()).status, "up-to-date");
});

test("downloaded updates survive busy production and concurrent install clicks launch one installer", async () => {
  const engine = new Engine();
  let production = true;
  const service = new AppUpdates(engine, { version: "0.2.1", supported: true, busy: async () => production, publish: () => {} });
  engine.emit("update-available", { version: "0.2.2" });
  engine.emit("download-progress", { percent: 67.4 });
  assert.equal(service.snapshot().percent, 67);
  engine.emit("update-downloaded", { version: "0.2.2" });
  assert.equal((await service.install()).status, "downloaded");
  assert.match(service.snapshot().message, /Дождитесь завершения/);
  assert.equal(engine.installations, 0);
  assert.equal((await service.check()).status, "downloaded");
  assert.equal(engine.checks, 0);
  production = false;
  await Promise.all([service.install(), service.install()]);
  assert.equal(service.snapshot().status, "installing");
  await delay(300);
  assert.equal(engine.installations, 1);
  service.stop();
});
