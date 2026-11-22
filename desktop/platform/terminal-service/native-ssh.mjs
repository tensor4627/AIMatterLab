/** A Windows OpenSSH login with private console authentication and remote PTYs. */
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { drainOwnedConpty, TerminalFault } from './session.mjs';

const fault = (code) => new TerminalFault(code, 409);
const toWindows = (value) =>
  /^\/mnt\/[a-z]\//i.test(value) ? value[5].toUpperCase() + ':\\' + value.slice(7).replaceAll('/', '\\') : value;
const absoluteWindows = (value) => /^(?:[a-z]:[\\/]|\\\\[^\\])/i.test(value);
const relayFile = new URL('./native-ssh-relay.py', import.meta.url);
const unstyle = (value) => value.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g, '');
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const terminalType = 'xterm';
const relayColumns = 500;
const frameEnd = ':__AIM_END__';

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
  if (!batch) args.push('-o', 'PreferredAuthentications=keyboard-interactive,password,publickey,gssapi-with-mic,hostbased');
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
  if (!statSync(plan.file, { throwIfNoEntry: false })?.isFile()) throw fault('ssh_windows_client_unavailable');
  const nonce = randomBytes(24).toString('hex');
  const proof = '__AIM_SHELL_' + nonce + '__',
    channels = new Map();
  const program = deflateSync(readFileSync(relayFile)).toString('base64');
  const python =
    "import base64,zlib;exec(compile(zlib.decompress(base64.b64decode('" + program + "')),'<ssh-pty>','exec'))";
  const bootstrap =
    'p=$(command -v python3 || command -v python) && exec "$p" -u -c ' + shellQuote(python);
  // Keep the echoed probe distinct from the answer. Never enqueue a deployment
  // script at an SSH password prompt or a gateway menu.
  const probe = "printf '\\n%s%s\\n' '__AIM_SHELL_' '" + nonce + "__'\r";
  let term,
    phase = 'prompt',
    tail = '',
    probeSent = false,
    handoff,
    closed = false,
    challenge = null,
    serial = 0,
    relay,
    exitEvent;
  const exits = new Set();
  function send(message) {
    const frame = JSON.stringify(message) + '\n';
    if (closed || Buffer.byteLength(frame) > 65536) throw fault('ssh_channel_unavailable');
    term.write(frame);
  }
  function terminate(code) {
    if (closed) return;
    closed = true;
    const error = fault(code);
    handoff?.reject(error);
    relay?.start?.reject(error);
    challenge?.reject(error);
    challenge = null;
    for (const channel of [...channels.values()]) channel.end({ exitCode: null, signal: null }, error);
    if (!exitEvent) try { term?.kill(); } catch {}
    if (code !== 'ssh_connection_changed') onLost(code);
  }
  function relayExited() {
    const error = fault('ssh_remote_terminal_unavailable');
    relay.start?.reject(error);
    relay = null;
    phase = 'authenticated';
    challenge?.reject(fault('ssh_control_timeout'));
    challenge = null;
    for (const channel of channels.values()) channel.end({exitCode:null,signal:null}, error);
  }
  function receiveRelay(data) {
    const active = relay;
    let buffer = unstyle(active.tail + data);
    for (;;) {
      const start = buffer.indexOf(active.prefix);
      const exit = buffer.indexOf(active.exitMarker);
      if (exit >= 0 && (start < 0 || exit < start)) return relayExited();
      if (start < 0) {
        active.tail = buffer.slice(-active.exitMarker.length);
        return;
      }
      const payload = start + active.prefix.length;
      const end = buffer.indexOf(frameEnd, payload);
      if (end < 0) {
        if (buffer.length - start > 4096) throw fault('ssh_control_output_limit');
        active.tail = buffer.slice(start);
        return;
      }
      if (end - payload > 512) throw fault('ssh_control_output_limit');
      const [number, ...message] = JSON.parse(buffer.slice(payload, end).replace(/[\r\n]/g, ''));
      buffer = buffer.slice(end + frameEnd.length);
      if (!Number.isSafeInteger(number) || number < 1) throw fault('ssh_control_unavailable');
      // Screen repaint may repeat a frame. A gap leaves its output unconfirmed.
      if (number <= active.sequence) continue;
      if (number !== active.sequence + 1) throw fault('ssh_control_unavailable');
      active.sequence = number;
      if (phase === 'starting') {
        if (message.length !== 2 || message[0] !== 'ready' || message[1] !== active.nonce) throw fault('ssh_control_unavailable');
        phase = 'ready';
        active.start.resolve();
        active.start = null;
      } else dispatch(message);
    }
  }
  function receive(data) {
    if (closed) return;
    if (phase === 'prompt') {
      onPrivate(data);
      tail = (tail + data).slice(-8192);
      if (probeSent && unstyle(tail).replace(/[\r\n]/g, '').includes(proof)) {
        // The human may need to select a node after MFA on this same stream.
        // Only a human handoff request sends the proof to that remote shell.
        phase = 'authenticated';
        tail = '';
        handoff?.resolve(true);
        handoff = null;
      }
      return;
    }
    if (relay) receiveRelay(data);
  }
  async function confirmHandoff() {
    if (closed || exitEvent) return false;
    if (phase !== 'prompt') return true;
    if (handoff) return handoff.promise;
    const attempt = pending(5000, 'ssh_authentication_unconfirmed', () => {
      if (handoff === attempt) handoff = null;
    });
    handoff = attempt;
    probeSent = true;
    try { term.write(probe); }
    catch (error) {handoff = null;attempt.reject(error);}
    try { return await attempt.promise; }
    catch (error) {if(error.code==='ssh_authentication_unconfirmed')return false;throw error;}
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
    else if (type === 'error' && value === 'ssh_channel_refused')
      ch.end({exitCode:null,signal:null}, fault(value));
    else throw fault('ssh_channel_unavailable');
  }
  async function ensureRelay() {
    if (closed || phase === 'prompt') throw fault('ssh_authentication_unconfirmed');
    if (phase === 'ready') return;
    if (relay) return relay.start.promise;
    const relayNonce = randomBytes(24).toString('hex');
    const launch = pending(15000, 'ssh_remote_terminal_unavailable');
    relay = {nonce:relayNonce, prefix:'__AIM_RELAY_' + relayNonce + '__:',
      exitMarker:'__AIM_RELAY_EXIT_' + relayNonce + '__', sequence:0, tail:'', start:launch};
    phase = 'starting';
    const launchRelay = '/bin/sh -c ' + shellQuote(bootstrap + ' ' + relayNonce) +
      "; printf '\\n%s%s\\n' '__AIM_RELAY_EXIT_' " + shellQuote(relayNonce + '__') + '\r';
    try {
      // The human login terminal is already handed off. Keep each framed
      // receipt on one line regardless of the size of the retired viewport.
      term.resize(relayColumns, 30);
      term.write(launchRelay);
    } catch (error) {
      relay = null;
      phase = 'authenticated';
      launch.reject(error);
    }
    return launch.promise;
  }
  async function openChannel(command, {pty = true, check = () => {}} = {}) {
    check();
    await ensureRelay();
    check();
    if (phase !== 'ready' || closed) throw fault('ssh_channel_unavailable');
    if (channels.size >= 16) throw fault('ssh_channel_refused');
    const id = ++serial,
      opened = pending(10000, 'ssh_channel_unavailable', () => {
        if (channels.get(id) !== channel) return;
        try { handle.kill(); } catch {}
        channel.end({exitCode:null,signal:null});
      });
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
      send(pty ? ['open', id, 100, 30, command ?? null] : ['exec', id, command]);
    } catch (e) {
      channel.end({ exitCode: null, signal: null }, e);
    }
    return opened.promise;
  }
  try {
    assertCurrent();
    // OpenSSH needs both console handles to report the viewport to the gateway.
    term = pty.spawn(plan.file, plan.args, {
      name: terminalType,
      cols: 100,
      rows: 30,
      cwd: plan.cwd,
      env: {...plan.env, TERM: terminalType},
      useConptyDll: true
    });
    term.onData((data) => {
      try { receive(data); }
      catch (error) { terminate(error instanceof TerminalFault ? error.code : 'ssh_control_unavailable'); }
    });
    term.onExit((event) => {
      exitEvent = event;
      drainOwnedConpty(term);
      const error = phase === 'starting' ? 'ssh_remote_terminal_unavailable' : 'ssh_master_unavailable';
      terminate(error);
      for (const cb of exits) cb(event);
      exits.clear();
    });
  } catch (error) {
    const code = error.code === 'ssh_connection_changed' ? error.code : 'ssh_client_unavailable';
    terminate(code);
    throw fault(code);
  }
  return {
    openChannel,confirmHandoff,
    transportClosed: () => !!exitEvent,
    ready: () => ({ ready: phase !== 'prompt' && !closed && !exitEvent }),
    async check() {
      if (closed || phase === 'prompt' || exitEvent) throw fault('ssh_authentication_unconfirmed');
      if (phase !== 'ready') return;
      if (!challenge) {
        // A missing pong proves nothing about the original process. Ignore late
        // replies by challenge ID and require a fresh proof for the next action.
        challenge = pending(5000, 'ssh_control_timeout', () => { challenge = null; });
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
      term.write(data);
    },
    resize: (cols, rows) => { if (!closed && phase === 'prompt') term.resize(cols, rows); },
    kill: () => terminate('ssh_connection_changed'),
    onExit: (fn) => {
      if (exitEvent) fn(exitEvent);
      else exits.add(fn);
    }
  };
}
