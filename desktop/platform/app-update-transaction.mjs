import {createHash,randomUUID} from 'node:crypto';
import fsPromises from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {appHelperPath,appOwnershipPath,formatAppInventory,maxAppInventory,parseAppInventory,readAppPayload,runtimeMarkerPath} from './app-payload.mjs';
import {maxAppPayload,maxReleaseManifest,newerRelease,readSignedRelease,validReleaseVersion,validRuntimeAbi,validSha512} from './update-release.mjs';

// Electron virtualizes app.asar even in RUN_AS_NODE. Transactions must always
// address the physical archive and backup files.
const fs = process.versions.electron ? createRequire(import.meta.url)('original-fs').promises : fsPromises;

export const transactionToken = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const hasSamePath = (left,right) => process.platform==='win32' ? left.toLowerCase()===right.toLowerCase() : left===right;
const digest = bytes => createHash('sha512').update(bytes).digest('base64');
const union = (a,b) => [...new Set([...a,...b])];

export function updatePaths(directory) {
  const workspace = path.resolve(directory);
  const cache = path.join(workspace,'user-cache','updates','staging');
  return {workspace,cache,archive:path.join(cache,'app-payload.gz'),release:path.join(cache,'app-release.json'),
    journal:path.join(cache,'app-update-journal.json'),lock:path.join(cache,'app-update-lock.json'),
    failed:path.join(cache,'app-update-failed.json'),helper:path.join(workspace,appHelperPath),
    executable:path.join(workspace,'AIMatterLab.exe')};
}

export function transactionPaths(paths,token) {
  if (!transactionToken(token)) throw Error('Invalid application update token');
  const root = path.join(paths.cache,'app-'+token);
  return {root, backup:path.join(root,'.bak'), incoming:path.join(root,'incoming'),
    plan:path.join(root,'plan.json'), starting:path.join(root,'startup.running'), started:path.join(root,'startup.ready')};
}

export function helperReceipt(paths,token) {
  if (!transactionToken(token)) throw Error('Invalid application update token');
  return path.join(paths.cache,'handoff-'+token+'.json');
}

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid,0); return true; }
  catch (error) { if (error.code==='ESRCH') return false; if (error.code==='EPERM') return true; throw error; }
}

export async function entry(file,kind='file',allowLinked=false) {
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !(kind==='directory' ? stat.isDirectory() : stat.isFile() && (allowLinked || stat.nlink===1))) {
      throw Error('Linked or conflicting application update path: '+file);
    }
    return stat;
  } catch (error) {
    if (error.code==='ENOENT') return null;
    throw error;
  }
}

export async function safeDirectory(dir,create=false,verifyRealPath=true) {
  const parent = path.dirname(dir);
  if (parent!==dir && !await safeDirectory(parent,create,false)) return false;
  if (await entry(dir,'directory')) {
    if (verifyRealPath && !hasSamePath(await fs.realpath(dir),dir)) throw Error('Linked application update directory: '+dir);
    return true;
  }
  if (!create || parent===dir) return false;
  await fs.mkdir(dir).catch(error=>{if (error.code!=='EEXIST') throw error;});
  if (!await entry(dir,'directory')) throw Error('Application update directory is unavailable: '+dir);
  return true;
}

export async function readBounded(file,limit,allowLinked=false) {
  const stat = await entry(file,'file',allowLinked);
  if (!stat) return null;
  if (stat.size>limit) throw Error('Application update file exceeds its size limit');
  const bytes = await fs.readFile(file);
  if (bytes.length>limit) throw Error('Application update file exceeds its size limit');
  return bytes;
}

async function retryLockedFile(change) {
  for (const wait of [0,50,125,250,500,1000,2000]) {
    if (wait) await delay(wait);
    try { return await change(); }
    catch (error) {
      if (wait===2000 || !['EACCES','EBUSY','EPERM'].includes(error.code)) throw error;
    }
  }
}

export async function readJson(file,limit=4096) {
  const bytes = await readBounded(file,limit);
  return bytes ? JSON.parse(bytes) : null;
}

export async function writeAtomic(file,bytes,tempDirectory=path.dirname(file)) {
  await entry(file);
  const temp = path.join(tempDirectory,'.app-update-'+randomUUID()+'.part');
  try {
    const handle = await fs.open(temp,'wx',0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    await retryLockedFile(()=>fs.rename(temp,file));
  } finally { await fs.rm(temp,{force:true}); }
}

export const writeJson = (file,value) => writeAtomic(file,JSON.stringify(value));

export async function managedWorkspace(paths) {
  if (!await safeDirectory(paths.workspace)) return false;
  const marker = await readBounded(path.join(paths.workspace,'.aimatterlab-workspace'),64);
  return marker?.toString()==='AIMatterLab workspace v1';
}

export async function installedRuntime(paths) {
  if (!await managedWorkspace(paths) || !await safeDirectory(path.dirname(paths.helper))) return null;
  const info = await readJson(path.join(paths.workspace,runtimeMarkerPath));
  if (info?.schemaVersion!==1 || !validRuntimeAbi(info.runtimeAbiVersion) ||
      !validReleaseVersion(info.installerVersion) || !await entry(paths.helper) || !await entry(paths.executable)) return null;
  return info;
}

export const isSamePayload = (left,right) => left.version===right.version && left.appPayload?.sha512===right.appPayload?.sha512;

export async function stagedPayload(paths,currentVersion,decodeManifest=readSignedRelease) {
  const runtime = await installedRuntime(paths);
  if (!runtime || !await safeDirectory(paths.cache)) return null;
  const manifest = await readBounded(paths.release,maxReleaseManifest);
  if (!manifest) return null;
  const info = decodeManifest(manifest);
  const failed = await readJson(paths.failed);
  if (!info.appPayload || info.runtimeAbiVersion!==runtime.runtimeAbiVersion ||
      !newerRelease(info.version,currentVersion) || failed?.version===info.version && failed.sha512===info.appPayload.sha512) return null;
  const bytes = await readBounded(paths.archive,maxAppPayload);
  if (!bytes) return null;
  return {info,payload:readAppPayload(bytes,info)};
}

async function checkPath(paths,name,kind,mustExist,allowLinked=false) {
  const file = path.join(paths.workspace,name);
  if (!await safeDirectory(path.dirname(file))) {
    if (mustExist) throw Error('Missing installed application path: '+name);
    return null;
  }
  const stat = await entry(file,kind,allowLinked);
  if (mustExist && !stat) throw Error('Missing installed application path: '+name);
  return stat;
}

async function currentInventory(paths) {
  if (!await checkPath(paths,appOwnershipPath,'file',true)) throw Error('Missing installed application file inventory');
  return parseAppInventory((await readBounded(path.join(paths.workspace,appOwnershipPath),maxAppInventory)).toString('utf8'));
}

export async function preflightApplication(paths,inventory) {
  const before = await currentInventory(paths);
  for (const [key,kind] of [['directories','directory'],['files','file']]) {
    const owned = new Set(before[key]);
    for (const name of owned) await checkPath(paths,name,kind,true);
    for (const name of inventory[key]) {
      if (!owned.has(name) && await checkPath(paths,name,kind,false)) throw Error('Application update would overwrite an unowned path: '+name);
    }
  }
  return before;
}

async function saveFiles(root,files) {
  await fs.mkdir(root);
  const pending = new Map();
  for (const [name,bytes] of files) {
    const file = path.join(root,name);
    const directory = path.dirname(file);
    if (!pending.has(directory)) pending.set(directory,fs.mkdir(directory,{recursive:true}));
    await pending.get(directory);
    const handle = await fs.open(file,'wx',0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
  }
}

export async function beginApplicationUpdate(paths,token,previousVersion,{info,payload}) {
  const {inventory,files} = payload;
  const before = await preflightApplication(paths,inventory);
  const runtime = await installedRuntime(paths);
  if (!runtime || runtime.runtimeAbiVersion!==info.runtimeAbiVersion) throw Error('Installed application runtime has changed');
  const temp = transactionPaths(paths,token);
  await fs.mkdir(temp.root);
  const oldContents = new Map();
  let backupBytes = 0;
  for (const name of [...before.files,appOwnershipPath]) {
    const bytes = await readBounded(path.join(paths.workspace,name),128*1024*1024);
    if (!bytes) throw Error('Installed application file changed during update: '+name);
    backupBytes += bytes.length;
    if (backupBytes>132*1024*1024) throw Error('Installed application exceeds the backup limit');
    oldContents.set(name,bytes);
  }
  await saveFiles(temp.backup,oldContents);
  await saveFiles(temp.incoming,new Map([...files,[appOwnershipPath,Buffer.from(formatAppInventory(inventory))]]));
  const plan = {before:formatAppInventory(before),after:formatAppInventory(inventory),
    backups:[...oldContents].map(([name,bytes])=>[name,digest(bytes)]),
    added:[...files].filter(([name])=>!oldContents.has(name)).map(([name,bytes])=>[name,digest(bytes)])};
  const planBytes = Buffer.from(JSON.stringify(plan));
  await writeAtomic(temp.plan,planBytes);
  const journal = {schemaVersion:1,token,previousVersion,version:info.version,sha512:info.appPayload.sha512,
    runtimeAbiVersion:runtime.runtimeAbiVersion,installerVersion:runtime.installerVersion,planHash:digest(planBytes),phase:'applying'};
  await writeJson(paths.journal,journal);
  // An installer can still clean up a stopped, partially applied update using
  // the union of program files that this transaction is allowed to touch.
  await writeAtomic(path.join(paths.workspace,appOwnershipPath),formatAppInventory({
    directories:union(before.directories,inventory.directories),files:union(before.files,inventory.files)}),temp.root);

  for (const name of inventory.directories) {
    if (!await checkPath(paths,name,'directory',false)) {
      const file = path.join(paths.workspace,name);
      if (!await safeDirectory(path.dirname(file))) throw Error('Missing application update parent');
      await fs.mkdir(file);
    }
  }
  // Replacements keep the old name present until the atomic rename. In particular,
  // app.asar can still load its recovery entry point after an interrupted update.
  for (const name of [...inventory.files,appOwnershipPath]) {
    const source = path.join(temp.incoming,name), target = path.join(paths.workspace,name);
    await checkPath(paths,name,'file',oldContents.has(name));
    if (oldContents.has(name)) await retryLockedFile(()=>fs.rename(source,target));
    else {
      await fs.link(source,target);
      await fs.unlink(source);
    }
  }
  for (const name of before.files.filter(name=>!files.has(name))) {
    await checkPath(paths,name,'file',true);
    await retryLockedFile(()=>fs.unlink(path.join(paths.workspace,name)));
  }
  journal.phase = 'trial';
  await writeJson(paths.journal,journal);
  return journal;
}

export async function readJournal(paths,runtime) {
  const journal = await readJson(paths.journal);
  if (journal && (journal.schemaVersion!==1 || !transactionToken(journal.token) ||
      !validReleaseVersion(journal.version) || !newerRelease(journal.version,journal.previousVersion) ||
      !validReleaseVersion(journal.installerVersion) || !validRuntimeAbi(journal.runtimeAbiVersion) ||
      !validSha512(journal.sha512) || !validSha512(journal.planHash) ||
      !['applying','trial'].includes(journal.phase))) throw Error('Invalid application update journal');
  if (journal && runtime && (journal.runtimeAbiVersion!==runtime.runtimeAbiVersion || journal.installerVersion!==runtime.installerVersion)) return null;
  return journal;
}

async function savedPlan(paths,journal) {
  const temp = transactionPaths(paths,journal.token);
  if (!await safeDirectory(temp.root)) throw Error('Missing application update backup');
  const bytes = await readBounded(temp.plan,4*maxAppInventory);
  if (!bytes || digest(bytes)!==journal.planHash) throw Error('Invalid application update rollback plan');
  const {before,after,backups,added} = JSON.parse(bytes);
  const old = parseAppInventory(before), next = parseAppInventory(after);
  const expectedOld = new Set([...old.files,appOwnershipPath]), expectedNew = new Set(next.files.filter(name=>!expectedOld.has(name)));
  function verifyEntries(entries,expected) {
    if (!Array.isArray(entries) || entries.length!==expected.size ||
        entries.some(pair=>!Array.isArray(pair)||pair.length!==2||!expected.delete(pair[0])||!validSha512(pair[1]))) {
      throw Error('Invalid application update rollback file list');
    }
    return new Map(entries);
  }
  return {temp,old,next,backups:verifyEntries(backups,expectedOld),added:verifyEntries(added,expectedNew)};
}

async function removeEmptyDirectories(paths,names,keep) {
  const retained = new Set(keep);
  for (const name of names.slice().reverse()) {
    if (!retained.has(name) && await checkPath(paths,name,'directory',false)) {
      await fs.rmdir(path.join(paths.workspace,name)).catch(error=>{if (error.code!=='ENOTEMPTY') throw error;});
    }
  }
}

export async function finishApplicationUpdate(paths,journal,success) {
  const {temp,old,next,backups,added} = await savedPlan(paths,journal);
  if (success) await removeEmptyDirectories(paths,old.directories,next.directories);
  else {
    // Refuse to start recovery with an incomplete backup. Retry every file from
    // the same immutable backup if recovery itself was interrupted.
    const original = new Map();
    for (const [name,sha] of backups) {
      const file = path.join(temp.backup,name);
      const bytes = await safeDirectory(path.dirname(file)) ? await readBounded(file,128*1024*1024) : null;
      if (!bytes || digest(bytes)!==sha) throw Error('Application update backup failed verification');
      original.set(name,bytes);
    }
    const rollback = path.join(temp.root,'rollback-'+randomUUID());
    await saveFiles(rollback,original);
    for (const name of old.files) {
      const target = path.join(paths.workspace,name);
      if (!await safeDirectory(path.dirname(target))) throw Error('Missing application rollback directory');
      const current = await retryLockedFile(()=>readBounded(target,128*1024*1024));
      if (!current || digest(current)!==backups.get(name)) {
        await retryLockedFile(()=>fs.rename(path.join(rollback,name),target));
      }
    }
    for (const [name,sha] of added) {
      if (await checkPath(paths,name,'file',false,true)) {
        const target = path.join(paths.workspace,name), incoming = path.join(temp.incoming,name);
        const staged = await entry(incoming,'file',true);
        const installed = await entry(target,'file',true);
        const owned = installed.nlink===1 || staged && installed.nlink===2 && installed.ino===staged.ino && installed.dev===staged.dev;
        const bytes = owned && await readBounded(target,128*1024*1024,true);
        if (bytes && digest(bytes)===sha) await retryLockedFile(()=>fs.unlink(target));
      }
    }
    await removeEmptyDirectories(paths,next.directories,old.directories);
    await checkPath(paths,appOwnershipPath,'file',false);
    await retryLockedFile(()=>fs.rename(path.join(rollback,appOwnershipPath),path.join(paths.workspace,appOwnershipPath)));
    await writeJson(paths.failed,{version:journal.version,sha512:journal.sha512});
  }
  await fs.unlink(paths.journal);
  for (const file of [paths.archive,paths.release]) if (await entry(file)) await fs.unlink(file);
  if (await safeDirectory(temp.root)) await fs.rm(temp.root,{force:true,recursive:true});
}
