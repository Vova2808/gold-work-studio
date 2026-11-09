/** Limits are shared by discovery, recovery and fallback within one user run. */
export const documentaryWorkLimits = {
  sceneMs: 150_000,
  memoryWaitMs: 45_000,
  video: { attempts: 5, analyses: 5, activeMs: 120_000, searchMs: 60_000, downloadMs: 35_000 },
  image: { attempts: 3, analyses: 3, activeMs: 60_000, searchMs: 40_000, downloadMs: 20_000 },
  analysisReserveMs: 30_000,
  minimumAnalysisMs: 20_000,
  terminalRetries: 2,
  availabilityWaitMs: 45_000,
  photoFallbackRatio: .10,
} as const;

export class DocumentaryBudgetExhausted extends Error {
  constructor(message = 'Исчерпан ограниченный бюджет подбора этой сцены. Готовые материалы и анализы сохранены.') {
    super(message);
    this.name = 'DocumentaryBudgetExhausted';
  }
}

/** A content rejection may use a thematic fallback; a transfer failure may not. */
export class DocumentaryCandidateRejected extends Error {}
