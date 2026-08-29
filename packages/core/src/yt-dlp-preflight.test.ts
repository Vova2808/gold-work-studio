import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MIN_FREE_DISK_BYTES,
  describeCookiesProblem,
  evaluateFreeSpace,
  formatBytes,
  parseExplicitDurationSeconds,
  parseDurationSeconds,
  parsePastedTranscript,
  ttsLanguageCode,
  validateCookiesContent
} from "@gold-work/shared";

const NETSCAPE_HEADER = "# Netscape HTTP Cookie File\n";

test("valid Netscape cookies with youtube domain pass validation", () => {
  const content = `${NETSCAPE_HEADER}.youtube.com\tTRUE\t/\tTRUE\t0\tLOGIN_INFO\tabc123\n`;
  const result = validateCookiesContent(content);
  assert.equal(result.netscape, true);
  assert.equal(result.hasYouTubeCookie, true);
  assert.equal(describeCookiesProblem(result), undefined);
});

test("non-Netscape content is rejected with a clear message", () => {
  const result = validateCookiesContent("just some random text\nkey=value\n");
  assert.equal(result.netscape, false);
  const problem = describeCookiesProblem(result);
  assert.ok(problem && /Netscape/i.test(problem));
});

test("Netscape file without youtube cookies is rejected", () => {
  const content = `${NETSCAPE_HEADER}.example.com\tTRUE\t/\tFALSE\t0\tsession\txyz\n`;
  const result = validateCookiesContent(content);
  assert.equal(result.netscape, true);
  assert.equal(result.hasYouTubeCookie, false);
  const problem = describeCookiesProblem(result);
  assert.ok(problem && /youtube\.com/i.test(problem));
});

test("comment lines never count as youtube cookies", () => {
  const content = `${NETSCAPE_HEADER}# .youtube.com only appears inside a comment line\n`;
  assert.equal(validateCookiesContent(content).hasYouTubeCookie, false);
});

test("free space evaluation respects the required threshold", () => {
  const low = evaluateFreeSpace(10 * 1024 * 1024, MIN_FREE_DISK_BYTES);
  assert.equal(low.ok, false);
  const enough = evaluateFreeSpace(MIN_FREE_DISK_BYTES, MIN_FREE_DISK_BYTES);
  assert.equal(enough.ok, true);
  const defaulted = evaluateFreeSpace(MIN_FREE_DISK_BYTES - 1);
  assert.equal(defaulted.ok, false);
  assert.equal(defaulted.requiredBytes, MIN_FREE_DISK_BYTES);
});

test("formatBytes renders human readable sizes", () => {
  assert.equal(formatBytes(0), "0 Б");
  assert.equal(formatBytes(512), "512 Б");
  assert.equal(formatBytes(1024), "1.0 КБ");
  assert.equal(formatBytes(512 * 1024 * 1024), "512.0 МБ");
  assert.equal(formatBytes(-5), "0 Б");
});

test("ttsLanguageCode maps project languages to TTS codes", () => {
  assert.equal(ttsLanguageCode("Русский"), "ru");
  assert.equal(ttsLanguageCode("English"), "en");
  assert.equal(ttsLanguageCode("Español"), "es");
  assert.equal(ttsLanguageCode("en"), "en");
  assert.equal(ttsLanguageCode("zh-CN"), "zh-CN");
  assert.equal(ttsLanguageCode("что-то незнакомое"), "ru");
});

test("parseDurationSeconds understands common length inputs", () => {
  assert.equal(parseDurationSeconds("5 минут"), 300);
  assert.equal(parseDurationSeconds("7 мин"), 420);
  assert.equal(parseDurationSeconds("90 секунд"), 90);
  assert.equal(parseDurationSeconds("5:30"), 330);
  assert.equal(parseDurationSeconds("5"), 300); // <=60 → минуты
  assert.equal(parseDurationSeconds("300"), 300); // >60 → секунды
  assert.equal(parseDurationSeconds("сделай хук жёстче"), null);
  assert.equal(parseDurationSeconds("добавь 5 фактов"), null);
});

test("длина из транскрипции не запускает сценарий", () => {
  const transcript = "Вот транскрипция: [0:00] Начало истории. [0:09] Прошло 34 минуты. [0:18] Финал истории.";
  assert.equal(parseExplicitDurationSeconds(transcript), null);
  assert.equal(parseExplicitDurationSeconds("сделай ролик на 30 секунд"), 30);
  assert.equal(parseExplicitDurationSeconds("собери сценарий на 5 минут"), 300);
});

test("вставленная транскрипция разбирается на сегменты", () => {
  const segments = parsePastedTranscript("Вот озвучка: [0:00] Первая фраза. [0:05] Вторая фраза. [0:12] Третья фраза.".padEnd(130, " "));
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map((segment) => segment.startSeconds), [0, 5, 12]);
  assert.deepEqual(segments.map((segment) => segment.durationSeconds), [5, 7, 5]);
  const plain = parsePastedTranscript(`Вот озвучка: ${"длинный текст ролика ".repeat(20)}`);
  assert.equal(plain.length, 1, "озвучка без таймкодов тоже сохраняется как источник");
});
