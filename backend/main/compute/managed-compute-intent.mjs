import {normalizeComputeAlias} from './managed-compute-aliases.mjs';

export const computeScopeKey=scope=>JSON.stringify([scope.provider,scope.threadId]);
const text=value=>value.normalize('NFKC').trim().toLowerCase();
const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const fail=code=>{throw Error(code);};
const openQuote="[\"“「『‘']?",closeQuote="[\"”」』’']?";
const generic=new Map([['集群','ssh'],['ssh','ssh'],['cluster','ssh'],['本地','wsl'],['wsl','wsl'],['local','wsl']]);
export const genericComputeKind=value=>generic.get(value)||null;

const operations=/队列|分区|节点|资源|环境|作业|集群|queue|partition|node|environment|scheduler|cluster/iu;
const queryLead=String.raw`(?:(?:现在|请|麻烦|帮我|给我|我想|顺便|先|再|please\b|can you\b|could you\b)\s*)*(?:看(?:看|一看|一下|下)?|查(?:查|询|看|一下|一查|下)?|调取|检查|列出|获取|连接|登录|访问|配置|安装|inspect|check|show|list|query|connect to|use)\s*`;
const negativeQuery=/不要|不必|不用|无需|禁止|先别|别查|别看|未授权|假如|如果|举例|例如|仅解释|只解释|如何|怎么|do not|don['’]t|never|instead of|without|how (?:do|to|can)|\bif\b/iu;
const exampleWording=/示例|\bexample\b/iu;
const clauses=message=>message.split(/[，。；,;!！?？\n]+/u).map(s=>s.trim()).filter(Boolean);

export function hasResourceRequest(message) {
 const command=new RegExp('^'+queryLead,'iu');
 return clauses(message).some(part=>operations.test(part)&&!negativeQuery.test(part)&&!exampleWording.test(part)&&
   (command.test(part)||/^(?:请|帮我|please\s+)?(?:用|使用|在|选用|use\b|run\b)/iu.test(part)));
}

function requestedObservation(message,value) {
 const name=escaped(value),target=openQuote+name+closeQuote;
 const prefix=new RegExp('^'+queryLead+'(?:一下\\s*)?(?:the\\s+)?'+target+'(?=$|[\\s的上中有哪些里可是否还在]|集群|分区|队列|节点|资源|作业|环境)','iu');
 const namedFirst=new RegExp('^'+target+'(?:集群)?(?:上|中|里|的|\\s+).{0,48}(?:队列|分区|空闲|资源|有空|环境|作业|nodes?|queues?|partitions?)','iu');
 const suffix=new RegExp('^'+queryLead+'.{0,128}(?:\\bon\\s+|\\bof\\s+|\\bat\\s+|\\bfrom\\s+|在)'+target+'(?:集群)?\\s*$','iu');
 // The display name itself can contain words such as "example" or "示例".
 // Determine whether the surrounding instruction is hypothetical or negative.
 const restricted=part=>negativeQuery.test(part)||exampleWording.test(part.replaceAll(value,' '));
 // A restriction about another clause must never be turned into a positive selection.
 if(clauses(message).some(part=>restricted(part)&&part.includes(value)))return false;
 return clauses(message).some(part=>!restricted(part)&&operations.test(part)&&
  (prefix.test(part)||namedFirst.test(part)||suffix.test(part)));
}

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
 if(requestedObservation(message,value))return true;
 if(genericComputeKind(value)){
  return new RegExp(lead+clause+'\\s*'+literal+'(?=$|[\\s，。,.！!；;]|跑|算|提交|计算|运行|做|查看)','u').test(message);
 }
 // Exact conjunction members support a single instruction for two resources.
 const joint=new RegExp(lead+clause+'[^。.!！；;，,\\r\\n]{1,100}(?:和|与|以及|、|\\band\\b)\\s*'+openQuote+literal+boundary,'u');
 return positive.test(message)||joint.test(message);
}

function exactAnswer(message,choice){
 const name=text(choice.name),pattern='^(?:(?:对|好的|没错|确认|yes)[，,\\s]+)?(?:(?:就是|是|选择|选用|使用|就用|选|用|choose\\s+|use\\s+)\\s*)?'+openQuote+escaped(name)+closeQuote+'[\\s。.!！]*$';
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
  const turn={id:value.turnId,message,seen,pending:null,answer:null,projectId:value.projectId??null,taskId:value.taskId??null};
  const proposal=previous?.projectId===turn.projectId&&previous?.taskId===turn.taskId?(previous.pending||previous.discovered):null;
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
 function observedChoices(scope,candidates) {
  const turn=current(scope);
  if(turn&&!turn.pending&&hasResourceRequest(turn.message)&&turn.projectId===(scope.projectId??null)&&turn.taskId===(scope.taskId??null))
   turn.discovered={alias:null,save:false,candidates};
 }
 return {recordUserTurn,current,assertTurn,propose,confirmChoice,observedChoices,
  forget:(provider,threadId)=>turns.delete(computeScopeKey({provider,threadId})),clear:()=>turns.clear()};
}
