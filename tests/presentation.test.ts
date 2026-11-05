import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayRows,shortTitle,pathName,normalizePath} from '../apps/mobile/src/presentation.js';
test('work output collapses without reordering user messages and answers',()=>{
 const rows=displayRows([{id:'u',type:'userMessage',text:'fix'},{id:'c',type:'commandExecution',text:'test passed'},{id:'f',type:'fileChange',text:'diff'},{id:'a',type:'agentMessage',text:'done'}]);
 assert.deepEqual(rows.map(r=>r.id),['u','work-c','a']);assert.deepEqual(rows[1].items?.map(i=>i.id),['c','f']);
});
test('empty streaming and internal markers do not create blank transcript cards',()=>{
 const rows=displayRows([{id:'r',type:'reasoning',text:''},{id:'e',type:'agentMessage',text:' '},{id:'s',type:'steered',text:''},{id:'a',type:'agentMessage',text:'你好'}]);assert.deepEqual(rows.map(r=>r.id),['a']);
});
test('chat titles and project labels preserve readable content without Markdown URLs or Windows prefixes',()=>{
 assert.equal(shortTitle('[继续开发](codex://threads/example)\n继续这个任务'),'继续开发 继续这个任务');
 assert.equal(normalizePath('\\\\?\\E:\\Codex\\content'),normalizePath('E:/Codex/content/'));assert.equal(pathName('E:\\Codex\\remoteapp'),'remoteapp');
});
