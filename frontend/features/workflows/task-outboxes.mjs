/** A remount shares the same pending write. A confirmed deletion fences late acknowledgements. */
export function taskOutboxes(Outbox){
 const stores=new WeakMap();
 function lookup(id,storage,restore){
  let tasks=stores.get(storage);
  if(!tasks){tasks=new Map();stores.set(storage,tasks);}
  if(!tasks.has(id))tasks.set(id,new Outbox(id,storage,restore));
  return tasks.get(id);
 }
 return {
  get:(id,storage)=>lookup(id,storage,true),
  remove:(id,storage)=>lookup(id,storage,false).invalidate(),
 };
}
