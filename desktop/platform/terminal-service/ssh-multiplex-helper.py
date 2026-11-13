"""Local-only OpenSSH control-socket proof. Never reads authentication TTY bytes."""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import tempfile
import time


class Refused(Exception):
    pass


def fail(code):
    raise Refused(code)


def run(argv, timeout=5, limit=32768):
    process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    selector, values = selectors.DefaultSelector(), [bytearray(), bytearray()]
    deadline = time.monotonic() + timeout
    try:
        for index, stream in enumerate((process.stdout, process.stderr)):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, index)
        while selector.get_map():
            if time.monotonic() >= deadline:
                fail('ssh_control_timeout')
            for key, _ in selector.select(.05):
                data = os.read(key.fd, 4096)
                if not data:
                    selector.unregister(key.fileobj)
                else:
                    values[key.data].extend(data)
                    if sum(map(len, values)) > limit:
                        fail('ssh_control_output_limit')
        return process.wait(timeout=max(.01, deadline-time.monotonic())), bytes(values[0]), bytes(values[1])
    finally:
        selector.close()
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()
        process.stderr.close()


def client_identity(client):
    file = Path(client).resolve(strict=True)
    info = file.stat()
    if not stat.S_ISREG(info.st_mode) or not os.access(file, os.X_OK):
        fail('ssh_client_unavailable')
    return [str(file), str(info.st_dev), str(info.st_ino), str(info.st_size), str(info.st_mtime_ns)]


def args(profile, socket, master=False, control=None, tty=False):
    if master:
        result = [profile['ssh_client'], '-F', '/dev/null', '-M', '-N', '-S', socket,
                  '-o', 'ControlMaster=yes', '-o', 'ControlPersist=no', '-o', 'ForkAfterAuthentication=no',
                  '-o', 'SessionType=none', '-o', 'RemoteCommand=none', '-o', 'StrictHostKeyChecking=ask',
                  '-o', 'BatchMode=no', '-o', 'ConnectionAttempts=1', '-o', 'ConnectTimeout=15',
                  '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no',
                  '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2']
        if profile.get('proxy_jump'):
            result += ['-J', ','.join(profile['proxy_jump'])]
        if profile.get('identity_file'):
            result += ['-i', profile['identity_file']]
        if profile.get('known_hosts_file'):
            result += ['-o', 'UserKnownHostsFile='+profile['known_hosts_file'], '-o', 'GlobalKnownHostsFile=/dev/null']
    else:
        # This option MUST precede every other option: no missing-master network
        # fallback, config expansion, authentication prompt or host-key prompt.
        result = [profile['ssh_client'], '-o', 'ProxyCommand=/bin/false', '-F', '/dev/null',
                  '-o', 'ControlMaster=no', '-o', 'ControlPersist=no', '-o', 'BatchMode=yes',
                  '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes',
                  '-o', 'PermitLocalCommand=no', '-S', socket]
        if control:
            result += ['-O', control]
        elif tty:
            result += ['-tt']
        else:
            result += ['-T']
    return result + ['-l', profile['username'], '-p', str(profile['port']), profile['host']]


def profile_valid(profile):
    if not isinstance(profile, dict) or set(profile)-{'host', 'username', 'port', 'ssh_client', 'identity_file', 'proxy_jump', 'via', 'known_hosts_file'}:
        fail('ssh_invalid_profile')
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.:-]{0,254}', profile.get('host', '')) or not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}', profile.get('username', '')) or type(profile.get('port')) is not int or not 1 <= profile['port'] <= 65535:
        fail('ssh_invalid_profile')
    if profile.get('via'):
        fail('ssh_route_requires_review')
    jumps = profile.get('proxy_jump', [])
    if not isinstance(jumps, list) or len(jumps) > 8 or any(not isinstance(jump, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.-]{0,63}@(?:\[[0-9A-Fa-f:]+\]|[A-Za-z0-9][A-Za-z0-9.-]{0,255}):[0-9]{1,5}', jump) or not 1 <= int(jump.rsplit(':', 1)[1]) <= 65535 for jump in jumps):
        fail('ssh_route_requires_review')
    client, key = profile.get('ssh_client', ''), profile.get('identity_file', '')
    if not isinstance(client, str) or not isinstance(key, str):
        fail('ssh_invalid_profile')
    known = profile.get('known_hosts_file')
    if known is not None and (not isinstance(known, str) or not known.startswith('/') or any(c in known for c in '\x00\r\n')):
        fail('ssh_invalid_profile')
    if not client.startswith('/') or client.startswith('/mnt/') or client.lower().endswith('.exe') or '\\' in client or key and (not key.startswith('/') or key.startswith('/mnt/') or '\\' in key):
        fail('ssh_linux_client_namespace_required')
    if any('\x00' in value or '\n' in value or '\r' in value for value in (client, key)):
        fail('ssh_invalid_profile')


def describe(profile):
    profile_valid(profile)
    planned = args(profile, '/__studio_mux_capability__', master=True)
    code, output, _ = run([planned[0], '-G', *planned[1:]], limit=131072)
    if code:
        fail('ssh_multiplex_unsupported')
    values = {}
    for line in output.decode('utf8', 'replace').splitlines():
        key, _, value = line.partition(' ')
        values.setdefault(key, []).append(value)
    expected = {'controlmaster': {'true', 'yes'}, 'controlpersist': {'no', '0'}, 'forkafterauthentication': {'no', 'false'},
                'sessiontype': {'none'}, 'stricthostkeychecking': {'ask'}, 'forwardagent': {'no', 'false'},
                'clearallforwardings': {'yes', 'true'}, 'permitlocalcommand': {'no', 'false'},
                'controlpath': {'/__studio_mux_capability__'}, 'hostname': {profile['host']},
                'user': {profile['username']}, 'port': {str(profile['port'])}}
    if any(values.get(key, [''])[0] not in allowed for key, allowed in expected.items()) or values.get('remotecommand', ['none']) != ['none'] or values.get('proxycommand', ['none']) != ['none'] or values.get('proxyjump', ['none']) != [','.join(profile.get('proxy_jump', [])) or 'none']:
        fail('ssh_multiplex_unsupported')
    return {'clientIdentity': client_identity(profile['ssh_client']), 'targetDigest': hashlib.sha256(json.dumps(profile, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}


def process_identity(pid):
    folder = Path('/proc') / str(pid)
    info = folder.stat()
    fields = (folder/'stat').read_text().rsplit(')', 1)[1].split()
    if info.st_uid != os.getuid():
        fail('ssh_master_identity_changed')
    return {'pid': pid, 'start': fields[19], 'boot': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}


def private(proof):
    root = Path(proof['root'])
    info = root.lstat()
    if root.is_symlink() or root.parent != Path('/tmp') or not root.name.startswith('studio-ssh-mux-') or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700 or [str(info.st_dev), str(info.st_ino)] != proof['directoryIdentity'] or proof['socket'] != str(root/'master.sock'):
        fail('ssh_control_identity_changed')
    return root


def check(profile, proof, master):
    private(proof)
    if describe(profile) != {key: proof[key] for key in ('clientIdentity', 'targetDigest')} or process_identity(master['pid']) != master:
        fail('ssh_master_identity_changed')
    folder = Path('/proc')/str(master['pid'])
    if (folder/'cmdline').read_bytes().decode().rstrip('\x00').split('\x00') != args(profile, proof['socket'], master=True) or os.path.realpath(folder/'exe') != proof['clientIdentity'][0]:
        fail('ssh_master_identity_changed')
    socket = os.lstat(proof['socket'])
    socket_identity = [str(socket.st_dev), str(socket.st_ino)]
    if not stat.S_ISSOCK(socket.st_mode) or socket.st_uid != os.getuid() or proof.get('socketIdentity') not in (None, socket_identity):
        fail('ssh_control_identity_changed')
    code, output, errors = run(args(profile, proof['socket'], control='check'), timeout=2, limit=8192)
    matches = re.findall(rb'Master running \(pid=([0-9]+)\)(?:\r?\n|$)', output+errors)
    if code or matches != [str(master['pid']).encode()]:
        fail('ssh_master_unavailable')
    # OpenSSH creates its multiplex listener only after ssh_userauth2 succeeds.
    # Bind the exact local owner on both sides of the control response; ordinary
    # login does not require an exec channel or a particular remote login name.
    private(proof)
    after = os.lstat(proof['socket'])
    if process_identity(master['pid']) != master or client_identity(profile['ssh_client']) != proof['clientIdentity'] or (folder/'cmdline').read_bytes().decode().rstrip('\x00').split('\x00') != args(profile, proof['socket'], master=True) or os.path.realpath(folder/'exe') != proof['clientIdentity'][0]:
        fail('ssh_master_identity_changed')
    if not stat.S_ISSOCK(after.st_mode) or after.st_uid != os.getuid() or [str(after.st_dev), str(after.st_ino)] != socket_identity:
        fail('ssh_control_identity_changed')
    return {'socketIdentity': socket_identity}


def main():
    operation, value = sys.argv[1], json.loads(sys.argv[2])
    profile = value.get('profile', {})
    if operation in ('describe', 'allocate'):
        capability = describe(profile)
        if operation == 'describe':
            return capability
        root = Path(tempfile.mkdtemp(prefix='studio-ssh-mux-', dir='/tmp'))
        root.chmod(0o700)
        info = root.stat()
        return {**capability, 'root': str(root), 'socket': str(root/'master.sock'), 'directoryIdentity': [str(info.st_dev), str(info.st_ino)]}
    proof, master = value['proof'], value.get('master')
    if operation == 'closed':
        # Read-only observation of the originally proved local process. Never
        # signal a reused PID, send a control request, or unlink a socket here.
        if master:
            try:
                return {'closed': process_identity(master['pid']) != master}
            except (FileNotFoundError, ProcessLookupError):
                return {'closed': True}
        try:
            root = private(proof)
            return {'closed': not os.path.lexists(root/'master.sock')}
        except FileNotFoundError:
            return {'closed': True}
    if operation == 'ready':
        # Authentication creates the socket only after the human finishes the
        # original master login. Absence is pending, never a capability failure.
        # This branch never opens a remote session or reads terminal input.
        private(proof)
        try:
            os.lstat(proof['socket'])
        except FileNotFoundError:
            return {'ready': False}
        try:
            check(profile, proof, master)
        except Refused as error:
            if str(error) == 'ssh_master_unavailable':
                return {'ready': False}
            raise
        return {'ready': True}
    if operation in ('prove', 'check'):
        return check(profile, proof, master)
    if operation == 'close':
        try:
            check(profile, proof, master)
            code, _, _ = run(args(profile, proof['socket'], control='exit'), timeout=2, limit=8192)
            if code:
                fail('ssh_master_unavailable')
            deadline = time.monotonic()+2
            while time.monotonic() < deadline:
                try:
                    if process_identity(master['pid']) != master:
                        return {'closed': True}
                except (FileNotFoundError, ProcessLookupError):
                    return {'closed': True}
                time.sleep(.02)
            fail('ssh_master_unavailable')
        except (FileNotFoundError, ProcessLookupError):
            pass
        return {'closed': True}
    if operation == 'cleanup':
        root = private(proof)
        for name in ('master.sock',):
            file = root/name
            if file.exists() or file.is_symlink():
                info = file.lstat()
                if file.is_symlink() or not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
                    fail('ssh_control_identity_changed')
                file.unlink()
        root.rmdir()
        return {'cleaned': True}
    fail('ssh_control_invalid_request')


if __name__ == '__main__':
    try:
        print(json.dumps({'ok': True, 'value': main()}, separators=(',', ':')))
    except Refused as error:
        print(json.dumps({'ok': False, 'code': str(error)}, separators=(',', ':')))
        sys.exit(1)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        print('{"ok":false,"code":"ssh_control_unavailable"}')
        sys.exit(1)
