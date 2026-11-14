const prefix='studio.reading.v1.';
export function readingKey(provider,threadId){return threadId?JSON.stringify([provider,threadId]):null;}
export function createReadingPositions(storage){
 const values=new Map();
 function read(key){if(!key)return null;if(values.has(key))return values.get(key);try{const value=JSON.parse(storage().getItem(prefix+key)||'null');if(value&&Number.isFinite(value.top)&&typeof value.follow==='boolean'){values.set(key,value);return value;}}catch{}return null;}
 function save(key,node,follow){
  if(!key||!node)return null;
  const top=Math.max(0,node.scrollTop),bounds=node.getBoundingClientRect?.(),items=node.querySelectorAll?.('[data-message-id]')||[];
  let anchor=null,offset=0;for(const item of items){const rect=item.getBoundingClientRect();if(rect.bottom>(bounds?.top??0)){anchor=item.dataset.messageId;offset=rect.top-(bounds?.top??0);break;}}
  const value={top,follow,anchor,offset};values.set(key,value);try{storage().setItem(prefix+key,JSON.stringify(value));}catch{}return value;
 }
 function restore(key,node){
  const value=read(key);if(!node)return value?.follow??true;
  let top=node.scrollHeight;if(value&&!value.follow){top=value.top;const anchor=[...(node.querySelectorAll?.('[data-message-id]')||[])].find(item=>item.dataset.messageId===value.anchor);if(anchor&&node.getBoundingClientRect)top=node.scrollTop+anchor.getBoundingClientRect().top-node.getBoundingClientRect().top-value.offset;}
  if(Math.abs(node.scrollTop-top)>.5){if(node.scrollTo)node.scrollTo({top,behavior:'auto'});else node.scrollTop=top;}
  return value?.follow??true;
 }
 function discard(key){values.delete(key);try{storage().removeItem(prefix+key);}catch{}}
 return {read,save,restore,discard};
}
