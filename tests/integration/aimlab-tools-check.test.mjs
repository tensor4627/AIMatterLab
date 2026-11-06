import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const checkScript = path.join(repositoryRoot, 'scripts/check-aimlab-tools.mjs');
const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
const gitOptions = ['-c', 'user.name=AimLab check fixture', '-c', 'user.email=aimlab-check@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'core.hooksPath=' + nullDevice];

function git(root, args) {
  return execFileSync('git', [...gitOptions, '-C', root, ...args], {encoding: 'utf8', windowsHide: true, timeout: 60000});
}

function write(root, name, text) {
  const target = path.join(root, ...name.split('/'));
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, text);
}

function manifest() {
  return {
    schema_version: 1,
    id: 'demo-tool',
    name: 'Demo tool',
    environment: {hardware: 'cpu', requirements: ['Python 3'], parallelism: {supported: ['serial']}},
    functions: [{
      id: 'demo.run',
      name: 'Demo run',
      description: 'Run the demo program',
      entrypoint: 'tool.py',
      inputs: [],
      outputs: [{
        id: 'result',
        type: 'file',
        format: 'json',
        description: 'JSON receipt',
        required: true,
        display: {priority: 100, advanced: false, reason: 'Main result'}
      }],
      parameters: [],
      operation: {command: ['{python}', '{entrypoint}'], failure_handling: 'Inspect the receipt and logs before retrying.'},
      tests: ['basic']
    }],
    tests: {
      cases: [{
        id: 'basic',
        function_id: 'demo.run',
        directory: 'aimlab-tools/tests/basic',
        instructions: 'aimlab-tools/tests/basic/README.md',
        entrypoint: 'aimlab-tools/tests/basic/run-test.py',
        resources: [],
        expected_outputs: [{path: 'receipt.json', format: 'json', description: 'JSON receipt written by the wrapper.'}],
        pass_criteria: ['Exit code 0', 'receipt.json parses']
      }]
    }
  };
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aimlab-tools-check-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  write(root, 'tool.py', 'print("ok")\n');
  write(root, 'aimlab-tools/SKILL.md', '---\nname: demo-tool-delivery\ndescription: Operate the demo tool.\n---\n\n# Demo tool\n\nRun tool.py with the selected Python 3 interpreter.\n');
  write(root, 'aimlab-tools/manual.md', '# Demo tool\n\nRun the program and keep its receipt.\n');
  write(root, 'aimlab-tools/tests/README.md', '# Demo tests\n\n| Function | Case |\n| --- | --- |\n| demo.run | basic |\n');
  write(root, 'aimlab-tools/tests/basic/README.md', '# Basic case\n\nRun the wrapper; expect a JSON receipt.\n');
  write(root, 'aimlab-tools/tests/basic/run-test.py', 'print("{}")\n');
  write(root, 'aimlab-tools/manifest.json', JSON.stringify(manifest(), null, 2) + '\n');
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'Add AimLab internal tool declaration']);
  return {root, commit: git(root, ['rev-parse', 'HEAD']).trim()};
}

function runCheck(args) {
  return spawnSync(process.execPath, [checkScript, ...args], {encoding: 'utf8', windowsHide: true, timeout: 120000});
}

test('the internal declaration check passes on a committed tool repository', t => {
  const fixture = createFixture(t);
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
  const fixture = createFixture(t);
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
