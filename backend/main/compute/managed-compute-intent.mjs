import {normalizeComputeAlias} from './managed-compute-aliases.mjs';

export const computeScopeKey=scope=>JSON.stringify([scope.provider,scope.threadId]);
const text=value=>value.normalize('NFKC').trim().toLowerCase();
const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const fail=code=>{throw Error(code);};
const openQuote="[\"“「『‘']?",closeQuote="[\"”」』’']?";
const generic=new Map([['集群','ssh'],['ssh','ssh'],['cluster','ssh'],['本地','wsl'],['wsl','wsl'],['local','wsl']]);
export const genericComputeKind=value=>generic.get(value)||null;

// Keep automatic interpretation narrow. Other wordings can be resolved through
// an exact follow-up choice, with the same authenticated transcript.
export function requestsComputeName(message,value){
 if(!value)return false;
 const literal=escaped(value);
 const boundary='(?=$|[^\\p{L}\\p{N}_-]|集群|运行|跑|算|计算|提交|做|读取|查看|来|上|和|与|以及|或者|分别)';
 const clause='(?:用|使用|在|选择|选用|切换到|指定|选|use\\b|run (?:on|using)\\b|choose\\b|select\\b|switch to\\b)';
 const lead='(?:^|[，。,.!！；;\\r\\n])\\s*(?:(?:请|麻烦|帮我|给我|我要|我想|这次|本次|现在|先|再|然后|please\\b|can you\\b|i (?:want|need) to\\b)\\s*){0,6}';
 const positive=new RegExp(lead+clause+'\\s*'+openQuote+literal+boundary,'u');
 const negative=new RegExp('(?:不要|别|不能|不再|不|don[’\']t|do not|never|avoid)\\s*(?:再\\s*)?'+clause+'\\s*'+openQuote+literal+boundary,'u');
 if(negative.test(message))return false;
 if(genericComputeKind(value)){
  return new RegExp(lead+clause+'\\s*'+literal+'(?=$|[\\s，。,.！!；;]|跑|算|提交|计算|运行|做|查看)','u').test(message);
 }
 // Exact conjunction members support a single instruction for two resources.
 const joint=new RegExp(lead+clause+'[^。.!！；;，,\\r\\n]{1,100}(?:和|与|以及|、|\\band\\b)\\s*'+openQuote+literal+boundary,'u');
 return positive.test(message)||joint.test(message);
}

function exactAnswer(message,choice){
 const name=text(choice.name),pattern='^(?:(?:选择|选用|使用|选|用|就是|choose\\s+|use\\s+)\\s*)?'+openQuote+escaped(name)+closeQuote+'[\\s。.!！]*$';
 return !!name&&new RegExp(pattern,'u').test(message);
}

export function createManagedComputeIntent(){
 const turns=new Map();
 function recordUserTurn(value){
  if(!value||typeof value.provider!=='string'||!value.provider||value.provider.length>80||typeof value.threadId!=='string'||!value.threadId||value.threadId.length>200||typeof value.turnId!=='string'||!value.turnId||value.turnId.length>200||typeof value.text!=='string')fail('managed_compute_invalid_turn');
  const key=computeScopeKey(value),previous=turns.get(key),message=text(value.text.slice(0,32768));
  const seen=new Map(previous?.seen);
  if(seen.has(value.turnId)){
   if(seen.get(value.turnId)!==message)fail('managed_compute_turn_changed');
   return;
  }
  seen.set(value.turnId,message);
  if(seen.size>8)seen.delete(seen.keys().next().value);
  const turn={id:value.turnId,message,seen,pending:null,answer:null};
  const proposal=previous?.pending;
  if(proposal){
   const choices=proposal.candidates.filter(choice=>exactAnswer(message,choice));
   if(choices.length===1)turn.answer={proposal,choice:choices[0]};
  }
  turns.delete(key);
  turns.set(key,turn);
  if(turns.size>1024)turns.delete(turns.keys().next().value);
 }
 const current=scope=>turns.get(computeScopeKey(scope));
 function assertTurn(scope,turn){if(!turn||current(scope)!==turn)fail('managed_compute_turn_changed');}
 function propose(scope,turn,proposal){
  assertTurn(scope,turn);
  if(turn.pending&&turn.pending.alias!==proposal.alias)fail('managed_compute_choice_pending');
  // Replays of the same unresolved tool call must not change its candidates.
  turn.pending??=proposal;
  return turn.pending;
 }
 function confirmChoice(scope,{resourceId,alias}){
  const turn=current(scope),key=alias===undefined?undefined:normalizeComputeAlias(alias);
  const proposal=turn?.pending;
  if(!proposal||key!==undefined&&key!==proposal.alias)fail('managed_compute_choice_required');
  const choice=proposal.candidates.find(item=>item.resourceId===resourceId);
  if(!choice)fail('managed_compute_choice_changed');
  if(turn.answer&&turn.answer.choice!==choice)fail('managed_compute_choice_changed');
  turn.answer={proposal,choice};
 }
 return {recordUserTurn,current,assertTurn,propose,confirmChoice,
  forget:(provider,threadId)=>turns.delete(computeScopeKey({provider,threadId})),clear:()=>turns.clear()};
}
