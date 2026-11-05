import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameReader, frame } from "../packages/bridge/src/desktop-ipc.js";
import { applyPatches, projectThread } from "../packages/protocol/src/index.js";
test("desktop IPC decodes fragmented UTF-8 and coalesced frames", () => {
  const reader = new FrameReader(),
    first = frame({ type: "broadcast", params: { text: "中文🚀" } }),
    second = frame({ type: "response", requestId: "1" }),
    bytes = Buffer.concat([first, second]);
  assert.deepEqual(reader.push(bytes.subarray(0, 7)), []);
  const result = reader.push(bytes.subarray(7));
  assert.equal(result.length, 2);
  assert.equal(result[0].params.text, "中文🚀");
});
test("desktop IPC rejects oversized frames before allocating the body", () => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(40 * 1024 * 1024);
  assert.throws(() => new FrameReader().push(header), /TOO_LARGE/);
});
test("patch application handles ordered array insertion and removal without mutating original", () => {
  const state = { items: [{ text: "a" }, { text: "b" }] };
  const next = applyPatches(state, [
    { op: "add", path: ["items", 1], value: { text: "c" } },
    { op: "remove", path: ["items", 0] },
    { op: "replace", path: ["items", 1, "text"], value: "d" },
  ]);
  assert.deepEqual(next.items, [{ text: "c" }, { text: "d" }]);
  assert.equal(state.items[0].text, "a");
});
test("prototype mutation and missing parents trigger snapshot recovery", () => {
  assert.throws(
    () =>
      applyPatches({}, [
        { op: "add", path: ["__proto__", "polluted"], value: true },
      ]),
    /INVALID_PATCH/
  );
  assert.throws(() =>
    applyPatches({}, [{ op: "replace", path: ["missing", "child"], value: 1 }])
  );
  assert.equal(({} as any).polluted, undefined);
});
test("canonical desktop history is projected without internal settings and developer instructions", () => {
  const thread = projectThread(
    {
      id: "t",
      title: "聊天",
      latestThreadSettings: { developerInstructions: "secret" },
      turnHistory: {
        history: {
          entitiesByKey: {
            "turn:1": {
              turnId: "1",
              status: "inProgress",
              items: [{ id: "i", type: "agentMessage", text: "你好" }],
            },
          },
        },
      },
    },
    3
  );
  assert.equal(thread.items[0].text, "你好");
  assert.equal(thread.activeTurnId, "1");
  assert.equal(JSON.stringify(thread).includes("secret"), false);
});
