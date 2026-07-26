// Stage 1: characters + locations + props from story text.
// Calls Gemini Pro with the reconstructed system prompt.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateContent, firstText } from "./gemini.js";

const STAGE1_PROMPT = readFileSync(
  resolve(process.cwd(), "packages/prompts/stage1.md"),
  "utf-8"
);

const STAGE2_PROMPT = readFileSync(
  resolve(process.cwd(), "packages/prompts/stage2.md"),
  "utf-8"
);

const STORY_MODEL = process.env.GEMINI_STORY_MODEL ?? "gemini-2.5-pro";

export interface Stage1Input {
  text: string;
  style: string;
  promptSuffix?: string;
  frameCount: number;
  tempo: string;
  cameraPreset: string;
  aspectRatio: string;
  storyMode: string;
  imageModel: string;
  userId?: string;
}

export interface Stage1Output {
  characters: any[];
  locations: any[];
  props: any[];
}

export async function runStage1(input: Stage1Input): Promise<Stage1Output> {
  const userMsg = JSON.stringify(input, null, 2);

  const resp = await generateContent(STORY_MODEL, {
    systemInstruction: { parts: [{ text: STAGE1_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Produce the stage1 JSON for this request. JSON only.\n\n" +
              userMsg,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.9,
      responseMimeType: "application/json",
    },
  }, input.userId);

  const text = firstText(resp);
  return JSON.parse(text);
}

export interface Stage2Input {
  storyRequest: any;
  characters: any[];
  locations: any[];
  props: any[];
  preGenScenes: any[];
  totalDuration: number;
  userId?: string;
}

export async function runStage2(
  input: Stage2Input
): Promise<{ scenes: any[] }> {
  const userMsg = JSON.stringify(input, null, 2);

  const resp = await generateContent(STORY_MODEL, {
    systemInstruction: { parts: [{ text: STAGE2_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Produce the stage2 scenes JSON for this request. JSON only.\n\n" +
              userMsg,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.85,
      responseMimeType: "application/json",
    },
  }, input.userId);

  const text = firstText(resp);
  return JSON.parse(text);
}
