/** Each source gets a bounded search budget; time spent inspecting a yielded
 * candidate must neither spend that budget nor discard completed alternatives. */
export function discoverDocumentaryQueryLanes<Provider, Candidate>(input: {
  lanes: Array<{ provider: Provider; queries: string[] }>;
  searchMs: number;
  signal?: AbortSignal;
  stopped: () => boolean;
  discover: (query: string, provider: Provider, signal: AbortSignal) => Promise<Candidate[]>;
}) {
  const controller = new AbortController();
  const stopped = () => controller.signal.aborted || input.signal?.aborted || input.stopped();
  const lanes = input.lanes.map(lane => ({ ...lane, offset: 0, remainingMs: input.searchMs }));
  const pending = new Map<number, Promise<{ id: number; candidates: Candidate[] }>>();
  const settled = new Map<number, Candidate[]>();
  const deferred:Candidate[]=[];
  const schedule = (id: number) => {
    const lane = lanes[id]!;
    if (stopped() || lane.offset >= lane.queries.length || lane.remainingMs <= 0) return;
    const query = lane.queries[lane.offset++]!;
    const request = new AbortController();
    const signal = AbortSignal.any([controller.signal, request.signal, ...(input.signal ? [input.signal] : [])]);
    const started = Date.now();
    const timer = setTimeout(() => request.abort(new DOMException('Истекло время поиска источника', 'TimeoutError')), Math.max(1, lane.remainingMs));
    let onAbort!: () => void;
    const aborted = new Promise<Candidate[]>(resolve => {
      onAbort = () => resolve([]);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const search = Promise.resolve().then(() => signal.aborted ? [] : input.discover(query, lane.provider, signal)).catch(() => []);
    pending.set(id, Promise.race([search, aborted]).then(candidates => ({ id, candidates })).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      lane.remainingMs = request.signal.aborted ? 0 : lane.remainingMs - (Date.now() - started);
    }).then(result => {
      if (!stopped()) settled.set(id, result.candidates);
      return result;
    }));
  };
  const mapQuery=(query:string)=>/\b(?:maps?|globes?)\b/iu.test(query);
  const prioritizeMaps=(candidates:Candidate[])=>{
    // A map query can return a well-tagged landmark ahead of an actual map.
    // Keep the captioned subject in the first preparation batch; the existing
    // selector would otherwise promote geographical word overlap over it.
    // No source is rejected and a sparse-only batch retains its ordinary order.
    const isMap=(candidate:Candidate)=>{
      if(!candidate||typeof candidate!=='object')return false;
      const item=candidate as {title?:unknown;description?:unknown};
      return /\b(?:maps?|globes?|cartography)\b/iu.test(`${typeof item.title==='string'?item.title:''} ${typeof item.description==='string'?item.description:''}`);
    };
    const primary=candidates.filter(isMap);
    if(primary.length&&primary.length<candidates.length){
      deferred.push(...candidates.filter(candidate=>!isMap(candidate)));
      return primary;
    }
    return candidates;
  };
  const consume = (id: number) => {
    const candidates = settled.get(id) ?? [];
    const query=lanes[id]!.queries[lanes[id]!.offset-1]??'';
    settled.delete(id);
    pending.delete(id);
    schedule(id);
    return mapQuery(query)?prioritizeMaps(candidates):candidates;
  };
  async function* iterate(): AsyncGenerator<Candidate[], void, unknown> {
    lanes.forEach((_, id) => schedule(id));
    try {
      while ((pending.size||deferred.length) && !stopped()) {
        if(deferred.length){yield deferred.splice(0);continue;}
        const ready = await Promise.race(pending.values());
        if (stopped()) break;
        const candidates = consume(ready.id);
        if (candidates.length) yield candidates;
      }
    } finally {
      controller.abort(new DOMException('Поиск сцены завершён', 'AbortError'));
      settled.clear();
      deferred.length=0;
    }
  }
  // Call while the iterator is paused between next() calls: completed sources
  // can compete before another paid review without waiting for slow providers.
  return Object.assign(iterate(), {
    takeReady: () => {
      if(stopped())return [];
      const ready=[...settled.keys()];
      const mapsRequested=ready.length>0&&ready.every(id=>mapQuery(lanes[id]!.queries[lanes[id]!.offset-1]??''));
      const candidates=ready.flatMap(consume);
      // A map-empty provider batch must not undo another provider's subject
      // priority when all ready lanes were looking for maps. Their returned
      // candidate.query may be only a broadened place name (short03 Commons).
      return mapsRequested?prioritizeMaps(candidates):candidates;
    },
    waitFor: async (provider:Provider) => {
      await pending.get(lanes.findIndex(lane=>lane.provider===provider));
    },
  });
}
