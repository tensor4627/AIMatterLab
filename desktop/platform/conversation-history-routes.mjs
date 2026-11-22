import {createConversationHistory} from '../../agent/sessions/conversation-history.mjs';

/** Owned transport: reads and explicit forks have no model dispatch or worker lease. */
export function registerConversationHistory({handle,catalog,records,agents,createCodex,restoreTitle}){
 let bridge,executable;
 async function nativeRequest(method,params){
  const selected=agents.path('codex');
  if(!bridge||selected!==executable){
   bridge?.close();bridge=createCodex();executable=selected;
  }
  const current=bridge;
  await current.start(selected,null,{}, {historyOnly:true});
  const assertCurrent=()=>{if(current!==bridge||agents.path('codex')!==selected)throw Error('Codex history connection changed');};
  assertCurrent();
  return current.request(method,params,20000,{assertCurrent});
 }
 const history=createConversationHistory({catalog,records,agents,nativeRequest,restoreTitle});
 handle('conversation.history.page',history.page);
 handle('conversation.history.locate',history.locate);
 handle('conversation.history.detail',history.detail);
 handle('conversation.history.search',history.search);
 handle('conversation.history.bookmark',history.setBookmark);
 handle('conversation.history.archive',history.archive);
 handle('conversation.history.branch',history.branch);
 return {...history,close(){const current=bridge;bridge=null;current?.close();}};
}
