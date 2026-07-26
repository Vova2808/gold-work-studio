// In-memory state for single-user stub mode.
// Replace with Postgres later.

import { nanoid } from "nanoid";

export type Phase =
  | "queued"
  | "characters"
  | "locations"
  | "scenes"
  | "animations"
  | "complete"
  | "error";

export interface GenerationState {
  generationId: string;
  generationType: "stage1" | "stage2" | "animation";
  status: "processing" | "complete" | "error";
  phase: Phase;
  progress: number;
  message: string;
  storyRequest?: any;
  characters: any[];
  locations: any[];
  props: any[];
  scenes: any[];
  totalDuration: number;
  totalScenes: number;
  projectId?: string;
  isRegeneration: boolean;
  regeneratedCount: number;
  socketId?: string;
  startedAt: number;
}

export interface ProjectState {
  id: string;
  userId: string;
  title: string;
  style: string;
  createdAt: string;
  updatedAt: string;
  frameCount: number;
  charactersCount: number;
  locationsCount: number;
  scenesCount: number;
  hasScenes: boolean;
  previewImage: string | null;
  coverPreviewImage: string | null;
  coverHistoryCount: number;
  imageModel: string;
  cameraPreset: string;
  storyMode: string;
  aspectRatio: string;
  projectType?: string;
  characters: any[];
  locations: any[];
  scenes: any[];
}

class State {
  generations = new Map<string, GenerationState>();
  projects = new Map<string, ProjectState>();

  newGenerationId() {
    return "gen_" + nanoid(16);
  }

  newProjectId() {
    return "project_" + Date.now();
  }
}

export const state = new State();
