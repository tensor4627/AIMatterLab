"""Versioned SSH transport; the separately pinned worker runtime stays unchanged."""
import base64
import gzip
import threading
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import shutil
import signal
import socket
import stat
import subprocess
import sys
import time
import zlib

MAX_FILES = 512
MAX_FILE = 2 * 1024 * 1024
MAX_SOURCE = 8 * 1024 * 1024
MAX_JSON = 16 * 1024 * 1024
TOP = {'bootstrap.py', 'install.py', 'runtime_resources.py', 'relay.py', 'terminal.py',
       'ssh_service_bridge.py', 'ssh_service_bootstrap.py', 'pyproject.toml'}
RESOURCES = {'studio_worker/engine_contracts.json', 'studio_worker/pygas-editor-hints.json',
             'studio_worker/tool_package.schema.json'}
SCHEDULER_INSPECTION = '/api/ssh-service/inspect-scheduler'


def bounded_observation(arguments):
    """Run one fixed read command with bounded output, time and child cleanup."""
    process = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    output, deadline, status = bytearray(), time.monotonic() + 3, 'observed'
    selector = selectors.DefaultSelector()
    try:
        selector.register(process.stdout, selectors.EVENT_READ)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                status = 'timed_out'; break
            if not selector.select(min(remaining, .1)):
                continue
            chunk = os.read(process.stdout.fileno(), 4096)
            if not chunk:
                break
            output.extend(chunk)
            if len(output) > 65536:
                status = 'output_limit'; break
        if status == 'observed':
            try:
                if process.wait(timeout=max(.01, deadline - time.monotonic())):
                    status = 'command_failed'
            except subprocess.TimeoutExpired:
                status = 'timed_out'
    finally:
        selector.close()
        # Commands must not leave descendants running after an observation.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=2)
        process.stdout.close()
    return status, output.decode('utf8', 'replace') if status == 'observed' else ''


def inspect_scheduler():
    """No user command, profile registration, submission or SSH-to-self."""
    observations = []
    for family, command in [('slurm', ['sinfo', '-h', '-o', '%P|%a|%D|%t|%G']),
                            ('lsf', ['bqueues', '-w'])]:
        executable = shutil.which(command[0])
        if not executable:
            observations.append({'scheduler': family, 'status': 'not_found', 'queues': []})
            continue
        try:
            status, output = bounded_observation([executable, *command[1:]])
        except OSError:
            status, output = 'command_failed', ''
        queues = []
        if status == 'observed':
            lines = output.splitlines()
            if len(lines) > 512:
                status = 'output_limit'
            elif family == 'slurm':
                for line in lines:
                    if not line.strip():
                        continue
                    fields = line.split('|')
                    if len(fields) != 5:
                        status = 'invalid_output'; break
                    name, available, nodes, state, gres = fields
                    default = name.endswith('*'); name = name.removesuffix('*')
                    if (not re.fullmatch(r'[A-Za-z0-9_.+\-]{1,120}', name)
                            or available not in ('up', 'down', 'inact', 'drain')
                            or not nodes.isdecimal() or int(nodes) > 10000000
                            or not re.fullmatch(r'[A-Za-z0-9_+~#*%$@.!\-]{1,40}', state)
                            or not re.fullmatch(r'[A-Za-z0-9_:.,()+/\-]{0,160}', gres)):
                        status = 'invalid_output'; break
                    queues.append({'name': name, 'default': default, 'availability': available,
                                   'node_count': int(nodes), 'node_state': state, 'gres': gres})
            else:
                for line in lines:
                    if not line.strip():
                        continue
                    fields = line.split()
                    if fields and fields[0] == 'QUEUE_NAME':
                        continue
                    if (len(fields) < 3 or not re.fullmatch(r'[A-Za-z0-9_.+\-]{1,120}', fields[0])
                            or not re.fullmatch(r'(?:Open|Closed|open|closed):(?:Active|Inact|active|inact)', fields[2])):
                        status = 'invalid_output'; break
                    queues.append({'name': fields[0], 'availability': fields[2].lower()})
        observations.append({'scheduler': family, 'status': status,
                             'queues': queues if status == 'observed' else []})
    return {'status': 'observed' if any(item['status'] == 'observed' for item in observations) else 'blocked',
            'observed_at': time.time(), 'observations': observations,
            'scope': 'Current login-host scheduler and visible queue observations only; not_found means absent on this bridge PATH, not proof that software is uninstalled. Compute-node GPU availability, execution authorization and scientific validation not_run',
            'automatic_retry': False}


class Failure(Exception):
    def __init__(self, code, phase):
        super().__init__(code)
        self.code, self.phase = code, phase


def fail(code, phase):
    raise Failure(code, phase)


def allowed(name):
    return (isinstance(name, str) and 0 < len(name) <= 240 and '\\' not in name and '\0' not in name
            and name == PurePosixPath(name).as_posix() and not name.startswith('/')
            and not any(p in ('', '.', '..', 'tests', '__pycache__') for p in name.split('/'))
            and (name in TOP or name in RESOURCES or name.startswith('studio_worker/') and name.endswith('.py')))


def digest_files(files):
    digest = hashlib.sha256()
    for name in sorted(files, key=lambda n: n.encode('utf8')):
        digest.update(name.encode('utf8')); digest.update(files[name])
    return digest.hexdigest()


def namespace(hello):
    home = Path.home().resolve()
    root = home / '.local/state/gpu-sampling-studio/ssh-services' / hello['profile_id']
    for item in [home, *[home.joinpath(*root.relative_to(home).parts[:i])
                         for i in range(1, len(root.relative_to(home).parts) + 1)]]:
        if item.exists() or item.is_symlink():
            info = item.lstat()
            if (item.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                    or info.st_mode & 0o022):
                fail('namespace_unsafe', 'checking_cache')
    marker = root / 'ssh-service.json'
    if marker.exists() or marker.is_symlink():
        info = marker.lstat()
        if (marker.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & 0o077 or info.st_size > 4096):
            fail('namespace_unsafe', 'checking_cache')
        if json.loads(marker.read_bytes()) != {'schema_version': 1, 'profile_id': hello['profile_id'], 'role': 'ssh-login-service'}:
            fail('namespace_unsafe', 'checking_cache')
    elif (root / 'worker.sqlite').exists():
        fail('namespace_unsafe', 'checking_cache')
    return root


def cached_files(hello, root):
    target = root / 'runtimes' / hello['expected_runtime_id']
    if not target.exists() and not target.is_symlink():
        return None
    for folder in (root / 'runtimes', target):
        info = folder.lstat()
        if folder.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
            fail('worker_cache_invalid', 'checking_cache')
    files, total = {}, 0
    for item in target.rglob('*'):
        info = item.lstat()
        if item.is_symlink() or info.st_uid != os.getuid() or info.st_mode & 0o022:
            fail('worker_cache_invalid', 'checking_cache')
        if stat.S_ISDIR(info.st_mode):
            continue
        name = item.relative_to(target).as_posix()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > MAX_FILE:
            fail('worker_cache_invalid', 'checking_cache')
        if name == 'runtime.json':
            if info.st_size > 4096:
                fail('worker_cache_invalid', 'checking_cache')
            continue  # This receipt is never executable evidence or a hash oracle.
        if not allowed(name) or len(files) >= MAX_FILES:
            fail('worker_cache_invalid', 'checking_cache')
        content = item.read_bytes(); total += len(content)
        if len(content) != info.st_size or total > MAX_SOURCE:
            fail('worker_cache_invalid', 'checking_cache')
        files[name] = content
    observed = digest_files(files)
    if len(files) < 5 or observed[:20] != hello['expected_runtime_id'] or hello.get('worker_manifest_sha256') is not None and observed != hello['worker_manifest_sha256']:
        fail('worker_cache_invalid', 'checking_cache')
    return files


def unpack_files(raw):
    if len(raw) < 4:
        fail('worker_hash_mismatch', 'transferring_worker')
    length = int.from_bytes(raw[:4], 'big')
    if not 0 < length <= 512 * 1024 or length + 4 > len(raw):
        fail('worker_hash_mismatch', 'transferring_worker')
    value = json.loads(raw[4:4 + length])
    if not isinstance(value, dict) or not isinstance(value.get('files'), list) or not 5 <= len(value['files']) <= MAX_FILES:
        fail('worker_hash_mismatch', 'transferring_worker')
    offset = 4 + length
    for row in value['files']:
        if (not isinstance(row, dict) or set(row) != {'path', 'size', 'sha256'}
                or type(row['size']) is not int or not 0 <= row['size'] <= MAX_FILE
                or offset + row['size'] > len(raw)):
            fail('worker_hash_mismatch', 'transferring_worker')
        row['base64'] = base64.b64encode(raw[offset:offset + row['size']]).decode()
        offset += row['size']
    if offset != len(raw):
        fail('worker_hash_mismatch', 'transferring_worker')
    return value


def receive_bundle(hello, read, send):
    packed, index = bytearray(), 0
    while True:
        kind, identifier, value = read()
        if kind == 'INSTALL_END' and identifier == '-':
            expected = {'encoding': 'gzip', 'size': hello['worker_gzip_size'], 'sha256': hello['worker_gzip_sha256'],
                        'uncompressed_size': hello['worker_size'], 'uncompressed_sha256': hello['worker_sha256']}
            if value != expected or len(packed) != expected['size'] or hashlib.sha256(packed).hexdigest() != expected['sha256']:
                fail('worker_hash_mismatch', 'transferring_worker')
            break
        if kind != 'INSTALL' or identifier != str(index) or set(value) != {'chunk'}:
            fail('protocol_failed', 'transferring_worker')
        try:
            content = base64.b64decode(value['chunk'], validate=True)
        except (ValueError, TypeError):
            fail('protocol_failed', 'transferring_worker')
        if not 0 < len(content) <= hello.get('upload_chunk_bytes', 2048) or len(packed) + len(content) > hello['worker_gzip_size']:
            fail('worker_hash_mismatch', 'transferring_worker')
        packed.extend(content); send('ACK', index, {'accepted': index}); index += 1
    try:
        decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
        raw = decoder.decompress(bytes(packed), hello['worker_size'] + 1)
        if (len(raw) != hello['worker_size'] or not decoder.eof or decoder.unconsumed_tail or decoder.unused_data
                or hashlib.sha256(raw).hexdigest() != hello['worker_sha256']):
            fail('worker_hash_mismatch', 'transferring_worker')
        value = unpack_files(raw) if hello.get('worker_encoding') == 'gzip-files-v1' else json.loads(raw)
    except (zlib.error, ValueError, UnicodeError):
        fail('worker_hash_mismatch', 'transferring_worker')
    return value


def validate_manifest(value, hello):
    if (not isinstance(value, dict) or set(value) - {'schema_version', 'profile_id', 'port', 'expected_runtime_id', 'files'}
            or value.get('schema_version') != 1 or value.get('profile_id') != hello['profile_id']
            or value.get('port') != hello['port'] or value.get('expected_runtime_id') != hello['expected_runtime_id']
            or not isinstance(value.get('files'), list) or not 5 <= len(value['files']) <= MAX_FILES):
        fail('worker_hash_mismatch', 'transferring_worker')
    files, total = {}, 0
    for row in value['files']:
        if (not isinstance(row, dict) or set(row) - {'path', 'sha256', 'base64', 'size'}
                or not {'path', 'sha256', 'base64'} <= row.keys() or not allowed(row['path']) or row['path'] in files
                or not isinstance(row['base64'], str) or len(row['base64']) > 4 * ((MAX_FILE + 2) // 3)):
            fail('worker_hash_mismatch', 'transferring_worker')
        try:
            content = base64.b64decode(row['base64'], validate=True)
        except (ValueError, TypeError):
            fail('worker_hash_mismatch', 'transferring_worker')
        total += len(content)
        if (len(content) > MAX_FILE or total > MAX_SOURCE or row.get('size', len(content)) != len(content)
                or hashlib.sha256(content).hexdigest() != row['sha256']):
            fail('worker_hash_mismatch', 'transferring_worker')
        files[row['path']] = content
    if digest_files(files) != hello['worker_manifest_sha256']:
        fail('worker_hash_mismatch', 'transferring_worker')
    return files


def legacy_transport(files):
    # Executable bytes have just matched the desktop's full canonical SHA256.
    # Reuse the shipped process/socket proof unchanged; do not fork that policy.
    scope = {'__name__': 'studio_pinned_worker_transport'}
    exec(compile(files['ssh_service_bridge.py'], '<studio-pinned-worker-transport>', 'exec'), scope)
    return scope


def health_checked(legacy, root, runtime, port, phase):
    phase('starting_worker')
    environment = os.environ.copy()
    environment.update(PYTHONPATH=str(runtime), PYTHONDONTWRITEBYTECODE='1', STUDIO_SSH_SERVICE_ROOT=str(root))
    failed = False
    try:
        result = subprocess.run([sys.executable, '-B', str(runtime / 'bootstrap.py'), '--root', str(root), '--port', str(port)],
                                cwd=str(runtime), env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=25)
        failed = result.returncode != 0 or len(result.stdout) > 131072 or len(result.stderr) > 131072
    except subprocess.TimeoutExpired:
        fail('worker_start_timeout', 'starting_worker')
    phase('checking_health')
    # The original bootstrap waits about five seconds. A slow shared filesystem
    # may leave its detached controller importing after bootstrap has exited.
    # Observe that exact controller; never launch bootstrap a second time.
    deadline = time.monotonic() + (10 if failed else 3)
    while True:
        try:
            value = forward(legacy, root, port, {'method': 'GET', 'target': '/api/health'}, timeout=2)['data']
            break
        except ConnectionRefusedError:
            if time.monotonic() >= deadline:
                fail('worker_start_failed', 'starting_worker')
            time.sleep(.1)
    return verified_health(value,root,runtime)


def verified_health(value,root,runtime):
    if (not isinstance(value, dict) or value.get('name') != 'gpu-sampling-studio'
            or value.get('root') != str(root) or value.get('runtime') != str(runtime)
            or value.get('execution_policy') != 'desktop-review-v1' or value.get('worker_role') != 'ssh-login-service'
            or not all(key in value for key in ('hostname', 'uid', 'machineId', 'home'))):
        fail('worker_health_invalid', 'checking_health')
    return value


def forward(legacy, root, port, value, timeout=245):
    phase = 'checking_health' if timeout != 245 else 'request'
    if (not isinstance(value, dict) or set(value) - {'method', 'target', 'data', 'mcp'}
            or value.get('method') not in ('GET', 'POST') or type(value.get('mcp', False)) is not bool):
        fail('protocol_failed', phase)
    target, mcp = value.get('target'), value.get('mcp', False)
    if (not isinstance(target, str) or len(target) > 8192 or any(c in target for c in '\r\n\0\\')
            or not (target.startswith('/api/') or target == '/mcp') or target.startswith('//')
            or mcp and target != '/mcp' or '#' in target):
        fail('protocol_failed', phase)
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    connection.auto_open = 0
    try:
        connection.sock = socket.create_connection(('127.0.0.1', port), timeout=3)
        connection.sock.settimeout(timeout)
        if not legacy['owns_stream'](root, port, connection.sock):
            fail('worker_identity_unavailable', phase)
        descriptor = root / 'connection.json'; info = descriptor.lstat()
        if (not stat.S_ISREG(info.st_mode) or descriptor.is_symlink() or info.st_uid != os.getuid()
                or info.st_mode & 0o077 or info.st_size > 65536):
            fail('worker_identity_unavailable', phase)
        tokens = json.loads(descriptor.read_bytes()); token = tokens.get('mcp' if mcp else 'admin')
        if not isinstance(token, str) or len(token) < 16:
            fail('worker_identity_unavailable', phase)
        data = json.dumps(value.get('data', {}), allow_nan=False).encode() if value['method'] == 'POST' else None
        if data is not None and len(data) > 4 * 1024 * 1024:
            fail('protocol_failed', phase)
        connection.request(value['method'], target, body=data,
                           headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        response = connection.getresponse(); content = response.read(MAX_SOURCE + 1)
        if len(content) > MAX_SOURCE:
            fail('protocol_failed', phase)
        if phase == 'checking_health' and response.status != 200:
            fail('worker_health_invalid', phase)
        return {'status': response.status, 'data': json.loads(content) if content else None}
    finally:
        connection.close()


def relay_lane(payload, nonce, send, restore, legacy, root, port, health, encoding):
    """Transport framing only; every request retains the pinned socket-owner proof."""
    lock, stopped, slots = threading.Lock(), threading.Event(), threading.Semaphore(8)
    seen = set()

    def fragmented(kind, identifier, value):
        raw = json.dumps(value, separators=(',', ':'), allow_nan=False).encode()
        if len(raw) > MAX_SOURCE:
            fail('protocol_failed', 'request')
        packed = gzip.compress(raw, compresslevel=6, mtime=0) if encoding and kind == 'RESPONSE' and len(raw) >= 1024 else None
        compressed = packed is not None and len(packed) <= len(raw) * .8
        content = packed if compressed else raw
        with lock:
            if stopped.is_set():
                return
            if compressed:
                send('COMPRESSED_BEGIN', identifier, {'kind': kind, 'compressedBytes': len(content),
                     'uncompressedBytes': len(raw), 'sha256': hashlib.sha256(content).hexdigest()})
            for index, at in enumerate(range(0, len(content), 96)):
                send('COMPRESSED_FRAGMENT' if compressed else 'FRAGMENT', identifier,
                     {'kind': kind, 'index': index, 'last': at + 96 >= len(content),
                      'chunk': base64.b64encode(content[at:at + 96]).decode()})

    safe = {key: health[key] for key in ('name', 'root', 'runtime', 'execution_policy', 'hostname', 'uid', 'machineId', 'home')}
    safe.update(runtime_id=payload['expected_runtime_id'], port=port, transport_kind='ssh-service', ssh_service=True,
                bridge_capabilities=['scheduler-inspection-v1'])
    for key in ('runtime_manifest_sha256','runtime_source_scope'):
        if key in health: safe[key] = health[key]
    fragmented('READY', '-', safe)

    def request(identifier, value):
        try:
            try:
                if isinstance(value, dict) and value.get('target') == SCHEDULER_INSPECTION:
                    if (value != {'method': 'POST', 'target': SCHEDULER_INSPECTION, 'data': {}, 'mcp': False}
                            or type(value.get('mcp')) is not bool or type(value.get('data')) is not dict):
                        fail('protocol_failed', 'request')
                    def verify():
                        actual = forward(legacy, root, port, {'method': 'GET', 'target': '/api/health'}, timeout=2)
                        if (actual['status'] != 200 or any(actual['data'].get(key) != health.get(key)
                                for key in ('name', 'root', 'runtime', 'execution_policy', 'hostname', 'uid', 'machineId'))):
                            fail('worker_identity_unavailable', 'request')
                    verify()
                    observation = inspect_scheduler()
                    verify()
                    result = {'status': 200, 'data': observation}
                else:
                    result = forward(legacy, root, port, value)
            except Exception:
                result = {'status': 502, 'data': {'error': 'SSH service request unconfirmed; reconcile existing state, never replay'}}
            fragmented('RESPONSE', identifier, result)
        finally:
            slots.release()

    try:
        while True:
            # Requests retain the released 16 MiB envelope bound; the small
            # bootstrap loader's 16 KiB installation-line bound is separate.
            line = sys.stdin.buffer.readline(MAX_JSON + 1)
            if not line:
                break
            if len(line) > MAX_JSON:
                fail('protocol_failed', 'request')
            parts = line.decode('ascii').rstrip('\r\n').split(':')
            if len(parts) != 5 or ':'.join(parts[:2]) + ':' != '__STUDIO_SERVICE_V1__:' + nonce + ':':
                fail('protocol_failed', 'request')
            kind, identifier = parts[2:4]
            value = json.loads(base64.b64decode(parts[4], validate=True))
            if kind == 'STOP' and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identifier) and value == {}:
                with lock:
                    stopped.set()
                    restore()
                    send('STOPPED', identifier, {}, True)
                return
            if (kind != 'REQUEST' or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identifier)
                    or identifier in seen or len(seen) >= 8192 or not slots.acquire(blocking=False)):
                fail('protocol_failed', 'request')
            seen.add(identifier)
            threading.Thread(target=request, args=(identifier, value), daemon=True).start()
    finally:
        with lock:
            stopped.set()


def run(hello, nonce, read, send, phase, restore, original_termios=None):
    phase('checking_cache')
    root = namespace(hello)
    files = cached_files(hello, root)
    cached = files is not None
    if files is None:
        if hello.get('reuse_only'):
            fail('maintenance_required','checking_cache')
        phase('transferring_worker'); send('WORKER_NEEDED', '-', {})
        payload = receive_bundle(hello, read, send); files = validate_manifest(payload, hello)
    else:
        payload = {'schema_version': 1, 'profile_id': hello['profile_id'], 'port': hello['port'],
                   'expected_runtime_id': hello['expected_runtime_id'],
                   'files': [{'path': name, 'sha256': hashlib.sha256(content).hexdigest(), 'base64': base64.b64encode(content).decode()}
                             for name, content in files.items()]}
    legacy = legacy_transport(files)
    files = legacy['validate_payload'](payload)
    send('WORKER_READY', '-', {'cached': cached}); phase('preparing_runtime')
    if hello.get('reuse_only'):
        runtime=root/'runtimes'/hello['expected_runtime_id'];phase('checking_health')
        if not (root/'ssh-service.json').is_file():fail('maintenance_required','checking_cache')
        try:
            health=verified_health(forward(legacy,root,hello['port'],{'method':'GET','target':'/api/health'},timeout=2)['data'],root,runtime)
        except ConnectionRefusedError:
            # The human's unified handoff may start this exact verified cached
            # runtime once. It never installs code or replays a job request.
            if not hello.get('start_cached'):
                fail('maintenance_required','checking_health')
            health = health_checked(legacy, root, runtime, hello['port'], phase)
        except (ConnectionError,TimeoutError,OSError):
            fail('maintenance_required','checking_health')
        # Without the explicit handoff flag, daily attach remains read-only.
    else:
        try:
            root, runtime = legacy['stage_runtime'](payload, files)
        except (ValueError, TypeError):
            fail('worker_cache_invalid' if cached else 'namespace_unsafe', 'preparing_runtime')
        health = health_checked(legacy, root, runtime, hello['port'], phase)
    health['runtime_manifest_sha256'] = digest_files(files)
    health['runtime_source_scope'] = ('observed-legacy-cache' if hello.get('cache_only') and hello.get('worker_manifest_sha256') is None else 'verified-cached-manifest' if hello.get('cache_only') else 'shipped-manifest')
    legacy['validate_payload'] = lambda _payload: files
    legacy['stage_runtime'] = lambda _payload, _files: (root, runtime)
    legacy['start_worker'] = lambda _root, _runtime, _port: health
    legacy['forward'] = lambda _root, _port, value: forward(legacy, _root, _port, value)
    # Existing bounded fragmented responses, no-replay ledger, per-request
    # socket ownership, and STOP quiescence remain the released implementation.
    relay_lane(payload, nonce, send, restore, legacy, root, hello['port'], health, hello.get('response_encoding'))
