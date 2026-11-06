#!/usr/bin/env node
/**
 * Read-only internal AimLab tool declaration check.
 * It never writes the tool repository, installs software, runs tests or registers a Studio package.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {
  AIMLAB_DIRECTORY,
  AIMLAB_FILES,
  aimlabToolRepoPaths,
  validateAimlabTools
} from '../contracts/tools/aimlab-tools.mjs';

const MAX_FILES = 100000;
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const usage = () => 'Usage: node scripts/check-aimlab-tools.mjs --repo <tool-repository> [--commit <sha>] [--out <new-report.json>]';
const fail = message => { throw Error('aimlab_tools_check: ' + message); };
const gitEnvironment = () => ({...process.env, GIT_TERMINAL_PROMPT: '0'});

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

function git(repository, args, {encoding = 'utf8'} = {}) {
  try {
    return execFileSync('git', [
      '-c', 'core.hooksPath=' + NULL_DEVICE,
      '-c', 'core.fsmonitor=false',
      '-c', 'core.quotepath=false',
      '-C', repository,
      ...args
    ], {
      encoding,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 256 * 1024 * 1024,
      env: gitEnvironment()
    });
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr : (error.stderr?.toString?.('utf8') || '');
    fail('git ' + args[0] + ' failed' + (stderr.trim() ? ': ' + stderr.trim() : ''));
  }
}

function resolveCommit(repository, reference) {
  const resolved = git(repository, ['rev-parse', '--verify', reference + '^{commit}']).trim();
  if (!/^[0-9a-f]{40,64}$/.test(resolved)) fail('cannot resolve commit ' + reference);
  return resolved;
}

function listRepositoryTree(repository, commit) {
  const output = git(repository, ['ls-tree', '-r', '-z', '--full-tree', commit], {encoding: 'buffer'});
  const entries = new Map();
  for (const record of output.toString('utf8').split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) fail('invalid git tree record');
    const metadata = record.slice(0, tab).split(' ');
    if (metadata.length !== 3) fail('invalid git tree metadata');
    const [mode, type, object] = metadata;
    const name = record.slice(tab + 1);
    if (!name) fail('invalid git tree path');
    entries.set(name, {mode, type, object});
    if (entries.size > MAX_FILES) fail('git tree exceeds ' + MAX_FILES + ' files');
  }
  return entries;
}

function readBlob(repository, object) {
  return execFileSync('git', ['-C', repository, 'cat-file', 'blob', object], {
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 256 * 1024 * 1024,
    env: gitEnvironment()
  });
}

function requireTrackedFile(tree, name, where) {
  const entry = tree.get(name);
  if (!entry) fail(where + ': missing tracked file ' + name);
  if (entry.type !== 'blob') fail(where + ': not a file: ' + name);
  if (entry.mode === '120000') fail(where + ': symlink not supported: ' + name);
  return entry;
}

function isTrackedDirectory(tree, name) {
  const prefix = name + '/';
  for (const candidate of tree.keys()) if (candidate.startsWith(prefix)) return true;
  return false;
}

function requireTrackedPath(tree, name, where) {
  const entry = tree.get(name);
  if (entry) {
    if (entry.type !== 'blob') fail(where + ': not a file: ' + name);
    if (entry.mode === '120000') fail(where + ': symlink not supported: ' + name);
    return 'file';
  }
  if (!isTrackedDirectory(tree, name)) fail(where + ': missing tracked path ' + name);
  return 'directory';
}

function validateSkill(text) {
  if (!text.trim()) fail('aimlab-tools/SKILL.md: empty');
  if (Buffer.byteLength(text, 'utf8') > 256 * 1024) fail('aimlab-tools/SKILL.md: exceeds 256 KiB');
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!front) fail('aimlab-tools/SKILL.md: YAML front matter required');
  const name = /^name:\s*(.+)$/m.exec(front[1]);
  const description = /^description:\s*(.+)$/m.exec(front[1]);
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name[1].trim())) fail('aimlab-tools/SKILL.md: valid lowercase name required');
  if (!description || !description[1].trim()) fail('aimlab-tools/SKILL.md: description required');
  if (!text.slice(front[0].length).trim()) fail('aimlab-tools/SKILL.md: body required');
}

function fileEntry(name, bytes) {
  return {path: name, size: bytes.length, sha256: sha256(bytes)};
}

function collectClosure({repository, tree, manifest}) {
  const entries = new Map();
  const addFile = (name, where) => {
    const entry = requireTrackedFile(tree, name, where);
    if (entries.has(name)) return;
    entries.set(name, fileEntry(name, readBlob(repository, entry.object)));
    if (entries.size > MAX_FILES) fail('declaration closure exceeds ' + MAX_FILES + ' files');
  };
  for (const name of tree.keys()) {
    if (name.startsWith(AIMLAB_DIRECTORY + '/')) addFile(name, 'aimlab-tools closure');
  }
  for (const declared of aimlabToolRepoPaths(manifest)) {
    if (declared.startsWith(AIMLAB_DIRECTORY + '/')) continue;
    const kind = requireTrackedPath(tree, declared, 'declared path');
    if (kind === 'file') addFile(declared, 'declared path');
    else {
      const prefix = declared + '/';
      for (const name of tree.keys()) if (name.startsWith(prefix)) addFile(name, 'declared path');
    }
  }
  return [...entries.values()].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function resolveReportPath(repository, output) {
  if (!path.isAbsolute(output)) fail('--out must be an absolute path');
  const resolved = path.resolve(output);
  const relative = path.relative(repository, resolved);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    fail('--out must be outside the tool repository');
  }
  if (fs.existsSync(resolved)) fail('--out already exists; choose a new report path');
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) fail('--out parent directory does not exist');
  return resolved;
}

export function checkAimlabTools({repo, commit = 'HEAD', out = null} = {}) {
  if (typeof repo !== 'string' || !repo) fail('--repo is required');
  commit = commit || 'HEAD';
  const repository = fs.realpathSync(path.resolve(repo));
  if (!fs.statSync(repository).isDirectory()) fail('repository path is not a directory');
  const topLevel = fs.realpathSync(git(repository, ['rev-parse', '--show-toplevel']).trim());
  if (topLevel !== repository) fail('--repo must be the repository root');

  const sourceCommit = resolveCommit(repository, commit);
  const branch = git(repository, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const worktreeDirty = git(repository, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all'], {encoding: 'buffer'}).length > 0;
  const reportPath = out ? resolveReportPath(repository, out) : null;

  const tree = listRepositoryTree(repository, sourceCommit);
  const manifestBytes = readBlob(repository, requireTrackedFile(tree, AIMLAB_FILES.manifest, 'manifest').object);
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(manifestBytes));
  } catch (error) {
    fail('aimlab-tools/manifest.json: invalid JSON');
  }
  validateAimlabTools(manifest);

  validateSkill(new TextDecoder('utf-8', {fatal: true}).decode(readBlob(repository, requireTrackedFile(tree, AIMLAB_FILES.skill, 'skill').object)));
  if (!readBlob(repository, requireTrackedFile(tree, AIMLAB_FILES.manual, 'manual').object).toString('utf8').trim()) fail('aimlab-tools/manual.md: empty');
  if (!readBlob(repository, requireTrackedFile(tree, AIMLAB_FILES.introduction, 'tests introduction').object).toString('utf8').trim()) fail('aimlab-tools/tests/README.md: empty');

  for (const [index, item] of manifest.functions.entries()) {
    requireTrackedFile(tree, item.entrypoint, 'manifest.functions[' + index + '].entrypoint');
  }
  for (const [index, item] of manifest.tests.cases.entries()) {
    const where = 'manifest.tests.cases[' + index + ']';
    if (tree.has(item.directory)) fail(where + '.directory: must be a directory');
    if (!isTrackedDirectory(tree, item.directory)) fail(where + '.directory: missing tracked directory ' + item.directory);
    requireTrackedFile(tree, item.instructions, where + '.instructions');
    requireTrackedFile(tree, item.entrypoint, where + '.entrypoint');
    for (const [resourceIndex, resource] of item.resources.entries()) requireTrackedPath(tree, resource, where + '.resources[' + resourceIndex + ']');
  }
  const guidance = manifest.guidance || {};
  for (const key of ['installation', 'configuration']) {
    for (const [index, file] of (guidance[key] || []).entries()) requireTrackedFile(tree, file, 'manifest.guidance.' + key + '[' + index + ']');
  }

  const files = collectClosure({repository, tree, manifest});
  const manifestSha256 = sha256(manifestBytes);
  const identity = 'studio.aimlab-tools/1\0' + manifest.id + '\0' + sourceCommit + '\0' + manifestSha256 + '\0'
    + files.map(file => file.path + '\0' + file.size + '\0' + file.sha256 + '\n').join('');
  const report = {
    schema_version: 1,
    status: 'passed',
    scope: 'aimlab_tools_declaration',
    definition_checked: true,
    id: manifest.id,
    name: manifest.name,
    source_commit: sourceCommit,
    source_branch: branch,
    worktree_dirty: worktreeDirty,
    manifest_sha256: manifestSha256,
    declaration_sha256: sha256(Buffer.from(identity, 'utf8')),
    function_count: manifest.functions.length,
    test_case_count: manifest.tests.cases.length,
    file_count: files.length,
    files,
    installation: {status: 'not_run'},
    tests: {status: 'not_run'},
    release: {status: 'not_run'},
    limitations: [
      'Read-only declaration and file-closure check; software is not installed or executed.',
      'Installation, functional tests and Studio registration remain not_run.'
    ],
    checked_at: new Date().toISOString()
  };
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  return report;
}

function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(usage() + '\n');
    return 0;
  }
  const report = checkAimlabTools(options);
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
