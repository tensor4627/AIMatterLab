/** A Windows OpenSSH login with private console authentication and remote PTYs. */
import net from 'node:net';
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { drainOwnedConpty, TerminalFault } from './session.mjs';

const fault = (code) => new TerminalFault(code, 409);
const toWindows = (value) =>
  /^\/mnt\/[a-z]\//i.test(value) ? value[5].toUpperCase() + ':\\' + value.slice(7).replaceAll('/', '\\') : value;
const absoluteWindows = (value) => /^(?:[a-z]:[\\/]|\\\\[^\\])/i.test(value);
const launcher = fileURLToPath(new URL('./native-ssh-stdio.mjs', import.meta.url));
const relayFile = new URL('./native-ssh-relay.py', import.meta.url);
const unstyle = (value) => value.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g, '');
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const limit = 2 * 1024 * 1024;

export function nativeSshPlan(profile, { cwd, env, knownHostsFile }) {
  const file = toWindows(profile.ssh_client);
  if (!absoluteWindows(file) || path.win32.basename(file).toLowerCase() !== 'ssh.exe')
    throw fault('ssh_multiplex_unsupported');
  let key = toWindows(profile.identity_file || '');
  if (key.startsWith('~/') && env.USERPROFILE) key = path.win32.join(env.USERPROFILE, key.slice(2));
  if (key && !absoluteWindows(key)) throw fault('ssh_native_key_path_required');
  const batch = profile.mode === 'key';
  const args = [
    '-tt',
    '-F',
    'NUL',
    '-o',
    'StrictHostKeyChecking=' + (batch ? 'yes' : 'ask'),
    '-o',
    'BatchMode=' + (batch ? 'yes' : 'no'),
    '-o',
    'ConnectionAttempts=1',
    '-o',
    'ConnectTimeout=15',
    '-o',
    'ForwardAgent=no',
    '-o',
    'ClearAllForwardings=yes',
    '-o',
    'PermitLocalCommand=no',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=2'
  ];
  if (knownHostsFile)
    args.push(
      '-o',
      'UserKnownHostsFile="' + knownHostsFile.replaceAll('\\', '/') + '"',
      '-o',
      'GlobalKnownHostsFile=NUL'
    );
  if (profile.proxy_jump?.length) args.push('-J', profile.proxy_jump.join(','));
  if (key) args.push('-i', key);
  args.push('-l', profile.username, '-p', String(profile.port), profile.host);
  return { native: true, file, args, cwd, env };
}

function pending(ms, code, onTimeout) {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  const timer = setTimeout(() => {
    reject(fault(code));
    onTimeout?.();
  }, ms);
  return {
    promise,
    resolve: (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    reject: (error) => {
      clearTimeout(timer);
      reject(error);
    }
  };
}

export async function openNativeSsh({ pty, plan, onPrivate, onLost, assertCurrent = () => {} }) {
  if (!statSync(plan.file, { throwIfNoEntry: false })?.isFile()) throw fault('ssh_client_unavailable');
  const pipe = '\\\\.\\pipe\\aimatterlab-ssh-' + randomUUID(),
    token = randomBytes(32).toString('hex'),
    nonce = randomBytes(24).toString('hex');
  const proof = '__AIM_SHELL_' + nonce + '__',
    channels = new Map(),
    clients = new Set();
  const program = deflateSync(readFileSync(relayFile)).toString('base64');
  const python =
    "import base64,zlib;exec(compile(zlib.decompress(base64.b64decode('" + program + "')),'<ssh-pty>','exec'))";
  const bootstrap =
    'p=$(command -v python3 || command -v python) && exec "$p" -u -c ' + shellQuote(python) + ' ' + nonce;
  // Keep the echoed probe distinct from the answer. Never enqueue a deployment
  // script at an SSH password prompt or a gateway menu.
  const probe = "printf '\\n%s%s\\n' '__AIM_SHELL_' '" + nonce + "__'\r";
  let term,
    socket,
    phase = 'prompt',
    tail = '',
    buffer = '',
    probeSent = false,
    closed = false,
    challenge = null,
    serial = 0,
    startTimer,
    exitEvent;
  const exits = new Set();
  let childExited = false,
    disposed = false,
    exitTail = '',
    forceTimer;
  const exitReceipt = '\n__AIM_LOCAL_EXIT_' + token + '__\n';
  const server = net.createServer({ allowHalfOpen: true }, accept);
  function disposeConsole() {
    clearTimeout(forceTimer);
    if (disposed || !term || exitEvent) return;
    disposed = true;
    try {
      term.kill();
    } catch {}
  }
  function send(message) {
    if (!socket || closed || socket.writableLength > limit) throw fault('ssh_channel_unavailable');
    writeRemote(JSON.stringify(message) + '\n');
  }
  function writeRemote(data) {
    socket.write(JSON.stringify(data) + '\n');
  }
  function terminate(code) {
    if (closed) return;
    closed = true;
    clearTimeout(startTimer);
    const error = fault(code);
    challenge?.reject(error);
    challenge = null;
    for (const channel of [...channels.values()]) channel.end({ exitCode: null, signal: null }, error);
    for (const stream of clients) if (stream !== socket) stream.destroy();
    if (socket && !socket.destroyed && !childExited) {
      socket.write('null\n');
      forceTimer = setTimeout(disposeConsole, 1500);
    } else disposeConsole();
    if (server.listening) server.close();
    if (code !== 'ssh_connection_changed') onLost(code);
  }
  function accept(stream) {
    if (closed || socket || clients.size >= 8) {
      stream.destroy();
      return;
    }
    clients.add(stream);
    let header = Buffer.alloc(0);
    const timer = setTimeout(() => stream.destroy(), 3000);
    stream.on('error', () => stream.destroy());
    stream.on('close', () => {
      clearTimeout(timer);
      clients.delete(stream);
      if (socket === stream)
        terminate(phase === 'starting' ? 'ssh_remote_terminal_unavailable' : 'ssh_master_unavailable');
    });
    function authenticate(bytes) {
      header = Buffer.concat([header, bytes]);
      const end = header.indexOf(10);
      if (end < 0 && header.length <= token.length) return;
      if (socket || end !== token.length || header.subarray(0, end).toString() !== token) {
        stream.destroy();
        return;
      }
      clearTimeout(timer);
      stream.off('data', authenticate);
      socket = stream;
      server.close();
      stream.write(token + '\n');
      const decoder = new StringDecoder('utf8');
      const read = (chunk) => {
        try {
          receive(decoder.write(chunk));
        } catch {
          terminate('ssh_control_unavailable');
        }
      };
      stream.on('data', read);
      if (header.length > end + 1) read(header.subarray(end + 1));
    }
    stream.on('data', authenticate);
  }
  function receive(data) {
    exitTail = (exitTail + data).slice(-exitReceipt.length);
    if (exitTail === exitReceipt) {
      childExited = true;
      socket.end();
      terminate(phase === 'starting' ? 'ssh_remote_terminal_unavailable' : 'ssh_master_unavailable');
      disposeConsole();
      return;
    }
    if (closed) return;
    if (phase === 'prompt') {
      onPrivate(data);
      tail = unstyle((tail + data).slice(-8192));
      if (tail.split(/\r?\n/).some((line) => line.trim() === proof)) {
        phase = 'starting';
        buffer = '';
        tail = '';
        writeRemote('exec /bin/sh -c ' + shellQuote(bootstrap) + '\r');
        startTimer = setTimeout(() => terminate('ssh_remote_terminal_unavailable'), 15000);
      } else if (!probeSent && /(?:^|[\r\n])[^\r\n]{0,500}[$#%>]\s*$/.test(tail)) {
        probeSent = true;
        writeRemote(probe);
      }
      return;
    }
    buffer += data;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line.length > 65536) throw fault('ssh_control_output_limit');
      if (phase === 'starting') {
        if (unstyle(line).split('\r').at(-1).trim() === JSON.stringify(['ready', nonce])) {
          clearTimeout(startTimer);
          phase = 'ready';
        }
      } else if (line) {
        dispatch(JSON.parse(line));
      }
    }
    if (buffer.length > 65536) throw fault('ssh_control_output_limit');
  }
  function dispatch([type, id, value]) {
    if (type === 'pong') {
      if (challenge?.id === id) {
        challenge.resolve();
        challenge = null;
      }
      return;
    }
    const ch = channels.get(id);
    if (!ch) return;
    if (type === 'opened' && Number.isSafeInteger(value) && value > 0) {
      ch.handle.pid = value;
      ch.opened.resolve(ch.handle);
    } else if (type === 'data' && typeof value === 'string' && value.length <= 16384) {
      ch.output(ch.decoder.write(Buffer.from(value, 'base64')));
    } else if (type === 'exit')
      ch.end({
        exitCode: Number.isInteger(value) && value >= 0 ? value : null,
        signal: Number.isInteger(value) && value < 0 ? -value : null
      });
    else throw fault('ssh_channel_unavailable');
  }
  async function openChannel(command) {
    if (phase !== 'ready' || closed || channels.size >= 16) throw fault('ssh_channel_unavailable');
    const id = ++serial,
      opened = pending(10000, 'ssh_channel_unavailable', () => terminate('ssh_channel_unavailable'));
    const decoder = new StringDecoder('utf8');
    let dataListener,
      exitListener,
      queued = '',
      ended;
    const handle = {
      pid: 0,
      onData(fn) {
        dataListener = fn;
        if (queued) {
          fn(queued);
          queued = '';
        }
      },
      onExit(fn) {
        exitListener = fn;
        if (ended) fn(ended);
      },
      write(data) {
        if (ended) throw fault('ssh_channel_unavailable');
        const bytes = Buffer.from(data);
        for (let at = 0; at < bytes.length; at += 16384)
          send(['write', id, bytes.subarray(at, at + 16384).toString('base64')]);
      },
      resize(cols, rows) {
        if (!ended) send(['resize', id, cols, rows]);
      },
      kill() {
        if (!ended && !closed) send(['close', id]);
      }
    };
    const channel = {
      opened,
      decoder,
      handle,
      output(data) {
        if (dataListener) dataListener(data);
        else if (queued.length + data.length <= 65536) queued += data;
        else terminate('ssh_control_output_limit');
      },
      end(event, error) {
        if (ended) return;
        ended = event;
        channels.delete(id);
        channel.output(decoder.end());
        opened.reject(error || fault('ssh_channel_unavailable'));
        exitListener?.(event);
      }
    };
    channels.set(id, channel);
    try {
      send(['open', id, 100, 30, command ?? null]);
    } catch (e) {
      channel.end({ exitCode: null, signal: null }, e);
    }
    return opened.promise;
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, resolve);
  });
  try {
    assertCurrent();
    const consoleHost = path.win32.join(plan.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
    // Electron is a GUI executable. Keep a console process attached to ConPTY for
    // its entire lifetime, including while ssh.exe is asking for credentials.
    // Only these two trusted runtime paths reach cmd. SSH arguments stay in the pipe helper.
    const launch = '/d /q /v:off /s /c "start "" /b /wait "%STUDIO_SSH_NODE_EXE%" "%STUDIO_SSH_LAUNCHER%""';
    const env = {
      ...plan.env,
      ELECTRON_RUN_AS_NODE: '1',
      STUDIO_SSH_NODE_EXE: process.execPath,
      STUDIO_SSH_LAUNCHER: launcher,
      STUDIO_NATIVE_SSH: JSON.stringify({ pipe, token, file: plan.file, args: plan.args })
    };
    term = pty.spawn(consoleHost, launch, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: plan.cwd,
      env,
      useConptyDll: true
    });
    term.onData((data) => {
      if (!closed && phase !== 'ready') onPrivate(data);
    });
    term.onExit((event) => {
      exitEvent = event;
      clearTimeout(forceTimer);
      drainOwnedConpty(term);
      const error = phase === 'starting' ? 'ssh_remote_terminal_unavailable' : 'ssh_master_unavailable';
      terminate(error);
      for (const cb of exits) cb(event);
    });
  } catch (error) {
    const code = error.code === 'ssh_connection_changed' ? error.code : 'ssh_client_unavailable';
    terminate(code);
    throw fault(code);
  }
  return {
    openChannel,
    transportClosed: () => !socket || childExited,
    ready: () => ({ ready: phase === 'ready' && !closed }),
    async check() {
      if (closed || phase !== 'ready') throw fault('ssh_authentication_unconfirmed');
      if (!challenge) {
        challenge = pending(5000, 'ssh_master_unavailable', () => terminate('ssh_master_unavailable'));
        challenge.id = randomUUID();
        try {
          send(['ping', challenge.id]);
        } catch (error) {
          const old = challenge;
          challenge = null;
          old.reject(error);
          return old.promise;
        }
      }
      return challenge.promise;
    },
    write(data) {
      if (closed || phase !== 'prompt') throw fault('ssh_authentication_not_pending');
      if (tail && socket) {
        if (/[\r\n]/.test(data)) probeSent = false;
        writeRemote(data);
      } else term.write(data);
    },
    resize: (cols, rows) => term.resize(cols, rows),
    kill: () => terminate('ssh_connection_changed'),
    onExit: (fn) => {
      if (exitEvent) fn(exitEvent);
      else exits.add(fn);
    }
  };
}
