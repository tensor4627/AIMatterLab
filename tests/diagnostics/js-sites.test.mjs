import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const extractor = path.join(root, 'scripts', 'diagnostics', 'js-sites.mjs');

function scan(cwd, files) {
  const result = spawnSync(process.execPath, [extractor], {
    cwd, input: JSON.stringify(files), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const rows = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const coordinates = rows.map(({path: file, line, column}) => `${file}:${line}:${column}`);
  assert.equal(new Set(coordinates).size, rows.length);
  assert(rows.every(row => row.line > 0 && row.column > 0 && row.owner && typeof row.guard === 'string'));
  return rows;
}

test('extracts structured gates, helper calls and visible UI failures', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-js-sites-'));
  const frontend = path.join(dir, 'frontend');
  fs.mkdirSync(frontend);
  const helperFile = path.join(dir, 'helpers.mjs');
  const panelFile = path.join(frontend, 'Panel.tsx');
  t.after(() => {
    fs.unlinkSync(panelFile);
    fs.unlinkSync(helperFile);
    fs.rmdirSync(frontend);
    fs.rmdirSync(dir);
  });
  fs.writeFileSync(helperFile, `
export class TerminalFault extends Error {}
export function fail(code) { throw new TerminalFault(code); }
export function fixed() { throw Error('Failure in fixed helper'); }
export function result(status, reason) { return {status, reason}; }
`, 'utf8');
  fs.writeFileSync(panelFile, `
import {fail as deny, fixed, result, TerminalFault} from '../helpers.mjs';
const errorMessages = Object.freeze({
  ACCELERATOR_NOT_READY: '加速器不可用',
  ACCESS_NEEDS_REVIEW: ['access', '先核对权限'],
});
export function Panel({enabled, status, items, mode}) {
  if (!enabled) return null;
  try {
    switch (mode) {
      case 'remote':
        for (const item of items) if (!item) deny('missing_remote_item');
        break;
      case 'fixed': fixed(); break;
      default: return result('blocked', mode === 'local' ? 'Local target required' : 'Remote target required');
    }
  } catch (error) {
    setError(error);
    throw error;
  }
  return <>
    <p role="status">{t(status === 'failed' ? 'Run failed' : 'Run complete')}</p>
    <div className="approval" role="alert">{t('Need your decision')}</div>
    <button>{t('Read diagnostics')}</button>
    {status === 'blocked' && <p role="alert">{t(errorMessages.ACCELERATOR_NOT_READY)}</p>}
  </>;
}
function read() {
  const warnings = [];
  warnings.push('Prepared output needs validation');
  return new Promise((resolve, reject) => {
    function finish(error, value) { return error ? reject(error) : resolve(value); }
    setTimeout(() => finish(new TerminalFault('prepare_timeout')), 100);
  });
}
function cleanup(ok) {
  if (!ok) process.exitCode = 1;
  process.exit(0);
}
`, 'utf8');

  const rows = scan(dir, ['helpers.mjs', 'frontend\\Panel.tsx', 'frontend/Panel.tsx', 'tests/ignored.test.mjs', 'types.d.ts']);
  const rowFor = (signal, kind) => rows.find(row => row.signal === signal && row.kind === kind);
  const fail = rowFor("deny('missing_remote_item')", 'throw');
  assert(fail);
  assert.equal(fail.owner, 'Panel');
  assert.match(fail.guard, /enabled.*switch \(mode\) case 'remote'.*for \(const item of items\).*!item/);
  assert.equal(rowFor('fixed()', 'throw')?.definition, "Error('Failure in fixed helper')");
  assert.match(rows.find(row => row.kind === 'result' && row.signal.startsWith("result('blocked'"))?.guard, /switch \(mode\) default/);
  const forwarded = rows.filter(row => row.signal === 'error' && row.kind === 'forward' && row.owner === 'Panel');
  assert.equal(forwarded.length, 2);
  assert(forwarded.every(row => row.guard.includes('catch (error)')));
  assert.match(rowFor("'Run failed'", 'ui')?.guard, /status === 'failed'/);
  assert(rowFor('t(errorMessages.ACCELERATOR_NOT_READY)', 'ui'));
  assert(!rows.some(row => /Run complete|Need your decision|Read diagnostics/.test(row.signal)));
  assert.deepEqual(rows.filter(row => row.kind === 'catalog').map(row => row.key), ['ACCELERATOR_NOT_READY', 'ACCESS_NEEDS_REVIEW']);
  assert(rowFor("warnings.push('Prepared output needs validation')", 'warning'));
  assert.match(rowFor("new TerminalFault('prepare_timeout')", 'reject')?.guard, /setTimeout\(\.\.\., 100\)/);
  assert.equal(rows.filter(row => row.signal.includes('prepare_timeout')).length, 1);
  assert.deepEqual(rows.filter(row => row.kind === 'exit').map(row => row.signal), ['process.exitCode = 1']);
});

test('keeps each shared deployment and roadmap gate in the inventory', () => {
  const deployment = 'contracts/compute/deployment-authorization.mjs';
  const roadmap = 'contracts/workflows/roadmap.mjs';
  const local = 'contracts/workflows/local-review-eligibility.mjs';
  const rows = scan(root, [deployment, roadmap, local]);
  const gates = rows.filter(row => row.path === deployment && row.kind === 'result' && row.owner === 'deploymentProjectIssue');
  const gateCodes = gates.map(row => /code:'([^']+)'/.exec(row.signal)?.[1]);
  assert.deepEqual([...new Set(gateCodes)], [
    'compute-project-required', 'engine', 'target-required', 'target', 'gpu', 'duration',
  ]);
  const sourceReturns = fs.readFileSync(path.join(root, deployment), 'utf8').match(/return\s*\{\s*code\s*:/g);
  assert.equal(gates.length, sourceReturns.length);
  assert.match(gates[2].signal, /remote\?'请选择已登记的集群。':'请选择已登记的计算环境。'/);
  assert(gates.some(row => /!policy.gpus.includes\((?:config\.)?gpu\)/.test(row.guard)));
  const findings = rows.filter(row => row.path === roadmap && row.kind === 'result' && row.signal.startsWith('findings.push'));
  assert.equal(findings.length, 7);
  const localChecks = rows.filter(row => row.path === local && row.kind === 'result' && row.signal.includes('LOCAL_REVIEW_'));
  assert.equal(localChecks.length, 5);
  assert.match(localChecks[0].guard, /savedMode==='opes'/);
});

test('keeps default configuration and successful UI branches out of the diagnostic rows', () => {
  const main = 'desktop/main.mjs';
  const page = 'frontend/features/workflows/AgentTaskPage.tsx';
  const ssh = 'frontend/features/compute/ssh-connection-types.ts';
  const rows = scan(root, [main, page, ssh, 'frontend/ui/i18n.ts']);
  assert(!rows.some(row => row.kind === 'catalog' && row.path === main && ['workerRoot', 'codexPath'].includes(row.key)));
  const copy = rows.filter(row => row.path === page && row.kind === 'ui').map(row => row.signal).join('\n');
  assert(!copy.includes('当前参数复核完成，可配置部署。'));
  assert(!copy.includes('参数正在保存，可以先查看部署设置。'));
  assert(!copy.includes('Agent 正在同步当前会话，完成后可打开部署。'));
  assert(copy.includes('当前版本尚未复核'));
  assert(copy.includes('仍有缺项'));
  const statusKeys = rows.filter(row => row.path === ssh && row.owner === 'sshStateLabel' && row.kind === 'catalog').map(row => row.key);
  assert(statusKeys.includes('failed'));
  assert(statusKeys.includes('disconnected'));
  assert(!statusKeys.some(key => ['authenticated', 'verified', 'connected', 'connecting', 'ready'].includes(key)));
  assert(!rows.some(row => row.path === 'frontend/ui/i18n.ts' && row.kind === 'catalog'));
});
