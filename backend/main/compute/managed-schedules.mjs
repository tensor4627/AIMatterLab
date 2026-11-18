import {isDeepStrictEqual} from 'node:util';

const indexKind = 'managed-worker-snapshot';
const stopKind = 'managed-schedule-stop';
const route = action => '/api/managed-schedules/' + action;
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:+@~-]{0,511}$/.test(value);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const stopKey = (sourceId, scheduleId) => sourceId + '/' + scheduleId;
const nowSeconds = () => Date.now() / 1000;
const taskFields = ['provider', 'threadId', 'taskId', 'projectId'];
const taskKey = row => JSON.stringify(taskFields.map(field => row.scope[field]));
const savedRunRefreshSeconds = 30;

function validRow(row, sourceId, scheduleId = row?.id) {
  if (!object(row) || !token(sourceId) || !token(scheduleId) || row.id !== scheduleId || row.sourceId !== sourceId ||
      !['poll', 'action', 'script', 'wake_agent'].includes(row.kind)) return false;
  const {scope, stateRevision, expiresAt, status, stopRequestedAt, history, script} = row;
  return object(scope) && Object.keys(scope).length === taskFields.length + 1 &&
    taskFields.every(field => Object.hasOwn(scope, field) && token(scope[field])) && Object.hasOwn(scope, 'runId') &&
    (token(scope.runId) || row.kind === 'wake_agent' && scope.runId === null) &&
    Number.isSafeInteger(stateRevision) && stateRevision >= 1 && Number.isFinite(expiresAt) &&
    ['scheduled', 'running', 'unknown', 'stopped', 'completed', 'exhausted', 'expired'].includes(status) &&
    (status === 'stopped' ? Number.isFinite(stopRequestedAt) : stopRequestedAt == null) &&
    (history === undefined || Array.isArray(history)) && (script === undefined || object(script));
}

function summaryRow(row) {
  const {history, script, stopPending, stopNeedsConfirmation, ...summary} = row;
  if (!script) return summary;
  const {text, ...scriptIdentity} = script;
  return {...summary, script: scriptIdentity};
}

function checkedRow(row, sourceId, scheduleId = row?.id) {
  if (!validRow(row, sourceId, scheduleId)) throw Error('managed_schedule_unverified_reply');
  return summaryRow(row);
}

function sameSchedule(left, right) {
  return left.id === right.id && left.sourceId === right.sourceId && left.kind === right.kind &&
    isDeepStrictEqual(left.scope, right.scope);
}

function isCurrentRow(previous, row) {
  if (!previous) return true;
  if (!sameSchedule(previous, row)) throw Error('managed_schedule_unverified_reply');
  if (row.stateRevision < previous.stateRevision) return false;
  if (previous.stopRequestedAt != null && previous.stopRequestedAt !== row.stopRequestedAt ||
      row.stateRevision === previous.stateRevision && row.status !== previous.status) {
    throw Error('managed_schedule_unverified_reply');
  }
  return true;
}

function mergeRows(existing, fresh) {
  const byId = new Map(existing.map(row => [row.id, row]));
  for (const row of fresh) {
    if (isCurrentRow(byId.get(row.id), row)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

function cachedRecord(record, sourceId = record?.id) {
  if (!object(record) || !token(sourceId) || record.id !== sourceId) return null;
  const schedules = Array.isArray(record.schedules) ? record.schedules.filter(row => validRow(row, sourceId)).map(summaryRow) : [];
  return {...record, schedules, runs: Array.isArray(record.runs) ? record.runs : []};
}

function assertOperation(operation) {
  if (operation === undefined) return;
  if (typeof operation?.assertCurrent !== 'function' || typeof operation.request !== 'function') {
    throw Object.assign(Error('managed_schedule_invalid_request'), {operationNotStarted: true});
  }
  operation.assertCurrent();
}

function originalSourceOffline() {
  return Object.assign(Error('managed_schedule_original_source_offline'), {operationNotStarted: true});
}

function scopedStopFailure(error) {
  if (error?.operationNotStarted === true) return error;
  if (['managed_compute_project_grant_required', 'managed_compute_invalid_request', 'managed_compute_worker_update_required',
    'The acquired resource changed its original service identity'].includes(error?.message)) {
    return Object.assign(Error(error.message, {cause: error}), {operationNotStarted: true});
  }
  return Error('managed_schedule_stop_unconfirmed. Check task_schedule_status on the original service and schedule before requesting another stop.', {cause: error});
}

function nextDispatch(rows, skipped) {
  const occupied = new Set(rows.filter(row => row.active).map(taskKey));
  let next = Infinity;
  for (const row of rows) {
    if (skipped.has(row.id)) continue;
    if (Number.isFinite(row.active?.nextCheckAt)) next = Math.min(next, row.active.nextCheckAt);
    if (row.status === 'scheduled') {
      next = Math.min(next, row.expiresAt);
      if (!occupied.has(taskKey(row)) && Number.isFinite(row.nextAt)) next = Math.min(next, row.nextAt);
    }
  }
  return next;
}

/** Index the worker's durable records. Only the application timer invokes pump. */
export function createManagedSchedules({catalog, listSources, wake = async () => false, onChange = () => {},
  clock = nowSeconds, intervalMs = 3000, setTimer = setInterval, clearTimer = clearInterval}) {
  const present = new Map();
  const pumps = new Map();
  const refreshes = new Map();
  const desktopStops = new Map();
  const notifications = new Set();
  let timer = null;
  let active = false;
  let epoch = 0;
  let discovery = 0;

  function cached(sourceId) {
    return cachedRecord(catalog.get(indexKind, sourceId), sourceId);
  }

  function publish(source, update) {
    const previous = cached(source.id);
    const record = {
      id: source.id,
      profileId: source.profileId,
      kind: source.kind,
      observedAt: previous?.observedAt ?? null,
      runs: previous?.runs ?? [],
      ...update,
      schedules: mergeRows(previous?.schedules ?? [], update.schedules ?? []),
    };
    if (!isDeepStrictEqual(previous, record)) {
      catalog.put(indexKind, source.id, record);
      if (!previous || !isDeepStrictEqual([previous.runs, previous.schedules], [record.runs, record.schedules])) onChange();
    }
    return record;
  }

  function pendingStop(row) {
    if (row.stopRequestedAt != null) return null;
    const intent = catalog.get(stopKind, stopKey(row.sourceId, row.id));
    if (intent?.sourceId !== row.sourceId || intent.scheduleId !== row.id || !Number.isFinite(intent.requestedAt)) return null;
    if (!Object.hasOwn(intent, 'authority')) return intent;
    return intent.authority === 'desktop' && intent.kind === row.kind && isDeepStrictEqual(intent.scope, row.scope) ? intent : null;
  }

  function pendingStops(rows) {
    return rows.map(pendingStop).filter(Boolean);
  }

  function overlay(row) {
    const intent = pendingStop(row);
    if (!intent) return row;
    // Old intents used one format for both entry points. Keep their dispatch
    // pause until a verified receipt or a fresh explicit desktop stop.
    if (intent.authority !== 'desktop') return {...row, stopNeedsConfirmation: true, nextAt: null};
    return {...row, status: 'stopping', stopRequestedAt: intent.requestedAt, stopPending: true, nextAt: null};
  }

  function snapshot() {
    return {sources: catalog.list(indexKind).map(entry => cachedRecord(entry)).filter(Boolean).map(entry => ({...entry,
      connected: present.get(entry.id)?.ready === true, schedules: entry.schedules.map(overlay)}))};
  }

  async function sources() {
    const values = await listSources();
    if (!Array.isArray(values)) throw Error('managed_schedule_source_unavailable');
    const distinct = new Map();
    for (const source of values) {
      if (!token(source?.id) || !token(source.profileId) || typeof source.request !== 'function') {
        throw Error('managed_schedule_unverified_source');
      }
      const previous = distinct.get(source.id);
      const profileId = cached(source.id)?.profileId;
      if (!previous || source.profileId === profileId && previous.profileId !== profileId) distinct.set(source.id, source);
    }
    return [...distinct.values()];
  }

  async function find(sourceId) {
    if (!token(sourceId)) throw Error('managed_schedule_unverified_source');
    return (await sources()).find(source => source.id === sourceId);
  }

  function known(data) {
    if (!token(data?.sourceId) || !token(data.scheduleId)) throw Error('managed_schedule_invalid_request');
    const row = cached(data.sourceId)?.schedules.find(item => item.id === data.scheduleId);
    if (!row) throw Error('managed_schedule_not_in_original_source');
    return row;
  }

  function verifiedReply(result, source, original) {
    const row = checkedRow(result, source.id, original.id);
    if (!sameSchedule(original, row)) throw Error('managed_schedule_unverified_reply');
    if (!isCurrentRow(known({sourceId: original.sourceId, scheduleId: original.id}), row)) {
      throw Error('managed_schedule_stale_reply');
    }
    return row;
  }

  async function upsert(data, operation) {
    assertOperation(operation);
    const source = await find(data?.sourceId);
    operation?.assertCurrent();
    if (!source) throw originalSourceOffline();
    const result = await (operation?.request ?? source.request)('POST', route('upsert'), data);
    operation?.assertCurrent();
    const row = checkedRow(result, source.id);
    if (row.kind !== data.kind || !isDeepStrictEqual(row.scope, data.scope) ||
        row.key !== (data.key ?? data.kind) || row.delegationId !== (data.delegationId ?? data.scope.taskId)) {
      throw Error('managed_schedule_unverified_reply');
    }
    publish(source, {schedules: [row]});
    operation?.assertCurrent();
    return operation ? row : overlay(row);
  }

  function offlineStatus(data) {
    return {...overlay(known(data)), connected: false, observedAt: cached(data.sourceId).observedAt};
  }

  async function status(data, operation) {
    assertOperation(operation);
    const previous = known(data);
    const source = await find(data.sourceId);
    operation?.assertCurrent();
    if (!source) {
      if (operation) throw originalSourceOffline();
      return offlineStatus(data);
    }
    let result;
    try { result = await (operation?.request ?? source.request)('POST', route('status'), data); }
    catch (error) {
      if (operation) {
        operation.assertCurrent();
        throw error;
      }
      return offlineStatus(data);
    }
    operation?.assertCurrent();
    const row = verifiedReply(result, source, previous);
    publish(source, {schedules: [row]});
    operation?.assertCurrent();
    return {...(operation ? row : overlay(row)), connected: true, history: result.history,
      ...result.script ? {script: result.script} : {}};
  }

  function verifiedStop(result, source, previous) {
    const row = verifiedReply(result, source, previous);
    if (row.status !== 'stopped') throw Error('managed_schedule_stop_unconfirmed');
    return row;
  }

  async function stopScoped(data, operation) {
    assertOperation(operation);
    const previous = known(data);
    const payload = {sourceId: previous.sourceId, scheduleId: previous.id};
    const source = await find(payload.sourceId);
    operation.assertCurrent();
    if (!source) throw originalSourceOffline();
    let row;
    try {
      const result = await operation.request('POST', route('stop'), payload);
      operation.assertCurrent();
      row = verifiedStop(result, source, previous);
    } catch (error) {
      operation.assertCurrent();
      throw scopedStopFailure(error);
    }
    publish(source, {schedules: [row]});
    operation.assertCurrent();
    return row;
  }

  function sendDesktopStop(source, intent) {
    const key = stopKey(intent.sourceId, intent.scheduleId);
    const payload = {sourceId: intent.sourceId, scheduleId: intent.scheduleId};
    const previous = known(payload);
    if (previous.stopRequestedAt != null) return Promise.resolve(previous);
    if (source.id !== intent.sourceId || intent.authority !== 'desktop' || !isDeepStrictEqual(pendingStop(previous), intent)) {
      throw Error('managed_schedule_unverified_stop_intent');
    }
    const pending = desktopStops.get(key);
    if (pending) return pending;
    const operation = (async () => {
      const row = verifiedStop(await source.request('POST', route('stop'), payload), source, previous);
      publish(source, {schedules: [row]});
      catalog.remove(stopKind, key);
      return row;
    })().finally(() => desktopStops.delete(key));
    desktopStops.set(key, operation);
    return operation;
  }

  async function stop(data, operation) {
    if (operation !== undefined) return stopScoped(data, operation);
    const row = known(data);
    if (row.stopRequestedAt != null) return row;
    const key = stopKey(data.sourceId, data.scheduleId);
    let intent = pendingStop(row);
    if (intent?.authority !== 'desktop') {
      intent = catalog.put(stopKind, key, {authority: 'desktop', sourceId: row.sourceId, scheduleId: row.id,
        kind: row.kind, scope: row.scope, requestedAt: clock()});
      onChange();
    }
    try {
      const source = await find(data.sourceId);
      if (source) return await sendDesktopStop(source, intent);
    } catch {
      // A lost reply can follow a committed stop. Preserve the local intent
      // until its exact original worker acknowledges the stopped schedule.
    }
    return overlay(known(data));
  }

  function validDispatch(source, entry, generation) {
    return active && epoch === generation && present.get(source.id) === entry;
  }

  function deliver(source, entry, generation, events) {
    const seen = new Set();
    for (const event of events) {
      if (!token(event?.id) || !token(event.scheduleId) || event.sourceId !== source.id || !event.scope) continue;
      if (notifications.has(event.id)) continue;
      const schedule = cached(source.id)?.schedules.find(row => row.id === event.scheduleId);
      if (schedule?.kind !== 'wake_agent' || schedule.stopRequestedAt != null || pendingStop(schedule) ||
          !isDeepStrictEqual(event.scope, schedule.scope)) continue;
      const owner = JSON.stringify([event.scope.provider, event.scope.threadId]);
      if (seen.has(owner)) continue;
      seen.add(owner);
      notifications.add(event.id);
      void (async () => {
        if (!validDispatch(source, entry, generation)) return;
        const accepted = await wake({...event, profileId: source.profileId});
        if ((accepted === true || accepted === 'discarded') && validDispatch(source, entry, generation)) {
          const receipt = await source.request('POST', route('ack'), {sourceId: source.id, deliveryId: event.id});
          if (receipt?.id !== event.id) throw Error('managed_schedule_unverified_reply');
          entry.deliveries = entry.deliveries.filter(item => item.id !== event.id);
        }
      })().catch(() => {}).finally(() => notifications.delete(event.id));
    }
  }

  function acceptSnapshot(source, result) {
    if (result?.sourceId !== source.id || !Number.isFinite(result.observedAt) ||
        !Array.isArray(result.runs) || !Array.isArray(result.schedules)) {
      throw Error('managed_schedule_unverified_reply');
    }
    const schedules = result.schedules.map(row => checkedRow(row, source.id));
    const previous = cached(source.id);
    const oldRead = previous?.observedAt != null && previous.observedAt > result.observedAt;
    return publish(source, {schedules, ...oldRead ? {} : {observedAt: result.observedAt, runs: result.runs}});
  }

  async function refresh(sourceId) {
    const generation = epoch;
    const discovered = sourceId === undefined ? await sources() : [await find(sourceId)].filter(Boolean);
    await Promise.allSettled(discovered.map(source => {
      const existing = refreshes.get(source.id);
      if (existing) return existing;
      const request = (async () => {
        const result = await source.request('POST', route('snapshot'), {sourceId: source.id});
        if (generation !== epoch) return;
        acceptSnapshot(source, result);
        const entry = present.get(source.id);
        if (entry?.generation === source.generation) entry.nextAuditAt = clock() + savedRunRefreshSeconds;
      })().finally(() => refreshes.delete(source.id));
      refreshes.set(source.id, request);
      return request;
    }));
    return snapshot();
  }

  async function observeOnce(data) {
    const row = overlay(known(data));
    if (!token(data.requestId) || row.status !== 'exhausted' ||
        !(row.kind === 'poll' || row.kind === 'action' && row.action?.type === 'status')) {
      throw Error('managed_schedule_manual_observation_requires_exhausted_monitor');
    }
    const source = await find(data.sourceId);
    if (!source) throw Error('managed_schedule_original_source_offline');
    const result = await source.request('POST', route('observe-once'), data);
    if (result?.sourceId !== source.id || result.scheduleId !== row.id || result.requestId !== data.requestId ||
        result.run?.id !== row.scope.runId || result.run.projectId !== row.scope.projectId ||
        !['observed', 'in_progress', 'unknown'].includes(result.status)) {
      throw Error('managed_schedule_unverified_reply');
    }
    acceptSnapshot(source, result.snapshot);
    const {snapshot: _snapshot, ...observation} = result;
    return observation;
  }

  async function pumpSource(source, entry, generation) {
    for (const intent of pendingStops(cached(source.id)?.schedules ?? [])) {
      if (intent.authority !== 'desktop') continue;
      if (!validDispatch(source, entry, generation)) return;
      try { await sendDesktopStop(source, intent); } catch { /* retain the stop and exclude that schedule */ }
    }
    if (!validDispatch(source, entry, generation)) return;
    const skipScheduleIds = pendingStops(cached(source.id)?.schedules ?? []).map(intent => intent.scheduleId);
    const resume = !entry.ready || entry.resume === true;
    const result = await source.request('POST', route('pump'), {sourceId: source.id, resume, skipScheduleIds});
    if (!validDispatch(source, entry, generation)) return;
    if (!Array.isArray(result?.deliveries)) {
      throw Error('managed_schedule_unverified_reply');
    }
    acceptSnapshot(source, result);
    const changed = !entry.ready;
    entry.ready = true;
    entry.retryAt = 0;
    entry.failures = 0;
    entry.offset = result.observedAt - clock();
    entry.nextAuditAt = clock() + savedRunRefreshSeconds;
    entry.deliveries = result.deliveries;
    if (changed) onChange();
    deliver(source, entry, generation, result.deliveries);
  }

  async function pump() {
    if (!active) return;
    const check = ++discovery;
    const generation = epoch;
    const values = await sources().catch(() => []);
    if (!active || generation !== epoch || check !== discovery) return;
    const ids = new Set(values.map(source => source.id));
    for (const id of present.keys()) {
      if (!ids.has(id)) { present.delete(id); onChange(); }
    }
    const operations = [];
    for (const source of values) {
      let entry = present.get(source.id);
      if (!entry || entry.generation !== source.generation) {
        if (entry?.ready) onChange();
        entry = {ready: false, generation: source.generation, offset: 0, retryAt: 0,
          failures: 0, tickAt: clock(), nextAuditAt: 0, deliveries: []};
        present.set(source.id, entry);
      }
      const now = clock();
      if (now - entry.tickAt > Math.max(12, 4 * intervalMs / 1000)) entry.resume = true;
      entry.tickAt = now;
      if (pumps.has(entry)) continue;
      if (entry.ready) deliver(source, entry, generation, entry.deliveries);
      if (now < entry.retryAt) continue;
      const state = cached(source.id);
      const pending = pendingStops(state?.schedules ?? []);
      const needsStop = pending.some(intent => intent.authority === 'desktop');
      const due = nextDispatch(state?.schedules ?? [], new Set(pending.map(intent => intent.scheduleId)));
      if (entry.ready && !needsStop && due > now + entry.offset) {
        if (now >= entry.nextAuditAt &&
            state?.runs.some(run => ['queued', 'running', 'unknown'].includes(run.status) && !run.scheduleId && !run.managedObservation)) {
          entry.nextAuditAt = now + savedRunRefreshSeconds;
          operations.push(refresh(source.id).catch(() => {}));
        }
        continue;
      }
      const operation = pumpSource(source, entry, generation).catch(() => {
        if (!validDispatch(source, entry, generation)) return;
        entry.failures++;
        entry.retryAt = clock() + Math.min(60, 5 * (2 ** (entry.failures - 1)));
        if (entry.ready) { entry.ready = false; onChange(); }
      }).finally(() => { entry.resume = false; pumps.delete(entry); });
      pumps.set(entry, operation);
      operations.push(operation);
    }
    await Promise.all(operations);
  }

  function start() {
    if (active) return;
    active = true;
    timer = setTimer(() => void pump(), intervalMs);
    timer?.unref?.();
    void pump();
  }

  function halt() {
    active = false;
    epoch++;
    if (timer !== null) { clearTimer(timer); timer = null; }
    present.clear();
  }

  return {start, halt, pump, refresh, snapshot, upsert, status, stop, observeOnce};
}
