import {isDeepStrictEqual} from 'node:util';

const indexKind = 'managed-worker-snapshot';
const stopKind = 'managed-schedule-stop';
const route = action => '/api/managed-schedules/' + action;
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:+@~-]{0,511}$/.test(value);
const stopKey = (sourceId, scheduleId) => sourceId + '/' + scheduleId;
const nowSeconds = () => Date.now() / 1000;
const taskKey = row => JSON.stringify([row.scope.provider, row.scope.threadId, row.scope.taskId, row.scope.projectId]);
const savedRunRefreshSeconds = 30;

function checkedRow(row, sourceId, scheduleId = row?.id) {
  if (!token(scheduleId) || row?.id !== scheduleId || row.sourceId !== sourceId ||
      !Number.isSafeInteger(row.stateRevision) || row.stateRevision < 1 || !row.scope || !Number.isFinite(row.expiresAt) ||
      !['scheduled', 'running', 'unknown', 'stopped', 'exhausted', 'expired'].includes(row.status)) {
    throw Error('managed_schedule_unverified_reply');
  }
  const {history, script, ...summary} = row;
  if (!script) return summary;
  const {text, ...scriptIdentity} = script;
  return {...summary, script: scriptIdentity};
}

function mergeRows(existing, fresh) {
  const byId = new Map(existing.map(row => [row.id, row]));
  for (const row of fresh) {
    if (!byId.has(row.id) || byId.get(row.id).stateRevision <= row.stateRevision) byId.set(row.id, row);
  }
  return [...byId.values()];
}

function nextDispatch(rows) {
  const occupied = new Set(rows.filter(row => row.active).map(taskKey));
  let next = Infinity;
  for (const row of rows) {
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
  const stops = new Map();
  const notifications = new Set();
  let timer = null;
  let active = false;
  let epoch = 0;
  let discovery = 0;

  function cached(sourceId) {
    return catalog.get(indexKind, sourceId);
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

  function overlay(row) {
    const pending = catalog.get(stopKind, stopKey(row.sourceId, row.id));
    if (!pending || row.stopRequestedAt != null) return row;
    return {...row, status: 'stopping', stopRequestedAt: pending.requestedAt, stopPending: true, nextAt: null};
  }

  function snapshot() {
    return {sources: catalog.list(indexKind).map(entry => ({...entry, connected: present.get(entry.id)?.ready === true,
      schedules: entry.schedules.map(overlay)}))};
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

  async function upsert(data, {assertCurrent = () => {}, request} = {}) {
    assertCurrent();
    const source = await find(data?.sourceId);
    assertCurrent();
    if (!source) throw Error('managed_schedule_original_source_offline');
    const row = checkedRow(await (request ?? source.request)('POST', route('upsert'), data), source.id);
    if (row.kind !== data.kind || !isDeepStrictEqual(row.scope, data.scope)) throw Error('managed_schedule_unverified_reply');
    publish(source, {schedules: [row]});
    assertCurrent();
    return overlay(row);
  }

  async function status(data, {assertCurrent = () => {}, request} = {}) {
    assertCurrent();
    const previous = known(data);
    const source = await find(data.sourceId);
    assertCurrent();
    if (!source) return {...overlay(previous), connected: false, observedAt: cached(data.sourceId).observedAt};
    let result;
    try { result = await (request ?? source.request)('POST', route('status'), data); }
    catch (error) {
      assertCurrent();
      if (request) throw error;
      return {...overlay(previous), connected: false, observedAt: cached(data.sourceId).observedAt};
    }
    const row = checkedRow(result, source.id, data.scheduleId);
    publish(source, {schedules: [row]});
    assertCurrent();
    return {...overlay(row), connected: true, history: result.history, ...result.script ? {script: result.script} : {}};
  }

  function sendStop(source, intent, {assertCurrent = () => {}, request} = {}) {
    const key = stopKey(intent.sourceId, intent.scheduleId);
    const previous = stops.get(key);
    if (previous) return previous;
    const payload = {sourceId: intent.sourceId, scheduleId: intent.scheduleId};
    const operation = (async () => {
      assertCurrent();
      const row = checkedRow(await (request ?? source.request)('POST', route('stop'), payload), source.id, intent.scheduleId);
      if (row.status !== 'stopped' || row.stopRequestedAt == null) throw Error('managed_schedule_stop_unconfirmed');
      publish(source, {schedules: [row]});
      catalog.remove(stopKind, key);
      onChange();
      return row;
    })().finally(() => stops.delete(key));
    stops.set(key, operation);
    return operation;
  }

  async function stop(data, {assertCurrent = () => {}, request} = {}) {
    assertCurrent();
    const row = known(data);
    if (row.stopRequestedAt != null) return row;
    const key = stopKey(data.sourceId, data.scheduleId);
    const intent = catalog.get(stopKind, key) ?? catalog.put(stopKind, key,
      {sourceId: data.sourceId, scheduleId: data.scheduleId, requestedAt: clock()});
    onChange();
    let result;
    try {
      const source = await find(data.sourceId);
      assertCurrent();
      if (source) result = await sendStop(source, intent, {assertCurrent, request});
    } catch (error) {
      assertCurrent();
      // A lost reply can follow a committed stop. Preserve the local intent
      // until its exact original worker acknowledges the stopped schedule.
    }
    assertCurrent();
    return result ?? overlay(known(data));
  }

  function validDispatch(source, entry, generation) {
    return active && epoch === generation && present.get(source.id) === entry;
  }

  function deliver(source, entry, generation, events) {
    const seen = new Set();
    for (const event of events) {
      if (!token(event?.id) || !token(event.scheduleId) || event.sourceId !== source.id || !event.scope) continue;
      if (notifications.has(event.id) || catalog.get(stopKind, stopKey(source.id, event.scheduleId))) continue;
      const schedule = cached(source.id)?.schedules.find(row => row.id === event.scheduleId);
      if (schedule?.kind !== 'wake_agent' || schedule.stopRequestedAt != null || !isDeepStrictEqual(event.scope, schedule.scope)) continue;
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

  async function pumpSource(source, entry, generation) {
    const relevant = record => record.sourceId === source.id;
    for (const intent of catalog.list(stopKind).filter(relevant)) {
      if (!validDispatch(source, entry, generation)) return;
      try { await sendStop(source, intent); } catch { /* retain the stop and exclude that schedule */ }
    }
    if (!validDispatch(source, entry, generation)) return;
    const skipScheduleIds = catalog.list(stopKind).filter(relevant).map(row => row.scheduleId);
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
      const pendingStop = catalog.list(stopKind).some(intent => intent.sourceId === source.id);
      const due = nextDispatch((state?.schedules ?? []).map(overlay));
      if (entry.ready && !pendingStop && due > now + entry.offset) {
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

  return {start, halt, pump, refresh, snapshot, upsert, status, stop};
}
