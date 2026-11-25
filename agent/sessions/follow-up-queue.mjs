import {AsyncLocalStorage} from 'node:async_hooks';
import {isDeepStrictEqual as equal} from 'node:util';
import {providerId} from '../providers/contracts.mjs';
import {attachmentPrompt,attachmentsAfterReplacement} from '../../contracts/agent/chat-attachments.mjs';

const namespace = 'agent-follow-up-queue';
const ownerKey = (provider, threadId) => provider + ':' + threadId;
const identifier = value => typeof value === 'string' && !!value && value.length <= 200 && !/[\x00-\x1f]/.test(value);
const messageId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const text = (value, limit) => typeof value === 'string' && value.length <= limit;
const userText = (value,files) => text(value, 100000) && (!!value.trim()||!!files?.length);
const editable = item => item?.status === 'queued';
const activeItem = item => ['preparing', 'submitting'].includes(item.status);

function checkFields(value, allowed) {
 if (!value || typeof value !== 'object' || Array.isArray(value) ||
     Object.keys(value).some(key => !allowed.includes(key))) throw Error('Invalid follow-up request');
}

function intent(value, {migration = false, validateFiles, owner}) {
 checkFields(value, ['id', 'text', 'context', 'planningMode', 'newWorkflow', 'model', 'effort', 'skill', 'files',
  ...(migration ? ['unconfirmed', 'preparedTaskId'] : [])]);
 if (!messageId(value.id) || !text(value.text, 100000) || !text(value.context ?? '', 256000) ||
     typeof value.planningMode !== 'boolean' || typeof value.newWorkflow !== 'boolean' ||
     value.model !== undefined && (!text(value.model, 200) || !value.model) ||
     value.effort !== undefined && !text(value.effort, 64) ||
     migration && value.preparedTaskId !== undefined && !identifier(value.preparedTaskId) ||
     migration && value.unconfirmed !== undefined && typeof value.unconfirmed !== 'boolean') throw Error('Invalid queued message');
 if (value.skill !== undefined) {
  checkFields(value.skill, ['name', 'functionId', 'path']);
  const {name, functionId, path} = value.skill;
  if (!text(name, 500) || !name ||
      !(text(functionId, 200) && functionId && path === undefined || text(path, 4096) && path && functionId === undefined)) throw Error('Invalid queued skill');
 }
 const files = value.files === undefined ? undefined : validateFiles(owner, value.files);
 if (!userText(value.text,files)) throw Error('Invalid queued message');
 return {...value, context: value.context ?? '', ...(files ? {files} : {})};
}

function initial(provider, threadId) {
 return {version: 1, provider, threadId, revision: 0, ids: [], items: [], after: null, pause: null};
}

function view(record) {
 return {
  provider: record.provider,
  threadId: record.threadId,
  revision: record.revision,
  after: record.after,
  pause: record.pause,
  items: record.items.map(({id, text, skill, files, attachmentReview, newWorkflow, preparedTaskId, status}) => ({
   id, text, ...(skill ? {skillName: skill.name} : {}), ...(files?.length ? {files} : {}),
   ...(attachmentReview ? {attachmentReview} : {}),
   status, steerable: !attachmentReview && !skill && !files?.length && !newWorkflow && !preparedTaskId
  }))
 };
}

/** Durable admission and dispatch are main-owned. Provider calls never run under the foreground chat's scope. */
export function createFollowUpQueue({
 catalog, agents, capture, validateFiles = () => { throw Error('File attachments are unavailable'); },
 dispatch, interrupt, reconcile, publish = () => {}, defer = setImmediate
}) {
 const detached = AsyncLocalStorage.snapshot();
 const scheduled = new Set();
 const active = new Map();
 const completed = new Map();
 let stopping = false;

 function read(provider, threadId) {
  const record = catalog.get(namespace, ownerKey(provider, threadId));
  if (record && (record.version !== 1 || record.provider !== provider || record.threadId !== threadId ||
      !Array.isArray(record.items) || !Array.isArray(record.ids))) throw Error('Invalid stored follow-up record');
  return record ?? initial(provider, threadId);
 }

 function save(record) {
  record.revision++;
  catalog.put(namespace, ownerKey(record.provider, record.threadId), record);
  publish({method: 'studio/agentQueueChanged', provider: record.provider, params: view(record)});
 }

 function receipt(provider, threadId, turnId) {
  return completed.get(ownerKey(provider, threadId))?.get(turnId);
 }

 function follow(record, turnId) {
  const ended = receipt(record.provider, record.threadId, turnId);
  record.after = ended === undefined ? turnId : null;
  if (ended === false) record.pause ??= 'previous';
 }

 function kick(provider, threadId) {
  const key = ownerKey(provider, threadId);
  if (stopping || active.has(key) || scheduled.has(key)) return;
  scheduled.add(key);
  defer(() => detached(() => {
   scheduled.delete(key);
   void drain(provider, threadId).catch(() => {});
  }));
 }

 function pause(provider, threadId, reason = 'stopped') {
  const running = active.get(ownerKey(provider, threadId));
  if (running && !running.wire) running.cancelled = true;
  const record = read(provider, threadId);
  if (!record.items.length || record.pause === 'unconfirmed' || record.pause === reason) return;
  record.pause = reason;
  save(record);
 }

 function stopClaim(flight) {
  if (!flight.stop || !flight.turnId || flight.stopping || flight.mode === 'steer') return;
  flight.stopping = true;
  void interrupt(flight.owner, flight.turnId).catch(() => {
   flight.stopping = false;
   publish({method: 'studio/agentQueueStopUnconfirmed', provider: flight.owner.provider,
    params: {threadId: flight.owner.threadId, turnId: flight.turnId}});
  });
 }

 function replaceQueue(previous, threadId, uploadsRetained) {
  if (!previous.items.length) return false;
  const {provider} = previous, key = ownerKey(provider, threadId);
  const next = read(provider, threadId);
  if (next.ids.length) return false;
  // Even a verified replacement is a new transport. Recovered messages wait for the author.
  next.ids = previous.ids;
  next.items = previous.items.map(item => {
   const files = attachmentsAfterReplacement(item.files,uploadsRetained);
   const attachmentReview = item.attachmentReview || files.length < (item.files?.length ?? 0);
   return {...item, files, ...(attachmentReview ? {attachmentReview} : {}),
    status: ['submitting', 'unconfirmed'].includes(item.status) ? 'unconfirmed' : 'queued'};
  });
  next.pause = next.items.some(item => item.status === 'unconfirmed') ? 'unconfirmed' : 'changed';
  catalog.transaction(() => {
   catalog.put(namespace, key, {...next, revision: next.revision + 1});
   catalog.remove(namespace, ownerKey(provider, previous.threadId));
  });
  publish({method: 'studio/agentQueueChanged', provider, params: view(read(provider, threadId))});
  return true;
 }

 function savedReplacement(record) {
  const {provider,threadId} = record;
  if (provider !== 'codex') return null;
  const receipt = catalog.get('retired-conversation-context', ownerKey(provider, threadId));
  const nextId = receipt?.replacementThreadId;
  if (receipt?.provider !== provider || receipt.threadId !== threadId || !identifier(nextId) || nextId === threadId ||
      !['verified-empty-recovery', 'explicit-missing-history-recovery'].includes(receipt.reason)) return null;
  const key = ownerKey(provider,nextId);
  const next = catalog.get('conversation', key);
  if (next?.provider !== provider || next.threadId !== nextId || (next.projectId ?? null) !== receipt.projectId ||
      (next.taskId ?? null) !== receipt.taskId || catalog.get('deleted-conversation',key) || catalog.get('retired-conversation-context',key)) return null;
  return receipt;
 }

 function observe(event) {
  if (stopping) return;
  const {provider, method, params} = event;
  const threadId = params?.threadId;
  if (method === 'studio/accountUpdated' && params?.credentialsChanged) {
   for (const record of catalog.list(namespace)) if (record.provider === provider) pause(provider, record.threadId, 'changed');
   return;
  }
  if (!provider || !identifier(threadId)) return;
  const key = ownerKey(provider, threadId);
  if (method === 'studio/conversationDeleted') {
   const running = active.get(key);
   if (running) running.cancelled = true;
   scheduled.delete(key);
   catalog.remove(namespace, key);
   completed.delete(key);
   return;
  }
  if (method === 'studio/conversationContextChanged') {
   if (!identifier(params.oldThreadId) || params.oldThreadId === threadId) return;
   replaceQueue(read(provider, params.oldThreadId), threadId, params.uploadsRetained);
   return;
  }
  if (method === 'studio/codexDisconnected') { pause(provider, threadId, 'previous'); return; }
  const flight = active.get(key);
  if (method === 'turn/started' && identifier(params.turn?.id)) {
   if (flight?.wire && flight.mode === 'next') {
    flight.turnId = params.turn.id;
    stopClaim(flight);
   }
   const record = read(provider, threadId);
   if (record.items.length && !record.after && !flight && !record.pause) {
    record.after = params.turn.id;
    save(record);
   }
  }
  if (method === 'turn/completed' && identifier(params.turn?.id)) {
   const turn = params.turn;
   let turns = completed.get(key);
   if (!turns) completed.set(key, turns = new Map());
   if (!turns.has(turn.id)) turns.set(turn.id, turn.status === 'completed' && !turn.error);
   if (turns.size > 8) turns.delete(turns.keys().next().value);
   const record = read(provider, threadId);
   if (record.after === turn.id) {
    follow(record, turn.id);
    save(record);
   }
   if (!params.studioTurnBusy) kick(provider, threadId);
  }
  if (method === 'studio/agentTurnState' && params.busy === false) kick(provider, threadId);
 }

 function finish(flight, turnId) {
  const {provider, threadId} = flight.owner;
  const key = ownerKey(provider, threadId);
  active.delete(key);
  const record = read(provider, threadId);
  const item = record.items.find(item => item.id === flight.item.id);
  if (!item) return;
  if (turnId) {
   record.items = record.items.filter(item => item.id !== flight.item.id);
   if (flight.mode === 'next') follow(record, turnId);
   save(record);
   publish({method: 'studio/agentQueueDelivered', provider, params: {
    threadId, turnId, id: item.id, text: item.text.trim()?item.text:attachmentPrompt(item.files), ...(item.files?.length ? {files: item.files} : {}),
   }});
   kick(provider, threadId);
   return;
  }
  item.status = flight.attempted ? 'unconfirmed' : 'queued';
  if (flight.attempted) record.pause = 'unconfirmed';
  else record.pause ??= flight.scopeChanged ? 'changed' : 'blocked';
  save(record);
 }

 async function deliver(record, item, mode, targetTurnId) {
  const {provider, threadId} = record, key = ownerKey(provider, threadId);
  const owner = {provider, threadId};
  const flight = {owner, item, mode, turnId: targetTurnId, cancelled: false, attempted: false, wire: false};
  item.status = 'preparing';
  save(record);
  active.set(key, flight);
  const assertCurrent = () => {
   if (stopping || active.get(key) !== flight || flight.cancelled) throw Error('Queued send cancelled before dispatch');
   try {
    if (!equal(item.scope, capture(owner, item))) throw Error('original_queue_scope_changed');
   } catch (error) { flight.scopeChanged = true; throw error; }
  };
  const mark = (attempted, preparedTaskId) => {
   const latest = read(provider, threadId);
   const live = latest.items.find(entry => entry.id === item.id);
   if (!live) throw Error('Queued send no longer exists');
   if (preparedTaskId) live.preparedTaskId = item.preparedTaskId = preparedTaskId;
   flight.attempted = attempted;
   live.status = attempted ? 'submitting' : 'preparing';
   save(latest);
  };
  let accepted;
  try {
   assertCurrent();
   const result = await dispatch(owner, item, {
    mode, targetTurnId, assertCurrent,
    beforeTaskCreation: () => { assertCurrent(); mark(true); },
    taskPrepared: taskId => mark(false, taskId),
    beforeDispatch: () => { assertCurrent(); mark(true); flight.wire = true; },
    accepted: turnId => { if (identifier(turnId)) accepted = turnId; },
   });
   const turnId = mode === 'steer' ? result?.turnId : result?.turn?.id;
   if (result?.studioRecovery?.status === 'required') mark(false);
   if (identifier(turnId) && (mode === 'next' || turnId === targetTurnId)) accepted = turnId;
  } catch { /* Definite pre-dispatch failures stay queued. Ambiguous delivery stays visible for reconciliation. */ }
  if (stopping) return {queue: view(read(provider, threadId))};
  if (accepted && mode === 'next') {
   flight.turnId = accepted;
   stopClaim(flight);
  }
  finish(flight, accepted);
  return {queue: view(read(provider, threadId)), ...(accepted ? {turnId: accepted} : {})};
 }

 async function drain(provider, threadId) {
  const key = ownerKey(provider, threadId);
  if (stopping || active.has(key) || agents.isBusy(provider, threadId)) return;
  const record = read(provider, threadId), item = record.items[0];
  if (!editable(item) || record.after || record.pause) return;
  await deliver(record, item, 'next', null);
 }

 function recover() {
  for (const row of catalog.list(namespace)) {
   if (row.version !== 1 || !Array.isArray(row.items) || !row.items.length || !Array.isArray(row.ids)) continue;
   const replacement = savedReplacement(row);
   if (replacement && replaceQueue(row, replacement.replacementThreadId, replacement.uploadsRetained)) continue;
   for (const item of row.items) {
    if (item.status === 'submitting') item.status = 'unconfirmed';
    if (item.status === 'preparing') item.status = 'queued';
   }
   row.pause = row.items.some(item => item.status === 'unconfirmed') ? 'unconfirmed' : row.pause === 'changed' ? 'changed' : 'restored';
   row.after = null;
   save(row);
  }
 }

 async function request(value) {
  const {provider, threadId, action} = value ?? {};
  providerId(provider);
  if (!identifier(threadId)) throw Error('Invalid follow-up conversation');
  const owner = {provider, threadId}, key = ownerKey(provider, threadId);
  const record = read(provider, threadId);
  const find = id => {
   if (!messageId(id)) throw Error('Invalid queued message identity');
   return record.items.find(item => item.id === id);
  };
  const check = (...fields) => checkFields(value, ['provider', 'threadId', 'action', ...fields]);
  if (action === 'read') {
   check('pendingId');
   if (value.pendingId !== undefined && !messageId(value.pendingId)) throw Error('Invalid queued message identity');
   return {queue: view(record), ...(value.pendingId ? {admitted: record.ids.includes(value.pendingId)} : {})};
  }
  if (action === 'enqueue' || action === 'import') {
   check(...action === 'enqueue' ? ['item', 'after'] : ['items']);
   const migration = action === 'import';
   const raw = migration ? value.items : [value.item];
   if (!Array.isArray(raw) || !raw.length || raw.length > 512) throw Error('Invalid follow-up import');
   const next = raw.filter(item => !record.ids.includes(item?.id)).map(item => intent(item, {migration, validateFiles, owner}));
   if (!next.length) return {queue: view(record)};
   if (!migration) {
    const turn = agents.activeTurn(provider, threadId);
    if (value.after !== null && value.after !== turn && receipt(provider, threadId, value.after) === undefined)
     throw Error('The original reply changed before this message was queued');
    if (value.after === null && !record.items.length) throw Error('This conversation has no active reply to queue behind');
    if (!record.items.length) follow(record, value.after);
   }
   for (const data of next) {
    if (record.ids.includes(data.id)) continue;
    const {unconfirmed, ...item} = data;
    record.ids.push(item.id);
    record.items.push({...item, scope: capture(owner, item), status: unconfirmed ? 'unconfirmed' : 'queued'});
   }
   if (migration) record.pause = record.items.some(item => item.status === 'unconfirmed') ? 'unconfirmed' : 'restored';
   save(record);
   kick(provider, threadId);
   return {queue: view(record)};
  }
  if (action === 'pause') {
   check('stop');
   if (value.stop !== undefined && typeof value.stop !== 'boolean') throw Error('Invalid follow-up stop request');
   pause(provider, threadId);
   const flight = active.get(key);
   if (flight && value.stop) { flight.stop = true; stopClaim(flight); }
   return {queue: view(read(provider, threadId))};
  }
  if (action === 'resume') {
   check();
   if (record.items.some(item => item.status === 'unconfirmed' || activeItem(item)) || agents.isBusy(provider, threadId))
    throw Error('Wait for the original reply or check the unconfirmed message before resuming');
   if (record.items.length && !equal(record.items[0].scope, capture(owner, record.items[0]))) throw Error('Restore the original project or resource before resuming this queue');
   record.pause = null;
   record.after = null;
   save(record);
   kick(provider, threadId);
   return {queue: view(record)};
  }
  if (action === 'reconcile') {
   check('id');
   const item = find(value.id);
   if (item?.status !== 'unconfirmed') throw Error('This message no longer needs a delivery check');
   const turnId = await reconcile(owner, item);
   const latest = read(provider, threadId);
   if (identifier(turnId) && latest.items.some(entry => entry.id === item.id && entry.status === 'unconfirmed')) {
    latest.items = latest.items.filter(entry => entry.id !== item.id);
    latest.pause = latest.items.some(entry => entry.status === 'unconfirmed') ? 'unconfirmed' : 'restored';
    save(latest);
    return {queue: view(latest), turnId};
   }
   return {queue: view(latest)};
  }
  if (action === 'remove') {
   check('id');
   const item = find(value.id);
   if (!item || activeItem(item)) throw Error('This message is already being sent');
   record.items = record.items.filter(item => item.id !== value.id);
   if (!record.items.length) { record.after = null; record.pause = null; }
   else if (record.pause === 'unconfirmed' && !record.items.some(item => item.status === 'unconfirmed')) record.pause = 'restored';
  } else if (action === 'edit') {
   check('id', 'text');
   const item = find(value.id);
   if (!editable(item) || !userText(value.text,item.files)) throw Error('Only unsent messages with text or attachments can be edited');
   item.text = value.text;
  } else if (action === 'move') {
   check('id', 'direction');
   const item = find(value.id), index = record.items.indexOf(item);
   if (value.direction !== 'up' && value.direction !== 'down') throw Error('Invalid message direction');
   const neighbor = index + (value.direction === 'up' ? -1 : 1);
   if (!editable(item) || !editable(record.items[neighbor])) throw Error('Only unsent messages can change order');
   [record.items[index], record.items[neighbor]] = [record.items[neighbor], record.items[index]];
  } else if (action === 'steer') {
   check('id', 'turnId');
   const item = find(value.id);
   if (provider === 'kimi' || !editable(item) || item.attachmentReview || item.skill || item.files?.length || item.newWorkflow || item.preparedTaskId ||
       active.has(key) || !identifier(value.turnId) || agents.activeTurn(provider, threadId) !== value.turnId)
    throw Error('The current reply cannot receive this queued message');
   return deliver(record, item, 'steer', value.turnId);
  } else throw Error('Unsupported follow-up action');
  save(record);
  kick(provider, threadId);
  return {queue: view(record)};
 }

 return {request, observe, recover, pause, isBusy: (provider, threadId) => active.has(ownerKey(provider, threadId)), close: () => { stopping = true; }};
}
