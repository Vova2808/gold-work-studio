import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { resolve } from "node:path";

import authRoutes from "./routes/auth.js";
import creditsRoutes from "./routes/credits.js";
import audioRoutes from "./routes/audio.js";
import miscRoutes from "./routes/misc.js";
import userRoutes from "./routes/user.js";
import storyEstimate from "./routes/story_estimate.js";
import storyStatus from "./routes/story_generation_status.js";
import storyGenerate from "./routes/story_generate.js";
import storyRegenerate from "./routes/story_regenerate.js";
import animationRoutes from "./routes/animation.js";
import videoRoutes from "./routes/video.js";
import montazRoutes from "./routes/montaz.js";
import supabaseStub from "./routes/supabase_stub.js";
import { attachSocket } from "./sockets/io.js";

const app = express();
const http = createServer(app);

app.use(cors());
app.use(express.json({ limit: "20mb" }));

// uploaded character/location/scene images
app.use("/uploads", express.static(resolve(process.cwd(), "uploads")));

// patched static frontend (their dist with rewritten URLs)
app.use(express.static(resolve(process.cwd(), "apps/web/dist")));

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/credits", creditsRoutes);
app.use("/api/audio", audioRoutes);
app.use("/api/user", userRoutes);
app.use("/api/story", storyEstimate);
app.use("/api/story", storyStatus);
app.use("/api/story", storyGenerate);
app.use("/api/story", storyRegenerate);
app.use("/api/animation", animationRoutes);
app.use("/api/video", videoRoutes);
app.use("/api/montaz", montazRoutes);
app.use("/supabase-stub", supabaseStub);
app.use("/api", miscRoutes);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// SPA fallback
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(resolve(process.cwd(), "apps/web/dist/index.html"));
});

attachSocket(http);

const PORT = Number(process.env.PORT ?? 3000);
http.listen(PORT, () => {
  console.log(`[insaga_clone] api+web on http://localhost:${PORT}`);
});
