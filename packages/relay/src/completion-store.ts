import { readFileSync, writeFileSync, renameSync } from "node:fs";
import type { Completion } from "../../bridge/src/completions.js";
export class CompletionStore {
  private entries: (Completion & { cursor: number })[] = [];
  private cursor = 0;
  constructor(private file: string) {
    try {
      const s = JSON.parse(readFileSync(file, "utf8"));
      this.entries = s.entries;
      this.cursor = s.cursor;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  latest() {
    return this.cursor;
  }
  after(cursor: number) {
    return this.entries.filter(
      (e) => e.cursor > cursor && e.completedAt > Date.now() - 7 * 86400000
    );
  }
  append(event: Completion) {
    if (this.entries.some((e) => e.eventId === event.eventId)) return;
    if (
      typeof event.eventId !== "string" ||
      typeof event.threadId !== "string" ||
      typeof event.turnId !== "string" ||
      !["completed", "failed"].includes(event.status) ||
      !Number.isFinite(event.completedAt)
    )
      throw Error("INVALID_COMPLETION");
    const value = {
      eventId: event.eventId,
      threadId: event.threadId,
      turnId: event.turnId,
      title: String(event.title).slice(0, 180),
      status: event.status,
      completedAt: event.completedAt,
      cursor: ++this.cursor,
    };
    this.entries = this.entries
      .filter((e) => e.completedAt > Date.now() - 7 * 86400000)
      .concat(value)
      .slice(-200);
    writeFileSync(
      this.file + ".tmp",
      JSON.stringify({ cursor: this.cursor, entries: this.entries }),
      { mode: 0o600 }
    );
    renameSync(this.file + ".tmp", this.file);
    return value;
  }
}
