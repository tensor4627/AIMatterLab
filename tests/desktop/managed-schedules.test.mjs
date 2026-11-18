import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setImmediate as settled} from 'node:timers/promises';
import {createManagedComputeTools} from '../../agent/tools/managed-compute-tools.mjs';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createManagedSchedules} from '../../backend/main/compute/managed-schedules.mjs';
import {assertWorkerRoute, assertRendererWorkerRoute} from '../../contracts/transport-policy.mjs';

const scope = {provider: 'codex', threadId: 'origin-thread', taskId: 'origin-task', projectId: 'origin-project', runId: 'parent-run'};
const request = {sourceId: 'origin', scheduleId: 'plan'};
const stopKind = 'managed-schedule-stop';
const indexKind = 'managed-worker-snapshot';
const stopKey = 'origin/plan';
const plan = (fields = {}) => ({id: 'plan', sourceId: 'origin', scope, kind: 'poll', stateRevision: 1, revision: 1,
  status: 'scheduled', expiresAt: 2000, nextAt: 1100, active: null, stopRequestedAt: null, count: 0, maxRuns: 48, ...fields});
const scoped = request => ({assertCurrent() {}, request});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-managed-schedules-'));
  const catalog = new Catalog(root);
  t.after(() => { catalog.db.close(); fs.rmSync(root, {recursive: true, force: true}); });
  const state = {clock: 1000, schedules: [], deliveries: [], runs: [], calls: [], sources: [], changeCount: 0,
    wake: async () => false, hook: async () => undefined};
  function source(id = 'origin', generation = 'first') {
    return {id, generation, kind: 'ssh', profileId: 'profile-' + id, async request(_method, target, data) {
      const action = target.split('/').at(-1);
      state.calls.push({id, action, data});
      const override = await state.hook({id, action, data});
      if (override !== undefined) return override;
      if (action === 'upsert') {
        const row = plan({sourceId: id, kind: data.kind, scope: data.scope,
          key: data.key ?? data.kind, delegationId: data.delegationId ?? data.scope.taskId});
        state.schedules.push(row);
        return row;
      }
      if (action === 'stop') {
        const row = state.schedules.find(item => item.id === data.scheduleId && item.sourceId === id);
        assert.ok(row);
        row.status = 'stopped';
        row.stateRevision++;
        row.stopRequestedAt = state.clock;
        row.nextAt = null;
        return structuredClone(row);
      }
      if (action === 'ack') {
        state.deliveries = state.deliveries.filter(event => event.id !== data.deliveryId);
        return {id: data.deliveryId};
      }
      if (action === 'status') {
        return {...state.schedules.find(item => item.id === data.scheduleId && item.sourceId === id), history: []};
      }
      return {sourceId: id, observedAt: state.clock, runs: structuredClone(state.runs),
        schedules: structuredClone(state.schedules.filter(row => row.sourceId === id)),
        ...(action === 'pump' ? {deliveries: structuredClone(state.deliveries.filter(event => event.sourceId === id))} : {})};
    }};
  }
  function create() {
    const controller = createManagedSchedules({catalog, listSources: () => state.sources, clock: () => state.clock,
      setTimer: () => null, onChange: () => { state.changeCount++; }, wake: (...args) => state.wake(...args)});
    t.after(() => controller.halt());
    return controller;
  }
  async function start(controller) {
    controller.start();
    await controller.pump();
    await settled();
  }
  return {catalog, state, source, create, start};
}

test('idle and finished sources receive no recurring commands and refresh is passive', async t => {
  const f = fixture(t);
  f.state.sources = [f.source(), f.source('unrelated')];
  const controller = f.create();
  await f.start(controller);
  assert.deepEqual(f.state.calls.map(c => [c.id, c.action, c.data.resume]), [
    ['origin', 'pump', true], ['unrelated', 'pump', true],
  ]);
  f.state.calls.length = 0;
  const changes = f.state.changeCount;
  for (let i = 0; i < 60; i++) { f.state.clock += 3; await controller.pump(); }
  assert.deepEqual(f.state.calls, []);
  assert.equal(f.state.changeCount, changes);
  f.state.schedules = [plan({status: 'exhausted', count: 48, nextAt: null})];
  await controller.refresh('origin');
  assert.deepEqual(f.state.calls.map(c => c.action), ['snapshot']);
  assert.equal(controller.snapshot().sources[0].schedules[0].count, 48);
  f.state.clock += 300;
  await controller.pump();
  assert.deepEqual(f.state.calls.map(c => c.action), ['snapshot']);
});

test('upsert receipts must match the requested key and delegation as well as the owner', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  const controller = f.create();
  const data = {sourceId:'origin',kind:'poll',scope,key:'morning',delegationId:'user-turn'};
  for (const change of [{key:'evening'}, {delegationId:'another-turn'}]) {
    f.state.hook = async () => plan({...data,...change});
    await assert.rejects(controller.upsert(data), /unverified_reply/);
    assert.equal(controller.snapshot().sources.length, 0);
  }
  f.state.hook = async () => undefined;
  assert.equal((await controller.upsert(data)).key, 'morning');
});

test('only a due budget or an active receipt dispatches after normal discovery', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  f.state.schedules = [plan({nextAt: 1009})];
  const controller = f.create();
  await f.start(controller);
  f.state.calls.length = 0;
  for (const now of [1003, 1006]) {
    f.state.clock = now;
    await controller.pump();
  }
  assert.deepEqual(f.state.calls, []);
  f.state.clock = 1009;
  f.state.schedules = [plan({stateRevision: 2, status: 'running', count: 1, active: {nextCheckAt: 1020, jobId: 'child'}})];
  await controller.pump();
  assert.equal(f.state.calls[0].data.resume, false);
  assert.equal(controller.snapshot().sources[0].schedules[0].count, 1);
  f.state.clock = 1012;
  await controller.pump();
  assert.equal(f.state.calls.length, 1);
  f.state.clock = 1020;
  await controller.pump();
  assert.equal(f.state.calls.length, 2);
});

test('offline stop survives desktop restart and blocks workers until acknowledged', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  f.state.schedules = [plan()];
  const first = f.create();
  await f.start(first);
  f.state.sources = [];
  await first.pump();
  assert.equal(first.snapshot().sources[0].connected, false);
  const offline = await first.stop(request);
  assert.equal(offline.status, 'stopping');
  assert.equal(offline.stopPending, true);
  assert.equal((await first.status(request)).connected, false);
  assert.deepEqual(f.catalog.get(stopKind, stopKey), {...request, authority: 'desktop', kind: 'poll', scope, requestedAt: 1000});
  first.halt();

  const second = f.create();
  await f.start(second);
  assert.equal(second.snapshot().sources[0].schedules[0].stopPending, true);
  f.state.calls.length = 0;
  f.state.clock = 1200;
  f.state.sources = [f.source('replacement')];
  await second.pump();
  assert.deepEqual(f.state.calls.map(c => [c.id, c.action, c.data.skipScheduleIds]), [['replacement', 'pump', []]]);
  assert.equal(second.snapshot().sources.find(row => row.id === 'origin').schedules[0].status, 'stopping');
  f.state.calls.length = 0;
  f.state.sources = [f.source('origin', 'reconnected')];
  f.state.hook = async ({action}) => {
    if (action === 'stop') throw Error('acknowledgement unavailable');
  };
  await second.pump();
  assert.deepEqual(f.state.calls.map(c => c.action), ['stop', 'pump']);
  assert.deepEqual(f.state.calls[1].data.skipScheduleIds, ['plan']);
  assert.equal(second.snapshot().sources.find(row => row.id === 'origin').schedules[0].status, 'stopping');
  f.state.hook = async () => undefined;
  await second.pump();
  assert.deepEqual(f.state.calls.slice(-2).map(c => c.action), ['stop', 'pump']);
  assert.deepEqual(f.state.calls.at(-1).data.skipScheduleIds, []);
  assert.equal(second.snapshot().sources.find(row => row.id === 'origin').schedules[0].status, 'stopped');
  assert.equal(f.catalog.get(stopKind, stopKey), null);
});

test('an agent refusal has no desktop retry or cached status fallback', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  f.state.schedules = [plan()];
  const controller = f.create();
  await f.start(controller);
  f.state.calls.length = 0;
  const calls = [];
  const denied = scoped(async (_method, target) => {
    calls.push(target.split('/').at(-1));
    throw Error('managed_compute_project_grant_required');
  });
  await assert.rejects(controller.stop(request, denied), {message: 'managed_compute_project_grant_required', operationNotStarted: true});
  await assert.rejects(controller.status(request, denied), /managed_compute_project_grant_required/);
  assert.deepEqual(calls, ['stop', 'status']);
  assert.deepEqual(f.state.calls, []);
  assert.equal(f.catalog.get(stopKind, stopKey), null);
  assert.equal(controller.snapshot().sources[0].schedules[0].status, 'scheduled');

  f.state.sources = [];
  await assert.rejects(controller.status(request, denied), /managed_schedule_original_source_offline/);
  await assert.rejects(controller.stop(request, denied), /managed_schedule_original_source_offline/);
  assert.equal((await controller.status(request)).connected, false);
  assert.deepEqual(calls, ['stop', 'status']);
  f.state.sources = [f.source('origin', 'reconnected')];
  await controller.pump();
  assert.deepEqual(f.state.calls.map(c => [c.action, c.data.skipScheduleIds]), [['pump', []]]);
  assert.equal(f.catalog.get(stopKind, stopKey), null);
});

test('agent stops require their own request while a desktop stop is in flight', async t => {
  const f = fixture(t);
  const source = f.source();
  f.state.sources = [source];
  f.state.schedules = [plan()];
  const controller = f.create();
  await f.start(controller);
  f.state.calls.length = 0;
  const holdDesktop = Promise.withResolvers();
  f.state.hook = async ({action}) => { if (action === 'stop') return holdDesktop.promise; };
  const desktop = controller.stop(request);
  await settled();
  assert.deepEqual(f.state.calls.map(call => call.action), ['stop']);
  assert.equal(controller.snapshot().sources[0].schedules[0].status, 'stopping');

  const holdAgent = Promise.withResolvers();
  const calls = [];
  const firstAgent = scoped(async (method, target, payload) => {
    calls.push(['first', target]);
    return target.endsWith('/status') ? source.request(method, target, payload) : holdAgent.promise;
  });
  const observed = await controller.status(request, firstAgent);
  assert.equal(observed.status, 'scheduled');
  assert.equal(observed.stopRequestedAt, null);
  assert.equal(observed.stopPending, undefined);
  const stopping = controller.stop(request, firstAgent);
  await settled();
  const secondAgent = scoped(async (_method, target) => {
    calls.push(['second', target]);
    throw Error('managed_compute_project_grant_required');
  });
  await assert.rejects(controller.stop(request, secondAgent), /managed_compute_project_grant_required/);
  assert.deepEqual(calls, [['first', '/api/managed-schedules/status'], ['first', '/api/managed-schedules/stop'],
    ['second', '/api/managed-schedules/stop']]);

  const stopped = plan({status: 'stopped', stateRevision: 2, stopRequestedAt: 1000, nextAt: null});
  holdAgent.resolve(stopped);
  assert.equal((await stopping).status, 'stopped');
  holdDesktop.resolve(stopped);
  assert.equal((await desktop).status, 'stopped');
  assert.equal(f.catalog.get(stopKind, stopKey), null);
  await assert.rejects(controller.stop(request, secondAgent), /managed_compute_project_grant_required/);
  assert.deepEqual(calls.at(-1), ['second', '/api/managed-schedules/stop']);
});

test('scoped status and stop discard worker replies after the workflow lease changes', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  f.state.schedules = [plan()];
  const controller = f.create();
  await f.start(controller);
  const stored = f.catalog.get(indexKind, 'origin');
  for (const action of ['status', 'stop']) {
    const entered = Promise.withResolvers();
    const hold = Promise.withResolvers();
    let active = true;
    const operation = {assertCurrent() { if (!active) throw Error('The workflow tool lease changed'); },
      request() { entered.resolve(); return hold.promise; }};
    const rejected = assert.rejects(controller[action](request, operation), /workflow tool lease changed/);
    await entered.promise;
    active = false;
    hold.resolve(plan({stateRevision: 2, status: 'stopped', stopRequestedAt: 1001, history: [{occurrence: 1}]}));
    await rejected;
    assert.deepEqual(f.catalog.get(indexKind, 'origin'), stored);
    assert.equal(f.catalog.get(stopKind, stopKey), null);
  }
});

test('agent tool stops do not follow a changed service or fall back to a desktop request', async t => {
  const f = fixture(t);
  f.state.sources = [f.source(), f.source('replacement')];
  f.state.schedules = [plan()];
  const controller = f.create();
  await f.start(controller);
  f.state.calls.length = 0;
  let resolutions = 0;
  const resources = {owns: () => false, resolveService: async () => ({sourceId: resolutions++ ? 'replacement' : 'origin',
      supportsManagedSchedules: true}),
    serviceRequest() { assert.fail('The authorized source changed'); }};
  const tools = createManagedComputeTools({resources, schedules: controller, assertWorkflow: () => ({id: scope.taskId}), assertScheduleIntent: () => 'test-stop',
    assertRunSource: () => 'cluster-run'});
  await assert.rejects(tools.call('stop_task_schedule', {resource_id: 'ssh:profile-origin', schedule_id: 'plan'},
    {...scope, checkCurrent: () => true}), {message: 'The acquired resource changed its original service identity', operationNotStarted: true});
  assert.equal(resolutions, 2);
  assert.deepEqual(f.state.calls, []);
  assert.equal(f.catalog.get(stopKind, stopKey), null);
  const malformedOperation = {assertCurrent() {}};
  await assert.rejects(controller.stop(request, malformedOperation), /managed_schedule_invalid_request/);
  await assert.rejects(controller.status(request, malformedOperation), /managed_schedule_invalid_request/);
  assert.deepEqual(f.state.calls, []);
});

test('an unknown agent stop is reconciled by reading the original service', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  f.state.schedules = [plan()];
  const controller = f.create();
  await f.start(controller);
  const transportError = Error('terminal_service_unknown');
  await assert.rejects(controller.stop(request, scoped(async (_method, target) => {
    assert.equal(target, '/api/managed-schedules/stop');
    f.state.schedules = [plan({status: 'stopped', stateRevision: 2, stopRequestedAt: 1000, nextAt: null})];
    throw transportError;
  })), error => /task_schedule_status on the original service and schedule/.test(error.message) && error.cause === transportError);
  assert.equal(controller.snapshot().sources[0].schedules[0].status, 'scheduled');
  assert.equal(f.catalog.get(stopKind, stopKey), null);
  const original = f.source('origin', 'reconnected');
  f.state.sources = [original];
  f.state.calls.length = 0;
  assert.equal((await controller.status(request, scoped(original.request))).status, 'stopped');
  await controller.pump();
  assert.deepEqual(f.state.calls.map(c => [c.id, c.action]), [['origin', 'status'], ['origin', 'pump']]);
});

test('unmarked legacy stop intents pause the original schedule without replay', async t => {
  const f = fixture(t);
  f.state.sources = [f.source(), f.source('other')];
  f.state.schedules = [plan({kind: 'wake_agent', scope: {...scope, runId: null}, nextAt: 1001}),
    plan({sourceId: 'other'})];
  f.state.deliveries = [{id: 'due-wake', sourceId: 'origin', scheduleId: 'plan', scope: f.state.schedules[0].scope}];
  const delivered = [];
  f.state.wake = async event => { delivered.push(event); return true; };
  const legacy = {...request, requestedAt: 990};
  f.catalog.put(stopKind, stopKey, legacy);
  f.catalog.put(indexKind, 'origin', {id: 'origin', profileId: 'profile-origin', kind: 'ssh', observedAt: 995,
    runs: [], schedules: [f.state.schedules[0]]});
  const controller = f.create();
  await f.start(controller);
  assert.deepEqual(f.state.calls.map(c => [c.id, c.action, c.data.skipScheduleIds]), [
    ['origin', 'pump', ['plan']], ['other', 'pump', []],
  ]);
  assert.deepEqual(delivered, []);
  let cached = controller.snapshot().sources.find(row => row.id === 'origin').schedules[0];
  assert.equal(cached.stopNeedsConfirmation, true);
  assert.equal(cached.status, 'scheduled');
  assert.equal(cached.stopRequestedAt, null);
  assert.equal(cached.nextAt, null);
  assert.deepEqual(f.catalog.get(stopKind, stopKey), legacy);
  f.state.clock = 1001;
  await controller.pump();
  assert.equal(f.state.calls.length, 2);

  const receipt = await controller.stop(request);
  assert.equal(receipt.status, 'stopped');
  assert.equal(receipt.stopRequestedAt, 1001);
  assert.deepEqual(f.state.calls.slice(2).map(c => [c.id, c.action]), [['origin', 'stop']]);
  cached = controller.snapshot().sources.find(row => row.id === 'origin').schedules[0];
  assert.equal(cached.stopNeedsConfirmation, undefined);
  assert.equal(f.catalog.get(stopKind, stopKey), null);
});

test('a matched stopped receipt supersedes a legacy stop pause without another stop', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  f.state.schedules = [plan()];
  const controller = f.create();
  await f.start(controller);
  f.catalog.put(stopKind, stopKey, {...request, requestedAt: 995});
  assert.equal(controller.snapshot().sources[0].schedules[0].stopNeedsConfirmation, true);
  f.state.schedules = [plan({status: 'stopped', stateRevision: 2, stopRequestedAt: 999, nextAt: null})];
  f.state.calls.length = 0;
  assert.equal((await controller.status(request)).status, 'stopped');
  await controller.pump();
  assert.deepEqual(f.state.calls.map(c => c.action), ['status']);
  assert.equal(controller.snapshot().sources[0].schedules[0].stopNeedsConfirmation, undefined);
});

test('quitting rejects late dispatch results and leaves original worker records intact', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  f.state.schedules = [plan({nextAt: 1003})];
  const controller = f.create();
  await f.start(controller);
  const hold = Promise.withResolvers();
  f.state.hook = async ({action}) => { if (action === 'pump') return hold.promise; };
  f.state.clock = 1003;
  const ongoing = controller.pump();
  await settled();
  controller.halt();
  hold.resolve({sourceId: 'origin', observedAt: 1003, runs: [], schedules: [plan({stateRevision: 2, count: 1})],
    deliveries: []});
  await ongoing;
  assert.equal(controller.snapshot().sources[0].schedules[0].count, 0);
  assert.equal(controller.snapshot().sources[0].connected, false);
  await controller.pump();
  assert.equal(f.state.calls.length, 2);
});

test('delivers only exact originating wakes and retries busy delivery without another scheduler request', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  const otherScope = {...scope, threadId: 'another-thread'};
  f.state.schedules = [plan({kind: 'wake_agent'}), plan({id: 'plain', kind: 'poll'})];
  f.state.deliveries = [
    {id: 'alien', scheduleId: 'plan', sourceId: 'origin', scope: otherScope, text: 'Wrong thread'},
    {id: 'plain', scheduleId: 'plain', sourceId: 'origin', scope, text: 'Plain timer'},
    {id: 'due-wake', scheduleId: 'plan', sourceId: 'origin', scope, text: 'Check the approved output'},
  ];
  const delivered = [];
  f.state.wake = async event => { delivered.push(event); return delivered.length > 1; };
  const controller = f.create();
  await f.start(controller);
  assert.deepEqual(delivered.map(d => d.id), ['due-wake']);
  assert.deepEqual(f.state.calls.map(c => c.action), ['pump']);
  await controller.pump();
  await settled();
  assert.deepEqual(delivered.map(d => d.id), ['due-wake', 'due-wake']);
  assert.deepEqual(f.state.calls.map(c => c.action), ['pump', 'ack']);
  await controller.pump();
  await settled();
  assert.equal(delivered.length, 2);
});

test('fresh source generation and desktop suspension request a missed-round reconciliation', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  f.state.schedules = [plan({nextAt: 1010})];
  const controller = f.create();
  await f.start(controller);
  f.state.sources = [f.source('origin', 'another-generation')];
  await controller.pump();
  assert.equal(f.state.calls.at(-1).data.resume, true);
  f.state.clock = 1060;
  await controller.pump();
  assert.equal(f.state.calls.at(-1).data.resume, true);
  assert.equal(f.state.calls.length, 3);
});

test('stale pump cannot override a concurrent stop and route policy rejects generic renderer scheduling', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  f.state.schedules = [plan({nextAt: 1003})];
  const controller = f.create();
  await f.start(controller);
  const hold = Promise.withResolvers();
  f.state.hook = async ({action}) => { if (action === 'pump') return hold.promise; };
  f.state.clock = 1003;
  const ongoing = controller.pump();
  await settled();
  assert.equal((await controller.stop(request)).status, 'stopped');
  hold.resolve({sourceId: 'origin', observedAt: 1003, runs: [], schedules: [plan()], deliveries: []});
  await ongoing;
  assert.equal(controller.snapshot().sources[0].schedules[0].status, 'stopped');
  assert.doesNotThrow(() => assertWorkerRoute('POST', '/api/managed-schedules/pump'));
  assert.throws(() => assertRendererWorkerRoute('POST', '/api/managed-schedules/pump'));
  assert.doesNotThrow(() => assertRendererWorkerRoute('POST', '/api/cluster/observation'));
});

test('script source and receipts are available only on explicit connected detail reads', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  const script = {language: 'python', version: 2, sha256: 'fixture-hash'};
  f.state.schedules = [plan({kind: 'script', script})];
  const controller = f.create();
  await f.start(controller);
  f.state.hook = async ({action}) => {
    if (action === 'status') return plan({kind: 'script', script: {...script, text: 'print("fixture")\n'},
      history: [{occurrence: 1}]});
  };
  const detail = await controller.status(request);
  assert.equal(detail.script.text, 'print("fixture")\n');
  assert.equal(detail.history[0].occurrence, 1);
  assert.deepEqual(controller.snapshot().sources[0].schedules[0].script, script);
  f.state.sources = [];
  const offline = await controller.status(request);
  assert.equal(offline.connected, false);
  assert.deepEqual(offline.script, script);
});

test('status and stop reject malformed or mismatched original schedule receipts', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  f.state.schedules = [plan({stateRevision: 2})];
  const controller = f.create();
  await f.start(controller);
  const stored = f.catalog.get(indexKind, 'origin');
  const mismatches = [{sourceId: 'other'}, {id: 'other'}, {kind: 'action'}, {kind: 'unrecognized'}, {scope: []},
    {scope: {...scope, runId: null}}, {history: 'invalid'},
    ...Object.keys(scope).map(key => ({scope: {...scope, [key]: 'another'}}))];
  for (const fields of mismatches) {
    await assert.rejects(controller.status(request, scoped(async () => plan({stateRevision: 3, ...fields}))),
      /managed_schedule_unverified_reply/);
    await assert.rejects(controller.stop(request, scoped(async () => plan({stateRevision: 3, status: 'stopped',
      stopRequestedAt: 1000, nextAt: null, ...fields}))), error => error.cause?.message === 'managed_schedule_unverified_reply');
  }
  await assert.rejects(controller.stop(request, scoped(async () => plan({stateRevision: 3, status: 'stopped',
    stopRequestedAt: '1000'}))), error => error.cause?.message === 'managed_schedule_unverified_reply');

  f.state.schedules = [plan({scope: {...scope, runId: 'unrelated'}, stateRevision: 3})];
  await controller.refresh('origin');
  assert.deepEqual(f.catalog.get(indexKind, 'origin'), stored);
  assert.equal(f.catalog.get(stopKind, stopKey), null);
});

test('a stale status or stop reply cannot overwrite or return a newer cached record', async t => {
  const f = fixture(t);
  f.state.sources = [f.source()];
  f.state.schedules = [plan()];
  const controller = f.create();
  await f.start(controller);
  const hold = Promise.withResolvers();
  const staleStatus = assert.rejects(controller.status(request, scoped(() => hold.promise)), /managed_schedule_stale_reply/);
  await settled();
  f.state.schedules = [plan({status: 'stopped', stateRevision: 3, stopRequestedAt: 1000, nextAt: null})];
  await controller.refresh('origin');
  hold.resolve(plan());
  await staleStatus;
  const stale = plan({status: 'stopped', stateRevision: 2, stopRequestedAt: 1000, nextAt: null});
  await assert.rejects(controller.stop(request, scoped(async () => stale)), error => error.cause?.message === 'managed_schedule_stale_reply');
  assert.equal(controller.snapshot().sources[0].schedules[0].stateRevision, 3);
  assert.equal(f.catalog.get(stopKind, stopKey), null);
});

test('malformed cached rows cannot authorize a stop', async t => {
  const f = fixture(t);
  const row = plan({scope: {...scope, projectId: null}});
  f.catalog.put(indexKind, 'origin', {id: 'origin', schedules: [row]});
  const controller = f.create();
  assert.deepEqual(controller.snapshot().sources[0].schedules, []);
  await assert.rejects(controller.stop(request), /managed_schedule_not_in_original_source/);
  await assert.rejects(controller.status(request), /managed_schedule_not_in_original_source/);
  assert.equal(f.catalog.get(stopKind, stopKey), null);
  assert.deepEqual(f.catalog.get(indexKind, 'origin').schedules, [row]);
});

test('manual observation uses the exact exhausted plan and refreshes only the original worker record', async t => {
  const f = fixture(t);
  f.state.sources = [f.source(), f.source('another')];
  const exhausted = plan({status:'exhausted',count:48,nextAt:null});
  f.state.schedules = [exhausted, plan({id:'pending'})];
  const controller = f.create();
  await f.start(controller);
  f.state.calls.length = 0;
  const data = {...request,requestId:'human-click'};
  await assert.rejects(controller.observeOnce({...data,scheduleId:'pending'}),/exhausted_monitor/);
  await assert.rejects(controller.observeOnce({...data,sourceId:'another'}),/original_source/);
  assert.equal(f.state.calls.length,0);
  const completed = {id:scope.runId,projectId:scope.projectId,status:'succeeded',scheduler:'slurm',observedAt:1000};
  f.state.hook = async ({action}) => {
    if (action === 'observe-once') return {...data,status:'observed',run:completed,
      snapshot:{sourceId:'origin',observedAt:1000,schedules:f.state.schedules,runs:[completed]}};
  };
  assert.deepEqual(await controller.observeOnce(data),{...data,status:'observed',run:completed});
  const snapshots = controller.snapshot().sources;
  assert.deepEqual(snapshots.find(source => source.id === 'origin').runs,[completed]);
  assert.equal(snapshots.find(source => source.id === 'origin').schedules[0].count,48);
  assert.deepEqual(f.state.calls,[{id:'origin',action:'observe-once',data}]);
  assert.throws(() => assertRendererWorkerRoute('POST','/api/managed-schedules/observe-once'));
});
