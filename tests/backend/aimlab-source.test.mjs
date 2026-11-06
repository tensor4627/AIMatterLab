import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createAimlabToolRegistry, inspectAimlabSource} from '../../backend/main/tools/aimlab-source.mjs';
import {createAimlabToolFixture, git} from '../helpers/aimlab-tools-fixture.mjs';

test('inspect returns declaration identity and the normalized package shape', t => {
  const fixture = createAimlabToolFixture(t);
  const report = inspectAimlabSource({repo_root: fixture.root, commit: fixture.commit});
  assert.equal(report.status, 'passed');
  assert.equal(report.scope, 'aimlab_tools_declaration');
  assert.equal(report.definition_checked, true);
  assert.equal(report.id, 'demo-tool');
  assert.equal(report.source_commit, fixture.commit);
  assert.equal(report.source_repo_root, fs.realpathSync(fixture.root));
  assert.equal(report.declaration_sha256.length, 64);
  assert.equal(report.package_shape.repository.path, 'demo-tool');
  assert.equal(report.package_shape.repository.commit, fixture.commit);
  assert.equal(report.package_shape.tests.directory, 'demo-tool-tests');
  assert.equal(report.package_shape.functions.length, 1);
  assert.equal(report.package_shape.tests.cases.length, 1);
  assert.equal(report.installation.status, 'not_run');
  assert.equal(report.tests.status, 'not_run');
});

test('the registry registers external declarations without copying the tool repository', t => {
  const fixture = createAimlabToolFixture(t);
  const catalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aimlab-tools-catalog-'));
  const catalog = new Catalog(path.join(catalogRoot, 'catalog'));
  t.after(() => {
    catalog.db.close();
    fs.rmSync(catalogRoot, {recursive: true, force: true});
  });
  const registry = createAimlabToolRegistry({catalog});

  const registered = registry.register({repo_root: fixture.root, commit: fixture.commit});
  assert.equal(registered.tool_id, 'demo-tool');
  assert.equal(registered.revision, 1);
  assert.equal(registered.versions.length, 1);
  assert.equal(registered.version.scope, 'definition_checked');
  assert.equal(registered.version.installation.status, 'not_run');
  assert.equal(registered.version.tests.status, 'not_run');
  assert.equal(registered.version.package_shape.repository.commit, fixture.commit);
  assert.equal(fs.existsSync(path.join(catalogRoot, 'demo-tool')), false);
  assert.deepEqual(registry.list().map(item => item.tool_id), ['demo-tool']);
  assert.equal(registry.read({tool_id: 'demo-tool'}).version.declaration_sha256, registered.version.declaration_sha256);

  const manifestPath = path.join(fixture.root, 'aimlab-tools', 'manifest.json');
  const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  value.name = 'Demo tool v2';
  fs.writeFileSync(manifestPath, JSON.stringify(value, null, 2) + '\n');
  git(fixture.root, ['add', '.']);
  git(fixture.root, ['commit', '--quiet', '-m', 'Update internal declaration']);
  const nextCommit = git(fixture.root, ['rev-parse', 'HEAD']).trim();

  const updated = registry.update({tool_id: 'demo-tool', repo_root: fixture.root, commit: nextCommit, expected_revision: 1});
  assert.equal(updated.revision, 2);
  assert.equal(updated.versions.length, 2);
  assert.equal(updated.version.source_commit, nextCommit);
  const previous = registry.read({tool_id: 'demo-tool', declaration_sha256: registered.version.declaration_sha256});
  assert.equal(previous.version.source_commit, fixture.commit);
  assert.equal(previous.version.manifest.name, 'Demo tool');
  assert.equal(git(fixture.root, ['status', '--porcelain']).trim(), '');
});
