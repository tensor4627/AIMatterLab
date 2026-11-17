import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {assembleInstaller, parseBlockmap, planBlocks, readBytes} from './update-blocks.mjs';
import {fileDigest, maxBlockmap, newerRelease, readSignedRelease, releaseFeed, setupName, versionAsset} from './update-release.mjs';

async function regularFile(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('Invalid file in the update cache');
    return stat;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function cachePaths(workspace) {
  const dir = path.join(workspace.cache,'updates');
  for (const directory of [workspace.directory, workspace.cache, dir]) {
    if (directory !== workspace.directory) await fs.mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid update cache directory');
  }
  const paths = {base:path.join(dir,'installer.exe'), pending:path.join(dir,'pending.exe'), manifest:path.join(dir,'pending.json'), dir};
  for (const file of [paths.base, paths.pending, paths.manifest]) await regularFile(file);
  return paths;
}

export async function launchWorkspaceUpdate(file, workspace) {
  const ready = path.join(path.dirname(file),'restart.ready');
  if (await regularFile(ready)) await fs.unlink(ready);
  const child = spawn(file,['/S','--updated','--force-run','--wait-pid='+process.pid,'/D='+workspace], {
    cwd:workspace, detached:true, stdio:'ignore', windowsHide:true
  });
  await new Promise((resolve,reject) => { child.once('error',reject); child.once('spawn',resolve); });
  // Keep the application open until this installer has validated its registered workspace.
  const until = Date.now()+60000;
  while (Date.now()<until) {
    if (child.exitCode !== null || child.signalCode) throw Error('Installer could not prepare this workspace (exit '+child.exitCode+'). Check the registered install location.');
    if (await regularFile(ready)) {
      await fs.unlink(ready); child.unref(); return;
    }
    await delay(150);
  }
  child.kill();
  throw Error('Installer did not confirm the workspace in time');
}

export function createWorkspaceUpdater({workspace, currentVersion, fetchApi, publish, install, quit, decodeManifest=readSignedRelease}) {
  let state = {phase:workspace ? 'idle' : 'disabled', currentVersion, sequence:0};
  let manifest, operations, active, lifetime = new AbortController();
  const snapshot = () => ({...state});
  function set(fields) {
    state = {...state,...fields,sequence:state.sequence+1};
    publish(snapshot());
  }
  function request(url, headers = {}, timeout = 30000) {
    return fetchApi(url,{headers, cache:'no-store', credentials:'omit', signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(timeout)])});
  }
  async function run(action) {
    if (!workspace) return snapshot();
    if (active) { await active; return snapshot(); }
    active = Promise.resolve().then(action).catch(error => {
      set({phase:'error',detail:String(error.message || error)});
    }).finally(() => { active = null; });
    await active;
    return snapshot();
  }
  async function validInstaller(file, info) {
    return (await regularFile(file))?.size === info.files[0].size && await fileDigest(file) === info.sha512;
  }
  async function restore(paths) {
    const stat = await regularFile(paths.manifest);
    if (!stat) return false;
    let saved;
    try {
      if (stat.size <= 32768) saved = decodeManifest(await fs.readFile(paths.manifest));
      if (saved && newerRelease(saved.version,currentVersion) && await validInstaller(paths.pending,saved)) {
        manifest = saved;
        set({phase:'ready',version:saved.version,fullBytes:saved.files[0].size,detail:undefined});
        return true;
      }
    } catch { /* A damaged or obsolete pending update can be downloaded again. */ }
    try {
      await fs.rm(paths.pending,{force:true});
      await fs.rm(paths.manifest,{force:true});
    } catch (error) { if (!['EPERM','EBUSY','EACCES'].includes(error.code)) throw error; }
    return false;
  }
  async function check() {
    if (state.phase === 'ready' || state.phase === 'installing') return snapshot();
    return run(async () => {
      set({phase:'checking',detail:undefined,reason:undefined,received:0,bytes:undefined,mode:undefined,version:undefined});
      const paths = await cachePaths(workspace);
      for (const name of ['download.part','manifest.part']) {
        const file = path.join(paths.dir,name);
        if (await regularFile(file)) await fs.unlink(file);
      }
      if (await restore(paths)) return;
      const response = await request(new URL('latest/download/latest.yml',releaseFeed).href);
      if (response.status === 404) { set({phase:'unpublished'}); return; }
      const info = decodeManifest(await readBytes(response,32768));
      if (!newerRelease(info.version,currentVersion)) { set({phase:'current'}); return; }
      manifest = info;
      operations = null;
      const file = info.files[0], base = await regularFile(paths.base);
      let reason = 'base';
      if (base) {
        reason = 'map';
        try {
          const [before,after] = await Promise.all([
            request(versionAsset(currentVersion,setupName(currentVersion)+'.blockmap')).then(r => readBytes(r,maxBlockmap)),
            request(versionAsset(info.version,file.url+'.blockmap')).then(r => readBytes(r,info.blockMap.size))
          ]);
          const plan = planBlocks(parseBlockmap(before,base.size),parseBlockmap(after,file.size,info.blockMap));
          if (plan.some(op => !op.remote)) operations = plan;
        } catch { /* The signed full installer remains available when either block map is unavailable. */ }
      }
      const bytes = operations ? operations.reduce((n,op) => n + (op.remote ? op.length : 0),0) : file.size;
      set({phase:'available',version:info.version,mode:operations ? 'delta' : 'full',bytes,fullBytes:file.size,reason:operations ? undefined : reason});
    });
  }
  async function download() {
    if (state.phase !== 'available') return snapshot();
    return run(async () => {
      const paths = await cachePaths(workspace), file = manifest.files[0], full = !operations;
      const temp = path.join(paths.dir,'download.part');
      const receipt = path.join(paths.dir,'manifest.part');
      const plan = operations || [{remote:true,start:0,length:file.size}];
      let base, output, received = 0, lastReport = 0;
      set({phase:'downloading',received:0,detail:undefined});
      try {
        output = await fs.open(temp,'wx');
        if (!full) base = await fs.open(paths.base,'r');
        await assembleInstaller({operations:plan,source:base,destination:output,size:file.size,full,
          fetchAsset:headers => request(versionAsset(manifest.version,file.url),headers,20*60*1000),
          progress:count => {
            received += count;
            if (Date.now()-lastReport >= 200) { lastReport=Date.now(); set({received}); }
          }});
        await output.sync();
        await output.close(); output = null;
        set({phase:'verifying',received});
        if (!await validInstaller(temp,manifest)) throw Error('Installer SHA-512 verification failed');
        await fs.writeFile(receipt,JSON.stringify(manifest),{flag:'wx'});
        await fs.rename(temp,paths.pending);
        await fs.rename(receipt,paths.manifest);
        set({phase:'ready'});
      } catch (error) {
        operations = null;
        set({phase:'available',mode:'full',reason:full ? 'retry' : 'delta',bytes:file.size,received:0,detail:error.message});
      } finally {
        await base?.close(); await output?.close();
        await fs.rm(temp,{force:true}); await fs.rm(receipt,{force:true});
      }
    });
  }
  async function apply() {
    if (state.phase !== 'ready') return snapshot();
    return run(async () => {
      set({phase:'verifying',detail:undefined});
      const paths = await cachePaths(workspace);
      // Verify again after time spent waiting for the user's explicit restart.
      if (!await validInstaller(paths.pending,manifest)) {
        operations = null;
        set({phase:'available',mode:'full',reason:'retry',bytes:manifest.files[0].size,received:0,detail:'Installer SHA-512 verification failed'});
        return;
      }
      set({phase:'preparing'});
      await install(paths.pending,workspace.directory);
      set({phase:'installing'});
      quit();
    });
  }
  return {snapshot,check,download,apply,close:() => lifetime.abort()};
}
