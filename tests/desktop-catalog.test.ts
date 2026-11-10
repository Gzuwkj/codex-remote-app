import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DesktopAdapter} from '../packages/bridge/src/adapter.js';

test('phone catalog uses desktop visible threads, preserving pin order and project identity',async()=>{
 const calls:any[]=[];
 const a=new DesktopAdapter((async(name:string,args:unknown)=>{calls.push({name,args});return {
  pinnedThreads:[{id:'pinned',kind:'codex',hostId:'local',title:'Pinned',projectId:'project-a',cwd:'E:/old-location',updatedAt:20}],
  threads:[{id:'pinned',kind:'codex',hostId:'local'}, {id:'visible',kind:'codex',hostId:'local',title:'Desktop title',projectId:null,updatedAt:10},
   {id:'other-host',kind:'codex',hostId:'cloud'}, {id:'chatgpt',kind:'chatgpt'}]
 }}) as any);
 // A database fallback would throw here; hidden DB records must never enter the result.
 (a as any).catalogRows=async()=>{throw Error('DATABASE_LIST_MUST_NOT_BE_USED')};
 const rows=await a.catalog('desktop-context');
 assert.deepEqual(rows.map(t=>t.id),['pinned','visible']);
 assert.equal(rows[0].projectId,'project-a');assert.equal(rows[1].updated_at,10);
 assert.deepEqual(calls,[{name:'list_threads',args:{mode:'history',source:'codex',hostId:'local',limit:50}}]);
 assert.equal((await a.catalogStatuses('desktop-context'))[0].id,'pinned');assert.equal(calls.length,1);
});

test('desktop list failure is surfaced instead of leaking hidden database sessions',async()=>{
 const a=new DesktopAdapter((async()=>{throw Error('DESKTOP_TOOL_TIMEOUT')}) as any);
 (a as any).catalogRows=async()=>[{id:'hidden-cli',title:'Reply PROXY_OK',cwd:'E:/wo-z'}];
 await assert.rejects(a.catalog('desktop-context'),/DESKTOP_TOOL_TIMEOUT/);
});

test('project list comes from desktop registered projects without synthesizing cwd projects',async()=>{
 const expected={projects:[{projectId:'real-project',projectKind:'local',label:'Desktop project',path:'E:/new-location'}]};
 const a=new DesktopAdapter((async(name:string)=>{assert.equal(name,'list_projects');return expected}) as any);
 assert.deepEqual(await a.invoke('project/list',{contextThreadId:'desktop-context'}),expected);
});
