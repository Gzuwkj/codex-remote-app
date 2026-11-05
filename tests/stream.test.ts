import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyThreadUpdate,
  threadUpdate,
} from "../packages/protocol/src/stream.js";
import { ThreadPublisher } from "../packages/bridge/src/thread-publisher.js";
import { ThreadFanout } from "../packages/relay/src/thread-fanout.js";
import type { RemoteThread } from "../packages/protocol/src/index.js";
import type { WebSocket } from "ws";

function thread(revision = 1): RemoteThread {
  return {
    id: "chat",
    revision,
    title: "Large chat",
    cwd: "test",
    activeTurnId: "turn",
    requests: [],
    items: [
      { id: "history", type: "agentMessage", text: "history ".repeat(130000) },
      { id: "answer", type: "agentMessage", text: "hello" },
    ],
  };
}
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
test("large history is omitted from token updates, identities survive and completion clears active turn across JSON", () => {
  const before = thread(),
    next = {
      ...thread(2),
      activeTurnId: undefined,
      lastTurnStatus: "completed",
      items: [before.items[0], { ...before.items[1], text: "hello world" }],
    };
  const update = wire(threadUpdate(before, next)!);
  assert.ok(JSON.stringify(update).length < 1000);
  assert.ok(JSON.stringify(before).length > 1000000);
  const restored = applyThreadUpdate(before, update);
  assert.deepEqual(wire(restored), wire(next));
  assert.equal(restored.items[0], before.items[0]);
  assert.equal(restored.activeTurnId, undefined);
});
test("ordered additions, removals, missing items and revision gaps are handled explicitly", () => {
  const a = thread(),
    b = {
      ...a,
      revision: 2,
      items: [{ id: "new", type: "userMessage", text: "next" }, a.items[0]],
    };
  const delta = threadUpdate(a, b)!;
  assert.deepEqual(applyThreadUpdate(a, delta), b);
  assert.throws(
    () => applyThreadUpdate({ ...a, revision: 0 }, delta),
    /REVISION_GAP/
  );
  assert.throws(
    () => applyThreadUpdate(a, { ...delta, order: ["missing"] }),
    /ITEM_GAP/
  );
});
test("busy bridge retains only latest state and reconnect begins with a full baseline", async () => {
  const frames: any[] = [];
  let buffered = 0;
  const p = new ThreadPublisher(
    (method, value) => {
      frames.push({ method, ...value });
      return true;
    },
    () => buffered
  );
  p.push(thread());
  buffered = 200000;
  for (let i = 2; i <= 100; i++) p.push(thread(i));
  assert.equal(frames.length, 1);
  buffered = 0;
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(frames.length, 2);
  assert.equal(frames[1].update.revision, 100);
  assert.equal(frames[1].update.baseRevision, 1);
  p.reset();
  p.push(thread(101));
  assert.equal(frames[2].method, "thread.snapshot");
  p.reset();
});
function socket() {
  const frames: any[] = [];
  const mock = {
    readyState: 1,
    bufferedAmount: 0,
    send: (value: string) => frames.push(JSON.parse(value)),
    terminate: () => {
      mock.readyState = 3;
    },
  };
  return { ws: mock as unknown as WebSocket, mock, frames };
}
test("relay routes selected chats, recovers a gap once, and terminates a backlogged transport", () => {
  const resync: string[] = [],
    fanout = new ThreadFanout((id) => resync.push(id)),
    a = socket(),
    b = socket();
  fanout.register(a.ws, true, "chat");
  fanout.register(b.ws, true, "other");
  const first = thread();
  fanout.publish({ method: "thread.snapshot", thread: first });
  assert.equal(a.frames.length, 1);
  assert.equal(b.frames.length, 0);
  const second = thread(2);
  second.items[1].text = "hello world";
  fanout.publish({
    method: "thread.update",
    update: wire(threadUpdate(first, second)),
  });
  assert.equal(a.frames[1].method, "thread.update");
  assert.ok(JSON.stringify(a.frames[1]).length < 1000);
  assert.deepEqual(
    wire(applyThreadUpdate(first, a.frames[1].update)),
    wire(second)
  );
  const gap = threadUpdate(thread(8), thread(9));
  fanout.publish({ method: "thread.update", update: gap });
  fanout.publish({ method: "thread.update", update: gap });
  assert.deepEqual(resync, ["chat"]);
  fanout.publish({ method: "thread.snapshot", thread: thread(9) });
  assert.equal(a.frames[2].update.baseRevision, 2);
  a.mock.bufferedAmount = 3 * 1024 * 1024;
  fanout.publish({ method: "thread.snapshot", thread: thread(10) });
  assert.equal(a.mock.readyState, 3);
});
test("legacy client avoids a queue of megabyte snapshots and still receives final state", () => {
  const fanout = new ThreadFanout(() => {}),
    a = socket();
  fanout.register(a.ws, false, "chat");
  fanout.readResult(a.ws, thread());
  for (let i = 2; i < 50; i++)
    fanout.publish({ method: "thread.snapshot", thread: thread(i) });
  assert.equal(a.frames.length, 0);
  fanout.publish({
    method: "thread.snapshot",
    thread: {
      ...thread(50),
      activeTurnId: undefined,
      lastTurnStatus: "completed",
    },
  });
  assert.equal(a.frames.length, 1);
  assert.equal(a.frames[0].thread.lastTurnStatus, "completed");
});
