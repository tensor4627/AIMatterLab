import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const workerJsonResources = [
  'studio_worker/engine_contracts.json',
  'studio_worker/pygas-editor-hints.json',
  'studio_worker/tool_package.schema.json',
];

function archiveWorkerDirectory(source) {
  const parent = path.dirname(source);
  if (path.basename(source) !== 'worker' || path.basename(parent) !== 'app.asar.unpacked') return null;
  return path.join(path.dirname(parent), 'app.asar', 'worker');
}

export function listWorkerRuntimeFiles(source) {
  // The virtual archive directory lists only files indexed by this application.
  const inventory = archiveWorkerDirectory(source) ?? source;
  const names = [];
  function walk(relative) {
    const directory = path.join(inventory, relative);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Linked worker source refused');
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      if (entry.name === 'tests' || entry.name === '__pycache__') continue;
      if (entry.isSymbolicLink() || entry.name === '.' || entry.name === '..' || /[\\/:\0\r\n]/.test(entry.name)) throw Error('Invalid worker source entry');
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile() && (/\.(py|toml)$/.test(name) || workerJsonResources.includes(name))) names.push(name);
    }
  }
  walk('');
  return names.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

const comparablePath = value => process.platform === 'win32' ? value.toLowerCase() : value;
function samePath(a, b) {
  return comparablePath(path.resolve(a)) === comparablePath(path.resolve(b));
}

export function readWorkerRuntimeFile(source, name) {
  const file = path.join(source, name);
  if (!archiveWorkerDirectory(source)) return fs.readFileSync(file);
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 2 * 1024 * 1024 ||
      !samePath(fs.realpathSync(file), file)) throw Error('Unconfirmed packaged worker file');
  const bytes = fs.readFileSync(file);
  const after = fs.lstatSync(file);
  if (before.size !== bytes.length || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    throw Error('Packaged worker file changed');
  }
  return bytes;
}

export async function withWorkerDeploymentSource(source, deploy) {
  if (!archiveWorkerDirectory(source)) return deploy(source);
  // WSL Python reads a physical directory. Give it only files from the current archive.
  const parent = fs.realpathSync(os.tmpdir());
  const staging = fs.mkdtempSync(path.join(parent, 'aimatterlab-worker-'));
  const owner = fs.lstatSync(staging);
  const workerDirectory = path.join(staging, 'worker');
  try {
    for (const name of listWorkerRuntimeFiles(source)) {
      const bytes = readWorkerRuntimeFile(source, name);
      const destination = path.join(workerDirectory, name);
      await fs.promises.mkdir(path.dirname(destination), {recursive: true});
      await fs.promises.writeFile(destination, bytes, {flag: 'wx'});
    }
    return await deploy(workerDirectory);
  } finally {
    try {
      const stat = fs.lstatSync(staging);
      if (stat.isDirectory() && !stat.isSymbolicLink() && stat.ino === owner.ino &&
          samePath(fs.realpathSync(staging), staging) && samePath(path.dirname(staging), parent)) {
        await fs.promises.rm(staging, {recursive: true, force: true});
      }
    } catch { /* The private staging copy contains only bundled program files. */ }
  }
}

