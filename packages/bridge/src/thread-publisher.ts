import type { RemoteThread } from "../../protocol/src/index.js";
import { threadUpdate } from "../../protocol/src/stream.js";
/** Latest state wins while the transport is busy; intermediate token frames are replaceable. */
export class ThreadPublisher {
  private bases = new Map<string, RemoteThread>();
  private latest = new Map<string, RemoteThread>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private send: (method: string, value: any) => boolean,
    private buffered: () => number
  ) {}
  push(thread: RemoteThread) {
    this.latest.set(thread.id, thread);
    this.flush();
  }
  reset(id?: string) {
    if (id) {
      this.bases.delete(id);
      return;
    }
    this.bases.clear();
    this.latest.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const [id, next] of this.latest) {
      if (this.buffered() > 128 * 1024) break;
      const previous = this.bases.get(id);
      if (previous && next.revision <= previous.revision) {
        this.latest.delete(id);
        continue;
      }
      const update = previous ? threadUpdate(previous, next) : undefined;
      if (
        !this.send(
          update ? "thread.update" : "thread.snapshot",
          update ? { update } : { thread: next }
        )
      )
        break;
      this.bases.set(id, next);
      this.latest.delete(id);
    }
    if (this.latest.size) {
      this.timer = setTimeout(() => this.flush(), 80);
      this.timer.unref?.();
    }
  }
}
