"""Real isolated CPU reference steps; no scientific engine, production Store or connection."""
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from studio_worker.service import Service
from studio_worker.server import dispatch, mcp_tool_call, tools
from studio_worker.tools.configurations import ToolConfigurations
from studio_worker.tools.package_contract import load_package
from studio_worker.workspace.group_contract import group_version
from studio_worker.workspace.tool_workflows import ToolWorkflows
from test_tool_configurations import fixture


@unittest.skipUnless(os.name == 'posix' and Path('/proc').exists(), 'Linux fixed worker lifecycle required')
class ToolWorkflowLifecycle(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name); self.package, self.manifest = fixture(self.root)
        self.service = Service(self.root / 'worker', schedule=False)
        self.addCleanup(self.service.store.db.close); self.addCleanup(self.service.close)
        self.service.register_environment({'id': 'python', 'name': 'Existing system interpreter fixture', 'executables': {'python': sys.executable}})
        self.project = self.service.register_project({'id': 'compute', 'name': 'Explicit fixed CPU grant', 'policy': {'engines': ['installation.check'], 'gpus': [0], 'max_seconds': 30, 'max_concurrent': 1, 'input_roots': [str(self.root / 'explicit-inputs')], 'environments': ['python']}})
        self.workspace = dispatch(self.service, 'POST', '/api/studio-workspace/create', {'id': 'workspace-cpu', 'name': 'Explicit existing workspace', 'asset_mode': 'copy'}, admin=True)
        package = load_package(self.package); self.version = package['package_version']
        configurations = ToolConfigurations(self.service)
        configurations.register({'snapshot_root': str(self.package), 'package_id': self.manifest['id'], 'package_version': self.version})
        plan = configurations.plan({'package_id': self.manifest['id'], 'package_version': self.version, 'target': {'target': 'local', 'project_id': 'compute', 'environment_id': 'python'}, 'request_id': 'active-reference-configuration'})
        value = configurations.execute({'configuration_id': plan['id'], 'expected_revision': plan['revision'], 'plan_sha256': plan['plan_sha256']})
        deadline = time.monotonic() + 15
        while value['status'] == 'testing' and time.monotonic() < deadline:
            self.service.tick(); time.sleep(.03); value = configurations.status({'configuration_id': plan['id']})
        self.assertEqual(value['status'], 'tested', value)
        self.active = configurations.activate({'configuration_id': plan['id'], 'expected_revision': value['revision'], 'plan_sha256': value['plan_sha256']})
        definition = {'schema_version': 1, 'id': 'cpu-sequence', 'name': 'Two real fixed worker steps', 'inputs': [], 'steps': [{'id': 'first', 'tool_id': self.manifest['id'], 'package_version': self.version, 'function_id': 'process', 'inputs': {}}, {'id': 'second', 'tool_id': self.manifest['id'], 'package_version': self.version, 'function_id': 'process', 'inputs': {}, 'depends_on': ['first']}], 'outputs': [{'id': 'receipt', 'step_id': 'second', 'port_id': 'result'}]}
        self.definition = definition
        text = json.dumps(definition, separators=(',', ':'))
        self.arguments = {'request_id': 'explicit-workflow-request', 'name': 'Reference flow', 'directory_name': 'reference', 'workspace_id': self.workspace['id'], 'target': {'target': 'local', 'project_id': 'compute', 'environment_id': 'python'}, 'tool_groups': [{'id': definition['id'], 'version': group_version(text), 'definition_text': text}], 'configurations': [{'step_id': step['id'], 'configuration_id': self.active['configuration_id']} for step in definition['steps']]}
        self.api = ToolWorkflows(self.service); self.baseline_runs = len(self.service.store.runs())

    def call(self, route, data, admin=True):
        return dispatch(self.service, 'POST', '/api/workflow/' + route, data, admin=admin)

    def create(self): return self.call('tool-group/create', copy.deepcopy(self.arguments))

    def prepare(self, value, step='first', request_id=None):
        return self.call('prepare-step', {'execution_id': value['execution']['id'], 'step_id': step, 'expected_revision': value['execution']['revision'], 'request_id': request_id or 'prepare-step-' + step})

    def execute(self, value, step='first'):
        selected = next(item for item in value['execution']['steps'] if item['id'] == step)
        return self.call('execute-step', {'execution_id': value['execution']['id'], 'step_id': step, 'expected_revision': value['execution']['revision'], 'review_sha256': selected['review']['review_sha256']})

    def complete(self, value, step='first'):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            self.service.tick(); time.sleep(.03)
            value = self.call('status', {'execution_id': value['execution']['id']})
            selected = next(item for item in value['execution']['steps'] if item['id'] == step)
            if selected['status'] not in ('queued', 'running'): break
        self.assertEqual(selected['status'], 'passed', value)
        self.assertEqual(selected['run_status'], 'succeeded')
        return value

    def test_create_exact_versions_snapshot_is_idempotent_without_run_or_grant_changes(self):
        before = copy.deepcopy(self.service.store.list('project'))
        value = self.create(); again = self.create()
        self.assertEqual(value, again); self.assertEqual(value['workflow']['schema_version'], 2)
        self.assertEqual(value['execution']['group']['version'], self.arguments['tool_groups'][0]['version'])
        self.assertEqual([item['eligible'] for item in value['execution']['steps']], [True, False])
        self.assertEqual(self.service.store.list('project'), before)
        self.assertEqual(len(self.service.store.runs()), self.baseline_runs)
        self.assertTrue(Path(value['workflow']['root']).is_dir())
        self.assertFalse(Path(value['workflow']['root']).is_relative_to(Path(self.workspace['root'])))
        changed = copy.deepcopy(self.arguments); changed['name'] = 'Changed same request'
        with self.assertRaises(ValueError): self.api.create(changed)

    def test_group_text_hash_coverage_and_supported_subset_fail_before_creating_runs(self):
        invalid = copy.deepcopy(self.arguments); invalid['tool_groups'][0]['version'] = 'f' * 64
        with self.assertRaises(ValueError): self.api.create(invalid)
        for change in (lambda item: item['steps'][0].update(depends_on=['second']), lambda item: item['steps'][0].update(inputs={'fake': {'value': 'arbitrary'}}), lambda item: item['steps'][0].update(parameters={'shell': 'never execute'}), lambda item: item['outputs'][0].update(step_id='missing')):
            bad = copy.deepcopy(self.arguments); definition = copy.deepcopy(self.definition); change(definition)
            text = json.dumps(definition, separators=(',', ':')); bad['tool_groups'][0].update(definition_text=text, version=group_version(text))
            with self.assertRaises(ValueError): self.api.create(bad)
        self.assertEqual(self.service.store.list('workflow'), []); self.assertEqual(len(self.service.store.runs()), self.baseline_runs)

    def test_admin_routes_and_public_run_binding_fields_cannot_bypass_workflow_review(self):
        for route in ('tool-group/create', 'prepare-step', 'execute-step', 'status', 'read'):
            with self.assertRaises(PermissionError): self.call(route, {}, admin=False)
        self.assertEqual(dispatch(self.service, 'GET', '/api/health', {}, admin=True)['tool_workflow_schema'], 1)
        self.assertFalse(any(item['name'].startswith('tool_workflow') for item in tools()))
        self.assertTrue(mcp_tool_call(self.service, {'name': 'tool_workflow_execute_step', 'arguments': {}})['isError'])
        value = self.prepare(self.create()); selected = value['execution']['steps'][0]
        run = self.service.store.run(selected['run_id'])
        for field in ('studio_workflow_binding', 'workflow_execution_id', 'workflow_step_id', 'workflow_context', 'workflow_directory', '_workflow_context'):
            with self.assertRaises(PermissionError): self.service.prepare({**selected['spec'], field: {}})
        with self.assertRaises(PermissionError): self.service.prepare(selected['spec'])
        with self.assertRaises(PermissionError): self.service.prepare(selected['spec'], _workflow_context={})
        for route in ('/api/run/validate', '/api/run/submit'):
            with self.assertRaises(PermissionError): dispatch(self.service, 'POST', route, {'run_id': run['id']}, admin=True)
        self.assertEqual(self.service.store.run(run['id'])['status'], 'draft')

    def test_two_real_steps_have_separate_nested_directories_and_explicit_next_step(self):
        before = copy.deepcopy(self.service.store.list('project')); value = self.create()
        with self.assertRaises(PermissionError): self.prepare(value, 'second')
        value = self.prepare(value); first = value['execution']['steps'][0]
        self.assertEqual(first['status'], 'prepared'); self.assertEqual(first['run_status'], 'draft')
        self.assertTrue(Path(first['review']['directory']).is_relative_to(Path(value['execution']['root']) / 'steps' / '001-studio-worker-first'))
        value = self.complete(self.execute(value))
        self.assertTrue(value['execution']['steps'][1]['eligible'])
        self.assertEqual(len(self.service.store.runs()), self.baseline_runs + 1)
        value = self.prepare(value, 'second'); value = self.complete(self.execute(value, 'second'), 'second')
        self.assertEqual(value['execution']['status'], 'passed')
        identifiers = [item['run_id'] for item in value['execution']['steps']]; self.assertEqual(len(set(identifiers)), 2)
        for step in value['execution']['steps']:
            criteria = step['review']['criteria']; run = self.service.store.run(step['run_id']); root = Path(run['directory'])
            output = json.loads((root / criteria['output']['run_path']).read_text())
            child = json.loads((root / criteria['child']['run_path']).read_text()); exit_value = json.loads((root / criteria['supervisor']['run_path']).read_text())
            self.assertEqual(output['pid'], child['pid']); self.assertGreater(output['pid'], 0)
            for key, expected in criteria['output']['required_fields'].items(): self.assertEqual(output[key], expected)
            self.assertEqual(exit_value['exit_code'], 0); self.assertFalse(exit_value['cancelled']); self.assertEqual(exit_value, run['exit'])
            self.assertIn(criteria['console']['required_line'], (root / criteria['console']['run_path']).read_text().splitlines())
        self.assertEqual(self.service.store.list('project'), before)
        self.assertEqual(self.service.store.get('workflow', value['workflow']['id'])['run_ids'], identifiers)

    def test_actual_review_sha_and_revision_are_required_before_validation_or_submit(self):
        value = self.prepare(self.create()); step = value['execution']['steps'][0]
        with patch.object(self.service, 'validate', side_effect=AssertionError('No validation before exact human review')):
            for revision, review in ((value['execution']['revision'] - 1, step['review']['review_sha256']), (value['execution']['revision'], 'f' * 64)):
                with self.assertRaises(ValueError): self.call('execute-step', {'execution_id': value['execution']['id'], 'step_id': 'first', 'expected_revision': revision, 'review_sha256': review})
        self.assertEqual(self.service.store.run(step['run_id'])['status'], 'draft')

    def test_unknown_existing_run_never_prepares_submits_or_allocates_another_attempt(self):
        value = self.create(); original_revision = value['execution']['revision']; value = self.prepare(value); run_id = value['execution']['steps'][0]['run_id']
        # Explicit synthetic durable unknown state exercises reporting/retry policy only.
        run = self.service.store.run(run_id); self.service.store.update(run, status='unknown')
        with patch.object(self.service, 'prepare', side_effect=AssertionError('Unknown must not prepare')), patch.object(self.service, 'submit', side_effect=AssertionError('Unknown must not submit')):
            unknown = self.call('status', {'execution_id': value['execution']['id']}); self.assertEqual(unknown['execution']['status'], 'unknown')
            self.assertEqual(self.execute(unknown)['execution']['steps'][0]['run_id'], run_id)
            same = self.call('prepare-step', {'execution_id': value['execution']['id'], 'step_id': 'first', 'expected_revision': original_revision, 'request_id': 'prepare-step-first'})
            self.assertEqual(same['execution']['status'], 'unknown')
            with self.assertRaises(PermissionError): self.prepare(unknown, request_id='different-prepare-request')
        self.assertEqual(len(self.service.store.runs()), self.baseline_runs + 1)
        self.assertEqual(len(list(Path(run['directory']).parent.iterdir())), 1)

    def test_prepare_crash_after_run_commit_reconciles_exact_by_key_and_preserves_directory(self):
        value = self.create(); actual_add = self.service.store.add_run
        def lost_after_commit(run):
            actual_add(run)
            raise ConnectionError('Synthetic interruption after actual durable run insertion')
        with patch.object(self.service.store, 'add_run', side_effect=lost_after_commit):
            with self.assertRaises(ConnectionError): self.prepare(value)
        run = self.service.store.runs()[0]; self.assertTrue(Path(run['directory']).is_dir())
        with patch.object(self.service, 'prepare', side_effect=AssertionError('Read must reconcile, not prepare')):
            recovered = self.call('status', {'execution_id': value['execution']['id']})
        self.assertEqual(recovered['execution']['steps'][0]['run_id'], run['id'])
        self.assertEqual(recovered['execution']['steps'][0]['status'], 'prepared')
        self.assertEqual(len(self.service.store.runs()), self.baseline_runs + 1)

    def test_prepare_without_durable_run_stays_unknown_and_never_retries(self):
        value = self.create()
        with patch.object(self.service, 'prepare', side_effect=ConnectionError('Synthetic pre-dispatch interruption')):
            with self.assertRaises(ConnectionError): self.prepare(value)
        with patch.object(self.service, 'prepare', side_effect=AssertionError('No replacement attempt')):
            unknown = self.call('status', {'execution_id': value['execution']['id']})
            self.assertEqual(unknown['execution']['status'], 'unknown'); self.assertIsNone(unknown['execution']['steps'][0]['run_id'])
            with self.assertRaises(PermissionError): self.prepare(unknown, request_id='explicit-different-key')
        self.assertEqual(len(self.service.store.runs()), self.baseline_runs)

    def test_lost_submit_response_observes_same_queued_run_without_resubmission(self):
        value = self.prepare(self.create()); actual_submit = self.service.submit
        def lost(identifier, **kwargs):
            actual_submit(identifier, **kwargs)
            raise ConnectionError('Synthetic lost response after actual queued transaction')
        with patch.object(self.service, 'submit', side_effect=lost):
            with self.assertRaises(ConnectionError): self.execute(value)
        with patch.object(self.service, 'submit', side_effect=AssertionError('No automatic resubmission')):
            recovered = self.call('status', {'execution_id': value['execution']['id']})
            self.assertEqual(recovered['execution']['steps'][0]['status'], 'queued')
            self.assertEqual(self.execute(recovered)['execution']['steps'][0]['run_id'], value['execution']['steps'][0]['run_id'])
            self.complete(recovered)

    def test_benign_environment_drift_warns_and_new_step_snapshots_current_authorized_registration(self):
        before = copy.deepcopy(self.service.store.list('project'))
        bad = copy.deepcopy(self.arguments); bad['target']['project_id'] = 'other'
        with self.assertRaises(PermissionError): self.api.create(bad)
        value = self.create()
        environment = self.service.store.get('environment', 'python'); environment['name'] = 'Explicit changed registration'; self.service.register_environment(environment)
        current = self.call('status', {'execution_id': value['execution']['id']})
        self.assertEqual(current['execution']['status'], 'planned'); self.assertTrue(current['execution']['steps'][0]['eligible'])
        self.assertEqual(current['execution']['steps'][0]['check_findings'][0]['code'],'configuration_environment_changed')
        prepared=self.prepare(current);run=self.service.store.run(prepared['execution']['steps'][0]['run_id'])
        self.assertEqual(run['environment_snapshot']['name'],'Explicit changed registration')
        self.assertNotEqual(prepared['execution']['steps'][0]['runtime_observation']['environment_sha256'],value['execution']['snapshot']['steps'][0]['configuration']['environment_sha256'])
        self.assertEqual(self.service.store.list('project'), before); self.assertEqual(len(self.service.store.runs()), self.baseline_runs+1)

    def test_failed_output_findings_remain_failed_while_completed_process_can_feed_independent_fixed_step(self):
        value = self.create(); manifest = Path(value['workflow']['root']) / 'workflow.json'; manifest.write_text('{"status":"passed","run_ids":["fake"]}')
        value = self.call('read', {'execution_id': value['execution']['id']}); self.assertEqual(value['execution']['status'], 'planned')
        value = self.complete(self.execute(self.prepare(value)))
        run = self.service.store.run(value['execution']['steps'][0]['run_id'])
        (Path(run['directory']) / 'results/smoke-result.json').write_text('{"status":"passed","case":"worker","pid":1}')
        stale = self.call('status', {'execution_id': value['execution']['id']})
        self.assertEqual(stale['execution']['steps'][0]['status'], 'completed'); self.assertEqual(stale['execution']['steps'][0]['run_status'],'succeeded');self.assertEqual(stale['execution']['steps'][0]['evidence']['status'],'failed')
        self.assertIn('Reference output failed', stale['execution']['steps'][0]['reason'])
        self.assertTrue(stale['execution']['steps'][1]['eligible']);self.prepare(stale, 'second')
        self.assertEqual(len(self.service.store.runs()), self.baseline_runs + 2)

    def test_benign_policy_change_does_not_revoke_authorized_configuration(self):
        value=self.create();project=self.service.store.get('project','compute');project['policy']['max_concurrent']=2;self.service.register_project(project)
        current=self.call('status',{'execution_id':value['execution']['id']});self.assertTrue(current['execution']['steps'][0]['eligible'])
        prepared=self.prepare(current);self.assertEqual(prepared['execution']['steps'][0]['status'],'prepared')
        self.assertEqual(prepared['execution']['steps'][0]['check_findings'][0]['status'],'warning')

    def test_explicit_engine_authorization_revocation_cannot_create_an_attempt(self):
        value=self.create();project=self.service.store.get('project','compute');project['policy']['engines']=[];self.service.register_project(project)
        current=self.call('status',{'execution_id':value['execution']['id']});self.assertEqual(current['execution']['status'],'stale')
        with self.assertRaises(PermissionError):self.prepare(current)
        self.assertEqual(len(self.service.store.runs()),self.baseline_runs)

    def test_explicit_project_grant_change_blocks_prepared_step_without_submission(self):
        value = self.prepare(self.create()); run_id = value['execution']['steps'][0]['run_id']
        changed = self.service.store.get('project', 'compute'); changed['policy']['max_seconds'] = 10
        changed = self.service.register_project(changed)
        stale = self.call('status', {'execution_id': value['execution']['id']})
        self.assertEqual(stale['execution']['status'], 'stale')
        self.assertIn('Duration exceeds', stale['execution']['reason'])
        with patch.object(self.service, 'submit', side_effect=AssertionError('Changed authorization cannot submit')):
            with self.assertRaises(PermissionError): self.execute(stale)
        self.assertEqual(self.service.store.run(run_id)['status'], 'draft')
        self.assertEqual(self.service.store.get('project', 'compute'), changed)

    def test_installed_program_change_blocks_even_an_unchanged_prepared_snapshot(self):
        value = self.prepare(self.create()); step = value['execution']['steps'][0]
        installed = Path(self.active['execution_skill']['facts']['functions'][0]['installed_entrypoint'])
        installed.write_text('Changed owned fixture source; never execute')
        stale = self.call('status', {'execution_id': value['execution']['id']})
        self.assertEqual(stale['execution']['status'], 'stale'); self.assertIn('Installed tool changed', stale['execution']['reason'])
        with patch.object(self.service, 'submit', side_effect=AssertionError('Stale installation cannot submit')):
            with self.assertRaises(PermissionError): self.execute(stale)
        self.assertEqual(self.service.store.run(step['run_id'])['status'], 'draft')

    def test_environment_change_during_real_target_validation_is_rechecked_before_submit(self):
        from studio_worker.tools.adapters import Adapter
        value = self.prepare(self.create()); original = Adapter.validate
        def validation(adapter, run, environment, directory, **kwargs):
            result = original(adapter, run, environment, directory, **kwargs)
            if run.get('studio_workflow_binding'):
                changed = self.service.store.get('environment', 'python'); changed['name'] = 'Changed during validation'
                self.service.register_environment(changed)
            return result
        with patch.object(Adapter, 'validate', validation):
            submitted=self.execute(value)
        run = self.service.store.run(value['execution']['steps'][0]['run_id'])
        self.assertEqual(run['status'], 'queued'); self.assertEqual(run['validation']['status'], 'passed')
        self.assertEqual(run['environment_snapshot']['name'],'Existing system interpreter fixture')
        self.assertEqual(submitted['execution']['steps'][0]['check_findings'][0]['code'],'configuration_environment_changed')

    def test_linked_workspace_workflow_parent_cannot_redirect_new_directories(self):
        outside = self.root / 'outside'; outside.mkdir()
        parent = self.service.root / 'projects' / self.workspace['id'] / 'workflows'
        parent.symlink_to(outside, target_is_directory=True)
        before = copy.deepcopy(self.service.store.list('project'))
        with self.assertRaises((OSError, ValueError)): self.create()
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual(self.service.store.list('workflow'), [])
        self.assertEqual(self.service.store.list('project'), before)
        self.assertEqual(len(self.service.store.runs()), self.baseline_runs)

    def test_reopen_observes_nested_detached_run_and_does_not_advance_next_step(self):
        value = self.execute(self.prepare(self.create())); self.service.tick()
        old_root = self.service.root; original_run = value['execution']['steps'][0]['run_id']
        supervisor = self.service.processes[original_run]
        self.addCleanup(lambda: supervisor.wait(timeout=10))
        self.service.close(); self.service.store.db.close(); self.service = Service(old_root, schedule=False)
        self.addCleanup(self.service.store.db.close); self.addCleanup(self.service.close); self.api = ToolWorkflows(self.service)
        with patch.object(self.service, 'prepare', side_effect=AssertionError('Restart must not prepare')):
            value = self.complete(value)
        self.assertEqual(value['execution']['steps'][0]['run_id'], original_run)
        self.assertEqual(value['execution']['steps'][1]['status'], 'pending')
        self.assertEqual(len(self.service.store.runs()), self.baseline_runs + 1)

    def test_legacy_descriptive_workflow_and_flat_run_directory_remain_unchanged(self):
        legacy = dispatch(self.service, 'POST', '/api/workflows', {'project_id': 'compute', 'name': 'Legacy descriptions', 'steps': ['Describe only']}, admin=False)
        entry = self.active['execution_skill']['facts']['functions'][0]['installed_entrypoint']
        run = self.service.prepare({'project_id': 'compute', 'environment_id': 'python', 'engine': 'installation.check', 'gpu': 0, 'max_seconds': 30, 'inputs': {'run.py': entry}, 'parameters': {'installation_case': 'worker'}, 'workflow_id': legacy['id'], 'idempotency_key': 'legacy-reference', 'directory_name': 'legacy'})
        self.assertEqual(Path(run['directory']).parent, self.service.root / 'runs')
        self.assertNotIn('studio_workflow_binding', run)
        self.assertEqual(self.service.store.get('workflow', legacy['id'])['run_ids'], [run['id']])
        self.assertEqual(self.service.validate(run['id'])['status'], 'ready')
        self.assertEqual(self.service.submit(run['id'])['status'], 'queued')


if __name__ == '__main__': unittest.main()
