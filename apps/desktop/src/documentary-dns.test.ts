import assert from "node:assert/strict";
import test from "node:test";
import { resolveYouTubeIpv4 } from "./documentary-dns.js";

test("YouTube public DNS only resolves allowed HTTPS media hosts to external IPv4 addresses", async () => {
  let calls = 0;
  const resolver: typeof fetch = async input => { calls++; const url = new URL(String(input));
    assert.equal(url.origin, "https://dns.google"); assert.equal(url.searchParams.get("name"), "rr1.example.googlevideo.com");
    return Response.json({ Status: 0, Answer: [{ type: 5, data: "alias.example" }, { type: 1, data: "142.251.154.4" }] }); };
  assert.equal(await resolveYouTubeIpv4("rr1.example.googlevideo.com", resolver), "142.251.154.4");
  await assert.rejects(resolveYouTubeIpv4("youtube.com.attacker.test", resolver), /только/);
  await assert.rejects(resolveYouTubeIpv4("127.0.0.1", resolver), /только/);
  assert.equal(calls, 1, "Disallowed names never reach the resolver");
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1"]) {
    await assert.rejects(resolveYouTubeIpv4("youtube.com", async () => Response.json({ Status: 0, Answer: [{ type: 1, data: address }] })), /внешний адрес/);
  }
  await assert.rejects(resolveYouTubeIpv4("youtube.com", async () => Response.json({ Status: 3 })), /внешний адрес/);
});
