const legacyKey = 'studio.follow-up-queues.v1';
const admissionKey = key => 'studio.follow-up-admission.v1.' + key;

export function followUpKey(provider, threadId) {
 return JSON.stringify([provider, threadId]);
}

export function readQueueAdmission(storage, key, draft) {
 try {
  const saved = JSON.parse(storage().getItem(admissionKey(key)));
  return saved?.draft === draft && typeof saved.id === 'string' ? saved.id : null;
 } catch { return null; }
}

export function rememberQueueAdmission(storage, key, id, draft) {
 try { storage().setItem(admissionKey(key), JSON.stringify({id, draft})); } catch { /* The live draft still retains its text. */ }
}

export function forgetQueueAdmission(storage, key, id) {
 try {
  if (id === undefined || JSON.parse(storage().getItem(admissionKey(key)))?.id === id) storage().removeItem(admissionKey(key));
 } catch { /* The main store still remembers this admission. */ }
}

function read(storage) {
 try {
  const saved = JSON.parse(storage().getItem(legacyKey));
  return saved?.version === 1 && Array.isArray(saved.queues) ? saved.queues : [];
 } catch { return []; }
}

/** The old renderer store can only import messages as paused. Clear it after the main catalog acknowledges them. */
export function readLegacyFollowUps(storage, provider, threadId) {
 const saved = read(storage).find(row => row?.provider === provider && row.threadId === threadId);
 if (!Array.isArray(saved?.items)) return [];
 return saved.items.flatMap(item => {
  if (!item || typeof item.id !== 'string' || typeof item.text !== 'string' || !item.text.trim()) return [];
  const {id, text, context, planningMode, newWorkflow, attachment, unconfirmed, preparedTaskId} = item;
  const skill = typeof attachment?.name === 'string' && (typeof attachment.functionId === 'string'
   ? {name: attachment.name, functionId: attachment.functionId}
   : typeof attachment.path === 'string' && {name: attachment.name, path: attachment.path});
  return [{id, text, context: typeof context === 'string' ? context : '', planningMode: planningMode === true, newWorkflow: newWorkflow === true,
   ...(skill ? {skill} : {}), ...(unconfirmed === true ? {unconfirmed} : {}), ...(typeof preparedTaskId === 'string' ? {preparedTaskId} : {})}];
 });
}

export function forgetLegacyFollowUps(storage, provider, threadId) {
 const queues = read(storage).filter(row => row?.provider !== provider || row.threadId !== threadId);
 try {
  if (queues.length) storage().setItem(legacyKey, JSON.stringify({version: 1, queues}));
  else storage().removeItem(legacyKey);
 } catch { /* The durable admission IDs make a later import idempotent. */ }
}
