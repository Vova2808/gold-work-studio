import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MIN_FREE_DISK_BYTES,
  describeCookiesProblem,
  evaluateFreeSpace,
  formatBytes,
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
