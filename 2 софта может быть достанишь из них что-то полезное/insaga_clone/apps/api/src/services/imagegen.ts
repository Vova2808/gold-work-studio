// Image generation via Gemini *-image models.
// Returns saved file path under uploads/.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { generateContent, firstInlineData, imageModelFor } from "./gemini.js";

const UPLOADS = resolve(process.cwd(), "uploads");
mkdirSync(UPLOADS, { recursive: true });

export interface GenImageOpts {
  prompt: string;
  uiModel?: string; // GEM_PIX | GEM_PIX_2 | NARWHAL
  aspectRatio?: string; // "16:9" | "9:16" | "1:1"
  refImages?: Array<{ mimeType: string; data: string }>;
  filenamePrefix?: string;
  userId?: string;
}

export interface GenImageResult {
  imageUrl: string; // /uploads/<file>
  absPath: string;
  model: string;
}

export async function generateImage(opts: GenImageOpts): Promise<GenImageResult> {
  const model = imageModelFor(opts.uiModel ?? "NARWHAL");

  const userParts: any[] = [{ text: opts.prompt }];
  for (const ref of opts.refImages ?? []) {
    userParts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
  }

  const resp = await generateContent(model, {
    contents: [{ role: "user", parts: userParts }],
    generationConfig: {
      temperature: 1.0,
      // image models return inlineData parts; mime is image/png by default
    },
  }, opts.userId);

  const inline = firstInlineData(resp);
  if (!inline) {
    throw new Error("Gemini image: no inlineData in response");
  }

  const ext = inline.mimeType.split("/")[1] ?? "png";
  const file = `${opts.filenamePrefix ?? "img"}-${nanoid(12)}.${ext}`;
  const abs = resolve(UPLOADS, file);
  writeFileSync(abs, Buffer.from(inline.data, "base64"));

  return {
    imageUrl: `/uploads/${file}`,
    absPath: abs,
    model,
  };
}
