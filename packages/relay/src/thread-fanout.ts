import type { WebSocket } from "ws";
import type { RemoteThread } from "../../protocol/src/index.js";
import { applyThreadUpdate, threadUpdate } from "../../protocol/src/stream.js";

export class ThreadFanout {
  private clients = new Set<WebSocket>();
  private deltas = new WeakSet<WebSocket>();
  private selected = new WeakMap<WebSocket, string>();
  private bases = new WeakMap<WebSocket, RemoteThread>();
  private seen = new WeakMap<WebSocket, RemoteThread>();
  private lastLegacy = new WeakMap<WebSocket, number>();
  private cache = new Map<string, RemoteThread>();
  private resyncing = new Set<string>();
  constructor(private resync: (id: string) => void) {}
  register(socket: WebSocket, deltas: boolean, threadId?: string) {
    this.clients.add(socket);
    if (deltas) this.deltas.add(socket);
    if (threadId) this.select(socket, threadId);
  }
  remove(socket: WebSocket) {
    this.clients.delete(socket);
  }
  reset() {
    this.cache.clear();
    this.resyncing.clear();
    for (const c of this.clients) this.bases.delete(c);
  }
  select(socket: WebSocket, id?: string) {
    if (this.selected.get(socket) !== id) this.bases.delete(socket);
    if (id) this.selected.set(socket, id);
    else this.selected.delete(socket);
  }
  readResult(socket: WebSocket, thread: RemoteThread) {
    const cached = this.cache.get(thread.id);
    const next = cached && cached.revision > thread.revision ? cached : thread;
    if (!cached) this.remember(thread);
    if (this.selected.get(socket) === thread.id) {
      this.bases.set(socket, next);
      this.seen.set(socket, next);
    }
    return next;
  }
  publish(frame: any) {
    let next: RemoteThread;
    if (frame.method === "thread.snapshot") {
      next = frame.thread;
      if ((this.cache.get(next.id)?.revision ?? -1) > next.revision) return;
      this.resyncing.delete(next.id);
    } else {
      const update = frame.update,
        previous = this.cache.get(update.threadId);
      if (previous && previous.revision >= update.revision) return;
      try {
        if (!previous) throw Error("missing baseline");
        next = applyThreadUpdate(previous, update);
      } catch {
        if (!this.resyncing.has(update.threadId)) {
          this.resyncing.add(update.threadId);
          this.resync(update.threadId);
        }
        return;
      }
    }
    this.remember(next);
    for (const socket of this.clients) {
      if (socket.readyState !== 1 || this.selected.get(socket) !== next.id)
        continue;
      const base = this.bases.get(socket);
      if (base && base.id === next.id && base.revision >= next.revision)
        continue;
      if (socket.bufferedAmount > 2 * 1024 * 1024) {
        socket.terminate();
        continue;
      }
      if (this.deltas.has(socket)) {
        const update = base ? threadUpdate(base, next) : undefined;
        socket.send(
          JSON.stringify({
            ...frame,
            method: update ? "thread.update" : "thread.snapshot",
            thread: update ? undefined : next,
            update,
          })
        );
        this.bases.set(socket, next);
      } else {
        const seen = this.seen.get(socket);
        this.seen.set(socket, next);
        const urgent =
          seen?.activeTurnId !== next.activeTurnId ||
          seen?.requests.length !== next.requests.length;
        // Legacy clients cannot merge deltas. Avoid flooding them with large histories during a turn.
        if (
          !urgent &&
          ((next.activeTurnId && this.weight(next) > 128 * 1024) ||
            Date.now() - (this.lastLegacy.get(socket) ?? 0) < 700)
        )
          continue;
        socket.send(
          JSON.stringify({
            ...frame,
            method: "thread.snapshot",
            thread: next,
            update: undefined,
          })
        );
        this.bases.set(socket, next);
        this.lastLegacy.set(socket, Date.now());
      }
    }
  }
  private weight(t: RemoteThread) {
    return 1024 + t.items.reduce((n, i) => n + i.text.length * 2 + 120, 0);
  }
  private remember(thread: RemoteThread) {
    this.cache.delete(thread.id);
    this.cache.set(thread.id, thread);
    let total = [...this.cache.values()].reduce(
      (n, t) => n + this.weight(t),
      0
    );
    while (total > 16 * 1024 * 1024 && this.cache.size > 1) {
      const id = this.cache.keys().next().value!;
      total -= this.weight(this.cache.get(id)!);
      this.cache.delete(id);
    }
  }
}
