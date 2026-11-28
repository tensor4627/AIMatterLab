import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {readAppPayload} from './app-payload.mjs';
import {activeUpdateHelper,desktopEnvironment,startupArgument} from './app-update-helper.mjs';
import {helperReceipt,installedRuntime,isSamePayload,managedWorkspace,preflightApplication,
  readJournal,readJson,safeDirectory,stagedPayload,transactionPaths,transactionToken,updatePaths,writeAtomic,writeJson} from './app-update-transaction.mjs';
import {newerRelease,readSignedRelease} from './update-release.mjs';

async function launchHelper(paths,mode,currentVersion,info,execPath=process.execPath) {
  if (path.relative(paths.executable,execPath)!=='' || !await installedRuntime(paths)) {
    throw Error('The application update helper is unavailable for this workspace');
  }
  const token = randomUUID(), receiptFile = helperReceipt(paths,token);
  const argumentsForHelper = [paths.helper,mode,String(process.pid),token,currentVersion];
  if (info) argumentsForHelper.push(info.version,info.appPayload.sha512);
  const child = spawn(execPath,argumentsForHelper,{cwd:paths.workspace,detached:true,stdio:'ignore',windowsHide:true,
    env:{...desktopEnvironment(),ELECTRON_RUN_AS_NODE:'1'}});
  const spawned = new Promise((resolve,reject)=>{
    child.once('spawn',resolve);
    child.once('error',reject);
  });
  let ready = false;
  try {
    await spawned;
    const until = Date.now()+30_000;
    while (Date.now()<until) {
      const receipt = await readJson(receiptFile);
      if (receipt?.pid===child.pid && receipt.token===token) {
        if (receipt.status==='failed') throw Error(receipt.message || 'Could not prepare the application update');
        if (receipt.status==='ready' && child.exitCode===null && !child.signalCode) {
          ready = true;
          child.unref();
          return;
        }
      }
      if (child.exitCode!==null || child.signalCode) break;
      await delay(75);
    }
    throw Error('The application update helper did not confirm readiness');
  } finally {
    if (!ready) {
      if (child.pid && child.exitCode===null && !child.signalCode) child.kill();
      await fs.rm(receiptFile,{force:true});
    }
  }
}

export function createLayeredWorkspaceUpdate({workspace,currentVersion,decodeManifest=readSignedRelease,execPath=process.execPath}) {
  const paths = updatePaths(workspace.directory);
  async function candidate(info) {
    if (!info?.appPayload) return null;
    try {
      const verified = decodeManifest(Buffer.from(JSON.stringify(info)));
      if (!verified.appPayload || !newerRelease(verified.version,currentVersion)) return null;
      const runtime = await installedRuntime(paths);
      if (!runtime || runtime.runtimeAbiVersion!==verified.runtimeAbiVersion) return null;
      if (await safeDirectory(paths.cache)) {
        const failed = await readJson(paths.failed);
        if (failed?.version===info.version && failed.sha512===info.appPayload.sha512 || await readJournal(paths,runtime)) return null;
      }
      return verified.appPayload;
    } catch { return null; }
  }

  async function restore() {
    try {
      const staged = await stagedPayload(paths,currentVersion,decodeManifest);
      if (staged && await candidate(staged.info)) {
        await preflightApplication(paths,staged.payload.inventory);
        return staged.info;
      }
    } catch { /* A damaged, obsolete, or conflicting application payload can use the installer. */ }
    return null;
  }

  async function stage(info,response,progress=()=>{}) {
    if (!await candidate(info) || !response.ok || response.status!==200 || !response.body) {
      await response.body?.cancel();
      throw Error('Application payload is unavailable for this workspace');
    }
    const chunks = [];
    let received = 0;
    for await (const bytes of response.body) {
      received += bytes.length;
      if (received>info.appPayload.size) throw Error('Unexpected extra application payload bytes');
      chunks.push(bytes);
      progress(received);
    }
    const data = Buffer.concat(chunks,received);
    const payload = readAppPayload(data,info);
    await preflightApplication(paths,payload.inventory);
    if (!await safeDirectory(paths.cache,true)) throw Error('Unable to create application update staging directory');
    await writeAtomic(paths.archive,data);
    await writeJson(paths.release,info);
  }

  async function launch(info) {
    try {
      const staged = await restore();
      if (!staged || !isSamePayload(staged,info)) throw Error('Verified application update is unavailable');
      await launchHelper(paths,'apply',currentVersion,info,execPath);
    } catch (error) {
      if (await safeDirectory(paths.cache).catch(()=>false)) {
        await writeJson(paths.failed,{version:info.version,sha512:info.appPayload.sha512}).catch(()=>{});
      }
      throw error;
    }
  }

  async function installerVersion() {
    try {
      const runtime = await installedRuntime(paths);
      return runtime?.installerVersion || currentVersion;
    } catch { return currentVersion; }
  }

  return {candidate,restore,stage,launch,installerVersion};
}

export async function prepareLayeredStartup({workspace,currentVersion,args=process.argv,execPath=process.execPath}) {
  const paths = updatePaths(workspace.directory);
  // Unrelated cache contents never become program update paths.
  if (!await managedWorkspace(paths) || !await safeDirectory(paths.cache).catch(()=>false)) return 'normal';
  const runtime = await installedRuntime(paths);
  if (!runtime) return 'normal';
  const lock = await readJson(paths.lock).catch(()=>null);
  const journal = await readJournal(paths,runtime);
  const token = args.find(arg=>arg.startsWith(startupArgument))?.slice(startupArgument.length);
  if (await activeUpdateHelper(paths,lock)) {
    if (journal?.phase==='trial' && journal.version===currentVersion && token===journal.token &&
        transactionToken(token) && lock.token===token) {
      const {starting} = transactionPaths(paths,token);
      if (!await safeDirectory(path.dirname(starting))) throw Error('Application update trial directory is missing');
      await writeJson(starting,{pid:process.pid,token});
      return 'trial';
    }
    return 'exit';
  }
  if (!journal) return 'normal';
  await launchHelper(paths,'recover',currentVersion,undefined,execPath);
  return 'exit';
}

export async function acknowledgeLayeredStartup(workspace,version,workbench) {
  const token = process.argv.find(arg=>arg.startsWith(startupArgument))?.slice(startupArgument.length);
  if (!workspace || !transactionToken(token)) return;
  const paths = updatePaths(workspace.directory), journal = await readJournal(paths);
  if (journal?.phase!=='trial' || journal.token!==token || journal.version!==version) return;
  const {started,starting} = transactionPaths(paths,token);
  if (!await safeDirectory(path.dirname(starting))) throw Error('Application update trial directory is missing');
  const owner = await readJson(starting);
  if (owner?.pid!==process.pid || owner.token!==token) throw Error('Application update trial process has changed');
  const until = Date.now()+15_000;
  let rendered = false;
  do {
    if (workbench.isDestroyed() || workbench.isCrashed()) break;
    rendered = await workbench.executeJavaScript(
      "Boolean(document.querySelector('#root > .application') && typeof window.studio?.invoke === 'function')");
    if (!rendered) await delay(100);
  } while (!rendered && Date.now()<until);
  if (!rendered) throw Error('The updated AIMatterLab workbench did not start');
  await writeJson(started,{pid:process.pid,token,version});
  return true;
}
