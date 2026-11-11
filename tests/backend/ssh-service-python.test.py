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
                health = client.start(); self.assertEqual(health['runtime_id'], '62034ec6cfc1428aaa4d')
                context = client.request('/api/authoring/context', {'workspace_id': 'owned-compressed-fixture', 'name': 'Owned compressed transport', 'structure_paths': [], 'selected_paths': []})
                project = context['data']['project']['id']; content = 'owned harmless transport data\n' * 3000
                self.assertEqual(client.request('/api/workspace/write', {'project_id': project, 'name': 'large-fixture.txt', 'content': content})['status'], 200)
                self.assertEqual(client.request('/api/workspace/read', {'project_id': project, 'name': 'large-fixture.txt'})['data']['text'], content)
                self.assertTrue(any(decode(line)[0] == 'COMPRESSED_BEGIN' for line in client.wire))
                client.stop(); self.assertTrue(self.owned_workers(root, port))
            finally:
                client.dispose(); self.stop_workers(root, port)

    def test_current_worker_has_exactly_138_files_and_matches_frozen_manifest(self):
        self.assertEqual(len(worker_files(WORKER)), 138)
        self.assertEqual(runtime_identity(WORKER, worker_files(WORKER)), '62034ec6cfc1428aaa4d')

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
                self.assertEqual(health['runtime_id'], '62034ec6cfc1428aaa4d'); self.assertEqual(health['root'], str(root))
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
        for prefix, code in [('import pathlib,sys;sys.version_info=(3,9,99)\n', 'python_unsupported'),
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
        for prefix, action in [('import pathlib,sys;sys.version_info=(3,9,99)\n', None), ('', 'cancel')]:
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
