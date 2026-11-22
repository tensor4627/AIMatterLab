const emptyQueue = Object.freeze({items: [], after: null, pending: null, pause: null});
const storageKey = 'studio.follow-up-queues.v1';
const providers = new Set(['codex', 'kimi', 'deepseek', 'qwen', 'compatible']);

export function followUpKey(provider, threadId) {
 return JSON.stringify([provider, threadId]);
}

function storedItem(value) {
 if (!value || typeof value.id !== 'string' || typeof value.text !== 'string' || !value.text.trim() ||
  typeof value.route !== 'string' || typeof value.context !== 'string' || typeof value.planningMode !== 'boolean' || typeof value.newWorkflow !== 'boolean') return null;
 const {id, text, route, context, planningMode, newWorkflow, preparedTaskId, unconfirmed, attachment} = value;
 const item = {id, text, route, context, planningMode, newWorkflow};
 if (typeof preparedTaskId === 'string' && preparedTaskId) item.preparedTaskId = preparedTaskId;
 if (unconfirmed === true) item.unconfirmed = true;
 if (typeof attachment?.attachmentId === 'string' && typeof attachment.name === 'string') {
  const {attachmentId, name, path, functionId} = attachment;
  if (typeof path === 'string' && path && functionId === undefined) item.attachment = {attachmentId, name, path};
  if (typeof functionId === 'string' && functionId && path === undefined) item.attachment = {attachmentId, name, functionId};
 }
 return item;
}

function loadQueues(storage) {
 const queues = new Map();
 let snapshot;
 try { snapshot = JSON.parse(storage().getItem(storageKey)); } catch { return queues; }
 if (snapshot?.version !== 1 || !Array.isArray(snapshot.queues)) return queues;
 for (const saved of snapshot.queues) {
  if (!saved || !providers.has(saved.provider) || typeof saved.threadId !== 'string' || !saved.threadId || !Array.isArray(saved.items)) continue;
  const key = followUpKey(saved.provider, saved.threadId);
  const items = saved.items.map(storedItem).filter(Boolean);
  if (!items.length) continue;
  queues.set(key, {key, items, after: null, pending: null, pause: items.some(item => item.unconfirmed) ? 'unconfirmed' : 'restored'});
 }
 return queues;
}

/** Only a matching terminal receipt or an explicit resume advances a queue. */
export function createFollowUpQueues(storage) {
 const queues = loadQueues(storage);
 const operations = new Map();
 const receipts = new Map();

 function persist() {
  const snapshot = [...queues.values()].map(queue => {
   const [provider, threadId] = JSON.parse(queue.key);
   const items = queue.items.map(item => {
    const operation = operations.get(item.id);
    return operation ? {...item, unconfirmed: operation.attempted, preparedTaskId: operation.preparedTaskId} : item;
   });
   return {provider, threadId, items};
  });
  try {
   if (snapshot.length) storage().setItem(storageKey, JSON.stringify({version: 1, queues: snapshot}));
   else storage().removeItem(storageKey);
  } catch { /* Keep queues usable when renderer storage is unavailable. */ }
 }

 function read(key) {
  return queues.get(key) ?? emptyQueue;
 }

 function follow(queue, turnId) {
  const receipt = receipts.get(queue.key)?.get(turnId);
  queue.after = receipt === undefined ? turnId : null;
  if (receipt === false) queue.pause ??= 'previous';
 }

 function enqueue(key, turnId, item) {
  let queue = queues.get(key);
  if (!queue) {
   queue = {key, items: [], after: null, pending: null, pause: null};
   follow(queue, turnId);
   queues.set(key, queue);
  }
  queue.items = [...queue.items, item];
  persist();
 }

 function settle(key, turnId, completed) {
  let turns = receipts.get(key);
  if (!turns) receipts.set(key, turns = new Map());
  if (turns.has(turnId)) return false;
  turns.set(turnId, completed);
  if (turns.size > 8) turns.delete(turns.keys().next().value);
  const queue = queues.get(key);
  if (queue?.after !== turnId) return false;
  follow(queue, turnId);
  return true;
 }

 function hasSettled(key, turnId) {
  return receipts.get(key)?.has(turnId) === true;
 }

 function pause(key, reason) {
  const queue = queues.get(key);
  if (!queue || queue.pause === reason || queue.pause === 'unconfirmed') return false;
  queue.pause = reason;
  return true;
 }

 function pauseProvider(provider, reason) {
  let changed = false;
  for (const key of queues.keys()) {
   if (JSON.parse(key)[0] === provider && pause(key, reason)) changed = true;
  }
  return changed;
 }

 function resume(key) {
  const queue = queues.get(key);
  if (!queue?.pause || queue.pending || queue.items.some(item => item.unconfirmed)) return false;
  queue.after = null;
  queue.pause = null;
  return true;
 }

 function begin(key, itemId, mode) {
  const queue = queues.get(key);
  const item = queue?.items.find(entry => entry.id === itemId);
  if (!item || item.unconfirmed || queue.pending || operations.has(itemId)) return false;
  if (mode === 'next' && (queue.pause || queue.after || item !== queue.items[0])) return false;
  queue.pending = itemId;
  operations.set(itemId, {queue, mode, attempted: false, preparedTaskId: item.preparedTaskId});
  return true;
 }

 function markAttempt(itemId, attempted, preparedTaskId) {
  const operation = operations.get(itemId);
  if (!operation) return;
  operation.attempted = attempted;
  if (preparedTaskId !== undefined) operation.preparedTaskId = preparedTaskId;
  persist();
 }

 function remove(key, itemId) {
  const queue = queues.get(key);
  if (!queue || operations.has(itemId) || !queue.items.some(item => item.id === itemId)) return false;
  queue.items = queue.items.filter(item => item.id !== itemId);
  if (!queue.items.length) queues.delete(key);
  persist();
  return true;
 }

 function finish(itemId, turnId) {
  const operation = operations.get(itemId);
  if (!operation) return false;
  operations.delete(itemId);
  const {queue, mode, attempted, preparedTaskId} = operation;
  if (queue.pending === itemId) queue.pending = null;
  if (queues.get(queue.key) !== queue) return false;
  if (turnId) {
   remove(queue.key, itemId);
   if (mode === 'next') follow(queue, turnId);
  } else {
   if (attempted || preparedTaskId) queue.items = queue.items.map(item => item.id === itemId ? {...item, unconfirmed: attempted, preparedTaskId} : item);
   if (attempted) queue.pause = 'unconfirmed';
   else queue.pause ??= 'blocked';
   persist();
  }
  return true;
 }

 function discard(key) {
  receipts.delete(key);
  if (!queues.delete(key)) return false;
  persist();
  return true;
 }

 function rekey(oldKey, key) {
  if (oldKey === key) return false;
  const previous = queues.get(oldKey);
  if (!previous) return false;
  const existing = queues.get(key);
  queues.delete(oldKey);
  const queue = existing ?? previous;
  if (existing) {
   existing.items = [...previous.items, ...existing.items];
   existing.pending ??= previous.pending;
   if (previous.pending) {
    const operation = operations.get(previous.pending);
    if (operation) operation.queue = existing;
   }
  }
  queue.key = key;
  queue.pause = 'changed';
  queues.set(key, queue);
  persist();
  return true;
 }

 return {read, enqueue, settle, hasSettled, pause, pauseProvider, resume, begin, markAttempt, remove, finish, discard, rekey};
}
