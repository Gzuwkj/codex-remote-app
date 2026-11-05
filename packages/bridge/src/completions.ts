import { readFileSync, writeFileSync, renameSync } from "node:fs";
import type { RemoteThread } from "../../protocol/src/index.js";
export type Completion = {
  eventId: string;
  threadId: string;
  turnId: string;
  title: string;
  status: string;
  completedAt: number;
};
/** Persist observed work and unacknowledged completions across Bridge restarts. */
export class CompletionTracker {
  private state: { active: Record<string, string>; pending: Completion[] } = {
    active: {},
    pending: [],
  };
  constructor(private file: string) {
    try {
      this.state = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  observe(thread: RemoteThread) {
    const previous = this.state.active[thread.id];
    if (thread.activeTurnId) {
      if (previous !== thread.activeTurnId) {
        this.state.active[thread.id] = thread.activeTurnId;
        this.save();
      }
      return;
    }
    if (!previous) return;
    delete this.state.active[thread.id];
    if (
      previous === thread.lastTurnId &&
      ["completed", "failed"].includes(thread.lastTurnStatus ?? "")
    ) {
      const eventId = thread.id + ":" + previous;
      if (!this.state.pending.some((e) => e.eventId === eventId))
        this.state.pending.push({
          eventId,
          threadId: thread.id,
          turnId: previous,
          title: thread.title.slice(0, 180),
          status: thread.lastTurnStatus!,
          completedAt: Date.now(),
        });
      this.state.pending = this.state.pending.slice(-200);
    }
    this.save();
  }
  pending() {
    return this.state.pending;
  }
  watched() {
    return Object.keys(this.state.active);
  }
  acknowledge(id: string) {
    if (this.state.pending.some((e) => e.eventId === id)) {
      this.state.pending = this.state.pending.filter((e) => e.eventId !== id);
      this.save();
    }
  }
  private save() {
    writeFileSync(this.file + ".tmp", JSON.stringify(this.state), {
      mode: 0o600,
    });
    renameSync(this.file + ".tmp", this.file);
  }
}
