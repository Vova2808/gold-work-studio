// patch_bundle.mjs — rewrite API/Supabase URLs in the prod bundle to point at our local server.
// Run: node patch_bundle.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve("apps/web/dist");
const TARGETS = [
  { from: /https:\/\/insaga\.net\/api/g, to: "http://localhost:3000/api" },
  { from: /https:\/\/insaga\.net\//g, to: "http://localhost:3000/" },
  // Supabase: redirect to a local stub origin. We don't run Supabase yet,
  // so the front will get HTTP errors there — that's fine, auth is stubbed
  // server-side. Keep the rewrite so prod URLs don't leak.
  { from: /https:\/\/miaqhzcideotkfummykz\.supabase\.co/g, to: "http://localhost:3000/supabase-stub" },
  // socket.io connection URL — usually same-origin, but be safe
  { from: /wss:\/\/insaga\.net/g, to: "ws://localhost:3000" },
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(js|css|html|json)$/i.test(name)) out.push(p);
  }
  return out;
}

let totalReplacements = 0;
let touched = 0;
for (const file of walk(ROOT)) {
  let body = readFileSync(file, "utf-8");
  let count = 0;
  for (const { from, to } of TARGETS) {
    body = body.replace(from, () => {
      count++;
      return to;
    });
  }
  if (count > 0) {
    writeFileSync(file, body);
    touched++;
    totalReplacements += count;
    console.log(`  patched ${file.replace(ROOT, "")}: ${count}`);
  }
}
console.log(`\n[patch_bundle] ${totalReplacements} replacements across ${touched} files.`);
