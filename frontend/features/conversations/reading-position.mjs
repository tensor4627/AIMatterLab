function collapsedSummary(item){const closed=item.closest?.('details:not([open])');const summary=closed?.querySelector('summary');return summary&&!summary.contains(item)?summary:null;}
const prefix='studio.reading.v1.';
export function readingKey(provider,threadId){return threadId?JSON.stringify([provider,threadId]):null;}
export function createReadingPositions(storage){
 const values=new Map();
 function read(key){if(!key)return null;if(values.has(key))return values.get(key);try{const value=JSON.parse(storage().getItem(prefix+key)||'null');if(value&&Number.isFinite(value.top)&&typeof value.follow==='boolean'){values.set(key,value);return value;}}catch{}return null;}
 function save(key,node,follow){
  if(!key||!node)return null;
  const top=Math.max(0,node.scrollTop);
  let anchor=null,turnId=null,offset=0;
  if(!follow){
   const bounds=node.getBoundingClientRect?.(),items=node.querySelectorAll?.('[data-message-id]')||[];
   for(const item of items){if(collapsedSummary(item)||item.getClientRects&&!item.getClientRects().length)continue;const rect=item.getBoundingClientRect();if(rect.bottom>(bounds?.top??0)){anchor=item.dataset.messageId;turnId=item.dataset.turnId||null;offset=rect.top-(bounds?.top??0);break;}}
  }
  const previous=values.get(key);
  const value={top,follow,anchor,turnId,offset};
  values.set(key,value);
  const skipPersist=follow&&previous?.follow===true||!follow&&previous&&!previous.follow&&previous.top===top&&previous.anchor===anchor&&previous.turnId===turnId&&previous.offset===offset;
  if(!skipPersist){try{storage().setItem(prefix+key,JSON.stringify(value));}catch{}}
  return value;
 }
 function restore(key,node){
  const value=read(key);if(!node)return value?.follow??true;
  let top=node.scrollHeight;if(value&&!value.follow){top=value.top;const anchor=[...(node.querySelectorAll?.('[data-message-id]')||[])].find(item=>item.dataset.messageId===value.anchor&&(!value.turnId||value.turnId===item.dataset.turnId));if(anchor&&node.getBoundingClientRect){const visible=collapsedSummary(anchor)||anchor;if(visible)top=node.scrollTop+visible.getBoundingClientRect().top-node.getBoundingClientRect().top-value.offset;}}
  if(Math.abs(node.scrollTop-top)>.5){if(node.scrollTo)node.scrollTo({top,behavior:'auto'});else node.scrollTop=top;}
  return value?.follow??true;
 }
 function discard(key){values.delete(key);try{storage().removeItem(prefix+key);}catch{}}
 return {read,save,restore,discard};
}
