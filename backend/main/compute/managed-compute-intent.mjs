import {normalizeComputeAlias} from './managed-compute-aliases.mjs';

export const computeScopeKey=scope=>JSON.stringify([scope.provider,scope.threadId]);
const text=value=>value.normalize('NFKC').trim().toLowerCase();
const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const fail=code=>{throw Error(code);};
const openQuote="[\"“「『‘']?",closeQuote="[\"”」』’']?";
const generic=new Map([['集群','ssh'],['ssh','ssh'],['cluster','ssh'],['本地','wsl'],['wsl','wsl'],['local','wsl']]);
export const genericComputeKind=value=>generic.get(value)||null;

const operations=/队列|分区|节点|资源|环境|作业|集群|queue|partition|node|environment|scheduler|cluster/iu;
const queryLead=String.raw`(?:(?:现在|请|麻烦|帮我|给我|我想|顺便|先|再|please\b|can you\b|could you\b)\s*)*(?:看(?:看|一看|一下|下)?|查(?:查|询|看|一下|一查|下)?|探测|调取|检查|列出|获取|连接|登录|访问|配置|安装|inspect|probe|check|show|list|query|connect to|use)\s*`;
const negativeQuery=/不要|不必|不用|无需|禁止|先别|别查|别看|未授权|假如|如果|举例|例如|仅解释|只解释|(?:如何|怎么)(?:使用|用|查|连接|登录|设置|操作|申请|提交)|do not|don['’]t|never|instead of|without|how (?:do|to|can)|\bif\b/iu;
const exampleWording=/示例|\bexample\b/iu;
const clauses=message=>message.split(/[，。；,;!！?？\n]+/u).map(s=>s.trim()).filter(Boolean);
const directions=message=>message.replace(/\x60{3}[\s\S]*?(?:\x60{3}|$)/gu,' ').split('\n').filter(line=>!line.trimStart().startsWith('>')).join('\n');
const choiceKind='conversation-compute-choice';
const cancelSelection=/不是资源选择|取消(?:当前)?选择|forget (?:this |the )?selection/iu;
const freshTargetWording=/改用|换到|换成|切换|选用|指定|另外|别的|\b(?:switch|instead|another)\b/iu;
const continuation=/^(?:(?:好(?:的)?|嗯|行|请|那就|那|麻烦|帮我|现在|再)\s*[，,]?\s*)*(?:继续|接着|接下来|重试|再试|试试|查一下|查队列|看看队列|看下队列|go ahead\b|please continue\b|continue\b|try again\b|retry\b)/iu;
const renewLease=/^(?:(?:请|那就|麻烦|你|帮我|现在|可以)\s*)*(?:重新申请|重新获取|恢复|续用)(?:原(?:来的)?|之前的|同一个)?(?:计算资源|终端|服务|SSH)?(?:租约|的租约)[\s。.!！]*$|^(?:please\s+)?(?:renew|reacquire|restore)\s+(?:the\s+|my\s+)?(?:original\s+|existing\s+)?(?:ssh\s+)?(?:resource\s+)?lease[\s.!]*$/iu;
const resourceLabel=choice=>text(choice.name);

// Resolve a literal resource reference in a human utterance. The operation
// verb is the Agent's concern. Avoid matching a short name inside another
// name, or an instruction the user only quoted in a log or explicitly denied.
export function namesInChat(message,name) {
 if(!name||!message.includes(name))return false;
 const label=escaped(name);
 const quoted=new RegExp('[「『“‘"\\x60]'+label+'[」』”’"\\x60]','u');
 const after='(?=$|[\\s，。！？、,.!?;；:：）)\\]】]|的|上|里|那[里边]|这个|集群|连接|平台|资源|即可|就行|来查|查|看|跑|执行|提交|配置|安装|读取|和|与)';
 const bounded=new RegExp('(?:^|[\\s,，:：、（(\\[【]|(?:就是|就用|选中|选用|指定|选择|请用|使用|用|是|在|查|看))'+label+after,'u');
 const parts=clauses(message);
 if(parts.some(p=>p.includes(name)&&(negativeQuery.test(p)||/不是|不选|别用|排除|except\b|excluding\b/.test(p))))return false;
 return parts.some(part=>part.includes(name)&&!exampleWording.test(part.replaceAll(name,' '))&&
  (exactAnswer(part,{name})||quoted.test(part)||bounded.test(part)))||requestsComputeName(message,name);
}

function namedChoices(source,candidates,aliases) {
 const exact=candidates.filter(c=>namesInChat(source,text(c.resourceId))||exactAnswer(source,{name:c.profileId}));
 const byLabel=new Map();
 function register(label,choice){
  if(!byLabel.has(label))byLabel.set(label,new Map());
  if(choice)byLabel.get(label).set(choice.resourceId,choice);
 }
 for(const c of candidates)register(resourceLabel(c),c);
 for(const a of aliases)register(a.alias,candidates.find(c=>c.profileId===a.profileId&&c.targetFingerprint===a.targetFingerprint));
 const labels=[...byLabel.keys()].sort((a,b)=>b.length-a.length);
 const named=new Map(),ambiguous=new Map(),excluded=[];
 for(const [name,choices] of byLabel){
  if(genericComputeKind(name))continue;
  const distinct=labels.filter(other=>other!==name&&other.includes(name)).reduce((s,other)=>s.replaceAll(other,' '),source);
  if(clauses(distinct).some(part=>part.includes(name)&&/(?:不要|不用|别用|不再|排除|取消使用|不是|do not|don't|never|avoid|exclude)/iu.test(part)))excluded.push(...choices.values());
  if(!namesInChat(distinct,name))continue;
  const matches=choices.size===1?named:ambiguous;
  for(const [id,choice] of choices)matches.set(id,choice);
 }
 for(const candidate of candidates){
  if(clauses(source).some(part=>part.includes(text(candidate.resourceId))&&/(?:不要|不用|别用|不再|排除|取消使用|不是|do not|don't|never|avoid|exclude)/iu.test(part)))
   excluded.push(candidate);
 }
 return {named:exact.length?exact:[...named.values()],ambiguous:exact.length?[]:[...ambiguous.values()],excluded};
}

export function canAskForResource(message,discovered) {
 // This branch only offers eligible targets for a human decision. Opening a
 // shell or using a service still requires a selected target and its policy.
 return !cancelSelection.test(message)&&clauses(message).some(part=>!negativeQuery.test(part)&&!exampleWording.test(part)&&
  (operations.test(part)||discovered&&continuation.test(part)));
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
 if(exactAnswer(message,{name:value}))return true;
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

// A model may ask a general question with a positive resource option next to
// "just show the plan". Only the label submitted by the human can name a target.
function resourceOption(label,choice,allowBare){
 const value=label.normalize('NFKC').trim(),suffix=/\s*\(((?:ssh|wsl):[A-Za-z0-9_-]+)\)$/u.exec(value);
 if(suffix&&suffix[1]!==choice.resourceId)return false;
 const body=suffix?value.slice(0,suffix.index).trim():value;
 const action=/^(?:选择|选用|使用|就用|连接到|连接|用|选|(?:use|select|choose|connect to)\s+)/iu.exec(body);
 if(!action&&!allowBare)return false;
 const target=(action?body.slice(action[0].length):body).trim();
 return new RegExp('^'+openQuote+escaped(text(choice.name))+closeQuote+'$','u').test(text(target))||
  new RegExp('^'+openQuote+escaped(choice.resourceId)+closeQuote+'$','u').test(target);
}

export function createManagedComputeIntent(catalog){
 const turns=new Map();
 const sameTarget=(left,right)=>left.resourceId===right.resourceId&&left.targetFingerprint===right.targetFingerprint;
 function savedTargets(key,turn){
  const previous=turn.selection??catalog?.get(choiceKind,key);
  return previous?.projectId===turn.projectId&&Array.isArray(previous.targets)?previous.targets:[];
 }
 function saveSelection(key,turn,selected){
  const previous=savedTargets(key,turn);
  const targets=selected.map(item=>{
   const old=previous.find(target=>sameTarget(target,item));
   const chatAccess=item.chatAccess??old?.chatAccess,workspaceId=item.workspaceId??old?.workspaceId;
   return {resourceId:item.resourceId,targetFingerprint:item.targetFingerprint,...chatAccess?.length?{chatAccess,...workspaceId?{workspaceId}:{}}:{}};
  });
  turn.selection={projectId:turn.projectId,taskId:turn.taskId,targets};
  catalog?.put(choiceKind,key,turn.selection);
 }
 function recordUserTurn(value,candidates=[],aliases=[]){
  if(!value||typeof value.provider!=='string'||!value.provider||value.provider.length>80||typeof value.threadId!=='string'||!value.threadId||value.threadId.length>200||typeof value.turnId!=='string'||!value.turnId||value.turnId.length>200||typeof value.text!=='string')fail('managed_compute_invalid_turn');
  const key=computeScopeKey(value),previous=turns.get(key),raw=text(value.text.slice(0,32768)),message=directions(raw);
  const seen=new Map(previous?.seen);
  if(seen.has(value.turnId)){
   if(seen.get(value.turnId)!==raw)fail('managed_compute_turn_changed');
   return;
  }
  seen.set(value.turnId,raw);
  if(seen.size>8)seen.delete(seen.keys().next().value);
  const turn={id:value.turnId,message,seen,pending:null,answer:null,renewLease:renewLease.test(message),projectId:value.projectId??null,taskId:value.taskId??null,
   ...namedChoices(message,candidates,aliases),retained:[]};
  const proposal=previous?.projectId===turn.projectId&&previous?.taskId===turn.taskId?(previous.pending||previous.discovered):null;
  if(proposal){
   const chosen=turn.named.length===1&&!turn.ambiguous.length&&!freshTargetWording.test(message)?turn.named[0]:null;
   const choices=proposal.candidates.filter(choice=>exactAnswer(message,choice)||exactAnswer(message,{name:choice.resourceId})||exactAnswer(message,{name:choice.profileId})||chosen?.resourceId===choice.resourceId);
   if(choices.length===1)turn.answer={proposal,choice:choices[0]};
  }
  // The choice records the requested target and previously checked capability.
  // A new channel still verifies authentication, identity and project policy.
  const prior=previous?.projectId===turn.projectId?previous.selection:catalog?.get(choiceKind,key);
  const selected=turn.answer?[turn.answer.choice]:turn.named;
  if(selected.length&&!turn.ambiguous.length){
   saveSelection(key,turn,selected);
  }else if(prior?.projectId===turn.projectId&&Array.isArray(prior.targets)&&prior.targets.every(t=>t&&typeof t.resourceId==='string'&&typeof t.targetFingerprint==='string')){
   const obsolete=turn.ambiguous.length||freshTargetWording.test(message)||cancelSelection.test(message)||turn.excluded.some(c=>prior.targets.some(t=>t.resourceId===c.resourceId))||
    /(?:不要|别|不用|停止|撤销|取消|不再|stop|avoid|never).{0,15}(?:使用|用|连接|选择|这个资源|集群|\busing\b)/iu.test(message);
   if(obsolete)catalog?.remove(choiceKind,key);
   else {
    turn.selection=prior;
    if(turn.renewLease||(continuation.test(message)||value.planningMode===true)&&!negativeQuery.test(message)&&!/(?:改|换|选|指定|连接到|用|\buse\b|\bon\b)/iu.test(message))turn.retained=prior.targets;
   }
  }
  turns.delete(key);
  turns.set(key,turn);
  if(turns.size>1024)turns.delete(turns.keys().next().value);
 }
 const current=scope=>turns.get(computeScopeKey(scope));
 function permitsUse(scope,resource){
  const turn=current(scope);
  if(!turn||turn.projectId!==(scope.projectId??null)||turn.taskId!==(scope.taskId??null))return true;
  if(turn.excluded.some(item=>item.resourceId===resource.resourceId))return false;
  if(!freshTargetWording.test(turn.message)||!turn.named.length&&!turn.ambiguous.length)return true;
  const selected=turn.answer?[turn.answer.choice]:turn.named;
  return selected.some(item=>item.resourceId===resource.resourceId&&item.targetFingerprint===resource.targetFingerprint);
 }
 function continuesChannel(scope,resource,access){
  const key=computeScopeKey(scope),turn=current(scope);
  if(turn&&(turn.projectId!==(scope.projectId??null)||turn.pending&&!turn.answer))return false;
  const record=turn?turn.selection:catalog?.get(choiceKind,key);
  const workspaceId=resource.workspaceRegistration?.workspaceId;
  return record?.projectId===(scope.projectId??null)&&Array.isArray(record.targets)&&record.targets.some(target=>
   sameTarget(target,resource)&&(!workspaceId||target.workspaceId===workspaceId)&&Array.isArray(target.chatAccess)&&target.chatAccess.includes(access))===true;
 }
 function recordChatChannel(scope,resource,access){
  const key=computeScopeKey(scope),turn=current(scope);
  if(!turn||turn.taskId!==null||scope.taskId||turn.projectId!==(scope.projectId??null))return;
  const previous=savedTargets(key,turn),old=previous.find(target=>sameTarget(target,resource));
  const workspaceId=resource.workspaceRegistration?.workspaceId,oldAccess=!workspaceId||old?.workspaceId===workspaceId?old?.chatAccess:undefined;
  if(oldAccess?.includes(access))return;
  saveSelection(key,turn,[...previous.filter(target=>!sameTarget(target,resource)),
   {...resource,workspaceId,chatAccess:[...(oldAccess||[]),access]}]);
 }
 function releaseChannel(scope,resourceId){
  const key=computeScopeKey(scope),turn=current(scope);
  const previous=turn?.selection??catalog?.get(choiceKind,key);
  if(previous?.projectId!==(scope.projectId??null)||!Array.isArray(previous.targets))return;
  const targets=previous.targets.map(target=>target.resourceId===resourceId?{...target,chatAccess:[]}:target);
  const selection={...previous,targets};
  if(turn?.selection===previous)turn.selection=selection;
  catalog?.put(choiceKind,key,selection);
 }
 function assertTurn(scope,turn){if(!turn||current(scope)!==turn)fail('managed_compute_turn_changed');}
 function propose(scope,turn,proposal){
  assertTurn(scope,turn);
  if(turn.pending&&turn.pending.alias!==proposal.alias)fail('managed_compute_choice_pending');
  if(!turn.pending&&turn.selection){
   turn.selection=null;turn.retained=[];
   catalog?.remove(choiceKind,computeScopeKey(scope));
  }
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
  saveSelection(computeScopeKey(scope),turn,[choice]);
 }
 function acceptQuestionChoice(scope,turn,proposal,choice,isCurrent){
  assertTurn(scope,turn);
  if(!choice||turn.pending&&turn.pending!==proposal||turn.answer&&turn.answer.choice.resourceId!==choice.resourceId||
   turn.excluded.some(item=>item.resourceId===choice.resourceId)||!isCurrent(choice))return null;
  turn.answer={proposal,choice};
  saveSelection(computeScopeKey(scope),turn,[choice]);
  return choice.resourceId;
 }
 function bindResourceQuestion(scope,{question,labels},isCurrent){
  const turn=current(scope),proposal=turn?.pending||turn?.discovered;
  if(!proposal||turn.projectId!==(scope.projectId??null)||turn.taskId!==(scope.taskId??null))return null;
  const prompt=text(question);
  if(negativeQuery.test(prompt)||/排除|不选|跳过哪|不要|不使用|exclude|avoid|skip|not\s+(?:to\s+)?(?:use|connect)/iu.test(prompt))return null;
  const allowBare=/(?:集群|计算资源|ssh|cluster|(?:compute |computing )?resource)/iu.test(prompt)&&
   /选择|使用|连接|哪台|哪个|哪一|choose|which|select|connect|use/iu.test(prompt);
  const bindings=new Map();
  for(const label of labels){
   const matches=proposal.candidates.filter(candidate=>resourceOption(label,candidate,allowBare));
   if(matches.length===1)bindings.set(label,matches[0]);
  }
  if(!bindings.size)return null;
  return label=>bindings.has(label)&&current(scope)===turn&&scope.checkCurrent?.()!==false
   ?acceptQuestionChoice(scope,turn,proposal,bindings.get(label),isCurrent):null;
 }
 function bindComputeChoice(scope,offered,isCurrent){
  const turn=current(scope);
  if(!turn||turn.projectId!==(scope.projectId??null)||turn.taskId!==(scope.taskId??null))fail('managed_compute_turn_changed');
  const proposal=turn.pending||{alias:null,save:false,candidates:[...turn.named,...turn.ambiguous]};
  const candidates=proposal.candidates.filter(choice=>offered.includes(choice.resourceId));
  return ({resourceId,custom})=>{
   if(current(scope)!==turn||scope.checkCurrent?.()!==true)fail('managed_compute_turn_changed');
   const message=typeof custom==='string'?text(custom):'';
   const matches=candidates.filter(choice=>resourceId?choice.resourceId===resourceId:
    message&&[choice.name,choice.resourceId,choice.profileId].some(name=>exactAnswer(message,{name})));
   return matches.length===1?acceptQuestionChoice(scope,turn,proposal,matches[0],isCurrent):null;
  };
 }
 function acquired(scope,resource){
  const turn=current(scope);
  if(!turn||turn.projectId!==(scope.projectId??null)||turn.taskId!==(scope.taskId??null))return;
  if(turn.selection?.targets.some(t=>t.resourceId===resource.resourceId&&t.targetFingerprint===resource.targetFingerprint))return;
  saveSelection(computeScopeKey(scope),turn,[resource]);
 }
 function observedChoices(scope,candidates) {
  const turn=current(scope);
  if(turn&&!turn.pending&&turn.projectId===(scope.projectId??null)&&turn.taskId===(scope.taskId??null))
   turn.discovered={alias:null,save:false,candidates};
 }
 return {recordUserTurn,current,permitsUse,continuesChannel,recordChatChannel,releaseChannel,
  assertTurn,propose,confirmChoice,bindComputeChoice,bindResourceQuestion,observedChoices,acquired,
  forget(provider,threadId){const key=computeScopeKey({provider,threadId});turns.delete(key);catalog?.remove(choiceKind,key);},clear:()=>turns.clear()};
}
