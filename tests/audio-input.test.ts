import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DesktopAdapter} from '../packages/bridge/src/adapter.js';
test('native audio is added only for an uploaded audio attachment',async()=>{
 const adapter=new DesktopAdapter();adapter.states.set('qa',{state:{id:'qa',turns:[]},revision:1});
 const inputs:any[]=[];adapter.ipc={request:async(name:string,p:any)=>{
  if(name==='thread-owner-discovery')return {handledByClientId:'desktop'};
  inputs.push(p.turnStart.request.input);return {result:{ok:true}};
 }} as any;
 await adapter.invoke('turn/start',{threadId:'qa',text:'ordinary text'});
 await adapter.invoke('turn/start',{threadId:'qa',text:'audio',_attachments:[{name:'sample.m4a',mime:'audio/mp4',path:'E:/test/sample.m4a'}]});
 assert.deepEqual(inputs[0],[{type:'text',text:'ordinary text',text_elements:[]}]);
 assert.deepEqual(inputs[1].at(-1),{type:'localAudio',path:'E:/test/sample.m4a'});
});
