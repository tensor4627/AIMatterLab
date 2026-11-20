/** Desktop records for the SSH account's confirmed root and actual session directories. */
import {createHash, randomUUID} from 'node:crypto';
import {posix} from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import {absoluteWorkspace, observedIdentity, workspaceCandidate} from '../../../desktop/platform/terminal-service/workspace-probe.mjs';

const REGISTRATION = 'resource-workspace-registration';
const DEFAULT = 'resource-workspace-default';
const SESSION = 'resource-workspace-session';
const refFields = ['connectionId', 'profileId', 'profileVersion'];
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const hash = (...values) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
const fail = code => { throw Error(code); };
const sameTarget = (left, right) => refFields.every(key => left?.[key] === right?.[key]);
const hostOf = ({hostname, uid, machineId}) => ({hostname, uid, machineId});
const targetOf = profile => hash(profile.host, profile.username, profile.port, profile.proxy_jump || [], profile.via || []);
const layout = root => [posix.join(root, 'workfile'), posix.join(root, 'software')];
const resourceOf = (profileId, identity) => hash(profileId, identity.hostname, identity.uid, identity.machineId, identity.account);
const dateOf = value => {
  const local = new Date(value);
  return [local.getFullYear(), local.getMonth() + 1, local.getDate()].map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');
};

function exact(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key))) fail('ssh_workspace_invalid');
}

function publicWorkspace(record) {
  const {resourceId, workspaceId, profileId, account, root, directories, checkedAt, hostIdentity} = record;
  return {resourceId, workspaceId, profileId, account, root, directories, checkedAt, hostname: hostIdentity.hostname};
}

function receiptView(receipt, status) {
  const {resource_id: resourceId, workspace_id: workspaceId, root, path, date, task_number: taskNumber, checked_at: checkedAt} = receipt;
  return {status, resourceId, workspaceId, root, path, date, taskNumber, checkedAt};
}

export const resourceSessionWorkspaceTool = {
  name: 'read_session_workspace',
  description: 'Find the actual confirmed workfile path for this conversation on its compute resource. A conversation receives a directory when the first calculation workflow is confirmed. Returns the last confirmed path if offline. Pass a saved profile_id to select among this conversation’s resources. Does not create files or issue a job.',
  annotations: {readOnlyHint: true},
  inputSchema: {type: 'object', properties: {profile_id: {type: 'string', minLength: 1, maxLength: 200}}, additionalProperties: false},
};

export function createResourceWorkspace({catalog, profiles, connections, resource, worker, current, registration, now = Date.now, emit = () => {}, uuid = randomUUID}) {
  const challenges = new Map();
  const profileFor = ({profileId, profileVersion}) => {
    if (!identifier(profileId) || !Number.isSafeInteger(profileVersion) || profileVersion < 1) fail('ssh_workspace_invalid');
    const profile = profiles.read({id: profileId, version: profileVersion});
    if (profile.kind !== 'ssh' || profile.id !== profileId || profile.version !== profileVersion) fail('ssh_workspace_changed');
    return profile;
  };
  const registrationOf = workspaceId => {
    const saved = catalog.get(REGISTRATION, workspaceId);
    if (!saved) return null;
    if (!absoluteWorkspace(saved.root) || saved.workspaceId !== workspaceId || !identifier(saved.profileId) ||
        !observedIdentity({...saved.hostIdentity, account: saved.account}) ||
        saved.resourceId !== resourceOf(saved.profileId, {...saved.hostIdentity, account: saved.account}) ||
        workspaceId !== hash(saved.resourceId, saved.root) || !equal(saved.directories, layout(saved.root))) fail('ssh_workspace_record_invalid');
    return saved;
  };
  function defaultFor(profileId) {
    const active = catalog.get(DEFAULT, profileId);
    return active && registrationOf(active.workspaceId);
  }
  function read(value) {
    exact(value, ['profileId', 'profileVersion']);
    const profile = profileFor(value), saved = defaultFor(profile.id);
    const common = {...value, resourceName: profile.name};
    return saved?.targetStamp === targetOf(profile)
      ? {...publicWorkspace(saved), ...common, status: 'confirmed', source: 'confirmed'}
      : {...common, status: 'unconfigured'};
  }
  function ownerGuard(value, profile) {
    const ticket = resource.capture(), owner = structuredClone(current());
    return () => {
      resource.assertCurrent(ticket);
      if (!equal(owner, current()) || !equal(profile, profileFor(value))) fail('ssh_workspace_changed');
    };
  }
  async function probe(ref, guard, options) {
    if (!identifier(ref.connectionId)) fail('ssh_workspace_invalid');
    guard();
    const result = await connections.workspace({...Object.fromEntries(refFields.map(key => [key, ref[key]])), ...options}, guard);
    guard();
    if (!result || typeof result.ready !== 'boolean' || !observedIdentity(result.identity) || !workspaceCandidate(result.root) ||
        !result.conflict && !absoluteWorkspace(result.root) || result.conflict && !workspaceCandidate(result.conflict)) fail('ssh_workspace_unconfirmed');
    return result;
  }
  function legacyRoot(profile, identity) {
    const old = catalog.list('cluster-base-workspace').filter(record => record.profileId === profile.id && absoluteWorkspace(record.root) && identifier(record.workspaceId));
    const host = hostOf(identity);
    const matched = old.find(record => record.id === hash(profile.id, record.root, host));
    return matched ? posix.join(matched.root, 'projects', matched.workspaceId, 'inputs') : undefined;
  }
  function separateDirectories(ref, found) {
    const saved = registration?.read({profileId: ref.profileId, profileVersion: ref.profileVersion})?.registration;
    const privateRoot = equal(saved?.hostIdentity, hostOf(found.identity)) ? saved.root : null;
    const inside = (path, parent) => path === parent || path.startsWith(parent + '/');
    if (privateRoot && layout(found.root).some(path => inside(privateRoot, path) || inside(path, privateRoot) && !inside(path, privateRoot + '/projects')))
      return {...found, conflict: found.root};
    return found;
  }
  const view = (ref, profile, found, source, extra = {}) => ({
    ...Object.fromEntries(refFields.map(key => [key, ref[key]])), resourceName: profile.name,
    account: found.identity.account, hostname: found.identity.hostname, root: found.root,
    directories: layout(found.root), checkedAt: now(), source, ...extra,
    ...(found.conflict ? {conflict: found.conflict} : {}),
  });
  async function preview(value) {
    exact(value, refFields, ['directory']);
    if (value.directory !== undefined && !workspaceCandidate(value.directory)) fail('ssh_workspace_invalid');
    const profile = profileFor(value), guard = ownerGuard(value, profile), saved = defaultFor(profile.id);
    const intent = {id: uuid(), guard, ref: value, expiresAt: now() + 10 * 60 * 1000};
    challenges.set(value.connectionId, intent);
    if (challenges.size > 64) challenges.delete(challenges.keys().next().value);
    const fresh = () => {
      guard();
      if (challenges.get(value.connectionId) !== intent || now() > intent.expiresAt) fail('ssh_workspace_changed');
    };
    const storedRoot = saved?.targetStamp === targetOf(profile) ? saved.root : undefined;
    let found = await probe(value, fresh, {mode: 'preview', directory: value.directory ?? storedRoot});
    let resourceId = resourceOf(profile.id, found.identity);
    let source = value.directory === undefined ? 'suggested' : 'custom';
    if (value.directory === undefined && storedRoot && saved.resourceId !== resourceId) {
      found = await probe(value, fresh, {mode: 'preview'});
      resourceId = resourceOf(profile.id, found.identity);
    }
    if (value.directory === undefined && (!storedRoot || saved.resourceId !== resourceId)) {
      const legacy = legacyRoot(profile, found.identity);
      if (legacy) {
        found = await probe(value, fresh, {mode: 'preview', directory: legacy});
        resourceId = resourceOf(profile.id, found.identity);
        source = 'legacy';
      }
    }
    found = separateDirectories(value, found);
    if (found.ready && !found.conflict && storedRoot === found.root && resourceId === saved.resourceId) {
      return view(value, profile, found, 'confirmed', {status: 'confirmed', resourceId, workspaceId: saved.workspaceId});
    }
    intent.found = found;
    intent.previous = saved?.workspaceId ?? null;
    intent.source = source;
    return view(value, profile, found, source, {status: 'confirmation_required', ...found.conflict ? {} : {confirmationId: intent.id}});
  }
  function challenge(value) {
    exact(value, [...refFields, 'confirmationId']);
    const intent = challenges.get(value.connectionId);
    if (!intent || value.confirmationId !== intent.id || !sameTarget(value, intent.ref) || now() > intent.expiresAt) fail('ssh_workspace_changed');
    return intent;
  }
  function cancel(value) {
    const intent = challenge(value);
    if (!intent.operation) challenges.delete(value.connectionId);
    return {cancelled: !intent.operation};
  }
  async function confirm(value) {
    const intent = challenge(value), profile = profileFor(value);
    intent.guard();
    if (intent.operation) return intent.operation;
    if (!intent.found || intent.found.conflict || (defaultFor(profile.id)?.workspaceId ?? null) !== intent.previous) fail('ssh_workspace_changed');
    const fresh = () => {
      intent.guard();
      if (challenges.get(value.connectionId) !== intent || (defaultFor(profile.id)?.workspaceId ?? null) !== intent.previous) fail('ssh_workspace_changed');
    };
    intent.operation = (async () => {
      const found = await probe(value, fresh, {mode: 'confirm', directory: intent.found.root, expected: intent.found.identity});
      if (!equal(found.identity, intent.found.identity) || found.root !== intent.found.root) fail('ssh_workspace_changed');
      if (found.conflict) return view(value, profile, found, intent.source, {status: 'confirmation_required'});
      if (!found.ready) fail('ssh_workspace_unconfirmed');
      const resourceId = resourceOf(profile.id, found.identity), workspaceId = hash(resourceId, found.root);
      const saved = {...publicWorkspace({resourceId, workspaceId, profileId: profile.id, account: found.identity.account, root: found.root,
        directories: layout(found.root), checkedAt: now(), hostIdentity: hostOf(found.identity)}), hostIdentity: hostOf(found.identity), targetStamp: targetOf(profile)};
      const save = () => { catalog.put(REGISTRATION, workspaceId, saved); catalog.put(DEFAULT, profile.id, {workspaceId}); };
      if (catalog.transaction) catalog.transaction(save); else save();
      emit();
      return view(value, profile, found, 'confirmed', {status: 'confirmed', resourceId, workspaceId});
    })();
    return intent.operation;
  }
  async function assertHandoff(ref, assertCurrent = () => {}) {
    const profile = profileFor(ref), saved = defaultFor(profile.id);
    if (!saved || saved.targetStamp !== targetOf(profile)) fail('ssh_workspace_confirmation_required');
    const guard = () => {
      assertCurrent();
      if (!equal(profile, profileFor(ref)) || defaultFor(profile.id)?.workspaceId !== saved.workspaceId) fail('ssh_workspace_changed');
    };
    const found = await probe(ref, guard, {mode: 'preview', directory: saved.root});
    if (!found.ready || found.conflict || found.root !== saved.root || resourceOf(profile.id, found.identity) !== saved.resourceId) fail('ssh_workspace_confirmation_required');
    return structuredClone(saved);
  }
  function resolveHostedResourceWorkspace(resourceId, {profileId, hostIdentity} = {}) {
    if (!resourceId && !profileId) return null;
    const active = profileId ? defaultFor(profileId) :
      catalog.list(DEFAULT).map(({workspaceId}) => registrationOf(workspaceId)).find(row => row?.resourceId === resourceId);
    if (!active || resourceId && active.resourceId !== resourceId || hostIdentity && !equal(active.hostIdentity, hostOf(hostIdentity))) return null;
    return structuredClone(active);
  }
  async function registerWithWorker(saved, request) {
    const record = registrationOf(saved?.workspaceId);
    if (!record || !equal(record, saved)) fail('ssh_workspace_changed');
    const data = {resource_id: saved.resourceId, workspace_id: saved.workspaceId, profile_id: saved.profileId,
      root: saved.root, account: saved.account, host_identity: saved.hostIdentity};
    const response = await request('POST', '/api/resource-workspace/register', data);
    if (!equal(response, {id: saved.workspaceId, ...data})) fail('ssh_workspace_unconfirmed');
    return response;
  }
  function forTerminal(ref, scope) {
    const profile = profileFor(ref), active = defaultFor(profile.id);
    if (!active || active.targetStamp !== targetOf(profile) || scope.checkCurrent?.() !== true) fail('ssh_workspace_confirmation_required');
    const row = catalog.get(SESSION, hash(active.resourceId, scope.provider, scope.threadId));
    const saved = row ? registrationOf(row.workspaceId) : active;
    if (!saved || saved.resourceId !== active.resourceId) fail('ssh_workspace_changed');
    return {workspaceId:saved.workspaceId, root:saved.root,
      path:row?.receipt ? verifiedReceipt(row.receipt, saved, scope).path : saved.root,
      identity:{...saved.hostIdentity, account:saved.account}};
  }
  function connectionContext(owner, assertCurrent) {
    const identity = structuredClone(worker.identity), connection = worker.connection, epoch = worker.connectionEpoch;
    const guard = () => {
      assertCurrent();
      const selected = current();
      if (selected?.provider !== owner.provider || selected.threadId !== owner.threadId || worker.connection !== connection ||
          worker.connectionEpoch !== epoch || !equal(worker.identity, identity)) fail('ssh_workspace_changed');
    };
    return {identity, request: async (...args) => { guard(); const result = await worker.request(...args); guard(); return result; }};
  }
  function verifiedReceipt(receipt, saved, owner) {
    if (!receipt || receipt.resource_id !== saved.resourceId || receipt.workspace_id !== saved.workspaceId ||
        receipt.provider !== owner.provider || receipt.thread_id !== owner.threadId || receipt.root !== saved.root ||
        !/^\d{4}-\d{2}-\d{2}$/.test(receipt.date || '') || !Number.isSafeInteger(receipt.task_number) || receipt.task_number < 1 ||
        receipt.path !== posix.join(saved.root, 'workfile', receipt.date, 'task-' + receipt.task_number) ||
        !Number.isSafeInteger(receipt.checked_at) || receipt.checked_at <= 0) fail('ssh_workspace_unconfirmed');
    return receipt;
  }
  async function forExecution({task, requestId}, assertCurrent = () => {}) {
    assertCurrent();
    if (worker.identity?.kind !== 'ssh') return null;
    const {identity, request} = connectionContext(task, assertCurrent);
    const active = resolveHostedResourceWorkspace(undefined, {profileId: identity.profileId, hostIdentity: identity.hostIdentity});
    if (!active) fail('ssh_workspace_confirmation_required');
    const key = hash(active.resourceId, task.provider, task.threadId);
    const prior = catalog.get(SESSION, key);
    const saved = prior ? registrationOf(prior.workspaceId) : active;
    if (!saved || active.resourceId !== saved.resourceId) fail('ssh_workspace_changed');
    const date = prior?.date || dateOf(now());
    if (!prior) catalog.put(SESSION, key, {provider: task.provider, threadId: task.threadId, profileId: saved.profileId,
      resourceId: saved.resourceId, workspaceId: saved.workspaceId, date, requestId});
    await registerWithWorker(saved, request);
    const receipt = await request('POST', '/api/resource-workspace/allocate', {resource_id: saved.resourceId, workspace_id: saved.workspaceId,
      provider: task.provider, thread_id: task.threadId, date});
    // A previous desktop may have claimed the original workspace. The running
    // worker's recorded path is authoritative, using a known old registration.
    const bound = receipt?.workspace_id === saved.workspaceId ? saved : registrationOf(receipt?.workspace_id);
    if (!bound || bound.resourceId !== saved.resourceId) fail('ssh_workspace_unconfirmed');
    verifiedReceipt(receipt, bound, task);
    catalog.put(SESSION, key, {provider: task.provider, threadId: task.threadId, profileId: bound.profileId,
      resourceId: bound.resourceId, workspaceId: bound.workspaceId, date: receipt.date, requestId: prior?.requestId ?? requestId, receipt});
    emit();
    return receipt;
  }
  async function forSession(value = {}, scope) {
    exact(value, [], ['profileId']);
    if (value.profileId !== undefined && !identifier(value.profileId)) fail('ssh_workspace_invalid');
    const owner = scope || current();
    if (scope && scope.checkCurrent?.() !== true) fail('ssh_workspace_changed');
    if (!owner?.provider || !owner.threadId) return {status: 'unassigned'};
    const selected = resource.peek(), identity = worker.identity;
    const rows = catalog.list(SESSION).filter(row => row.provider === owner.provider && row.threadId === owner.threadId &&
      (!value.profileId || value.profileId === row.profileId));
    if (!rows.length) return {status: 'unassigned'};
    const matched = rows.filter(row => row.profileId === (value.profileId || selected?.profileId || identity?.profileId));
    const candidates = matched.length ? matched : rows;
    const results = [];
    for (const row of candidates) {
      const saved = registrationOf(row.workspaceId);
      if (!saved || saved.resourceId !== row.resourceId) continue;
      let receipt = row.receipt, status = 'last_confirmed';
      if (identity?.kind === 'ssh' && identity.profileId === saved.profileId && equal(hostOf(identity.hostIdentity), saved.hostIdentity)) {
        try {
          const assertCurrent = () => { if (scope && scope.checkCurrent?.() !== true) fail('ssh_workspace_changed'); };
          const remote = await connectionContext(owner, assertCurrent).request('POST', '/api/resource-workspace/session',
            {resource_id: saved.resourceId, provider: owner.provider, thread_id: owner.threadId});
          if (remote) {
            receipt = verifiedReceipt(remote, saved, owner);
            status = 'verified';
            const {id, ...record} = row;
            catalog.put(SESSION, id, {...record, receipt});
          }
        } catch {
          // Last confirmed paths remain available after a disconnect or move.
        }
      }
      if (receipt) results.push({...receiptView(verifiedReceipt(receipt, saved, owner), status), profileId: saved.profileId});
    }
    if (scope && scope.checkCurrent?.() !== true || current()?.provider !== owner.provider || current()?.threadId !== owner.threadId) fail('ssh_workspace_changed');
    if (results.length === 1) return results[0];
    return results.length ? {status: 'multiple', workspaces: results} : {status: 'unassigned'};
  }
  return {read, preview, confirm, cancel, assertHandoff, resolveHostedResourceWorkspace, registerWithWorker, forExecution, forSession, forTerminal,
    publicWorkspace, callSessionTool: (args, scope) => { exact(args, [], ['profile_id']); return forSession(args.profile_id === undefined ? {} : {profileId: args.profile_id}, scope); }};
}
