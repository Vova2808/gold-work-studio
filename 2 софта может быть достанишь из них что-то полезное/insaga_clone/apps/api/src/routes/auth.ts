import { Router } from "express";
import { fixture } from "../utils/fixtures.js";
import { setUserKey, getUserKeyStatus, extractUserId } from "../store/keystore.js";

const r = Router();

// GET /api/auth/status — server reports auth+provider config
r.get("/status", (req, res) => {
  let fx: any = {};
  try { fx = fixture("auth_status.json"); } catch {}
  const userId = extractUserId(req.headers.authorization);
  const keyStatus = getUserKeyStatus(userId);
  res.json({
    ...fx,
    authenticated: true,
    openaiConfigured: keyStatus.openai,
    geminiConfigured: keyStatus.gemini,
    authenticated_override: undefined,
  });
});

// GET /api/auth/key-mode — BYOK status
r.get("/key-mode", (req, res) => {
  const userId = extractUserId(req.headers.authorization);
  const keyStatus = getUserKeyStatus(userId);
  const hasKey = keyStatus.gemini;
  res.json({
    canUseOwnKeys: true,
    doubleKeys: false,
    usingGlobalPool: !hasKey,
    globalPoolHealthy: true,
    hasOwnKeys: hasKey,
    keySource: keyStatus.source,
  });
});

// POST /api/auth/set-key — user sets their own API key
r.post("/set-key", (req, res) => {
  const userId = extractUserId(req.headers.authorization);
  if (!userId) {
    // Fallback: use a default user for local mode
    const { provider, key } = req.body ?? {};
    if (!provider || !key) return res.status(400).json({ error: "provider and key required" });
    setUserKey("local-user", provider, key);
    return res.json({ success: true, provider, message: "Key saved (local mode)" });
  }

  const { provider, key } = req.body ?? {};
  if (!provider || !key) return res.status(400).json({ error: "provider and key required" });

  setUserKey(userId, provider, key);
  console.log(`[auth] User ${userId.substring(0, 8)}... set ${provider} key`);
  res.json({ success: true, provider, message: "Key saved" });
});

// GET /api/auth/get-key-status — check which keys are configured
r.get("/get-key-status", (req, res) => {
  const userId = extractUserId(req.headers.authorization);
  res.json(getUserKeyStatus(userId));
});

export default r;
