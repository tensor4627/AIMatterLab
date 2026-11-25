# Consolidated suite generated from: test_engine_contracts.py, test_gpu_parse.py, test_install_probe.py, test_install_resources.py, test_mcp_protocol.py, test_mcp_schema_cache.py, test_neb.py, test_science_smoke_config.py, test_task_schema.py, test_tool_guidance_state.py, test_tools_domain.py, test_transfer_bounds.py, test_workflow_roadmap.py
import sys, unittest
from pathlib import Path
if str(Path(__file__).resolve().parents[1]) not in sys.path: sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# --- section: test_engine_contracts.py ---
import ast, json, tempfile, unittest
from pathlib import Path as _s0_Path
from studio_worker.engine_contracts import describe, CONTRACTS
from studio_worker.adapters import ENGINES
from studio_worker.server import dispatch as _s0_dispatch, tools as _s0_tools
from studio_worker.service import Service as _s0_Service
class EngineContracts(unittest.TestCase):

    def test_generated_worker_resource_matches_the_canonical_contract(self):
        worker = _s0_Path(__file__).resolve().parents[1]
        canonical = worker.parent.parent / 'contracts/tools/engine-contracts.json'
        self.assertEqual((worker / 'studio_worker/engine_contracts.json').read_bytes(), canonical.read_bytes())
        self.assertEqual(CONTRACTS, json.loads(canonical.read_text(encoding='utf-8')))

    def test_public_contracts_cover_every_registered_engine_and_actual_required_calls(self):
        self.assertEqual(set(CONTRACTS['engines']), set(ENGINES))
        for engine in ENGINES:
            self.assertEqual(describe(engine)['runtime_validation'], 'not_run')
        source = (_s0_Path(__file__).parents[1] / 'studio_worker/tools/adapters.py').read_text()
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and (node.func.attr == 'parameters') and (len(node.args) > 1) and isinstance(node.args[1], ast.Tuple):
                keys = set(ast.literal_eval(node.args[1]))
                self.assertTrue(any((keys == set(c['required_parameters']) for c in CONTRACTS['engines'].values())), keys)

    def test_mcp_discovery_is_read_only_and_cannot_grant_an_environment(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = _s0_Service(_s0_Path(tmp), schedule=False)
            try:
                value = _s0_dispatch(s, 'POST', '/api/engine/describe', {'engine': 'pydyn.sampling'}, admin=False)
                self.assertEqual(value['required_parameters'], ['bias_file', 'structure_file', 'cv_size', 'cutoff', 'mode'])
                self.assertEqual(s.store.list('project'), [])
                tool = next((t for t in _s0_tools() if t['name'] == 'describe_engine'))
                self.assertTrue(tool['annotations']['readOnlyHint'])
            finally:
                s.close()
                s.store.db.close()

    def test_neb_declared_keys_match_the_real_input_checker(self):
        source = (_s0_Path(__file__).parents[1] / 'studio_worker/tools/neb_checks.py').read_text()
        tree = ast.parse(source)
        keys = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                if any((isinstance(target, ast.Name) and target.id == 'actual' for target in node.targets)) and isinstance(node.value, ast.Dict):
                    keys.update((k.value for k in node.value.keys))
                for target in node.targets:
                    if isinstance(target, ast.Subscript) and isinstance(target.value, ast.Name) and (target.value.id == 'actual') and isinstance(target.slice, ast.Constant):
                        keys.add(target.slice.value)
        self.assertEqual(keys, set(describe('gpumd.neb')['parameter_groups']['neb']['allowed_keys']))

# --- section: test_gpu_parse.py ---
import subprocess
import sys
import unittest
from types import SimpleNamespace as _s1_SimpleNamespace
from pathlib import Path as _s1_Path
sys.path.insert(0, str(_s1_Path(__file__).resolve().parents[1]))
from studio_worker.transport.routes import parse_gpu_rows
class GpuInventoryParseTest(unittest.TestCase):

    def test_standard_rows_parse(self):
        rows = parse_gpu_rows('0, NVIDIA GeForce RTX 4090, 1024, 24564, 12\n1, NVIDIA A100, 0, 40960, 0\n')
        self.assertEqual(rows, [{'id': 0, 'name': 'NVIDIA GeForce RTX 4090', 'memory_used': 1024, 'memory_total': 24564, 'utilization': 12}, {'id': 1, 'name': 'NVIDIA A100', 'memory_used': 0, 'memory_total': 40960, 'utilization': 0}])

    def test_irregular_spacing_blank_lines_and_crlf_are_tolerated(self):
        rows = parse_gpu_rows(' 0 ,  GPU X ,  7 ,  8 ,  9 \r\n\r\n')
        self.assertEqual(rows[0]['name'], 'GPU X')
        self.assertEqual(rows[0]['memory_used'], 7)
        self.assertEqual(len(rows), 1)

    def test_non_numeric_counters_become_null_instead_of_failing_inventory(self):
        rows = parse_gpu_rows('0, MIG 1g.5gb, [N/A], 4864, [N/A]\n')
        self.assertEqual(rows[0]['memory_used'], None)
        self.assertEqual(rows[0]['utilization'], None)
        self.assertEqual(rows[0]['memory_total'], 4864)

    def test_unparseable_output_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_gpu_rows('not nvidia output')
        with self.assertRaises(ValueError):
            parse_gpu_rows('x, GPU, 1, 2, 3')

    def test_empty_output_is_an_empty_inventory(self):
        self.assertEqual(parse_gpu_rows(''), [])
        self.assertEqual(parse_gpu_rows(None), [])

    def test_commas_inside_gpu_names_keep_all_counters(self):
        rows = parse_gpu_rows('0, NVIDIA A100, 80GB, 1024, 81920, 37\n')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['name'], 'NVIDIA A100, 80GB')
        self.assertEqual(rows[0]['memory_used'], 1024)
        self.assertEqual(rows[0]['memory_total'], 81920)
        self.assertEqual(rows[0]['utilization'], 37)
from studio_worker.transport.routes import gpu_inventory
class GpuInventoryAvailabilityTest(unittest.TestCase):

    def test_successful_inventory_is_parsed(self):

        def run(*args, **kwargs):
            self.assertIn('nvidia-smi', args[0][0])
            return _s1_SimpleNamespace(returncode=0, stdout='0, GPU A, 1, 2, 3\n', stderr='')
        self.assertEqual(gpu_inventory(run)[0]['name'], 'GPU A')

    def test_missing_or_timed_out_driver_is_an_empty_inventory(self):
        for error in (FileNotFoundError('nvidia-smi'), subprocess.TimeoutExpired('nvidia-smi', 10), OSError('unavailable')):
            with self.subTest(error=type(error).__name__):

                def run(*args, _error=error, **kwargs):
                    raise _error
                self.assertEqual(gpu_inventory(run), [])

    def test_nonzero_exit_is_an_empty_inventory(self):

        def run(*args, **kwargs):
            return _s1_SimpleNamespace(returncode=9, stdout='', stderr='driver not loaded')
        self.assertEqual(gpu_inventory(run), [])

# --- section: test_install_probe.py ---
import contextlib, hashlib, importlib.util, io, json, sys, tempfile, types, unittest
from pathlib import Path as _s2_Path
from unittest.mock import patch as _s2_patch
_s2_ROOT = _s2_Path(__file__).resolve().parents[3]
_s2_ROOT = _s2_ROOT if (_s2_ROOT / 'backend/worker').is_dir() else _s2_Path.cwd()
_s2_spec = importlib.util.spec_from_file_location('probe_runtime', _s2_ROOT / 'installation/runtime.py')
runtime = importlib.util.module_from_spec(_s2_spec)
_s2_spec.loader.exec_module(runtime)
class InstallProbe(unittest.TestCase):

    def test_probe_hashes_registered_files_without_executing_them_or_changing_configuration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _s2_Path(tmp)
            native = root / 'engine'
            native.write_text('#!/bin/sh\nexit 99\n', encoding='utf-8')
            native.chmod(448)
            cfg = {'compute': {'environment': {'executables': {'python': sys.executable, 'gpu-sampling': str(native)}, 'repositories': {}, 'variables': {}}}}

            def run(argv, **kwargs):
                self.assertEqual(argv[:2], [sys.executable, '-c'])
                self.assertEqual(kwargs['env']['PYTHONDONTWRITEBYTECODE'], '1')
                return json.dumps({'python': '3.10', 'executable': sys.executable, 'modules': {'torch': {'status': 'blocked'}}, 'cuda': {}})
            with _s2_patch.object(runtime, 'run', side_effect=run) as calls:
                result = runtime.probe(cfg)
            self.assertEqual(result['status'], 'passed')
            self.assertEqual(calls.call_count, 1)
            self.assertEqual(result['executables']['gpu-sampling']['sha256'], hashlib.sha256(native.read_bytes()).hexdigest())
            self.assertEqual(result['observation']['executable'], sys.executable)
            self.assertIn('no native engine launch', result['scope'].lower())
            self.assertEqual(cfg['compute']['environment']['variables'], {})

    def test_pygas_cannot_resolve_a_generic_base_package_without_a_registered_source(self):
        cfg = {'compute': {'environment': {'executables': {'python': sys.executable}, 'repositories': {}, 'variables': {}}}}

        def child(argv, **kwargs):
            self.assertEqual(argv[:2], [sys.executable, '-c'])
            output = io.StringIO()
            with _s2_patch('importlib.util.find_spec', side_effect=lambda name: object() if name == 'base' else None) as find, _s2_patch('importlib.import_module', return_value=types.SimpleNamespace(__file__='/other/base.py')) as imported, contextlib.redirect_stdout(output):
                exec(compile(argv[2], '<probe>', 'exec'), {})
            imported.assert_not_called()
            self.assertNotIn('base', [call.args[0] for call in find.call_args_list])
            return output.getvalue()
        with _s2_patch.object(runtime, 'run', side_effect=child):
            result = runtime.probe(cfg)
        self.assertEqual(result['observation']['modules']['pygas']['status'], 'blocked')

    def test_explicit_missing_python_blocks_without_launching_any_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = {'compute': {'environment': {'executables': {'python': str(_s2_Path(tmp) / 'absent')}, 'repositories': {}, 'variables': {}}}, 'cases': ['worker']}
            with _s2_patch.object(runtime, 'run') as run:
                result = runtime.probe(cfg)
            self.assertEqual(result['status'], 'blocked')
            self.assertEqual(result['python_check']['status'], 'blocked')
            run.assert_not_called()

    def test_explicit_nonexecutable_file_blocks_even_when_python_imports_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            native = _s2_Path(tmp) / 'engine'
            native.write_text('never execute', encoding='utf-8')
            cfg = {'compute': {'environment': {'executables': {'python': sys.executable, 'gpumd': str(native)}, 'repositories': {}, 'variables': {}}}, 'cases': ['worker']}
            with _s2_patch.object(runtime, 'run', return_value=json.dumps({'python': '3.12', 'executable': sys.executable, 'modules': {}, 'cuda': {}})), _s2_patch.object(runtime.os, 'access', side_effect=lambda file, mode: _s2_Path(file) != native):
                result = runtime.probe(cfg)
            self.assertEqual(result['status'], 'blocked')
            self.assertEqual(result['executables']['gpumd']['status'], 'blocked')

    def test_selected_case_requires_real_imports_while_optional_modules_do_not_block(self):
        cfg = {'compute': {'environment': {'executables': {'python': sys.executable}, 'repositories': {}, 'variables': {}}}, 'cases': ['reference-md']}
        observed = {'python': '3.12', 'executable': sys.executable, 'modules': {'ase': {'status': 'passed'}, 'numpy': {'status': 'blocked'}, 'torch': {'status': 'blocked'}}, 'cuda': {}}
        with _s2_patch.object(runtime, 'run', return_value=json.dumps(observed)):
            result = runtime.probe(cfg)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['required_modules']['numpy']['status'], 'blocked')
        self.assertNotIn('torch', result['required_modules'])
        observed['modules']['numpy']['status'] = 'passed'
        with _s2_patch.object(runtime, 'run', return_value=json.dumps(observed)):
            result = runtime.probe(cfg)
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(result['observation']['modules']['torch']['status'], 'blocked')
        cfg['cases'] = ['pydyn-md']
        observed['modules'].update(pydyn={'status': 'passed'}, cupy={'status': 'blocked'})
        with _s2_patch.object(runtime, 'run', return_value=json.dumps(observed)):
            result = runtime.probe(cfg)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['required_modules']['cupy']['status'], 'blocked')
        self.assertNotIn('torch', result['required_modules'])

    def test_registered_repository_missing_or_unidentified_blocks_without_altering_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _s2_Path(tmp)
            cfg = {'compute': {'environment': {'executables': {'python': sys.executable}, 'repositories': {'pygas': str(root / 'absent')}, 'variables': {}}}, 'cases': ['worker']}
            observed = {'python': '3.12', 'executable': sys.executable, 'modules': {}, 'cuda': {}}
            with _s2_patch.object(runtime, 'run', return_value=json.dumps(observed)):
                result = runtime.probe(cfg)
            self.assertEqual(result['status'], 'blocked')
            self.assertEqual(result['repositories']['pygas']['status'], 'blocked')
            self.assertFalse((root / 'absent').exists())
            cfg['compute']['environment']['repositories']['pygas'] = str(root)
            with _s2_patch.object(runtime, 'run', return_value=json.dumps(observed)), _s2_patch.object(runtime.subprocess, 'run', return_value=types.SimpleNamespace(returncode=1, stdout='')):
                result = runtime.probe(cfg)
            self.assertEqual(result['status'], 'blocked')
            self.assertEqual(result['repositories']['pygas']['status'], 'blocked')
            self.assertEqual(list(root.iterdir()), [])

    def test_audit_smoke_rejects_nonempty_unowned_worker_before_opening_service(self):
        sys.path.insert(0, str(_s2_ROOT / 'backend/worker'))
        with tempfile.TemporaryDirectory() as tmp:
            root = _s2_Path(tmp)
            database = root / 'studio.sqlite'
            database.write_bytes(b'production registration database')
            before = {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in root.iterdir()}
            cfg = {'_suite_root': str(_s2_ROOT), 'worker': {'root': str(root)}, '_reuse_guard': {'fingerprint': 'current', 'audit_id': 'audit'}}
            with _s2_patch('studio_worker.service.Service') as service:
                with self.assertRaises(ValueError):
                    runtime.smoke(cfg)
            service.assert_not_called()
            self.assertEqual({f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in root.iterdir()}, before)

    def test_installer_loader_policy_preserves_existing_variables_but_forbids_source_bytecode_writes(self):
        environment = {'repositories': {}, 'variables': {'PYTHONDONTWRITEBYTECODE': '1', 'OPENBLAS_NUM_THREADS': '1', 'NUMEXPR_NUM_THREADS': '1'}}
        self.assertEqual(runtime.target_env(environment)['PYTHONDONTWRITEBYTECODE'], '1')
        self.assertEqual(environment['variables']['PYTHONDONTWRITEBYTECODE'], '1')
        for key, value in [('PYTHONDONTWRITEBYTECODE', '0'), ('UNAPPROVED_ENV', '1')]:
            with self.assertRaises(ValueError):
                runtime.target_env({'repositories': {}, 'variables': {key: value}})

# --- section: test_install_resources.py ---
'Actual immutable deployment must carry the catalog adapter used by the worker.'
import hashlib
import json
from pathlib import Path as _s3_Path
import shutil
import subprocess
import sys
import tempfile
import unittest
class InstallResourcesTests(unittest.TestCase):

    def test_catalog_adapter_is_deployed_versioned_and_allowlisted(self):
        source = _s3_Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            base = _s3_Path(directory)
            fixture = base / 'source'
            shutil.copytree(source, fixture, ignore=shutil.ignore_patterns('__pycache__', 'tests'))
            (fixture / 'studio_worker' / 'unrelated-private.json').write_text('{"private": true}')

            def install():
                result = subprocess.run([sys.executable, str(fixture / 'install.py'), '--source', str(fixture), '--root', str(base / 'runtime')], check=True, capture_output=True, text=True)
                return json.loads(result.stdout)
            first = install()
            runtime = _s3_Path(first['path'])
            relative = _s3_Path('studio_worker/pygas-editor-hints.json')
            self.assertEqual((runtime / relative).read_bytes(), (fixture / relative).read_bytes())
            self.assertFalse((runtime / 'studio_worker/unrelated-private.json').exists())
            self.assertEqual((runtime / 'studio_worker/engine_contracts.json').read_bytes(), (fixture / 'studio_worker/engine_contracts.json').read_bytes())
            self.assertEqual(first, install())
            original = (runtime / relative).read_bytes()
            (fixture / relative).write_bytes(original + b'\n')
            second = install()
            self.assertNotEqual(first['id'], second['id'])
            self.assertEqual((runtime / relative).read_bytes(), original)
            self.assertEqual((_s3_Path(second['path']) / relative).read_bytes(), original + b'\n')
            self.assertEqual(hashlib.sha256((runtime / relative).read_bytes()).hexdigest(), hashlib.sha256(original).hexdigest())

# --- section: test_mcp_protocol.py ---
import sys, unittest, json, tempfile, io
from pathlib import Path as _s4_Path
from unittest.mock import patch as _s4_patch
sys.path.insert(0, str(_s4_Path(__file__).resolve().parents[1]))
from studio_worker.server import mcp_tool_call as _s4_mcp_tool_call
from studio_worker.service import Service as _s4_Service
from studio_worker.transport.http_handler import handler_factory
class McpProtocol(unittest.TestCase):

    def initialize(self, *, credential='mcp', origin=None):
        calls = []
        responses = []

        def forbidden(*args, **kwargs):
            calls.append((args, kwargs))
            raise AssertionError('Initialize must not dispatch a tool or change project authorization')
        handler_type = handler_factory(None, {'admin': 'synthetic-admin', 'mcp': 'synthetic-mcp'}, dispatch=forbidden, mcp_tool_call=forbidden, tools=forbidden)
        handler = handler_type.__new__(handler_type)
        request = json.dumps({'jsonrpc': '2.0', 'id': 'initialize-test', 'method': 'initialize', 'params': {}}).encode()
        handler.path = '/mcp'
        handler.headers = {'Authorization': 'Bearer synthetic-' + credential, 'Content-Length': str(len(request))}
        if origin is not None:
            handler.headers['Origin'] = origin
        handler.rfile = io.BytesIO(request)
        handler.respond = lambda status, value=None: responses.append((status, value))
        handler.handle_request('POST')
        return (responses, calls)

    def test_http_initialize_preserves_delegated_iteration_and_explicit_no_run_limits(self):
        for credential in ('mcp', 'admin'):
            responses, calls = self.initialize(credential=credential)
            self.assertEqual(responses[0][0], 200)
            self.assertEqual(calls, [])
            result = responses[0][1]['result']
            self.assertEqual(result['capabilities'], {'tools': {}})
            instructions = result['instructions']
            for rule in ('existing project authorization', 'current user delegation', 'no-build, no-run and stop requests', 'without repeated approval', 'Serialized bias must be loaded in the actual target environment', 'AOTI must fail without fallback', 'Never automatically resubmit an unknown attempt'):
                self.assertIn(rule, instructions)
            self.assertNotIn('Only the desktop user', instructions)
            self.assertNotIn('review and stop', instructions)

    def test_http_initialize_cannot_bypass_credentials_or_browser_origin_boundary(self):
        for options, status in (({'credential': 'untrusted'}, 401), ({'origin': 'https://outside.invalid'}, 403)):
            responses, calls = self.initialize(**options)
            self.assertEqual(responses[0][0], status)
            self.assertNotIn('result', responses[0][1])
            self.assertEqual(calls, [])

    def test_malformed_and_unavailable_tools_never_dispatch(self):
        for params in (None, [], {}, {'name': 'unknown'}, {'name': 'submit_run'}, {'name': 'validate_run'}, {'name': 'present_task', 'arguments': []}, {'name': 'present_task', 'arguments': {}}, {'name': 'read_project_input', 'arguments': {'project_id': {}, 'name': 'a'}}):
            with self.subTest(params=params), _s4_patch('studio_worker.server.dispatch') as dispatch:
                result = _s4_mcp_tool_call(None, params)
                self.assertTrue(result['isError'])
                dispatch.assert_not_called()
                failure = json.loads(result['content'][0]['text'])
                self.assertEqual(failure['status'], 'blocked')
                self.assertFalse(failure['automatic_retry'])

    def test_real_catalog_read_still_uses_mcp_not_admin(self):
        with tempfile.TemporaryDirectory() as directory:
            service = _s4_Service(_s4_Path(directory), schedule=False)
            try:
                result = _s4_mcp_tool_call(service, {'name': 'list_projects'})
                self.assertFalse(result['isError'])
                self.assertEqual(json.loads(result['content'][0]['text']), [])
            finally:
                service.close()
                service.store.db.close()

    def test_failure_after_dispatch_is_unconfirmed_without_retry(self):
        with _s4_patch('studio_worker.server.dispatch', side_effect=TimeoutError('status response timed out')) as dispatch:
            result = _s4_mcp_tool_call(None, {'name': 'run_status', 'arguments': {'run_id': 'existing'}})
            failure = json.loads(result['content'][0]['text'])
            self.assertEqual(dispatch.call_count, 1)
            self.assertFalse(dispatch.call_args.kwargs['admin'])
            self.assertEqual(failure['status'], 'unknown')
            self.assertFalse(failure['automatic_retry'])

    def test_reading_a_failed_job_is_a_successful_tool_result(self):
        with _s4_patch('studio_worker.server.dispatch', return_value={'id': 'existing', 'status': 'failed'}):
            self.assertFalse(_s4_mcp_tool_call(None, {'name': 'run_status', 'arguments': {'run_id': 'existing'}})['isError'])

# --- section: test_mcp_schema_cache.py ---
import sys
import unittest
from pathlib import Path as _s5_Path
sys.path.insert(0, str(_s5_Path(__file__).resolve().parents[1]))
from studio_worker.transport.mcp import tools as _s5_tools
class McpSchemaCacheTest(unittest.TestCase):

    def test_tools_are_cached_but_callers_get_independent_copies(self):
        first, second = (_s5_tools(), _s5_tools())
        self.assertEqual(first, second)
        self.assertIsNot(first, second)
        self.assertGreater(len(first), 20)
        original = first[0]['name']
        first[0]['name'] = 'mutated-copy'
        self.assertEqual(_s5_tools()[0]['name'], original)

    def test_tool_names_are_unique_and_stable_between_calls(self):
        names = [item['name'] for item in _s5_tools()]
        self.assertEqual(len(names), len(set(names)))
        self.assertIn('present_task', names)
        self.assertIn('submit_run', names)
        self.assertIn('validate_run', names)

# --- section: test_neb.py ---
import importlib.util
import tempfile
import unittest
import sys
from pathlib import Path as _s6_Path
sys.path.insert(0, str(_s6_Path(__file__).resolve().parents[1]))
from studio_worker.adapters import Adapter
from studio_worker.neb_checks import contract, validate
from studio_worker.scientific import probe_modules
XYZ = '2\nLattice="10 0 0 0 10 0 0 0 10" Properties=species:S:1:pos:R:3 pbc="T T T"\nC 0 0 0\nC 1.5 0 0\n'
class NativeNEB(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = _s6_Path(self.tmp.name)
        for n in ['is.xyz', 'fs.xyz']:
            (self.root / n).write_text(XYZ)
        (self.root / 'nep.txt').write_text('nep4 1 C\n')
        self.inputs = {n: str(self.root / n) for n in ['run.in', 'is.xyz', 'fs.xyz', 'nep.txt']}
        self.write('potential ./nep.txt\nneb_set interpolate 5 p 30 no_ina\nneb_run fire 0.01 1000\n')

    def write(self, s):
        (self.root / 'run.in').write_text(s)

    def test_native_route_needs_no_model_xyz_or_bias(self):
        env = {'executables': {'gpu-sampling': sys.executable}}
        self.assertEqual(Adapter('gpumd.neb').prepare({'inputs': self.inputs, 'parameters': {}}, env), [sys.executable])
        self.assertEqual(probe_modules('gpumd.neb'), ('torch', 'ase'))

    def test_selected_bias_is_not_silently_ignored(self):
        with self.assertRaisesRegex(ValueError, 'not a bias'):
            Adapter('gpumd.neb').prepare({'inputs': self.inputs, 'parameters': {'bias_file': 'explicit.pt2'}}, {})

    def test_native_settings_and_declared_controls(self):
        r = contract(self.root, self.inputs, {'max_steps': 1000, 'force_tolerance': 0.01, 'cell_mode': 'variable', 'pressure_gpa': 30, 'interpolate': 5, 'ina': False})
        self.assertEqual(r['structure_files'], ['is.xyz', 'fs.xyz'])
        self.assertEqual(r['potential_files'], ['nep.txt'])

    def test_parameter_change_requires_matching_actual_input(self):
        with self.assertRaisesRegex(ValueError, 'differs from run.in'):
            contract(self.root, self.inputs, {'max_steps': 100})

    def test_explicit_fixed_cell(self):
        self.write('potential nep.txt\nneb_set no_vc interpolate 3\nneb_run fire 0.02 5\n')
        self.assertEqual(contract(self.root, self.inputs)['cell_mode'], 'fixed')

    def test_bundled_native_input_example_matches_the_worker_contract(self):
        import re
        guide = Path(__file__).resolve().parents[3] / 'agent/builtin-skills/studio-neb-workflow/references/native-input.md'
        text = guide.read_text(encoding='utf-8')
        self.write(re.search(r'```text\n(.*?)\n```', text, re.S)[1] + '\n')
        declared = json.loads(re.search(r'```json\n(.*?)\n```', text, re.S)[1])
        allowed = describe('gpumd.neb')['parameter_groups']['neb']['allowed_keys']
        self.assertLessEqual(set(declared), set(allowed))
        actual = contract(self.root, self.inputs, declared)
        self.assertEqual({key: actual[key] for key in declared}, declared)
        self.assertEqual(actual['structure_files'], ['is.xyz', 'fs.xyz'])

    def test_duplicate_native_run_and_md_mix_rejected(self):
        original = (self.root / 'run.in').read_text()
        for extra in ['run 5\n', 'minimize fire 0.1 5\n', 'neb_run fire 0.01 10\n']:
            self.write(original + extra)
            with self.assertRaisesRegex(ValueError, 'exactly one'):
                contract(self.root, self.inputs)

    def test_external_and_unsnapshotted_references_rejected(self):
        for name in ['/tmp/is.xyz', '../is.xyz', 'missing.xyz']:
            self.write('potential nep.txt\nneb_set is_name ' + name + '\nneb_run fire 0.01 10\n')
            with self.assertRaises(ValueError):
                contract(self.root, self.inputs)

    def test_missing_default_endpoint_rejected(self):
        self.inputs.pop('fs.xyz')
        with self.assertRaisesRegex(ValueError, 'not snapshotted'):
            contract(self.root, self.inputs)

    def test_nonfinite_and_unsupported_optimizer_rejected(self):
        for args in ['fire nan 10', 'fire 0 10', 'fire 0.01 0', 'lbfgs 0.01 10']:
            self.write('potential nep.txt\nneb_run ' + args + '\n')
            with self.assertRaises(ValueError):
                contract(self.root, self.inputs)

    def test_no_binary_format_substitution(self):
        self.write('potential nep.txt\noutput_format zbxyz precision lossless\nneb_run fire 0.01 10\n')
        with self.assertRaisesRegex(ValueError, 'binary paths'):
            contract(self.root, self.inputs)

    @unittest.skipUnless(importlib.util.find_spec('ase'), 'ASE geometry checks run separately in registered runtime')
    def test_real_xyz_geometry_and_species_gate(self):
        payload = {'directory': str(self.root), 'inputs': list(self.inputs)}
        r = validate(payload)
        self.assertEqual(r['n_atoms'], 2)
        self.assertEqual(r['scientific_status'], 'not_run')
        (self.root / 'fs.xyz').write_text(XYZ.replace('C 1.5', 'Si 1.5'))
        with self.assertRaisesRegex(ValueError, 'element order'):
            validate(payload)

    @unittest.skipUnless(importlib.util.find_spec('ase'), 'ASE geometry checks run separately in registered runtime')
    def test_mismatched_cell_and_potential_species(self):
        self.write('potential nep.txt\n# match_cell_to_initial is only a comment\nneb_set no_vc interpolate 3\nneb_run fire 0.01 10\n')
        (self.root / 'fs.xyz').write_text(XYZ.replace('10 0 0', '11 0 0', 1))
        with self.assertRaisesRegex(ValueError, 'matching cells'):
            validate({'directory': str(self.root), 'inputs': list(self.inputs)})
        (self.root / 'fs.xyz').write_text(XYZ)
        (self.root / 'nep.txt').write_text('nep4 1 Si\n')
        with self.assertRaisesRegex(ValueError, 'species'):
            validate({'directory': str(self.root), 'inputs': list(self.inputs)})

    def test_preparation_checks_declared_controls_before_a_draft_can_anchor_them(self):
        from studio_worker.service import Service
        service = Service(self.root / 'worker', schedule=False)
        try:
            service.register_environment({'id': 'e', 'name': 'test', 'executables': {'python': sys.executable, 'gpu-sampling': sys.executable}})
            service.register_project({'id': 'p', 'name': 'test', 'policy': {'engines': ['gpumd.neb'], 'environments': ['e'], 'input_roots': [str(self.root)], 'gpus': [0], 'max_seconds': 60, 'max_concurrent': 1}})
            spec = {'project_id': 'p', 'environment_id': 'e', 'engine': 'gpumd.neb', 'gpu': 0, 'max_seconds': 30, 'idempotency_key': 'bad', 'inputs': self.inputs, 'parameters': {'neb': {'max_steps': 3}}}
            with self.assertRaisesRegex(ValueError, 'differs from run.in'):
                service.prepare(spec)
            self.assertEqual(service.store.runs(), [])
            spec['parameters'] = {'neb': {'max_steps': 1000}}
            spec['idempotency_key'] = 'valid'
            run = service.prepare(spec)
            self.assertEqual(run['input_contract']['status'], 'passed')
            self.assertEqual(run['validation']['status'], 'not_run')
            self.assertIsNone(run['identity'])
        finally:
            service.close()
            service.store.db.close()

# --- section: test_science_smoke_config.py ---
import ast, builtins, contextlib, copy, importlib.util, io, json, tempfile, types, unittest
from pathlib import Path as _s7_Path
from unittest.mock import patch as _s7_patch
_s7_ROOT = _s7_Path(__file__).resolve().parents[3]
_s7_spec = importlib.util.spec_from_file_location('smoke_config', _s7_ROOT / 'scripts/science_smoke_config.py')
config = importlib.util.module_from_spec(_s7_spec)
_s7_spec.loader.exec_module(config)
class ScienceSmokeConfig(unittest.TestCase):

    def value(self, root):
        return {'schema_version': 1, 'base_dir': str(root / 'fresh'), 'python': str(root / 'registered-python'), 'sampling_repository': str(root / 'registered-sampling'), 'repositories': {key: str(root / key) for key in ('pydyn', 'pygas', 'hotpp')}, 'executables': {key: str(root / key) for key in ('gpumd', 'nep', 'gpu-sampling')}, 'skills': {'nep-regression-rmse': str(root / 'registered-skill')}}

    def write(self, root, value):
        file = root / 'private.json'
        file.write_text(json.dumps(value), encoding='utf-8')
        return file

    def test_explicit_config_loads_paths_without_creating_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _s7_Path(tmp)
            value = self.value(root)
            loaded = config.load_config(self.write(root, value))
            self.assertEqual(loaded, value)
            self.assertFalse((root / 'fresh').exists())

    def test_missing_config_and_help_return_without_scientific_import_or_mkdir(self):
        with _s7_patch.object(_s7_Path, 'mkdir', side_effect=AssertionError('No runtime directory')), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            for args, code in (([], 2), (['--help'], 0)):
                with self.subTest(args=args), self.assertRaises(SystemExit) as error:
                    config.parse_config_args(args, environ={})
                self.assertEqual(error.exception.code, code)

    def test_explicit_cli_takes_precedence_over_explicit_environment_reference(self):
        with _s7_patch.object(config, 'load_config', return_value={'selected': True}) as load:
            self.assertEqual(config.parse_config_args(['--config', 'chosen.json'], environ={config.CONFIG_ENV: 'other.json'}), {'selected': True})
            load.assert_called_once_with('chosen.json')
        with _s7_patch.object(config, 'load_config', return_value={}) as load:
            config.parse_config_args([], environ={config.CONFIG_ENV: 'environment.json'})
            load.assert_called_once_with('environment.json')

    def test_existing_history_is_preserved_and_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _s7_Path(tmp)
            value = self.value(root)
            base = root / 'fresh'
            base.mkdir()
            record = base / 'run-record'
            record.write_bytes(b'synthetic preserved history')
            with self.assertRaisesRegex(ValueError, 'fresh isolated'):
                config.load_config(self.write(root, value))
            self.assertEqual(record.read_bytes(), b'synthetic preserved history')

    def test_partial_relative_and_control_character_paths_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _s7_Path(tmp)
            original = self.value(root)
            for change in (lambda v: v.update(python='relative/python'), lambda v: v.update(base_dir='bad\npath'), lambda v: v.pop('repositories'), lambda v: v['executables'].pop('gpumd'), lambda v: v.update(schema_version=True)):
                value = copy.deepcopy(original)
                change(value)
                with self.subTest(value_keys=sorted(value)), self.assertRaises(ValueError):
                    config.load_config(self.write(root, value))
            self.assertFalse((root / 'fresh').exists())

    def test_checkout_configuration_must_stay_ignored(self):
        with self.assertRaisesRegex(ValueError, 'ignored'):
            config.load_config(_s7_ROOT / 'untracked-private-config.json')

    def test_importing_runner_initializes_no_science_or_service(self):
        original = builtins.__import__
        seen = []

        def guarded(name, *args, **kwargs):
            if name.split('.')[0] in ('studio_worker', 'ase', 'numpy', 'yaml', 'torch', 'cupy'):
                raise AssertionError('Scientific import before explicit config')
            seen.append(name)
            return original(name, *args, **kwargs)
        runner_spec = importlib.util.spec_from_file_location('portable_smoke_runner', _s7_ROOT / 'scripts/science-smoke.py')
        runner = importlib.util.module_from_spec(runner_spec)
        with _s7_patch('builtins.__import__', side_effect=guarded), _s7_patch.object(_s7_Path, 'mkdir', side_effect=AssertionError('No runtime directory')):
            runner_spec.loader.exec_module(runner)
        self.assertFalse(hasattr(runner, 'service'))
        self.assertFalse(hasattr(runner, 'BASE'))

    def test_actual_cli_entry_gates_before_runtime_and_retains_cleanup(self):
        tree = ast.parse((_s7_ROOT / 'scripts/science-smoke.py').read_text(encoding='utf-8'))
        entry = tree.body[-1]
        self.assertIsInstance(entry, ast.If)
        compiled = compile(ast.Module(body=[entry], type_ignores=[]), 'runner-entry-only', 'exec')
        for exit_code in (0, 2, None):
            calls = []

            def parse():
                calls.append('parse')
                if exit_code is not None:
                    raise SystemExit(exit_code)
                return {'explicit': True}

            def configure(value):
                self.assertEqual(value, {'explicit': True})
                calls.append('configure')
            namespace = {'__name__': '__main__', 'configure': configure, 'main': lambda: calls.append('main'), 'service': types.SimpleNamespace(close=lambda: calls.append('close')), 'evidence': lambda: calls.append('evidence')}
            with _s7_patch.dict('sys.modules', {'science_smoke_config': types.SimpleNamespace(parse_config_args=parse)}):
                if exit_code is not None:
                    with self.assertRaises(SystemExit) as error:
                        exec(compiled, namespace)
                    self.assertEqual(error.exception.code, exit_code)
                    self.assertEqual(calls, ['parse'])
                else:
                    exec(compiled, namespace)
                    self.assertEqual(calls, ['parse', 'configure', 'main', 'close', 'evidence'])

# --- section: test_task_schema.py ---
import unittest
from studio_worker.transport.task_schema import validate_task
from studio_worker.server import tools as _s8_tools
class TaskSchema(unittest.TestCase):

    def payload(self):
        return {'task_id': 'fixture', 'name': 'MD', 'steps': [{'id': 'md', 'title': 'MD', 'fields': [{'key': 'md.temperature', 'label': 'Temperature', 'type': 'number', 'required': True, 'unit': 'K'}]}], 'parameters': {'md': {'temperature': 300}}, 'missing_fields': []}

    def test_structured_steps_and_legacy_steps(self):
        validate_task(self.payload())
        payload = self.payload()
        payload['steps'] = ['prepare', 'review']
        validate_task(payload)
        schema = next((v for v in _s8_tools() if v['name'] == 'present_task'))['inputSchema']
        self.assertNotIn('offset', schema['properties'])
        self.assertNotIn('frame', schema['properties'])

    def test_unsafe_and_duplicate_fields(self):
        for key in ('__proto__.x', 'md.constructor.x', 'a..b'):
            payload = self.payload()
            payload['steps'][0]['fields'][0]['key'] = key
            with self.assertRaises(ValueError):
                validate_task(payload)
        payload = self.payload()
        payload['steps'][0]['fields'] *= 2
        with self.assertRaises(ValueError):
            validate_task(payload)

    def test_unknown_properties_and_bad_types(self):
        payload = self.payload()
        payload['steps'][0]['fields'][0]['required'] = 'true'
        with self.assertRaises(ValueError):
            validate_task(payload)
        payload = self.payload()
        payload['steps'][0]['fields'][0]['unit'] = {}
        with self.assertRaises(ValueError):
            validate_task(payload)
        payload = self.payload()
        payload['offset'] = 0
        with self.assertRaises(ValueError):
            validate_task(payload)

    def test_legacy_prose_requirements_remain_data_not_paths(self):
        payload = self.payload()
        payload['missing_fields'] = ['md.structure_file', '确认 CV 原子编号与单位。', '__proto__.polluted']
        validate_task(payload)
        for value in (None, 3, {}, '', 'x' * 2001):
            payload['missing_fields'] = [value]
            with self.assertRaises(ValueError):
                validate_task(payload)
class FieldPresentation(unittest.TestCase):

    def test_advanced_traceable_default_metadata(self):
        import copy
        value = {'task_id': 't', 'name': 'MetaD', 'parameters': {}, 'missing_fields': [], 'steps': [{'id': 'm', 'title': 'MetaD', 'fields': [{'key': 'metad.seed', 'label': 'Seed', 'type': 'integer', 'required': False, 'advanced': True, 'default': 0, 'default_source': 'input config'}]}]}
        validate_task(value)
        for key, bad in (('advanced', 'yes'), ('default_source', ''), ('default', 1.5), ('default', float('inf')), ('default', False)):
            other = copy.deepcopy(value)
            other['steps'][0]['fields'][0][key] = bad
            with self.assertRaises(ValueError):
                validate_task(other)

# --- section: test_tool_guidance_state.py ---
'Persisted metadata regression only; no process or scientific validation claims.'
import copy
import json
from pathlib import Path as _s9_Path
import tempfile
from types import SimpleNamespace as _s9_SimpleNamespace
import unittest
from unittest.mock import patch as _s9_patch
from studio_worker.server import dispatch as _s9_dispatch, tools as _s9_tools
from studio_worker.infrastructure.store import Store as _s9_Store
from studio_worker.tools.archive_guard import assert_guidance_read
from studio_worker.tools.guidance_state import guidance_state
class ToolGuidanceState(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = _s9_Path(self.temp.name)
        self.store = _s9_Store(self.root)
        self.addCleanup(self.store.db.close)
        self.service = _s9_SimpleNamespace(store=self.store)

    def persist(self, status='active'):
        package = {'schema_version': 1, 'id': 'package-record', 'package_id': 'fixture', 'package_version': 'a' * 64, 'source_commit': 'b' * 40, 'snapshot_root': str(self.root / 'snapshot'), 'files': [], 'manifest': {'functions': [{'id': 'reference', 'engine': 'installation.check', 'description': 'NOT_GLOBAL_INSTRUCTIONS'}], 'guidance': {'delivery': 'SKILL.md', 'installation': ['install.md'], 'configuration': ['configure.md']}}}
        configuration = {'schema_version': 1, 'id': 'configuration', 'revision': 7, 'status': status, 'package_id': 'fixture', 'package_version': 'a' * 64, 'manifest_sha256': 'c' * 64, 'environment_sha256': 'd' * 64, 'target': {'target': 'local', 'project_id': 'project', 'environment_id': 'environment'}}
        self.store.put_many([('tool-package-version', package), ('tool-configuration', configuration), ('tool-package-alias', {'schema_version': 1, 'id': package['id'], 'revision': 2, 'roots': [package['snapshot_root'], str(self.root / 'origin')]}), ('tool-activation', {'schema_version': 1, 'id': 'configuration', 'configuration_id': 'configuration', 'execution_skill_id': 'e' * 64}), ('tool-execution-skill', {'schema_version': 1, 'id': 'e' * 64, 'configuration_id': 'configuration', 'sha256': 'e' * 64, 'body': 'PRIVATE_EXECUTION_BODY', 'facts': {'secret': 'PRIVATE_FACTS'}})])

    def test_metadata_survives_reopen_without_files_body_or_state_mutation(self):
        self.persist()
        before = guidance_state(self.service, {})
        stored = {kind: copy.deepcopy(self.store.list(kind)) for kind in ('tool-configuration', 'tool-activation', 'tool-execution-skill', 'tool-package-version', 'tool-package-alias')}
        self.store.db.close()
        self.store = _s9_Store(self.root)
        self.service.store = self.store
        self.addCleanup(self.store.db.close)
        with _s9_patch.object(_s9_Path, 'stat', side_effect=AssertionError('No path stat')), _s9_patch.object(_s9_Path, 'open', side_effect=AssertionError('No file open')), _s9_patch.object(_s9_Path, 'read_text', side_effect=AssertionError('No guide text')), _s9_patch.object(_s9_Path, 'read_bytes', side_effect=AssertionError('No guide bytes')), _s9_patch.object(_s9_Path, 'resolve', side_effect=AssertionError('No filesystem resolution')):
            result = _s9_dispatch(self.service, 'POST', '/api/tool-guidance/state', {}, admin=True)
        self.assertEqual(result, before)
        self.assertEqual(len(result['archived_resources']), 6)
        self.assertTrue(result['configurations'][0]['has_activation'])
        self.assertEqual(result['configurations'][0]['execution_skill'], {'id': 'e' * 64, 'sha256': 'e' * 64})
        wire = json.dumps(result)
        for private in ('PRIVATE_EXECUTION_BODY', 'PRIVATE_FACTS', 'NOT_GLOBAL_INSTRUCTIONS', '"body"', '"facts"'):
            self.assertNotIn(private, wire)
        self.assertEqual({kind: self.store.list(kind) for kind in stored}, stored)

    def test_activation_keeps_archives_after_later_failed_state(self):
        self.persist()
        previous = guidance_state(self.service, {})
        record = self.store.get('tool-configuration', 'configuration')
        record.update(status='failed', revision=8)
        self.store.put('tool-configuration', record)
        current = guidance_state(self.service, {})
        self.assertNotEqual(current['revision'], previous['revision'])
        self.assertEqual(current['configurations'][0]['status'], 'failed')
        self.assertEqual(current['archived_resources'], previous['archived_resources'])
        with self.assertRaises(PermissionError):
            assert_guidance_read(self.service, self.root / 'origin/install.md')

    def test_only_admin_empty_post_can_read_and_mcp_has_no_body_or_route(self):
        self.persist()
        for method, admin in [('GET', True), ('POST', False)]:
            with self.assertRaises(PermissionError):
                _s9_dispatch(self.service, method, '/api/tool-guidance/state', {}, admin=admin)
        with self.assertRaises(ValueError):
            _s9_dispatch(self.service, 'POST', '/api/tool-guidance/state', {'passed': True}, admin=True)
        self.assertFalse(any((item['name'] in ('tool_guidance_state', 'read_tool_guidance_state') for item in _s9_tools())))
        with self.assertRaises(PermissionError):
            _s9_dispatch(self.service, 'POST', '/api/tool-execution-skill/read', {'configuration_id': 'configuration'}, admin=False)

    def test_orphaned_activation_fails_closed_instead_of_reporting_legacy(self):
        self.store.put('tool-activation', {'schema_version': 1, 'id': 'orphan', 'configuration_id': 'orphan', 'execution_skill_id': 'e' * 64})
        with self.assertRaisesRegex(ValueError, 'retain archive restrictions'):
            guidance_state(self.service, {})

# --- section: test_tools_domain.py ---
'Tools ownership and portable distribution checks; no scientific engines.'
import importlib
import json
import os
from pathlib import Path as _s10_Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch as _s10_patch
WORKER = _s10_Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))
class ToolsDomain(unittest.TestCase):

    def test_legacy_modules_share_the_actual_owner_and_monkeypatch_namespace(self):
        for name in ('adapters', 'engine_contracts', 'derivative_selection'):
            with self.subTest(module=name):
                legacy = importlib.import_module('studio_worker.' + name)
                owner = importlib.import_module('studio_worker.tools.' + name)
                self.assertIs(legacy, owner)
        from studio_worker.tools import adapters
        self.assertIs(importlib.import_module('studio_worker.adapters'), adapters)
        self.assertEqual(adapters.Adapter.__module__, 'studio_worker.tools.adapters')
        with _s10_patch('studio_worker.adapters.run_json', return_value={}) as probe, _s10_patch.object(adapters.Adapter, 'runtime_check', return_value={'status': 'not_run'}):
            adapters.Adapter('pydyn.md').probe({'executables': {'python': sys.executable}})
        self.assertEqual(probe.call_args.args[1], WORKER / 'studio_worker/scientific.py')

    def test_consumers_use_the_tool_owner_and_unique_package_resources(self):
        from studio_worker.tools.adapters import Adapter, SCIENTIFIC
        from studio_worker.tools.engine_contracts import CONTRACTS
        for name in ('service', 'server', 'cluster', 'compute.runtime_service'):
            with self.subTest(consumer=name):
                consumer = importlib.import_module('studio_worker.' + name)
                self.assertIs(consumer.Adapter, Adapter)
        from studio_worker.workspace import authoring_workspace
        self.assertTrue(authoring_workspace.CONTRACTS is CONTRACTS)
        self.assertEqual(SCIENTIFIC, WORKER / 'studio_worker/scientific.py')
        self.assertEqual(CONTRACTS, json.loads((WORKER / 'studio_worker/engine_contracts.json').read_text(encoding='utf-8')))
        self.assertFalse((WORKER / 'studio_worker/tools/engine_contracts.json').exists())
        with tempfile.TemporaryDirectory() as tool_source:
            command = Adapter('nep.eval').prepare({'inputs': {name: name for name in ('nep.in', 'train.xyz', 'nep.txt')}, 'parameters': {}}, {'executables': {'nep': sys.executable}})
            self.assertEqual(command, [sys.executable])
            with self.assertRaisesRegex(ValueError, 'native prediction input'):
                Adapter('nep.eval').prepare({'inputs': {name: name for name in ('nep.in', 'evaluation.xyz', 'nep.txt')}, 'parameters': {}}, {'executables': {'nep': sys.executable}})

    def test_installed_standalone_worker_contains_new_owners_and_old_imports(self):
        with tempfile.TemporaryDirectory() as directory:
            env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
            result = subprocess.run([sys.executable, '-B', str(WORKER / 'install.py'), '--source', str(WORKER), '--root', directory], capture_output=True, text=True, env=env, timeout=20, check=True)
            runtime = _s10_Path(json.loads(result.stdout)['path'])
            code = "import importlib,json,pathlib,sys\nsys.path.insert(0,sys.argv[1])\nfor name in ('adapters','engine_contracts','derivative_selection'):\n assert importlib.import_module('studio_worker.'+name) is importlib.import_module('studio_worker.tools.'+name)\nfrom studio_worker.tools.adapters import Adapter,SCIENTIFIC\nfrom studio_worker.engine_contracts import CONTRACTS\nimport studio_worker.server,studio_worker.runner\nassert pathlib.Path(SCIENTIFIC).is_file()\nassert pathlib.Path(SCIENTIFIC).parent==pathlib.Path(sys.argv[1])/'studio_worker'\nassert Adapter('pygas.opes-reweight').prepare({'inputs':{'OPES_COLVAR':'fixture','fes.yaml':'fixture'},'parameters':{}},{'executables':{'pygas':sys.executable}})==[sys.executable,'opes-reweight','OPES_COLVAR','fes.yaml']\nprint(json.dumps(CONTRACTS))\n"
            loaded = subprocess.run([sys.executable, '-I', '-B', '-X', 'utf8', '-c', code, str(runtime)], capture_output=True, text=True, env=env, timeout=20, check=True)
            self.assertEqual(json.loads(loaded.stdout), json.loads((WORKER / 'studio_worker/engine_contracts.json').read_text(encoding='utf-8')))
            for name in ('adapters', 'engine_contracts', 'derivative_selection'):
                self.assertTrue((runtime / ('studio_worker/tools/' + name + '.py')).is_file())

# --- section: test_transfer_bounds.py ---
import base64
import re
import sys
import unittest
from pathlib import Path as _s11_Path
sys.path.insert(0, str(_s11_Path(__file__).resolve().parents[1]))
from studio_worker.compute.cluster import TRANSFER_CHUNK, TRANSFER_PROGRAM, TRANSFER_TOTAL
TRANSPORT_RESPONSE_BOUND = 4 * 1024 * 1024
class TransferBoundsTest(unittest.TestCase):

    def test_remote_and_local_chunk_size_match(self):
        remote = int(re.search('CHUNK=(\\d+)', TRANSFER_PROGRAM).group(1))
        self.assertEqual(remote, TRANSFER_CHUNK)

    def test_remote_and_local_total_size_match(self):
        remote = int(re.search('TOTAL=(\\d+)', TRANSFER_PROGRAM).group(1))
        self.assertEqual(remote, TRANSFER_TOTAL)

    def test_a_full_chunk_response_fits_the_transport_bound(self):
        response = base64.b64encode(b'x' * TRANSFER_CHUNK)
        self.assertLess(len(response) + 4096, TRANSPORT_RESPONSE_BOUND)

    def test_chunk_size_reduces_ssh_round_trips_for_bounded_files(self):
        self.assertGreaterEqual(TRANSFER_TOTAL // TRANSFER_CHUNK, 1)
        self.assertLess(TRANSFER_TOTAL // TRANSFER_CHUNK, 100)
        self.assertGreaterEqual(TRANSFER_CHUNK, 1024 * 1024)

# --- section: test_workflow_roadmap.py ---
import copy
import json
import tempfile
import unittest
from pathlib import Path as _s12_Path
from types import SimpleNamespace as _s12_SimpleNamespace
from studio_worker.infrastructure.store import Store as _s12_Store
from studio_worker.transport.mcp import mcp_tool_call as _s12_mcp_tool_call, tools as _s12_tools
from studio_worker.transport.routes import dispatch as _s12_dispatch
class WorkflowRoadmap(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.service = _s12_SimpleNamespace(store=_s12_Store(self.tmp.name))
        self.addCleanup(lambda: self.service.store.db.close())
        fixture = _s12_Path(__file__).resolve().parents[3] / 'tests/fixtures/workflow-roadmap.json'
        self.plan = json.loads(fixture.read_text(encoding='utf-8'))
        self.base = dict(task_id='roadmap-test', name='MD', parameters={}, steps=['MD'], missing_fields=[])

    def present(self, **changes):
        return _s12_mcp_tool_call(self.service, {'name': 'present_task', 'arguments': {**self.base, **changes}}, dispatch=_s12_dispatch)

    def read(self):
        return _s12_dispatch(self.service, 'GET', '/api/task-parameters', {})[0]

    def test_mcp_roundtrip_persistence_and_legacy_update(self):
        schema = next((tool['inputSchema'] for tool in _s12_tools() if tool['name'] == 'present_task'))
        self.assertIn('roadmap', schema['properties'])
        self.assertNotIn('roadmap', schema['required'])
        result = self.present(roadmap=self.plan)
        self.assertFalse(result['isError'], result)
        self.assertEqual(json.loads(result['content'][0]['text'])['roadmap'], self.plan)
        self.assertFalse(self.present(name='Manual parameter update')['isError'])
        self.service.store.db.close()
        self.service.store = _s12_Store(self.tmp.name)
        self.assertEqual(self.read()['roadmap'], self.plan)
        self.assertEqual(self.read()['name'], 'Manual parameter update')
        self.assertEqual(self.read()['status'], 'draft')

    def test_invalid_replacement_preserves_the_previous_form_and_graph(self):
        self.assertFalse(self.present(roadmap=self.plan)['isError'])
        before = self.read()
        for mutate in (lambda p: p['inputs'].append('bad-id'), lambda p: p['steps'][2]['inputs'][0].update(resource='report'), lambda p: p['steps'][0]['outputs'][0].update(resource='frames'), lambda p: p['resources'][0].update(field='__proto__.x'), lambda p: p['steps'][0].update(status='passed'), lambda p: p['resources'][0].update(short_label='x' * 17), lambda p: p['steps'][0].update(runtime_labels={'top': {'short_label': 'NEP'}})):
            changed = copy.deepcopy(self.plan)
            mutate(changed)
            self.assertTrue(self.present(name='Invalid replacement', roadmap=changed)['isError'])
            self.assertEqual(self.read(), before)

    def test_existing_graph_without_aliases_can_be_named_and_reopened(self):
        legacy = copy.deepcopy(self.plan)
        for item in legacy['resources'] + legacy['steps']:
            item.pop('short_label', None)
            item.pop('runtime_labels', None)
        self.assertFalse(self.present(roadmap=legacy)['isError'])
        self.assertEqual(self.read()['roadmap'], legacy)
        self.assertFalse(self.present(roadmap=self.plan)['isError'])
        self.assertEqual(self.read()['roadmap'], self.plan)

    def test_partial_goal_and_old_payload(self):
        self.assertFalse(self.present()['isError'])
        self.assertNotIn('roadmap', self.read())
        self.plan['steps'] = []
        self.assertFalse(self.present(roadmap=self.plan)['isError'])
        self.assertEqual(self.read()['roadmap']['outputs'], ['frames', 'thermo', 'report'])

if __name__ == '__main__':
    unittest.main()
