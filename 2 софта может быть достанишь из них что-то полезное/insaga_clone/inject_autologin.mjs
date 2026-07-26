// inject_autologin.mjs — patches dist/index.html to inject a stub Supabase session
// into localStorage BEFORE the main bundle boots. Removes the need for Google OAuth.
//
// Run: node inject_autologin.mjs

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST = resolve("apps/web/dist");
const PROJECT_REF = "miaqhzcideotkfummykz"; // original supabase project ref the bundle expects
const STUB_USER_ID = "668c2585-7102-452c-b047-066af207be03";
const STUB_EMAIL = "lo@local";

// Build a synthetic JWT (alg=none) — supabase-js will decode the payload to read sub/email.
function fakeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const iat = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: "http://localhost:3000/supabase-stub/auth/v1",
    sub: STUB_USER_ID,
    aud: "authenticated",
    exp, iat,
    email: STUB_EMAIL,
    role: "authenticated",
    app_metadata: { provider: "stub", providers: ["stub"] },
    user_metadata: { full_name: "LO", email: STUB_EMAIL, name: "LO" },
    is_anonymous: false,
  })).toString("base64url");
  return `${header}.${payload}.stub`;
}

const accessToken = fakeJwt();
const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;

const session = {
  access_token: accessToken,
  token_type: "bearer",
  expires_in: 60 * 60 * 24 * 365,
  expires_at: expiresAt,
  refresh_token: "stub-refresh",
  user: {
    id: STUB_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: STUB_EMAIL,
    email_confirmed_at: new Date().toISOString(),
    phone: "",
    confirmed_at: new Date().toISOString(),
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: "stub", providers: ["stub"] },
    user_metadata: { full_name: "LO", email: STUB_EMAIL, name: "LO", email_verified: true },
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_anonymous: false,
  },
};

// supabase-js v2 default storage key shape:
//   sb-<projectref>-auth-token
const storageKey = `sb-${PROJECT_REF}-auth-token`;

const legacyToken = JSON.stringify({ currentSession: session, expiresAt: expiresAt });

const bootstrapScript = `<script>
(function(){
  try {
    var key = ${JSON.stringify(storageKey)};
    var sessionJson = ${JSON.stringify(JSON.stringify(session))};
    if (!localStorage.getItem(key)) localStorage.setItem(key, sessionJson);
    if (!localStorage.getItem('supabase.auth.token')) {
      localStorage.setItem('supabase.auth.token', ${JSON.stringify(legacyToken)});
    }
    // Also set with a few alternate naming patterns supabase-js has used:
    localStorage.setItem('sb-auth-token', sessionJson);
    localStorage.setItem('sb-localhost-auth-token', sessionJson);

    // Mark as authenticated for any custom checks the app might do.
    localStorage.setItem('insaga.authenticated', '1');
    localStorage.setItem('insaga.user', JSON.stringify({
      id: ${JSON.stringify(STUB_USER_ID)},
      email: ${JSON.stringify(STUB_EMAIL)},
      name: 'LO'
    }));

    // Auto-redirect from landing to workspace so the user never sees Sign in.
    var p = location.pathname;
    var landingPaths = ['/', '/index.html', '/about.html', '/faq.html', '/features.html', '/pricing.html'];
    if (landingPaths.indexOf(p) !== -1) {
      // Defer so any same-tick redirect from the bundle doesn't conflict.
      setTimeout(function(){
        if (location.pathname === p) location.replace('/workspace');
      }, 50);
    }
  } catch(e){ console.warn('autologin bootstrap failed', e); }
})();
</script>
`;

function patchHtml(path) {
  let html = readFileSync(path, "utf-8");
  if (html.includes("autologin bootstrap failed")) return false; // already patched
  // Inject right after <head>
  html = html.replace(/<head>/i, "<head>\n" + bootstrapScript);
  writeFileSync(path, html);
  return true;
}

let patched = 0;
for (const name of readdirSync(DIST)) {
  if (name.endsWith(".html")) {
    const p = join(DIST, name);
    if (patchHtml(p)) {
      console.log("  patched", name);
      patched++;
    }
  }
}
console.log(`\n[autologin] patched ${patched} html files. Storage key: ${storageKey}`);
