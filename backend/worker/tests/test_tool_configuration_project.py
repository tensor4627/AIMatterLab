"""Atomic create-only project authorization tests with real isolated Store/thread interleavings."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from studio_worker.service import Service
from studio_worker.server import dispatch, mcp_tool_call, tools
from studio_worker.tools.configurations import ToolConfigurations


class ToolConfigurationProject(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.service = Service(self.root / 'worker', schedule=False)
        self.addCleanup(self.service.store.db.close); self.addCleanup(self.service.close)
        self.service.register_environment({'id': 'python-fixture', 'name': 'Existing fixture registration', 'executables': {'python': sys.executable}})
        self.api = ToolConfigurations(self.service)
        self.request = {'project_id': 'tool-config-' + '1' * 24, 'name': 'CPU check', 'environment_id': 'python-fixture'}

    def call(self, data=None, admin=True, method='POST'):
        return dispatch(self.service, method, '/api/tool-configuration/project/create', self.request if data is None else data, admin=admin)

    def concurrent(self):
        return {'id': self.request['project_id'], 'name': 'Concurrent owner', 'policy': {'engines': ['gpumd.md'], 'gpus': [0], 'max_seconds': 1800, 'max_concurrent': 2, 'input_roots': [str(self.root / 'different-inputs')], 'environments': ['python-fixture']}}

    def start(self, work):
        started, done, outcome = threading.Event(), threading.Event(), {}
        def run():
            started.set()
            try: outcome['value'] = work()
            except Exception as error: outcome['error'] = error
            finally: done.set()
        thread = threading.Thread(target=run, daemon=True); thread.start()
        self.assertTrue(started.wait(2))
        return thread, done, outcome

    def finish(self, *threads):
        for thread in threads:
            thread.join(3); self.assertFalse(thread.is_alive(), 'Owned fixture thread did not finish')

    def test_fixed_worker_policy_and_exact_idempotence_do_not_install_or_change_environment(self):
        before = self.service.store.list('environment')
        project = self.call()
        self.assertEqual(project['id'], self.request['project_id'])
        self.assertEqual(project['policy'], {'engines': ['installation.check'], 'gpus': [0], 'max_seconds': 30, 'max_concurrent': 1, 'input_roots': [str(self.service.root / 'projects' / project['id'] / 'inputs')], 'environments': ['python-fixture']})
        with patch.object(self.service, '_register_project', side_effect=AssertionError('Identical project must not be written again')):
            self.assertEqual(self.call(), project)
        self.assertEqual(self.service.store.list('project'), [project])
        self.assertEqual(self.service.store.list('environment'), before)
        self.assertEqual(self.service.store.runs(), [])
        self.assertFalse((self.service.root / 'projects').exists())

    def test_every_conflicting_name_policy_or_authoring_field_is_preserved(self):
        baseline = self.call()
        changes = [lambda item: item.update(name='Other human name'), lambda item: item.update(authoring_only=True), lambda item: item.update(authoring_only=False), lambda item: item.update(studio_workspace={'schema_version': 1}), lambda item: item['policy'].update(engines=['gpumd.md']), lambda item: item['policy'].update(gpus=[]), lambda item: item['policy'].update(max_seconds=10), lambda item: item['policy'].update(input_roots=[str(self.root)]), lambda item: item['policy'].update(cluster_queue_policies={})]
        for change in changes:
            with self.subTest(change=change):
                existing = copy.deepcopy(baseline); change(existing)
                existing['revision'] = self.service.store.get('project', baseline['id'])['revision']
                self.service.register_project(existing)
                before = self.service.store.get('project', existing['id'])
                with self.assertRaisesRegex(ValueError, 'preserved'): self.call()
                self.assertEqual(self.service.store.get('project', existing['id']), before)
        self.assertEqual(self.service.store.runs(), [])

    def test_legacy_boolean_gpu_grant_is_preserved_until_an_explicit_integer_edit(self):
        project = self.call()
        legacy = {**project, 'policy':{**project['policy'],'gpus':[False]}}
        # Simulate an existing record saved before the registration validator rejected bools.
        with self.service.store.lock, self.service.store.db:
            self.service.store.db.execute("UPDATE objects SET data=? WHERE kind='project' AND id=?",
                                          (json.dumps(legacy), project['id']))
        with self.assertRaisesRegex(ValueError, 'preserved'):
            self.call()
        stored = self.service.store.get('project', project['id'])
        self.assertEqual(stored['revision'], legacy['revision'])
        self.assertIs(stored['policy']['gpus'][0], False)
        saved = dispatch(self.service, 'POST', '/api/projects', project, admin=True)
        self.assertEqual(saved['revision'], project['revision'] + 1)
        self.assertEqual(self.service.store.get('project', project['id']), saved)
        self.assertIs(type(self.service.store.get('project', project['id'])['policy']['gpus'][0]), int)

    def test_admin_exact_fields_and_real_environment_are_required(self):
        for extra in ({'policy': {}}, {'passed': True}, {'root': '/caller-selected-root'}):
            with self.assertRaises(ValueError): self.call({**self.request, **extra})
        for field, value in [('project_id', 'old-project'), ('project_id', '../outside'), ('name', ''), ('name', 'bad\nname'), ('environment_id', 'absent')]:
            with self.subTest(field=field, value=value):
                with self.assertRaises(ValueError): self.call({**self.request, field: value})
        with self.assertRaises(PermissionError): self.call(admin=False)
        with self.assertRaises(PermissionError): self.call(method='GET')
        self.assertFalse(any(item['name'] == 'tool_configuration_project_create' for item in tools()))
        denied = mcp_tool_call(self.service, {'name': 'tool_configuration_project_create', 'arguments': self.request})
        self.assertTrue(denied['isError']); self.assertEqual(self.service.store.list('project'), [])

    def test_normal_writer_holds_lock_through_validation_and_create_cannot_overwrite_it(self):
        entered, release = threading.Event(), threading.Event()
        original = self.service.clusters.validate_project_policies
        def validation(value):
            if value['name'] == 'Concurrent owner':
                entered.set()
                if not release.wait(5): raise AssertionError('Fixture validation release timed out')
            return original(value)
        with patch.object(self.service.clusters, 'validate_project_policies', side_effect=validation):
            writer, _, written = self.start(lambda: self.service.register_project(self.concurrent()))
            self.assertTrue(entered.wait(2))
            creator, done, created = self.start(self.call)
            try: self.assertFalse(done.wait(.1), 'Create bypassed the normal writer lock')
            finally: release.set()
            self.finish(writer, creator)
        self.assertNotIn('error', written); self.assertIsInstance(created.get('error'), ValueError)
        self.assertEqual(self.service.store.get('project', self.request['project_id']), {**self.concurrent(), 'revision': 0})

    def test_create_holds_lock_through_check_and_insert_before_later_explicit_edit(self):
        entered, writer_entered, release = threading.Event(), threading.Event(), threading.Event()
        original = self.service._register_project
        def writing(value):
            if value['name'] == 'CPU check':
                entered.set()
                if not release.wait(5): raise AssertionError('Fixture creation release timed out')
            else: writer_entered.set()
            return original(value)
        with patch.object(self.service, '_register_project', side_effect=writing):
            creator, _, created = self.start(self.call); self.assertTrue(entered.wait(2))
            writer, done, written = self.start(lambda: self.service.register_project(self.concurrent()))
            try:
                self.assertFalse(writer_entered.wait(.1), 'Normal writer bypassed atomic create lock')
                self.assertFalse(done.is_set())
            finally: release.set()
            self.finish(creator, writer)
        self.assertNotIn('error', created); self.assertNotIn('error', written)
        self.assertEqual(created['value']['name'], 'CPU check')
        # A later explicit generic project edit retains its existing behavior; it is not undone.
        self.assertEqual(self.service.store.get('project', self.request['project_id']), {**self.concurrent(), 'revision': 1})

    def test_project_api_rejects_stale_authorization_and_preserves_winning_update(self):
        project = self.call()
        updated = dispatch(self.service, 'POST', '/api/projects', {**project, 'name': 'Reviewed name'}, admin=True)
        self.assertEqual(updated['revision'], 1)
        with self.assertRaisesRegex(ValueError, 'project_edit_conflict'):
            dispatch(self.service, 'POST', '/api/projects', {**project, 'policy': {**project['policy'], 'engines': ['pydyn.md']}}, admin=True)
        self.assertEqual(self.service.store.get('project', project['id']), updated)
        self.assertEqual(self.service.store.list('environment')[0]['id'], 'python-fixture')

    def test_two_conflicting_real_threads_create_exactly_one_project(self):
        barrier = threading.Barrier(2)
        def create(name):
            barrier.wait(timeout=3)
            return self.call({**self.request, 'name': name})
        first, _, one = self.start(lambda: create('First reviewed name'))
        second, _, two = self.start(lambda: create('Second reviewed name'))
        self.finish(first, second)
        successes = [item['value'] for item in (one, two) if 'value' in item]
        errors = [item['error'] for item in (one, two) if 'error' in item]
        self.assertEqual(len(successes), 1); self.assertEqual(len(errors), 1); self.assertIsInstance(errors[0], ValueError)
        self.assertEqual(self.service.store.list('project'), successes)


if __name__ == '__main__': unittest.main()
