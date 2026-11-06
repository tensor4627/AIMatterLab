#!/usr/bin/env node
/** Read-only internal AimLab tool declaration check. It never writes the tool repository, installs software, runs tests or registers a Studio package. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectAimlabSource} from '../backend/main/tools/aimlab-source.mjs';

const usage = () => 'Usage: node scripts/check-aimlab-tools.mjs --repo <tool-repository> [--commit <sha>] [--out <new-report.json>]';
const fail = message => { throw Error('aimlab_tools_check: ' + message); };

function parseArguments(argv) {
  const options = {repo: null, commit: null, out: null, help: false};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--repo' || argument === '--commit' || argument === '--out') {
      const value = argv[index + 1];
      if (!value) fail(argument + ' requires a value');
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      fail('unknown argument ' + argument);
    }
  }
  return options;
}

function resolveReportPath(repositoryRoot, output) {
  if (!path.isAbsolute(output)) fail('--out must be an absolute path');
  const resolved = path.resolve(output);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    fail('--out must be outside the tool repository');
  }
  if (fs.existsSync(resolved)) fail('--out already exists; choose a new report path');
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) fail('--out parent directory does not exist');
  return resolved;
}

function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(usage() + '\n');
    return 0;
  }
  if (!options.repo) fail('--repo is required');
  const report = inspectAimlabSource({repo_root: options.repo, commit: options.commit || 'HEAD'});
  if (options.out) {
    const reportPath = resolveReportPath(report.source_repo_root, options.out);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(JSON.stringify({status: 'failed', scope: 'aimlab_tools_declaration', error: String(error.message || error)}) + '\n');
    process.exitCode = 1;
  }
}
