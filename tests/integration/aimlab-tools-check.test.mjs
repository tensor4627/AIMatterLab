import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createAimlabToolFixture, git} from '../helpers/aimlab-tools-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const checkScript = path.join(repositoryRoot, 'scripts/check-aimlab-tools.mjs');
const verifyScript = path.join(repositoryRoot, 'scripts/verify-aimlab-sources.mjs');

function runCheck(args, script = checkScript) {
  return spawnSync(process.execPath, [script, ...args], {encoding: 'utf8', windowsHide: true, timeout: 120000});
}

test('the internal declaration check passes on a committed tool repository', t => {
  const fixture = createAimlabToolFixture(t);
  const reportDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'aimlab-tools-report-'));
  t.after(() => fs.rmSync(reportDirectory, {recursive: true, force: true}));
  const reportPath = path.join(reportDirectory, 'report.json');
  const result = runCheck(['--repo', fixture.root, '--commit', fixture.commit, '--out', reportPath]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.scope, 'aimlab_tools_declaration');
  assert.equal(receipt.definition_checked, true);
  assert.equal(receipt.id, 'demo-tool');
  assert.equal(receipt.source_commit, fixture.commit);
  assert.equal(receipt.worktree_dirty, false);
  assert.equal(receipt.function_count, 1);
  assert.equal(receipt.test_case_count, 1);
  assert.equal(receipt.installation.status, 'not_run');
  assert.equal(receipt.tests.status, 'not_run');
  assert.equal(receipt.release.status, 'not_run');
  assert(receipt.files.some(file => file.path === 'aimlab-tools/manifest.json'));
  assert(receipt.files.some(file => file.path === 'tool.py'));
  const saved = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(saved.declaration_sha256, receipt.declaration_sha256);
  assert.equal(git(fixture.root, ['status', '--porcelain']).trim(), '');
});

test('the check fails when a declared test resource is missing from the commit', t => {
  const fixture = createAimlabToolFixture(t);
  const manifestPath = path.join(fixture.root, 'aimlab-tools', 'manifest.json');
  const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  value.tests.cases[0].resources = ['tests/missing-data'];
  fs.writeFileSync(manifestPath, JSON.stringify(value, null, 2) + '\n');
  git(fixture.root, ['add', '.']);
  git(fixture.root, ['commit', '--quiet', '-m', 'Declare a missing test resource']);
  const result = runCheck(['--repo', fixture.root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing/);
  assert.equal(git(fixture.root, ['status', '--porcelain']).trim(), '');
});

test('the multi-source verification aggregates committed sources and reports failures', t => {
  const first = createAimlabToolFixture(t);
  const second = createAimlabToolFixture(t);
  const passed = runCheck(['--repo', first.root, '--repo', second.root], verifyScript);
  assert.equal(passed.status, 0, passed.stderr);
  const receipt = JSON.parse(passed.stdout);
  assert.equal(receipt.scope, 'aimlab_tools_sources');
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.source_count, 2);
  assert.equal(receipt.failed_count, 0);
  assert.deepEqual(receipt.sources.map(item => item.id), ['demo-tool', 'demo-tool']);
  assert.equal(receipt.installation.status, 'not_run');

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'aimlab-tools-empty-'));
  t.after(() => fs.rmSync(empty, {recursive: true, force: true}));
  const failed = runCheck(['--repo', first.root, '--repo', empty], verifyScript);
  assert.equal(failed.status, 1);
  const failedReceipt = JSON.parse(failed.stdout);
  assert.equal(failedReceipt.status, 'failed');
  assert.equal(failedReceipt.source_count, 2);
  assert.equal(failedReceipt.failed_count, 1);
});
