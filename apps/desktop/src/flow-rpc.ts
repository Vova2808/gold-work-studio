/** Wire fields verified against the public flow.google.com Angular client, 2026-09-13. */
export const FLOW_RPC = {
  models: "HTrJv", credits: "nzlxg", createProject: "jHPbke", uploadImage: "maseQ",
  generateImages: "ogiZ0b", getMedia: "as29s",
  videoText: "YhhmEf", videoStart: "eb1hJf", videoStartEnd: "nprQif",
} as const;
export type FlowRpcId = typeof FLOW_RPC[keyof typeof FLOW_RPC];

export function flowRpcContext(projectId: string, token: string): unknown[] {
  return [null, 22, null, null, null, projectId, null, null, null, null, [token, 1]];
}

export function flowRpcCreateProject(title: string): unknown[] {
  return ["projects/*", [null, [title]], [null, 22]];
}

export function flowRpcImageRequest(input: {
  projectId: string; token: string; model: string; aspectRatio: string;
  prompt: string; batchId: string; seed: number; references: string[];
}): unknown[] {
  const aspect = ({ "1:1": 1, "9:16": 2, "16:9": 3, "3:4": 4, "4:3": 5 } as Record<string, number>)[input.aspectRatio];
  if (!aspect) throw new Error("Unsupported Flow image aspect ratio");
  const context = flowRpcContext(input.projectId, input.token);
  const request = [null, null, input.references.map(name => [name, null, null, null, 1]),
    input.seed, aspect, input.model, null, context, [[[input.prompt]]]];
  return [null, [request], true, context, [input.batchId]];
}

export function flowRpcUploadImage(projectId: string, token: string, base64: string, mime: string): unknown[] {
  return [flowRpcContext(projectId, token), base64, mime, true, null, null, null, true, "reference.png"];
}

export function flowRpcImageModels(payload: unknown[]): string[] {
  const config = payload[0];
  const groups = Array.isArray(config) && Array.isArray(config[5]) ? config[5] : [];
  return groups.flatMap(group => Array.isArray(group) && Array.isArray(group[1])
    ? group[1].filter(Array.isArray).map(usage => usage[0]).filter((key): key is string => typeof key === "string" && !key.includes("UPSAMPLE")) : []);
}

export function flowRpcImageMedia(media: unknown): { name: string; url?: string; workflowId?: string } {
  if (!Array.isArray(media) || typeof media[0] !== "string" || !media[0]) throw new Error("Flow did not return an image ID");
  const image = media[6];
  const generated = Array.isArray(image) ? image[0] : undefined;
  const uploaded = Array.isArray(image) ? image[1] : undefined;
  const url = Array.isArray(generated) ? generated[13] : Array.isArray(uploaded) ? uploaded[3] : undefined;
  return { name: media[0], workflowId: typeof media[2] === "string" ? media[2] : undefined, url: typeof url === "string" && url ? url : undefined };
}

export function flowRpcVideoRequest(input: {
  projectId: string; token: string; model: string; aspectRatio: string; prompt: string;
  batchId: string; mediaSeed: string; workflowSeed: string; start?: string; end?: string;
}): { rpc: FlowRpcId; payload: unknown[] } {
  const aspect = input.aspectRatio === "16:9" ? 2 : input.aspectRatio === "9:16" ? 1 : undefined;
  if (!aspect) throw new Error("Veo поддерживает 16:9 или 9:16");
  if (input.end && !input.start) throw new Error("Для конечного кадра нужен начальный кадр");
  const text = [null, null, [[[input.prompt]]]];
  const metadata = [null, null, null, null, input.mediaSeed, input.workflowSeed];
  const request = input.end
    ? [text, input.model, aspect, null, [null, input.start], [null, input.end], metadata]
    : input.start ? [text, input.model, aspect, null, [null, input.start], metadata]
      : [text, input.model, aspect, null, metadata];
  return { rpc: input.end ? FLOW_RPC.videoStartEnd : input.start ? FLOW_RPC.videoStart : FLOW_RPC.videoText,
    payload: [[request], flowRpcContext(input.projectId, input.token), [input.batchId]] };
}

export function flowRpcVideoMedia(value: unknown): { name: string; workflowId?: string; status: number; url?: string } {
  if (!Array.isArray(value) || typeof value[0] !== "string" || !value[0]) throw new Error("Flow не вернул ID видео");
  const metadata = Array.isArray(value[5]) ? value[5] : [];
  const status = Array.isArray(metadata[8]) ? Number(metadata[8][0]) : 0;
  const video = Array.isArray(value[7]) ? value[7] : [];
  const generated = Array.isArray(video[0]) ? video[0] : [];
  return { name: value[0], workflowId: typeof value[2] === "string" ? value[2] : undefined,
    status, url: typeof generated[8] === "string" && generated[8] ? generated[8] : undefined };
}

export function selectFlowRpcVideoModel(payload: unknown[], input: {
  model?: string; aspectRatio: string; durationSeconds: number; start: boolean; end: boolean; billingTier: number;
}): string {
  const config = Array.isArray(payload[0]) ? payload[0] : [];
  const groups: unknown[] = Array.isArray(config[4]) ? config[4] : [];
  const wanted = input.model || "veo_3_1_i2v_s_fast";
  const aliases: Record<string, string> = { veo_3_1_i2v_s_fast: "veo_3_1_fast", veo_3_1_t2v_lite: "veo_3_1_lite", VEO_3_1_I2V_12STEP: "veo_3_1_quality" };
  const group = groups.find((entry): entry is unknown[] => Array.isArray(entry) &&
    ((aliases[wanted] !== undefined && entry[3] === aliases[wanted]) || (Array.isArray(entry[1]) && entry[1].some(u => Array.isArray(u) && u[0] === wanted))));
  if (!group || !Array.isArray(group[1])) throw new Error(`Модель ${wanted} отсутствует в новом Flow`);
  const aspect = input.aspectRatio === "16:9" ? 2 : input.aspectRatio === "9:16" ? 1 : 0;
  const bits = input.end ? [1, 5, 7] : input.start ? [1, 5] : [1];
  const candidates = group[1].filter((usage: unknown): usage is unknown[] => {
    if (!Array.isArray(usage) || typeof usage[0] !== "string") return false;
    const options = Array.isArray(usage[7]) && Array.isArray(usage[7][0]) ? usage[7][0] : [];
    const aspects = Array.isArray(usage[12]) && Array.isArray(usage[12][0]) ? usage[12][0] : [];
    // Credit response field 4 is the generation tier; field 2 is only the subscription label.
    // GetModels fee oneof: field 1 allows usage (including zero cost), field 2 forbids it.
    const fee = Array.isArray(usage[4]) ? usage[4].find(entry => Array.isArray(entry) && entry[0] === input.billingTier)?.[1] : undefined;
    const permitted = Array.isArray(fee) && Array.isArray(fee[0]) && !Array.isArray(fee[1]);
    return permitted && aspects.includes(aspect) && options.some((option: unknown) => Array.isArray(option) && Array.isArray(option[0]) &&
      option[0].length === bits.length && bits.every(bit => option[0].includes(bit))) &&
      Number(usage[16] || 8) >= Math.min(8, Math.max(4, input.durationSeconds));
  }).sort((a: unknown[], b: unknown[]) => Number(a[16] || 8) - Number(b[16] || 8));
  const selected = candidates.find((usage: unknown[]) => usage[0] === wanted) ?? candidates[0];
  if (!selected) throw new Error(`У ${wanted} нет доступного этому аккаунту режима для выбранных кадров, формата и длительности`);
  return selected[0] as string;
}

export class FlowRpcError extends Error {
  constructor(readonly rpc: string, readonly status: number, readonly code?: number) {
    super(`Flow RPC ${rpc}: HTTP ${status}${code === undefined ? "" : `, код ${code}`}`);
    this.name = "FlowRpcError";
  }
}

export function flowRpcScript(rpc: FlowRpcId, payload: unknown[], timeoutMs: number): string {
  if (!Object.values(FLOW_RPC).includes(rpc)) throw new Error("Unsupported Flow RPC");
  return `(async () => {
    if (location.origin !== "https://flow.google.com") throw new Error("Flow session page is not ready");
    const data = window.WIZ_global_data || {};
    if (!data.SNlM0e) throw new Error("Flow session is not confirmed");
    const url = new URL("/_/AiSandboxAngularFrontend/data/batchexecute", location.origin);
    url.searchParams.set("rpcids", ${JSON.stringify(rpc)});
    url.searchParams.set("source-path", location.pathname);
    url.searchParams.set("rt", "c");
    if (typeof data.cfb2h === "string") url.searchParams.set("bl", data.cfb2h);
    if (typeof data.FdrFJe === "string") url.searchParams.set("f.sid", data.FdrFJe);
    const body = new URLSearchParams({ at: data.SNlM0e,
      "f.req": JSON.stringify([[ [${JSON.stringify(rpc)}, JSON.stringify(${JSON.stringify(payload)}), null, "generic"] ]]) });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ${timeoutMs});
    try {
      const response = await fetch(url, { method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "X-Same-Domain": "1" },
        body, signal: controller.signal });
      return { status: response.status, body: await response.text() };
    } finally { clearTimeout(timer); }
  })()`;
}

export function parseFlowRpcResponse(rpc: FlowRpcId, response: { status: number; body: string }): unknown[] {
  if (response.status !== 200) throw new FlowRpcError(rpc, response.status);
  if (response.body.length > 8_000_000) throw new Error("Flow RPC response is too large");
  for (const line of response.body.split("\n")) {
    if (!line.trimStart().startsWith("[[")) continue;
    let rows: unknown;
    try { rows = JSON.parse(line); } catch { continue; }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!Array.isArray(row) || row[0] !== "wrb.fr" || row[1] !== rpc) continue;
      if (typeof row[2] !== "string") throw new FlowRpcError(rpc, response.status, Array.isArray(row[5]) ? Number(row[5][0]) : undefined);
      const payload: unknown = JSON.parse(row[2]);
      if (Array.isArray(payload)) return payload;
      throw new Error(`Flow RPC ${rpc}: unexpected response format`);
    }
  }
  throw new Error(`Flow RPC ${rpc}: response missing; result unknown`);
}
