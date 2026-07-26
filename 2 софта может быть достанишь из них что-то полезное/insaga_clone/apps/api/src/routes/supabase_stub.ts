// Supabase stub — minimum surface to keep the patched insaga frontend happy.
// We rewrote https://<project>.supabase.co → http://localhost:3000/supabase-stub
// during bundle patching. The frontend's supabase-js client now hits THESE routes.
//
// Endpoints implemented (based on session_01 HAR):
//   POST /supabase-stub/auth/v1/token              — token issue / refresh
//   GET  /supabase-stub/auth/v1/user               — current user profile
//   POST /supabase-stub/auth/v1/logout             — logout (no-op)
//   POST /supabase-stub/rest/v1/rpc/check_user_activation
//   GET  /supabase-stub/rest/v1/user_audio_favorites
//
// We don't run real OAuth. Instead we always return the stub user as if logged in.

import { Router } from "express";

const r = Router();

const STUB_USER_ID = process.env.STUB_USER_ID ?? "668c2585-7102-452c-b047-066af207be03";
const STUB_EMAIL = process.env.STUB_USER_EMAIL ?? "lo@local";

function fakeJwt(): string {
  // Not a real signed JWT — just three base64url segments so libraries that
  // base64-decode the payload still get a parseable object.
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "http://localhost:3000/supabase-stub/auth/v1",
    sub: STUB_USER_ID,
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    iat: Math.floor(Date.now() / 1000),
    email: STUB_EMAIL,
    role: "authenticated",
    app_metadata: { provider: "stub", providers: ["stub"] },
    user_metadata: { full_name: "LO", email: STUB_EMAIL },
  })).toString("base64url");
  const sig = "stub";
  return `${header}.${payload}.${sig}`;
}

function userObject() {
  const now = new Date().toISOString();
  return {
    id: STUB_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: STUB_EMAIL,
    email_confirmed_at: now,
    phone: "",
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: "stub", providers: ["stub"] },
    user_metadata: {
      avatar_url: "",
      email: STUB_EMAIL,
      email_verified: true,
      full_name: "LO",
      name: "LO",
      phone_verified: false,
      sub: STUB_USER_ID,
    },
    identities: [],
    created_at: now,
    updated_at: now,
    is_anonymous: false,
  };
}

function sessionResponse() {
  return {
    access_token: fakeJwt(),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "stub-refresh",
    user: userObject(),
  };
}

// POST /auth/v1/token  (grant_type=password|refresh_token|id_token|...)
r.post("/auth/v1/token", (_req, res) => {
  res.json(sessionResponse());
});

// GET /auth/v1/user
r.get("/auth/v1/user", (_req, res) => {
  res.json(userObject());
});

// POST /auth/v1/logout
r.post("/auth/v1/logout", (_req, res) => {
  res.status(204).end();
});

// POST /rest/v1/rpc/check_user_activation
r.post("/rest/v1/rpc/check_user_activation", (_req, res) => {
  // observed: the prod backend returned `false` — meaning "not blocked".
  // For our stub user, return `true` (active) so all gated UI lights up.
  res.type("application/json").send("true");
});

// GET /rest/v1/user_audio_favorites — empty list
r.get("/rest/v1/user_audio_favorites", (_req, res) => {
  res.json([]);
});

// GET /rest/v1/user_api_keys — frontend reads BYOK keys from here, not from server env.
// We map server-side .env keys into the row Supabase would return.
r.get("/rest/v1/user_api_keys", (_req, res) => {
  const k = process.env.GEMINI_API_KEY ?? "";
  const veo = process.env.VEO_API_KEY ?? k;
  const tts = process.env.TTS_API_KEY ?? "";
  const row = {
    user_id: STUB_USER_ID,
    gemini_api_key: k,
    openai_api_key: process.env.OPENAI_API_KEY ?? "",
    service_account_json: null,
    fastgen_api_key: k,
    fastgen_api_key_2: k,
    voicer_api_key: tts,
    veononstop_api_key: veo,
    veononstop_api_key_2: veo,
  };
  // Supabase REST returns an array for collection-style selects.
  res.json([row]);
});

// Catch-all for any unimplemented Supabase paths — empty 200 instead of 404
// so the frontend doesn't blow up on minor calls.
r.all(/^\/(auth|rest|storage)\/v1\/.*/, (_req, res) => {
  res.json({});
});

export default r;
