import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setImmediate as settled} from 'node:timers/promises';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createManagedSchedules} from '../../backend/main/compute/managed-schedules.mjs';
import {assertWorkerRoute, assertRendererWorkerRoute} from '../../contracts/transport-policy.mjs';

const scope = {provider: 'codex', threadId: 'origin-thread', taskId: 'origin-task', projectId: 'origin-project', runId: 'parent-run'};
const request = {sourceId: 'origin', scheduleId: 'plan'};
const plan = (fields = {}) => ({id: 'plan', sourceId: 'origin', scope, kind: 'poll', stateRevision: 1, revision: 1,
  status: 'scheduled', expiresAt: 2000, nextAt: 1100, active: null, stopRequestedAt: null, count: 0, maxRuns: 48, ...fields});

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
        const row = plan({sourceId: id, kind: data.kind, scope: data.scope});
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
  return {state, source, create, start};
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
  first.halt();

  const second = f.create();
  await f.start(second);
  assert.equal(second.snapshot().sources[0].schedules[0].stopPending, true);
  f.state.calls.length = 0;
  f.state.clock = 1200;
  f.state.sources = [f.source('origin', 'reconnected')];
  f.state.hook = async ({action}) => {
    if (action === 'stop') throw Error('acknowledgement unavailable');
  };
  await second.pump();
  assert.deepEqual(f.state.calls.map(c => c.action), ['stop', 'pump']);
  assert.deepEqual(f.state.calls[1].data.skipScheduleIds, ['plan']);
  assert.equal(second.snapshot().sources[0].schedules[0].status, 'stopping');
  f.state.hook = async () => undefined;
  await second.pump();
  assert.deepEqual(f.state.calls.slice(-2).map(c => c.action), ['stop', 'pump']);
  assert.deepEqual(f.state.calls.at(-1).data.skipScheduleIds, []);
  assert.equal(second.snapshot().sources[0].schedules[0].status, 'stopped');
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
