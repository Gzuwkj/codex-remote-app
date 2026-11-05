import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
function wait(ws: WebSocket, predicate: (m: any) => boolean) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", listener);
      reject(Error("TEST_TIMEOUT"));
    }, 5000);
    const listener = (raw: any) => {
      const m = JSON.parse(raw.toString());
      if (predicate(m)) {
        clearTimeout(timer);
        ws.off("message", listener);
        resolve(m);
      }
    };
    ws.on("message", listener);
  });
}
async function open() {
  const ws = new WebSocket("ws://127.0.0.1:18787");
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return ws;
}
test("relay requires authentication, desktop approval, one-time pairing, and device routing", async (t) => {
  const dir = process.cwd() + "/.state/test-" + randomUUID();
  mkdirSync(dir, { recursive: true });
  writeFileSync(dir + "/bridge-token", "dedicated-test-token");
  const processHandle = spawn(
    process.execPath,
    ["--import", "tsx", "packages/relay/src/server.ts"],
    {
      env: { ...process.env, PORT: "18787", REMOTE_STATE_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  t.after(() => processHandle.kill());
  await new Promise<void>((resolve, reject) => {
    processHandle.stdout.once("data", () => resolve());
    processHandle.once("error", reject);
    processHandle.once("exit", (code) => {
      if (code) reject(Error("RELAY_EXIT"));
    });
  });
  const bridge = await open(),
    phone = await open(),
    intruder = await open();
  t.after(() => {
    bridge.terminate();
    phone.terminate();
    intruder.terminate();
  });
  const denied = wait(intruder, (m) => m.type === "error");
  intruder.send(
    JSON.stringify({ type: "command", id: "bad", method: "thread/list" })
  );
  assert.equal((await denied).error, "AUTH_REQUIRED");
  const ready = wait(bridge, (m) => m.type === "bridge.ready");
  bridge.send(
    JSON.stringify({
      type: "bridge.auth",
      token: "dedicated-test-token",
      epoch: "epoch-test",
      pairCode: "123456",
    })
  );
  await ready;
  const confirm = wait(bridge, (m) => m.type === "pair.confirm"),
    pending = wait(phone, (m) => m.type === "pair.pending");
  phone.send(
    JSON.stringify({ type: "pair.request", code: "123456", name: "test phone" })
  );
  await pending;
  const request = await confirm;
  const paired = wait(phone, (m) => m.type === "paired");
  bridge.send(
    JSON.stringify({ type: "pair.decision", id: request.id, approve: true })
  );
  const device = await paired;
  assert.ok(device.token);
  assert.equal(device.epoch, "epoch-test");
  const reused = wait(intruder, (m) => m.type === "error");
  intruder.send(JSON.stringify({ type: "pair.request", code: "123456" }));
  assert.equal((await reused).error, "PAIR_CODE_INVALID");
  const accepted = wait(phone, (m) => m.type === "relay.received"),
    forwarded = wait(bridge, (m) => m.type === "command");
  phone.send(
    JSON.stringify({
      type: "command",
      id: "one",
      epoch: "epoch-test",
      method: "thread/list",
      params: {},
    })
  );
  await accepted;
  const command = await forwarded;
  assert.equal(command.id, device.deviceId + ":one");
  const result = wait(phone, (m) => m.type === "command.result");
  bridge.send(
    JSON.stringify({
      type: "command.result",
      id: command.id,
      result: ["thread-test"],
    })
  );
  assert.deepEqual((await result).result, ["thread-test"]);
  const revoked = new Promise<number>((resolve) =>
    phone.once("close", (code) => resolve(code))
  );
  bridge.send(
    JSON.stringify({ type: "device.revoke", deviceId: device.deviceId })
  );
  assert.equal(await revoked, 4003);
});
