import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {createConnection,createServer} from 'node:net';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {beginApplicationUpdate,entry,finishApplicationUpdate,helperReceipt,installedRuntime,preflightApplication,
  processAlive,readJournal,readJson,safeDirectory,stagedPayload,transactionPaths,transactionToken,updatePaths,writeJson} from './app-update-transaction.mjs';
import {validReleaseVersion} from './update-release.mjs';

export const startupArgument = '--studio-app-update=';
const shutdownWait = 60_000, startupWait = 60_000;
const removeFile = async file => { if (await entry(file)) await fs.unlink(file); };

export function desktopEnvironment() {
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return env;
}

function workspacePipe(paths) {
  const id = createHash('sha256').update(paths.workspace.toLowerCase()).digest('hex').slice(0,32);
  return '\\\\.\\pipe\\AIMatterLab-AppUpdate-'+id;
}

export async function activeUpdateHelper(paths,lock) {
  if (!transactionToken(lock?.token) || !processAlive(lock.pid)) return false;
  return await new Promise(resolve=>{
    const socket = createConnection(workspacePipe(paths));
    const finish = active => { clearTimeout(timer); socket.destroy(); resolve(active); };
    const timer = setTimeout(()=>finish(false),500);
    socket.once('connect',()=>finish(true));
    socket.once('error',()=>finish(false));
  });
}

async function lockWorkspace(paths) {
  // The OS releases this lock even if the helper process terminates unexpectedly.
  const server = createServer(socket=>socket.destroy());
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(workspacePipe(paths),resolve);
  });
  return server;
}

async function waitForExit(pid,timeout=shutdownWait) {
  const until = Date.now()+timeout;
  while (processAlive(pid)) {
    if (Date.now()>=until) throw Error('AIMatterLab did not close before the application update');
    await delay(100);
  }
}

function startDesktop(paths,token) {
  const args = token ? [startupArgument+token] : [];
  const child = spawn(paths.executable,args,{cwd:paths.workspace,detached:true,stdio:'ignore',env:desktopEnvironment()});
  const spawned = new Promise((resolve,reject)=>{
    child.once('spawn',resolve);
    child.once('error',reject);
  });
  return {child,spawned};
}

async function relaunch(paths) {
  const {child,spawned} = startDesktop(paths);
  await spawned;
  child.unref();
}

async function trialSucceeded(paths,journal) {
  const {started,starting} = transactionPaths(paths,journal.token);
  if (!await safeDirectory(path.dirname(starting))) return false;
  const [receipt,owner] = await Promise.all([readJson(started),readJson(starting)]);
  return receipt?.token===journal.token && receipt.version===journal.version &&
    owner?.token===journal.token && owner.pid===receipt.pid;
}

async function trialStartup(paths,journal) {
  const {child,spawned} = startDesktop(paths,journal.token);
  let healthy = false;
  try {
    await spawned;
    const until = Date.now()+startupWait;
    while (Date.now()<until) {
      if (await trialSucceeded(paths,journal)) {
        const receipt = await readJson(transactionPaths(paths,journal.token).started);
        if (receipt.pid===child.pid && child.exitCode===null && !child.signalCode) {
          healthy = true;
          child.unref();
          return true;
        }
      }
      if (child.exitCode!==null || child.signalCode) return false;
      await delay(100);
    }
    return false;
  } finally {
    if (child.pid && !healthy && child.exitCode===null && !child.signalCode) {
      child.kill();
      await waitForExit(child.pid,10_000);
    }
  }
}

async function waitForInterruptedTrial(paths,journal) {
  if (journal.phase!=='trial') return false;
  const {starting} = transactionPaths(paths,journal.token);
  if (!await safeDirectory(path.dirname(starting))) return false;
  const owner = await readJson(starting);
  const until = Date.now()+startupWait;
  while (true) {
    if (await trialSucceeded(paths,journal)) return true;
    if (owner?.token!==journal.token || !processAlive(owner.pid)) return false;
    if (Date.now()>=until) throw Error('AIMatterLab is still confirming an interrupted application update');
    await delay(100);
  }
}

async function runHelper(mode,parentPid,token,currentVersion,version,sha512) {
  const paths = updatePaths(path.dirname(process.execPath));
  const runtime = await installedRuntime(paths);
  if (process.platform!=='win32' || !['apply','recover'].includes(mode) ||
      !transactionToken(token) ||
      !validReleaseVersion(String(currentVersion).split('-')[0]) ||
      !processAlive(parentPid) || !runtime ||
      !await safeDirectory(paths.cache) || path.basename(process.execPath).toLowerCase()!=='aimatterlab.exe') {
    throw Error('Invalid AIMatterLab application update helper launch');
  }
  const server = await lockWorkspace(paths);
  const receipt = helperReceipt(paths,token);
  let parentClosed = false, ready = false, reopen = false;
  try {
    await writeJson(paths.lock,{pid:process.pid,token});
    const journal = await readJournal(paths,runtime);
    let staged;
    if (mode==='apply') {
      if (journal) throw Error('A previous application update still needs recovery');
      staged = await stagedPayload(paths,currentVersion);
      if (staged?.info.version!==version || staged?.info.appPayload.sha512!==sha512) {
        throw Error('The staged application update does not match the requested release');
      }
      await preflightApplication(paths,staged.payload.inventory);
    }
    await writeJson(receipt,{pid:process.pid,token,status:'ready'});
    ready = true;
    await waitForExit(parentPid);
    parentClosed = true;
    if (mode==='recover') {
      const success = journal && await waitForInterruptedTrial(paths,journal);
      const owner = success ? await readJson(transactionPaths(paths,journal.token).starting) : null;
      if (journal) await finishApplicationUpdate(paths,journal,Boolean(success));
      reopen = !success || !processAlive(owner?.pid);
    } else {
      try {
        const pending = await beginApplicationUpdate(paths,token,currentVersion,staged);
        const success = await trialStartup(paths,pending);
        await finishApplicationUpdate(paths,pending,success);
        reopen = !success;
      } catch (error) {
        const pending = await readJournal(paths,runtime);
        if (pending) {
          const success = pending.phase==='trial' && await trialSucceeded(paths,pending);
          await finishApplicationUpdate(paths,pending,success);
          reopen = !success;
        } else {
          const temp = transactionPaths(paths,token);
          if (await safeDirectory(temp.root)) await fs.rm(temp.root,{recursive:true,force:true});
          await writeJson(paths.failed,{version:staged.info.version,sha512:staged.info.appPayload.sha512});
          reopen = true;
        }
        console.error(error);
      }
    }
  } catch (error) {
    if (!ready) await writeJson(receipt,{pid:process.pid,token,status:'failed',message:error.message});
    throw error;
  } finally {
    if (parentClosed) await removeFile(receipt);
    await removeFile(paths.lock);
    await new Promise(resolve=>server.close(resolve));
  }
  if (reopen) await relaunch(paths);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  const [mode,pid,token,currentVersion,version,sha512] = process.argv.slice(2);
  try { await runHelper(mode,Number(pid),token,currentVersion,version,sha512); }
  catch (error) { console.error(error); process.exitCode=1; }
}
