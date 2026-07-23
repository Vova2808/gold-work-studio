export type ProjectMode = "standard" | "pro";
export type ProjectStatus = "draft" | "ready" | "generating" | "paused" | "complete" | "failed";
export type SceneStatus = "draft" | "queued" | "generating" | "ready" | "failed";
export type TaskStatus = "pending" | "running" | "retry_wait" | "paused" | "blocked" | "done" | "failed" | "cancelled";
export type TaskKind = "director" | "image" | "video" | "speech" | "assemble";
export type AspectRatio = "9:16" | "16:9" | "1:1";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface SubtitleSettings {
  enabled: boolean;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  accentColor: string;
  outlineColor: string;
  outlineWidth: number;
  shadow: boolean;
  bottomMargin: number;
  popWords: boolean;
}

export interface ProjectSettings {
  durationMinutes: number;
  frameChange: "scenario" | "5s" | "10s";
  script: {
    provider: "mock" | "gemini" | "claude" | "anymodel";
    model: string;
  };
  voice: {
    enabled: boolean;
    provider: "edge-tts" | "elevenlabs";
    voice: string;
    singleTrack: boolean;
  };
  image: {
    provider: "mock-image" | "nano-banana" | "gpt-image" | "anymodel-image";
    style: string;
    sequential: boolean;
    references: string[];
  };
  video: {
    enabled: boolean;
    provider: "mock-video" | "veo" | "anymodel-video";
    model: string;
    mode: "turbo" | "standard";
    startFrame: boolean;
    pairedFrames: boolean;
    muteSource: boolean;
    sourceVolume: number;
    animationPercent: number;
    distribution: "even" | "start" | "fade";
  };
  music: {
    path?: string;
    volume: number;
  };
  subtitles: SubtitleSettings;
  assembly: {
    kenBurns: boolean;
    fadeTransitions: boolean;
    audioNormalize: boolean;
    dualTrack: boolean;
    removeSilence: boolean;
    quality: "preview" | "standard" | "high";
  };
}

export interface Scene {
  id: string;
  order: number;
  title: string;
  imagePrompt: string;
  animationPrompt: string;
  narration: string;
  durationSeconds: number;
  status: SceneStatus;
  imagePath?: string;
  videoPath?: string;
  audioPath?: string;
}

export interface ReferenceAnalysis {
  sourceUrl: string;
  sourceTitle: string;
  niche: string;
  targetAudience: string;
  hook: string;
  structure: string[];
  strengths: string[];
  improvements: string[];
  suggestedAngle: string;
  suggestedTitle: string;
  recommendedDurationSeconds: number;
  language: string;
  instructions?: string;
  scenes: Scene[];
  provider: string;
}

export interface AnalyzeReferenceInput {
  url: string;
  instructions?: string;
  language?: string;
}

export interface CreateReferenceProjectInput {
  analysis: ReferenceAnalysis;
  aspectRatio: AspectRatio;
  mode: ProjectMode;
}

export interface AnyModelSettings {
  configured: boolean;
  baseUrl: string;
  textModel: string;
  imageModel: string;
  videoModel: string;
}

export interface SaveAnyModelSettingsInput extends Omit<AnyModelSettings, "configured"> {
  apiKey?: string;
}

export interface AiChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface Project {
  id: string;
  title: string;
  topic: string;
  aspectRatio: AspectRatio;
  language: string;
  mode: ProjectMode;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  scenes: Scene[];
  settings: ProjectSettings;
  referenceAnalysis?: ReferenceAnalysis;
  outputPath?: string;
}

export interface QueueTask {
  id: string;
  runId: string;
  projectId: string;
  sceneId?: string;
  kind: TaskKind;
  label: string;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  progress: number;
  dependsOn: string[];
  pausedFrom?: "pending" | "running" | "retry_wait";
  nextAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  resultPath?: string;
}

export interface CreateProjectInput {
  title: string;
  topic: string;
  aspectRatio: AspectRatio;
  language: string;
  mode: ProjectMode;
}

export interface UpdateProjectInput {
  title?: string;
  topic?: string;
  aspectRatio?: AspectRatio;
  language?: string;
  mode?: ProjectMode;
  status?: ProjectStatus;
  scenes?: Scene[];
  settings?: ProjectSettings;
  outputPath?: string;
}

export interface QueuePolicy {
  concurrency: number;
  maxAttempts: number;
  retryDelaysMs: number[];
}

export interface DesktopApi {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(input: CreateProjectInput): Promise<Project>;
  createDemoProject(): Promise<Project>;
  analyzeReference(input: AnalyzeReferenceInput): Promise<ReferenceAnalysis>;
  refineReferenceAnalysis(analysis: ReferenceAnalysis, instructions: string): Promise<ReferenceAnalysis>;
  createReferenceProject(input: CreateReferenceProjectInput): Promise<Project>;
  getAnyModelSettings(): Promise<AnyModelSettings>;
  saveAnyModelSettings(input: SaveAnyModelSettingsInput): Promise<AnyModelSettings>;
  clearAnyModelKey(): Promise<AnyModelSettings>;
  testAnyModelConnection(): Promise<{ ok: boolean; message: string }>;
  chatWithAnyModel(messages: AiChatMessage[]): Promise<string>;
  streamChatWithAnyModel(messages: AiChatMessage[], onChunk: (chunk: string) => void): Promise<string>;
  updateProject(id: string, input: UpdateProjectInput): Promise<Project>;
  duplicateProject(id: string): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  getQueue(): Promise<QueueTask[]>;
  startGeneration(projectId: string): Promise<QueueTask[]>;
  pauseGeneration(projectId: string): Promise<QueueTask[]>;
  resumeGeneration(projectId: string): Promise<QueueTask[]>;
  stopGeneration(projectId: string): Promise<QueueTask[]>;
  retryTask(taskId: string): Promise<QueueTask>;
  clearFinishedTasks(): Promise<QueueTask[]>;
  regenerateScene(projectId: string, sceneId: string): Promise<QueueTask[]>;
  openProjectFolder(projectId: string): Promise<void>;
  writeLog(level: LogLevel, message: string, details?: Record<string, unknown>): Promise<void>;
  openLogFile(): Promise<void>;
  pickFiles(kind: "image" | "audio" | "video" | "json", multiple?: boolean): Promise<string[]>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  getAppInfo(): Promise<{
    version: string;
    dataPath: string;
    workspacePath: string;
    logPath: string;
    realtimeUrl?: string;
    mockMode: boolean;
    ffmpegAvailable: boolean;
    queuePolicy: QueuePolicy;
  }>;
}

export function createDefaultProjectSettings(): ProjectSettings {
  return {
    durationMinutes: 1,
    frameChange: "scenario",
    script: {
      provider: "mock",
      model: "Built-in Gemini (подключение позже)"
    },
    voice: {
      enabled: true,
      provider: "edge-tts",
      voice: "ru-RU-DmitryNeural",
      singleTrack: false
    },
    image: {
      provider: "mock-image",
      style: "Семейная 3D-анимация, кинематографичный свет",
      sequential: false,
      references: []
    },
    video: {
      enabled: false,
      provider: "mock-video",
      model: "Mock Motion 1",
      mode: "turbo",
      startFrame: true,
      pairedFrames: false,
      muteSource: true,
      sourceVolume: 15,
      animationPercent: 100,
      distribution: "fade"
    },
    music: { volume: 10 },
    subtitles: {
      enabled: false,
      fontFamily: "Montserrat ExtraBold",
      fontSize: 64,
      textColor: "#ffffff",
      accentColor: "#f0c84b",
      outlineColor: "#000000",
      outlineWidth: 4,
      shadow: true,
      bottomMargin: 12,
      popWords: true
    },
    assembly: {
      kenBurns: true,
      fadeTransitions: true,
      audioNormalize: false,
      dualTrack: false,
      removeSilence: false,
      quality: "standard"
    }
  };
}
