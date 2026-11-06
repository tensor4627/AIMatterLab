import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {
  AIMLAB_DIRECTORY,
  AIMLAB_FILES,
  aimlabToolPackageShape,
  aimlabToolRepoPaths,
  validateAimlabSkillText,
  validateAimlabTools
} from '../../../contracts/tools/aimlab-tools.mjs';

const SCHEMA_VERSION = 1;
const MAX_FILES = 100000;
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
const TOOL_KIND = 'aimlab-tool';
const VERSION_KIND = 'aimlab-tool-version';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw Error('aimlab_source: ' + message); };
const absolute = (value, name) => {
  if (typeof value !== 'string' || !value) fail(name + ' is required');
  return path.resolve(value);
};

function gitEnvironment() {
  return {...process.env, GIT_TERMINAL_PROMPT: '0'};
}

function git(repositoryRoot, args, {encoding = 'utf8'} = {}) {
  try {
    return execFileSync('git', [
      '-c', 'core.hooksPath=' + NULL_DEVICE,
      '-c', 'core.fsmonitor=false',
      '-c', 'core.quotepath=false',
      '-C', repositoryRoot,
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

function resolveRepository(repositoryRoot) {
  const root = fs.realpathSync(absolute(repositoryRoot, 'repo_root'));
  if (!fs.statSync(root).isDirectory()) fail('repo_root is not a directory');
  const topLevel = fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim());
  if (topLevel !== root) fail('repo_root must be the repository root');
  return root;
}

function resolveCommit(repositoryRoot, reference) {
  const resolved = git(repositoryRoot, ['rev-parse', '--verify', (reference || 'HEAD') + '^{commit}']).trim();
  if (!/^[0-9a-f]{40,64}$/.test(resolved)) fail('cannot resolve commit ' + reference);
  return resolved;
}

function listRepositoryTree(repositoryRoot, commit) {
  const output = git(repositoryRoot, ['ls-tree', '-r', '-z', '--full-tree', commit], {encoding: 'buffer'});
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

function readBlob(repositoryRoot, object) {
  return execFileSync('git', ['-C', repositoryRoot, 'cat-file', 'blob', object], {
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

function collectClosure({repositoryRoot, tree, manifest}) {
  const entries = new Map();
  const addFile = (name, where) => {
    const entry = requireTrackedFile(tree, name, where);
    if (entries.has(name)) return;
    entries.set(name, {path: name, size: 0, sha256: ''});
    const bytes = readBlob(repositoryRoot, entry.object);
    entries.set(name, {path: name, size: bytes.length, sha256: sha256(bytes)});
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

/**
 * Read an external AimLab tool repository at one commit and validate its `aimlab-tools/` declaration.
 * Read-only: no installation, test execution, Studio registration or repository copy.
 */
export function inspectAimlabSource({repo_root: repositoryRoot, commit = 'HEAD'} = {}) {
  const repository = resolveRepository(repositoryRoot);
  const sourceCommit = resolveCommit(repository, commit);
  const branch = git(repository, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const worktreeDirty = git(repository, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all'], {encoding: 'buffer'}).length > 0;
  const tree = listRepositoryTree(repository, sourceCommit);
  const manifestBytes = readBlob(repository, requireTrackedFile(tree, AIMLAB_FILES.manifest, 'manifest').object);
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(manifestBytes));
  } catch (error) {
    fail('aimlab-tools/manifest.json: invalid JSON');
  }
  validateAimlabTools(manifest);
  validateAimlabSkillText(new TextDecoder('utf-8', {fatal: true}).decode(readBlob(repository, requireTrackedFile(tree, AIMLAB_FILES.skill, 'skill').object)));
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
  for (const key of ['installation', 'configuration']) {
    for (const [index, file] of ((manifest.guidance || {})[key] || []).entries()) requireTrackedFile(tree, file, 'manifest.guidance.' + key + '[' + index + ']');
  }

  const files = collectClosure({repositoryRoot: repository, tree, manifest});
  const manifestSha256 = sha256(manifestBytes);
  const identity = 'studio.aimlab-tools/1\0' + manifest.id + '\0' + sourceCommit + '\0' + manifestSha256 + '\0'
    + files.map(file => file.path + '\0' + file.size + '\0' + file.sha256 + '\n').join('');
  return {
    schema_version: SCHEMA_VERSION,
    status: 'passed',
    scope: 'aimlab_tools_declaration',
    definition_checked: true,
    id: manifest.id,
    name: manifest.name,
    source_repo_root: repository,
    source_commit: sourceCommit,
    source_branch: branch,
    worktree_dirty: worktreeDirty,
    manifest,
    package_shape: aimlabToolPackageShape(manifest, {commit: sourceCommit}),
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
}

function versionId(toolId, declarationSha256) {
  return sha256(Buffer.from(toolId + '\0' + declarationSha256, 'utf8'));
}

function summary(tool) {
  return {
    schema_version: SCHEMA_VERSION,
    tool_id: tool.tool_id,
    name: tool.name,
    revision: tool.revision,
    declaration_sha256: tool.current_declaration_sha256,
    source_repo_root: tool.source_repo_root,
    source_commit: tool.current_source_commit,
    versions: tool.versions,
    updated_at: tool.updated_at
  };
}

/** Main-process registry for external AimLab tool sources. It never copies the tool repository. */
export function createAimlabToolRegistry({catalog, now = () => Date.now()} = {}) {
  if (!catalog || !['get', 'put', 'list', 'transaction'].every(name => typeof catalog[name] === 'function')) fail('catalog is required');
  function read({tool_id: toolId, declaration_sha256: declarationSha256} = {}) {
    if (typeof toolId !== 'string' || !toolId) fail('tool_id is required');
    const tool = catalog.get(TOOL_KIND, toolId);
    if (!tool) fail('tool is not registered: ' + toolId);
    const version = declarationSha256 || tool.current_declaration_sha256;
    const record = catalog.get(VERSION_KIND, versionId(toolId, version));
    if (!record) fail('tool version is unavailable: ' + toolId + '@' + version);
    return {...summary(tool), version: record};
  }
  function list() {
    return catalog.list(TOOL_KIND).map(summary).sort((left, right) => left.tool_id < right.tool_id ? -1 : left.tool_id > right.tool_id ? 1 : 0);
  }
  function register({repo_root: repositoryRoot, commit = 'HEAD'} = {}) {
    const report = inspectAimlabSource({repo_root: repositoryRoot, commit});
    const existing = catalog.get(TOOL_KIND, report.id);
    const existingVersion = catalog.get(VERSION_KIND, versionId(report.id, report.declaration_sha256));
    if (existingVersion) {
      if (existing?.current_declaration_sha256 === report.declaration_sha256) return read({tool_id: report.id});
      fail('version already registered for another current revision: ' + report.id + '@' + report.declaration_sha256);
    }
    const revision = (existing?.revision || 0) + 1;
    const versionRecord = {
      schema_version: SCHEMA_VERSION,
      tool_id: report.id,
      declaration_sha256: report.declaration_sha256,
      source_repo_root: report.source_repo_root,
      source_commit: report.source_commit,
      manifest_sha256: report.manifest_sha256,
      manifest: report.manifest,
      package_shape: report.package_shape,
      files: report.files,
      scope: 'definition_checked',
      installation: {status: 'not_run'},
      tests: {status: 'not_run'},
      registered_at: now()
    };
    const tool = {
      schema_version: SCHEMA_VERSION,
      tool_id: report.id,
      name: report.name,
      revision,
      current_declaration_sha256: report.declaration_sha256,
      current_source_commit: report.source_commit,
      source_repo_root: report.source_repo_root,
      versions: [...new Set([...(existing?.versions || []), report.declaration_sha256])],
      updated_at: now()
    };
    catalog.transaction(() => {
      catalog.put(VERSION_KIND, versionId(report.id, report.declaration_sha256), versionRecord);
      catalog.put(TOOL_KIND, report.id, tool);
    });
    return read({tool_id: report.id});
  }
  function update({tool_id: toolId, repo_root: repositoryRoot, commit = 'HEAD', expected_revision} = {}) {
    if (typeof toolId !== 'string' || !toolId) fail('tool_id is required');
    const existing = catalog.get(TOOL_KIND, toolId);
    if (!existing) fail('tool is not registered: ' + toolId);
    if (!Number.isSafeInteger(expected_revision) || expected_revision < 1 || existing.revision !== expected_revision) fail('revision changed');
    const report = inspectAimlabSource({repo_root: repositoryRoot, commit});
    if (report.id !== toolId) fail('declaration id changed: ' + report.id);
    if (report.declaration_sha256 === existing.current_declaration_sha256) return read({tool_id: toolId});
    const versionRecord = {
      schema_version: SCHEMA_VERSION,
      tool_id: report.id,
      declaration_sha256: report.declaration_sha256,
      source_repo_root: report.source_repo_root,
      source_commit: report.source_commit,
      manifest_sha256: report.manifest_sha256,
      manifest: report.manifest,
      package_shape: report.package_shape,
      files: report.files,
      scope: 'definition_checked',
      installation: {status: 'not_run'},
      tests: {status: 'not_run'},
      registered_at: now()
    };
    const tool = {
      ...existing,
      name: report.name,
      revision: existing.revision + 1,
      current_declaration_sha256: report.declaration_sha256,
      current_source_commit: report.source_commit,
      source_repo_root: report.source_repo_root,
      versions: [...new Set([...existing.versions, report.declaration_sha256])],
      updated_at: now()
    };
    catalog.transaction(() => {
      catalog.put(VERSION_KIND, versionId(report.id, report.declaration_sha256), versionRecord);
      catalog.put(TOOL_KIND, toolId, tool);
    });
    return read({tool_id: toolId});
  }
  return {inspect: inspectAimlabSource, register, update, list, read};
}
