"""Owned local Linux service/fake-scheduler fixtures; no SSH or scientific jobs."""
import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shlex
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE))
import ssh_service_bridge as bridge
from runtime_resources import worker_files, runtime_identity


def payload():
    names = worker_files(SOURCE)
    return {'schema_version': 1, 'profile_id': 'owned-fixture', 'port': 23456,
            'expected_runtime_id': runtime_identity(SOURCE, names),
            'files': [{'path': name, 'sha256': hashlib.sha256((SOURCE / name).read_bytes()).hexdigest(),
                       'base64': base64.b64encode((SOURCE / name).read_bytes()).decode()} for name in names]}


@unittest.skipUnless(os.name == 'posix', 'Linux worker identity contract')
class ManifestTests(unittest.TestCase):
    def test_actual_small_loader_acknowledges_chunks_and_refuses_bad_final_digest(self):
        nonce = 'b' * 64
        code = b"import sys;sys.stdout.write('OWNED_LOADER_FIXTURE\\n');sys.stdout.flush()"
        value = {'files': [{'path': 'ssh_service_bridge.py', 'base64': base64.b64encode(code).decode(), 'sha256': hashlib.sha256(code).hexdigest()}], 'padding': 'x' * 5000}
        raw = json.dumps(value).encode()
        def frame(kind, identifier, content):
            return (bridge.PREFIX + nonce + ':' + kind + ':' + str(identifier) + ':' + base64.b64encode(json.dumps(content).encode()).decode() + '\n').encode()
        chunks = [raw[at:at + 2048] for at in range(0, len(raw), 2048)]
        packets = b''.join(frame('INSTALL', index, {'chunk': base64.b64encode(chunk).decode()}) for index, chunk in enumerate(chunks))
        for valid in [True, False]:
            request = packets + frame('INSTALL_END', '-', {'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest() if valid else '0' * 64})
            result = subprocess.run([sys.executable, '-u', '-c', (SOURCE / 'ssh_service_bootstrap.py').read_text(), nonce], input=request, capture_output=True, timeout=5)
            lines = result.stdout.decode().splitlines(); self.assertIn(':BOOTSTRAP_READY:-:', lines[0])
            self.assertEqual(sum(':ACK:' in line for line in lines), len(chunks))
            self.assertEqual('OWNED_LOADER_FIXTURE' in lines, valid)
            self.assertEqual(any(':ERROR:' in line for line in lines), not valid)
            self.assertEqual(result.stderr, b'')
        result = subprocess.run([sys.executable, '-u', '-c', (SOURCE / 'ssh_service_bootstrap.py').read_text(), nonce],
                                input=frame('STOP', 'cancel', {}), capture_output=True, timeout=5)
        self.assertIn(':STOPPED:cancel:', result.stdout.decode())
        self.assertNotIn('OWNED_LOADER_FIXTURE', result.stdout.decode())

    def test_stop_is_final_even_when_an_http_reply_arrives_later(self):
        nonce = 'a' * 64
        def frame(kind, identifier, value):
            return (bridge.PREFIX + nonce + ':' + kind + ':' + identifier + ':' + base64.b64encode(json.dumps(value).encode()).decode() + '\n').encode()
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()
        health = {'name': 'gpu-sampling-studio', 'root': '/owned', 'runtime': '/owned/runtime',
                  'execution_policy': 'desktop-review-v1', 'hostname': 'fixture', 'uid': os.getuid(), 'machineId': 'fixture', 'home': '/owned'}
        def forward(*_args):
            entered.set(); release.wait(2); finished.set(); return {'status': 200, 'data': {'late': True}}
        source = io.BytesIO(frame('REQUEST', 'once', {'method': 'GET', 'target': '/api/health'}) + frame('STOP', 'stop', {}))
        output = io.StringIO()
        with patch.object(bridge, 'validate_payload', return_value={}), patch.object(bridge, 'stage_runtime', return_value=(Path('/owned'), Path('/owned/runtime'))), patch.object(bridge, 'start_worker', return_value=health), patch.object(bridge, 'forward', side_effect=forward), patch('sys.stdin', SimpleNamespace(buffer=source)), patch('sys.stdout', output):
            bridge.run({'port': 23456, 'expected_runtime_id': 'a' * 20}, nonce)
            self.assertTrue(entered.wait(1)); before = output.getvalue(); release.set(); self.assertTrue(finished.wait(1)); time.sleep(.03)
            self.assertEqual(output.getvalue(), before)
            self.assertIn(':STOPPED:stop:', before.splitlines()[-1])
            self.assertNotIn(':RESPONSE:', before)

    def test_manifest_hash_namespace_and_immutable_existing_runtime(self):
        value = payload(); files = bridge.validate_payload(value)
        with tempfile.TemporaryDirectory() as folder:
            root, runtime = bridge.stage_runtime(value, files, home=folder)
            self.assertEqual(root, Path(folder) / '.local/state/gpu-sampling-studio/ssh-services/owned-fixture')
            self.assertEqual(bridge.stage_runtime(value, files, home=folder), (root, runtime))
            target = runtime / 'bootstrap.py'; target.chmod(0o600); target.write_text('changed')
            with self.assertRaises(ValueError): bridge.stage_runtime(value, files, home=folder)

    def test_invalid_manifest_fails_before_filesystem_or_process_effects(self):
        original = payload()
        mutations = [lambda p: p['files'][0].update(path='../outside.py'),
                     lambda p: p['files'].append(copy.deepcopy(p['files'][0])),
                     lambda p: p['files'][0].update(sha256='0' * 64),
                     lambda p: p.update(expected_runtime_id='0' * 20),
                     lambda p: p.update(port=True)]
        for mutate in mutations:
            value = copy.deepcopy(original); mutate(value)
            with self.assertRaises((ValueError, TypeError)): bridge.validate_payload(value)

    def test_arbitrary_root_symlinks_and_existing_unowned_namespace_refused(self):
        value = payload(); files = bridge.validate_payload(value)
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError): bridge.stage_runtime({**value, 'worker_root': '/tmp/other-worker'}, files, home=folder)
            namespace = Path(folder) / '.local/state/gpu-sampling-studio/ssh-services/owned-fixture'
            namespace.parent.mkdir(parents=True); elsewhere = Path(folder) / 'elsewhere'; elsewhere.mkdir()
            namespace.symlink_to(elsewhere, target_is_directory=True)
            with self.assertRaises(ValueError): bridge.stage_runtime(value, files, home=folder)
            namespace.unlink(); namespace.mkdir(); (namespace / 'worker.sqlite').write_text('preserve existing')
            with self.assertRaises(ValueError): bridge.stage_runtime(value, files, home=folder)
            self.assertEqual((namespace / 'worker.sqlite').read_text(), 'preserve existing')

    def test_writable_namespace_ancestor_is_refused_without_changing_permissions(self):
        value = payload(); files = bridge.validate_payload(value)
        with tempfile.TemporaryDirectory() as folder:
            parent = Path(folder) / '.local'; parent.mkdir(); parent.chmod(0o777)
            (parent / 'state/gpu-sampling-studio/ssh-services').mkdir(parents=True)
            with self.assertRaises(ValueError): bridge.stage_runtime(value, files, home=folder)
            self.assertEqual(parent.stat().st_mode & 0o777, 0o777)

    def test_unverified_listener_receives_no_authentication_bytes(self):
        with tempfile.TemporaryDirectory() as folder, socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); listener.listen(1); observed = []
            def read():
                connection, _ = listener.accept()
                with connection: observed.append(connection.recv(4096))
            thread = threading.Thread(target=read); thread.start()
            with patch.object(bridge, 'owns_stream', return_value=False):
                with self.assertRaises(ValueError): bridge.forward(Path(folder), listener.getsockname()[1], {'method': 'GET', 'target': '/api/health'})
            thread.join(2); self.assertEqual(observed, [b''])


@unittest.skipUnless(os.name == 'posix', 'Linux same-host scheduler contract')
class SameHostTests(unittest.TestCase):
    def setUp(self):
        from studio_worker.compute.service import Service
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.data = self.root / 'service'; self.data.mkdir()
        (self.data / 'ssh-service.json').write_text(json.dumps({'schema_version': 1, 'profile_id': 'fixture', 'role': 'ssh-login-service'}))
        self.environment = patch.dict(os.environ, {'STUDIO_SSH_SERVICE_ROOT': str(self.data)})
        self.environment.start(); self.service = Service(self.data, schedule=False)
        self.inputs = self.root / 'inputs'; self.inputs.mkdir(); (self.inputs / 'run.py').write_text("print('never executed scientific fixture')")
        self.registration = {'name': 'owned fake Slurm', 'scheduler': 'slurm', 'queue': 'fixture',
                             'environment': {'executables': {'python': sys.executable}},
                             'limits': {'cpus': 2, 'gpus': 0, 'memory_mb': 2048},
                             'remote_root': str(self.root / 'jobs'), 'read_roots': [str(self.inputs)]}

    def tearDown(self):
        self.service.close(); self.service.store.db.close(); self.environment.stop(); self.temp.cleanup()

    def test_admin_registration_does_not_grant_project_or_queue_authority(self):
        from studio_worker.transport.routes import dispatch
        with self.assertRaises(PermissionError): dispatch(self.service, 'POST', '/api/ssh-service/scheduler', self.registration, False)
        with self.assertRaises(ValueError): dispatch(self.service, 'POST', '/api/ssh-service/scheduler', {'name': 'incomplete'}, True)
        result = dispatch(self.service, 'POST', '/api/ssh-service/scheduler', self.registration, True)
        self.assertEqual(result['transport_kind'], 'ssh-service-local')
        self.assertEqual(self.service.store.list('project'), [])
        self.assertNotIn('service_binding', result)
        stored = self.service.store.get('cluster', result['id']); self.assertEqual(stored['ssh_client'], '/bin/false')
        changed = {**stored, 'service_binding': {**stored['service_binding'], 'machineId': 'other-machine'}}
        with self.assertRaises(PermissionError): self.service.clusters.transport(changed)

    def test_environment_provider_reflects_actual_service_without_new_authorization(self):
        before = self.service.store.list('project')
        environment = self.service.register_environment({'name': 'owned CPU authoring', 'executables': {'python': sys.executable}})
        self.assertEqual(environment['provider'], 'ssh'); self.assertEqual(self.service.store.list('project'), before)
        self.service.ssh_service_mode = False
        original = self.service.register_environment({'name': 'normal worker compatibility', 'executables': {'python': sys.executable}})
        self.assertEqual(original['provider'], 'wsl')

    def test_login_host_blocks_all_local_run_paths_before_adapter_or_state_reads(self):
        for operation, args in [('prepare', ({},)), ('validate', ('absent',)), ('submit', ('absent',)), ('resume', ('absent', {}))]:
            with self.assertRaisesRegex(PermissionError, 'Slurm/LSF'): getattr(self.service, operation)(*args)
        with patch.object(self.service, '_dispatch', create=True, side_effect=AssertionError('must not execute')):
            self.service.dispatch()
        self.assertEqual(self.service.store.runs(), [])

    def test_real_generated_slurm_control_uses_fake_scheduler_once_and_reconciles_lost_reply(self):
        from studio_worker.compute.ssh_service import scheduler_profile
        from studio_worker.compute.ssh_auth import bounded_run
        cluster = scheduler_profile(self.service, self.registration)
        project = self.service.register_project({'name': 'owned project', 'policy': {'input_roots': [str(self.inputs)], 'clusters': [cluster['id']], 'engines': ['pydyn.md']}})
        spec = {'name': 'infrastructure only', 'project_id': project['id'], 'cluster_id': cluster['id'], 'engine': 'pydyn.md',
                'inputs': {'run.py': str(self.inputs / 'run.py')}, 'parameters': {}, 'max_seconds': 30, 'idempotency_key': 'once',
                'resources': {'cpus': 1, 'gpus': 0, 'memory_mb': 1024, 'queue': 'fixture'}}
        run = self.service.clusters.prepare(spec); self.assertEqual(run['status'], 'draft')
        self.service.clusters.validate(run['id']); raw = self.service.clusters.raw(run['id'])
        fake = self.root / 'bin'; fake.mkdir(); counter = self.root / 'submit-count'
        (fake / 'sbatch').write_text('#!/bin/sh\necho once >> ' + shlex.quote(str(counter)) + '\necho 4242\n')
        (fake / 'squeue').write_text('#!/bin/sh\necho ' + shlex.quote('4242|RUNNING|' + raw['job_name']) + '\n')
        (fake / 'sacct').write_text('#!/bin/sh\nexit 0\n')
        for item in fake.iterdir(): item.chmod(0o700)
        def controlled(argv, **kwargs):
            self.assertEqual(argv[:2], ['/bin/bash', '-lc'])
            return bounded_run([*argv[:2], 'export PATH=' + shlex.quote(str(fake)) + ':$PATH; ' + argv[2]], **kwargs)
        original = self.service.clusters.transport
        class LostReply:
            def __init__(this, profile): this.actual = original(profile)
            def run(this, *args, **kwargs): this.actual.run(*args, **kwargs); raise ConnectionError('owned lost reply')
        with patch('studio_worker.compute.ssh_auth.bounded_run', side_effect=controlled):
            self.service.clusters.transport = LostReply
            observed = self.service.clusters.submit(run['id']); self.assertEqual(observed['status'], 'unknown')
            self.service.clusters.submit(run['id']); self.assertEqual(counter.read_text().splitlines(), ['once'])
            self.service.clusters.transport = original
            observed = self.service.clusters.poll(run['id'])
            self.assertEqual(observed['job_id'], '4242'); self.assertEqual(observed['status'], 'running')
            self.assertEqual(counter.read_text().splitlines(), ['once'])
        self.assertTrue((Path(raw['remote_directory']) / '.submission-receipt.json').is_file())


@unittest.skipUnless(os.name == 'posix', 'Linux owned daemon integration')
class DaemonTests(unittest.TestCase):
    def test_real_staged_worker_reuses_owned_socket_and_does_not_export_tokens(self):
        value = payload()
        with socket.socket() as reserve:
            reserve.bind(('127.0.0.1', 0)); value['port'] = reserve.getsockname()[1]
        with tempfile.TemporaryDirectory() as folder:
            root, runtime = bridge.stage_runtime(value, bridge.validate_payload(value), home=folder)
            try:
                health = bridge.start_worker(root, runtime, value['port'])
                self.assertEqual(health['worker_role'], 'ssh-login-service'); self.assertFalse(health['local_execution'])
                self.assertEqual(health['uid'], os.getuid()); self.assertEqual(health['port'], value['port'])
                self.assertNotIn('tokens', health)
                self.assertEqual(bridge.start_worker(root, runtime, value['port'])['root'], str(root))
                result = bridge.forward(root, value['port'], {'method': 'POST', 'target': '/mcp', 'mcp': True,
                    'data': {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}})
                self.assertEqual(result['status'], 200)
                names = {item['name'] for item in result['data']['result']['tools']}
                self.assertNotIn('submit_run', names); self.assertNotIn('validate_run', names)
                with self.assertRaises(ValueError): bridge.forward(root, value['port'], {'method': 'POST', 'target': '/api/projects', 'mcp': True, 'data': {}})
                refused = bridge.forward(root, value['port'], {'method': 'POST', 'target': '/api/runs/prepare', 'data': {}})
                self.assertEqual(refused['status'], 403)
            finally:
                # Only exact same-UID processes with our temporary root argv.
                for process in Path('/proc').iterdir():
                    if not process.name.isdigit(): continue
                    record = bridge.process_record(process)
                    if record and record[0] == [record[0][0], '-m', 'studio_worker.server', '--root', str(root), '--port', str(value['port'])]:
                        os.kill(int(process.name), signal.SIGTERM)


if __name__ == '__main__': unittest.main()
