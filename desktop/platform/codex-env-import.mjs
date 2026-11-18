import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseEnv} from 'node:util';
import {parse as parseToml} from '../vendor/smol-toml/parse.mjs';

const proxyKeys = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY', 'ELECTRON_GET_USE_PROXY']);
const modes = new Set(['proxy', 'full', 'none', 'cancel']);
const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'];
const maxBytes = 1024 * 1024;

function fileState(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 ? 'available' : 'unavailable';
  } catch (error) {
    return error.code === 'ENOENT' ? 'absent' : 'unavailable';
  }
}

function readSource(file, failureMessage = '无法读取本机 Codex .env。请检查文件，或选择独立配置。') {
  let fd;
  try {
    const prior = fs.lstatSync(file);
    if (!prior.isFile() || prior.isSymbolicLink() || prior.nlink !== 1 || prior.size > maxBytes) throw Error();
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    if (opened.dev !== prior.dev || opened.ino !== prior.ino || opened.size !== prior.size) throw Error();
    const bytes = Buffer.alloc(opened.size);
    let count = 0;
    while (count < bytes.length) {
      const n = fs.readSync(fd, bytes, count, bytes.length - count, null);
      if (!n) throw Error();
      count += n;
    }
    const after = fs.fstatSync(fd), current = fs.lstatSync(file);
    if (after.size !== bytes.length || after.mtimeMs !== prior.mtimeMs || after.nlink !== 1 ||
        current.isSymbolicLink() || current.dev !== after.dev || current.ino !== after.ino) throw Error();
    return bytes;
  } catch {
    throw Error(failureMessage);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function modelDefaults(model, effort) {
  const result = {};
  if (typeof model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) result.model = model;
  if (typeof effort === 'string' && /^[a-z][a-z0-9_-]{0,30}$/.test(effort)) result.effort = effort;
  return Object.keys(result).length ? result : null;
}

function nativePreferences(sourceHome) {
  const file = path.join(sourceHome, 'config.toml');
  if (fileState(file) === 'absent') return {};
  try {
    const text = new TextDecoder('utf-8',{fatal:true}).decode(readSource(file,'Codex config unavailable'));
    const config = parseToml(text,{maxDepth:64});
    return {defaults:modelDefaults(config.model,config.model_reasoning_effort),
      systemProxy:typeof config.features?.respect_system_proxy === 'boolean' ? config.features.respect_system_proxy : null};
  } catch { return {configIssue:true}; }
}

function proxyContent(bytes) {
  const lines = [];
  let hasBypass = false;
  let parsed;
  try {
    const source = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
    if (source.includes('\0')) throw Error();
    parsed = parseEnv(source);
  } catch {
    throw Error('无法解析本机 Codex .env。可选择整份复制或使用独立配置。');
  }
  for (const [name, value] of Object.entries(parsed)) {
    if (!proxyKeys.has(name.toUpperCase())) continue;
    // Write literal, single-line values. Expanding a reference could import an unrelated secret.
    if (/[\x00-\x1f\x7f$'\\]/.test(value)) {
      throw Error('代理值含变量引用或特殊字符。可选择整份复制或使用独立配置。');
    }
    if (name.toUpperCase() === 'NO_PROXY') {
      const bypass = new Set([...value.split(',').map(entry=>entry.trim()).filter(Boolean), ...loopback]);
      lines.push(name + "='" + [...bypass].join(',') + "'");
      hasBypass = true;
    } else {
      lines.push(name + "='" + value + "'");
    }
  }
  if (lines.length && !hasBypass) lines.push("NO_PROXY='" + loopback.join(',') + "'");
  return lines.length ? Buffer.from(lines.join('\n') + '\n') : null;
}

// Link the completed file when supported. On portable filesystems use an exclusive copy.
function publish(home, target, bytes) {
  const temp = path.join(home, '.env-import-' + randomUUID());
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, bytes); }
    finally { fs.closeSync(fd); }
    try { fs.linkSync(temp, target); }
    catch (error) {
      if (error.code === 'EEXIST') return false;
      if (!['ENOTSUP','EOPNOTSUPP','EPERM','ENOSYS','EXDEV','EINVAL'].includes(error.code)) throw error;
      try { fs.copyFileSync(temp,target,fs.constants.COPYFILE_EXCL); }
      catch (copyError) { if (copyError.code === 'EEXIST') return false; throw copyError; }
    }
    return true;
  } finally { fs.unlinkSync(temp); }
}

export function createCodexEnvImport({home, sourceHome, notify}) {
  const source = path.join(sourceHome, '.env');
  const target = path.join(home, '.env');
  const marker = path.join(home, '.env-import-choice');
  let pending = null;

  function settings() {
    if (fileState(marker) !== 'available') return {};
    try {
      const saved = JSON.parse(readSource(marker,'Codex preferences unavailable').toString('utf8'));
      if (saved.version !== 1 || typeof saved.id !== 'string' || !/^[a-f0-9-]{36}$/.test(saved.id)) return {};
      const defaults = modelDefaults(saved.defaults?.model,saved.defaults?.effort);
      return {...defaults?{defaults:{...defaults,id:saved.id}}:{},
        ...typeof saved.systemProxy === 'boolean'?{systemProxy:saved.systemProxy}:{}};
    } catch { return {}; }
  }

  function needsChoice() { return fileState(marker) === 'absent'; }
  function request(signal) {
    if (signal?.aborted) return Promise.reject(Error('已取消启动 Codex。'));
    if (!needsChoice()) return Promise.resolve();
    if (typeof notify !== 'function') throw Error('Codex configuration prompt is unavailable');
    const first = !pending;
    if (first) {
      const sourceState = fileState(target) === 'absent' ? fileState(source) : 'existing';
      const prefs = nativePreferences(sourceHome);
      const prompt = {requestId:randomUUID(),sourceState,hasModelDefaults:!!prefs.defaults,
        hasSystemProxy:typeof prefs.systemProxy === 'boolean',configIssue:!!prefs.configIssue};
      pending = {prompt,prefs,waiters:new Map()};
    }
    const current = pending;
    if (current.waiters.has(signal)) return current.waiters.get(signal).promise;
    const waiter = Promise.withResolvers();
    waiter.abort = ()=>{
      current.waiters.delete(signal);
      waiter.reject(Error('已取消启动 Codex。'));
      if (current === pending && !current.waiters.size) {pending=null;notify(null);}
    };
    current.waiters.set(signal,waiter);
    signal?.addEventListener('abort',waiter.abort,{once:true});
    if (first) notify(current.prompt);
    return waiter.promise;
  }
  function finish(cancelled) {
    const current = pending;
    pending = null;
    for (const [signal,waiter] of current.waiters) {
      signal?.removeEventListener('abort',waiter.abort);
      if (cancelled) waiter.reject(Error('已取消启动 Codex。'));
      else waiter.resolve();
    }
    notify(null);
  }
  function decide(input) {
    if (!input || Object.keys(input).some(key=>!['requestId','mode','useModelDefaults','useSystemProxy'].includes(key)) ||
        [input.useModelDefaults,input.useSystemProxy].some(value=>value!==undefined&&typeof value!=='boolean') || !pending ||
        input.requestId !== pending.prompt.requestId || !modes.has(input.mode)) throw Error('Codex 配置选择已失效，请重新连接。');
    if (input.mode === 'cancel') { finish(true); return; }
    const {prompt,prefs} = pending;
    const useSystemProxy = input.useSystemProxy ?? (input.mode==='proxy'&&prompt.hasSystemProxy);
    if (useSystemProxy && (!prompt.hasSystemProxy || input.mode==='none')) throw Error('Codex 配置选择已失效，请重新连接。');
    if (input.useModelDefaults && !prefs.defaults) throw Error('Codex 配置选择已失效，请重新连接。');
    if ((input.mode === 'full' || input.mode === 'proxy' && !prompt.hasSystemProxy) && prompt.sourceState !== 'available') {
      throw Error('没有可迁移的 Codex .env。请选择独立配置。');
    }
    let bytes = null;
    if (input.mode !== 'none' && prompt.sourceState === 'available' && fileState(target) === 'absent') {
      const contents = readSource(source);
      bytes = input.mode === 'full' ? contents : proxyContent(contents);
    }
    let created = null;
    try {
      if (bytes && publish(home, target, bytes)) created=fs.lstatSync(target);
      const saved = {version:1,id:prompt.requestId,mode:input.mode,
        ...input.useModelDefaults?{defaults:prefs.defaults}:{},
        ...useSystemProxy?{systemProxy:prefs.systemProxy}:{}};
      if (!publish(home,marker,Buffer.from(JSON.stringify(saved)+'\n'))) throw Error();
    } catch {
      if (created) {
        try {
          const now=fs.lstatSync(target);
          if (now.ino===created.ino && now.dev===created.dev && now.size===created.size && now.mtimeMs===created.mtimeMs) fs.unlinkSync(target);
        } catch { /* A later owner may have already replaced or removed the target. */ }
      }
      throw Error('无法保存 Codex 独立配置。请检查应用数据目录后重试。');
    }
    finish(false);
  }
  return {needsChoice, request, decide, settings, current:() => pending?.prompt ?? null};
}
