from studio_worker.infrastructure.paths import WORKER_ROOT
"""Ephemeral, desktop-owned SSH authentication. Never stores private TTY bytes."""
import base64
import copy
from collections import deque
import hashlib
import ipaddress
import json
import os
import re
import secrets
import select
import selectors
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from studio_worker.compute.ssh_auth_pty import process_identity

PRIVATE_LIMIT = 65536
AUTH_SECONDS = 300
IDLE_SECONDS = 90
LEASE_SECONDS = 1800
SCOPE_FIELDS = ('id', 'version', 'host', 'username', 'target', 'port', 'ssh_client',
                'identity_file', 'proxy_jump', 'via', 'auth_mode')


class AuthError(ConnectionError):
    """Only fixed codes may escape the private controller."""


class RemoteOperationError(ConnectionError):
    """A command failure does not erase an otherwise live authentication lease."""


def fail(code):
    raise AuthError(code) from None


def scope(profile):
    return hashlib.sha256(json.dumps({k: profile.get(k) for k in SCOPE_FIELDS},
                                    sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def typed(value, keys, required=()):
    if not isinstance(value, dict) or set(value) - set(keys) or not set(required) <= set(value):
        fail('invalid_auth_request')


def bounded_run(argv, input=None, timeout=8, limit=131072):
    """Bound output while reading, including hostile banner/stderr output."""
    process = subprocess.Popen(argv, stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    selector, output, errors = selectors.DefaultSelector(), bytearray(), bytearray()
    content = memoryview(input or b'')
    try:
        for stream, kind in ((process.stdout, 'out'), (process.stderr, 'err')):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, kind)
        if process.stdin:
            os.set_blocking(process.stdin.fileno(), False)
            if content:
                selector.register(process.stdin, selectors.EVENT_WRITE, 'in')
            else:
                process.stdin.close()
        until = time.monotonic() + timeout
        while selector.get_map():
            if time.monotonic() >= until:
                fail('ssh_operation_timeout')
            for key, _event in selector.select(min(.1, max(0, until-time.monotonic()))):
                if key.data == 'in':
                    try:
                        count = os.write(key.fd, content[:65536])
                        content = content[count:]
                    except BrokenPipeError:
                        content = memoryview(b'')
                    if not content:
                        selector.unregister(key.fileobj)
                        key.fileobj.close()
                else:
                    block = os.read(key.fd, 16384)
                    if not block:
                        selector.unregister(key.fileobj)
                    else:
                        (output if key.data == 'out' else errors).extend(block)
                        if len(output) + len(errors) > limit:
                            fail('ssh_output_limit')
        result = process.wait(timeout=max(.01, until-time.monotonic()))
        return subprocess.CompletedProcess([], result, bytes(output), bytes(errors))
    except Exception:
        if process.poll() is None:
            process.kill()
        process.wait()
        fail('ssh_operation_failed')
    finally:
        selector.close()
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream and not stream.closed:
                stream.close()


def client_identity(client):
    candidate = Path(client).resolve()
    data = candidate.stat()
    return [str(candidate), data.st_dev, data.st_ino, data.st_size, data.st_mtime_ns]


def reviewed_jumps(p):
    jumps = p.get('proxy_jump', [])
    if not isinstance(jumps, list) or len(jumps) > 8:
        fail('interactive_jump_identity_required')
    for jump in jumps:
        if not isinstance(jump, str):
            fail('interactive_jump_identity_required')
        match = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_.-]{0,63})@(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9][A-Za-z0-9.-]{0,255}):([0-9]{1,5})', jump)
        if not match or not 1 <= int(match[3]) <= 65535:
            fail('interactive_jump_identity_required')
        if match[2].startswith('['):
            try:
                ipaddress.IPv6Address(match[2][1:-1])
            except ValueError:
                fail('interactive_jump_identity_required')
    return jumps


def master_args(p, socket):
    # Fixed options precede user config; no shell, daemonization or remote shell.
    args = [p['ssh_client'], '-F', '/dev/null', '-M', '-N', '-S', socket,
            '-o', 'ControlMaster=yes', '-o', 'ControlPersist=no',
            '-o', 'ForkAfterAuthentication=no', '-o', 'StrictHostKeyChecking=ask',
            '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes',
            '-o', 'PermitLocalCommand=no', '-o', 'RemoteCommand=none', '-o', 'SessionType=none',
            '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
            '-o', 'ConnectTimeout=15']
    jumps = reviewed_jumps(p)
    if jumps:
        args += ['-J', ','.join(jumps)]
    if p.get('identity_file'):
        args += ['-i', p['identity_file']]
    return args + ['-l', p['username'], '-p', str(p['port']), p['host']]


def slave_args(p, socket, control=None):
    # FIRST false proxy + no client config prevents missing-master network fallback.
    args = [p['ssh_client'], '-o', 'ProxyCommand=/bin/false', '-F', '/dev/null',
            '-o', 'ControlMaster=no', '-o', 'ControlPersist=no', '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-S', socket]
    if control:
        args += ['-O', control]
    return args + ['-l', p['username'], '-p', str(p['port']), p['host']]


def describe(p, run=bounded_run):
    if os.name != 'posix' or p.get('via'):
        fail('interactive_client_unsupported' if not p.get('via') else 'interactive_legacy_via_unsupported')
    client = p.get('ssh_client', '')
    key = p.get('identity_file', '')
    if (not client.startswith('/') or client.lower().endswith('.exe') or client.startswith('/mnt/') or
            not os.path.isfile(client) or not os.access(client, os.X_OK) or
            key and (not key.startswith('/') or key.startswith('/mnt/') or '\\' in key)):
        fail('linux_client_and_key_namespace_required')
    try:
        import pty  # availability is a capability, not a claim of SSH/MFA success
        _ = pty.openpty
        args = master_args(p, '/__studio_capability_socket__')
        result = run([args[0], '-G', *args[1:]], timeout=5, limit=131072)
        if result.returncode:
            fail('interactive_client_options_unsupported')
        values = {}
        for line in result.stdout.decode('utf8', 'replace').splitlines():
            key, _sep, value = line.partition(' ')
            values.setdefault(key, []).append(value)
        expected = {'controlmaster': ('true', 'yes'), 'controlpersist': ('no', '0'),
                    'forkafterauthentication': ('no', 'false'), 'stricthostkeychecking': ('ask',),
                    'forwardagent': ('no', 'false'), 'clearallforwardings': ('yes', 'true'),
                    'permitlocalcommand': ('no', 'false'), 'sessiontype': ('none',),
                    'controlpath': ('/__studio_capability_socket__',)}
        if any(values.get(k, [''])[0] not in allowed for k, allowed in expected.items()):
            fail('interactive_client_options_unsupported')
        # OpenSSH 8.9 omits RemoteCommand=none from -G. Only this known omission
        # is accepted; an explicit command or any missing mandatory control fails.
        if values.get('remotecommand', ['none']) != ['none']:
            fail('interactive_client_options_unsupported')
        if values.get('proxycommand', ['none'])[0] != 'none':
            fail('interactive_config_proxy_unsupported')
        if values.get('hostname') != [p['host']] or values.get('user') != [p['username']] or values.get('port') != [str(p['port'])]:
            fail('interactive_client_options_unsupported')
        if values.get('proxyjump', ['none']) != [','.join(reviewed_jumps(p)) or 'none']:
            fail('interactive_client_options_unsupported')
        effective = {k: values.get(k) for k in ('hostname', 'user', 'port', 'proxyjump', 'identityfile',
                                                'userknownhostsfile', 'globalknownhostsfile', *expected)}
        return {'digest': hashlib.sha256(json.dumps(effective, sort_keys=True).encode()).hexdigest(),
                'clientIdentity': client_identity(client), 'proxyJump': values.get('proxyjump', ['none'])[0]}
    except AuthError:
        raise
    except Exception:
        fail('interactive_client_unavailable')


def private_control_root():
    """A private Linux-native directory, never worker input or DrvFS."""
    home = Path.home()
    choices = [Path(os.environ.get('XDG_RUNTIME_DIR', '/nonexistent')), home / '.cache', home]
    for parent in choices:
        try:
            parent = parent.resolve(strict=True)
            st = parent.stat()
            if st.st_uid != os.getuid() or not parent.is_dir() or st.st_mode & 0o022:
                continue
            mounts = []
            for line in Path('/proc/self/mountinfo').read_text().splitlines():
                left, right = line.split(' - ', 1)
                mount = left.split()[4].replace('\\040', ' ')
                if str(parent) == mount or str(parent).startswith(mount.rstrip('/') + '/'):
                    mounts.append((len(mount), right.split()[0]))
            if not mounts or max(mounts)[1] not in ('ext2', 'ext3', 'ext4', 'tmpfs', 'btrfs', 'xfs', 'overlay'):
                continue
            folder = Path(tempfile.mkdtemp(prefix='gss-auth-', dir=parent))
            folder.chmod(0o700)
            if len(str(folder / 's')) > 100:
                folder.rmdir()
                continue
            return folder
        except (OSError, ValueError):
            continue
    fail('private_linux_control_root_unavailable')


class SSHAuth:
    def __init__(self, service, describe_client=describe, run=bounded_run, root_factory=private_control_root,
                 spawn=subprocess.Popen, clock=time.monotonic, supervise=True):
        self.service, self.describe_client, self.run, self.root_factory = service, describe_client, run, root_factory
        self.spawn, self.clock = spawn, clock
        self.sessions, self.lock, self.stopped = {}, threading.RLock(), threading.Event()
        self.worker_identity = secrets.token_hex(24)
        if supervise:
            self.supervisor = threading.Thread(target=self._supervise, daemon=True)
            self.supervisor.start()

    def _profile(self, identifier):
        try:
            return self.service.store.get('cluster', identifier)
        except Exception:
            fail('saved_connection_unavailable')

    def _source(self, source):
        """One main-owned source resolution for every session lifecycle check."""
        if source['kind'] == 'original-run':
            try:
                return self.service.clusters.original_auth_source(source['runId'])
            except PermissionError:
                fail('original_run_policy_blocked')
            except Exception:
                fail('original_run_unavailable')
        p = self._profile(source['clusterId'])
        if not isinstance(p, dict) or p.get('version') != source['version'] or p.get('auth_mode', 'key') != 'interactive':
            fail('saved_connection_changed')
        return {'profile': p, 'sourceReceipt': None,
                'origin': {'kind': 'saved-profile', 'clusterId': p['id'], 'version': p['version']}}

    def _source_current(self, s):
        # Existing retained saved-profile leases remain version-scoped for old
        # jobs. Original-run contexts additionally retain their run/policy proof.
        if s['source']['kind'] == 'saved-profile' and s['retained']:
            return True
        try:
            observed = self._source(s['source'])
            if scope(observed['profile']) == s['scope'] and observed['sourceReceipt'] == s['sourceReceipt']:
                return True
            reason = 'original_run_changed' if s['source']['kind'] == 'original-run' else 'saved_connection_changed'
        except AuthError as error:
            reason = str(error)
        except Exception:
            reason = 'original_run_unavailable' if s['source']['kind'] == 'original-run' else 'saved_connection_changed'
        self._close(s, reason)
        return False

    def _private_view(self, s):
        p = s['profile']
        return {**self.public(s), 'review': {k: p.get(k) for k in
                ('name', 'host', 'username', 'port', 'identity_file', 'ssh_client', 'proxy_jump')},
                'clientRoute': s['capability'].get('proxyJump', 'none') if s['capability'] else 'legacy-key-route'}

    def plan(self, data):
        if isinstance(data, dict) and 'run_id' in data:
            typed(data, ('run_id', 'owner'), ('run_id', 'owner'))
            if not isinstance(data['run_id'], str) or not 1 <= len(data['run_id']) <= 200:
                fail('invalid_auth_request')
            source = {'kind': 'original-run', 'runId': data['run_id']}
        else:
            typed(data, ('cluster_id', 'version', 'owner'), ('cluster_id', 'version', 'owner'))
            if type(data['version']) is not int or data['version'] < 1 or not isinstance(data['cluster_id'], str):
                fail('invalid_auth_request')
            source = {'kind': 'saved-profile', 'clusterId': data['cluster_id'], 'version': data['version']}
        if not isinstance(data['owner'], str) or not re.fullmatch(r'[a-f0-9]{48}', data['owner']):
            fail('invalid_auth_owner')
        observed = self._source(source)
        p = observed['profile']
        mode = p.get('auth_mode', 'key')
        if mode == 'interactive':
            reviewed_jumps(p)  # old/raw records are checked before client execution
            capability = self.describe_client(p)
        else:
            capability = None  # historical key/agent/via route is not converted to mux
        with self.lock:
            self._expire()
            # A profile/run/policy change during the capability read cannot
            # publish a plan for a different source.
            fresh = self._source(source)
            if scope(fresh['profile']) != scope(p) or fresh['sourceReceipt'] != observed['sourceReceipt']:
                fail('original_run_changed' if source['kind'] == 'original-run' else 'saved_connection_changed')
            # Reopening a private pane may claim this exact retained connection.
            # No new master, source substitution, permission or lifetime extension.
            for previous in reversed(list(self.sessions.values())):
                if previous['scope'] == scope(p) and previous['state'] == 'verified' and previous['retained'] and self._source_current(previous) and self._live(previous):
                    previous['owner'] = data['owner']
                    previous.update(source=copy.deepcopy(source), sourceReceipt=copy.deepcopy(observed['sourceReceipt']),
                                    origin=copy.deepcopy(observed['origin']), newForwardAllowed=source['kind'] != 'original-run')
                    return self._private_view(previous)
            if len([s for s in self.sessions.values() if s['state'] not in ('closed', 'needs_human_auth')]) >= 4:
                fail('auth_session_limit')
            identifier = secrets.token_hex(16)
            s = {'id': identifier, 'owner': data['owner'], 'profile': copy.deepcopy(p), 'scope': scope(p),
                 'worker': self.worker_identity, 'capability': capability, 'state': 'review',
                 'created': self.clock(), 'activity': self.clock(), 'output': bytearray(), 'offset': 0,
                 'inputSeq': 0, 'directory': None, 'helper': None, 'masterIdentity': None,
                 'retained': False, 'verifiedAt': None, 'reason': None,
                 'wire': deque(), 'wireBytes': 0, 'wireStop': threading.Event(), 'wireEvent': threading.Event(),
                 'source': copy.deepcopy(source), 'sourceReceipt': copy.deepcopy(observed['sourceReceipt']),
                 'origin': copy.deepcopy(observed['origin']), 'authMode': mode,
                 'newForwardAllowed': source['kind'] != 'original-run', 'keyCheckStatus': 'not_run'}
            self.sessions[identifier] = s
            for key, old in list(self.sessions.items()):
                if len(self.sessions) > 16 and old['state'] in ('closed', 'needs_human_auth'):
                    self.sessions.pop(key)
            return self._private_view(s)

    def _get(self, data, extra=()):
        typed(data, ('session_id', 'owner', *extra), ('session_id', 'owner'))
        s = self.sessions.get(data['session_id'])
        if not s or s['owner'] != data['owner'] or s['worker'] != self.worker_identity:
            fail('auth_session_unavailable')
        self._source_current(s)
        self._expire()
        return s

    def public(self, s):
        return {'sessionId': s['id'], 'clusterId': s['profile']['id'], 'version': s['profile']['version'],
                'name': s['profile'].get('name', 'SSH connection'), 'status': s['state'], 'reason': s['reason'],
                'authenticated': s['state'] == 'verified' and s['authMode'] == 'interactive', 'observedAt': s['verifiedAt'],
                'leaseSeconds': LEASE_SECONDS, 'scientificValidation': 'not_run', 'origin': copy.deepcopy(s['origin']),
                'authMode': s['authMode'], 'newForwardAllowed': s['newForwardAllowed'],
                **({'sourceReceipt': copy.deepcopy(s['sourceReceipt'])} if s['sourceReceipt'] is not None else {}),
                **({'keyCheckStatus': s['keyCheckStatus']} if s['authMode'] == 'key' else {})}

    def start(self, data):
        key_profile = None
        with self.lock:
            s = self._get(data, ('request_id',))
            request = data.get('request_id')
            if not isinstance(request, str) or not re.fullmatch(r'[A-Za-z0-9-]{1,100}', request):
                fail('invalid_auth_request')
            if s.get('request') == request:
                return self.public(s)
            if s['state'] != 'review':
                fail('auth_attempt_already_started')
            if s['authMode'] == 'key':
                s.update(request=request, state='checking_key', keyCheckStatus='checking', activity=self.clock())
                key_profile = copy.deepcopy(s['profile'])
            else:
                if self.describe_client(s['profile']) != s['capability']:
                    self._close(s, 'client_or_config_changed')
                    return self.public(s)
                if not self._source_current(s):
                    return self.public(s)
                s['request'] = request
                folder = self.root_factory()
                st = folder.lstat()
                if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o700:
                    fail('private_linux_control_root_unavailable')
                s.update(directory=folder, directoryIdentity=(st.st_dev, st.st_ino), socket=str(folder / 's'),
                         state='awaiting_auth', activity=self.clock(), started=self.clock())
                try:
                    child = self.spawn([sys.executable, '-m', 'studio_worker.ssh_auth_pty'], stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True, bufsize=0)
                    s['helper'], s['helperIdentity'] = child, process_identity(child.pid)
                    self._queue(s, {'argv': master_args(s['profile'], s['socket'])}, startup=True)
                    self._start_writer(s)
                    threading.Thread(target=self._pump, args=(s,), daemon=True).start()
                except Exception:
                    self._close(s, 'auth_process_unavailable')
                return self.public(s)
        # Existing legacy SSH may wait for its bounded timeout. It must never
        # hold the lifecycle lock or prevent cancellation/supervision.
        passed = False
        try:
            result = self.service.clusters.original_key_check(key_profile)
            passed = isinstance(result, dict) and result.get('status') == 'passed'
        except Exception:
            pass
        with self.lock:
            self._expire()
            if s['state'] != 'checking_key' or not self._source_current(s):
                return self.public(s)
            if passed:
                s.update(state='key_verified', keyCheckStatus='passed', verifiedAt=time.time(), reason=None)
            else:
                s['keyCheckStatus'] = 'failed'
                self._close(s, 'key_check_failed')
            return self.public(s)

    def _pump(self, s):
        child = s['helper']
        try:
            while True:
                line = child.stdout.readline(32769)
                if not line:
                    break
                if len(line) > 32768:
                    fail('private_output_limit')
                item = json.loads(line)
                with self.lock:
                    if s['state'] in ('closed', 'needs_human_auth'):
                        return
                    if item.get('type') == 'started':
                        ident = item.get('identity')
                        if not isinstance(ident, list) or len(ident) != 2 or process_identity(ident[0]) != ident:
                            fail('auth_process_identity_unavailable')
                        s['masterIdentity'] = ident
                    elif item.get('type') == 'output':
                        value = base64.b64decode(item['base64'], validate=True)
                        if len(value) > 12288:
                            fail('private_output_limit')
                        if s['retained']:
                            continue
                        s['output'].extend(value)
                        if len(s['output']) > PRIVATE_LIMIT:
                            removed = len(s['output']) - PRIVATE_LIMIT
                            del s['output'][:removed]
                            s['offset'] += removed
                    else:
                        fail('invalid_private_stream')
        except Exception:
            pass
        finally:
            with self.lock:
                self._close(s, 'auth_process_exited')
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                if process_identity(child.pid) == s.get('helperIdentity'):
                    child.kill()
                    child.wait(timeout=2)
            finally:
                for stream in (child.stdin, child.stdout):
                    if stream and not stream.closed:
                        stream.close()
                self._remove_control(s)

    def _live(self, s):
        try:
            helper, master = s['helper'], s['masterIdentity']
            if not helper or helper.poll() is not None or process_identity(helper.pid) != s['helperIdentity'] or not master or process_identity(master[0]) != master:
                return False
            folder = s['directory'].lstat()
            if ((folder.st_dev, folder.st_ino) != s['directoryIdentity'] or not stat.S_ISDIR(folder.st_mode) or
                    folder.st_uid != os.getuid() or stat.S_IMODE(folder.st_mode) != 0o700):
                return False
            if client_identity(s['profile']['ssh_client']) != s['capability']['clientIdentity']:
                return False
            socket = os.lstat(s['socket'])
            if not stat.S_ISSOCK(socket.st_mode) or socket.st_uid != os.getuid():
                return False
            identity = (socket.st_dev, socket.st_ino)
            if s.get('socketIdentity') not in (None, identity):
                return False
            s['socketIdentity'] = identity
            return True
        except (OSError, KeyError, TypeError):
            return False

    def _verify(self, s):
        if s['state'] not in ('awaiting_auth', 'verified'):
            return False
        if not self._source_current(s):
            return False
        if not self._live(s):
            # Before authentication a socket may not yet exist; never infer failure from a prompt.
            if s['state'] == 'verified':
                self._close(s, 'master_lost')
            return False
        try:
            check = self.run(slave_args(s['profile'], s['socket'], 'check'), timeout=2, limit=8192)
            master_pids = re.findall(rb'Master running \(pid=([0-9]+)\)(?:\r?\n|$)', check.stderr + check.stdout)
            if check.returncode or master_pids != [str(s['masterIdentity'][0]).encode()]:
                fail('master_check_failed')
            nonce = secrets.token_hex(24)
            # Fixed read-only command; never activation scripts or user-supplied commands.
            command = "printf '%s\\n' '" + nonce + "'; id -un"
            result = self.run(slave_args(s['profile'], s['socket']) + [command], timeout=5, limit=8192)
            if result.returncode or result.stdout.decode('utf8', 'replace').splitlines() != [nonce, s['profile']['username']] or not self._live(s):
                fail('nonce_verification_failed')
            if not self._source_current(s):
                return False
            if s['verifiedAt'] is None:
                s.update(verifiedAt=time.time(), verifiedClock=self.clock())
            s.update(state='verified', reason=None)
            return True
        except Exception:
            self._close(s, 'needs_human_auth')
            return False

    def read(self, data):
        with self.lock:
            s = self._get(data, ('cursor',))
            cursor = data.get('cursor', 0)
            if type(cursor) is not int or cursor < 0:
                fail('invalid_private_cursor')
            s['activity'] = self.clock()
            if s['state'] == 'awaiting_auth':
                self._verify(s)
            elif s['state'] == 'verified' and not self._live(s):
                self._close(s, 'master_lost')
            start = max(cursor, s['offset'])
            block = bytes(s['output'][start-s['offset']:start-s['offset']+12288])
            return {**self.public(s), 'privateOutput': base64.b64encode(block).decode('ascii'),
                    'cursor': start+len(block), 'dropped': cursor < s['offset']}

    def input(self, data):
        with self.lock:
            s = self._get(data, ('data', 'sequence'))
            value, sequence = data.get('data'), data.get('sequence')
            if not isinstance(value, str) or len(value.encode()) > 4096 or type(sequence) is not int:
                fail('invalid_private_input')
            if s['state'] != 'awaiting_auth' or sequence != s['inputSeq']+1:
                fail('private_input_out_of_scope')
            s['inputSeq'], s['activity'] = sequence, self.clock()
            self._send(s, {'type': 'input', 'data': value})
            return {'accepted': True}

    def resize(self, data):
        with self.lock:
            s = self._get(data, ('rows', 'cols'))
            rows, cols = data.get('rows'), data.get('cols')
            if type(rows) is not int or type(cols) is not int or not 2 <= rows <= 300 or not 10 <= cols <= 500:
                fail('invalid_private_dimensions')
            if s['state'] != 'awaiting_auth':
                fail('private_input_out_of_scope')
            self._send(s, {'type': 'resize', 'rows': rows, 'cols': cols})
            return {'accepted': True}

    def _queue(self, s, value, startup=False):
        packet = (json.dumps(value, ensure_ascii=False)+'\n').encode()
        if (len(packet) > (131072 if startup else 8192) or len(s['wire']) >= 8 or
                s['wireBytes'] + len(packet) > (131072 if startup else 65536)):
            fail('private_input_backpressure')
        s['wire'].append(packet)
        s['wireBytes'] += len(packet)
        s['wireEvent'].set()

    def _send(self, s, value):
        self._queue(s, value)

    def _start_writer(self, s):
        # The writer owns a duplicate descriptor until its finally block. Closing
        # the Popen stream cannot make a stale fd number target another process.
        descriptor = os.dup(s['helper'].stdin.fileno())
        os.set_blocking(descriptor, False)
        thread = threading.Thread(target=self._write_private, args=(s, descriptor), daemon=True)
        s['writerThread'] = thread
        thread.start()

    def _write_private(self, s, descriptor):
        packet = None
        try:
            while not s['wireStop'].is_set():
                with self.lock:
                    if s['state'] in ('closed', 'needs_human_auth'):
                        break
                    packet = s['wire'][0] if s['wire'] else None
                if packet is None:
                    s['wireEvent'].wait(.1)
                    s['wireEvent'].clear()
                    continue
                offset = 0
                while offset < len(packet) and not s['wireStop'].is_set():
                    try:
                        written = os.write(descriptor, packet[offset:])
                        if not written:
                            raise BrokenPipeError()
                        offset += written
                    except BlockingIOError:
                        select.select([], [descriptor], [], .1)
                with self.lock:
                    if s['wire'] and s['wire'][0] is packet and offset == len(packet):
                        s['wire'].popleft()
                        s['wireBytes'] -= len(packet)
                packet = None
        except Exception:
            with self.lock:
                self._close(s, 'auth_process_exited')
        finally:
            packet = None
            os.close(descriptor)

    def finish(self, data):
        with self.lock:
            s = self._get(data, ('retain',))
            if type(data.get('retain')) is not bool:
                fail('invalid_auth_request')
            if s['authMode'] == 'key':
                self._close(s)
                return self.public(s)
            if data['retain']:
                if s['state'] != 'verified' or not self._verify(s):
                    fail('needs_human_auth')
                s['retained'] = True
                s['offset'] += len(s['output'])
                s['output'].clear()
                s['wireStop'].set()
                s['wireEvent'].set()
                s['wire'].clear()
                s['wireBytes'] = 0
            else:
                self._close(s)
            return self.public(s)

    def resolve(self, p, include_private=False):
        with self.lock:
            self._expire()
            for s in reversed(list(self.sessions.values())):
                if s['worker'] == self.worker_identity and s['scope'] == scope(p) and (s['retained'] or include_private) and s['state'] == 'verified':
                    if self._source_current(s) and self._live(s):
                        return s
                    self._close(s, 'master_lost')
            fail('needs_human_auth')

    def execute(self, p, script, data=None, timeout=40):
        # Existing Clusters policy and immutable-snapshot checks precede transport calls.
        s = self.resolve(p)
        try:
            result = self.run(slave_args(p, s['socket']) + [script], input=data, timeout=timeout, limit=4*1024*1024)
        except Exception:
            with self.lock:
                if s['state'] != 'verified' or not self._source_current(s) or not self._live(s):
                    self._close(s, 'needs_human_auth')
                    fail('needs_human_auth')
            raise RemoteOperationError('remote_operation_unconfirmed') from None
        with self.lock:
            if s['state'] != 'verified' or not self._source_current(s) or not self._live(s):
                self._close(s, 'needs_human_auth')
                fail('needs_human_auth')
            if result.returncode:
                raise RemoteOperationError('remote_transport_unconfirmed' if result.returncode == 255 else 'remote_operation_failed') from None
        return result.stdout.decode('utf8', 'replace')

    def _expire(self):
        now = self.clock()
        for s in list(self.sessions.values()):
            if s['state'] in ('closed', 'needs_human_auth'):
                continue
            if (s['state'] == 'verified' and now-s['verifiedClock'] > LEASE_SECONDS or
                    s['state'] != 'verified' and (now-s['created'] > AUTH_SECONDS or now-s['activity'] > IDLE_SECONDS)):
                self._close(s, 'auth_expired')

    def _close(self, s, reason=None):
        if s['state'] in ('closed', 'needs_human_auth'):
            return
        s.update(state='needs_human_auth' if reason else 'closed', reason=reason)
        s['output'].clear()
        s['wireStop'].set()
        s['wireEvent'].set()
        s['wire'].clear()
        s['wireBytes'] = 0
        helper = s.get('helper')
        if helper:
            try:
                helper.stdin.close()  # helper owns PTY child cleanup; no arbitrary PID signaling
                if helper.poll() is None and process_identity(helper.pid) == s.get('helperIdentity'):
                    helper.terminate()
            except (OSError, ValueError):
                pass
        master = s.get('masterIdentity')
        if master and process_identity(master[0]) == master:
            try:
                os.killpg(master[0], signal.SIGHUP)
            except OSError:
                pass
        self._remove_control(s)

    def _remove_control(self, s):
        folder = s.get('directory')
        if folder:
            try:
                st = folder.lstat()
                if (st.st_dev, st.st_ino) == s.get('directoryIdentity') and st.st_uid == os.getuid() and stat.S_ISDIR(st.st_mode):
                    socket = folder / 's'
                    if socket.exists():
                        socket_stat = socket.lstat()
                        if stat.S_ISSOCK(socket_stat.st_mode) and (socket_stat.st_dev, socket_stat.st_ino) == s.get('socketIdentity'):
                            socket.unlink()
                    folder.rmdir()  # no recursive removal or foreign entries
            except OSError:
                pass

    def _supervise_once(self):
        with self.lock:
            self._expire()
            for s in list(self.sessions.values()):
                if s['state'] not in ('closed', 'needs_human_auth'):
                    if not self._source_current(s):
                        continue
                    if s['state'] == 'verified' and not self._live(s):
                        self._close(s, 'master_lost')

    def _supervise(self):
        while not self.stopped.wait(1):
            self._supervise_once()

    def close(self):
        self.stopped.set()
        with self.lock:
            for s in list(self.sessions.values()):
                self._close(s)
        if hasattr(self, 'supervisor'):
            self.supervisor.join(2)
        for s in list(self.sessions.values()):
            thread = s.get('writerThread')
            if thread and thread is not threading.current_thread():
                thread.join(.5)
