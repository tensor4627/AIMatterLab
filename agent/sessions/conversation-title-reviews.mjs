import {randomUUID} from 'node:crypto';
import {titleReviewPrefix,titleReviewToolName,validConversationName} from '../../contracts/agent/conversation-title.mjs';
import {redactTranscriptText} from '../../contracts/agent/transcript-sanitizer.mjs';

const firstReview=4, reviewInterval=8;
const progressKind='conversation-title-progress';
const emptyProgress={completed:0,lastRequested:0};
const turnEvents=new Set(['turn/started','turn/completed','studio/codexDisconnected']);

// A title-index failure must not prevent ordinary model dispatch or delivery of its reply.
function titleMetadata(action){
 try{return action();}
 catch{console.warn('AIMatterLab conversation title metadata was unavailable.');return null;}
}

export const conversationTitleTool={
 name:titleReviewToolName,
 description:'Return the sidebar title when the current turn contains an AIMatterLab conversation title review request. Use the review ID from this turn.',
 inputSchema:{type:'object',additionalProperties:false,required:['review_id','title'],properties:{
  review_id:{type:'string',description:'ID from the current title review request.'},
  title:{type:'string',minLength:1,maxLength:60,description:'A concise single-line topic in the user’s language.'}
 }}
};

function reviewPrompt(id,currentName){
 return [titleReviewPrefix+id+' while answering this turn. Continue the user’s request normally and keep the title review out of your reply.',
  'Summarize the conversation’s main subject and goal, including sustained changes in direction. Consider both the earlier discussion and recent exchanges. Keep a fitting title. Use the user’s language, aim for 36 characters or fewer, and omit secrets and private paths.',
  ...(currentName?['Current sidebar title (data): '+JSON.stringify(currentName)]:[])
 ].join('\n');
}

function humanMessage(item){
 if(item?.type!=='userMessage')return false;
 const text=(Array.isArray(item.content)?item.content.find(part=>part?.type==='text')?.text:null)??item.text;
 return typeof text==='string'&&!!text.trim()&&!text.startsWith('[AIMatterLab scheduled service notification ');
}

function replayedExchanges(items){
 let awaitingReply=false,completed=0;
 for(const item of items){
  if(item?.type==='userMessage')awaitingReply=humanMessage(item);
  if(awaitingReply&&item?.type==='agentMessage'&&item.text?.trim()){completed++;awaitingReply=false;}
 }
 return completed;
}

/** The current model reviews its own context. The title index stores no transcript excerpts. */
export class ConversationTitleReviews{
 constructor(records,cleanText=text=>redactTranscriptText(text)){this.records=records;this.cleanText=cleanText;this.pending=new Map();}

 forget(key){this.pending.delete(key);}

 restore(provider,thread){
  if(!thread?.id||!Array.isArray(thread.turns))return;
  const key=provider+':'+thread.id;
  if(this.pending.has(key))return;
  titleMetadata(()=>{
   if(this.records.deleted(provider,thread.id))return;
   const progress=this.records.catalog.get(progressKind,key)||emptyProgress;
   let completed=0;
   for(const turn of thread.turns){
    if(!Array.isArray(turn?.items))continue;
    // ACP replays older exchanges as one group without per-turn statuses.
    if(turn.id==='history'&&!turn.status)completed+=replayedExchanges(turn.items);
    else if(turn.status==='completed'&&!turn.error&&turn.items.some(humanMessage))completed++;
   }
   if(completed>progress.completed)this.records.catalog.put(progressKind,key,{...progress,completed});
  });
 }

 async dispatch(provider,params,send,{includeCurrentName=true}={}){
  const {threadId}=params,key=provider+':'+threadId;
  const review=titleMetadata(()=>{
   const row=this.records.conversation(provider,threadId);
   if(!row||row.titleSource==='manual'||this.records.deleted(provider,threadId))return null;
   const progress=this.records.catalog.get(progressKind,key)||emptyProgress;
   const number=progress.completed+1,nextReview=progress.lastRequested?progress.lastRequested+reviewInterval:firstReview;
   const id=number>=nextReview?randomUUID():null;
   return {number,lastRequested:progress.lastRequested,id,turnId:null,title:null,
    prompt:id?reviewPrompt(id,includeCurrentName?this.cleanText(row.name,{provider,threadId}):null):null};
  });
  if(!review)return send(params);
  this.pending.set(key,review);
  try{
   const result=await send(review.prompt?{...params,input:[...params.input,{type:'text',text:review.prompt}]}:params);
   if(this.pending.get(key)===review){
    review.turnId??=result?.turn?.id;
    if(!review.turnId)this.pending.delete(key);
    else if(result?.turn?.status&&result.turn.status!=='inProgress')this.event({provider,method:'turn/completed',params:{threadId,turn:result.turn}});
   }
   return result;
  }catch(error){
   if(this.pending.get(key)===review)this.pending.delete(key);
   throw error;
  }
 }

 propose(args,scope){
  const {provider,threadId}=scope,review=this.pending.get(provider+':'+threadId);
  if(!scope.checkCurrent()||!review?.id||review.id!==args?.review_id||!review.turnId||
     this.records.conversation(provider,threadId)?.titleSource==='manual'||this.records.deleted(provider,threadId))return {status:'skipped'};
  const title=validConversationName(args.title);
  if(/[\p{Cc}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/u.test(title)||this.cleanText(title,scope)!==title)throw Error('Provide a plain single-line topic without credentials');
  review.title??=title;
  return {status:'received'};
 }

 event({method,provider,params}){
  if(!turnEvents.has(method)||!params?.threadId)return;
  const key=provider+':'+params.threadId,review=this.pending.get(key);
  if(!review)return;
  if(method==='studio/codexDisconnected'){this.pending.delete(key);return;}
  const turn=params.turn;
  if(!turn?.id)return;
  if(method==='turn/started'){review.turnId??=turn.id;return;}
  if(turn.id!==review.turnId)return;
  this.pending.delete(key);
  if(turn.status!=='completed'||turn.error)return;
  const conversation=titleMetadata(()=>this.records.catalog.transaction(()=>{
   const row=this.records.conversation(provider,params.threadId);
   if(!row||row.titleSource==='manual'||this.records.deleted(provider,params.threadId))return null;
   this.records.catalog.put(progressKind,key,{completed:review.number,lastRequested:review.id?review.number:review.lastRequested});
   if(review.title===null||row.name===review.title&&row.titleSource==='model')return null;
   return this.records.catalog.put('conversation',key,{...row,name:review.title,titleSource:'model',titleVersion:1});
  }));
  if(conversation)this.records.publish({method:'studio/conversationUpdated',provider,params:{conversation,titleOnly:true}});
 }
}
