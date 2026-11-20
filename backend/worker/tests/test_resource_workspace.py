from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from studio_worker.infrastructure.store import Store
from studio_worker.compute.cluster import batch_script
from studio_worker.compute.bound_cluster import confinement_source
from studio_worker.transport.routes import dispatch
from studio_worker.workspace import resource_workspace as workspace


class ResourceWorkspaceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.service = self.worker()
        self.registration = self.register(self.root / 'workspace')

    def worker(self):
        store = Store(self.root / 'service')
        self.addCleanup(store.db.close)
        (store.root / 'ssh-service.json').write_text(json.dumps({
            'schema_version': 1, 'role': 'ssh-login-service', 'profile_id': 'saved-profile',
        }))
        return SimpleNamespace(store=store, root=store.root, ssh_service_mode=True)

    def register(self, path):
        for child in ('workfile', 'software'):
            (path / child).mkdir(parents=True)
        resource_id, profile_id, account, host_identity = workspace._actual_resource(self.service)
        registration = {'resource_id': resource_id, 'workspace_id': workspace._digest(resource_id, str(path)),
                        'profile_id': profile_id, 'account': account, 'host_identity': host_identity, 'root': str(path)}
        with self.assertRaises(PermissionError):
            dispatch(self.service, 'POST', '/api/resource-workspace/register', registration)
        return dispatch(self.service, 'POST', '/api/resource-workspace/register', registration, admin=True)

    def request(self, thread, date='2026-11-20', registration=None):
        registration = registration or self.registration
        return {'resource_id': registration['resource_id'], 'workspace_id': registration['workspace_id'],
                'provider': 'codex', 'thread_id': thread, 'date': date}

    def allocate(self, thread, **options):
        return dispatch(self.service, 'POST', '/api/resource-workspace/allocate', self.request(thread, **options), admin=True)

    def test_same_day_uses_real_distinct_directories_and_separate_day_restarts_at_one(self):
        workfile = Path(self.registration['root']) / 'workfile'
        day = workfile / '2026-11-20'
        day.mkdir()
        (day / 'task-1').write_text('keep this user file')
        other = self.worker()
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(workspace.session, service, self.request(thread), allocate=True)
                       for service, thread in ((self.service, 'a'), (other, 'b'), (other, 'a'), (self.service, 'c'))]
            rows = [future.result(timeout=8) for future in futures]
        self.assertEqual(rows[0]['path'], rows[2]['path'])
        self.assertEqual({row['task_number'] for row in rows}, {2, 3, 4})
        self.assertEqual((day / 'task-1').read_text(), 'keep this user file')
        self.assertTrue(all(Path(row['path']).is_dir() for row in rows))
        self.assertEqual(self.allocate('d', date='2026-11-21')['task_number'], 1)

    def test_unknown_allocation_response_reconciles_first_date_and_old_root(self):
        original_put = workspace._put

        def fail_after_mkdir(store, value):
            if value.get('task_number'):
                raise OSError('simulated store commit failure')
            original_put(store, value)

        with patch.object(workspace, '_put', fail_after_mkdir), self.assertRaises(OSError):
            self.allocate('first')
        previous_path = Path(self.registration['root']) / 'workfile' / '2026-11-20' / 'task-1'
        self.assertTrue(previous_path.is_dir())
        newer = self.register(self.root / 'site-project')
        actual = self.allocate('first', registration=newer, date='2026-11-21')
        self.assertEqual(actual['path'], str(previous_path))
        self.assertEqual(self.allocate('second', registration=newer, date='2026-11-21')['root'], newer['root'])
        self.assertEqual(workspace.verified_session_directory(self.service, actual, provider='codex', thread_id='first'), previous_path)
        with self.assertRaises(PermissionError):
            workspace.verified_session_directory(self.service, actual, provider='codex', thread_id='second')
        previous_path.rename(self.root / 'replaced')
        previous_path.symlink_to(self.root / 'replaced', target_is_directory=True)
        with self.assertRaises(PermissionError):
            workspace.verified_session_directory(self.service, actual, provider='codex', thread_id='first')

    def test_read_has_no_allocation_and_wrong_account_cannot_register(self):
        request = self.request('draft')
        read = {key: request[key] for key in ('resource_id', 'provider', 'thread_id')}
        self.assertIsNone(workspace.session(self.service, read))
        self.assertEqual(list((Path(self.registration['root']) / 'workfile').iterdir()), [])
        wrong = {**self.registration, 'account': 'another'}
        wrong.pop('id')
        with self.assertRaises(PermissionError):
            workspace.register(self.service, wrong)

    def test_bound_scheduler_validation_and_program_have_distinct_write_roots(self):
        remote = self.root / 'allocation'
        (remote / '.studio').mkdir(parents=True)
        (remote / 'simulation').mkdir()
        outside = self.root / 'protected-file'
        outside.write_text('original')
        bootstrap = remote / '.studio/workspace-confinement.py'
        bootstrap.write_bytes(confinement_source())
        validation = remote / '.studio/validate.py'
        program = ('from pathlib import Path; Path("inside.txt").write_text("computed"); '
                   'Path("../execution-check.json").write_text("result replaced")')
        run = {'job_name':'isolated-job','remote_directory':str(remote),'nonce':'fixture',
               'cluster_snapshot':{'scheduler':'slurm','environment':{'executables':{'python':sys.executable}}},
               'resources':{'queue':'fixture','cpus':1,'memory_mb':128,'seconds':20,'gpus':0},
               'bound_invocation':{'owner':{'kind':'configuration','id':'fixture'}},'command':[sys.executable,'-c',program]}
        validation.write_text('from pathlib import Path\nPath("execution-check.json").write_text("validated")\n')
        result = subprocess.run(['/bin/bash', '-c', batch_script(run)], cwd=remote, timeout=25, capture_output=True)
        if result.returncode == 125:
            self.skipTest('Local Linux does not support unprivileged workspace confinement')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((remote/'simulation/inside.txt').read_text(), 'computed')
        self.assertEqual((remote/'execution-check.json').read_text(), 'validated')
        self.assertIn('PermissionError', (remote/'console.log').read_text())
        validation.write_text(f'from pathlib import Path\nPath({str(outside)!r}).write_text("replaced")\n')
        (remote/'simulation/inside.txt').unlink()
        blocked = subprocess.run(['/bin/bash', '-c', batch_script(run)], cwd=remote, timeout=25, capture_output=True)
        self.assertNotEqual(blocked.returncode, 0)
        self.assertFalse((remote/'simulation/inside.txt').exists())
        self.assertEqual(outside.read_text(), 'original')
        self.assertIn('PermissionError', (remote/'validation.stderr').read_text())


if __name__ == '__main__':
    unittest.main()
