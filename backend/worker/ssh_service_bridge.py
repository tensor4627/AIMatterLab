"""Private stdlib relay inside the human's existing SSH PTY; credentials stay here."""
import base64
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import stat
import subprocess
import sys
import threading
import time
import uuid

PREFIX = '__STUDIO_SERVICE_V1__:'
MAX_PAYLOAD = 16 * 1024 * 1024
MAX_RESPONSE = 8 * 1024 * 1024
TOP_LEVEL = {'bootstrap.py', 'install.py', 'runtime_resources.py', 'relay.py', 'terminal.py',
             'ssh_service_bridge.py', 'ssh_service_bootstrap.py', 'pyproject.toml'}
JSON_FILES = {'studio_worker/engine_contracts.json', 'studio_worker/pygas-editor-hints.json',
              'studio_worker/tool_package.schema.json'}


def fail():
    raise ValueError('ssh_service_unavailable')


def validate_payload(value):
    required = {'schema_version', 'profile_id', 'port', 'expected_runtime_id', 'files'}
    if (not isinstance(value, dict) or not required <= value.keys() or
            value.keys() - required - {'worker_root'} or value['schema_version'] != 1 or
            not isinstance(value['profile_id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value['profile_id']) or
            type(value['port']) is not int or not 1024 <= value['port'] <= 65535 or
            not isinstance(value['expected_runtime_id'], str) or not re.fullmatch(r'[a-f0-9]{20}', value['expected_runtime_id']) or
            not isinstance(value['files'], list) or not 5 <= len(value['files']) <= 512):
        fail()
    files, total = {}, 0
    for entry in value['files']:
        if (not isinstance(entry, dict) or set(entry) - {'path', 'sha256', 'base64', 'size'} or
                not {'path', 'sha256', 'base64'} <= entry.keys()):
            fail()
        name = entry['path']
        if (not isinstance(name, str) or len(name) > 240 or '\\' in name or '\0' in name or
                name != PurePosixPath(name).as_posix() or any(p in ('', '.', '..', 'tests', '__pycache__') for p in name.split('/')) or
                name.startswith('/') or name in files or
                not (name in TOP_LEVEL or name in JSON_FILES or name.startswith('studio_worker/') and name.endswith('.py'))):
            fail()
        if not isinstance(entry['base64'], str) or len(entry['base64']) > MAX_PAYLOAD:
            fail()
        content = base64.b64decode(entry['base64'], validate=True)
        total += len(content)
        if (total > 8 * 1024 * 1024 or len(content) > 2 * 1024 * 1024 or
                entry.get('size', len(content)) != len(content) or
                hashlib.sha256(content).hexdigest() != entry['sha256']):
            fail()
        files[name] = content
    if not {'bootstrap.py', 'runtime_resources.py', 'ssh_service_bridge.py', 'studio_worker/transport/server.py'} <= files.keys():
        fail()
    digest = hashlib.sha256()
    for name in sorted(files, key=lambda x: x.encode('utf8')):
        digest.update(name.encode('utf8')); digest.update(files[name])
    if digest.hexdigest()[:20] != value['expected_runtime_id']:
        fail()
    return files


def private_directory(path):
    path = Path(path)
    missing, current = [], path
    while not current.exists():
        missing.append(current); current = current.parent
    for candidate in [current, *reversed(missing)]:
        if not candidate.exists():
            candidate.mkdir(mode=0o700)
        info = candidate.lstat()
        if not stat.S_ISDIR(info.st_mode) or candidate.is_symlink() or info.st_uid != os.getuid():
            fail()
    path.chmod(0o700)
    return path


def stage_runtime(value, files, home=None):
    home = Path.home().resolve() if home is None else Path(home).resolve()
    namespace = home / '.local/state/gpu-sampling-studio/ssh-services' / value['profile_id']
    # A private leaf is insufficient beneath an ancestor other users can rename.
    for ancestor in [home, *[home.joinpath(*namespace.relative_to(home).parts[:index])
                             for index in range(1, len(namespace.relative_to(home).parts) + 1)]]:
        if ancestor.exists() or ancestor.is_symlink():
            info = ancestor.lstat()
            if (ancestor.is_symlink() or not stat.S_ISDIR(info.st_mode) or
                    info.st_uid != os.getuid() or info.st_mode & 0o022):
                fail()
    requested = value.get('worker_root')
    root = namespace if requested in (None, '') else Path(requested).expanduser()
    if not root.is_absolute() or root != root.resolve() or root != namespace:
        fail()  # Never adopt/migrate another worker or an arbitrary existing directory.
    if root.exists() and (root / 'worker.sqlite').exists() and not (root / 'ssh-service.json').is_file():
        fail()
    private_directory(root)
    marker = root / 'ssh-service.json'
    expected = {'schema_version': 1, 'profile_id': value['profile_id'], 'role': 'ssh-login-service'}
    if marker.exists():
        if marker.is_symlink() or marker.stat().st_uid != os.getuid() or json.loads(marker.read_text()) != expected:
            fail()
    else:
        with marker.open('x') as stream:
            json.dump(expected, stream)
        marker.chmod(0o600)
    parent = private_directory(root / 'runtimes')
    target = parent / value['expected_runtime_id']
    if not target.exists():
        temporary = parent / ('staging-' + uuid.uuid4().hex)
        temporary.mkdir(mode=0o700)
        try:
            for name, content in files.items():
                destination = temporary / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(content); destination.chmod(0o444)
            (temporary / 'runtime.json').write_text(json.dumps({'id': value['expected_runtime_id'], 'files': len(files)}))
            try:
                temporary.rename(target)
            except FileExistsError:
                pass
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)  # Only the just-created, owned staging directory.
    if target.is_symlink() or not target.is_dir() or target.stat().st_uid != os.getuid():
        fail()
    observed = set()
    for item in target.rglob('*'):
        if item.is_symlink():
            fail()
        if item.is_file():
            observed.add(item.relative_to(target).as_posix())
    if observed != set(files) | {'runtime.json'}:
        fail()
    for name, content in files.items():
        if (target / name).read_bytes() != content:
            fail()
    return root, target


def process_record(process):
    try:
        if process.stat().st_uid != os.getuid():
            return None
        command = (process / 'cmdline').read_bytes()
        state = (process / 'stat').read_bytes()
        if len(command) > 65536 or len(state) > 8192:
            return None
        return command.decode().rstrip('\0').split('\0'), state.decode().rsplit(')', 1)[1].split()[19]
    except (OSError, ValueError, UnicodeError, IndexError):
        return None


def owns_stream(root, port, stream):
    """Accepted-socket proof precedes descriptor read/auth on every request."""
    until = time.monotonic() + 1.5
    if stream.getpeername() != ('127.0.0.1', port):
        return False
    local = '0100007F:' + format(port, '04X')
    peer = '0100007F:' + format(stream.getsockname()[1], '04X')
    candidates = []
    for count, process in enumerate(Path('/proc').iterdir()):
        if count > 8192 or time.monotonic() > until:
            return False
        if not process.name.isdigit():
            continue
        record = process_record(process)
        if record and record[0] == [record[0][0], '-m', 'studio_worker.server', '--root', str(root), '--port', str(port)]:
            candidates.append((process, record))
    for _ in range(8):
        data = Path('/proc/net/tcp').read_bytes()
        if len(data) > 1048576 or time.monotonic() > until:
            return False
        inodes = set()
        for row in data.decode('ascii').splitlines()[1:]:
            fields = row.split()
            if len(fields) > 9 and fields[1] == local and fields[2] == peer and fields[3] == '01' and fields[7] == str(os.getuid()):
                inodes.add('socket:[' + fields[9] + ']')
        for process, record in candidates:
            try:
                for count, fd in enumerate((process / 'fd').iterdir()):
                    if count > 8192 or time.monotonic() > until:
                        return False
                    if os.readlink(fd) in inodes and process_record(process) == record:
                        return True
            except OSError:
                pass
        time.sleep(.025)
    return False


def forward(root, port, value):
    if (not isinstance(value, dict) or set(value) - {'method', 'target', 'data', 'mcp'} or
            value.get('method') not in ('GET', 'POST') or type(value.get('mcp', False)) is not bool):
        fail()
    target, mcp = value.get('target'), value.get('mcp', False)
    if (not isinstance(target, str) or len(target) > 8192 or any(c in target for c in '\r\n\0\\') or
            not (target.startswith('/api/') or target == '/mcp') or target.startswith('//') or
            mcp and target != '/mcp' or '#' in target):
        fail()
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=245)
    connection.auto_open = 0
    try:
        connection.sock = socket.create_connection(('127.0.0.1', port), timeout=3)
        connection.sock.settimeout(245)
        if not owns_stream(root, port, connection.sock):
            fail()
        descriptor = root / 'connection.json'
        info = descriptor.lstat()
        if (not stat.S_ISREG(info.st_mode) or descriptor.is_symlink() or info.st_uid != os.getuid() or
                info.st_mode & 0o077 or info.st_size > 65536):
            fail()
        tokens = json.loads(descriptor.read_bytes())
        token = tokens.get('mcp' if mcp else 'admin')
        if not isinstance(token, str) or len(token) < 16:
            fail()
        data = json.dumps(value.get('data', {}), allow_nan=False).encode() if value['method'] == 'POST' else None
        if data is not None and len(data) > 4 * 1024 * 1024:
            fail()
        connection.request(value['method'], target, body=data,
                           headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        response = connection.getresponse(); content = response.read(MAX_RESPONSE + 1)
        if len(content) > MAX_RESPONSE:
            fail()
        return {'status': response.status, 'data': json.loads(content) if content else None}
    finally:
        connection.close()


def start_worker(root, runtime, port):
    environment = os.environ.copy()
    environment.update(PYTHONPATH=str(runtime), PYTHONDONTWRITEBYTECODE='1', STUDIO_SSH_SERVICE_ROOT=str(root))
    # Bootstrap stdout is PRIVATE and may contain tokens. It is never emitted.
    result = subprocess.run([sys.executable, '-B', str(runtime / 'bootstrap.py'), '--root', str(root), '--port', str(port)],
                            env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=25)
    if result.returncode or len(result.stdout) > 131072 or len(result.stderr) > 131072:
        fail()
    health = forward(root, port, {'method': 'GET', 'target': '/api/health'})
    value = health.get('data')
    if (health['status'] != 200 or not isinstance(value, dict) or value.get('name') != 'gpu-sampling-studio' or
            value.get('root') != str(root) or value.get('runtime') != str(runtime) or
            value.get('execution_policy') != 'desktop-review-v1' or value.get('worker_role') != 'ssh-login-service'):
        fail()
    return value


def run(payload, nonce, original_termios=None):
    files = validate_payload(payload)
    root, runtime = stage_runtime(payload, files)
    health = start_worker(root, runtime, payload['port'])
    lock, stopped, slots = threading.Lock(), threading.Event(), threading.Semaphore(8)
    seen = set()
    prefix = PREFIX + nonce + ':'

    def send(kind, identifier, value):
        encoded = base64.b64encode(json.dumps(value, separators=(',', ':'), allow_nan=False).encode()).decode()
        ending = '\n' if kind == 'STOPPED' and original_termios is not None else '\r\n'
        sys.stdout.write(prefix + kind + ':' + identifier + ':' + encoded + ending); sys.stdout.flush()

    def fragmented(kind, identifier, value):
        raw = json.dumps(value, separators=(',', ':'), allow_nan=False).encode()
        if len(raw) > MAX_RESPONSE:
            fail()
        with lock:
            if stopped.is_set():
                return
            for index, at in enumerate(range(0, len(raw), 96)):
                send('FRAGMENT', identifier, {'kind': kind, 'index': index, 'last': at + 96 >= len(raw),
                                             'chunk': base64.b64encode(raw[at:at + 96]).decode()})

    safe = {key: health[key] for key in ('name', 'root', 'runtime', 'execution_policy', 'hostname', 'uid', 'machineId', 'home')}
    safe.update(runtime_id=payload['expected_runtime_id'], port=payload['port'], transport_kind='ssh-service', ssh_service=True)
    fragmented('READY', '-', safe)

    def request(identifier, value):
        try:
            try:
                result = forward(root, payload['port'], value)
            except Exception:
                result = {'status': 502, 'data': {'error': 'SSH service request unconfirmed; reconcile existing state, never replay'}}
            fragmented('RESPONSE', identifier, result)
        finally:
            slots.release()

    try:
        while True:
            line = sys.stdin.buffer.readline(MAX_PAYLOAD + 1)
            if not line:
                break
            if len(line) > MAX_PAYLOAD:
                fail()
            parts = line.decode('ascii').rstrip('\r\n').split(':')
            if len(parts) != 5 or ':'.join(parts[:2]) + ':' != prefix or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', parts[3]):
                fail()
            value = json.loads(base64.b64decode(parts[4], validate=True))
            if parts[2] == 'STOP' and value == {}:
                # No later response may reach the terminal ring after STOPPED.
                with lock:
                    stopped.set()
                    if original_termios is not None:
                        import termios
                        termios.tcsetattr(0, termios.TCSANOW, original_termios)
                    send('STOPPED', parts[3], {})
                return
            if parts[2] != 'REQUEST' or parts[3] in seen or len(seen) >= 8192 or not slots.acquire(blocking=False):
                fail()
            seen.add(parts[3])  # Never evict a prior request into repeat execution.
            threading.Thread(target=request, args=(parts[3], value), daemon=True).start()
    finally:
        with lock:
            stopped.set()


if __name__ == '__main__':
    try:
        run(STUDIO_SERVICE_PAYLOAD, STUDIO_SERVICE_NONCE, globals().get('STUDIO_SERVICE_ORIGINAL_TERMIOS'))
    except Exception:
        encoded = base64.b64encode(b'{"code":"ssh_service_unavailable"}').decode()
        sys.stdout.write(PREFIX + STUDIO_SERVICE_NONCE + ':ERROR:-:' + encoded + '\r\n'); sys.stdout.flush()
