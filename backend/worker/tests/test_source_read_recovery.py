"""Pure source reads and authorized numeric-output import regressions; no engine imports."""
import hashlib
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker import server
from studio_worker.tools import software_contracts
from studio_worker.workspace import workspace_io
from studio_worker.service import Service


class SourceReadRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = {'id': 'hotpp', 'root': str(self.root / 'source')}
        self.code = Path(self.source['root']) / 'hotpp/entrypoints/train.py'
        self.code.parent.mkdir(parents=True)
        self.code.write_text("DefaultPara = {0: None, '0': -1.0, 'device': dangerous_not_executed()}\ndef main(value=None):\n return value\ndef get_model(config):\n return config\n")
        self.service = types.SimpleNamespace(store=types.SimpleNamespace(get=lambda kind, key: self.source))

    def tearDown(self):
        self.temp.cleanup()

    def call(self, arguments):
        result = server.mcp_tool_call(self.service, {'name': 'inspect_source_project', 'arguments': {'source_id': 'hotpp', **arguments}})
        return result, json.loads(result['content'][0]['text'])

    def test_exact_advertised_excerpts_and_typed_defaults_never_execute(self):
        result, value = self.call({'api_symbols': ['hotpp/entrypoints/train.py::DefaultPara', 'hotpp/entrypoints/train.py::main']})
        self.assertFalse(result.get('isError'))
        contract = value['public_api_contract']
        self.assertTrue(contract['partial'])
        excerpts = contract['api_excerpts']['symbols']
        self.assertEqual(len(excerpts), 2)
        self.assertEqual(excerpts[0]['source']['sha256'], hashlib.sha256(self.code.read_bytes()).hexdigest())
        entries = excerpts[0]['default_tree']['tree']['entries']
        self.assertEqual(entries[0]['key']['value'], 0)
        self.assertEqual(entries[1]['key']['value'], '0')
        self.assertIsNone(entries[0]['value']['value'])
        self.assertEqual(entries[2]['value']['evaluation'], 'not_evaluated')

    def test_mcp_invalid_class_and_stale_id_fail_before_dispatch(self):
        for args in ({'symbols': ['hotpp/entrypoints/train.py::main']}, {'api_symbols': ['hotpp/entrypoints/train.py::not_advertised']}):
            with mock.patch.object(server, 'dispatch', side_effect=AssertionError('Must not dispatch')) as dispatch:
                result, value = self.call(args)
            self.assertTrue(result['isError'])
            self.assertEqual((value['status'], value['operation_state']), ('blocked', 'not_started'))
            self.assertFalse(dispatch.called)
            self.assertFalse(value['automatic_retry'])

    def test_budget_blocks_aggregate_instead_of_truncating_success(self):
        self.code.write_text('def main():\n return ' + repr('x' * 16500) + '\n')
        result, value = self.call({'api_symbols': ['hotpp/entrypoints/train.py::main']})
        self.assertTrue(result['isError'])
        self.assertEqual(value['operation_state'], 'not_started')
        with self.assertRaises(ValueError):
            software_contracts.inspect_contract(self.source, ['hotpp/entrypoints/train.py::main'])

    def test_selection_limit_and_linked_source_do_not_broaden_read_scope(self):
        with self.assertRaises(ValueError):
            software_contracts.inspect_contract(self.source, ['hotpp/entrypoints/train.py::main'] * 5)
        outside = self.root / 'outside.py'
        outside.write_text('def main():\n return "not public"\n')
        self.code.unlink()
        self.code.symlink_to(outside)
        result, value = self.call({'api_symbols': ['hotpp/entrypoints/train.py::main']})
        self.assertTrue(result['isError'])
        self.assertEqual(value['operation_state'], 'not_started')
        self.assertNotIn('not public', json.dumps(value))

    def test_postdispatch_pure_read_failure_is_truthfully_read_started(self):
        with mock.patch.object(server, 'dispatch', side_effect=PermissionError('Synthetic read denied')):
            result, value = self.call({})
        self.assertTrue(result['isError'])
        self.assertEqual((value['status'], value['code'], value['operation_state']), ('blocked', 'source_read_failed', 'read_started'))
        self.assertFalse(value['automatic_retry'])
        self.assertNotIn('unconfirmed', value.values())

    def test_real_input_root_denial_no_outside_body_and_writers_remain_unknown(self):
        approved = self.root / 'approved'
        approved.mkdir()
        project = {'id': 'project', 'policy': {'input_roots': [str(approved)]}}
        service = types.SimpleNamespace(root=self.root / 'not-created', input_name=Service.input_name, store=types.SimpleNamespace(get=lambda *args: project, runs=lambda: [], put=mock.Mock(side_effect=AssertionError('No writes'))))
        with mock.patch.object(workspace_io, 'digest', side_effect=AssertionError('Outside file must not be read')):
            result = server.mcp_tool_call(service, {'name': 'read_project_input', 'arguments': {'project_id': 'project', 'name': str(self.root / 'outside.py')}})
        value = json.loads(result['content'][0]['text'])
        self.assertEqual((value['code'], value['operation_state']), ('input_read_failed', 'read_started'))
        self.assertIn('inspect_source_project', value['next_step'])
        self.assertFalse(service.store.put.called)
        self.assertFalse(service.root.exists())
        for name in ('write_project_input', 'probe_environment', 'collect_artifacts'):
            with mock.patch.object(server, 'dispatch', side_effect=RuntimeError('Uncertain dispatched operation')):
                args = {'project_id': 'project', 'name': 'file.txt', 'content': 'text'} if name == 'write_project_input' else {'environment_id': 'env'} if name == 'probe_environment' else {'run_id': 'run'}
                value = json.loads(server.mcp_tool_call(service, {'name': name, 'arguments': args})['content'][0]['text'])
                self.assertEqual((value['status'], value['operation_state']), ('unknown', 'unconfirmed'))


class NumericOutputImportTests(unittest.TestCase):
    def test_owned_run_outputs_import_all_bytes_without_widening_policy(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            service = Service(folder / 'worker', schedule=False)
            try:
                service.register_environment({'id': 'env', 'name': 'Synthetic', 'executables': {'python': sys.executable}})
                approved = folder / 'approved'
                approved.mkdir()
                project = service.register_project({'id': 'project', 'name': 'Synthetic', 'policy': {'input_roots': [str(approved)], 'environments': ['env'], 'engines': ['nep.analyze'], 'gpus': [0]}})
                producer = service.root / 'runs/producer/results'
                producer.mkdir(parents=True)
                service.store.add_run({'id': 'producer', 'project_id': 'project', 'idempotency_key': 'producer', 'request_hash': 'synthetic', 'status': 'succeeded', 'directory': str(producer.parent)})
                files = {'energy_test.out': b'1 2\n', 'force_test.out': b'1 2 3 4 5 6\n', 'virial_test.out': b'1 2 3\n', 'evaluation.json': b'{}\n'}
                for name, data in files.items():
                    (producer / name).write_bytes(data)
                context = server.dispatch(service, 'POST', '/api/authoring/context', {'workspace_id': 'task', 'project_id': 'project', 'selected_paths': [str(producer / name) for name in files]}, admin=True)
                self.assertEqual(len(context['imports']), 4)
                for item in context['imports']:
                    target = Path(item['path'])
                    self.assertEqual(target.read_bytes(), files[target.name])
                    self.assertEqual(item['sha256'], hashlib.sha256(files[target.name]).hexdigest())
                self.assertEqual(service.store.get('project', 'project'), project)
                for bad in (folder / 'outside.out', approved / 'private/skills/test.out'):
                    bad.parent.mkdir(parents=True, exist_ok=True)
                    bad.write_text('not an approved numeric input')
                    with self.assertRaises(ValueError):
                        server.dispatch(service, 'POST', '/api/authoring/context', {'workspace_id': 'task', 'project_id': 'project', 'selected_paths': [str(bad)]}, admin=True)
            finally:
                service.close()
                service.store.db.close()
