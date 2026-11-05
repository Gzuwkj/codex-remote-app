import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["apps/mobile/src/client.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [
    {
      name: "native-storage-test-double",
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(@react-native-async-storage\/async-storage|react-native-keychain|react-native)$/,
          },
          (a) => ({ path: a.path, namespace: "native-test" })
        );
        build.onLoad({ filter: /.*/, namespace: "native-test" }, (a) => ({
          contents:
            a.path === "react-native"
              ? "export const NativeModules={Diagnostics:{append(){}}};"
              : "export default {getItem:async()=>null,setItem:async()=>{}};export const setGenericPassword=async()=>{};export const resetGenericPassword=async()=>{};export const getGenericPassword=async()=>false;",
          loader: "js",
        }));
      },
    },
  ],
});
const { RemoteClient } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
class Socket {
  static sockets: Socket[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen?: () => void;
  onmessage?: (event: any) => Promise<void>;
  onclose?: (event: any) => void;
  onerror?: () => void;
  constructor(_url: string) {
    Socket.sockets.push(this);
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  async frame(value: any) {
    await this.onmessage?.({ data: JSON.stringify(value) });
  }
}
test("late events from a replaced mobile socket cannot overwrite current runtime or connection state", async () => {
  const old = globalThis.WebSocket;
  globalThis.WebSocket = Socket as any;
  const client = new RemoteClient();
  client.credentials = {
    deviceId: "dedicated-test",
    token: "dedicated-test-token",
  };
  const events: any[] = [];
  client.listeners.add((event: any) => events.push(event));
  try {
    client.connect();
    const first = Socket.sockets.at(-1)!;
    first.open();
    await first.frame({ type: "host", online: true, epoch: "old" });
    client.connect();
    const current = Socket.sockets.at(-1)!;
    current.open();
    await current.frame({ type: "host", online: true, epoch: "current" });
    events.length = 0;
    await first.frame({ type: "host", online: false, epoch: "old" });
    first.onerror?.();
    first.onclose?.({ code: 1006 });
    assert.equal(client.epoch, "current");
    assert.equal(client.online, true);
    assert.equal(events.length, 0);
  } finally {
    await client.disconnect();
    globalThis.WebSocket = old;
  }
});
test("foreground probe retires a silent peer without replaying a pending write", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const old = globalThis.WebSocket;
  globalThis.WebSocket = Socket as any;
  const client = new RemoteClient();
  client.credentials = { deviceId: "test", token: "test-token" };
  try {
    client.connect();
    const socket = Socket.sockets.at(-1)!;
    socket.open();
    await socket.frame({
      type: "host",
      online: true,
      epoch: "runtime",
      connectionPing: true,
    });
    const write = client.rpc("turn/start", {
      threadId: "dedicated-test",
      text: "Do not replay",
    });
    const rejected = assert.rejects(write, /不会自动重发/);
    client.setForeground(false);
    const resumed = client.resume();
    assert.equal(socket.sent.at(-1).type, "connection.ping");
    t.mock.timers.tick(6000);
    assert.equal(await resumed, false);
    await rejected;
    assert.equal(client.online, false);
    assert.equal(socket.readyState, 3);
    t.mock.timers.tick(2500);
    const next = Socket.sockets.at(-1)!;
    assert.notEqual(next, socket);
    next.open();
    await next.frame({
      type: "host",
      online: true,
      epoch: "runtime",
      connectionPing: true,
    });
    assert.equal(next.sent.filter((m) => m.type === "command").length, 0);
  } finally {
    await client.disconnect();
    globalThis.WebSocket = old;
  }
});
test("successful foreground probe keeps the socket; background suspension does not falsely disconnect it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const old = globalThis.WebSocket;
  globalThis.WebSocket = Socket as any;
  const client = new RemoteClient();
  client.credentials = { deviceId: "test", token: "test-token" };
  try {
    client.connect();
    const socket = Socket.sockets.at(-1)!;
    socket.open();
    await socket.frame({
      type: "host",
      online: true,
      epoch: "runtime",
      connectionPing: true,
    });
    const resumed = client.resume(),
      ping = socket.sent.at(-1);
    await socket.frame({
      type: "connection.pong",
      id: ping.id,
      online: true,
      epoch: "runtime",
      connectionPing: true,
    });
    assert.equal(await resumed, true);
    assert.equal(client.ws, socket);
    client.setForeground(false);
    t.mock.timers.tick(60000);
    assert.equal(client.ws, socket);
    assert.equal(client.online, true);
  } finally {
    await client.disconnect();
    globalThis.WebSocket = old;
  }
});
test("handshake timeout reconnects, while revoked credentials stop automatic retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const old = globalThis.WebSocket;
  globalThis.WebSocket = Socket as any;
  const client = new RemoteClient();
  client.credentials = { deviceId: "test", token: "test-token" };
  try {
    client.connect();
    const hung = Socket.sockets.at(-1)!;
    t.mock.timers.tick(15000);
    assert.equal(hung.readyState, 3);
    t.mock.timers.tick(2500);
    const socket = Socket.sockets.at(-1)!;
    socket.open();
    socket.onclose?.({ code: 4003 });
    const count = Socket.sockets.length;
    t.mock.timers.tick(60000);
    assert.equal(Socket.sockets.length, count);
    assert.equal(client.online, false);
  } finally {
    await client.disconnect();
    globalThis.WebSocket = old;
  }
});
