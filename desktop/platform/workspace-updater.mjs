import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {assembleInstaller, parseBlockmap, planBlocks, readBytes} from './update-blocks.mjs';
import {fileDigest, maxBlockmap, newerRelease, readSignedRelease, setupName} from './update-release.mjs';
import {createUpdateFeeds, sourceName, updateSources} from './update-feeds.mjs';

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
    cwd:workspace, detached:true, stdio:'ignore', windowsHide:false
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

export function createWorkspaceUpdater({workspace, currentVersion, fetchApi, tokenFor, publish, install, quit, decodeManifest=readSignedRelease}) {
  let state = {phase:workspace ? 'idle' : 'disabled', currentVersion, sequence:0};
  let manifest, operations, active, releaseSource, downloadSource;
  const lifetime = new AbortController();
  const feeds = createUpdateFeeds({fetchApi,tokenFor,signal:lifetime.signal});
  const snapshot = () => ({...state});
  function set(fields) {
    state = {...state,...fields,sequence:state.sequence+1};
    publish(snapshot());
  }
  async function run(action) {
    if (!workspace) return snapshot();
    if (active) { await active; return snapshot(); }
    active = Promise.resolve().then(action).catch(error => {
      set({phase:'error',automatic:false,detail:String(error.message || error)});
    }).finally(() => { active = null; });
    await active;
    return snapshot();
  }
  async function validInstaller(file, info) {
    return (await regularFile(file))?.size === info.files[0].size && await fileDigest(file) === info.sha512;
  }
  async function latest() {
    const issues = [];
    for (const source of updateSources) {
      lifetime.signal.throwIfAborted();
      set({source,step:'manifest'});
      let data;
      try {
        const response = await feeds.asset(source,null,'latest.yml');
        const webPage=response.ok && response.headers.get('content-type')?.includes('text/html');
        if (!response.ok || webPage) {
          issues.push({source,status:response.status,...(webPage ? {webPage:true} : {})});
          await response.body?.cancel();
          continue;
        }
        data = await readBytes(response,32768);
      } catch {
        issues.push({source,status:0});
        continue;
      }
      // A reachable but untrusted manifest must never select a package.
      try { manifest = decodeManifest(data); }
      catch { throw Error(sourceName(source)+' · Invalid release signature or manifest'); }
      releaseSource = downloadSource = source;
      return true;
    }
    const missing = issues.every(issue => issue.status === 404);
    set({phase:missing ? 'unpublished' : 'error',source:undefined,issues});
    return false;
  }
  // Always request the same version and filename on the mirror. The signed manifest
  // from the selected release remains the authority for the reconstructed bytes.
  async function asset(version, name, headers = {}, timeout, installer = false) {
    const preferred = installer ? downloadSource : releaseSource;
    const sources = [preferred,...updateSources.filter(source => source !== preferred)];
    let failure;
    for (const source of sources) {
      lifetime.signal.throwIfAborted();
      try {
        const response = await feeds.asset(source,version,name,headers,timeout);
        if (response.status !== (headers.Range ? 206 : 200)) {
          await response.body?.cancel();
          throw Error('HTTP '+response.status);
        }
        if (installer && downloadSource !== source) { downloadSource=source; set({source}); }
        return response;
      } catch (error) { failure=sourceName(source)+' · '+error.message; }
    }
    throw Error(failure);
  }
  async function restore(paths) {
    const stat = await regularFile(paths.manifest);
    if (!stat) return false;
    let saved;
    try {
      if (stat.size <= 32768) saved = decodeManifest(await fs.readFile(paths.manifest));
      if (saved && newerRelease(saved.version,currentVersion) && await validInstaller(paths.pending,saved)) {
        manifest = saved;
        releaseSource = downloadSource = updateSources[0];
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
      set({phase:'checking',step:'cache',automatic:false,detail:undefined,issues:undefined,source:undefined,
        reason:undefined,received:0,assembled:0,bytes:undefined,fullBytes:undefined,mode:undefined,version:undefined});
      feeds.clear();
      const paths = await cachePaths(workspace);
      for (const name of ['download.part','manifest.part']) {
        const file = path.join(paths.dir,name);
        if (await regularFile(file)) await fs.unlink(file);
      }
      if (await restore(paths)) return;
      if (!await latest()) return;
      const info = manifest;
      if (!newerRelease(info.version,currentVersion)) { set({phase:'current',version:info.version}); return; }
      operations = null;
      const file = info.files[0], base = await regularFile(paths.base);
      let reason = 'base';
      if (base) {
        reason = 'map';
        set({step:'blocks',version:info.version});
        try {
          const [before,after] = await Promise.all([
            asset(currentVersion,setupName(currentVersion)+'.blockmap').then(r => readBytes(r,maxBlockmap)),
            asset(info.version,file.url+'.blockmap').then(r => readBytes(r,info.blockMap.size))
          ]);
          const plan = planBlocks(parseBlockmap(before,base.size),parseBlockmap(after,file.size,info.blockMap));
          if (plan.some(op => !op.remote)) operations = plan;
        } catch { /* The signed full installer remains available when either block map is unavailable. */ }
      }
      const bytes = operations ? operations.reduce((n,op) => n + (op.remote ? op.length : 0),0) : file.size;
      set({phase:'available',version:info.version,mode:operations ? 'delta' : 'full',bytes,fullBytes:file.size,reason:operations ? undefined : reason});
    });
  }
  async function downloadPackage() {
    const paths = await cachePaths(workspace), file = manifest.files[0], full = !operations;
    const temp = path.join(paths.dir,'download.part');
    const receipt = path.join(paths.dir,'manifest.part');
    const plan = operations || [{remote:true,start:0,length:file.size}];
    let base, output, received = 0, assembled = 0, lastReport = 0;
    set({phase:'downloading',received:0,assembled:0,detail:undefined});
    try {
      output = await fs.open(temp,'wx');
      if (!full) base = await fs.open(paths.base,'r');
      await assembleInstaller({operations:plan,source:base,destination:output,size:file.size,full,
        fetchAsset:headers => asset(manifest.version,file.url,headers,20*60*1000,true),
        progress:(downloaded,written) => {
          received += downloaded;
          assembled += written;
          if (Date.now()-lastReport >= 200) { lastReport=Date.now(); set({received,assembled}); }
        }});
      await output.sync();
      await output.close(); output = null;
      set({phase:'verifying',received,assembled});
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
  }
  async function installPackage() {
    set({phase:'verifying',detail:undefined});
    const paths = await cachePaths(workspace);
    // Verify again after time spent waiting for the user's explicit restart.
    if (!await validInstaller(paths.pending,manifest)) {
      operations = null;
      set({phase:'available',mode:'full',reason:'retry',bytes:manifest.files[0].size,received:0,detail:'Installer SHA-512 verification failed'});
      return;
    }
    set({phase:'preparing'});
    try { await install(paths.pending,workspace.directory); }
    catch (error) { set({phase:'ready',detail:error.message,automatic:false}); return; }
    set({phase:'installing'});
    quit();
  }
  const download = () => state.phase === 'available' ? run(downloadPackage) : Promise.resolve(snapshot());
  const apply = () => state.phase === 'ready' ? run(installPackage) : Promise.resolve(snapshot());
  function update() {
    if (!['available','ready'].includes(state.phase)) return Promise.resolve(snapshot());
    return run(async () => {
      set({automatic:true});
      if (state.phase === 'available') {
        await downloadPackage();
        if (state.phase === 'available' && state.reason === 'delta') await downloadPackage();
      }
      if (state.phase === 'ready') await installPackage();
      if (state.phase !== 'installing') set({automatic:false});
    });
  }
  return {snapshot,check,download,apply,update,close:() => lifetime.abort()};
}
