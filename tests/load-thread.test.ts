import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureThreadOwner } from "../packages/bridge/src/load-thread.js";
import { DesktopAdapter } from "../packages/bridge/src/adapter.js";
const absent = () => { throw Error("no-client-found"); };
test("warm chat uses its owner without navigation", async () => {
  let opens = 0;
  assert.equal(await ensureThreadOwner({ discover: async () => "owner", open: async () => { opens++; } }), "owner");
  assert.equal(opens, 0);
});
test("cold chat opens once and waits for actual owner registration", async () => {
  let calls = 0, opens = 0;
  const owner = await ensureThreadOwner({ discover: async () => ++calls < 4 ? absent() : "same-desktop-owner", open: async () => { opens++; }, pause: async () => {} });
  assert.equal(owner, "same-desktop-owner"); assert.equal(opens, 1); assert.equal(calls, 4);
});
test("navigation acknowledgement alone times out; transport failure never opens", async () => {
  await assert.rejects(ensureThreadOwner({ discover: async () => absent(), open: async () => {}, attempts: 2, pause: async () => {} }), /DESKTOP_THREAD_LOAD_TIMEOUT/);
  let opens = 0;
  await assert.rejects(ensureThreadOwner({ discover: async () => { throw Error("DESKTOP_DISCONNECTED"); }, open: async () => { opens++; } }), /DESKTOP_DISCONNECTED/);
  assert.equal(opens, 0);
});
test("simultaneous readers share one owner lookup and snapshot subscription", async () => {
  const adapter = new DesktopAdapter();
  const state = { id: "same-chat", title: "历史聊天", cwd: "E:/test", revision: 1, items: [], requests: [] };
  let discoveries = 0, subscriptions = 0;
  adapter.ipc = {
    request: async () => { discoveries++; return { handledByClientId: "existing-desktop" }; },
    broadcast: () => { subscriptions++; queueMicrotask(() => adapter.emit("thread", state)); },
  } as any;
  const first = adapter.subscribe(state.id), second = adapter.subscribe(state.id);
  assert.equal(first, second);
  assert.deepEqual(await first, state);
  assert.equal(discoveries, 1); assert.equal(subscriptions, 1);
});
