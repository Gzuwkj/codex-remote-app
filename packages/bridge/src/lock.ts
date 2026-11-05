import {openSync,readFileSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export function acquireLock(file:string){
  const owner=JSON.stringify({pid:process.pid,id:randomUUID()});
  const create=()=>{const fd=openSync(file,'wx',0o600);try{writeFileSync(fd,owner);}finally{closeSync(fd);}};
  try{create();}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    let alive=true;const previous=JSON.parse(readFileSync(file,'utf8'));
    if(!Number.isInteger(previous.pid)||previous.pid<1)throw Error('INVALID_BRIDGE_LOCK');
    try{process.kill(previous.pid,0);}catch(check){if((check as NodeJS.ErrnoException).code==='ESRCH')alive=false;else throw check;}
    if(alive)throw Error('BRIDGE_ALREADY_RUNNING');unlinkSync(file);create();
  }
  process.once('exit',()=>{try{if(readFileSync(file,'utf8')===owner)unlinkSync(file);}catch{}});
}
