import http from "node:http";
import path from "node:path";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export function startAdmin(dir: string, relayUrl: string, send: (value: unknown) => void) {
  const tokenFile = path.join(dir, "admin-token");
  let token: string;
  try { token = readFileSync(tokenFile, "utf8"); }
  catch { token = randomBytes(32).toString("hex"); writeFileSync(tokenFile, token, { mode: 0o600 }); }
  const port = Number(process.env.BRIDGE_ADMIN_PORT ?? 18887);
  const state = { connected: false, relayUrl, pairCode: "", expiresAt: 0, pending: [] as { id: string; name: string }[], devices: [] as { id: string; name: string }[], streams: {} as Record<string, {threadId:string;revision:number;sentAtMs:number;paintedAtMs:number;receivedAtMs:number;roundTripMs:number}> };
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
    if (req.url === "/" && req.method === "GET") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(page); return; }
    const supplied = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}`) { res.writeHead(403); res.end(); return; }
    if (!/^[a-f0-9]{64}$/.test(supplied) || supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { res.writeHead(401); res.end(); return; }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.url === "/api/status" && req.method === "GET") { res.end(JSON.stringify(state)); return; }
    if (req.url !== "/api/action" || req.method !== "POST") { res.writeHead(404); res.end(); return; }
    try {
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 4096) throw Error("请求过大"); }
      const input = JSON.parse(body);
      if (!state.connected) throw Error("电脑尚未连接云端中转");
      if (input.action === "pair") {
        state.pairCode = String(randomInt(100000, 1000000)); state.expiresAt = Date.now() + 300000;
        state.pending = []; send({ type: "pair.refresh", code: state.pairCode });
      } else if (["approve", "reject"].includes(input.action)) {
        if (!state.pending.some(p => p.id === input.id) || Date.now() > state.expiresAt) throw Error("配对请求已失效");
        send({ type: "pair.decision", id: input.id, approve: input.action === "approve" });
        state.pending = state.pending.filter(p => p.id !== input.id);
        if (input.action === "approve") state.pairCode = "";
      } else if (input.action === "revoke") {
        if (!state.devices.some(d => d.id === input.id)) throw Error("设备不存在");
        send({ type: "device.revoke", deviceId: input.id });
      } else throw Error("不支持的操作");
      res.end(JSON.stringify({ ok: true }));
    } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: (error as Error).message })); }
  });
  server.listen(port, "127.0.0.1");
  server.on("error", error => { console.error("BRIDGE_ADMIN_UNAVAILABLE", (error as NodeJS.ErrnoException).code); });
  return {
    state,
    server,
    pairedCode(code: string) { state.pairCode = code; state.expiresAt = Date.now() + 300000; },
    message(message: any) {
      if (message.type === 'stream.applied') state.streams[message.deviceId] = {threadId:message.threadId,revision:message.revision,sentAtMs:message.sentAtMs,paintedAtMs:message.paintedAtMs,receivedAtMs:Date.now(),roundTripMs:Date.now()-message.sentAtMs};
      if (message.type === "bridge.ready") { state.connected = true; send({ type: "device.list" }); }
      if (message.type === "devices") state.devices = message.devices;
      if (message.type === "pair.confirm") state.pending.push({ id: message.id, name: message.name });
    },
    offline() { state.connected = false; state.pending = []; state.pairCode = ""; },
    close() { server.close(); },
  };
}
const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Codex Remote 电脑连接</title>
<style>body{font:16px system-ui;background:#f5f5f5;color:#171717;max-width:720px;margin:48px auto;padding:24px}section{background:white;padding:24px;border-radius:20px;margin:18px 0}h1{font-size:26px}h2{font-size:18px}button{font:inherit;padding:10px 18px;border:0;border-radius:20px;background:#171717;color:white;cursor:pointer;margin:6px}small,p{color:#666}#code{font:38px ui-monospace;letter-spacing:8px;margin:18px 0}.row{border-top:1px solid #eee;padding:12px 0}#error{color:#b93e38}</style>
<h1>Codex Remote · 电脑连接</h1><p id="connection">正在读取连接状态…</p><p id="error" role="status"></p>
<section><h2>连接手机</h2><p>在手机 App 输入下方配对码，再回到此页面确认设备。</p><div id="code">—</div><small id="expiry"></small><br><button id="refresh">刷新配对码</button><div id="pending"></div></section>
<section><h2>已授权设备</h2><div id="devices"></div></section><p>Bridge 随 Codex 桌面进程启动和停止。此控制页只在本机开放。</p>
<script>const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);let current;
async function call(route,body){const r=await fetch('/api/'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok){let e=await r.json().catch(()=>({}));throw Error(e.error||'无法访问电脑连接控制，请从本机启动入口重新打开')}return r.json()}
async function action(action,id){try{await call('action',{action,id});document.querySelector('#error').textContent='';await refresh()}catch(e){document.querySelector('#error').textContent=e.message}}
function button(text,fn){const b=document.createElement('button');b.textContent=text;b.onclick=fn;return b}
async function refresh(){try{current=await call('status');document.querySelector('#connection').textContent=(current.connected?'已连接云端中转 · ':'电脑离线 · ')+current.relayUrl;document.querySelector('#code').textContent=current.pairCode&&current.expiresAt>Date.now()?current.pairCode:'—';document.querySelector('#expiry').textContent=current.pairCode?'配对码有效期至 '+new Date(current.expiresAt).toLocaleTimeString():'点击刷新获取新配对码';const pending=document.querySelector('#pending');pending.replaceChildren();for(const item of current.pending){const row=document.createElement('div');row.className='row';const title=document.createElement('p');title.textContent=item.name+' 请求连接';row.append(title,button('允许连接',()=>action('approve',item.id)),button('拒绝',()=>action('reject',item.id)));pending.append(row)}const devices=document.querySelector('#devices');devices.replaceChildren();for(const item of current.devices){const row=document.createElement('div');row.className='row';row.textContent=item.name;row.append(button('撤销授权',()=>{if(confirm('撤销此设备的连接权限？'))action('revoke',item.id)}));devices.append(row)}if(!current.devices.length)devices.textContent='尚无已授权设备'}catch(e){document.querySelector('#error').textContent=e.message}}
document.querySelector('#refresh').onclick=()=>action('pair');refresh();setInterval(refresh,2000);</script></html>`;
