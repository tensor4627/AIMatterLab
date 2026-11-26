import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  prepareSshServiceResources, prepareSshServiceResourcesAsync,
} from '../../backend/main/compute/ssh-service-resources.mjs';
import {WorkerClient} from '../../backend/main/compute/worker.mjs';
import {deltaBundle} from '../../desktop/platform/terminal-service/worker-delta.mjs';
import {bundledWorkerRuntimeId} from '../../backend/main/compute/worker-service-version.mjs';

const names = [
  'bootstrap.py', 'install.py', 'runtime_resources.py', 'ssh_service_bootstrap.py', 'ssh_service_bridge.py',
  'studio_worker/engine_contracts.json', 'studio_worker/pygas-editor-hints.json',
  'studio_worker/server.py', 'studio_worker/tool_package.schema.json',
];

function file(root, name, contents) {
  const absolute = path.join(root, name);
  fs.mkdirSync(path.dirname(absolute), {recursive: true});
  fs.writeFileSync(absolute, contents);
  return absolute;
}

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'aimlab-worker-overlay-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), parent);
    fs.rmSync(root, {recursive: true});
  });
  // A directory represents Electron's virtual ASAR view in this Node test.
  const inventory = path.join(root, 'resources/app.asar/worker');
  const source = path.join(root, 'resources/app.asar.unpacked/worker');
  for (const name of names) {
    file(inventory, name, 'expected ' + name);
    file(source, name, 'expected ' + name);
  }
  const obsolete = new Map([
    [file(source, 'studio_worker/authoring_workspace.py', 'previous packaged module'), 'previous packaged module'],
    [file(source, 'studio_worker/unowned.py', 'locally edited or unowned file'), 'locally edited or unowned file'],
    [file(source, 'studio_worker/__pycache__/authoring_workspace.pyc', 'obsolete cache'), 'obsolete cache'],
  ]);
  const transportSource = path.join(root, 'terminal-service/python');
  file(transportSource, 'bootstrap.py', '# transport bootstrap');
  file(transportSource, 'bridge.py', '# transport bridge');
  return {source, inventory, obsolete, transportSource};
}

function assertRetained({obsolete}) {
  for (const [name, contents] of obsolete) assert.equal(fs.readFileSync(name, 'utf8'), contents);
}

test('a stale unpacked worker only hashes and transfers current ASAR files', async t => {
  const input = fixture(t);
  const expected = bundledWorkerRuntimeId(input.inventory);
  assert.match(expected, /^[a-f0-9]{20}$/);
  assert.equal(bundledWorkerRuntimeId(input.source), expected);
  const settings = {profileId:'owned-fixture', transportSource:input.transportSource};
  const result = await prepareSshServiceResourcesAsync(input.source,settings);
  assert.equal(result.payload.expected_runtime_id, expected);
  assert.deepEqual(result.payload.files.map(row => row.path), names);
  const previousInventory = result.payload.files.map(({base64,...row}) => row);
  previousInventory.push({...previousInventory[0],path:'studio_worker/authoring_workspace.py'});
  const delta = deltaBundle(result.payload, previousInventory);
  assert.equal(delta.sourceBytes, 0);
  assert.deepEqual(JSON.parse(gunzipSync(delta.packed)).manifest.map(row => row.path), names);
  const cached = prepareSshServiceResources(input.source, {...settings,reuseOnly:true,verifiedCacheOnly:true});
  assert.equal(cached.payload.expected_runtime_id, expected);
  assert.equal(cached.payload.runtime_manifest_sha256.slice(0,20), expected);
  assert.deepEqual(cached.payload.files, []);
  assertRetained(input);
});

test('the WSL worker receives only indexed sources and staging is removed', async t => {
  const input = fixture(t);
  const expected = bundledWorkerRuntimeId(input.inventory);
  let staged;
  const worker = new WorkerClient({host:{execute:async (_file, args) => {
    const sourceFlag = args.indexOf('--source');
    if (sourceFlag < 0) return {stdout:JSON.stringify({health:{root:'/fixture'},url:'http://127.0.0.1'})};
    const mount = args[sourceFlag + 1];
    staged = process.platform==='win32' ? mount.replace(/^\/mnt\/([a-z])\//, '$1:/') : mount;
    assert(staged && !fs.existsSync(path.join(staged, 'studio_worker/authoring_workspace.py')));
    assert(!fs.existsSync(path.join(staged,'studio_worker/__pycache__')));
    assert.equal(bundledWorkerRuntimeId(staged), expected);
    return {stdout:JSON.stringify({path:'/fixture/runtimes/' + expected})};
  }}});
  worker.attachTransport = (_settings, health) => health;
  t.after(() => worker.close());
  await worker.open({distribution:'test-fixture',workerRoot:'/fixture',workerPort:24680},input.source);
  assert(staged);
  assert(!fs.existsSync(staged));
  assert.equal(worker.connectedSource,input.source);
  assertRetained(input);
});

test('a packaged worker will not substitute unindexed files for missing current files', t => {
  const input = fixture(t);
  fs.unlinkSync(path.join(input.source, 'studio_worker/server.py'));
  assert.equal(bundledWorkerRuntimeId(input.source), null);
  assert.throws(() => prepareSshServiceResources(input.source,{profileId:'owned-fixture'}),/ENOENT|source/);
  assertRetained(input);
});

