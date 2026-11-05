import http from "node:http";
import {
  randomBytes,
  randomUUID,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import {ThreadFanout} from './thread-fanout.js';
import {CompletionStore} from './completion-store.js';
const dir = path.resolve(process.env.REMOTE_STATE_DIR ?? ".state");
mkdirSync(dir, { recursive: true });
const credentialFile = path.join(dir, "bridge-token");
let bridgeToken: string;
try {
  bridgeToken = readFileSync(credentialFile, "utf8");
} catch {
  bridgeToken = randomBytes(32).toString("hex");
  writeFileSync(credentialFile, bridgeToken, { mode: 0o600 });
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const devicesFile = path.join(dir, "devices.json");
let devices: Record<string, { name: string; tokenHash: string }> = {};
try {
  devices = JSON.parse(readFileSync(devicesFile, "utf8"));
} catch {}
const save = () => {
  writeFileSync(devicesFile + ".tmp", JSON.stringify(devices), { mode: 0o600 });
  renameSync(devicesFile + ".tmp", devicesFile);
};
let bridge: WebSocket | undefined;
let epoch = "",
  pairCode = "",
  pairExpires = 0;
const clients = new Map<WebSocket, string>();
const notificationClients = new WeakSet<WebSocket>();
const completionStore = new CompletionStore(path.join(dir,'completion-events.json'));
const pending = new Map<
  string,
  { socket: WebSocket; name: string; expires: number; code: string; deltas?: boolean }
>();
const routes = new Map<string, WebSocket>();
const readRoutes = new Map<string, string>();
const streams = new ThreadFanout(threadId => send(bridge, {type:'stream.resync',threadId}));
const attempts = new Map<string, { count: number; reset: number }>();
const send = (ws: WebSocket | undefined, message: unknown) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
};
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ ok: true, bridgeOnline: bridge?.readyState === 1 })
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 * 1024 });
const deviceList = () => Object.entries(devices).map(([id, device]) => ({ id, name: device.name }));
const alive = new WeakSet<WebSocket>();
wss.on("connection", (ws, req) => {
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
  const deadline = setTimeout(() => {
    if (
      ws !== bridge &&
      !clients.has(ws) &&
      ![...pending.values()].some((p) => p.socket === ws)
    )
      ws.close(4001, "AUTH_REQUIRED");
  }, 15000);
  ws.on("error", () => {});
  ws.on("message", (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.type === "bridge.auth") {
        if (
          !equal(String(m.token ?? ""), bridgeToken) ||
          bridge?.readyState === 1
        ) {
          ws.close(4003, "BRIDGE_AUTH_FAILED");
          return;
        }
        bridge = ws;
        streams.reset();
        epoch = m.epoch;
        pairCode = String(m.pairCode);
        pairExpires = Date.now() + 300000;
        clearTimeout(deadline);
        send(ws, { type: "bridge.ready" });
        for (const c of clients.keys())
          send(c, { type: "host", online: true, epoch });
        return;
      }
      if (ws === bridge) {
        if (m.type === "device.list") { send(ws, { type: "devices", devices: deviceList() }); return; }
        if (m.type === "pair.refresh") {
          pairCode = String(m.code);
          pairExpires = Date.now() + 300000;
          return;
        }
        if (m.type === "pair.decision") {
          const p = pending.get(m.id);
          if (!p) return;
          pending.delete(m.id);
          if (!m.approve || p.expires < Date.now() || p.code !== pairCode) {
            send(p.socket, { type: "error", error: "PAIR_REJECTED" });
            return;
          }
          const id = randomUUID(),
            token = randomBytes(32).toString("hex");
          devices[id] = { name: p.name, tokenHash: hash(token) };
          save();
          clients.set(p.socket, id);
          streams.register(p.socket, p.deltas === true);
          send(p.socket, { type: "paired", deviceId: id, token, epoch });
          pairCode = "";
          send(ws, { type: "devices", devices: deviceList() });
          return;
        }
        if (m.type === "device.revoke") {
          delete devices[m.deviceId];
          save();
          for (const [c, id] of clients)
            if (id === m.deviceId) c.close(4003, "DEVICE_REVOKED");
          send(ws, { type: "devices", devices: deviceList() });
          return;
        }
        if (m.type === "event") {
          if (m.method === 'task.completed') {
            const event = completionStore.append(m.completion);
            if (event) for (const c of clients.keys()) if (notificationClients.has(c)) send(c,{type:'completion',...event});
            send(ws,{type:'completion.received',eventId:m.completion.eventId});
            return;
          }
          if (m.method === 'thread.snapshot' || m.method === 'thread.update') streams.publish(m);
          else for (const c of clients.keys()) send(c, m);
          return;
        }
        const target = routes.get(m.id);
        if (target && m.type === 'command.result' && m.result?.id === readRoutes.get(m.id) && Array.isArray(m.result.items))
          m.result = streams.readResult(target, m.result);
        send(target, m);
        if (m.type === "command.result" || m.type === "outcome.unknown")
          { routes.delete(m.id); readRoutes.delete(m.id); }
        return;
      }
      if (m.type === "device.auth") {
        const d = devices[m.deviceId];
        if (!d || !equal(hash(String(m.token ?? "")), d.tokenHash)) {
          ws.close(4003, "DEVICE_AUTH_FAILED");
          return;
        }
        clients.set(ws, m.deviceId);
        if (m.notificationClient === true) notificationClients.add(ws);
        streams.register(ws, m.snapshotDeltas === true, m.threadId);
        clearTimeout(deadline);
        send(ws, { type: "host", online: bridge?.readyState === 1, epoch,
          ...(m.notificationClient === true ? {notificationCursor:completionStore.latest()} : {}) });
        if (m.notificationClient === true && Number.isInteger(m.notificationCursor) && m.notificationCursor >= 0)
          for (const event of completionStore.after(m.notificationCursor)) send(ws,{type:'completion',...event});
        return;
      }
      if (m.type === "pair.request") {
        const ip = process.env.TRUST_PROXY === '1' && req.socket.remoteAddress === '127.0.0.1'
          ? String(req.headers['x-real-ip'] ?? 'unknown') : req.socket.remoteAddress ?? 'unknown';
        let a = attempts.get(ip);
        if (!a || a.reset < Date.now()) {
          a = { count: 0, reset: Date.now() + 60000 };
          attempts.set(ip, a);
        }
        if (++a.count > 5) throw Error("PAIR_RATE_LIMIT");
        if (
          !bridge ||
          pairExpires < Date.now() ||
          !pairCode ||
          !equal(String(m.code), pairCode)
        )
          throw Error("PAIR_CODE_INVALID");
        const id = randomUUID();
        pending.set(id, {
          socket: ws,
          name: String(m.name ?? "Android").slice(0, 80),
          expires: Date.now() + 60000,
          code: pairCode,
          deltas: m.snapshotDeltas === true,
        });
        clearTimeout(deadline);
        send(ws, { type: "pair.pending" });
        send(bridge, {
          type: "pair.confirm",
          id,
          name: String(m.name ?? "Android").slice(0, 80),
        });
        return;
      }
      if (!clients.has(ws)) throw Error("AUTH_REQUIRED");
      if (m.type === 'stream.applied') {
        if (typeof m.threadId === 'string' && Number.isFinite(m.revision) && Number.isFinite(m.sentAtMs) && Number.isFinite(m.paintedAtMs))
          send(bridge, {type:'stream.applied',deviceId:clients.get(ws),threadId:m.threadId,revision:m.revision,sentAtMs:m.sentAtMs,paintedAtMs:m.paintedAtMs});
        return;
      }
      if (m.type === 'thread.select') { streams.select(ws, typeof m.threadId === 'string' ? m.threadId : undefined); return; }
      if (m.type === "command") {
        if (
          typeof m.id !== "string" ||
          m.id.length > 100 ||
          typeof m.method !== "string"
        )
          throw Error("INVALID_COMMAND");
        if (!bridge || bridge.readyState !== 1) throw Error("HOST_OFFLINE");
        const routeId = clients.get(ws) + ":" + m.id;
        routes.set(routeId, ws);
        if (m.method === 'thread/read' && typeof m.params?.threadId === 'string') {
          streams.select(ws, m.params.threadId); readRoutes.set(routeId, m.params.threadId);
        }
        send(ws, { type: "relay.received", id: routeId });
        send(bridge, { ...m, id: routeId, deviceId: clients.get(ws) });
        return;
      }
      throw Error("UNKNOWN_MESSAGE");
    } catch (error) {
      send(ws, { type: "error", error: (error as Error).message });
    }
  });
  ws.on("close", () => {
    clearTimeout(deadline);
    clients.delete(ws);
    streams.remove(ws);
    for (const [id, p] of pending) if (p.socket === ws) pending.delete(id);
    for (const [id, c] of routes) if (c === ws) { routes.delete(id); readRoutes.delete(id); }
    if (ws === bridge) {
      bridge = undefined;
      for (const c of clients.keys())
        send(c, { type: "host", online: false, epoch });
    }
  });
});
setInterval(() => {
  for (const [ip, attempt] of attempts) if (attempt.reset < Date.now()) attempts.delete(ip);
  for (const [id, p] of pending)
    if (p.expires < Date.now()) {
      send(p.socket, { type: "error", error: "PAIR_TIMEOUT" });
      pending.delete(id);
    }
}, 5000).unref();
setInterval(() => {
  for (const socket of wss.clients) {
    if (!alive.has(socket)) { socket.terminate(); continue; }
    alive.delete(socket); socket.ping();
  }
}, 30000).unref();
server.listen(
  Number(process.env.PORT ?? 8787),
  process.env.BIND_HOST ?? "127.0.0.1",
  () =>
    console.log(
      "Relay listening on loopback; bridge credential stored in .state/bridge-token"
    )
);
