"""Bootstrap health ownership tests; no bootstrap/start or real worker is run."""
import ast
import http.client
import http.server
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import time
import traceback
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


BOOTSTRAP = Path(__file__).resolve().parents[1] / 'bootstrap.py'
BODY_LIMIT = 1024 * 1024
PRIVATE = 'SYNTHETIC_PRIVATE_BOOTSTRAP_DETAIL'
TOKENS = {'admin': 'synthetic-owned-admin', 'mcp': 'synthetic-owned-mcp'}


def bootstrap_definitions():
    """Execute actual production definitions, never its launch-time statements."""
    source = ast.parse(BOOTSTRAP.read_text(encoding='utf8'), filename=str(BOOTSTRAP))
    names = {'BootstrapIdentityError', '_process_record', 'owns_stream',
             'verified_connection', '_close_owned_socket', 'health'}
    nodes, found = [], set()
    for node in source.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            nodes.append(node)
        elif isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names:
            nodes.append(node)
            found.add(node.name)
        elif isinstance(node, ast.Assign) and all(isinstance(t, ast.Name) and t.id.isupper() for t in node.targets):
            try:
                ast.literal_eval(node.value)
            except (ValueError, TypeError):
                continue
            nodes.append(node)
    if found != names:
        raise AssertionError('The frozen production bootstrap health definitions are incomplete')
    module = ModuleType('bootstrap_health_under_test')
    module.__file__ = str(BOOTSTRAP)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(BOOTSTRAP), 'exec'), module.__dict__)
    return module


class Descriptor:
    """A real test-owned file with a count at the credential-read boundary."""
    def __init__(self, path):
        self.path, self.reads, self.read_requests, self.bytes_read = Path(path), 0, [], 0
        self.path.write_text(json.dumps(TOKENS), encoding='utf8')

    def exists(self):
        return self.path.exists()

    def is_file(self):
        return self.path.is_file()

    def is_symlink(self):
        return self.path.is_symlink()

    def read_text(self, *args, **kwargs):
        self.reads += 1
        return self.path.read_text(*args, **kwargs)

    def read_bytes(self):
        self.reads += 1
        return self.path.read_bytes()

    def open(self, *args, **kwargs):
        self.reads += 1
        stream = self.path.open(*args, **kwargs)
        descriptor = self

        class ObservedRead:
            def __enter__(self):
                return self

            def read(self, amount=None):
                descriptor.read_requests.append(amount)
                value = stream.read(amount)
                descriptor.bytes_read += len(value)
                return value

            def __exit__(self, *_args):
                stream.close()

        return ObservedRead()


class Reply:
    def __init__(self, body, status=200):
        self.body, self.status, self.requests, self.position = body, status, [], 0

    def read(self, amount=None):
        self.requests.append(amount)
        if amount is None:
            data = self.body[self.position:]
        else:
            data = self.body[self.position:self.position + amount]
        self.position += len(data)
        return data


class OwnedConnection:
    def __init__(self, reply, request_error=None):
        self.reply, self.request_error = reply, request_error
        self.requests, self.closed, self.sock = [], False, SocketProbe()

    def request(self, method, target, *args, **kwargs):
        if self.request_error:
            raise self.request_error
        self.requests.append((method, target, args, kwargs))

    def getresponse(self):
        return self.reply

    def close(self):
        self.closed = True
        self.sock.close()


class SocketProbe:
    def __init__(self):
        self.timeout, self.closed, self.sent, self.shutdowns = None, False, [], []

    def settimeout(self, timeout):
        self.timeout = timeout

    def close(self):
        self.closed = True

    def sendall(self, data):
        self.sent.append(data)

    def shutdown(self, how):
        self.shutdowns.append(how)

    def getpeername(self):
        return ('127.0.0.1', 12345)

    def getsockname(self):
        return ('127.0.0.1', 40000)


class ForeignHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.server.http_requests.append(self.path)
        self.server.authorization.append(self.headers.get('Authorization'))
        body = json.dumps(self.server.claimed_health).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.server.slow:
            for value in body:
                if self.server.stop_response.is_set():
                    break
                try:
                    self.wfile.write(bytes([value]))
                    self.wfile.flush()
                except OSError:
                    break
                self.server.stop_response.wait(.25)
        else:
            self.wfile.write(body)


class ForeignServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def __init__(self, health, slow=False):
        self.claimed_health, self.http_requests, self.authorization = health, [], []
        self.slow, self.stop_response = slow, threading.Event()
        self.accepted = threading.Event()
        super().__init__(('127.0.0.1', 0), ForeignHandler)

    def get_request(self):
        stream, address = super().get_request()
        stream.settimeout(2)
        self.accepted.set()
        return stream, address


class BootstrapHealth(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='studio-bootstrap-unit-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.descriptor = Descriptor(self.root / 'connection.json')
        self.bootstrap = bootstrap_definitions()
        self.bootstrap.root = self.root
        self.bootstrap.connection = self.descriptor
        self.bootstrap.args = SimpleNamespace(port=12345)

    def report(self, **changes):
        return {'name': 'gpu-sampling-studio', 'root': str(self.root),
                'runtime': '/synthetic/previous-runtime', 'execution_policy': 'desktop-review-v1', **changes}

    def owned(self, body=None, status=200, request_error=None):
        if body is None:
            body = json.dumps(self.report()).encode()
        value = OwnedConnection(Reply(body, status), request_error)
        seen = []

        def verified(root, port, *args, **kwargs):
            self.assertEqual(self.descriptor.reads, 0, 'Credentials were read before ownership proof')
            seen.append((root, port))
            return value

        context = patch.object(self.bootstrap, 'verified_connection', side_effect=verified)
        context.start()
        self.addCleanup(context.stop)
        return value, seen

    def assert_identity_failure(self):
        try:
            self.bootstrap.health()
        except self.bootstrap.BootstrapIdentityError as error:
            rendered = ''.join(traceback.format_exception(error))
            for secret in (PRIVATE, *TOKENS.values()):
                self.assertNotIn(secret, str(error))
                self.assertNotIn(secret, rendered)
            return error
        self.fail('An unverified identity must raise the fixed bootstrap error')

    def test_missing_descriptor_returns_none_without_connecting_or_reading_tokens(self):
        self.descriptor.path.unlink()
        with patch.object(self.bootstrap, 'verified_connection', side_effect=AssertionError('No probe required')) as connect:
            self.assertIsNone(self.bootstrap.health())
        connect.assert_not_called()
        self.assertEqual(self.descriptor.reads, 0)

    def test_free_candidate_port_returns_none_without_reading_tokens(self):
        # Reserving without listen prevents another process from taking the port
        # while the real loopback connect observes connection refusal.
        with socket.socket() as reserved:
            reserved.bind(('127.0.0.1', 0))
            self.bootstrap.args.port = reserved.getsockname()[1]
            self.assertIsNone(self.bootstrap.health())
        self.assertEqual(self.descriptor.reads, 0)

    @unittest.skipUnless(os.name == 'posix' and Path('/proc').is_dir(), 'Linux process/socket ownership required')
    def test_real_foreign_listener_matching_health_claim_receives_no_http_or_credentials(self):
        server = ForeignServer(self.report())
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .05}, daemon=True)
        thread.start()
        self.bootstrap.args.port = server.server_address[1]
        try:
            self.assert_identity_failure()
            self.assertTrue(server.accepted.wait(1), 'The owned foreign listener was not contacted')
            self.assertEqual(self.descriptor.reads, 0)
            self.assertEqual(server.http_requests, [])
            self.assertEqual(server.authorization, [])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)
        self.assertFalse(thread.is_alive())

    def test_owned_injected_connection_preserves_old_runtime_upgrade_shape(self):
        connection, seen = self.owned()
        result = self.bootstrap.health()
        self.assertEqual(seen, [(self.root, self.bootstrap.args.port)])
        self.assertEqual(self.descriptor.reads, 1)
        self.assertEqual(result, {'url': 'http://127.0.0.1:12345', 'tokens': TOKENS, 'health': self.report()})
        self.assertEqual(result['health']['runtime'], '/synthetic/previous-runtime')
        self.assertEqual(len(connection.requests), 1)
        method, target, _args, options = connection.requests[0]
        self.assertEqual((method, target), ('GET', '/api/health'))
        self.assertEqual(options['headers']['Authorization'], 'Bearer ' + TOKENS['admin'])
        self.assertTrue(connection.closed)

    def test_verified_connection_pins_one_socket_and_disables_automatic_reconnect(self):
        stream = SocketProbe()
        with patch.object(self.bootstrap.socket, 'create_connection', return_value=stream) as create, \
                patch.object(self.bootstrap, 'owns_stream', return_value=True) as owns:
            connection = self.bootstrap.verified_connection(self.root, 12345)
        self.addCleanup(connection.close)
        create.assert_called_once()
        self.assertEqual(create.call_args.args[0], ('127.0.0.1', 12345))
        owns.assert_called_once_with(self.root, 12345, stream)
        self.assertIs(connection.sock, stream)
        self.assertEqual(connection.auto_open, 0)
        self.assertEqual(self.descriptor.reads, 0)

    def test_owner_close_after_proof_cannot_reconnect_to_a_replacement_listener(self):
        stream = SocketProbe()
        with patch.object(self.bootstrap.socket, 'create_connection', return_value=stream) as create, \
                patch.object(self.bootstrap, 'owns_stream', return_value=True):
            fixed = self.bootstrap.verified_connection(self.root, 12345)
        stream.close()
        fixed.sock = None  # A listener can now be replaced, but this socket is gone.
        with patch.object(self.bootstrap, 'verified_connection', return_value=fixed), \
                patch.object(http.client.HTTPConnection, 'connect', side_effect=AssertionError(PRIVATE)) as reconnect:
            self.assert_identity_failure()
        create.assert_called_once()
        reconnect.assert_not_called()
        self.assertEqual(stream.sent, [])

    def test_http_failure_is_fixed_sanitized_and_closes_the_verified_connection(self):
        connection, _seen = self.owned(body=PRIVATE.encode(), status=401)
        self.assert_identity_failure()
        self.assertTrue(connection.closed)
        self.assertEqual(len(connection.requests), 1)

    def test_malformed_or_wrong_identity_health_is_fixed_and_sanitized(self):
        bodies = [PRIVATE.encode(), b'[]', b'null',
                  json.dumps(self.report(name=PRIVATE)).encode(),
                  json.dumps(self.report(root=PRIVATE)).encode()]
        for body in bodies:
            with self.subTest(kind=body[:20]):
                self.descriptor.reads = 0
                connection, _seen = self.owned(body=body)
                self.assert_identity_failure()
                self.assertTrue(connection.closed)

    def test_oversized_valid_json_and_whitespace_cannot_pass_or_be_read_unbounded(self):
        prefix = json.dumps(self.report(private=PRIVATE)).encode()
        body = prefix + b' ' * (BODY_LIMIT + 1 - len(prefix))
        connection, _seen = self.owned(body=body)
        self.assert_identity_failure()
        self.assertTrue(connection.closed)
        self.assertTrue(connection.reply.requests)
        self.assertTrue(all(type(n) is int and 0 < n <= BODY_LIMIT + 1 for n in connection.reply.requests))
        self.assertLessEqual(connection.reply.position, BODY_LIMIT + 1)

    def test_postproof_io_error_does_not_leak_private_details_or_retry(self):
        connection, seen = self.owned(request_error=OSError(PRIVATE))
        self.assert_identity_failure()
        self.assertEqual(len(seen), 1)
        self.assertTrue(connection.closed)

    def test_late_connection_refusal_after_ownership_proof_never_permits_startup(self):
        connection, seen = self.owned(request_error=ConnectionRefusedError(PRIVATE))
        self.assert_identity_failure()
        self.assertEqual(len(seen), 1)
        self.assertTrue(connection.closed)

    def test_malformed_descriptor_shapes_fail_before_any_authorization_request(self):
        for tokens in ([], None, {'admin': '', 'mcp': 'fixture'},
                       {'admin': PRIVATE, 'mcp': 7}):
            with self.subTest(kind=type(tokens).__name__):
                self.descriptor.reads = 0
                self.descriptor.path.write_text(json.dumps(tokens), encoding='utf8')
                connection, _seen = self.owned()
                self.assert_identity_failure()
                self.assertEqual(connection.requests, [])
                self.assertTrue(connection.closed)

    def test_descriptor_limit_is_enforced_before_json_and_authorization(self):
        prefix = json.dumps({**TOKENS, 'private': PRIVATE}).encode()
        self.descriptor.path.write_bytes(prefix + b' ' * (65537 - len(prefix)))
        connection, _seen = self.owned()
        self.assert_identity_failure()
        self.assertEqual(connection.requests, [])
        self.assertTrue(self.descriptor.read_requests)
        self.assertTrue(all(type(n) is int and 0 < n <= 65537 for n in self.descriptor.read_requests))
        self.assertLessEqual(self.descriptor.bytes_read, 65537)
        self.assertTrue(connection.closed)

    def test_deeply_nested_bounded_descriptor_and_health_fail_with_fixed_identity_error(self):
        # Both payloads fit their byte limits but exceed the JSON decoder's
        # nesting depth. They must not escape as an untyped decoder exception.
        nested = b'[' * 1500 + b'0' + b']' * 1500
        for location in ('descriptor', 'health'):
            with self.subTest(location=location):
                self.descriptor.reads = 0
                self.descriptor.path.write_text(json.dumps(TOKENS), encoding='utf8')
                connection, _seen = self.owned(body=nested if location == 'health' else None)
                if location == 'descriptor':
                    self.descriptor.path.write_bytes(nested)
                self.assert_identity_failure()
                self.assertTrue(connection.closed)

    def test_injected_owner_real_slow_loopback_response_has_a_hard_read_deadline(self):
        # This is a generic test listener with injected ownership, not a worker.
        # Bytes arrive faster than the inactivity timeout, requiring the hard
        # deadline on the one already-verified socket to stop the read.
        server = ForeignServer(self.report(), slow=True)
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .05}, daemon=True)
        thread.start()
        self.bootstrap.args.port = server.server_address[1]
        started = time.monotonic()
        try:
            with patch.object(self.bootstrap, 'owns_stream', return_value=True):
                self.assert_identity_failure()
            self.assertLess(time.monotonic() - started, 4)
            self.assertEqual(self.descriptor.reads, 1)
            self.assertEqual(server.http_requests, ['/api/health'])
        finally:
            server.stop_response.set()
            server.shutdown()
            server.server_close()
            thread.join(2)
        self.assertFalse(thread.is_alive())

    def process_fixture(self):
        """Synthetic proc tree, not a process or a real worker identity."""
        proc = self.root / 'proc'
        process = proc / '424242'
        (process / 'fd').mkdir(parents=True)
        (proc / 'net').mkdir()
        argv = ['/synthetic/python', '-m', 'studio_worker.server',
                '--root', str(self.root), '--port', '12345']
        (process / 'cmdline').write_bytes(('\0'.join(argv) + '\0').encode())
        (process / 'stat').write_text('424242 (synthetic server) ' +
                                     ' '.join(['S'] + ['0'] * 18 + ['111']))
        tcp = proc / 'net/tcp'
        tcp.write_text('header\n0: 0100007F:3039 0100007F:9C40 01 0 0 0 ' +
                       str(os.getuid()) + ' 0 7654321\n')
        descriptor = process / 'fd/9'
        descriptor.symlink_to('socket:[7654321]')

        def mapped(value):
            if str(value) == '/proc':
                return proc
            if str(value) == '/proc/net/tcp':
                return tcp
            return Path(value)

        context = patch.object(self.bootstrap, 'Path', side_effect=mapped)
        context.start()
        delay = patch.object(self.bootstrap.time, 'sleep', return_value=None)
        delay.start()

        def cleanup():
            delay.stop()
            context.stop()

        return process, argv, tcp, descriptor, cleanup

    @unittest.skipUnless(os.name == 'posix', 'Linux UID ownership required')
    def test_actual_ownership_proof_accepts_exact_inert_argv_start_uid_and_stream_inode(self):
        _process, _argv, _tcp, _descriptor, cleanup = self.process_fixture()
        self.addCleanup(cleanup)
        self.assertTrue(self.bootstrap.owns_stream(self.root, 12345, SocketProbe()))
        self.assertEqual(self.descriptor.reads, 0)

    @unittest.skipUnless(os.name == 'posix', 'Linux UID ownership required')
    def test_actual_ownership_proof_refuses_wrong_argv_uid_peer_inode_and_reused_start(self):
        for changed in ('extra-argv', 'root', 'port', 'uid', 'peer', 'inode', 'start'):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory(dir=self.root) as folder:
                # Give each subcase a fresh synthetic process tree. Stop its local
                # patches before preparing the next one, without changing /proc.
                old_root = self.root
                self.root = Path(folder)
                process, argv, tcp, descriptor, cleanup = self.process_fixture()
                try:
                    if changed == 'extra-argv':
                        argv.append('--unexpected')
                    elif changed == 'root':
                        argv[4] = '/synthetic/other-root'
                    elif changed == 'port':
                        argv[-1] = '12346'
                    (process / 'cmdline').write_bytes(('\0'.join(argv) + '\0').encode())
                    if changed == 'peer':
                        tcp.write_text(tcp.read_text().replace('9C40', '9C41'))
                    if changed == 'inode':
                        descriptor.unlink()
                        descriptor.symlink_to('socket:[9999999]')
                    if changed == 'uid':
                        real_uid = os.getuid()
                        with patch.object(self.bootstrap.os, 'getuid', return_value=real_uid + 1):
                            self.assertFalse(self.bootstrap.owns_stream(self.root, 12345, SocketProbe()))
                    elif changed == 'start':
                        original, calls = self.bootstrap._process_record, []

                        def replaced(value):
                            if calls:
                                (process / 'stat').write_text('424242 (synthetic server) ' +
                                                            ' '.join(['S'] + ['0'] * 18 + ['222']))
                            calls.append(value)
                            return original(value)

                        with patch.object(self.bootstrap, '_process_record', side_effect=replaced):
                            self.assertFalse(self.bootstrap.owns_stream(self.root, 12345, SocketProbe()))
                        self.assertGreaterEqual(len(calls), 2)
                    else:
                        self.assertFalse(self.bootstrap.owns_stream(self.root, 12345, SocketProbe()))
                finally:
                    cleanup()
                    self.root = old_root


if __name__ == '__main__':
    unittest.main()
