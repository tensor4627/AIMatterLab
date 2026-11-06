import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createAimlabToolRegistry} from '../../backend/main/tools/aimlab-source.mjs';
import {registerAimlabToolSourceRoutes} from '../../backend/main/tools/aimlab-routes.mjs';
import {createAimlabToolFixture, git} from '../helpers/aimlab-tools-fixture.mjs';

function harness(t) {
  const handlers = new Map();
  const handle = (name, fn) => {
    assert(name.startsWith('tools.aimlab.'));
    assert(!handlers.has('studio:' + name));
    handlers.set(name, fn);
  };
  const catalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aimlab-routes-'));
  const catalog = new Catalog(path.join(catalogRoot, 'catalog'));
  t.after(() => {
    catalog.db.close();
    fs.rmSync(catalogRoot, {recursive: true, force: true});
  });
  const sources = createAimlabToolRegistry({catalog});
  registerAimlabToolSourceRoutes({handle, sources, chooseSourceDirectory: async () => '/chosen/source'});
  return {handlers};
}

test('the typed aimlab routes inspect, register, list and read an external committed source', async t => {
  const fixture = createAimlabToolFixture(t);
  const {handlers} = harness(t);
  assert.deepEqual([...handlers.keys()].sort(), [
    'tools.aimlab.choose',
    'tools.aimlab.sources.inspect',
    'tools.aimlab.sources.list',
    'tools.aimlab.sources.read',
    'tools.aimlab.sources.register',
    'tools.aimlab.sources.update'
  ]);
  assert.deepEqual(await handlers.get('tools.aimlab.choose')({}), {source_root: '/chosen/source'});
  const inspected = await handlers.get('tools.aimlab.sources.inspect')({source_root: fixture.root, commit: fixture.commit});
  assert.equal(inspected.status, 'passed');
  assert.equal(inspected.id, 'demo-tool');
  assert.equal(inspected.installation.status, 'not_run');
  const registered = await handlers.get('tools.aimlab.sources.register')({source_root: fixture.root, commit: fixture.commit});
  assert.equal(registered.tool_id, 'demo-tool');
  assert.equal(registered.revision, 1);
  assert.equal(registered.version.scope, 'definition_checked');
  const listed = await handlers.get('tools.aimlab.sources.list')({});
  assert.deepEqual(listed.map(item => item.tool_id), ['demo-tool']);
  const read = await handlers.get('tools.aimlab.sources.read')({tool_id: 'demo-tool'});
  assert.equal(read.version.source_commit, fixture.commit);
  assert.equal(read.version.installation.status, 'not_run');
  assert.equal(git(fixture.root, ['status', '--porcelain']).trim(), '');
});

test('the typed aimlab routes reject malformed or unknown requests', async t => {
  const fixture = createAimlabToolFixture(t);
  const {handlers} = harness(t);
  const inspect = handlers.get('tools.aimlab.sources.inspect');
  await assert.rejects(() => inspect({}), /Invalid source_root/);
  await assert.rejects(() => inspect({source_root: fixture.root, extra: true}), /Invalid typed request/);
  await assert.rejects(() => handlers.get('tools.aimlab.sources.list')({value: 1}), /Empty typed request required/);
  await assert.rejects(() => handlers.get('tools.aimlab.sources.read')({tool_id: 'demo-tool', declaration_sha256: 'bad'}), /Invalid declaration_sha256/);
  await assert.rejects(() => handlers.get('tools.aimlab.sources.update')({tool_id: 'demo-tool', source_root: fixture.root, expected_revision: 0}), /Invalid expected_revision/);
});
