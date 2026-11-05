import {readFileSync} from 'node:fs';
export type Entry={fingerprint:string;status:'pending'|'unknown'|'done'|'failed';result?:unknown;error?:string};
export function loadJournal(file:string):Record<string,Entry>{
  let value:unknown;
  try{value=JSON.parse(readFileSync(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw error;}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_COMMAND_JOURNAL');
  for(const entry of Object.values(value)){
    if(!entry||typeof entry.fingerprint!=='string'||!['pending','unknown','done','failed'].includes(entry.status))throw Error('INVALID_COMMAND_JOURNAL');
    if(entry.status==='pending')entry.status='unknown';
  }
  return value as Record<string,Entry>;
}
