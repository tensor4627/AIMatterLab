import {isDeepStrictEqual as equal} from 'node:util';
import {TerminalFault, exact, terminalScope} from './session.mjs';

export const MANAGED_SSH_SHELL_CAPACITY = 4;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const fail = (code, status = 409) => { throw new TerminalFault(code, status); };

// Deliberately separate from the broker's human terminal inventory. No generic
// owner change, shared service borrowing or human input route can address these.
export function managedSshShells({verified, createSession, now = Date.now}) {
 const shells = new Map(), cancelled = new Map();
 let closed = false;

 function reference(data, keys = [], required = keys) {
  exact(data, ['leaseId','scope',...keys], ['leaseId','scope',...required]);
  if (!validId(data.leaseId)) fail('invalid_request', 400);
  const scope = terminalScope(data.scope);
  if (scope.taskId !== undefined) fail('invalid_scope', 403);
  return {id:data.leaseId, scope};
 }
 const expired = entry => {
  const state = entry.session?.state();
  return entry.confirmed && (!state?.alive || !entry.revoked && (state.expired || state.closed));
 };
 function reap() {
  for (const [id, expiry] of cancelled) if (expiry <= now()) cancelled.delete(id);
  for (const [id, entry] of shells) {
   if (expired(entry)) {
    entry.session.dispose();
    shells.delete(id);
   }
  }
 }
 function current(id, entry) {
  if (closed || shells.get(id) !== entry || entry.revoked || cancelled.has(id)) fail('ssh_connection_changed');
 }
 const view = (id, state) => ({leaseId:id, sessionId:state.id, ownerEpoch:state.ownerEpoch,
  alive:state.alive === true && !state.closed && !state.expired, expiresAt:state.expiresAt});

 async function open(data) {
  const {id, scope} = reference(data);
  reap();
  if (closed || cancelled.has(id)) fail('ssh_connection_changed');
  const previous = shells.get(id);
  if (previous) {
   if (previous.revoked) fail('ssh_connection_changed');
   if (!equal(previous.scope, scope)) fail('scope_mismatch', 403);
   return previous.opened;
  }
  if ([...shells.values()].some(entry => equal(entry.scope, scope))) fail('request_changed');
  if (shells.size >= MANAGED_SSH_SHELL_CAPACITY) fail('session_limit');
  const entry = {scope, session:null, confirmed:false,revoked:false};
  shells.set(id, entry);
  entry.opened = (async () => {
   try {
    await verified();
    current(id, entry);
    const session = entry.session = await createSession();
    current(id, entry);
    await session.confirmFreshShell(() => current(id, entry));
    await verified();
    current(id, entry);
    const state = session.owner({owner:'agent', ownerEpoch:session.state().ownerEpoch, scope});
    entry.confirmed = true;
    return view(id, state);
   } catch (error) {
    entry.session?.dispose();
    if (shells.get(id) === entry) shells.delete(id);
    throw error;
   }
  })();
  return entry.opened;
 }

 async function access(data, action) {
  const keys = action === 'read' ? ['cursor','maxBytes'] : action === 'input' ? ['requestId','data'] : [];
  const {id, scope} = reference(data, keys, action === 'input' ? keys : []);
  reap();
  const entry = shells.get(id);
  if (!entry || !entry.confirmed) fail('session_exited', 410);
  if (!equal(entry.scope, scope)) fail('scope_mismatch', 403);
  await verified();
  current(id, entry);
  const state = entry.session.state();
  if (action === 'state') return view(id, state);
  const request = {actor:'agent', scope, ownerEpoch:state.ownerEpoch,
   ...Object.fromEntries(keys.filter(key => Object.hasOwn(data,key)).map(key => [key,data[key]]))};
  return entry.session[action](request);
 }

 function close(data) {
  const {id, scope} = reference(data);
  reap();
  const entry = shells.get(id);
  if (entry && !equal(entry.scope, scope)) fail('scope_mismatch', 403);
  if (!closed) {
   // A transport timeout may deliver an earlier open after this close. Retain
   // the cancellation until that bounded broker request can no longer arrive.
   if (!cancelled.has(id) && cancelled.size >= 512) fail('request_limit', 429);
   cancelled.set(id, now() + 120000);
  }
  if(entry)entry.revoked=true;
  if (entry?.session) {
   const state=entry.session.state();
   entry.session.close({actor:entry.confirmed?'agent':'human', ownerEpoch:state.ownerEpoch,
    ...entry.confirmed?{scope}:{}});
  }
  shells.delete(id);
  return {leaseId:id, closed:true};
 }

 function closeAll() {
  closed = true;
  for (const entry of shells.values()) entry.session?.dispose();
  shells.clear();
  cancelled.clear();
 }

 return {open, state:data=>access(data,'state'), read:data=>access(data,'read'),
  occupied:()=>[...shells.values()].filter(entry=>!expired(entry)).length,
  input:data=>access(data,'input'), close, closeAll};
}
