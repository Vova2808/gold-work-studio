import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { withDocumentaryDownloadBudget, documentaryDownloadTimedOut } from "./documentary-download.js";

test("automatic media transfer is aborted at remaining phase deadline, without background work", async () => {
  let active = false, observed: AbortSignal | undefined;
  await assert.rejects(withDocumentaryDownloadBudget({ automatic: true, kind: "image", deadline: Date.now() + 40 }, async signal => {
    active = true; observed = signal;
    try { await delay(10_000, undefined, { signal }); } finally { active = false; }
  }), error => {
    assert.match(String(error), /время автоматической загрузки/);
    assert.equal(documentaryDownloadTimedOut(error), true, 'the real budget expiry must skip the next slow YouTube download');
    return true;
  });
  assert.equal(active, false); assert.equal(observed?.aborted, true);
});

test('all existing download watchdog messages are timeouts, user Stop and source errors are not',()=>{
  for(const message of ['Источник превысил время автоматической загрузки.', 'Загрузка YouTube превысила 15 минут', 'YouTube download timeout', 'Источник не начал передачу', 'новые данные не поступают'])
    assert.equal(documentaryDownloadTimedOut(new Error(message)),true,message);
  for(const message of ['Загрузка остановлена пользователем','HTTP 404','Оригинал не подтверждён'])assert.equal(documentaryDownloadTimedOut(new Error(message)),false);
});

test("expired auto stage sends no GET; manual download is not silently shortened", async () => {
  let calls = 0;
  await assert.rejects(withDocumentaryDownloadBudget({ automatic: true, kind: "video", deadline: 0 }, async () => { calls++; }), /время/);
  assert.equal(calls, 0);
  const stop = new AbortController();
  assert.equal(await withDocumentaryDownloadBudget({ automatic: false, kind: "image", deadline: 0, signal: stop.signal }, async signal => {
    assert.equal(signal, stop.signal); return "manual";
  }), "manual");
});

test("user Stop is preserved and a successful transfer cannot be aborted later by a stale timer", async () => {
  const stop = new AbortController(), reason = new Error("user stop"); stop.abort(reason);
  await assert.rejects(withDocumentaryDownloadBudget({ automatic: true, kind: "video", signal: stop.signal }, async () => assert.fail()), error => error === reason);
  let observed: AbortSignal | undefined;
  await withDocumentaryDownloadBudget({ automatic: true, kind: "image", deadline: Date.now() + 30 }, async signal => { observed = signal; });
  await delay(60); assert.equal(observed?.aborted, false);
});
