import {createHash} from 'node:crypto';
import {conversationText,historyTextItem} from '../../contracts/agent/conversation-history.mjs';
import {redactTranscriptText,sanitizeProtocolTranscript} from '../../contracts/agent/transcript-sanitizer.mjs';
import {titleReviewToolName} from '../../contracts/agent/conversation-title.mjs';
import {attachmentHeader,chatAttachmentRefs} from '../../contracts/agent/chat-attachments.mjs';
import {serviceHistory} from './wake-delivery.mjs';

const pageSize=30, maxMatches=60;
const bookmarkKind='conversation-bookmarks';
const exactId=value=>typeof value==='string'&&value.length>0&&value.length<=240&&!/[\x00-\x1f]/.test(value);
const rowKey=({turnId,itemId})=>JSON.stringify([turnId,itemId??null]);
const sha=value=>createHash('sha256').update(value).digest('hex');
const unsupported=error=>error?.rpcResponse===true&&(error.rpcCode===-32601||/not supported|unsupported|unknown method|method not found/i.test(error.message));
const recordShape=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const clip=(value,length)=>value.length>length?value.slice(0,length)+'…':value;
const visibleTool=item=>['mcpToolCall','webSearch','commandExecution','fileChange'].includes(item?.type)&&item.tool!==titleReviewToolName;

// Persist/return references to display identity, never provider paths or a whole thread.
function anchorRequest(value,extra=[]){
 if(!recordShape(value,['conversationId','turnId','itemId',...extra])||!exactId(value.conversationId)||!exactId(value.turnId)||value.itemId!==undefined&&!exactId(value.itemId))throw Error('Invalid history location');
 return {conversationId:value.conversationId,turnId:value.turnId,...value.itemId?{itemId:value.itemId}:{}};
}

export function stableHistoryTurns(turns){
 const seen=new Set(),reserved=new Set(turns.map(turn=>turn?.id));
 return turns.map((turn,index)=>{
  let id=turn?.id;
  if(!exactId(id)||seen.has(id)){
   id='legacy-turn:'+index;
   while(reserved.has(id))id=':'+id;
  }
  seen.add(id);
  const items=new Map();
  for(const [index,item] of (turn?.items||[]).entries()){
   if(!item||typeof item.type!=='string')continue;
   const itemId=exactId(item.id)?item.id:'legacy-item:'+index;
   items.set(itemId,{...items.get(itemId),...item,id:itemId});
  }
  return {...turn,id,items:[...items.values()]};
 });
}
function legacyAcpTurns(turns){
 return turns.flatMap(turn=>{
  if(turn.id!=='history'||turn.status)return [turn];
  const groups=[];
  for(const item of turn.items||[]){
   if(!groups.length||item.type==='userMessage'&&groups.at(-1).items.length)groups.push({id:'legacy-acp:'+groups.length,items:[]});
   groups.at(-1).items.push(item);
  }
  return groups;
 });
}

function pageTurn(turn){
 const items=turn.items.flatMap(item=>{
  if(historyTextItem(item)){
   if(item.type==='userMessage'){
    const content=[{type:'text',text:conversationText(item)}],refs=chatAttachmentRefs(Array.isArray(item.content)?item.content:[]);
    if(refs.length)content.push({type:'text',text:attachmentHeader+'\n'+JSON.stringify(refs)+'\n'});
    return [{id:item.id,type:item.type,content,...exactId(item.clientUserMessageId)?{clientUserMessageId:item.clientUserMessageId}:{}}];
   }
   if(['agentMessage','serviceMessage'].includes(item.type))return [{id:item.id,type:item.type,text:conversationText(item)}];
   return [item];
  }
  if(!visibleTool(item))return [];
  // The tool card can describe its operation and status while its output stays
  // in the main process until the user expands the individual card.
  const {id,type,tool,status,query,command,exitCode}=item;
  return [{id,type,tool,status,query,command,exitCode,studioDetail:true}];
 });
 return {id:turn.id,status:turn.status,items};
}

function toolReceiptText(item){
 if(item.type!=='mcpToolCall'||!visibleTool(item))return '';
 const ids=new Set();
 function read(value,depth=0){
  if(value==null||depth>6||ids.size>=20)return;
  if(typeof value==='string'&&value.length<32768){
   try{read(JSON.parse(value),depth+1);}catch{}
  }else if(Array.isArray(value)){
   for(const entry of value.slice(0,40))read(entry,depth+1);
  }else if(typeof value==='object'){
   for(const field of ['job_id','jobId','scheduler_job_id','schedulerJobId','slurm_job_id','run_id','runId']){
    const id=value[field];
    if(typeof id==='number'&&Number.isSafeInteger(id)||typeof id==='string'&&/^[\w.:-]{1,160}$/.test(id))ids.add(redactTranscriptText(id));
   }
   for(const key of ['content','structuredContent','result','data','text','run','job'])read(value[key],depth+1);
  }
 }
 read(item.result);
 return [...ids].join(' ');
}

function indexedRows(turns){
 return turns.flatMap(turn=>turn.items.flatMap(item=>{
  const text=conversationText(item)||toolReceiptText(item);
  return text.trim()?[{turnId:turn.id,itemId:item.id,text,folded:text.toLowerCase()}]:[];
 }));
}
function snippet(text,index=0){return (index>45?'…':'')+clip(text.slice(Math.max(0,index-45)),160).replace(/\s+/g,' ');}

export function createConversationHistory({catalog,records,agents,nativeRequest,restoreTitle}){
 const indices=new Map(),revisions=new Map(),localFallback=new Set(),forks=new Map();
 function conversation(id){
  if(!exactId(id))throw Error('Invalid conversation');
  const value=catalog.get('conversation',id);
  if(!value||records.deleted(value.provider,value.threadId)||value.id!==value.provider+':'+value.threadId)throw Error('Unknown conversation');
  return value;
 }
 function assertUnchanged(value){
  const current=conversation(value.id);
  if(current.projectId!==value.projectId)throw Error('Conversation project changed');
  return current;
 }
 function invalidate(id){indices.delete(id);revisions.set(id,(revisions.get(id)||0)+1);}
 function forget(id){indices.delete(id);revisions.delete(id);localFallback.delete(id);}
 function observe(event){
  const {provider,method,params={}}=event;
  if(provider&&params.threadId&&['turn/completed','studio/serviceNotification','studio/conversationContextChanged'].includes(method))invalidate(provider+':'+params.threadId);
 }
 function bookmarks(id){return catalog.get(bookmarkKind,id)?.items||[];}
 async function localTurns(owner){
  const {provider,threadId}=owner;
  let thread;
  if(provider==='codex'){
   const state=agents.codexThreadState(threadId),saved=catalog.get('thread',threadId);
   if(state?.state==='empty')thread=saved||{id:threadId,turns:[]};
   else try{thread=(await nativeRequest('thread/read',{threadId,includeTurns:true})).thread;}catch(error){
    if(!saved?.turns?.length)throw error;
    thread=saved;
   }
  }else thread=await agents.readLocalConversationHistory(provider,threadId);
  if(thread?.id!==threadId||thread.provider&&thread.provider!==provider)throw Error('History belongs to a different conversation');
  const live=agents.historySession(provider,threadId);
  const turns=provider==='kimi'?legacyAcpTurns(thread.turns||[]):[...(thread.turns||[])];
  if(live?.turn&&!turns.some(turn=>turn.id===live.turn.id))turns.push(live.turn);
  assertUnchanged(owner);
  return stableHistoryTurns(serviceHistory(catalog,provider,threadId,turns));
 }
 async function nativeList(method,params){
  let limit=params.limit;
  for(;;){
   try{return {limit,response:await nativeRequest(method,{...params,limit})};}
   catch(error){
    if(error?.code!=='STUDIO_CODEX_OVERSIZED_FRAME'||limit<=1)throw error;
    // Keep the same provider cursor so reducing a page cannot skip entries.
    limit=Math.floor(limit/2);
   }
  }
 }
 async function nativePage(owner,cursor,itemsView='summary'){
  const {threadId}=owner;
  const {response,limit}=await nativeList('thread/turns/list',{threadId,limit:pageSize,sortDirection:'desc',itemsView,...cursor?{cursor}:{}});
  if(!Array.isArray(response?.data)||response.data.length>limit||response.data.some(turn=>!exactId(turn?.id))||response.nextCursor!=null&&typeof response.nextCursor!=='string')throw Error('Invalid provider history page');
  assertUnchanged(owner);
  return {turns:stableHistoryTurns(response.data.slice().reverse()),cursor:response.nextCursor||null};
 }
 function nativeEnabled(owner){return owner.provider==='codex'&&!localFallback.has(owner.id)&&agents.codexThreadState(owner.threadId)?.state!=='empty';}
 async function mode(owner,run,fallback){
  if(nativeEnabled(owner)){
   try{return await run();}catch(error){if(!unsupported(error))throw error;localFallback.add(owner.id);}
  }
  return fallback();
 }
 function cursorFor(owner,kind,value){return value?JSON.stringify([owner.id,kind,value]):null;}
 function readCursor(owner,value){
  if(value==null)return {};
  if(typeof value!=='string'||value.length>4096)throw Error('Invalid history cursor');
  let cursor;try{cursor=JSON.parse(value);}catch{throw Error('Invalid history cursor');}
  if(!Array.isArray(cursor)||cursor.length!==3||cursor[0]!==owner.id||!['local','native'].includes(cursor[1])||typeof cursor[2]!=='string'||!cursor[2])throw Error('Invalid history cursor');
  return {kind:cursor[1],value:cursor[2]};
 }
 function present(owner,turns,before,atLatest,live){
  const {thread:ignored,turn,...session}=live||{};
  const append=atLatest&&turn&&!turns.some(row=>row.id===turn.id);
  const conversation=assertUnchanged(owner);
  if(atLatest)restoreTitle?.(owner.provider,{id:owner.threadId,turns});
  return {conversation,turns:turns.map(pageTurn),before,atLatest,bookmarks:bookmarks(owner.id),...live?{studioSession:session}:{},
   ...append?{liveTurn:pageTurn(turn)}:{}};
 }
 // A local before cursor is the next page's exclusive newest boundary. A
 // subsequent append leaves its position unchanged even while a turn streams.
 function localPage(owner,turns,end,atLatest){
  const start=Math.max(0,end-pageSize),before=start?cursorFor(owner,'local',turns[start].id):null;
  return present(owner,turns.slice(start,end),before,atLatest,agents.historySession(owner.provider,owner.threadId));
 }
 function savedPage(owner,before){
  const {provider,threadId}=owner;
  // A scheduled note can be materialized under a different native item ID.
  // Its compatibility projection needs the complete local transcript.
  if(catalog.list('agent-service-notification').some(row=>row.provider===provider&&row.threadId===threadId))return null;
  const value=agents.readSavedHistoryPage?.(provider,threadId,before,pageSize);
  if(!value)return null;
  const turns=stableHistoryTurns(value.turns),older=value.hasEarlier?cursorFor(owner,'local',turns[0]?.id):null;
  return present(owner,turns,older,!before,agents.historySession(provider,threadId));
 }
 function nativeDisplay(owner,value,previous){
  const {provider,threadId}=owner,live=agents.historySession(provider,threadId);
  const merged=value.turns.map(turn=>turn.id===live?.turn?.id?{...turn,...live.turn,items:[...new Map([...turn.items,...live.turn.items].map(item=>[item.id,item])).values()]}:turn);
  const turns=serviceHistory(catalog,provider,threadId,merged,{appendUnmatched:false});
  return present(owner,turns,cursorFor(owner,'native',value.cursor),!previous,live);
 }
 async function page(value){
  if(!recordShape(value,['conversationId','before']))throw Error('Invalid history page request');
  const owner=conversation(value.conversationId),cursor=readCursor(owner,value.before);
  if(cursor.kind!=='local')return mode(owner,async()=>nativeDisplay(owner,await nativePage(owner,cursor.value),cursor.value),async()=>{
   if(cursor.kind==='native')throw Error('History changed; reopen the latest page');
   const saved=savedPage(owner);
   if(saved)return saved;
   const turns=await localTurns(owner);
   return localPage(owner,turns,turns.length,true);
  });
  const saved=savedPage(owner,cursor.value);
  if(saved)return saved;
  const turns=await localTurns(owner),end=turns.findIndex(turn=>turn.id===cursor.value);
  if(end<0)throw Error('History changed; reopen the latest page');
  return localPage(owner,turns,end,false);
 }
 async function nativeFind(owner,turnId,itemsView='summary'){
  let cursor,atLatest=true;
  do{
   const value=await nativePage(owner,cursor,itemsView);
   if(value.turns.some(turn=>turn.id===turnId))return {...value,atLatest};
   if(value.cursor&&value.cursor===cursor)throw Error('Invalid provider history cursor');
   cursor=value.cursor;atLatest=false;
  }while(cursor);
  return null;
 }
 function liveTurn(owner,turnId){const turn=agents.historySession(owner.provider,owner.threadId)?.turn;return turn?.id===turnId?stableHistoryTurns([turn])[0]:null;}
 async function locate(value){
  const anchor=anchorRequest(value),owner=conversation(anchor.conversationId),live=liveTurn(owner,anchor.turnId);
  if(live?.items.some(item=>!anchor.itemId||item.id===anchor.itemId))return page({conversationId:owner.id});
  return mode(owner,async()=>{
   const found=await nativeFind(owner,anchor.turnId);
   if(!found)throw Error('This history location is no longer available');
   return nativeDisplay(owner,found,!found.atLatest);
  },async()=>{
   const turns=await localTurns(owner),index=turns.findIndex(turn=>turn.id===anchor.turnId);
   if(index<0)throw Error('This history location is no longer available');
   const end=Math.min(turns.length,Math.max(index+16,pageSize));
   return localPage(owner,turns,end,end===turns.length);
  });
 }
 async function nativeItems(owner,turnId,onItem,{limit=25,sortDirection='asc'}={}){
  let cursor;
  do{
   const result=await nativeList('thread/items/list',{threadId:owner.threadId,...turnId?{turnId}:{},limit,sortDirection,...cursor?{cursor}:{}});
   const {response}=result;limit=result.limit;
   if(!Array.isArray(response?.data)||response.data.length>limit||response.data.some(entry=>!exactId(entry.turnId)||turnId&&entry.turnId!==turnId||!entry.item))throw Error('Invalid provider history items');
   assertUnchanged(owner);
   for(const entry of response.data)if(onItem(entry)===false)return true;
   if(response.nextCursor&&(typeof response.nextCursor!=='string'||response.nextCursor===cursor))throw Error('Invalid provider item cursor');
   cursor=response.nextCursor;
  }while(cursor);
  return false;
 }
 async function confirmDelivery({threadId},clientId){
  const owner=conversation('codex:'+threadId);
  const matches=item=>item?.type==='userMessage'&&(item.clientId===clientId||item.clientUserMessageId===clientId||item.id===clientId);
  const terminal=turn=>['completed','failed','interrupted'].includes(turn?.status);
  if(nativeEnabled(owner))try{
   let turnId;
   // A native user item can echo a full turn's image budget. Fetch at most
   // one item per frame, then verify its turn status without loading items.
   await nativeItems(owner,null,entry=>{
    if(!matches(entry.item))return;
    turnId=entry.turnId;
    return false;
   },{limit:1,sortDirection:'desc'});
   if(!turnId)return null;
   const found=await nativeFind(owner,turnId,'notLoaded');
   return terminal(found?.turns.find(turn=>turn.id===turnId))?turnId:null;
  }catch(error){if(!unsupported(error))throw error;}
  const found=(await localTurns(owner)).find(turn=>!turn.id.startsWith('legacy-turn:')&&terminal(turn)&&turn.items.some(matches));
  return found?.id??null;
 }
 async function exactTurn(owner,turnId,{full=false}={}){
  const live=liveTurn(owner,turnId);
  if(live?.status==='inProgress')return live;
  return mode(owner,async()=>{
   const found=await nativeFind(owner,turnId,full?'full':'summary');
   return found?.turns.find(turn=>turn.id===turnId)||live;
  },async()=> (await localTurns(owner)).find(turn=>turn.id===turnId)||live);
 }
 async function detail(value){
  const anchor=anchorRequest(value),owner=conversation(anchor.conversationId);
  if(!anchor.itemId)throw Error('Choose a tool history entry');
  let item=liveTurn(owner,anchor.turnId)?.items.find(item=>item.id===anchor.itemId);
  if(!item&&nativeEnabled(owner)){
   try{await nativeItems(owner,anchor.turnId,entry=>{if(entry.item.id!==anchor.itemId)return;item=entry.item;return false;});}catch(error){if(!unsupported(error))throw error;}
  }
  if(!item)item=(await exactTurn(owner,anchor.turnId,{full:true}))?.items.find(item=>item.id===anchor.itemId);
  if(!visibleTool(item))throw Error('This tool entry is no longer available');
  assertUnchanged(owner);
  return sanitizeProtocolTranscript({turn:{id:anchor.turnId,items:[item]}}).turn.items[0];
 }
 async function freshIndex(owner){
  return mode(owner,async()=>{
   const all=[];
   try{await nativeItems(owner,null,({turnId,item})=>{all.push(...indexedRows([{id:turnId,items:[item]}]));});return all.reverse();}
   catch(error){if(!unsupported(error))throw error;return indexedRows(await localTurns(owner)).reverse();}
  },async()=>indexedRows(await localTurns(owner)).reverse());
 }
 function index(owner){
  const stamp=revisions.get(owner.id)||0,cached=indices.get(owner.id);
  if(cached?.stamp===stamp&&cached.projectId===owner.projectId)return cached.result;
  const result=freshIndex(owner).catch(error=>{if(indices.get(owner.id)?.result===result)indices.delete(owner.id);throw error;});
  indices.set(owner.id,{stamp,projectId:owner.projectId,result});
  return result;
 }
 async function search(value){
  if(!recordShape(value,['query','conversationId','projectId'])||typeof value.query!=='string'||value.query.length>250||value.projectId!=null&&!exactId(value.projectId)||value.conversationId!==undefined&&value.projectId!==undefined)throw Error('Invalid conversation search');
  const query=value.query.trim().toLowerCase();
  if(!query)return {matches:[],unavailable:0};
  if(value.conversationId===undefined&&!Object.hasOwn(value,'projectId'))throw Error('Choose a conversation or project');
  const scope=value.conversationId!==undefined?[conversation(value.conversationId)]:records.conversations().filter(chat=>(chat.projectId??null)===value.projectId);
  const matches=[];let unavailable=0;
  for(const owner of scope){
   if(matches.length>=maxMatches)break;
   try{
    const rows=await index(owner),current=assertUnchanged(owner);
    for(const row of rows){
     const index=row.folded.indexOf(query);if(index<0)continue;
     matches.push({conversationId:owner.id,turnId:row.turnId,itemId:row.itemId,name:current.name,snippet:snippet(row.text,index),archived:current.archived===true});
     if(matches.length>=maxMatches)break;
    }
   }catch{unavailable++;}
  }
  return {matches:matches.filter(match=>{try{const current=conversation(match.conversationId);return value.conversationId!==undefined||(current.projectId??null)===value.projectId;}catch{return false;}}),unavailable};
 }
 async function setBookmark(value){
  const anchor=anchorRequest(value,['bookmarked']),owner=conversation(anchor.conversationId);
  if(typeof value.bookmarked!=='boolean')throw Error('Invalid bookmark action');
  let itemText='';
  if(value.bookmarked){
   const turn=await exactTurn(owner,anchor.turnId),item=anchor.itemId?turn?.items.find(item=>item.id===anchor.itemId):turn?.items.find(item=>conversationText(item));
   if(!turn||anchor.itemId&&!item)throw Error('This history location is no longer available');
   itemText=snippet(conversationText(item)||toolReceiptText(item));
  }
  assertUnchanged(owner);
  const items=bookmarks(owner.id).filter(item=>rowKey(item)!==rowKey(anchor));
  if(value.bookmarked)items.push({...anchor,snippet:itemText});
  catalog.put(bookmarkKind,owner.id,{items});
  return items;
 }
 function archive(value){
  if(!recordShape(value,['id','archived'])||typeof value.archived!=='boolean')throw Error('Invalid archive action');
  const previous=conversation(value.id),next={...previous,archived:value.archived};
  catalog.put('conversation',next.id,next);
  records.publish({method:'studio/conversationUpdated',provider:next.provider,params:{conversation:next,organizationOnly:true}});
  return next;
 }
 function preview(owner,anchor,turn){
  const items=anchor.itemId?turn.items.filter(item=>item.id===anchor.itemId):turn.items;
  const excerpt=clip(items.filter(item=>['userMessage','agentMessage'].includes(item.type)).map(item=>conversationText(item)).filter(text=>text.trim()).join('\n\n'),8000);
  if(!excerpt)throw Error('Select a user message or reply with text');
  return {source:{...anchor,name:owner.name,kind:'excerpt'},excerpt,revision:sha(JSON.stringify([anchor,excerpt]))};
 }
 async function branch(value){
  const anchor=anchorRequest(value,['revision']),owner=conversation(anchor.conversationId);
  if(value.revision!==undefined&&(typeof value.revision!=='string'||!/^[a-f0-9]{64}$/.test(value.revision)))throw Error('Invalid excerpt approval');
  const key=JSON.stringify([owner.id,rowKey(anchor)]);
  if(forks.has(key))return forks.get(key);
  const work=(async()=>{
   const turn=await exactTurn(owner,anchor.turnId);
   if(!turn||anchor.itemId&&!turn.items.some(item=>item.id===anchor.itemId))throw Error('This history location is no longer available');
   if(turn.status==='inProgress')throw Error('Wait until this reply reaches a terminal state');
   let thread,excerpt,kind='fork';
   if(value.revision===undefined&&nativeEnabled(owner)&&!turn.id.startsWith('legacy-turn:')){
    try{
     const result=await nativeRequest('thread/fork',{threadId:owner.threadId,lastTurnId:turn.id,excludeTurns:true});
     thread=result?.thread;
     if(!exactId(thread?.id)||thread.id===owner.threadId||thread.forkedFromId!==owner.threadId)throw Error('Provider returned an invalid fork identity');
    }catch(error){if(!unsupported(error))throw error;}
    if(thread){
     const boundary=await nativeRequest('thread/turns/list',{threadId:thread.id,limit:1,sortDirection:'desc',itemsView:'notLoaded'});
     if(boundary?.data?.length!==1||boundary.data[0].id!==turn.id)throw Error('The provider did not verify the selected fork boundary');
    }
   }
   if(!thread){
    const selection=preview(owner,anchor,turn);
    if(value.revision!==selection.revision)return {preview:selection};
    kind='excerpt';excerpt=selection.excerpt;
    assertUnchanged(owner);
    thread=await agents.startPlainDiscussion(owner.provider);
   }
   const parent=assertUnchanged(owner),threadId=thread?.id;
   if(!exactId(threadId)||threadId===owner.threadId||thread.provider&&thread.provider!==owner.provider||records.conversation(owner.provider,threadId)||records.deleted(owner.provider,threadId))throw Error('Provider did not create a new conversation');
   const created={id:owner.provider+':'+threadId,provider:owner.provider,threadId,name:clip(parent.name,72)+' · '+(kind==='fork'?'分支':'讨论'),titleVersion:1,titleSource:'manual',projectId:null,taskId:null,groupId:null,updatedAt:Date.now(),source:{...anchor,name:parent.name,kind}};
   const draft=excerpt?'[Reference excerpt from '+parent.name+']\n'+excerpt.split('\n').map(line=>'> '+line).join('\n')+'\n\n':undefined;
   catalog.put('conversation',created.id,created);
   if(kind==='fork')catalog.put('agent-thread',created.id,{id:threadId,provider:'codex',name:created.name});
   records.publish({method:'studio/conversationUpdated',provider:owner.provider,params:{conversation:created}});
   return {conversation:created,...draft?{draft}:{}};
  })();
  forks.set(key,work);
  try{return await work;}finally{forks.delete(key);}
 }
 return {page,locate,detail,search,archive,setBookmark,branch,observe,forget,confirmDelivery};
}
