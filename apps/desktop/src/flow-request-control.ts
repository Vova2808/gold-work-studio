import { NO_RETRY_MARKER } from "./google-errors.js";
import { recordDiagnosticEvent } from "./diagnostics.js";

export class FlowUserActionError extends Error {
  readonly needsUserAction = true;

  constructor(message: string) {
    super(`${NO_RETRY_MARKER}${message}`);
    this.name = "FlowUserActionError";
  }
}

export class FlowTimeoutError extends Error {
  constructor(stage: string, timeoutMs: number) {
    super(`Flow: ${stage}: превышено время ожидания (${Math.ceil(timeoutMs / 1_000)} сек.)`);
    this.name = "FlowTimeoutError";
  }
}

export function flowAbortError(): Error {
  const error = new Error("Генерация Flow отменена");
  error.name = "AbortError";
  return error;
}

/** The race also bounds browser promises which do not themselves observe AbortSignal. */
export async function runFlowStep<T>(
  stage: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  if (signal?.aborted) throw flowAbortError();
  const started = Date.now();
  const controller = new AbortController();
  const onAbort = () => controller.abort(flowAbortError());
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = timeoutMs > 0
    ? setTimeout(() => controller.abort(new FlowTimeoutError(stage, timeoutMs)), timeoutMs)
    : undefined;
  let onStepAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onStepAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onStepAbort, { once: true });
  });
  try {
    return await Promise.race([operation(controller.signal), aborted]);
  } catch (error) {
    recordDiagnosticEvent(signal?.aborted ? "info" : "error", "flow.step.failed", { service: "flow", stage, elapsedMs: Date.now() - started, timeoutMs, error });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    controller.signal.removeEventListener("abort", onStepAbort);
  }
}

interface FlowAccountWaiter {
  accountIds: string[];
  signal?: AbortSignal;
  resolve: (accountId: string) => void;
  reject: (error: Error) => void;
  onAbort?: () => void;
}

/**
 * One paid request may run on an account at a time. A pool request waits for any
 * eligible account, so a short job immediately feeds the next scene instead of
 * leaving capacity idle behind a slower account.
 */
export class FlowAccountSerialQueue {
  private readonly busy = new Set<string>();
  private readonly waiters: FlowAccountWaiter[] = [];

  async run<T>(accountId: string, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    return this.runAny([{ id: accountId }], signal, operation);
  }

  async runAny<TAccount extends { id: string }, TResult>(
    accounts: readonly TAccount[],
    signal: AbortSignal | undefined,
    operation: (account: TAccount) => Promise<TResult>
  ): Promise<TResult> {
    const byId = new Map(accounts.map((account) => [account.id, account]));
    if (byId.size === 0) throw new Error("Нет Flow-аккаунтов для выполнения задачи");
    const accountId = await this.acquire([...byId.keys()], signal);
    try {
      if (signal?.aborted) throw flowAbortError();
      return await operation(byId.get(accountId)!);
    } finally {
      this.release(accountId);
    }
  }

  private acquire(accountIds: string[], signal: AbortSignal | undefined): Promise<string> {
    if (signal?.aborted) return Promise.reject(flowAbortError());
    const available = accountIds.find((accountId) => !this.busy.has(accountId));
    if (available) {
      this.busy.add(available);
      return Promise.resolve(available);
    }
    return new Promise<string>((resolve, reject) => {
      const waiter: FlowAccountWaiter = { accountIds, signal, resolve, reject };
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(flowAbortError());
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private release(accountId: string): void {
    this.busy.delete(accountId);
    for (let index = 0; index < this.waiters.length;) {
      const waiter = this.waiters[index]!;
      if (waiter.signal?.aborted) {
        this.waiters.splice(index, 1);
        waiter.signal.removeEventListener("abort", waiter.onAbort!);
        waiter.reject(flowAbortError());
        continue;
      }
      const available = waiter.accountIds.find((candidate) => !this.busy.has(candidate));
      if (!available) {
        index += 1;
        continue;
      }
      this.waiters.splice(index, 1);
      waiter.signal?.removeEventListener("abort", waiter.onAbort!);
      this.busy.add(available);
      waiter.resolve(available);
    }
  }
}
