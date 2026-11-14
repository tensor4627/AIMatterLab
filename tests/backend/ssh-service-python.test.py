"""Isolated Linux transport/cache fixtures; no SSH, model, engine or real jobs."""
import base64
import copy
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]
WORKER = REPO / 'backend/worker'
TRANSPORT = REPO / 'desktop/platform/terminal-service/python'
sys.path.insert(0, str(WORKER))
from runtime_resources import worker_files, runtime_identity

spec = importlib.util.spec_from_file_location('studio_transport_v2', TRANSPORT / 'bridge.py')
bridge = importlib.util.module_from_spec(spec); spec.loader.exec_module(bridge)
NONCE = 'a' * 64
PREFIX = '__STUDIO_SERVICE_V1__:' + NONCE + ':'


def bundle(port=23456):
    files = {name: (WORKER / name).read_bytes() for name in worker_files(WORKER)}
    value = {'schema_version': 1, 'profile_id': 'owned-v2-fixture', 'port': port,
             'expected_runtime_id': runtime_identity(WORKER, files),
             'files': [{'path': name, 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest(),
                        'base64': base64.b64encode(content).decode()} for name, content in files.items()]}
    raw = json.dumps(value, separators=(',', ':')).encode(); packed = gzip.compress(raw)
    source = (TRANSPORT / 'bridge.py').read_bytes()
    hello = {'schema_version': 2, 'profile_id': value['profile_id'], 'port': port,
             'expected_runtime_id': value['expected_runtime_id'], 'worker_manifest_sha256': bridge.digest_files(files),
             'transport_sha256': hashlib.sha256(source).hexdigest(), 'transport_size': len(source),
             'worker_gzip_size': len(packed), 'worker_gzip_sha256': hashlib.sha256(packed).hexdigest(),
             'worker_size': len(raw), 'worker_sha256': hashlib.sha256(raw).hexdigest()}
    return hello, source, packed, value, files


def frame(kind, identifier, value):
    return (PREFIX + kind + ':' + str(identifier) + ':' + base64.b64encode(json.dumps(value).encode()).decode() + '\n').encode()


def decode(line):
    text = line.decode().rstrip('\r\n')
    if not text.startswith(PREFIX):
        raise AssertionError('Unexpected public output: ' + text[:80])
    kind, identifier, value = text[len(PREFIX):].split(':')
    return kind, identifier, json.loads(base64.b64decode(value, validate=True))


def reuse_guard(path):
    """Watch the real child without replacing its helper, HTTP, cache or worker."""
    return '''import sys
_reuse_guard_path = %r
with open(_reuse_guard_path, 'w') as _guard_file:
    _guard_file.write('active\\n')
def _reuse_forbidden(kind):
    with open(_reuse_guard_path, 'a') as _guard_file:
        _guard_file.write(kind + '\\n')
    raise RuntimeError('Reuse must not stage or launch a worker')
def _reuse_profile(frame, event, arg):
    if event == 'call' and frame.f_code.co_name in ('stage_runtime', 'health_checked', 'start_worker'):
        _reuse_forbidden(frame.f_code.co_name)
def _reuse_audit(event, args):
    if event in ('subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.fork'):
        _reuse_forbidden(event)
sys.setprofile(_reuse_profile)
sys.addaudithook(_reuse_audit)
''' % str(path)


def cache_evidence(root):
    paths = [root / 'ssh-service.json', root / 'connection.json']
    paths.extend(item for item in (root / 'runtimes').rglob('*') if item.is_file())
    return {str(item.relative_to(root)): (item.stat().st_ino, item.stat().st_mtime_ns,
             item.stat().st_mode, hashlib.sha256(item.read_bytes()).hexdigest()) for item in paths if item.exists()}


class Client:
    def __init__(self, home, hello, source, packed, prefix=''):
        self.hello, self.source, self.packed, self.wire, self.uploads = hello, source, packed, [], []
        environment = os.environ.copy()
        environment.update(HOME=str(home), PYTHONDONTWRITEBYTECODE='1')
        environment.pop('SSH_AUTH_SOCK', None)
        self.process = subprocess.Popen([sys.executable, '-I', '-u', '-c', prefix + (TRANSPORT / 'bootstrap.py').read_text(), NONCE],
                                        cwd=str(home), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment, bufsize=0)

    def read(self):
        ready, _, _ = select.select([self.process.stdout], [], [], 35)
        if not ready:
            raise AssertionError('Owned transport fixture timed out')
        line = self.process.stdout.readline(); self.wire.append(line)
        if not line:
            raise AssertionError('Owned transport exited before frame')
        return decode(line)

    def send(self, kind, identifier, value):
        self.process.stdin.write(frame(kind, identifier, value)); self.process.stdin.flush()

    def upload(self, raw, ending, metadata):
        self.uploads.append((ending, len(raw)))
        for index, at in enumerate(range(0, len(raw), 2048)):
            self.send('INSTALL', index, {'chunk': base64.b64encode(raw[at:at + 2048]).decode()})
            if self.read() != ('ACK', str(index), {'accepted': index}):
                raise AssertionError('Non-contiguous install acknowledgment')
        self.send(ending, '-', metadata)

    def start(self):
        first = self.read()
        if first[0] != 'BOOTSTRAP_READY':
            return first
        assert first[2]['protocol'] == 2
        self.send('HELLO', '-', self.hello); fragments = bytearray(); self.receipts = []
        while True:
            kind, identifier, value = self.read(); self.receipts.append((kind, value))
            if kind == 'TRANSPORT_NEEDED':
                self.upload(self.source, 'TRANSPORT_END', {'size': len(self.source), 'sha256': self.hello['transport_sha256']})
            elif kind == 'WORKER_NEEDED':
                self.upload(self.packed, 'INSTALL_END', {'encoding': 'gzip', 'size': len(self.packed), 'sha256': self.hello['worker_gzip_sha256'],
                                                       'uncompressed_size': self.hello['worker_size'], 'uncompressed_sha256': self.hello['worker_sha256']})
            elif kind == 'FRAGMENT':
                assert value['kind'] == 'READY' and value['index'] * 96 == len(fragments)
                fragments.extend(base64.b64decode(value['chunk']))
                if value['last']:
                    return json.loads(fragments)
            elif kind == 'ERROR':
                return kind, identifier, value

    def request(self, target, data=None, mcp=False):
        self.send('REQUEST', 'request-' + str(len(self.wire)), {'method': 'POST' if data is not None else 'GET', 'target': target,
                                                              'mcp': mcp, **({'data': data} if data is not None else {})})
        result = bytearray(); compressed = None
        while True:
            kind, _, value = self.read()
            if kind == 'COMPRESSED_BEGIN':
                assert self.hello.get('response_encoding') == 'gzip-fragments-v1'
                compressed = value
                continue
            assert kind == ('COMPRESSED_FRAGMENT' if compressed else 'FRAGMENT') and value['kind'] == 'RESPONSE'
            assert value['index'] * 96 == len(result)
            result.extend(base64.b64decode(value['chunk']))
            if value['last']:
                if compressed:
                    assert len(result) == compressed['compressedBytes']
                    assert hashlib.sha256(result).hexdigest() == compressed['sha256']
                    result = gzip.decompress(result)
                    assert len(result) == compressed['uncompressedBytes']
                return json.loads(result)

    def stop(self):
        self.send('STOP', 'owned-stop', {})
        assert self.read() == ('STOPPED', 'owned-stop', {})
        self.finish()

    def finish(self):
        self.process.wait(timeout=5)
        assert self.process.stdout.read() == b''
        assert self.process.stderr.read() == b''
        self.process.stdin.close(); self.process.stdout.close(); self.process.stderr.close()

    def dispose(self):
        if self.process.poll() is None:
            self.process.kill(); self.process.wait(timeout=5)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            stream.close()


@unittest.skipUnless(os.name == 'posix', 'Linux process/socket and terminal identities')
class TransportTests(unittest.TestCase):
    def test_fixed_scheduler_inspection_uses_actual_programs_and_authenticated_bridge_without_registration(self):
        with tempfile.TemporaryDirectory(prefix='studio-v2-probe-owned-') as home:
            folder = Path(home) / 'bin'; folder.mkdir()
            scripts = {
                'sinfo': "assert sys.argv[1:] == ['-h','-o','%P|%a|%D|%t|%G']; print('gpu*|up|2|idle|gpu:a100:4')",
                'bqueues': "assert sys.argv[1:] == ['-w']; print('QUEUE_NAME PRIO STATUS MAX JL/U JL/P JL/H NJOBS PEND RUN SUSP'); print('batch 30 Open:Active - - - - 0 0 0 0')",
            }
            for name, code in scripts.items():
                file = folder / name; file.write_text('#!' + sys.executable + '\nimport sys\n' + code + '\n'); file.chmod(0o700)
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
            hello, source, packed, _, _ = bundle(port)
            root = Path(home) / '.local/state/gpu-sampling-studio/ssh-services' / hello['profile_id']
            client = Client(home, hello, source, packed, prefix='import os\nos.environ["PATH"] = %r\n' % str(folder))
            try:
                ready = client.start()
                self.assertEqual(ready['bridge_capabilities'], ['scheduler-inspection-v1'])
                before = cache_evidence(root)
                result = client.request(bridge.SCHEDULER_INSPECTION, {})
                self.assertEqual(result['status'], 200)
                observed = result['data']; self.assertEqual(observed['status'], 'observed')
                self.assertEqual(observed['observations'][0]['queues'], [{'name': 'gpu', 'default': True, 'availability': 'up', 'node_count': 2, 'node_state': 'idle', 'gres': 'gpu:a100:4'}])
                self.assertEqual(observed['observations'][1]['queues'], [{'name': 'batch', 'availability': 'open:active'}])
                self.assertFalse(observed['automatic_retry'])
                self.assertEqual(cache_evidence(root), before)
                for name in ('list_clusters', 'list_projects', 'list_workflows'):
                    reply = client.request('/mcp', {'jsonrpc': '2.0', 'id': name, 'method': 'tools/call', 'params': {'name': name, 'arguments': {}}}, True)
                    self.assertEqual(json.loads(reply['data']['result']['content'][0]['text']), [])
                for data, mcp in [({'command': 'never'}, False), ({}, True), ({}, 0)]:
                    self.assertEqual(client.request(bridge.SCHEDULER_INSPECTION, data, mcp)['status'], 502)
                self.assertEqual(client.request('/api/health')['status'], 200)
                client.stop()
            finally:
                client.dispose(); self.stop_workers(root, port)

    def test_fixed_scheduler_output_and_timeout_are_bounded_with_no_partial_queue_claims(self):
        with tempfile.TemporaryDirectory(prefix='studio-probe-bounds-') as folder:
            executable = Path(folder) / 'sinfo'
            for code, expected in [("print('x'*70000)", 'output_limit'), ("print('not|a|valid|row')", 'invalid_output'), ("import time; time.sleep(30)", 'timed_out')]:
                executable.write_text('#!' + sys.executable + '\n' + code + '\n'); executable.chmod(0o700)
                with patch.dict(os.environ, {'PATH': folder}):
                    started = time.monotonic(); result = bridge.inspect_scheduler()
                self.assertLess(time.monotonic() - started, 6)
                self.assertEqual(result['status'], 'blocked')
                self.assertEqual(result['observations'][0]['status'], expected)
                self.assertEqual(result['observations'][0]['queues'], [])
                self.assertEqual(result['observations'][1]['status'], 'not_found')

    def test_compact_bundle_preserves_pinned_files_and_rejects_malformed_file_offsets(self):
        hello, _, _, value, files = bundle()
        header = json.dumps({**value, 'files': [{k: v for k, v in row.items() if k != 'base64'} for row in value['files']]}, separators=(',', ':')).encode()
        raw = len(header).to_bytes(4, 'big') + header + b''.join(files[row['path']] for row in value['files'])
        restored = bridge.unpack_files(raw)
        self.assertEqual(bridge.validate_manifest(restored, hello), files)
        for broken in (raw[:-1], raw + b'junk', b'\xff\xff\xff\xff' + raw[4:]):
            with self.assertRaises(bridge.Failure):
                bridge.unpack_files(broken)

    def test_negotiated_compact_bundle_compressed_large_reply_and_large_request_keep_stop_barrier(self):
        with tempfile.TemporaryDirectory(prefix='studio-v2-owned-') as home:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
            hello, source, old_packed, value, files = bundle(port)
            header = json.dumps({**value, 'files': [{k: v for k, v in row.items() if k != 'base64'} for row in value['files']]}, separators=(',', ':')).encode()
            raw = len(header).to_bytes(4, 'big') + header + b''.join(files[row['path']] for row in value['files'])
            packed = gzip.compress(raw, compresslevel=6, mtime=0)
            self.assertLess(len(packed), len(old_packed) * .8)
            hello.update(worker_encoding='gzip-files-v1', response_encoding='gzip-fragments-v1', upload_chunk_bytes=2048,
                         worker_size=len(raw), worker_sha256=hashlib.sha256(raw).hexdigest(), worker_gzip_size=len(packed), worker_gzip_sha256=hashlib.sha256(packed).hexdigest())
            root = Path(home) / '.local/state/gpu-sampling-studio/ssh-services' / hello['profile_id']
            client = Client(home, hello, source, packed)
            try:
                health = client.start(); self.assertEqual(health['runtime_id'], hello['expected_runtime_id'])
                context = client.request('/api/authoring/context', {'workspace_id': 'owned-compressed-fixture', 'name': 'Owned compressed transport', 'structure_paths': [], 'selected_paths': []})
                project = context['data']['project']['id']; content = 'owned harmless transport data\n' * 3000
                self.assertEqual(client.request('/api/workspace/write', {'project_id': project, 'name': 'large-fixture.txt', 'content': content})['status'], 200)
                self.assertEqual(client.request('/api/workspace/read', {'project_id': project, 'name': 'large-fixture.txt'})['data']['text'], content)
                self.assertTrue(any(decode(line)[0] == 'COMPRESSED_BEGIN' for line in client.wire))
                client.stop(); self.assertTrue(self.owned_workers(root, port))
            finally:
                client.dispose(); self.stop_workers(root, port)

    def test_current_worker_manifest_matches_independently_hashed_exact_source_files(self):
        names=worker_files(WORKER)
        self.assertGreaterEqual(len(names),5);self.assertLessEqual(len(names),256)
        files={name:(WORKER/name).read_bytes() for name in names}
        self.assertEqual(runtime_identity(WORKER,names),bridge.digest_files(files)[:20])
        changed=dict(files);first=next(iter(changed));changed[first]+=b'\n# synthetic mutation\n'
        self.assertNotEqual(bridge.digest_files(changed),bridge.digest_files(files))

    def test_actual_cold_then_cached_transport_worker_and_http_keep_remote_credentials(self):
        with tempfile.TemporaryDirectory(prefix='studio-v2-owned-') as home:
            for name in ('hashlib.py', 'json.py', 'sqlite3.py'):
                (Path(home) / name).write_text('raise RuntimeError("UNTRUSTED_CWD_MUST_NOT_EXECUTE")')
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
            hello, source, packed, _, _ = bundle(port)
            clients = []
            root = Path(home) / '.local/state/gpu-sampling-studio/ssh-services' / hello['profile_id']
            try:
                cold = Client(home, hello, source, packed); clients.append(cold); health = cold.start()
                self.assertEqual(health['runtime_id'], hello['expected_runtime_id']); self.assertEqual(health['root'], str(root))
                self.assertEqual([kind for kind, _ in cold.uploads], ['TRANSPORT_END', 'INSTALL_END'])
                self.assertLess(len(packed), hello['worker_size'] // 2)
                self.assertEqual(cold.request('/api/health')['data']['hostIdentity']['uid'], os.getuid())
                self.assertEqual(cold.request('/api/runs/prepare', {})['status'], 403)
                self.assertEqual(cold.request('/mcp', {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize'}, True)['status'], 200)
                tokens = json.loads((root / 'connection.json').read_text())
                cold.stop(); self.assertTrue(self.owned_workers(root, port))
                warm = Client(home, hello, source, packed); clients.append(warm); self.assertEqual(warm.start(), health)
                self.assertEqual(warm.uploads, [])
                self.assertIn(('HELPER_READY', {'cached': True}), warm.receipts)
                self.assertIn(('WORKER_READY', {'cached': True}), warm.receipts)
                warm.stop(); self.assertTrue(self.owned_workers(root, port))
                records = [decode(line) for line in cold.wire + warm.wire]
                wire = json.dumps(records).encode() + b''.join(base64.b64decode(value['chunk']) for kind, _, value in records if kind == 'FRAGMENT')
                for key in ('admin', 'mcp'):
                    self.assertNotIn(tokens[key].encode(), wire)
                # Removing only the owned transport cache cannot change the
                # original worker fingerprint or force its source upload.
                helper = Path(home) / '.local/state/gpu-sampling-studio/ssh-transport-v2' / hello['transport_sha256'] / 'bridge.py'
                helper.unlink()
                fresh = Client(home, hello, source, packed); clients.append(fresh); self.assertEqual(fresh.start(), health)
                self.assertEqual([kind for kind, _ in fresh.uploads], ['TRANSPORT_END']); fresh.stop()
                self.assertEqual(len(self.owned_workers(root, port)), 1)
            finally:
                for client in clients: client.dispose()
                self.stop_workers(root, port)

    def test_reuse_only_attaches_same_worker_without_upload_stage_or_bootstrap_and_stop_restores_tty(self):
        with tempfile.TemporaryDirectory(prefix='studio-v2-reuse-owned-') as home:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
            hello, source, packed, _, _ = bundle(port)
            root = Path(home) / '.local/state/gpu-sampling-studio/ssh-services' / hello['profile_id']
            clients = []
            try:
                setup = Client(home, hello, source, packed); clients.append(setup)
                health = setup.start(); setup.stop()
                before_workers = self.owned_workers(root, port)
                self.assertEqual(len(before_workers), 1)
                before_cache = cache_evidence(root)
                daily_hello = {**hello, 'reuse_only': True}
                guard = Path(home) / 'daily-guard.txt'
                daily = Client(home, daily_hello, source, packed, reuse_guard(guard)); clients.append(daily)
                self.assertEqual(daily.start(), health)
                self.assertEqual(daily.uploads, [])
                self.assertIn(('WORKER_READY', {'cached': True}), daily.receipts)
                self.assertEqual(daily.request('/api/health')['status'], 200)
                self.assertEqual(daily.request('/mcp', {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize'}, True)['status'], 200)
                self.assertEqual(self.owned_workers(root, port), before_workers)
                daily.stop()
                self.assertEqual(guard.read_text(), 'active\n')
                self.assertEqual(cache_evidence(root), before_cache)
                self.assert_tty_reuse_stop(home, daily_hello)
                self.assertEqual(self.owned_workers(root, port), before_workers)
                self.assertEqual(cache_evidence(root), before_cache)
                # A different pinned runtime is a maintenance request, never an
                # implicit upgrade of the installed and still-running worker.
                upgrade = Client(home, {**daily_hello, 'expected_runtime_id': '0' * 20,
                                 'worker_manifest_sha256': '0' * 64}, source, packed, reuse_guard(guard))
                clients.append(upgrade)
                error = upgrade.start(); self.assertEqual(error[2]['code'], 'maintenance_required')
                self.assertEqual(error[2]['phase'], 'checking_cache')
                self.assertEqual(upgrade.read(), ('EXITED', '-', {'reason': 'failed'})); upgrade.finish()
                self.assertEqual(upgrade.uploads, [])
                self.assertFalse((root / 'runtimes' / ('0' * 20)).exists())
                self.assertEqual(guard.read_text(), 'active\n')
                self.assertEqual(self.owned_workers(root, port), before_workers)
                self.assertEqual(cache_evidence(root), before_cache)
            finally:
                for client in clients: client.dispose()
                self.stop_workers(root, port)

    def test_legacy_cache_only_measures_full_manifest_without_upload_or_source_reconstruction(self):
        with tempfile.TemporaryDirectory(prefix='studio-v2-legacy-cache-') as home:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
            hello, source, packed, _, _ = bundle(port)
            root = Path(home) / '.local/state/gpu-sampling-studio/ssh-services' / hello['profile_id']
            clients=[]
            try:
                setup=Client(home, hello, source, packed); clients.append(setup); original=setup.start(); setup.stop()
                before=cache_evidence(root); workers=self.owned_workers(root,port)
                cache_only={**hello,'reuse_only':True,'cache_only':True,'worker_manifest_sha256':None}
                daily=Client(home,cache_only,source,b'no original worker source is available'); clients.append(daily)
                observed=daily.start(); self.assertEqual(observed['runtime_manifest_sha256'],hello['worker_manifest_sha256']); self.assertEqual(observed['runtime_source_scope'],'observed-legacy-cache'); self.assertEqual(daily.uploads,[]); self.assertEqual(self.owned_workers(root,port),workers);daily.stop(); self.assertEqual(cache_evidence(root),before)
                pinned=Client(home,{**cache_only,'worker_manifest_sha256':observed['runtime_manifest_sha256']},source,b'no source');clients.append(pinned);self.assertEqual(pinned.start()['runtime_source_scope'],'verified-cached-manifest');self.assertEqual(pinned.uploads,[]);pinned.stop()
            finally:
                for client in clients:client.dispose()
                self.stop_workers(root,port)

    def test_reuse_only_cold_cache_requires_maintenance_without_uploading_or_starting_worker(self):
        with tempfile.TemporaryDirectory(prefix='studio-v2-reuse-cold-owned-') as home:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
            hello, source, packed, _, _ = bundle(port); hello['reuse_only'] = True
            root = Path(home) / '.local/state/gpu-sampling-studio/ssh-services' / hello['profile_id']
            guard = Path(home) / 'daily-guard.txt'
            client = Client(home, hello, source, packed, reuse_guard(guard))
            try:
                error = client.start(); self.assertEqual(error[2]['code'], 'maintenance_required')
                self.assertEqual(error[2]['phase'], 'checking_cache')
                self.assertEqual(client.read(), ('EXITED', '-', {'reason': 'failed'})); client.finish()
                self.assertEqual([kind for kind, _ in client.uploads], ['TRANSPORT_END'])
                self.assertFalse(any(kind == 'WORKER_NEEDED' for kind, _ in client.receipts))
                self.assertFalse(root.exists()); self.assertEqual(self.owned_workers(root, port), [])
                self.assertEqual(guard.read_text(), 'active\n')
            finally:
                client.dispose(); self.stop_workers(root, port)

    def test_reuse_only_dead_daemon_requires_maintenance_without_restarting_or_rewriting_cache(self):
        with tempfile.TemporaryDirectory(prefix='studio-v2-reuse-dead-owned-') as home:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
            hello, source, packed, _, _ = bundle(port)
            root = Path(home) / '.local/state/gpu-sampling-studio/ssh-services' / hello['profile_id']
            setup = Client(home, hello, source, packed); daily = None
            try:
                self.assertIsInstance(setup.start(), dict); setup.stop()
                self.assertEqual(len(self.owned_workers(root, port)), 1)
                self.stop_workers(root, port)
                before_cache = cache_evidence(root)
                guard = Path(home) / 'daily-guard.txt'
                daily = Client(home, {**hello, 'reuse_only': True}, source, packed, reuse_guard(guard))
                error = daily.start(); self.assertEqual(error[2]['code'], 'maintenance_required')
                self.assertEqual(error[2]['phase'], 'checking_health')
                self.assertEqual(daily.read(), ('EXITED', '-', {'reason': 'failed'})); daily.finish()
                self.assertEqual(daily.uploads, [])
                self.assertFalse(any(kind == 'WORKER_NEEDED' for kind, _ in daily.receipts))
                self.assertEqual(guard.read_text(), 'active\n')
                self.assertEqual(cache_evidence(root), before_cache)
                self.assertEqual(self.owned_workers(root, port), [])
            finally:
                setup.dispose()
                if daily: daily.dispose()
                self.stop_workers(root, port)

    def test_handoff_starts_only_verified_cached_worker_without_upload_or_runtime_changes(self):
        with tempfile.TemporaryDirectory(prefix='studio-v2-handoff-owned-') as home:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
            hello, source, packed, _, _ = bundle(port)
            root = Path(home) / '.local/state/gpu-sampling-studio/ssh-services' / hello['profile_id']
            clients = []
            try:
                setup = Client(home, hello, source, packed); clients.append(setup)
                health = setup.start(); setup.stop()
                before_cache = cache_evidence(root)
                before_workers = self.owned_workers(root, port)
                live = Client(home, {**hello, 'reuse_only': True, 'start_cached': True}, source, packed); clients.append(live)
                self.assertEqual(live.start(), health)
                self.assertEqual(live.uploads, [])
                self.assertEqual(self.owned_workers(root, port), before_workers)
                live.stop(); self.stop_workers(root, port)
                self.assertEqual(self.owned_workers(root, port), [])
                restarted = Client(home, {**hello, 'reuse_only': True, 'start_cached': True}, source, packed); clients.append(restarted)
                self.assertEqual(restarted.start(), health)
                self.assertEqual(restarted.uploads, [])
                self.assertEqual(cache_evidence(root), before_cache)
                self.assertEqual(len(self.owned_workers(root, port)), 1)
                self.assertEqual(restarted.request('/api/health')['status'], 200)
                restarted.stop()
            finally:
                for client in clients: client.dispose()
                self.stop_workers(root, port)

    def test_cached_start_flag_requires_reuse_mode(self):
        with tempfile.TemporaryDirectory(prefix='studio-v2-invalid-start-owned-') as home:
            hello, source, packed, _, _ = bundle(); hello['start_cached'] = True
            client = Client(home, hello, source, packed)
            try:
                self.assertEqual(client.start()[2]['code'], 'invalid_hello')
                self.assertEqual(client.uploads, [])
                self.assertEqual(client.read(), ('EXITED', '-', {'reason': 'failed'})); client.finish()
            finally: client.dispose()

    def test_cached_helper_is_never_executed_without_its_full_hash(self):
        hello, source, packed, _, _ = bundle()
        with tempfile.TemporaryDirectory(prefix='studio-v2-owned-') as home:
            folder = Path(home) / '.local/state/gpu-sampling-studio/ssh-transport-v2' / hello['transport_sha256']
            folder.mkdir(parents=True, mode=0o700)
            (folder / 'bridge.py').write_bytes(b'print("MUST_NOT_EXECUTE")'.ljust(len(source), b' '))
            client = Client(home, hello, source, packed)
            try:
                error = client.start(); self.assertEqual(error[2]['code'], 'transport_cache_invalid')
                self.assertEqual(client.read(), ('EXITED', '-', {'reason': 'failed'})); client.finish()
                self.assertNotIn(b'MUST_NOT_EXECUTE', b''.join(client.wire))
            finally: client.dispose()

    def test_corrupted_existing_worker_is_refused_without_overwrite_or_upload(self):
        hello, _, _, payload, files = bundle()
        legacy = bridge.legacy_transport(files)
        with tempfile.TemporaryDirectory(prefix='studio-v2-owned-') as home, patch.dict(os.environ, HOME=home):
            root, runtime = legacy['stage_runtime'](payload, files)
            item = runtime / 'bootstrap.py'; item.chmod(0o600); item.write_bytes(b'PRESERVE_CORRUPT_FIXTURE')
            with self.assertRaises(bridge.Failure) as observed:
                bridge.cached_files(hello, root)
            self.assertEqual(observed.exception.code, 'worker_cache_invalid')
            self.assertEqual(item.read_bytes(), b'PRESERVE_CORRUPT_FIXTURE')

    def test_gzip_bomb_trailing_stream_and_wrong_manifest_are_bounded_before_staging(self):
        hello, _, _, payload, _ = bundle()
        for raw, packed, declared in [(b'x' * 1000000, gzip.compress(b'x' * 1000000), 32),
                                      (b'{}', gzip.compress(b'{}') + gzip.compress(b'{}'), 2)]:
            h = {**hello, 'worker_size': declared, 'worker_sha256': hashlib.sha256(raw[:declared]).hexdigest(),
                 'worker_gzip_size': len(packed), 'worker_gzip_sha256': hashlib.sha256(packed).hexdigest()}
            replies = iter([('INSTALL', str(i), {'chunk': base64.b64encode(packed[a:a + 2048]).decode()})
                            for i, a in enumerate(range(0, len(packed), 2048))] +
                           [('INSTALL_END', '-', {'encoding': 'gzip', 'size': len(packed), 'sha256': h['worker_gzip_sha256'],
                                                  'uncompressed_size': declared, 'uncompressed_sha256': h['worker_sha256']})])
            with self.assertRaises(bridge.Failure) as observed: bridge.receive_bundle(h, lambda: next(replies), lambda *_: None)
            self.assertEqual(observed.exception.code, 'worker_hash_mismatch')
        bad = copy.deepcopy(payload); bad['files'][0]['path'] = '../outside.py'
        with self.assertRaises(bridge.Failure): bridge.validate_manifest(bad, hello)

    def test_unsupported_python_and_missing_sqlite_end_with_fixed_safe_error_then_exit(self):
        hello, source, packed, _, _ = bundle()
        for prefix, code in [('import pathlib,sys;sys.version_info=(3,8,99)\n', 'python_unsupported'),
                             ('import sys;sys.modules["sqlite3"]=None\n', 'sqlite_unavailable')]:
            with tempfile.TemporaryDirectory(prefix='studio-v2-owned-') as home:
                client = Client(home, hello, source, packed, prefix)
                try:
                    observed = client.read(); self.assertEqual(observed[0], 'ERROR'); self.assertEqual(observed[2]['code'], code)
                    self.assertEqual(observed[2]['phase'], 'waiting_python')
                    self.assertEqual(client.read(), ('EXITED', '-', {'reason': 'failed'})); client.finish()
                    self.assertFalse((Path(home) / '.local').exists())
                finally: client.dispose()

    def test_known_os_failure_has_no_exception_text_secret_or_traceback_and_final_exit(self):
        hello, _, packed, _, _ = bundle()
        source = b'import errno\ndef run(*args):raise OSError(errno.ENOSPC,"SECRET-CREDENTIAL /private/path")\n'
        h = {**hello, 'transport_size': len(source), 'transport_sha256': hashlib.sha256(source).hexdigest()}
        with tempfile.TemporaryDirectory(prefix='studio-v2-owned-') as home:
            client = Client(home, h, source, packed)
            try:
                observed = client.start(); self.assertEqual(observed[2]['code'], 'storage_unavailable')
                self.assertEqual(observed[2]['errno'], 28)
                self.assertEqual(client.read(), ('EXITED', '-', {'reason': 'failed'})); client.finish()
                exposed = json.dumps([decode(line) for line in client.wire])
                self.assertNotIn('SECRET', exposed); self.assertNotIn('/private/path', exposed)
            finally: client.dispose()

    def test_writable_home_is_not_chmodded_or_accepted(self):
        hello, source, packed, _, _ = bundle()
        with tempfile.TemporaryDirectory(prefix='studio-v2-owned-') as home:
            os.chmod(home, 0o770); client = Client(home, hello, source, packed)
            try:
                observed = client.start(); self.assertEqual(observed[2]['code'], 'namespace_unsafe')
                self.assertEqual(client.read(), ('EXITED', '-', {'reason': 'failed'})); client.finish()
                self.assertEqual(os.stat(home).st_mode & 0o777, 0o770)
            finally: client.dispose()

    def test_wrong_socket_owner_still_receives_zero_authentication_bytes(self):
        hello, _, _, _, files = bundle(); legacy = bridge.legacy_transport(files)
        with tempfile.TemporaryDirectory(prefix='studio-v2-owned-') as home, socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); listener.listen(1); observed = []
            def accept():
                conn, _ = listener.accept()
                with conn: observed.append(conn.recv(4096))
            thread = threading.Thread(target=accept); thread.start()
            with self.assertRaises(bridge.Failure) as error:
                bridge.forward(legacy, Path(home), listener.getsockname()[1], {'method': 'GET', 'target': '/api/health'})
            thread.join(3); self.assertEqual(observed, [b'']); self.assertEqual(error.exception.code, 'worker_identity_unavailable')

    def test_tty_preflight_failure_and_cancel_restore_echo_before_final_control(self):
        import pty, termios
        for prefix, action in [('import pathlib,sys;sys.version_info=(3,8,99)\n', None), ('', 'cancel')]:
            with tempfile.TemporaryDirectory(prefix='studio-v2-owned-') as home:
                master, slave = pty.openpty(); original = termios.tcgetattr(slave)
                child = subprocess.Popen([sys.executable, '-I', '-u', '-c', prefix + (TRANSPORT / 'bootstrap.py').read_text(), NONCE],
                                         stdin=slave, stdout=slave, stderr=subprocess.PIPE, env={**os.environ, 'HOME': home})
                try:
                    output = bytearray()
                    while child.poll() is None:
                        if select.select([master], [], [], 3)[0]:
                            output.extend(os.read(master, 65536))
                            if action and b':BOOTSTRAP_READY:' in output:
                                os.write(master, frame('STOP', 'owned-cancel', {})); action = None
                        elif child.poll() is None: self.fail('Owned TTY preflight timed out')
                    child.wait(timeout=3)
                    while select.select([master], [], [], .1)[0]: output.extend(os.read(master, 65536))
                    self.assertEqual(termios.tcgetattr(slave), original)
                    cleared = b'\x1b[2J\x1b[3J\x1b[H'
                    self.assertTrue(bytes(output).startswith(cleared))
                    lines = [decode(line + b'\n') for line in bytes(output)[len(cleared):].splitlines() if line]
                    self.assertIn(lines[-1][0], ('EXITED', 'STOPPED')); self.assertEqual(child.stderr.read(), b'')
                finally:
                    if child.poll() is None: child.kill(); child.wait(timeout=3)
                    child.stderr.close(); os.close(master); os.close(slave)

    def assert_tty_reuse_stop(self, home, hello):
        import pty, termios
        master, slave = pty.openpty(); original = termios.tcgetattr(slave)
        guard = Path(home) / 'tty-daily-guard.txt'
        child = subprocess.Popen([sys.executable, '-I', '-u', '-c', reuse_guard(guard) +
                                 (TRANSPORT / 'bootstrap.py').read_text(), NONCE],
                                 stdin=slave, stdout=slave, stderr=subprocess.PIPE,
                                 env={**os.environ, 'HOME': str(home), 'PYTHONDONTWRITEBYTECODE': '1'})
        pending = bytearray(); cleared = b'\x1b[2J\x1b[3J\x1b[H'
        def read():
            deadline = time.monotonic() + 35
            while b'\n' not in pending:
                remaining = deadline - time.monotonic()
                self.assertGreater(remaining, 0, 'Owned reuse TTY timed out')
                if select.select([master], [], [], remaining)[0]: pending.extend(os.read(master, 65536))
            line, _, rest = pending.partition(b'\n'); pending[:] = rest
            return decode(line.removeprefix(cleared) + b'\n')
        try:
            self.assertEqual(read()[0], 'BOOTSTRAP_READY')
            os.write(master, frame('HELLO', '-', hello)); fragments = bytearray()
            while True:
                kind, _, value = read()
                self.assertNotIn(kind, ('TRANSPORT_NEEDED', 'WORKER_NEEDED', 'ERROR'))
                if kind == 'FRAGMENT':
                    self.assertEqual(value['kind'], 'READY'); fragments.extend(base64.b64decode(value['chunk']))
                    if value['last']: break
            self.assertEqual(json.loads(fragments)['runtime_id'], hello['expected_runtime_id'])
            self.assertNotEqual(termios.tcgetattr(slave), original)
            os.write(master, frame('STOP', 'owned-tty-stop', {}))
            self.assertEqual(read(), ('STOPPED', 'owned-tty-stop', {})); child.wait(timeout=5)
            self.assertEqual(termios.tcgetattr(slave), original)
            self.assertEqual(child.stderr.read(), b''); self.assertEqual(guard.read_text(), 'active\n')
            self.assertEqual(pending, b'')
            # The restored line discipline accepts and echoes ordinary terminal
            # input after STOP; no service protocol or shell is replayed.
            os.write(master, b'OWNED_TERMINAL_INPUT_RESTORED\n')
            self.assertTrue(select.select([master], [], [], 3)[0])
            self.assertIn(b'OWNED_TERMINAL_INPUT_RESTORED', os.read(master, 4096))
        finally:
            if child.poll() is None: child.kill(); child.wait(timeout=5)
            child.stderr.close(); os.close(master); os.close(slave)

    @staticmethod
    def owned_workers(root, port):
        owned = []
        for proc in Path('/proc').iterdir():
            if not proc.name.isdigit(): continue
            try:
                argv = (proc / 'cmdline').read_bytes().decode().rstrip('\0').split('\0')
                if proc.stat().st_uid == os.getuid() and len(argv) == 7 and argv[1:] == ['-m', 'studio_worker.server', '--root', str(root), '--port', str(port)]:
                    owned.append((proc, (proc / 'stat').read_text().rsplit(')', 1)[1].split()[19]))
            except (OSError, ValueError, UnicodeError): pass
        return owned

    @classmethod
    def stop_workers(cls, root, port):
        for proc, start in cls.owned_workers(root, port):
            if proc.stat().st_uid == os.getuid() and (proc / 'stat').read_text().rsplit(')', 1)[1].split()[19] == start:
                os.kill(int(proc.name), signal.SIGTERM)
        deadline = time.monotonic() + 5
        while cls.owned_workers(root, port) and time.monotonic() < deadline: time.sleep(.05)
        assert not cls.owned_workers(root, port), 'Owned fixture worker cleanup failed'


if __name__ == '__main__':
    unittest.main(verbosity=2)
