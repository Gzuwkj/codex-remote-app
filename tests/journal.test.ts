import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {loadJournal} from '../packages/bridge/src/journal.js';
const dir=process.cwd()+'/.state/journal-tests-'+randomUUID();mkdirSync(dir,{recursive:true});
test('unfinished command after a crash becomes unknown and retains its fingerprint',()=>{const file=dir+'/pending.json';writeFileSync(file,JSON.stringify({command:{fingerprint:'original',status:'pending'}}));assert.deepEqual(loadJournal(file).command,{fingerprint:'original',status:'unknown'});});
test('corrupted or malformed journal fails closed instead of enabling duplicate execution',()=>{for(const [i,body]of ['{broken','[]','{"command":{"status":"done"}}'].entries()){const file=dir+'/'+i+'.json';writeFileSync(file,body);assert.throws(()=>loadJournal(file));}});
test('only a missing journal is treated as a fresh installation',()=>{assert.deepEqual(loadJournal(dir+'/missing.json'),{});});
