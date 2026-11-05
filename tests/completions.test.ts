import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { CompletionTracker } from "../packages/bridge/src/completions.js";
import { CompletionStore } from "../packages/relay/src/completion-store.js";
import type { RemoteThread } from "../packages/protocol/src/index.js";
const sample = (overrides: Partial<RemoteThread> = {}): RemoteThread => ({
  id: "test-chat",
  title: "Dedicated notification test",
  cwd: "test",
  revision: 1,
  items: [],
  requests: [],
  ...overrides,
});
test("only observed completed work notifies, restart recovers it, and acknowledgements prevent duplicates", () => {
  const dir = mkdtempSync(path.resolve(".state/completions-")),
    file = path.join(dir, "bridge.json");
  let tracker = new CompletionTracker(file);
  tracker.observe(sample({ lastTurnId: "old", lastTurnStatus: "completed" }));
  assert.equal(tracker.pending().length, 0);
  tracker.observe(sample({ activeTurnId: "running" }));
  tracker = new CompletionTracker(file);
  assert.deepEqual(tracker.watched(), ["test-chat"]);
  tracker.observe(
    sample({ lastTurnId: "running", lastTurnStatus: "completed" })
  );
  assert.equal(tracker.pending().length, 1);
  tracker.observe(
    sample({ lastTurnId: "running", lastTurnStatus: "completed" })
  );
  assert.equal(tracker.pending().length, 1);
  const event = tracker.pending()[0];
  tracker.acknowledge(event.eventId);
  tracker = new CompletionTracker(file);
  assert.equal(tracker.pending().length, 0);
  tracker.observe(sample({ activeTurnId: "stopped" }));
  tracker.observe(
    sample({ lastTurnId: "stopped", lastTurnStatus: "interrupted" })
  );
  assert.equal(tracker.pending().length, 0);
  tracker.observe(sample({ activeTurnId: "failed" }));
  tracker.observe(sample({ lastTurnId: "failed", lastTurnStatus: "failed" }));
  assert.equal(tracker.pending()[0].status, "failed");
});
test("relay persists a bounded replay cursor and deduplicates Bridge retries", () => {
  const dir = mkdtempSync(path.resolve(".state/completion-store-")),
    file = path.join(dir, "relay.json");
  let store = new CompletionStore(file);
  const event = {
    eventId: "thread:turn",
    threadId: "thread",
    turnId: "turn",
    title: "Safe test",
    status: "completed",
    completedAt: Date.now(),
  };
  assert.equal(store.append(event)?.cursor, 1);
  assert.equal(store.append(event), undefined);
  store = new CompletionStore(file);
  assert.equal(store.latest(), 1);
  assert.equal(store.after(0).length, 1);
  assert.equal(store.after(1).length, 0);
  for (let i = 2; i <= 205; i++)
    store.append({ ...event, eventId: "event-" + i, turnId: String(i) });
  assert.equal(store.latest(), 205);
  assert.equal(store.after(0).length, 200);
  assert.throws(
    () => store.append({ ...event, eventId: "bad", status: "inProgress" }),
    /INVALID_COMPLETION/
  );
});
