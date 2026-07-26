// Socket.IO server. Event names match what the captured front-end actually
// listens to (verified by reverse-engineering the bundle: it uses dash-separated
// names like "generation-complete", "generation-error", not colon-separated).

import type { Server as HttpServer } from "node:http";
import { Server as IoServer } from "socket.io";

let io: IoServer | null = null;

export function attachSocket(http: HttpServer) {
  io = new IoServer(http, {
    cors: { origin: "*" },
  });
  io.on("connection", (socket) => {
    socket.emit("hello", { socketId: socket.id });
  });
  return io;
}

// Emit BOTH dash and colon variants so any chunk that listens to either name
// is satisfied. Frontend bundle observed listening to `generation-complete`,
// `generation-error`, `generation-progress`.
function emitBoth(dashName: string, colonName: string, payload: any) {
  if (!io) return;
  io.emit(dashName, payload);
  io.emit(colonName, payload);
}

export function emitProgress(generationId: string, payload: any) {
  emitBoth("generation-progress", "generation:progress", { generationId, generationType: payload?.generationType, ...payload });
}

export function emitPhase(generationId: string, phase: string, payload: any = {}) {
  emitBoth("generation-phase", "generation:phase", { generationId, phase, ...payload });
}

export function emitComplete(generationId: string, payload: any = {}) {
  emitBoth("generation-complete", "generation:complete", { generationId, ...payload });
}

export function emitError(generationId: string, message: string) {
  emitBoth("generation-error", "generation:error", { generationId, message });
}
