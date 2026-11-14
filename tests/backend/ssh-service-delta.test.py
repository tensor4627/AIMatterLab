"""Owned Linux loopback worker delta receipts; no SSH, production config, engines or jobs."""
import base64
import copy
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('transport_fixture', Path(__file__).with_name('ssh-service-python.test.py'))
f = importlib.util.module_from_spec(spec); spec.loader.exec_module(f)


def versioned(port, files=None):
    hello, source, packed, value, original = f.bundle(port)
    if files is not None:
        value['files'] = [{'path': name, 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest(),
                           'base64': base64.b64encode(content).decode()} for name, content in sorted(files.items())]
        value['expected_runtime_id'] = f.bridge.digest_files(files)[:20]
        raw = json.dumps(value, separators=(',', ':')).encode(); packed = gzip.compress(raw)
        hello.update(expected_runtime_id=value['expected_runtime_id'], worker_manifest_sha256=f.bridge.digest_files(files),
                     worker_gzip_size=len(packed), worker_gzip_sha256=hashlib.sha256(packed).hexdigest(),
                     worker_size=len(raw), worker_sha256=hashlib.sha256(raw).hexdigest())
    hello['worker_encoding'] = 'gzip-delta-v1'
    return hello, source, packed, value, files if files is not None else original


class DeltaClient(f.Client):
    def __init__(self, home, resources):
        hello, source, packed, self.value, _files = resources
        super().__init__(home, hello, source, packed)
        self.changed_paths, self.source_bytes = [], 0

    def start(self):
        assert self.read()[0] == 'BOOTSTRAP_READY'
        self.send('HELLO', '-', self.hello); fragments = bytearray(); self.receipts = []
        while True:
            kind, identifier, value = self.read(); self.receipts.append((kind, value))
            if kind == 'TRANSPORT_NEEDED':
                self.upload(self.source, 'TRANSPORT_END', {'size': len(self.source), 'sha256': self.hello['transport_sha256']})
            elif kind == 'FRAGMENT':
                assert value['index'] * 96 == len(fragments)
                fragments.extend(base64.b64decode(value['chunk']))
                if not value['last']:
                    continue
                result = json.loads(fragments); fragments = bytearray()
                if value['kind'] == 'READY':
                    return result
                assert value['kind'] == 'WORKER_NEEDED'
                available = {row['path']: row for row in result['files']}
                changes = [row for row in self.value['files'] if any(available.get(row['path'], {}).get(key) != row[key] for key in ('size', 'sha256'))]
                self.changed_paths = [row['path'] for row in changes]; self.source_bytes = sum(row['size'] for row in changes)
                manifest = [{key: content for key, content in row.items() if key != 'base64'} for row in self.value['files']]
                raw = json.dumps({**self.value, 'files': changes, 'manifest': manifest}, separators=(',', ':')).encode()
                packed = gzip.compress(raw)
                self.upload(packed, 'INSTALL_END', {'encoding': 'gzip', 'size': len(packed), 'sha256': hashlib.sha256(packed).hexdigest(),
                                                    'uncompressed_size': len(raw), 'uncompressed_sha256': hashlib.sha256(raw).hexdigest()})
            elif kind == 'ERROR':
                return kind, identifier, value


@unittest.skipUnless(f.os.name == 'posix', 'Linux process/socket identities')
class DeltaTests(unittest.TestCase):
    def test_real_files_cold_warm_single_change_add_delete_and_locations(self):
        receipts = []
        with tempfile.TemporaryDirectory(prefix='studio-delta-owned-') as directory:
            home = Path(directory)
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
            base = versioned(port); root = home / '.local/state/gpu-sampling-studio/ssh-services' / base[0]['profile_id']
            clients = []
            def connect(resources, label):
                client = DeltaClient(home, resources); clients.append(client)
                health = client.start(); self.assertIsInstance(health, dict, str(health))
                self.assertEqual(health['runtime_id'], resources[0]['expected_runtime_id'])
                self.assertEqual(health['runtime_manifest_sha256'], resources[0]['worker_manifest_sha256'])
                receipts.append({'case': label, 'sourceBytes': client.source_bytes, 'changedPaths': client.changed_paths,
                                 'transferBytes': sum(size for ending, size in client.uploads if ending == 'INSTALL_END'),
                                 'workerCached': next(value['cached'] for kind, value in client.receipts if kind == 'WORKER_READY')})
                return client, health
            try:
                cold, health = connect(base, 'cold'); self.assertEqual(set(cold.changed_paths), set(base[4])); cold.stop()
                # A real project directory is registered in this isolated worker.
                workspace = home / 'actual-project'; workspace.mkdir()
                warm, health = connect(base, 'warm')
                self.assertEqual(warm.uploads, [])
                response = warm.request('/api/projects', {'name': 'Owned delta project', 'policy': {'engines': [], 'gpus': [0],
                    'max_seconds': 60, 'max_concurrent': 1, 'input_roots': [str(workspace)], 'environments': [], 'clusters': []}})
                self.assertEqual(response['status'], 200, response)
                skill = root / 'cluster-skills/owned/v1'; skill.mkdir(parents=True); (skill / 'SKILL.md').write_text('owned fixture')
                warm.stop()
                observed, health = connect(base, 'warm-observed')
                self.assertEqual(health['locations']['loginDirectory'], str(home))
                self.assertIn(str(workspace), [row['path'] for row in health['locations']['workspaces']])
                self.assertEqual(health['locations']['skills'][0]['path'], str(skill)); observed.stop()
                files = dict(base[4]); files['pyproject.toml'] += b'\n# isolated delta receipt\n'
                f.TransportTests.stop_workers(root, port)
                changed, health = connect(versioned(port, files), 'one-change')
                self.assertEqual(changed.changed_paths, ['pyproject.toml']); self.assertEqual(changed.source_bytes, len(files['pyproject.toml'])); changed.stop()
                self.assertLess(receipts[-1]['transferBytes'], receipts[0]['transferBytes'])
                files['studio_worker/delta_owned_fixture.py'] = b'# isolated optional source\n'
                f.TransportTests.stop_workers(root, port)
                added, _ = connect(versioned(port, files), 'one-add'); self.assertEqual(added.changed_paths, ['studio_worker/delta_owned_fixture.py']); added.stop()
                del files['studio_worker/delta_owned_fixture.py']
                # Make a distinct target so deletion exercises a new immutable directory.
                files['pyproject.toml'] += b'# delete optional source\n'
                f.TransportTests.stop_workers(root, port)
                deleted, health = connect(versioned(port, files), 'delete-and-change')
                self.assertEqual(deleted.changed_paths, ['pyproject.toml'])
                self.assertFalse((Path(health['runtime']) / 'studio_worker/delta_owned_fixture.py').exists()); deleted.stop()
                self.assertTrue((root / 'runtimes' / base[0]['expected_runtime_id']).is_dir())
            finally:
                for client in clients: client.dispose()
                f.TransportTests.stop_workers(root, port)
        print('DELTA_RECEIPTS=' + json.dumps(receipts, separators=(',', ':')))

    def test_delta_merge_checks_full_target_membership_and_reused_bytes(self):
        hello, _source, _packed, value, files = versioned(23456)
        metadata = [{key: content for key, content in row.items() if key != 'base64'} for row in value['files']]
        partial = {**value, 'files': [], 'manifest': metadata}
        payload, merged = f.bridge.merge_delta(partial, hello, files)
        self.assertEqual(merged, files)
        for corrupted in [{**files, 'pyproject.toml': b'corrupt'}, {key: content for key, content in files.items() if key != 'pyproject.toml'}]:
            with self.assertRaises(f.bridge.Failure): f.bridge.merge_delta(partial, hello, corrupted)
        with self.assertRaises(f.bridge.Failure): f.bridge.merge_delta({**partial, 'manifest': metadata[:-1]}, hello, files)
        with self.assertRaises(f.bridge.Failure): f.bridge.merge_delta({**partial, 'manifest': metadata + metadata[:1]}, hello, files)


if __name__ == '__main__': unittest.main(verbosity=2)
