/** A service failure pauses selection; an old uncertain request only blocks that candidate. */
export class DocumentaryAnalysisError extends Error {
  constructor(message: string, readonly kind: "unavailable" | "pending" = "unavailable", readonly purpose?: string, readonly retryableTerminal = false, readonly serviceUnavailable = false, readonly retryAfterMs?: number) {
    super(message);
    this.name = "DocumentaryAnalysisError";
  }
}
