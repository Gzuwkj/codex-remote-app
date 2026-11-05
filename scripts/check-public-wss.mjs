import { WebSocket } from 'ws';
import assert from 'node:assert/strict';
const ws=new WebSocket('wss://daxuechengminiapp.site/codex-remote/ws');
await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{ws.terminate();reject(Error('Public WSS validation timed out'))},15000);
  ws.once('open',()=>ws.send(JSON.stringify({type:'device.auth',deviceId:'dedicated-invalid-auth-test',token:'not-a-real-credential'})));
  ws.once('error',reject);
  ws.once('close',code=>{clearTimeout(timer);try{assert.equal(code,4003);resolve()}catch(error){reject(error)}});
});
console.log(JSON.stringify({publicTlsWebSocket:true,invalidDeviceRejected:true,code:4003}));
