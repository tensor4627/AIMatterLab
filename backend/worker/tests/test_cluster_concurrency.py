"""Portable state/transaction fixtures: all scheduler and SSH replies are inert."""
import base64
from concurrent.futures import ThreadPoolExecutor
import json
import os
import re
import shlex
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.compute.cluster import Clusters, PlanningAdapter
from studio_worker.compute.service import Service


def payload(script):
    code = shlex.split(script)[-1]
    return json.loads(base64.b64decode(re.search(r"base64.b64decode\('([^']+)'\)", code).group(1)))


def reply(**value):
    return '__STUDIO_JSON__' + json.dumps(value)


class ClusterConcurrentState(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.inputs = self.root / 'inputs'
        self.inputs.mkdir()
        (self.inputs / 'run.py').write_text("print('inert; never executed')")
        self.service = Service(self.root / 'service', schedule=False)
        self.cluster = Clusters(self.service, transport=self.transport)
        self.service.clusters = self.cluster
        self.profile = self.cluster.register({
            'name': 'fixture', 'scheduler': 'lsf', 'target': 'fixture@example.test',
            'port': 22, 'ssh_client': '/usr/bin/ssh', 'remote_root': '/tmp/studio-fixture',
            'queue': 'fixture', 'environment': {'executables': {'python': '/usr/bin/python3'}}})
        self.project = self.service.register_project({'name': 'fixture', 'policy': {
            'input_roots': [str(self.inputs)], 'clusters': [self.profile['id']], 'max_concurrent': 1}})
        self.calls = []
        self.callback = None

    def tearDown(self):
        self.service.close()
        self.service.store.db.close()
        self.tmp.cleanup()

    def transport(self, profile):
        owner = self

        class Wire:
            def run(self, script, data=None, timeout=40):
                owner.assertFalse(owner.service.store.lock._is_owned(), 'Remote I/O must release Store.lock')
                owner.calls.append((script, data))
                if owner.callback:
                    return owner.callback(script, data)
                value = payload(script)
                if data is not None:
                    return reply(nonce=value['nonce'], job_id='123')
                return reply(job_id='123', scheduler_state='RUN', identity_verified=True)
        return Wire()

    def ready(self, key='one'):
        run = self.cluster.prepare({
            'name': 'fixture', 'project_id': self.project['id'], 'cluster_id': self.profile['id'],
            'engine': 'pydyn.md', 'inputs': {'run.py': str(self.inputs / 'run.py')},
            'parameters': {}, 'gpu': 0, 'max_seconds': 60, 'idempotency_key': key,
            'resources': {'cpus': 1, 'gpus': 0, 'memory_mb': 1024, 'queue': 'fixture'}})
        self.cluster.validate(run['id'])
        return run['id']

    def submitted(self):
        identifier = self.ready()
        self.cluster.submit(identifier)
        return identifier

    def synchronized_archive(self):
        original = self.cluster.archive
        barrier = threading.Barrier(2)

        def archive(run):
            self.assertFalse(self.service.store.lock._is_owned())
            data = original(run)
            barrier.wait(5)
            return data
        self.cluster.archive = archive

    def test_two_cluster_drafts_atomically_share_one_project_slot(self):
        identifiers = [self.ready('one'), self.ready('two')]
        self.synchronized_archive()

        def submit(identifier):
            try:
                return self.cluster.submit(identifier)['status']
            except PermissionError as error:
                return str(error)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit, identifiers))
        self.assertCountEqual(results, ['queued', 'Project concurrency limit reached'])
        self.assertEqual(sum(data is not None for _, data in self.calls), 1)
        self.assertCountEqual([self.cluster.raw(identifier)['status'] for identifier in identifiers], ['queued', 'ready'])

    def test_same_run_concurrent_submit_has_one_dispatch_and_stable_nonce(self):
        identifier = self.ready()
        original = self.cluster.raw(identifier)
        self.synchronized_archive()
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(self.cluster.submit, [identifier, identifier]))
        self.assertEqual(sum(data is not None for _, data in self.calls), 1)
        self.assertEqual(self.cluster.submit(identifier)['status'], 'queued')
        current = self.cluster.raw(identifier)
        self.assertEqual(current['nonce'], original['nonce'])
        self.assertEqual(current['idempotency_key'], original['idempotency_key'])
        self.assertEqual(len(self.calls), 1)

    def test_archive_failure_preserves_ready_without_dispatch_or_reservation(self):
        identifier = self.ready()
        with patch.object(self.cluster, 'archive', side_effect=OSError('fixture archive failure')):
            with self.assertRaisesRegex(OSError, 'fixture archive failure'):
                self.cluster.submit(identifier)
        run = self.cluster.raw(identifier)
        self.assertEqual(run['status'], 'ready')
        self.assertFalse(run.get('submit_attempted'))
        self.assertFalse(self.calls)
        self.assertEqual(self.cluster.submit(identifier)['status'], 'queued')

    def add_local(self, status):
        directory = self.root / 'local'
        directory.mkdir()
        self.service.store.add_run({
            'id': 'local', 'project_id': self.project['id'], 'idempotency_key': 'local',
            'request_hash': 'fixture', 'status': status, 'directory': str(directory),
            'gpu': 0, 'max_seconds': 60, 'snapshots': [], 'environment_snapshot': {}, 'command': []})

    def test_local_dispatch_during_archive_blocks_cluster_dispatch(self):
        identifier = self.ready()
        original = self.cluster.archive

        def archive(run):
            data = original(run)
            self.add_local('running')
            return data

        self.cluster.archive = archive
        with self.assertRaisesRegex(PermissionError, 'concurrency limit'):
            self.cluster.submit(identifier)
        self.assertEqual(self.cluster.raw(identifier)['status'], 'ready')
        self.assertFalse(self.calls)

    def test_cluster_reservation_blocks_local_dispatch_while_ssh_is_pending(self):
        identifier = self.ready()
        self.add_local('queued')
        entered, release = threading.Event(), threading.Event()

        def waiting(script, data):
            self.assertEqual(self.cluster.raw(identifier)['status'], 'unknown')
            self.assertTrue(self.cluster.raw(identifier)['submit_attempted'])
            entered.set()
            self.assertTrue(release.wait(5))
            return reply(nonce=payload(script)['nonce'], job_id='123')

        self.callback = waiting
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.cluster.submit, identifier)
            try:
                self.assertTrue(entered.wait(5))
                with patch.object(self.service, 'authorize', return_value=(self.project, {})), patch(
                        'studio_worker.compute.scheduler.subprocess.Popen', side_effect=AssertionError('No local dispatch')):
                    self.service.dispatch()
                self.assertEqual(self.service.store.run('local')['status'], 'queued')
            finally:
                release.set()
            self.assertEqual(future.result()['status'], 'queued')

    def test_policy_change_during_archive_cannot_dispatch_under_revoked_authorization(self):
        identifier = self.ready()
        original = self.cluster.archive

        def archive(run):
            data = original(run)
            project = self.service.store.get('project', self.project['id'])
            project['policy']['clusters'] = []
            self.service.store.put('project', project)
            return data

        self.cluster.archive = archive
        with self.assertRaisesRegex(PermissionError, 'not authorized'):
            self.cluster.submit(identifier)
        self.assertEqual(self.cluster.raw(identifier)['status'], 'ready')
        self.assertFalse(self.calls)

    def test_late_validation_cannot_reopen_a_submitted_reservation(self):
        identifier = self.ready()
        entered, release = threading.Event(), threading.Event()
        original = PlanningAdapter.prepare

        def waiting(adapter, *args, **kwargs):
            if threading.current_thread().name.startswith('late-validation'):
                entered.set()
                self.assertTrue(release.wait(5))
            return original(adapter, *args, **kwargs)

        with patch.object(PlanningAdapter, 'prepare', waiting), ThreadPoolExecutor(
                max_workers=1, thread_name_prefix='late-validation') as pool:
            future = pool.submit(self.cluster.validate, identifier)
            try:
                self.assertTrue(entered.wait(5))
                submitted = self.cluster.submit(identifier)
                self.assertEqual(submitted['status'], 'queued')
            finally:
                release.set()
            self.assertEqual(future.result()['status'], 'queued')
        self.assertEqual(self.cluster.submit(identifier)['status'], 'queued')
        self.assertEqual(sum(data is not None for _, data in self.calls), 1)

    @unittest.skipUnless(os.name == 'posix', 'Failed revision cleans immutable POSIX snapshots')
    def test_revision_copy_cannot_overwrite_parent_submitted_while_copy_was_pending(self):
        import shutil
        identifier = self.ready()
        entered, release = threading.Event(), threading.Event()
        original = shutil.copyfile

        def waiting(*args, **kwargs):
            if threading.current_thread().name.startswith('late-revision'):
                entered.set()
                self.assertTrue(release.wait(5))
            return original(*args, **kwargs)

        before_ids = {run['id'] for run in self.service.store.list('cluster-run')}
        with patch('studio_worker.compute.cluster.shutil.copyfile', waiting), ThreadPoolExecutor(
                max_workers=1, thread_name_prefix='late-revision') as pool:
            future = pool.submit(self.cluster.revise, identifier, {'name': 'revised fixture'})
            try:
                self.assertTrue(entered.wait(5))
                self.assertEqual(self.cluster.submit(identifier)['status'], 'queued')
            finally:
                release.set()
            with self.assertRaisesRegex(PermissionError, 'parent changed or was submitted'):
                future.result()
        after = self.cluster.raw(identifier)
        self.assertEqual(after['status'], 'queued')
        self.assertEqual(after['job_id'], '123')
        self.assertTrue(after['submit_attempted'])
        self.assertNotIn('superseded_by', after)
        self.assertEqual({run['id'] for run in self.service.store.list('cluster-run')}, before_ids)
        self.assertEqual(self.cluster.submit(identifier)['status'], 'queued')
        self.assertEqual(sum(data is not None for _, data in self.calls), 1)

    def test_unknown_after_lost_submit_reply_is_durable_and_never_resubmitted(self):
        identifier = self.ready()

        def lost(script, data):
            raise ConnectionError('fixture reply lost')

        self.callback = lost
        self.assertEqual(self.cluster.submit(identifier)['status'], 'unknown')
        self.service.close()
        self.service.store.db.close()
        self.service = Service(self.root / 'service', schedule=False)
        self.cluster = Clusters(self.service, transport=self.transport)
        self.service.clusters = self.cluster
        self.assertEqual(self.cluster.submit(identifier)['status'], 'unknown')
        self.assertEqual(len(self.calls), 1)

    def delayed_poll(self, older, newer):
        identifier = self.submitted()
        entered, release = threading.Event(), threading.Event()

        def observed(script, data):
            if threading.current_thread().name.startswith('older'):
                entered.set()
                self.assertTrue(release.wait(5))
                if isinstance(older, Exception):
                    raise older
                return reply(**older)
            return reply(**newer)

        self.callback = observed
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix='older') as pool:
            future = pool.submit(self.cluster.poll, identifier)
            try:
                self.assertTrue(entered.wait(5))
                current = self.cluster.poll(identifier)
            finally:
                release.set()
            after = future.result()
        self.assertEqual(after, current)
        self.assertEqual(json.loads((Path(after['directory']) / 'run.json').read_text()), self.cluster.raw(identifier))
        return after

    def test_older_running_reply_cannot_replace_success_or_erase_receipt(self):
        receipt = {'exit_code': 0}
        run = self.delayed_poll(
            {'job_id': '123', 'scheduler_state': 'RUN', 'identity_verified': True},
            {'job_id': '123', 'scheduler_state': 'DONE', 'identity_verified': True,
             'exit': receipt, 'validation': {'status': 'passed'}})
        self.assertEqual(run['status'], 'succeeded')
        self.assertEqual(run['exit'], receipt)
        self.assertEqual(run['scientific_validation']['status'], 'passed')

    def test_older_error_cannot_replace_newer_terminal(self):
        run = self.delayed_poll(ConnectionError('fixture stale failure'), {
            'job_id': '123', 'scheduler_state': 'DONE', 'identity_verified': True,
            'exit': {'exit_code': 0}, 'validation': {'status': 'passed'}})
        self.assertEqual(run['status'], 'succeeded')
        self.assertIsNone(run.get('connection_action'))

    @unittest.skipUnless(os.name == 'posix', 'Real SSH authentication error type imports Linux PTY support')
    def test_older_auth_error_cannot_replace_newer_terminal_or_auth_hint(self):
        from studio_worker.compute.ssh_auth import AuthError
        run = self.delayed_poll(AuthError('needs_human_auth'), {
            'job_id': '123', 'scheduler_state': 'DONE', 'identity_verified': True,
            'exit': {'exit_code': 0}, 'validation': {'status': 'passed'}})
        self.assertEqual(run['status'], 'succeeded')
        self.assertIsNone(run.get('connection_action'))

    def test_older_error_cannot_replace_newer_running_observation(self):
        run = self.delayed_poll(ConnectionError('fixture stale failure'), {
            'job_id': '123', 'scheduler_state': 'RUN', 'identity_verified': True})
        self.assertEqual(run['status'], 'running')
        self.assertIsNone(run.get('error'))

    def test_older_success_cannot_replace_newer_cancelled_terminal(self):
        run = self.delayed_poll(
            {'job_id': '123', 'scheduler_state': 'DONE', 'exit': {'exit_code': 0},
             'validation': {'status': 'passed'}, 'identity_verified': True},
            {'job_id': '123', 'scheduler_state': 'CANCELLED', 'identity_verified': True})
        self.assertEqual(run['status'], 'cancelled')
        self.assertIsNone(run.get('exit'))

    def test_known_exit_receipt_survives_missing_file_on_later_poll(self):
        identifier = self.submitted()
        self.callback = lambda script, data: reply(job_id='123', exit={'exit_code': 0})
        first = self.cluster.poll(identifier)
        self.assertEqual(first['status'], 'succeeded')
        self.callback = lambda script, data: reply(job_id='123', validation={'status': 'passed'})
        second = self.cluster.poll(identifier)
        self.assertEqual(second['status'], 'succeeded')
        self.assertEqual(second['exit'], first['exit'])

    def test_generic_exit_keeps_concurrent_cancel_intent_separate_from_outcome(self):
        identifier = self.submitted()
        entered, release = threading.Event(), threading.Event()

        def waiting(script, data):
            entered.set()
            self.assertTrue(release.wait(5))
            return reply(job_id='123', scheduler_state='EXIT', identity_verified=True)

        self.callback = waiting
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.cluster.poll, identifier)
            try:
                self.assertTrue(entered.wait(5))
                self.cluster.merge(identifier, cancel_requested=True)
            finally:
                release.set()
            run = future.result()
        self.assertEqual(run['status'], 'failed')
        self.assertTrue(run['cancel_requested'])

    def test_concurrent_cancel_dispatches_one_command_and_retains_the_original_request(self):
        identifier = self.submitted()
        entered, release = threading.Event(), threading.Event()
        def waiting(script, data):
            if script == 'bkill 123':
                entered.set()
                self.assertTrue(release.wait(5))
                return ''
            return reply(job_id='123',scheduler_state='RUN',identity_verified=True)
        self.callback = waiting
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(self.cluster.cancel,identifier)
            try:
                self.assertTrue(entered.wait(5))
                pending = self.cluster.cancel(identifier)
                self.assertTrue(pending['cancel_requested'])
                self.assertIsNone(pending['cancellation']['signal_sent'])
            finally:
                release.set()
            result = first.result()
        self.assertEqual([script for script,_ in self.calls].count('bkill 123'),1)
        self.assertEqual(result['cancellation']['requested_at'],pending['cancellation']['requested_at'])
        self.assertIs(result['cancellation']['signal_sent'],True)

    def late_submission_reply(self, failure):
        identifier = self.ready()
        entered, release = threading.Event(), threading.Event()

        def waiting(script, data):
            value = payload(script)
            if data is not None:
                entered.set()
                self.assertTrue(release.wait(5))
                if failure:
                    raise ConnectionError('fixture submission reply lost')
                return reply(nonce=value['nonce'], job_id='123')
            return reply(job_id='123', scheduler_state='DONE', exit={'exit_code': 0},
                         validation={'status': 'passed'}, identity_verified=True)

        self.callback = waiting
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.cluster.submit, identifier)
            try:
                self.assertTrue(entered.wait(5))
                self.assertEqual(self.cluster.poll(identifier)['status'], 'succeeded')
            finally:
                release.set()
            run = future.result()
        self.assertEqual(run['status'], 'succeeded')
        self.assertEqual(run['exit'], {'exit_code': 0})
        self.assertEqual(run['job_id'], '123')

    def test_delayed_submit_success_cannot_replace_reconciled_terminal(self):
        self.late_submission_reply(False)

    def test_delayed_submit_error_cannot_replace_reconciled_terminal(self):
        self.late_submission_reply(True)


if __name__ == '__main__':
    unittest.main()
