/** A service failure pauses selection; an old uncertain request only blocks that candidate. */
export class DocumentaryAnalysisError extends Error {
  constructor(message: string, readonly kind: "unavailable" | "pending" = "unavailable", readonly purpose?: string, readonly retryableTerminal = false, readonly serviceUnavailable = false, readonly retryAfterMs?: number, readonly completedGatewayError = false) {
    super(message);
    this.name = "DocumentaryAnalysisError";
  }
}

/** Ownership was lost by an older version. Keep the unknown paid receipt and
 * skip optional preview; the original still needs its independent review. */
export class DocumentaryLegacyPreviewUnattributed extends DocumentaryAnalysisError {
  constructor(readonly historyIncomplete=false){
    super('Принадлежность прежней незавершённой проверки пробных кадров не восстановлена. Платная preview-проверка пропущена; оригинал требует отдельной проверки.','pending');
    this.name=historyIncomplete?'legacy-preview-history-incomplete':'legacy-preview-unattributed';
  }
}
