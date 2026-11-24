"""Actual isolated engineering fixture; never scientific execution or production state."""
import copy
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from studio_worker.service import Service
from studio_worker.server import dispatch, tools
from studio_worker.tools.configurations import ToolConfigurations
from studio_worker.tools.package_contract import load_package, validate_tool_package

ROOT = Path(__file__).resolve().parents[3]


def fixture(root):
    package = root / 'package'; repository = package / 'repo'; repository.mkdir(parents=True)
    code = (ROOT / 'installation/examples/worker-smoke.py').read_bytes()
    (repository / 'run.py').write_bytes(code)
    template = root / 'git-template'; template.mkdir()
    environment = {**os.environ, 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_SYSTEM': os.devnull}
    def git(*args):
        return subprocess.run(['git', '-C', str(repository), *args], env=environment, capture_output=True, text=True, check=True).stdout.strip()
    git('init', '--quiet', '--template=' + str(template)); git('add', 'run.py')
    git('-c', 'user.name=Engineering fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '--no-gpg-sign', '-m', 'fixture')
    commit = git('rev-parse', 'HEAD')
    for name in ('manual.md', 'SKILL.md', 'install.md', 'configure.md', 'studio-worker-tests/README.md', 'studio-worker-tests/process/README.md'):
        file = package / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_text('# Engineering fixture\n', encoding='utf-8')
    (package / 'studio-worker-tests/process/run.py').write_bytes(code)
    display = {'priority': 100, 'advanced': False, 'reason': 'Only output'}
    manifest = {'schema_version': 1, 'id': 'studio-worker', 'name': 'Worker process engineering reference', 'repository': {'path': 'repo', 'commit': commit}, 'manual': 'manual.md', 'guidance': {'delivery': 'SKILL.md', 'installation': ['install.md'], 'configuration': ['configure.md']}, 'environment': {'hardware': 'cpu', 'requirements': ['Python 3.10+ standard library'], 'parallelism': {'supported': ['serial']}}, 'functions': [{'id': 'process', 'name': 'Process lifecycle', 'description': 'Engineering-only fixed child process', 'engine': 'installation.check', 'entrypoint': 'repo/run.py', 'inputs': [], 'outputs': [{'id': 'result', 'type': 'file', 'format': 'json', 'description': 'Worker lifecycle receipt', 'required': True, 'display': display}], 'operation': {'command': ['{python}', '{entrypoint}'], 'failure_handling': 'Inspect original run; never retry unknown automatically'}, 'tests': ['process-smoke']}], 'tests': {'directory': 'studio-worker-tests', 'introduction': 'studio-worker-tests/README.md', 'cases': [{'id': 'process-smoke', 'function_id': 'process', 'directory': 'studio-worker-tests/process', 'instructions': 'studio-worker-tests/process/README.md', 'entrypoint': 'studio-worker-tests/process/run.py', 'resources': [], 'expected_outputs': [{'path': 'smoke-result.json', 'format': 'json', 'description': 'Real process report'}], 'pass_criteria': ['Worker verifies exit, child PID, marker and fixed JSON']}]}}
    (package / 'tool.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return package, manifest


class ToolConfigurationContract(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name); self.package, self.manifest = fixture(self.root)
        self.service = Service(self.root / 'worker', schedule=False)
        self.addCleanup(self.service.store.db.close); self.addCleanup(self.service.close)
        self.api = ToolConfigurations(self.service)
        self.environment = self.service.register_environment({'id': 'environment', 'name': 'Explicit fixture interpreter', 'executables': {'python': sys.executable}})
        self.project = self.service.register_project({'id': 'project', 'name': 'Explicit engineering authorization', 'policy': {'engines': ['installation.check'], 'input_roots': [str(self.root)], 'environments': ['environment'], 'gpus': [0], 'max_seconds': 30, 'max_concurrent': 1}})
        self.package_value = load_package(self.package)
        self.registration = {'snapshot_root': str(self.package), 'package_id': self.manifest['id'], 'package_version': self.package_value['package_version']}
        self.api.register(self.registration)
        self.plan_args = {'package_id': self.manifest['id'], 'package_version': self.package_value['package_version'], 'target': {'target': 'local', 'project_id': self.project['id'], 'environment_id': self.environment['id']}, 'request_id': 'configuration-request'}

    def plan(self): return self.api.plan(copy.deepcopy(self.plan_args))
    def mutation(self, record): return {'configuration_id': record['id'], 'expected_revision': record['revision'], 'plan_sha256': record['plan_sha256']}

    def test_schema_defaults_coverage_and_required_default_source(self):
        value = validate_tool_package(self.manifest)
        self.assertEqual(value['environment']['parallelism']['threads'], 1)
        for mutate in (lambda v: v.update(schema_version=True), lambda v: v.update(unknown=True), lambda v: v['functions'][0].update(tests=['missing']), lambda v: v['tests']['cases'][0].update(function_id='missing'), lambda v: v['functions'][0]['outputs'][0].update(required=False)):
            invalid = copy.deepcopy(self.manifest); mutate(invalid)
            with self.assertRaises(ValueError): validate_tool_package(invalid)
        optional = copy.deepcopy(self.manifest)
        parameter = {'id': 'count', 'type': 'integer', 'description': 'Illustrative declaration only', 'required': False, 'default': 1, 'default_behavior': 'Use one', 'display': {'priority': 0, 'advanced': True, 'reason': 'Routine'}}
        optional['functions'][0]['parameters'] = [parameter]
        with self.assertRaises(ValueError): validate_tool_package(optional)
        parameter['default_source'] = 'Reference declaration'
        self.assertEqual(validate_tool_package(optional)['functions'][0]['parameters'][0]['default'], 1)

    @unittest.skipUnless(shutil.which('node'), 'Pure Node identity parity runs in the Windows Node environment')
    def test_node_identity_parity(self):
        value = validate_tool_package(self.manifest)
        # The JS identity helper is pure; Node never imports or executes the tool.
        script = "import fs from 'node:fs';import{createHash}from'node:crypto';import{packageIdentityText,validateToolPackage}from" + json.dumps((ROOT / 'contracts/tools/tool-package.mjs').as_uri()) + ";const v=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify({version:createHash('sha256').update(packageIdentityText(v)).digest('hex'),manifest:validateToolPackage(v.manifest)}));"
        payload = {'id': value['id'], 'commit': value['repository']['commit'], 'manifestSha256': self.package_value['manifest_sha256'], 'files': self.package_value['files'], 'manifest': self.manifest}
        result = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(payload), capture_output=True, text=True, timeout=20)
        if result.returncode and ('not found' in result.stderr or 'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED' in result.stderr): self.skipTest('Host Node does not support the shared JSON module syntax')
        self.assertEqual(result.returncode, 0, result.stderr)
        result_value = json.loads(result.stdout); self.assertEqual(result_value['version'], self.package_value['package_version']); self.assertEqual(result_value['manifest'], value)

    def test_relative_link_is_bound_and_outside_or_cycle_is_refused(self):
        entry = self.package / 'studio-worker-tests/process/run.py'
        entry.unlink()
        try: entry.symlink_to('../../repo/run.py')
        except OSError: self.skipTest('Symbolic links unavailable in this host')
        package = load_package(self.package)
        link = next(item for item in package['files'] if item['path'] == 'studio-worker-tests/process/run.py')
        self.assertEqual(link['kind'], 'symlink'); self.assertEqual(link['target'], '../../repo/run.py')
        self.assertIn('repo/run.py', [item['path'] for item in package['files']])
        entry.unlink(); entry.symlink_to('../../../outside.py')
        with self.assertRaises(ValueError): load_package(self.package)
        entry.unlink(); entry.symlink_to('run.py')
        with self.assertRaises(ValueError): load_package(self.package)

    def test_original_repository_code_is_tracked_and_external_programs_are_test_wrappers(self):
        code = (self.package / 'repo/run.py').read_bytes()
        for name in ('repo/untracked.py', 'outer-runtime/unknown.py'):
            target = self.package / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(code)
            manifest = copy.deepcopy(self.manifest); manifest['functions'][0]['entrypoint'] = name
            (self.package / 'tool.json').write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaises(ValueError): load_package(self.package)

    def test_standard_wrapper_and_explicit_untracked_data_directories_are_bound_only_when_named(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['functions'][0]['entrypoint'] = 'studio-worker-tests/process/run.py'
        manifest['tests']['cases'][0]['resources'] = ['outer-models', 'repo/models']
        for name in ('outer-models/weights.bin', 'repo/models/private-data.bin', 'unrelated-runtime/not-packaged.txt'):
            target = self.package / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(b'fixture data; never deserialized')
        (self.package / 'tool.json').write_text(json.dumps(manifest), encoding='utf-8')
        files = {item['path'] for item in load_package(self.package)['files']}
        self.assertIn('outer-models/weights.bin', files); self.assertIn('repo/models/private-data.bin', files)
        self.assertNotIn('unrelated-runtime/not-packaged.txt', files)

    def test_tests_directory_alias_binds_complete_logical_and_physical_views_and_refuses_cycle(self):
        tests = self.package / 'studio-worker-tests'; actual = self.package / 'repo/qa'
        tests.rename(actual)
        try: tests.symlink_to('repo/qa', target_is_directory=True)
        except OSError: self.skipTest('Directory links unavailable in this host')
        (actual / 'unlisted-data.txt').write_text('Explicit whole tests tree member')
        environment = {**os.environ, 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_SYSTEM': os.devnull}
        def git(*args):
            return subprocess.run(['git', '-C', str(self.package / 'repo'), *args], env=environment, capture_output=True, text=True, check=True).stdout.strip()
        git('add', 'qa'); git('-c', 'user.name=Engineering fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '--no-gpg-sign', '-m', 'tracked original tests')
        manifest = copy.deepcopy(self.manifest); manifest['repository']['commit'] = git('rev-parse', 'HEAD')
        (self.package / 'tool.json').write_text(json.dumps(manifest), encoding='utf-8')
        files = {item['path']: item for item in load_package(self.package)['files']}
        logical, physical = files['studio-worker-tests/unlisted-data.txt'], files['repo/qa/unlisted-data.txt']
        self.assertEqual(logical['sha256'], physical['sha256']); self.assertEqual(logical['kind'], 'file')
        self.assertEqual(files['studio-worker-tests']['kind'], 'symlink')
        (actual / 'cycle').symlink_to('.', target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'Cyclic'): load_package(self.package)

    def test_admin_routes_and_exact_inputs_never_accept_claimed_passed(self):
        for route in ('/api/tool-package/register', '/api/tool-configuration/plan', '/api/tool-configuration/execute', '/api/tool-configuration/status', '/api/tool-configuration/activate', '/api/tool-execution-skill/read'):
            with self.assertRaises(PermissionError): dispatch(self.service, 'POST', route, {}, admin=False)
        self.assertFalse(any(tool['name'].startswith('tool_configuration') for tool in tools()))
        for key in ('passed', 'checks', 'run_ids', 'active', 'skill_body', 'environment_snapshot'):
            with self.assertRaises(ValueError): self.api.plan({**self.plan_args, key: True})
        with self.assertRaises(ValueError): self.api.register({**self.registration, 'package_version': 'f' * 64})

    def test_plan_is_idempotent_does_not_install_or_grant_and_rejects_changed_request(self):
        before = copy.deepcopy(self.service.store.list('project'))
        record = self.plan(); self.assertEqual(record, self.plan())
        self.assertEqual(record['tests'][0]['reason'], 'Not executed: configuration is planned')
        self.assertEqual(record['status'], 'planned'); self.assertFalse(Path(record['installed_prefix']).exists())
        self.assertEqual(self.service.store.list('project'), before); self.assertEqual(self.service.store.runs(), [])
        changed = copy.deepcopy(self.plan_args); changed['target']['environment_id'] = 'other'
        with self.assertRaises(ValueError): self.api.plan(changed)
        unauthorized = copy.deepcopy(self.project); unauthorized['policy']['engines'] = ['pydyn.md']; self.service.store.put('project', unauthorized)
        with self.assertRaises(PermissionError): self.api.execute(self.mutation(record))

    def test_alias_union_preserves_immutable_version_and_general_commands_are_unsupported(self):
        before = self.service.store.list('tool-package-version')
        for name in ('origin-one', 'origin-two'):
            self.api.register({**self.registration, 'origin_root': str(self.root / name)})
        self.assertEqual(self.service.store.list('tool-package-version'), before)
        alias = self.service.store.list('tool-package-alias')[0]
        self.assertEqual(alias['revision'], 3)
        self.assertEqual(len(alias['roots']), 3)
        manifest = copy.deepcopy(self.manifest); manifest['functions'][0]['operation']['command'] = ['{python}', '-c', 'raise RuntimeError("never execute")']
        (self.package / 'tool.json').write_text(json.dumps(manifest), encoding='utf-8')
        package = load_package(self.package); self.api.register({**self.registration, 'package_version': package['package_version']})
        with self.assertRaises(ValueError): self.api.plan({**self.plan_args, 'package_version': package['package_version']})
        self.assertEqual(self.service.store.runs(), [])

    def test_package_environment_python_and_review_changes_block_execution(self):
        record = self.plan()
        with self.assertRaises(ValueError): self.api.execute({**self.mutation(record), 'expected_revision': 0})
        (self.package / 'repo/run.py').write_text('print("changed")')
        with self.assertRaises(ValueError): self.api.execute(self.mutation(record))
        self.assertEqual(self.service.store.runs(), [])

    def test_benign_environment_registration_change_warns_and_uses_current_snapshot(self):
        record = self.plan()
        environment = self.service.store.get('environment', 'environment'); environment['name'] = 'Changed'; self.service.store.put('environment', environment)
        result=self.api.execute(self.mutation(record))
        self.assertTrue(Path(record['installed_prefix']).exists());self.assertEqual(result['check_findings'][0]['code'],'configuration_environment_changed')
        run=self.service.store.run(result['tests'][0]['run_id']);self.assertEqual(run['environment_snapshot']['name'],'Changed')

    def test_interpreter_content_change_cannot_install(self):
        executable = self.root / 'owned-fake-python'; executable.write_text('not executed'); executable.chmod(0o700)
        environment = self.service.store.get('environment', 'environment'); environment['executables']['python'] = str(executable); self.service.store.put('environment', environment)
        record = self.plan(); executable.write_text('changed file')
        with self.assertRaises(ValueError): self.api.execute(self.mutation(record))
        self.assertEqual(self.service.store.runs(), [])

    def test_unreviewed_installed_reference_can_activate_without_fabricated_test_pass(self):
        record = self.plan()
        with patch.object(self.service, 'validate', side_effect=lambda identifier:self.service.store.run(identifier)):
            testing = self.api.execute(self.mutation(record))
        active = self.api.activate(self.mutation(testing))
        self.assertEqual(active['status'], 'active')
        self.assertNotEqual(active['execution_skill']['facts']['tests'][0]['status'], 'passed')
        self.assertEqual(self.service.store.run(testing['tests'][0]['run_id'])['status'],'queued')

    def complete(self, record):
        deadline = time.monotonic() + 15
        while record['status'] == 'testing' and time.monotonic() < deadline:
            self.service.tick(); time.sleep(.05); record = self.api.status({'configuration_id': record['id']})
        self.assertEqual(record['status'], 'tested', record)
        return record

    def test_unknown_run_is_never_submitted_again_and_independent_activation_preserves_evidence(self):
        record = self.api.execute(self.mutation(self.plan()))
        run = self.service.store.run(record['tests'][0]['run_id']); self.service.store.update(run, status='unknown')
        unknown = self.api.status({'configuration_id': record['id']}); self.assertEqual(unknown['status'], 'unknown')
        self.assertIn('Persisted run status is unknown', unknown['tests'][0]['reason'])
        with patch.object(self.service, 'submit', side_effect=AssertionError('Unknown must not submit')):
            self.assertEqual(self.api.execute(self.mutation(unknown))['status'], 'unknown')
        active=self.api.activate(self.mutation(unknown))
        self.assertEqual(active['status'],'active')
        self.assertEqual(active['execution_skill']['facts']['tests'][0]['status'],'unknown')
        self.assertEqual(self.service.store.run(run['id'])['status'],'unknown')

    def test_failed_run_reason_is_preserved_when_configuration_is_enabled(self):
        # A durable launch-error fixture exercises reporting only; no scientific or child failure is claimed.
        record = self.api.execute(self.mutation(self.plan()))
        run = self.service.store.run(record['tests'][0]['run_id'])
        self.service.store.update(run, status='failed', error='Synthetic persisted launch failure for reporting')
        failed = self.api.status({'configuration_id': record['id']})
        self.assertEqual(failed['status'], 'failed'); self.assertEqual(failed['tests'][0]['status'], 'failed')
        self.assertEqual(failed['tests'][0]['reason'], 'Run error: Synthetic persisted launch failure for reporting')
        active=self.api.activate(self.mutation(failed))
        self.assertEqual(active['status'],'active')
        self.assertEqual(active['execution_skill']['facts']['tests'],failed['tests'])

    def test_actual_queued_cancellation_is_reported_without_inventing_a_supervisor_reason(self):
        record = self.api.execute(self.mutation(self.plan()))
        run = self.service.cancel(record['tests'][0]['run_id']); self.assertEqual(run['status'], 'cancelled')
        failed = self.api.status({'configuration_id': record['id']})
        self.assertEqual(failed['status'], 'failed'); self.assertEqual(failed['tests'][0]['status'], 'cancelled')
        self.assertEqual(failed['tests'][0]['reason'], 'Persisted run status is cancelled; no supervisor reason is recorded')
        active=self.api.activate(self.mutation(failed))
        self.assertEqual(active['status'],'active')
        self.assertEqual(active['execution_skill']['facts']['tests'],failed['tests'])

    def test_persisted_supervisor_and_validation_reasons_are_not_replaced_by_generic_status(self):
        from studio_worker.tools.configurations import run_reason
        self.assertEqual(run_reason({'status': 'failed', 'exit': {'exit_code': -9, 'reason': 'time_limit'}}), 'Supervisor reason: time_limit')
        self.assertEqual(run_reason({'status': 'failed', 'exit': {'exit_code': 7, 'reason': None}}), 'Supervisor exit code: 7')
        self.assertEqual(run_reason({'status': 'draft', 'validation': {'status': 'failed', 'message': 'Synthetic persisted input check'}}), 'Validation failed: Synthetic persisted input check')

    def test_legacy_reason_projection_does_not_rewrite_configuration_history(self):
        record = self.plan(); record['tests'][0].pop('reason')
        self.service.store.put('tool-configuration', record)
        before = self.service.store.get('tool-configuration', record['id'])
        observed = self.api.status({'configuration_id': record['id']})
        self.assertEqual(observed['tests'][0]['reason'], 'Not executed: configuration is planned')
        self.assertEqual(self.service.store.get('tool-configuration', record['id']), before)
        self.assertEqual(self.service.store.runs(), [])

    def test_interrupted_installation_does_not_resume_or_create_runs(self):
        record = self.plan(); record['status'] = 'installing'; self.service.store.put('tool-configuration', record)
        unknown = self.api.status({'configuration_id': record['id']}); self.assertEqual(unknown['status'], 'unknown')
        self.assertIn('Not executed: configuration is unknown', unknown['tests'][0]['reason'])
        self.assertIn('Installation was interrupted', unknown['tests'][0]['reason'])
        with patch.object(self.service, 'submit', side_effect=AssertionError('No implicit resume')):
            self.assertEqual(self.api.execute(self.mutation(unknown))['status'], 'unknown')
        self.assertEqual(self.service.store.runs(), [])

    @unittest.skipUnless(os.name == 'posix' and Path('/proc').exists(), 'Linux worker lifecycle required')
    def test_real_copy_run_activation_and_archived_guidance_zero_read(self):
        origin = self.root / 'original-package'; origin.mkdir()
        for name in ('SKILL.md', 'install.md', 'configure.md'): (origin / name).write_text('Archived original guidance')
        (origin / 'validate_model.py').write_text('# Actual program role stays readable\n')
        self.api.register({**self.registration, 'origin_root': str(origin)})
        record = self.api.execute(self.mutation(self.plan()))
        record = self.complete(record)
        self.assertEqual(record['tests'][0]['status'], 'passed')
        self.assertIsNone(record['tests'][0]['reason'])
        self.assertFalse((Path(record['installed_prefix']) / 'repo/run.py').is_symlink())
        active = self.api.activate(self.mutation(record)); self.assertEqual(active['status'], 'active')
        self.assertGreaterEqual(active['archive_revision'], 1)
        self.assertEqual(active['functions'][0]['engine'], 'installation.check')
        self.assertEqual(active['source_commit'], self.manifest['repository']['commit'])
        self.assertEqual(active['execution_skill']['facts']['environment']['hardware'], 'cpu')
        self.assertEqual(active['execution_skill']['facts']['functions'][0]['run_spec']['parameters'], {'installation_case': 'worker'})
        body = active['execution_skill']['body']; archived = {self.package / name for name in ('SKILL.md', 'install.md', 'configure.md')}
        original = Path.read_bytes
        def guarded(path):
            if path in archived: raise AssertionError('Archived guidance was read')
            return original(path)
        with patch.object(Path, 'read_bytes', guarded), patch.object(Path, 'read_text', side_effect=AssertionError('Execution snapshot must not read guide text')):
            again = self.api.read({'configuration_id': record['id']})
        self.assertEqual(again['execution_skill']['body'], body)
        from studio_worker.workspace.workspace_io import read_input
        from studio_worker.tools.archive_guard import guidance_read_allowed
        from studio_worker.tools.source_projects import inspect_source
        archived |= {origin / name for name in ('SKILL.md', 'install.md', 'configure.md')}
        original_stat, original_open = Path.stat, Path.open
        original_os_stat, original_os_lstat = os.stat, os.lstat
        calls = []
        def stat(path, *args, **kwargs):
            if path in archived: calls.append('stat'); raise AssertionError('Archived guidance stat')
            return original_stat(path, *args, **kwargs)
        def opened(path, *args, **kwargs):
            if path in archived: calls.append('open'); raise AssertionError('Archived guidance open')
            return original_open(path, *args, **kwargs)
        def system_stat(original, operation):
            def invoke(path, *args, **kwargs):
                if not isinstance(path, int) and Path(path) in archived: calls.append(operation); raise AssertionError('Archived guidance filesystem access')
                return original(path, *args, **kwargs)
            return invoke
        indirect = self.root / 'ordinary-link.md'; indirect.symlink_to(origin / 'SKILL.md')
        with patch.object(Path, 'stat', stat), patch.object(Path, 'open', opened), patch.object(os, 'stat', system_stat(original_os_stat, 'os.stat')), patch.object(os, 'lstat', system_stat(original_os_lstat, 'os.lstat')):
            for path in archived:
                with self.assertRaises(PermissionError): read_input(self.service, {'project_id': 'project', 'name': str(path)})
            with self.assertRaises(PermissionError): read_input(self.service, {'project_id': 'project', 'name': str(indirect)})
            with patch('studio_worker.tools.source_projects.ALLOWED', {'pygas': ('SKILL.md', 'validate_model.py')}):
                source = inspect_source({'id': 'pygas', 'root': str(origin)}, read_guard=lambda path: guidance_read_allowed(self.service, path))
            self.assertEqual(source['files'][0]['status'], 'archived'); self.assertNotIn('sha256', source['files'][0])
            self.assertEqual(source['files'][1]['name'], 'validate_model.py')
            self.assertIn('Actual program role', read_input(self.service, {'project_id': 'project', 'name': str(origin / 'validate_model.py')})['text'])
        self.assertEqual(calls, [])
        state_root = self.service.root; self.service.close(); self.service.store.db.close()
        self.service = Service(state_root, schedule=False); self.api = ToolConfigurations(self.service)
        self.addCleanup(self.service.store.db.close); self.addCleanup(self.service.close)
        self.assertEqual(self.api.read({'configuration_id': record['id']})['execution_skill']['body'], body)
        environment = self.service.store.get('environment', 'environment'); environment['name'] = 'Changed registration'; self.service.store.put('environment', environment)
        stale = self.api.read({'configuration_id': record['id']}); self.assertEqual(stale['status'], 'stale')
        self.assertEqual(stale['execution_skill']['body'],body)
        self.assertEqual(stale['check_findings'][0]['status'],'warning')
        self.assertNotEqual(stale['current_environment_sha256'],stale['environment_sha256'])
        with self.assertRaises(PermissionError): read_input(self.service, {'project_id': 'project', 'name': str(origin / 'SKILL.md')})

    @unittest.skipUnless(os.name == 'posix' and Path('/proc').exists(), 'Linux worker lifecycle required')
    def test_active_body_alone_runs_fresh_reference_and_declares_actual_products_and_criteria(self):
        record = self.complete(self.api.execute(self.mutation(self.plan())))
        active = self.api.activate(self.mutation(record))
        body = active['execution_skill']['body']
        facts = json.loads(body.split('```json\n', 1)[1].split('\n```', 1)[0])
        self.assertEqual(facts, active['execution_skill']['facts'])
        feature = facts['functions'][0]; criteria = facts['reference_criteria']
        self.assertEqual(feature['input_files'][0]['name'], 'run.py')
        self.assertEqual(feature['input_files'][0]['source'], feature['installed_entrypoint'])
        self.assertEqual(feature['output_files'][0]['name'], 'smoke-result.json')
        self.assertEqual(feature['output_files'][0]['format'], 'json')
        self.assertFalse(feature['parameter_policy']['user_adjustable'])
        self.assertEqual(feature['parameter_policy']['optional_parameters'], [])
        self.assertEqual(feature['resources']['gpus'], 0)
        self.assertIn('never automatically', feature['failure_handling']['unknown'])
        for path in ('SKILL.md', 'install.md', 'configure.md'): self.assertNotIn(path, body)
        spec = copy.deepcopy(feature['run_spec']); spec['idempotency_key'] = 'fresh-body-only-reviewed-request'
        archived = {self.package / path for path in ('SKILL.md', 'install.md', 'configure.md')}
        original = Path.open
        def opened(path, *args, **kwargs):
            if path in archived: raise AssertionError('Fresh operation must not read archived instructions')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'open', opened):
            run = self.service.prepare(spec)
            self.assertEqual(run['command'], feature['worker_argv'])
            self.assertEqual(self.service.validate(run['id'])['validation']['status'], criteria['run']['validation_status'])
            run = self.service.submit(run['id'])
            deadline = time.monotonic() + 15
            while run['status'] in ('queued', 'running') and time.monotonic() < deadline:
                self.service.tick(); time.sleep(.05); run = self.service.store.run(run['id'])
        self.assertEqual(run['status'], criteria['run']['status'])
        root = Path(run['directory'])
        # Independently read actual new artifacts using only the generated body's paths and criteria.
        output = json.loads((root / criteria['output']['run_path']).read_text())
        for key, value in criteria['output']['required_fields'].items(): self.assertEqual(output[key], value)
        child = json.loads((root / criteria['child']['run_path']).read_text())
        self.assertIs(type(output['pid']), int); self.assertGreater(output['pid'], 0); self.assertEqual(output['pid'], child['pid'])
        exit_value = json.loads((root / criteria['supervisor']['run_path']).read_text())
        for key in ('exit_code', 'cancelled', 'reason'): self.assertEqual(exit_value[key], criteria['supervisor'][key])
        self.assertEqual(exit_value, run['exit'])
        self.assertIn(criteria['console']['required_line'], (root / criteria['console']['run_path']).read_text().splitlines())
        collected = self.service.collect(run['id'])
        self.assertIn(feature['output_files'][0]['name'], json.dumps(collected))
        self.assertEqual(self.api.read({'configuration_id': record['id']})['execution_skill']['body'], body)

    @unittest.skipUnless(os.name == 'posix' and Path('/proc').exists(), 'Linux worker lifecycle required')
    def test_lost_activation_response_reopen_discovers_global_archives_without_body_or_files(self):
        record = self.complete(self.api.execute(self.mutation(self.plan())))
        with patch.object(self.api, 'read', side_effect=ConnectionError('Synthetic activation response was lost after commit')):
            with self.assertRaises(ConnectionError): self.api.activate(self.mutation(record))
        self.assertEqual(self.service.store.get('tool-configuration', record['id'])['status'], 'active')
        state_root = self.service.root; self.service.close(); self.service.store.db.close()
        self.service = Service(state_root, schedule=False); self.api = ToolConfigurations(self.service)
        self.addCleanup(self.service.store.db.close); self.addCleanup(self.service.close)
        # Import before instrumentation: module loading itself is not guidance I/O.
        from studio_worker.tools.guidance_state import guidance_state
        from studio_worker.server import mcp_tool_call
        with patch.object(ToolConfigurations, 'status', side_effect=AssertionError('No runtime validation')), patch.object(ToolConfigurations, 'read', side_effect=AssertionError('No skill body')), patch.object(ToolConfigurations, 'execute', side_effect=AssertionError('No execution')), patch.object(Path, 'stat', side_effect=AssertionError('No stat')), patch.object(Path, 'open', side_effect=AssertionError('No open')), patch.object(Path, 'read_text', side_effect=AssertionError('No guide text')), patch.object(Path, 'read_bytes', side_effect=AssertionError('No guide bytes')), patch.object(Path, 'resolve', side_effect=AssertionError('No filesystem resolution')):
            metadata = dispatch(self.service, 'POST', '/api/tool-guidance/state', {}, admin=True)
        self.assertEqual(len(metadata['configurations']), 1)
        self.assertEqual(metadata['configurations'][0]['configuration_id'], record['id'])
        self.assertTrue(metadata['configurations'][0]['has_activation'])
        self.assertEqual({item['role'] for item in metadata['archived_resources']}, {'delivery', 'installation', 'configuration'})
        self.assertNotIn('"body"', json.dumps(metadata)); self.assertNotIn('"facts"', json.dumps(metadata))
        result = mcp_tool_call(self.service, {'name': 'tool_guidance_state', 'arguments': {}})
        self.assertTrue(result['isError']); self.assertNotIn('execution_skill', json.dumps(result))

    @unittest.skipUnless(os.name == 'posix' and Path('/proc').exists(), 'Linux worker lifecycle required')
    def test_changed_output_is_failed_evidence_even_when_configuration_is_enabled(self):
        record = self.complete(self.api.execute(self.mutation(self.plan())))
        run = self.service.store.run(record['tests'][0]['run_id'])
        (Path(run['directory']) / 'results/smoke-result.json').write_text('{"status":"passed","case":"worker","pid":1}')
        active=self.api.activate(self.mutation(record));self.assertEqual(active['status'],'active')
        failed = self.api.status({'configuration_id': record['id']})
        self.assertEqual(failed['status'], 'active'); self.assertEqual(failed['tests'][0]['status'], 'failed')
        self.assertEqual(failed['tests'][0]['reason'], 'Reference output failed the fixed independent criteria')
        self.assertEqual(len(self.service.store.list('tool-activation')),1)

    @unittest.skipUnless(os.name == 'posix' and Path('/proc').exists(), 'Linux worker lifecycle required')
    def test_all_cases_execute_and_installed_tamper_stales_active_snapshot(self):
        linked_entry = self.package / 'studio-worker-tests/process/run.py'; linked_entry.unlink(); linked_entry.symlink_to('../../repo/run.py')
        manifest = copy.deepcopy(self.manifest); case = copy.deepcopy(manifest['tests']['cases'][0]); case['id'] = 'process-second'
        manifest['tests']['cases'].append(case); manifest['functions'][0]['tests'].append(case['id'])
        (self.package / 'tool.json').write_text(json.dumps(manifest), encoding='utf-8')
        value = load_package(self.package); self.api.register({**self.registration, 'package_version': value['package_version']}); self.plan_args['package_version'] = value['package_version']
        record = self.complete(self.api.execute(self.mutation(self.plan())))
        self.assertEqual(len(record['tests']), 2); self.assertEqual(len({item['run_id'] for item in record['tests']}), 2)
        self.assertFalse((Path(record['installed_prefix']) / 'studio-worker-tests/process/run.py').is_symlink())
        self.assertEqual(self.api.activate(self.mutation(record))['status'], 'active')
        (Path(record['installed_prefix']) / 'repo/run.py').write_text('changed installed source')
        with self.assertRaisesRegex(ValueError,'Installed tool changed'):self.api.read({'configuration_id': record['id']})


if __name__ == '__main__': unittest.main()
