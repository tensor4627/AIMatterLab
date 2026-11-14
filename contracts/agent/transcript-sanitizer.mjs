// One projection for model/provider text before it enters AIMatterLab history or UI.
// Credentials remain private transport configuration, never transcript fields.
const sensitiveKey=/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|client[_-]?secret|private[_-]?key)$/i;
export function redactTranscriptText(value,secrets=[]){
 let text=String(value);
 for(const secret of [...new Set(secrets.filter(v=>typeof v==='string'&&v))].sort((a,b)=>b.length-a.length))text=text.replaceAll(secret,'[redacted]');
 return text.replace(/\bsk-[A-Za-z0-9_-]*/g,'[redacted]').replace(/(Bearer\s+)[^\s"'<>]+/gi,'$1[redacted]')
  .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)["']?\s*[=:]\s*["']?)[^\s,"'<>}]+/gi,'$1[redacted]');
}
export function sanitizeTranscript(value,secrets=[]){
 if(typeof value==='string')return redactTranscriptText(value,secrets);
 if(Array.isArray(value))return value.map(item=>sanitizeTranscript(item,secrets));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sensitiveKey.test(key)&&item!=null?'[redacted]':sanitizeTranscript(item,secrets)]));
 return value;
}
// Only call at a trusted protocol/history boundary. Arbitrary tool payloads
// remain covered by sanitizeTranscript, including properties named id.
export function sanitizeProtocolTranscript(value,secrets=[],{kind}={}){
 const clean=sanitizeTranscript(value,secrets);
 const ids=(source,target,keys)=>{if(!source||!target)return;for(const key of keys){let text=source[key];if(typeof text!=='string'&&typeof text!=='number')continue;if(typeof text==='string')for(const secret of secrets.filter(v=>typeof v==='string'&&v))text=text.replaceAll(secret,'[redacted]');target[key]=text;}};
 const item=(source,target)=>{if(!source||!target)return;ids(source,target,['id']);};
 const turn=(source,target)=>{if(!source||!target)return;ids(source,target,['id']);for(let index=0;index<(source.items||[]).length;index++)item(source.items[index],target.items?.[index]);};
 const thread=(source,target)=>{if(!source||!target)return;ids(source,target,['id','nativeId','provider']);for(const key of ['turns','nativeTurns','legacyTurns'])for(let index=0;index<(source[key]||[]).length;index++)turn(source[key][index],target[key]?.[index]);};
 if(value&&typeof value==='object'&&!Array.isArray(value)){
  if(Array.isArray(value.turns)||Array.isArray(value.nativeTurns)||Array.isArray(value.legacyTurns))thread(value,clean);
  if(value.thread)thread(value.thread,clean.thread);
  if(value.turn)turn(value.turn,clean.turn);
  if(Array.isArray(value.data))for(let index=0;index<value.data.length;index++)if(Array.isArray(value.data[index]?.turns))thread(value.data[index],clean.data[index]);
  if(typeof value.method==='string'&&value.params){const source=value.params,target=clean.params;ids(value,clean,['id','provider']);ids(source,target,['threadId','turnId','itemId','sessionId','requestId']);thread(source.thread,target.thread);turn(source.turn,target.turn);item(source.item,target.item);if(value.method==='session/update')ids(source.update,target.update,['toolCallId','messageId']);}
  if(kind==='dsh-event-data'&&value.message){ids(value.message,clean.message,['id','toolCallId']);ids(value.message.source,clean.message.source,['callId']);for(let index=0;index<(value.message.content||[]).length;index++){const block=value.message.content[index];if(block?.type==='tool-call')ids(block,clean.message.content?.[index],['id']);}}
 }
 return clean;
}
// Retain only a possible credential suffix. A secret split over chunks must not
// leak through already emitted deltas, even if another event saves the turn.
export function createTranscriptStream(getSecrets=()=>[]){
 let tail='',suppressToken=false;
 return {
  push(chunk,{final=false}={}){
   const secrets=getSecrets();let text=tail+String(chunk||'');
   if(suppressToken){const end=text.search(/[\s,"'<>}]/);if(end<0){if(final)suppressToken=false;return '';}text=text.slice(end);suppressToken=false;}
   let cut=text.length;
   if(final)for(const secret of secrets.filter(v=>typeof v==='string'&&v))for(let length=4;length<secret.length&&length<=text.length;length++)if(text.endsWith(secret.slice(0,length))){text=text.slice(0,-length)+'[redacted]';cut=text.length;break;}
   if(!final){
    for(const secret of secrets.filter(v=>typeof v==='string'&&v))for(let length=1;length<secret.length&&length<=text.length;length++)if(text.endsWith(secret.slice(0,length)))cut=Math.min(cut,text.length-length);
    for(const label of ['sk-','Bearer ','apiKey','api_key','api-key','access_token','accessToken','refresh_token','refreshToken','password','client_secret'])for(let length=1;length<=label.length&&length<=text.length;length++)if(text.toLowerCase().endsWith(label.slice(0,length).toLowerCase()))cut=Math.min(cut,text.length-length);
    const match=text.match(/(?:\bsk-[A-Za-z0-9_-]*|\bsk?|\bBearer\s+[^\s"'<>]*|\bB(?:e(?:a(?:r(?:e(?:r)?)?)?)?)?)$/i);
    if(match)cut=Math.min(cut,match.index);
    const assignment=text.match(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)["']?\s*[=:]\s*["']?[^\s,"'<>}]*$/i);if(assignment)cut=Math.min(cut,assignment.index);
   }
   // Malformed never-ending tokens must not grow memory without bound.
   if(text.length-cut>8192){tail='';suppressToken=!final;return redactTranscriptText(text.slice(0,cut),secrets)+'[redacted]';}
   tail=text.slice(cut);return redactTranscriptText(text.slice(0,cut),secrets);
  },
  clear(){tail='';suppressToken=false;}
 };
}
