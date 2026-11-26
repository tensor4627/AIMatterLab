import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {assembleInstaller, parseBlockmap, planBlocks, readBytes, UpdateTransferError} from './update-blocks.mjs';
import {fileDigest, maxBlockmap, maxReleaseManifest, newerRelease, readSignedRelease, setupName, validReleaseVersion} from './update-release.mjs';
import {createUpdateFeeds, sourceName, updateSources} from './update-feeds.mjs';

async function regularFile(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('Invalid file in the update cache');
    return stat;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function sameInstallerFile(first, second) {
  return Boolean(first && second && first.dev === second.dev && first.ino === second.ino &&
    first.size === second.size && first.mtimeMs === second.mtimeMs && first.birthtimeMs === second.birthtimeMs);
}

function sameInstallerSnapshot(first, second) {
  return sameInstallerFile(first, second) && first.ctimeMs === second.ctimeMs;
}

async function verifyInstaller(file, info, output, streamedSha512) {
  const before = await regularFile(file);
  if (before?.size !== info.files[0].size || (output && !sameInstallerSnapshot(before, await output.stat()))) return null;
  const digest = streamedSha512 ?? await fileDigest(file);
  if (digest !== info.sha512 || !sameInstallerSnapshot(before, await regularFile(file))) return null;
  return before;
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

export function createWorkspaceUpdater({workspace, currentVersion, fetchApi, tokenFor, publish, install, quit, layered, decodeManifest=readSignedRelease}) {
  let state = {phase:workspace ? 'idle' : 'disabled', currentVersion, sequence:0};
  let manifest, operations, appPayload, active, releaseSource, downloadSource, verifiedInstaller;
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
  async function asset(version, name, {headers = {}, timeout, signal = lifetime.signal, fetchInstaller, consume} = {}) {
    const preferred = fetchInstaller ? downloadSource : releaseSource;
    const sources = [preferred,...updateSources.filter(source => source !== preferred)];
    let failure;
    for (const source of sources) {
      signal.throwIfAborted();
      try {
        if (fetchInstaller) {
          const result = await fetchInstaller(source,headers,signal,consume);
          if (source !== preferred && downloadSource === preferred) { downloadSource=source; set({source}); }
          return result;
        }
        const response = await feeds.asset(source,version,name,headers,timeout,signal);
        if (response.status !== (headers.Range ? 206 : 200)) {
          await response.body?.cancel();
          throw Error('HTTP '+response.status);
        }
        return response;
      } catch (error) {
        signal.throwIfAborted();
        if (fetchInstaller && !(error instanceof UpdateTransferError)) throw error;
        failure=sourceName(source)+' · '+error.message;
      }
    }
    throw new UpdateTransferError(failure);
  }
  async function restore(paths) {
    const stat = await regularFile(paths.manifest);
    if (!stat) return false;
    let saved;
    try {
      if (stat.size <= 32768) saved = decodeManifest(await fs.readFile(paths.manifest));
      if (saved && newerRelease(saved.version,currentVersion)) {
        // A receipt on disk is editable. Verify the cached bytes once per process.
        const verified = await verifyInstaller(paths.pending,saved);
        if (verified) {
          manifest = saved;
          verifiedInstaller = {sha512:saved.sha512, stat:verified};
          releaseSource = downloadSource = updateSources[0];
          set({phase:'ready',version:saved.version,fullBytes:saved.files[0].size,detail:undefined});
          return true;
        }
      }
    } catch { /* A damaged or obsolete pending update can be downloaded again. */ }
    try {
      await fs.rm(paths.pending,{force:true});
      await fs.rm(paths.manifest,{force:true});
    } catch (error) { if (!['EPERM','EBUSY','EACCES'].includes(error.code)) throw error; }
    return false;
  }
  async function completeInstallerPromotion(paths) {
    const version = layered ? await layered.installerVersion() : currentVersion;
    if (!validReleaseVersion(version)) return true;
    const marker = path.join(paths.dir,'promote-installer-'+version+'.ready');
    const confirmation = await regularFile(marker).catch(() => null);
    if (!confirmation || confirmation.size !== 0) return true;
    let installed;
    try {
      const receipt = await regularFile(paths.manifest);
      if (receipt?.size <= maxReleaseManifest) installed = decodeManifest(await fs.readFile(paths.manifest));
    } catch { /* A stale marker cannot promote a different download. */ }
    const pending = await regularFile(paths.pending);
    if (installed?.version === version && pending?.size === installed.files[0].size) {
      // NSIS can keep its own executable open until exit. The base is used only
      // as input to reconstruction, whose signed output still requires SHA-512.
      for (let attempt=0;; attempt++) {
        try { await fs.rename(paths.pending,paths.base); break; }
        catch (error) {
          if (!['EPERM','EBUSY','EACCES'].includes(error.code)) throw error;
          if (attempt===4) return false;
          await delay(150,undefined,{signal:lifetime.signal});
        }
      }
      await fs.rm(paths.manifest,{force:true});
    }
    await fs.rm(marker,{force:true});
    return true;
  }
  async function planInstaller(paths, appFailure, baseReady=true) {
    appPayload = null;
    operations = null;
    const info = manifest;
    const file = info.files[0], base = baseReady && await regularFile(paths.base);
    let reason = 'base';
    if (base) {
      reason = 'map';
      set({phase:'checking',step:'blocks',version:info.version});
      try {
        const baseVersion = layered ? await layered.installerVersion() : currentVersion;
        const [before,after] = await Promise.all([
          asset(baseVersion,setupName(baseVersion)+'.blockmap').then(r => readBytes(r,maxBlockmap)),
          asset(info.version,file.url+'.blockmap').then(r => readBytes(r,info.blockMap.size))
        ]);
        const plan = planBlocks(parseBlockmap(before,base.size),parseBlockmap(after,file.size,info.blockMap));
        if (plan.some(op => !op.remote)) operations = plan;
      } catch { /* Either missing block map leaves the signed full installer available. */ }
    }
    const bytes = operations ? operations.reduce((n,op) => n + (op.remote ? op.length : 0),0) : file.size;
    set({phase:'available',version:info.version,mode:operations ? 'delta' : 'full',bytes,fullBytes:file.size,
      reason:appFailure ? 'app' : operations ? undefined : reason,detail:appFailure,received:0,assembled:0});
  }
  async function check() {
    if (state.phase === 'ready' || state.phase === 'installing') return snapshot();
    return run(async () => {
      set({phase:'checking',step:'cache',automatic:false,detail:undefined,issues:undefined,source:undefined,
        reason:undefined,received:0,assembled:0,bytes:undefined,fullBytes:undefined,mode:undefined,version:undefined});
      feeds.clear();
      const paths = await cachePaths(workspace);
      const baseReady = await completeInstallerPromotion(paths);
      for (const name of ['download.part','manifest.part']) {
        const file = path.join(paths.dir,name);
        if (await regularFile(file)) await fs.unlink(file);
      }
      appPayload = null;
      if (layered) {
        const cached = await layered.restore().catch(() => null);
        if (cached && newerRelease(cached.version,currentVersion)) {
          manifest = cached;
          appPayload = cached.appPayload;
          releaseSource = downloadSource = updateSources[0];
          set({phase:'ready',mode:'app',version:cached.version,fullBytes:appPayload.size});
          return;
        }
      }
      if (baseReady && await restore(paths)) return;
      if (!await latest()) return;
      const info = manifest;
      if (!newerRelease(info.version,currentVersion)) { set({phase:'current',version:info.version}); return; }
      if (layered) appPayload = await layered.candidate(info).catch(() => null);
      if (appPayload) {
        set({phase:'available',version:info.version,mode:'app',bytes:appPayload.size,fullBytes:appPayload.size});
      } else {
        await planInstaller(paths,undefined,baseReady);
      }
    });
  }
  async function downloadLayer(paths) {
    let lastReport = 0;
    set({phase:'downloading',received:0,assembled:0,detail:undefined});
    try {
      const response = await asset(manifest.version,appPayload.url,{timeout:20*60*1000});
      await layered.stage(manifest,response,received => {
        if (Date.now()-lastReport >= 200) {
          lastReport=Date.now();
          set({received,assembled:received});
        }
      });
      set({phase:'ready',received:appPayload.size,assembled:appPayload.size});
    } catch (error) {
      lifetime.signal.throwIfAborted();
      await planInstaller(paths,String(error.message || error));
    }
  }
  async function downloadPackage() {
    const paths = await cachePaths(workspace);
    if (appPayload) return downloadLayer(paths);
    const file = manifest.files[0], full = !operations;
    const temp = path.join(paths.dir,'download.part');
    const receipt = path.join(paths.dir,'manifest.part');
    const plan = operations || [{remote:true,start:0,length:file.size}];
    const fetchInstaller = feeds.installer(manifest.version,file.url,20*60*1000);
    let base, output, received = 0, assembled = 0, lastReport = 0;
    verifiedInstaller = undefined;
    set({phase:'downloading',received:0,assembled:0,detail:undefined});
    try {
      output = await fs.open(temp,'wx');
      if (!full) base = await fs.open(paths.base,'r');
      const {fullDownloadSha512} = await assembleInstaller({operations:plan,source:base,destination:output,size:file.size,full,signal:lifetime.signal,
        fetchAsset:(headers,signal,consume) => asset(manifest.version,file.url,{headers,signal,fetchInstaller,consume}),
        progress:(downloaded,written) => {
          received += downloaded;
          assembled += written;
          if (Date.now()-lastReport >= 200) { lastReport=Date.now(); set({received,assembled}); }
        }});
      await output.sync();
      set({phase:'verifying',received,assembled});
      const verified = await verifyInstaller(temp,manifest,output,fullDownloadSha512);
      if (!verified) throw Error('Installer SHA-512 verification failed');
      await fs.rename(temp,paths.pending);
      const stat = await regularFile(paths.pending);
      if (!sameInstallerFile(verified,stat) || !sameInstallerSnapshot(stat,await output.stat())) throw Error('Installer changed during download');
      await output.close(); output = null;
      await fs.writeFile(receipt,JSON.stringify({...manifest, installerReceipt:{size:stat.size,mtimeMs:stat.mtimeMs}}),{flag:'wx'});
      await fs.rename(receipt,paths.manifest);
      verifiedInstaller = {sha512:manifest.sha512, stat};
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
    if (appPayload) {
      set({phase:'preparing'});
      try { await layered.launch(manifest); }
      catch (error) {
        await planInstaller(paths,String(error.message || error));
        return;
      }
      set({phase:'installing'});
      quit();
      return;
    }
    const stat = await regularFile(paths.pending);
    if (verifiedInstaller?.sha512 !== manifest.sha512 || !sameInstallerSnapshot(verifiedInstaller.stat,stat)) {
      const verified = await verifyInstaller(paths.pending,manifest);
      verifiedInstaller = verified ? {sha512:manifest.sha512, stat:verified} : undefined;
    }
    if (!verifiedInstaller) {
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
      // A single action can try the app payload, then the differential and full installers.
      for (let attempt=0; attempt<3 && !lifetime.signal.aborted; attempt++) {
        if (state.phase === 'available') await downloadPackage();
        if (state.phase === 'ready' && !lifetime.signal.aborted) await installPackage();
        if (state.phase !== 'available' || !['app','delta'].includes(state.reason)) break;
      }
      if (state.phase !== 'installing') set({automatic:false});
    });
  }
  return {snapshot,check,download,apply,update,close:() => lifetime.abort()};
}
