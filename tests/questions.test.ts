import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectThread} from '../packages/protocol/src/index.js';
import {asyncReply} from '../packages/protocol/src/questions.js';
import {DesktopAdapter} from '../packages/bridge/src/adapter.js';
const item={type:'agentMessage',id:'call-question',text:'',questions:[{title:'选择验收方式',options:['模拟器','真机']},{title:'补充说明',options:[]}]};
const state=(items:any[],status='completed')=>({id:'qa',turns:[{turnId:'qa-turn',status,items}]});
test('async questions survive completed turns and get desktop-compatible IDs',()=>{
 const p=projectThread(state([item]),1);assert.equal(p.requests.length,2);
 assert.equal(p.requests[0].id,JSON.stringify(['request_user_input_async','call-question',0]));
 assert.deepEqual(p.requests[0].params.questions[0].options,[{label:'模拟器'},{label:'真机'}]);
});
test('structured desktop and mobile answers clear only answered questions; pending steering does not',()=>{
 const q=projectThread(state([item]),1).requests[0];const text=asyncReply(q,'自定义选择');
 const answered={type:'userMessage',content:[{type:'text',text}]};
 assert.equal(projectThread(state([item,answered]),2).requests.length,1);
 assert.equal(projectThread(state([item,{type:'steeringUserMessage',status:'pending',input:answered.content}]),2).requests.length,2);
 assert.equal(projectThread(state([item,{type:'steeringUserMessage',status:'accepted',input:answered.content}]),2).requests.length,1);
 assert.throws(()=>asyncReply(q,' '),/INVALID_INPUT_ANSWER/);
});
test('async answer uses the same desktop turn with structured text and rejects stale questions',async()=>{
 for(const status of ['completed','inProgress']) {
  const a=new DesktopAdapter();a.states.set('qa',{state:state([item],status),revision:1});
  const calls:any[]=[];a.ipc={request:async(name:string,params:any)=>{
   if(name==='thread-owner-discovery')return {handledByClientId:'desktop'};
   calls.push({name,params});return {result:{ok:true}};
  }} as any;
  const request=projectThread(state([item]),1).requests[0];
  await a.invoke('async-input/respond',{threadId:'qa',requestId:request.id,answer:'模拟器',messageId:'stable-message'});
  assert.equal(calls[0].name,status==='completed'?'thread-follower-start-turn':'thread-follower-steer-turn');
  const input=status==='completed'?calls[0].params.turnStart.request.input:calls[0].params.input;
  assert.ok(input[0].text.includes('send_user_message_question_reply'));assert.ok(input[0].text.includes('模拟器'));
  await assert.rejects(a.invoke('async-input/respond',{threadId:'qa',requestId:request.id,answer:'真机'}),/INPUT_ALREADY_SUBMITTED/);
  a.states.set('qa',{state:state([item,{type:'userMessage',content:[{type:'text',text:input[0].text}]}]),revision:2});
  await assert.rejects(a.invoke('async-input/respond',{threadId:'qa',requestId:request.id,answer:'真机'}),/INPUT_REQUEST_EXPIRED/);
 }
});

test('structured answers render readable question and answer instead of protocol markup',()=>{
 const q=projectThread(state([item]),1).requests[0];
 const p=projectThread(state([{type:'userMessage',id:'reply',content:[{type:'text',text:asyncReply(q,'模拟器')}]}]),2);
 assert.equal(p.items[0].text,'选择验收方式\n模拟器');
});
