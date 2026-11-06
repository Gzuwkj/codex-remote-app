import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket,WebSocketServer} from 'ws';
import {RelayHeartbeat} from '../packages/bridge/src/relay-heartbeat.js';

test('idle Bridge stays live using real WebSocket ping/pong without desktop events',async(t)=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const socket=new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}`);await once(socket,'open');
  let heartbeat:RelayHeartbeat;
  t.after(()=>{heartbeat?.stop();socket.terminate();for(const peer of server.clients)peer.terminate();server.close()});
  const healthy=new Promise<any>(resolve=>{heartbeat=new RelayHeartbeat(socket,(event,details)=>{
    if(event==='relay.heartbeat-ok'&&details.seq===4)resolve(details);
  },15,500)});
  heartbeat!.start();const report=await healthy;
  assert.equal(socket.readyState,WebSocket.OPEN);assert.ok(report.latencyMs>=0);
  heartbeat!.stop();assert.equal(socket.listenerCount('pong'),0);
});
test('Bridge forcibly retires a silent socket even when an unrelated pong arrives',async(t)=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0,autoPong:false});await once(server,'listening');
  server.on('connection',peer=>peer.on('ping',()=>peer.pong('unrelated-old-probe')));
  const socket=new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}`);await once(socket,'open');
  const events:any[]=[];const heartbeat=new RelayHeartbeat(socket,(event,details)=>events.push({event,...details}),15,60);
  t.after(()=>{heartbeat.stop();socket.terminate();for(const peer of server.clients)peer.terminate();server.close()});
  const closed=once(socket,'close');heartbeat.start();await closed;
  assert.equal(socket.readyState,WebSocket.CLOSED);
  assert.deepEqual(events.map(e=>e.event),['relay.heartbeat-expired']);
  assert.equal(events[0].reason,'pong-timeout');
});
