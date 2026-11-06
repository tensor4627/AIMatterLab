#!/usr/bin/env node
/** Read-only verification of several external AimLab tool sources at their current committed declarations. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectAimlabSource} from '../backend/main/tools/aimlab-source.mjs';

const usage = () => 'Usage: node scripts/verify-aimlab-sources.mjs --repo <tool-repository> [--repo <tool-repository> ...] [--out <new-report.json>]';
const fail = message => { throw Error('aimlab_sources: ' + message); };

function parseArguments(argv) {
  const options = {repos: [], out: null, help: false};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--repo' || argument === '--out') {
      const value = argv[index + 1];
      if (!value) fail(argument + ' requires a value');
      if (argument === '--repo') options.repos.push(value);
      else options.out = value;
      index += 1;
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
  const sources = [];
  for (const repository of options.repos) {
    try {
      sources.push(inspectAimlabSource({repo_root: repository}));
    } catch (error) {
      sources.push({status: 'failed', scope: 'aimlab_tools_declaration', repo_root: path.resolve(repository), error: String(error.message || error)});
    }
  }
  const failed = sources.filter(item => item.status !== 'passed').length;
  const report = {
    schema_version: 1,
    scope: 'aimlab_tools_sources',
    status: failed ? 'failed' : 'passed',
    source_count: sources.length,
    failed_count: failed,
    sources,
    installation: {status: 'not_run'},
    tests: {status: 'not_run'},
    release: {status: 'not_run'},
    checked_at: new Date().toISOString()
  };
  if (options.out) fs.writeFileSync(resolveReportPath(options.out), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(JSON.stringify({status: 'failed', scope: 'aimlab_tools_sources', error: String(error.message || error)}) + '\n');
    process.exitCode = 1;
  }
}
