import { AsyncLocalStorage } from "node:async_hooks";
import {setTimeout as delay} from 'node:timers/promises';

// These are the text models already offered in the application's chat picker.
// No image/audio provider, credentials or global model setting is changed.
const RESERVE_MODELS = ["ag/claude-sonnet-4-6", "cc/claude-opus-4-8", "cc/claude-opus-5"];

export class AnyModelModelUnavailableError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = "AnyModelModelUnavailableError";
  }
}

export interface TextModelSwitch {
  from: string;
  to: string;
  message: string;
}

interface TextOperation {
  routes: Map<string, string>;
  rejected: Set<string>;
  attempts: Map<string, Set<string>>;
  notice?: string;
  onSwitch?: (change: TextModelSwitch) => void;
}

/** One route per IPC operation: concurrent projects never change each other's model. */
export class AnyModelTextFallback {
  private readonly context = new AsyncLocalStorage<TextOperation>();
  private readonly cooldowns=new Map<string,number>();

  private async sendWithCooldown<T>(model:string,send:(model:string)=>Promise<T>,signal?:AbortSignal,enabled=false):Promise<T>{
    const wait=async()=>{const ms=(this.cooldowns.get(model)??0)-Date.now();if(ms>0)await delay(ms,undefined,{signal});};
    if(enabled)await wait();
    try{return await send(model);}catch(error){
      // Only an explicit terminal refusal with no output/usage is represented
      // by this error. Never replay a lost stream or an unknown paid result.
      const ms=error instanceof AnyModelModelUnavailableError?error.retryAfterMs:undefined;
      if(!enabled||ms===undefined||!Number.isFinite(ms)||ms<0||ms>60_000)throw error;
      this.cooldowns.set(model,Math.max(this.cooldowns.get(model)??0,Date.now()+ms));
      await wait();signal?.throwIfAborted();
      return send(model); // Exactly one same-model retry, then the existing policy.
    }
  }

  get active(): boolean { return Boolean(this.context.getStore()); }
  get notice(): string | undefined { return this.context.getStore()?.notice; }

  run<T>(action: () => Promise<T>, onSwitch?: (change: TextModelSwitch) => void): Promise<T> {
    return this.context.run({ routes: new Map(), rejected: new Set(), attempts: new Map(), onSwitch }, action);
  }

  async complete<T>(requested: string, send: (model: string) => Promise<T>, signal?: AbortSignal, allowShortCooldown=false): Promise<T> {
    const state = this.context.getStore();
    if (!state) return this.sendWithCooldown(requested,send,signal,allowShortCooldown);
    let model = state.routes.get(requested) ?? requested;
    const attempted = state.attempts.get(requested) ?? new Set<string>();
    state.attempts.set(requested, attempted);
    for (;;) {
      signal?.throwIfAborted();
      try {
        if (state.rejected.has(model)) throw new AnyModelModelUnavailableError("Модель уже отказала в этом задании.");
        attempted.add(model);
        return await this.sendWithCooldown(model,send,signal,allowShortCooldown);
      } catch (error) {
        signal?.throwIfAborted();
        // A network reset, partial completion, account balance or invalid key is
        // NOT permission to submit a second paid request to a different model.
        if (!(error instanceof AnyModelModelUnavailableError)) throw error;
        state.rejected.add(model);
        // Another request may already have selected a reserve while this
        // refusal was in flight. Join that route instead of consuming another
        // reserve or claiming exhaustion while the chosen model is working.
        const currentRoute = state.routes.get(requested);
        if (currentRoute && currentRoute !== model && !state.rejected.has(currentRoute)) {
          model = currentRoute;
          continue;
        }
        const next = attempted.size < 3
          ? RESERVE_MODELS.find(candidate => candidate !== model && !state.rejected.has(candidate) && !attempted.has(candidate))
          : undefined;
        if (!next) throw new AnyModelModelUnavailableError(`${error.message} Доступный резерв исчерпан; готовые блоки сохранены. Повторите продолжение позже.`);
        const from = model.replace(/[^a-z0-9_./-]/gi, "_").slice(0, 100);
        state.notice = `AnyModel: ${from} ограничена или недоступна → ${next}. Продолжаю на резервной модели.`;
        state.routes.set(requested, next);
        state.onSwitch?.({ from, to: next, message: state.notice });
        model = next;
      }
    }
  }
}
