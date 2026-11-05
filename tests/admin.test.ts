import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { startAdmin } from '../packages/bridge/src/admin.js';
test('local pairing console requires its secret and same origin; decisions bind pending requests', async () => {
  const base = path.resolve('.state');
  const dir = mkdtempSync(path.join(base,'admin-test-'));
  process.env.BRIDGE_ADMIN_PORT='18898';
  const sent: any[] = [], admin = startAdmin(dir, 'wss://example.test/ws', m => sent.push(m),()=>'{"event":"dedicated-test"}');
  await new Promise<void>(r => admin.server.once('listening', r));
  const url='http://127.0.0.1:18898', token=readFileSync(path.join(dir,'admin-token'),'utf8');
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  try {
    assert.equal((await fetch(url+'/api/status')).status,401);
    assert.equal((await fetch(url+'/api/logs')).status,401);
    assert.equal((await(await fetch(url+'/api/logs',{headers})).json() as any).text,'{"event":"dedicated-test"}');
    assert.equal((await fetch(url+'/api/status',{headers:{Authorization:'Bearer '+'é'.repeat(64)}})).status,401);
    assert.equal((await fetch(url+'/api/status',{headers:{...headers,Origin:'https://untrusted.test'}})).status,403);
    admin.message({type:'bridge.ready'});
    await fetch(url+'/api/action',{method:'POST',headers,body:JSON.stringify({action:'pair'})});
    assert.match(admin.state.pairCode,/^\d{6}$/);
    assert.equal((await fetch(url+'/api/action',{method:'POST',headers,body:JSON.stringify({action:'approve',id:'stale'})})).status,400);
    admin.message({type:'pair.confirm',id:'pending',name:'专用测试手机'});
    assert.equal((await fetch(url+'/api/action',{method:'POST',headers,body:JSON.stringify({action:'approve',id:'pending'})})).status,200);
    assert.deepEqual(sent.at(-1),{type:'pair.decision',id:'pending',approve:true});
    assert.equal(admin.state.pending.length,0);
  } finally { await new Promise<void>(r=>admin.server.close(()=>r())); assert.equal(path.dirname(path.resolve(dir)),base); rmSync(dir,{recursive:true}); delete process.env.BRIDGE_ADMIN_PORT; }
});
