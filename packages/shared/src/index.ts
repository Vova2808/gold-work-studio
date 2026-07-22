export type ProjectMode = "standard" | "pro";
export type ProjectStatus = "draft" | "ready" | "generating" | "complete" | "failed";
export type TaskStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface Scene {
  id: string;
  order: number;
  title: string;
  imagePrompt: string;
  animationPrompt: string;
  narration: string;
  durationSeconds: number;
  imagePath?: string;
  videoPath?: string;
  audioPath?: string;
}

export interface Project {
  id: string;
  title: string;
  topic: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  language: string;
  mode: ProjectMode;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  scenes: Scene[];
}

export interface QueueTask {
  id: string;
  projectId: string;
  sceneId?: string;
  kind: "director" | "image" | "video" | "speech" | "assemble";
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  progress: number;
  error?: string;
}

export interface CreateProjectInput {
  title: string;
  topic: string;
  aspectRatio: Project["aspectRatio"];
  language: string;
  mode: ProjectMode;
}

export interface DesktopApi {
  listProjects(): Promise<Project[]>;
  createProject(input: CreateProjectInput): Promise<Project>;
  createDemoProject(): Promise<Project>;
  getQueue(): Promise<QueueTask[]>;
  getAppInfo(): Promise<{ version: string; dataPath: string; mockMode: boolean }>;
}

