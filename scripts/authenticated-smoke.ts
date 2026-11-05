import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const device = JSON.parse(readFileSync(".state/test-device.json", "utf8"));
const ws = new WebSocket("ws://127.0.0.1:8787");
let epoch = "";
let pending = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "host") epoch = m.epoch;
  if (m.type === "command.result" || m.type === "outcome.unknown") {
    const id = m.id.slice(m.id.indexOf(":") + 1),
      p = pending.get(id);
    if (p) {
      pending.delete(id);
      m.error ? p.reject(Error(m.error)) : p.resolve(m.result);
    }
  }
});
await new Promise<void>((resolve, reject) => {
  ws.once("open", () => {
    ws.send(
      JSON.stringify({
        type: "device.auth",
        deviceId: device.deviceId,
        token: device.token,
      })
    );
    resolve();
  });
  ws.once("error", reject);
});
while (!epoch) await new Promise((r) => setTimeout(r, 20));
async function rpc(
  id: string,
  method: string,
  params: any = {},
  runtime = epoch
) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("SMOKE_TIMEOUT"));
    }, 35000);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    ws.send(
      JSON.stringify({ type: "command", id, method, params, epoch: runtime })
    );
  });
}
try {
  const threadId = "01a1aae8-72db-7021-a2b0-d65d772364b4";
  await rpc("authenticated-read-" + Date.now(), "thread/read", { threadId });
  const id = "duplicate-" + Date.now(),
    params = {
      threadId,
      text: "这是幂等测试，请仅回复 REMOTE_DUPLICATE_OK。不使用工具。",
      messageId: id,
    };
  const first = await rpc(id, "turn/start", params),
    second = await rpc(id, "turn/start", params);
  assert.equal(first.result.turn.id, second.result.turn.id);
  console.log("same-command duplicate returned same upstream turn id");
  await assert.rejects(
    rpc(id, "turn/start", { ...params, text: "must not execute" }),
    /IDEMPOTENCY_CONFLICT/
  );
  console.log("conflicting reuse rejected");
  await assert.rejects(
    rpc("stale-" + Date.now(), "thread/list", {}, "old-runtime"),
    /STALE_RUNTIME/
  );
  console.log("stale runtime rejected");
  const status = await rpc("status-" + Date.now(), "command/status", {
    id: device.deviceId + ":" + id,
  });
  assert.equal(status.status, "done");
  console.log("durable command status read back");
} finally {
  ws.close();
}
