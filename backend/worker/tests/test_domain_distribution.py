"""Moved implementation and compatibility/CLI boundaries; synthetic engineering only."""
import importlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))


class DomainDistributionTests(unittest.TestCase):
    def test_service_methods_have_real_domain_owners_and_legacy_namespace(self):
        from studio_worker.service import Service
        from studio_worker.compute.service import Service as Owner
        self.assertIs(Service, Owner)
        expected = {
            'register_project': 'compute.registrations', 'authorize': 'compute.registrations',
            'prepare': 'compute.runs', 'validate': 'compute.runs', 'submit': 'compute.runs',
            'tick': 'compute.scheduler', 'input_file': 'workspace.run_inputs',
            'file': 'workspace.run_artifacts', 'export': 'workspace.run_artifacts',
            'inspect': 'tools.operations',
        }
        for method, module in expected.items():
            with self.subTest(method=method):
                self.assertEqual(getattr(Service, method).__module__, 'studio_worker.' + module)
        with tempfile.TemporaryDirectory() as root:
            service = Service(root, schedule=False)
            try:
                with patch.object(service, 'authorize', side_effect=PermissionError('owned hook')):
                    with self.assertRaisesRegex(PermissionError, 'owned hook'):
                        service.prepare({'engine': 'installation.check', 'project_id': 'missing', 'environment_id': 'missing', 'gpu': 0, 'max_seconds': 1, 'idempotency_key': 'owned-hook', 'inputs': {'run.py': 'unused'}, 'parameters': {'check': 'worker'}})
            finally:
                service.close()
                service.store.db.close()

    def test_kept_entrypoints_and_retired_shims_follow_domain_layout(self):
        for domain, names in {
            'compute': ('cluster', 'runner', 'service'),
            'workspace': ('composition_store',),
            'tools': ('adapters', 'derivative_selection', 'derivatives', 'engine_contracts', 'neb_checks', 'science_checks', 'scientific', 'source_git_identity', 'structure_tools', 'templates'),
            'infrastructure': ('util',),
            'transport': ('server',),
        }.items():
            for name in names:
                with self.subTest(kept_module=name):
                    self.assertIs(importlib.import_module('studio_worker.' + name), importlib.import_module('studio_worker.' + domain + '.' + name))
        for domain, names in {
            'compute': ('compute_setup', 'run_environment_identity', 'runtime_guides', 'runtime_service', 'ssh_auth', 'ssh_auth_pty', 'ssh_tunnel'),
            'workspace': ('authoring_workspace', 'custom_cv_graph', 'custom_cv_registry', 'custom_cv_service', 'private_lineage', 'pygas_composition', 'workspace_io', 'workspace_materialize'),
            'tools': ('cell_derivative_contract', 'custom_cv_catalog', 'custom_cv_command', 'custom_cv_numerics', 'custom_formula', 'environment_api', 'pygas_catalog', 'pygas_dimensions', 'pygas_order', 'pygas_settings', 'pygas_values', 'software_contracts', 'source_projects'),
            'infrastructure': ('store',),
            'transport': ('runtime_projection', 'task_schema'),
        }.items():
            for name in names:
                with self.subTest(retired_module=name):
                    self.assertTrue((WORKER / 'studio_worker' / domain / f'{name}.py').is_file())
                    self.assertFalse((WORKER / 'studio_worker' / f'{name}.py').exists())
        from studio_worker import server
        with patch('studio_worker.server.dispatch', return_value={'id': 'existing', 'status': 'failed'}) as observed:
            result = server.mcp_tool_call(object(), {'name': 'run_status', 'arguments': {'run_id': 'existing'}})
        observed.assert_called_once()
        self.assertEqual(json.loads(result['content'][0]['text'])['status'], 'failed')

    def test_direct_scientific_script_reaches_actual_owner_without_engine_import(self):
        # Empty NEP regression directory exercises the stdlib JSON protocol only.
        with tempfile.TemporaryDirectory() as root:
            result = subprocess.run([sys.executable, '-I', '-B', str(WORKER / 'studio_worker/scientific.py'), 'regression'], input=json.dumps({'path': root}), text=True, capture_output=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['metrics'], {name: {'status': 'not_run'} for name in ('energy', 'force', 'virial')})

    def test_remote_manifest_includes_actual_owner_without_control_or_private_resources(self):
        from studio_worker.infrastructure.remote_resources import validation_resources
        resources = dict(validation_resources())
        for path in ('scientific.py', 'tools/scientific.py', 'tools/adapters.py', 'infrastructure/util.py', 'workspace/composition_store.py', 'engine_contracts.json'):
            self.assertEqual(resources[path], (WORKER / 'studio_worker' / path).read_bytes())
        self.assertFalse(any('ssh_auth' in name or 'configurations' in name or 'server.py' in name for name in resources))


if __name__ == '__main__':
    unittest.main()
