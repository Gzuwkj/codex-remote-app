import { DesktopAdapter } from "./adapter.js";
import { WebSocket } from "ws";
import { randomUUID, randomInt, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {loadJournal} from './journal.js';
import {acquireLock} from './lock.js';
import {startAdmin} from './admin.js';
import {ThreadPublisher} from './thread-publisher.js';
import {projectThread} from '../../protocol/src/index.js';
import {CompletionTracker} from './completions.js';
import {createLogger} from '../../protocol/src/node-logger.js';
import {diagnosticError} from '../../protocol/src/diagnostics.js';
import {UploadStore} from './uploads.js';
import {RelayHeartbeat} from './relay-heartbeat.js';
const dir = path.resolve(process.env.REMOTE_STATE_DIR ?? ".state");
mkdirSync(dir, { recursive: true });
const logger=createLogger(path.join(dir,'logs'),'bridge');
logger.log('bridge.start',{version:'0.5.3'});
process.on('uncaughtExceptionMonitor',error=>logger.log('process.fatal',{errorCode:diagnosticError(error)},'ERROR'));
acquireLock(path.join(dir,'bridge.lock'));
const completions = new CompletionTracker(path.join(dir,'task-completions.json'));
const uploads=new UploadStore(path.join(dir,'uploads'));
let epoch = randomUUID();
let adapter = new DesktopAdapter();
await adapter.connect();
logger.log('desktop.connected');
const ledgerFile = path.join(dir, "commands.json");
const ledger = loadJournal(ledgerFile);
const save = () => {
  writeFileSync(ledgerFile + ".tmp", JSON.stringify(ledger), { mode: 0o600 });
  renameSync(ledgerFile + ".tmp", ledgerFile);
};
save();
let ws: WebSocket;
let heartbeat:RelayHeartbeat|undefined;
let seq = 0;
let online = true;
const send = (m: unknown) => {
  if (ws?.readyState === 1) { ws.send(JSON.stringify(m)); return true; }
  return false;
};
const publisher = new ThreadPublisher((method, value) => send({ type:'event', epoch, seq:++seq, method, ...value, sentAtMs:Date.now() }), () => ws?.bufferedAmount ?? Infinity);
const managed = process.env.BRIDGE_MANAGED === '1';
const admin = managed ? startAdmin(dir, process.env.RELAY_URL ?? 'ws://127.0.0.1:8787', send, logger.tail) : undefined;
if (managed && /^\d+$/.test(process.env.CODEX_DESKTOP_PID ?? '')) {
  const desktopPid = Number(process.env.CODEX_DESKTOP_PID);
  setInterval(() => {
    try { process.kill(desktopPid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') process.exit(0); }
  }, 2000).unref();
}
function attach() {
  const sampled=new Map<string,{at:number;active?:string}>();
  adapter.on('thread', thread => {
    const last=sampled.get(thread.id);
    if(!last||Date.now()-last.at>=5000||last.active!==thread.activeTurnId){
      logger.log('desktop.thread',{threadId:thread.id,revision:thread.revision,activeTurnId:thread.activeTurnId,status:thread.lastTurnStatus,bytes:Buffer.byteLength(JSON.stringify(thread))});
      sampled.set(thread.id,{at:Date.now(),active:thread.activeTurnId});
    }
    publisher.push(thread);
    completions.observe(thread);
    for (const completion of completions.pending()) send({type:'event',epoch,seq:++seq,method:'task.completed',completion});
  });
  adapter.once("offline", () => {
    logger.log('desktop.disconnected',{},'WARN');
    online = false;
    ws?.close(4004, "DESKTOP_OFFLINE");
    reconnectDesktop();
  });
}
attach();
let lastStatuses='',statusPending=false;
setInterval(async()=>{
  if(!online||ws?.readyState!==1||statusPending)return;
  statusPending=true;
  try{
    const statuses=await adapter.catalogStatuses();
    const signature=JSON.stringify(statuses);
    if(signature!==lastStatuses){lastStatuses=signature;send({type:'event',epoch,seq:++seq,method:'catalog.status',statuses});logger.log('catalog.status',{count:statuses.length});}
    for(const t of statuses)if(t.status==='active'&&!adapter.states.has(t.id))adapter.subscribe(t.id).catch(error=>logger.log('catalog.subscribe-failed',{threadId:t.id,errorCode:diagnosticError(error)},'WARN'));
  }catch(error){logger.log('catalog.status-failed',{errorCode:diagnosticError(error)},'WARN')}
  finally{statusPending=false}
},5000).unref();
async function reconnectDesktop() {
  try {
    const next = new DesktopAdapter();
    await next.connect();
    adapter = next;
    epoch = randomUUID();
    seq = 0;
    online = true;
    attach();
    connect();
  } catch {
    setTimeout(reconnectDesktop, 2000);
  }
}
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const [action, id] = line.trim().split(/\s+/);
  if (action === "approve" || action === "reject")
    send({ type: "pair.decision", id, approve: action === "approve" });
  else if (action === "revoke") send({ type: "device.revoke", deviceId: id });
  else if (action === "pair") {
    const code = String(randomInt(100000, 1000000));
    send({ type: "pair.refresh", code });
    console.log("Pair code (5 minutes): " + code);
  }
});
function connect() {
  if (!online) return;
  heartbeat?.stop();
  const url = process.env.RELAY_URL ?? "ws://127.0.0.1:8787";
  logger.log('relay.connecting',{url,epoch});
  if (
    !url.startsWith("wss://") &&
    !/^ws:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)
  )
    throw Error("WSS_REQUIRED");
  ws = new WebSocket(url, { maxPayload: 16 * 1024 * 1024, handshakeTimeout:12000 });
  const current = ws;
  const connectionHeartbeat=new RelayHeartbeat(current,(event,details)=>logger.log(event,{...details,epoch},event.endsWith('expired')?'WARN':'INFO'));
  heartbeat=connectionHeartbeat;
  let authenticationTimer:ReturnType<typeof setTimeout>|undefined;
  ws.on("open", () => {
    if(ws!==current)return;
    logger.log('relay.socket-open',{epoch});
    authenticationTimer=setTimeout(()=>{
      if(ws!==current)return;
      logger.log('relay.authentication-timeout',{epoch},'WARN');current.terminate();
    },10000);
    authenticationTimer.unref?.();
    publisher.reset();
    lastStatuses='';
    const pairCode = String(randomInt(100000, 1000000));
    send({
      type: "bridge.auth",
      token: readFileSync(path.join(dir, "bridge-token"), "utf8"),
      epoch,
      pairCode,
    });
    admin?.pairedCode(pairCode);
    if (!managed) console.log("Pair code (5 minutes, single use): " + pairCode);
  });
  ws.on("error", error => logger.log('relay.error',{errorCode:diagnosticError(error)},'WARN'));
  ws.on("close", (closeCode) => {
    connectionHeartbeat.stop();if(authenticationTimer)clearTimeout(authenticationTimer);
    if(ws!==current){logger.log('relay.stale-close-ignored',{closeCode});return;}
    logger.log('relay.closed',{closeCode},'WARN');
    publisher.reset();
    admin?.offline();
    if (ws === current && online)
      setTimeout(() => {
        if (ws === current) connect();
      }, 2000);
  });
  ws.on("message", async (raw) => {
    if(ws!==current)return;
    let m: any;
    try {
      m = JSON.parse(raw.toString());
      admin?.message(m);
      if (m.type === 'completion.received') { completions.acknowledge(m.eventId); return; }
      if (m.type === 'bridge.ready') {
        if(authenticationTimer)clearTimeout(authenticationTimer);
        connectionHeartbeat.start();
        logger.log('relay.authenticated',{epoch});
        // Rebuild the relay baseline after reconnect, including idle subscribed chats.
        for(const entry of adapter.states.values())publisher.push(projectThread(entry.state,entry.revision));
        for (const completion of completions.pending()) send({type:'event',epoch,seq:++seq,method:'task.completed',completion});
        for (const id of completions.watched()) adapter.subscribe(id).catch(()=>{});
      }
      if (m.type === 'stream.resync') {
        const entry = adapter.states.get(m.threadId);
        if (entry) { publisher.reset(m.threadId); publisher.push(projectThread(entry.state, entry.revision)); }
        return;
      }
      if (m.type === "pair.confirm") {
        if (!managed) console.log(
          `Device ${JSON.stringify(m.name)} requests pairing. Type: approve ${
            m.id
          } (or reject ${m.id})`
        );
        return;
      }
      if (m.type !== "command") return;
      const commandStarted=Date.now();
      logger.log('command.received',{commandId:m.id,method:m.method,threadId:m.params?.threadId,epoch});
      if (m.epoch !== epoch) {
        send({ type: "command.result", id: m.id, error: "STALE_RUNTIME" });
        return;
      }
      if(m.method.startsWith('attachment/')){
        const result=await uploads.invoke(m.method,m.params??{},m.deviceId);
        send({type:'command.result',id:m.id,result});logger.log('upload.request-completed',{commandId:m.id,method:m.method,elapsedMs:Date.now()-commandStarted});return;
      }
      if (m.method === "command/status") {
        const e = ledger[m.params.id];
        send({
          type: e?.status === "unknown" ? "outcome.unknown" : "command.result",
          id: m.id,
          result: e ?? { status: "not-found" },
        });
        return;
      }
      // Read-only queries are repeatable; keep histories and binary chunks out of the write ledger.
      if (["artifact/read", "artifact/info", "artifact/chunk", "thread/read", "thread/list", "project/list", "model/read"].includes(m.method)) {
        const result = await adapter.invoke(m.method, m.params ?? {});
        logger.log('command.completed',{commandId:m.id,method:m.method,elapsedMs:Date.now()-commandStarted});
        send({ type: "command.result", id: m.id, result });
        return;
      }
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ method: m.method, params: m.params }))
        .digest("hex");
      const existing = ledger[m.id];
      if (existing) {
        logger.log('command.duplicate',{commandId:m.id,method:m.method,status:existing.status});
        if (existing.fingerprint !== fingerprint)
          throw Error("IDEMPOTENCY_CONFLICT");
        send({
          type:
            existing.status === "unknown"
              ? "outcome.unknown"
              : existing.status === "pending"
              ? "bridge.accepted"
              : "command.result",
          id: m.id,
          result: existing.result,
          error: existing.error,
        });
        return;
      }
      ledger[m.id] = { fingerprint, status: "pending" };
      save();
      send({ type: "bridge.accepted", id: m.id });
      try {
        const attachments=await uploads.resolve(m.params?.attachments??[],m.deviceId);
        const result = await adapter.invoke(m.method, { ...(m.params??{}), _attachments:attachments });
        ledger[m.id] = { fingerprint, status: "done", result };
        logger.log('command.completed',{commandId:m.id,method:m.method,elapsedMs:Date.now()-commandStarted});
        save();
        send({ type: "command.result", id: m.id, result });
      } catch (error) {
        logger.log('command.failed',{commandId:m.id,method:m.method,errorCode:diagnosticError(error),elapsedMs:Date.now()-commandStarted},'WARN');
        const text = (error as Error).message;
        const unknown =
          /TIMEOUT|DISCONNECTED/.test(text) &&
          ![
            "thread/list",
            "thread/read",
            "model/read",
            "thread/history",
          ].includes(m.method);
        ledger[m.id] = {
          fingerprint,
          status: unknown ? "unknown" : "failed",
          error: text,
        };
        save();
        send({
          type: unknown ? "outcome.unknown" : "command.result",
          id: m.id,
          error: text,
        });
      }
    } catch (error) {
      logger.log('request.failed',{commandId:m?.id,method:m?.method,errorCode:diagnosticError(error)},'WARN');
      send({
        type: "command.result",
        id: m?.id,
        error: (error as Error).message,
      });
    }
  });
}
connect();
