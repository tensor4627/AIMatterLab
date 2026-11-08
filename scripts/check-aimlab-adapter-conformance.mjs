#!/usr/bin/env node
/** Read-only conformance check between AimLab production declarations and built-in Studio engine contracts. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectAimlabSource} from '../backend/main/tools/aimlab-source.mjs';
import {checkAimlabAdapterConformance, summarizeConformance} from '../backend/main/tools/aimlab-conformance.mjs';

const usage = () => 'Usage: node scripts/check-aimlab-adapter-conformance.mjs --repo <tool-repository> [--repo <tool-repository> ...] [--allow-pending] [--out <new-report.json>]';
const fail = message => { throw Error('aimlab_conformance: ' + message); };

function parseArguments(argv) {
  const options = {repos: [], out: null, allowPending: false, help: false};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--repo' || argument === '--out') {
      const value = argv[index + 1];
      if (!value) fail(argument + ' requires a value');
      if (argument === '--repo') options.repos.push(value);
      else options.out = value;
      index += 1;
    } else if (argument === '--allow-pending') {
      options.allowPending = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      fail('unknown argument ' + argument);
    }
  }
  return options;
}

function resolveReportPath(output) {
  if (!path.isAbsolute(output)) fail('--out must be an absolute path');
  if (fs.existsSync(output)) fail('--out already exists; choose a new report path');
  const parent = path.dirname(output);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) fail('--out parent directory does not exist');
  return output;
}

function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(usage() + '\n');
    return 0;
  }
  if (!options.repos.length) fail('at least one --repo is required');
  const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
  const engineContracts = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'contracts', 'tools', 'engine-contracts.json'), 'utf8'));
  const declarations = [];
  const sourceErrors = [];
  for (const repository of options.repos) {
    try {
      const report = inspectAimlabSource({repo_root: repository});
      for (const fn of report.manifest.functions) {
        declarations.push({tool_id: report.id, source_repo_root: report.source_repo_root, source_commit: report.source_commit, function: {...fn, source_entrypoint: fn.entrypoint}});
      }
    } catch (error) {
      sourceErrors.push({repo_root: path.resolve(repository), error: String(error.message || error)});
    }
  }
  const results = declarations.map(declaration => checkAimlabAdapterConformance({declaration, engineContracts}));
  const summary = summarizeConformance(results);
  const pending = results.filter(item => item.status === 'pending_adapter').map(item => item.tool_id + ':' + item.engine);
  const failed = results.filter(item => item.status === 'failed').map(item => item.tool_id + ':' + item.engine);
  const status = sourceErrors.length || failed.length || (pending.length && !options.allowPending) ? 'failed' : 'passed';
  const report = {
    schema_version: 1,
    scope: 'aimlab_adapter_conformance',
    status,
    declaration_count: declarations.length,
    source_count: options.repos.length,
    allow_pending: options.allowPending,
    summary,
    failed,
    pending_adapter: pending,
    results,
    source_errors: sourceErrors,
    installation: {status: 'not_run'},
    tests: {status: 'not_run'},
    release: {status: 'not_run'},
    checked_at: new Date().toISOString()
  };
  if (options.out) fs.writeFileSync(resolveReportPath(options.out), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  process.stdout.write(JSON.stringify({status, declaration_count: declarations.length, summary, failed, pending_adapter: pending, source_errors: sourceErrors}) + '\n');
  return status === 'passed' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(JSON.stringify({status: 'failed', scope: 'aimlab_adapter_conformance', error: String(error.message || error)}) + '\n');
    process.exitCode = 1;
  }
}
