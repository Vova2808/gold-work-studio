// Replay-only GET endpoints with no business logic.
// All return captured JSON snapshots from data/.

import { Router } from "express";
import { fixture } from "../utils/fixtures.js";

const r = Router();

r.get("/payments/plan-gate", (_req, res) =>
  res.json(fixture("payments_plan-gate.json"))
);

r.get("/news/videos", (_req, res) =>
  res.json(fixture("news_videos.json"))
);

r.get("/canvas/strokes", (_req, res) =>
  res.json(fixture("canvas_strokes.json"))
);

r.get("/automation/list", (_req, res) =>
  res.json(fixture("automation_list.json"))
);

r.get("/support/unread-count", (_req, res) =>
  res.json(fixture("support_unread-count.json"))
);

r.get("/video/queue-counts", (_req, res) =>
  res.json(fixture("video_queue-counts.json"))
);

r.get("/story/generation-counts", (_req, res) =>
  res.json(fixture("story_generation-counts.json"))
);

r.get("/story/generation-config", (_req, res) =>
  res.json(fixture("story_generation-config.json"))
);

r.get("/story/custom-styles", (_req, res) =>
  res.json(fixture("story_custom-styles.json"))
);

export default r;
