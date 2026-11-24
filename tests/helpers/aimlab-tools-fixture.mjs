import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
const gitOptions = ['-c', 'user.name=AimLab check fixture', '-c', 'user.email=aimlab-check@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'core.hooksPath=' + nullDevice];

export function git(root, args) {
  return execFileSync('git', [...gitOptions, '-C', root, ...args], {encoding: 'utf8', windowsHide: true, timeout: 60000});
}

export function aimlabManifest() {
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

function write(root, name, text) {
  const target = path.join(root, ...name.split('/'));
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, text);
}

export function createAimlabToolFixture(t, {manifest = aimlabManifest()} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aimlab-tools-fixture-'));
  t.after(() => {
    function unlock(p) {
      try {
        const st = fs.lstatSync(p);
        if (st.isDirectory()) { for (const e of fs.readdirSync(p)) unlock(path.join(p, e)); fs.chmodSync(p, 0o700); }
        else if (!st.isSymbolicLink()) fs.chmodSync(p, 0o600);
      } catch {}
    }
    unlock(root);
    fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
  });
  write(root, 'tool.py', 'print("ok")\n');
  write(root, 'aimlab-tools/SKILL.md', '---\nname: demo-tool-delivery\ndescription: Operate the demo tool.\n---\n\n# Demo tool\n\nRun tool.py with the selected Python 3 interpreter.\n');
  write(root, 'aimlab-tools/manual.md', '# Demo tool\n\nRun the program and keep its receipt.\n');
  write(root, 'aimlab-tools/tests/README.md', '# Demo tests\n\n| Function | Case |\n| --- | --- |\n| demo.run | basic |\n');
  write(root, 'aimlab-tools/tests/basic/README.md', '# Basic case\n\nRun the wrapper; expect a JSON receipt.\n');
  write(root, 'aimlab-tools/tests/basic/run-test.py', 'print("{}")\n');
  write(root, 'aimlab-tools/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'Add AimLab internal tool declaration']);
  return {root, commit: git(root, ['rev-parse', 'HEAD']).trim()};
}
