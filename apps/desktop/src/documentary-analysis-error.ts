/** A service failure pauses selection; an old uncertain request only blocks that candidate. */
export class DocumentaryAnalysisError extends Error {
  requestSent=false;
  requestKey?:string;
  constructor(message: string, readonly kind: "unavailable" | "pending" | "empty" = "unavailable", readonly purpose?: string, readonly retryableTerminal = false, readonly serviceUnavailable = false, readonly retryAfterMs?: number, readonly completedGatewayError = false) {
    super(message);
    this.name = "DocumentaryAnalysisError";
  }
  /** Only call when the receipt or client boundary belongs to these bytes. */
  forSubmittedRequest(key?:string):this {this.requestSent=true;this.requestKey=key;return this;}
}

/** Ownership was lost by an older version. Keep the unknown paid receipt and
 * skip optional preview; the original still needs its independent review. */
export class DocumentaryLegacyPreviewUnattributed extends DocumentaryAnalysisError {
  constructor(readonly historyIncomplete=false){
    super('Принадлежность прежней незавершённой проверки пробных кадров не восстановлена. Платная preview-проверка пропущена; оригинал требует отдельной проверки.','pending');
    this.name=historyIncomplete?'legacy-preview-history-incomplete':'legacy-preview-unattributed';
  }
}
