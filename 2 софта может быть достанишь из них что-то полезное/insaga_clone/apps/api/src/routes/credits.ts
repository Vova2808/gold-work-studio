import { Router } from "express";

const r = Router();

function buildPayload() {
  return {
    userId: process.env.STUB_USER_ID,
    plan: "studio",
    studioTier: "unlimited",
    credits: Number(process.env.STUB_CREDITS ?? 999999),
    coins: Number(process.env.STUB_COINS ?? 999),
    creditsUsedThisPeriod: 0,
    coinsUsedThisPeriod: 0,
    billingPeriodStart: null,
    billingPeriodEnd: null,
    canUseOwnKeys: !!process.env.GEMINI_API_KEY,
    freeTierUsage: null,
    costs: {
      image: 1,
      character: 1,
      location: 1,
      regeneration: 1,
      edit: 1,
      animation: 3,
      voiceover: 0,
      cover: 0,
      export: 5,
      music: 3,
      lipsync: 1,
    },
    coverCoinCost: 1,
  };
}

// GET /api/credits — bare endpoint some builds hit
r.get("/", (_req, res) => res.json(buildPayload()));

// GET /api/credits/balance — credits/coins + cost table
r.get("/balance", (_req, res) => res.json(buildPayload()));

export default r;
