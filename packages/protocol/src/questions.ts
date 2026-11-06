/** Desktop async questions live on assistant items, independently of RPC approvals. */
export function asyncQuestions(items: any[]) {
  const answered = new Set<string>();
  for (const item of items) {
    if (!['userMessage', 'steeringUserMessage'].includes(item.type)) continue;
    if (item.type === 'steeringUserMessage' && item.status && item.status !== 'accepted') continue;
    const text = item.text ?? (item.content ?? item.input ?? []).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n');
    const match = /<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(text);
    if (!match) continue;
    try {
      const value=JSON.parse(match[1]);
      for (const reply of Array.isArray(value)?value:[value]) if(typeof reply.questionItemId==='string') answered.add(reply.questionItemId);
    } catch { /* Ordinary user prose is not a question reply. */ }
  }
  return items.filter(i=>i.type==='agentMessage').flatMap(item=>(item.questions??[]).flatMap((q:any,index:number)=>{
    const id=JSON.stringify(['request_user_input_async',item.id,index]);
    return answered.has(id)||typeof q.title!=='string'?[]:[{
      id, method:'desktop/asyncQuestion', params:{questions:[{id,question:q.title,options:(q.options??[]).map((label:string)=>({label}))}]},
    }];
  }));
}

export function asyncReply(request: any, answer: unknown) {
  if (typeof answer!=='string'||!answer.trim()||answer.length>16000) throw Error('INVALID_INPUT_ANSWER');
  return '<send_user_message_question_reply>\n'+JSON.stringify([{
    questionItemId:request.id, question:request.params.questions[0].question, answer:answer.trim(),
  }])+'\n</send_user_message_question_reply>';
}

/** Render the user-facing answer, keeping the transport wrapper out of the transcript. */
export function questionReplyText(text: string): string | undefined {
  const match=/<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(text);
  if(!match)return;
  try {
    const payload=JSON.parse(match[1]);const rows=Array.isArray(payload)?payload:[payload];
    if(!rows.length||!rows.every(r=>typeof r.question==='string'&&typeof r.answer==='string'))return;
    return rows.map(r=>r.question+'\n'+r.answer).join('\n\n');
  } catch { return; }
}
