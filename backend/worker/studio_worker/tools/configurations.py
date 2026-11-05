"""Worker-authoritative configuration of the fixed CPU worker engineering reference."""
import copy
import json
import os
from pathlib import Path
import re
import secrets
import time

from studio_worker.tools.adapters import Adapter, INSTALLATION_CHECKS
from studio_worker.tools.package_contract import encoded, load_package, owned, read_bytes, sha
from studio_worker.compute.runtime_guides import fingerprint, file_digest

from studio_worker.tools.reference_worker import SCOPE, REFERENCE_CRITERIA, run_reason, reference_evidence


def request(data, keys):
    if type(data) is not dict or set(data) != set(keys): raise ValueError('Exact typed tool configuration request required')


def identifier(value):
    if type(value) is not str or not re.fullmatch(r'[A-Za-z0-9_-]{8,80}', value): raise ValueError('Invalid configuration identity')
    return value


def package_key(package_id, version):
    if type(package_id) is not str or not re.fullmatch(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*', package_id) or type(version) is not str or not re.fullmatch(r'[0-9a-f]{64}', version): raise ValueError('Exact package identity required')
    return sha((package_id + '\0' + version).encode())


def python_identity(environment):
    value = environment.get('executables', {}).get('python')
    if type(value) is not str or not Path(value).is_absolute() or not Path(value).is_file() or not os.access(value, os.X_OK): raise ValueError('Registered Python executable unavailable')
    path = Path(value)
    if path.stat().st_size > 512 * 1024 * 1024: raise ValueError('Interpreter observation exceeds supported bound')
    return {'path': value, 'resolved': str(path.resolve()), 'size': path.stat().st_size, 'sha256': file_digest(path)}


class ToolConfigurations:
    def __init__(self, service):
        self.service = service
        self.store = service.store

    def create_project(self, data):
        request(data, ('project_id', 'name', 'environment_id'))
        project_id, name, environment_id = data['project_id'], data['name'], data['environment_id']
        if type(project_id) is not str or not re.fullmatch(r'tool-config-[0-9a-f]{24}', project_id): raise ValueError('Dedicated tool configuration project identity required')
        if type(name) is not str or not name.strip() or len(name) > 200 or re.search(r'[\x00-\x1f]', name): raise ValueError('Bounded project name required')
        if type(environment_id) is not str or not environment_id or len(environment_id) > 200 or re.search(r'[/\\\x00-\x1f]', environment_id): raise ValueError('Registered environment identity required')
        value = {'id': project_id, 'name': name.strip(), 'policy': {'engines': ['installation.check'], 'gpus': [0], 'max_seconds': 30, 'max_concurrent': 1, 'input_roots': [str(self.service.root / 'projects' / project_id / 'inputs')], 'environments': [environment_id]}}
        # The normal project editor holds this same lock across validation and write.
        # This operation never upserts a differing project, even after a stale desktop read.
        with self.store.lock:
            self.store.get('environment', environment_id)
            previous = next((item for item in self.store.list('project') if item['id'] == project_id), None)
            if previous is not None:
                if encoded(previous) != encoded(value): raise ValueError('Configuration project already exists with different metadata or authorization; existing project is preserved')
                return previous
            return self.service.register_project(value)

    def register(self, data):
        if type(data) is not dict: raise ValueError('Exact package registration required')
        data = dict(data); origin = data.pop('origin_root', None)
        request(data, ('snapshot_root', 'package_id', 'package_version'))
        if type(data['snapshot_root']) is not str or not Path(data['snapshot_root']).is_absolute() or re.search(r'[\r\n\x00]', data['snapshot_root']): raise ValueError('Absolute package snapshot root required')
        if origin is not None and (type(origin) is not str or not Path(origin).is_absolute() or os.path.normpath(origin) != origin or re.search(r'[\r\n\x00]', origin)): raise ValueError('Canonical origin alias required')
        key = package_key(data['package_id'], data['package_version'])
        package = load_package(data['snapshot_root'], data['package_version'])
        if package['package_id'] != data['package_id']: raise ValueError('Package identity differs')
        record = {'schema_version': 1, 'id': key, 'record_id': key, **package, 'source_commit': package['manifest']['repository']['commit'], 'scope': 'definition_checked', 'installation': {'status': 'not_run'}, 'tests': {'status': 'not_run'}}
        with self.store.lock:
            prior = next((item for item in self.store.list('tool-package-version') if item['id'] == key), None)
            if prior is not None:
                if prior != record: raise ValueError('Immutable package registration differs')
            alias = next((item for item in self.store.list('tool-package-alias') if item['id'] == key), {'schema_version': 1, 'id': key, 'roots': [], 'revision': 0})
            roots = sorted(set([*alias['roots'], package['snapshot_root'], *([origin] if origin else [])]))
            if roots != alias['roots']: alias = {**alias, 'roots': roots, 'revision': alias.get('revision', 0) + 1}
            self.store.put_many([('tool-package-version', prior or record), ('tool-package-alias', alias)])
            return prior or record

    def _package(self, configuration):
        return self.store.get('tool-package-version', package_key(configuration['package_id'], configuration['package_version']))

    def _reference(self, package):
        manifest = package['manifest']; environment = manifest['environment']; parallel = environment['parallelism']
        if environment['hardware'] != 'cpu' or parallel['supported'] != ['serial'] or (parallel['threads'], parallel['processes'], parallel['gpus']) != (1, 1, 0): raise ValueError('Only serial CPU engineering reference is supported')
        for feature in manifest['functions']:
            if feature['engine'] != 'installation.check' or feature['operation']['command'] != ['{python}', '{entrypoint}'] or feature['inputs'] or feature['parameters']: raise ValueError('Only fixed installation.check/worker reference is supported')
            if len(feature['outputs']) != 1 or feature['outputs'][0]['type'] != 'file' or feature['outputs'][0]['format'] != 'json': raise ValueError('Reference requires one JSON output')
        for case in manifest['tests']['cases']:
            if case['resources'] or len(case['expected_outputs']) != 1 or case['expected_outputs'][0]['path'] != REFERENCE_CRITERIA['output']['name'] or case['expected_outputs'][0]['format'] != REFERENCE_CRITERIA['output']['format']: raise ValueError('Only fixed worker output criteria supported')
        entries = {feature['entrypoint'] for feature in manifest['functions']} | {case['entrypoint'] for case in manifest['tests']['cases']}
        for entry in entries:
            code = read_bytes(package['snapshot_root'], entry)
            if sha(code.decode('utf-8').replace('\r\n', '\n').replace('\r', '\n').encode()) != INSTALLATION_CHECKS['worker']: raise ValueError('Reference source differs from the shipped worker case')
        return sorted(entries)

    def _target(self, configuration):
        target = configuration['target']
        environment = self.store.get('environment', target['environment_id'])
        project = self.store.get('project', target['project_id'])
        if project.get('authoring_only'): raise PermissionError('Explicit compute project required')
        self.service.authorize({'project_id': target['project_id'], 'environment_id': target['environment_id'], 'engine': 'installation.check', 'gpu': 0, 'max_seconds': configuration['max_seconds']})
        return project, environment

    def _fresh(self, configuration, full_package=False):
        project, environment = self._target(configuration)
        if fingerprint(environment) != configuration['environment_sha256'] or sha(encoded(project['policy'])) != configuration['authorization_sha256'] or python_identity(environment) != configuration['python']: raise ValueError('Configuration environment, authorization or interpreter changed')
        package = self._package(configuration)
        if full_package:
            current = load_package(package['snapshot_root'], package['package_version'])
            if current['files'] != package['files']: raise ValueError('Package snapshot changed')
        return package, environment

    def plan(self, data):
        request(data, ('package_id', 'package_version', 'target', 'request_id'))
        request(data['target'], ('target', 'project_id', 'environment_id'))
        if data['target']['target'] != 'local': raise ValueError('Only explicit local tool configuration supported')
        for field in ('project_id', 'environment_id'):
            value = data['target'][field]
            if type(value) is not str or not value or len(value) > 200 or value in ('.', '..') or re.search(r'[/\\\x00-\x1f]', value): raise ValueError('Exact registered project and environment required')
        identifier(data['request_id'])
        package = self.store.get('tool-package-version', package_key(data['package_id'], data['package_version']))
        current = load_package(package['snapshot_root'], package['package_version'])
        if current['files'] != package['files']: raise ValueError('Package snapshot changed')
        entries = self._reference(package)
        configuration_id = sha(data['request_id'].encode())[:24]
        with self.store.lock:
            previous = next((item for item in self.store.list('tool-configuration') if item['id'] == configuration_id), None)
            if previous:
                if previous['request_sha256'] != sha(encoded(data)): raise ValueError('Configuration request ID was already used differently')
                return self.status({'configuration_id': configuration_id})
            project = self.store.get('project', data['target']['project_id'])
            maximum = min(30, int(project['policy']['max_seconds']))
            record = {'schema_version': 1, 'id': configuration_id, 'configuration_id': configuration_id, 'package_id': data['package_id'], 'package_version': data['package_version'], 'manifest_sha256': package['manifest_sha256'], 'target': copy.deepcopy(data['target']), 'max_seconds': maximum, 'scope': SCOPE, 'scientific_status': 'not_run'}
            project, environment = self._target(record)
            record.update(environment_sha256=fingerprint(environment), authorization_sha256=sha(encoded(project['policy'])), python=python_identity(environment))
            prefix = self.service.root / 'projects' / project['id'] / 'inputs' / 'tool-configurations' / configuration_id / 'installed'
            record.update(installed_prefix=str(prefix), entries=entries, tests=[{'id': case['id'], 'function_id': case['function_id'], 'entrypoint': case['entrypoint'], 'status': 'not_run', 'run_id': None, 'reason': 'Not executed: configuration is planned'} for case in package['manifest']['tests']['cases']])
            record['plan_sha256'] = sha(encoded(record))
            record.update(revision=1, status='planned', request_sha256=sha(encoded(data)), install={'status': 'not_run'}, created_at=time.time())
            return self.store.put('tool-configuration', record)

    def _test_reasons(self, record):
        tests = []
        for item in record['tests']:
            test = item
            if test['status'] == 'passed': test['reason'] = None
            elif not test['run_id']:
                test['reason'] = ('Not executed: configuration is ' + record['status'] + ('. ' + record['reason'] if record.get('reason') else ''))[:2000]
            elif test['status'] != 'failed' or not test.get('reason'):
                test['reason'] = run_reason(self.store.run(test['run_id']))
                if record['status'] == 'failed' and test['status'] not in ('failed', 'cancelled') and record.get('reason'):
                    test['reason'] = ((test['reason'] + '; ' if test['reason'] else '') + 'Configuration failed: ' + record['reason'])[:2000]
            tests.append(test)
        return tests

    def _save(self, record, **changes):
        record = {**record, **changes, 'revision': record['revision'] + 1, 'updated_at': time.time()}
        record['tests'] = self._test_reasons(record)
        return self.store.put('tool-configuration', record)

    def _get(self, data, mutation=False):
        request(data, ('configuration_id', 'expected_revision', 'plan_sha256') if mutation else ('configuration_id',))
        identifier(data['configuration_id'])
        record = self.store.get('tool-configuration', data['configuration_id'])
        if mutation and (type(data['expected_revision']) is not int or data['expected_revision'] != record['revision'] or data['plan_sha256'] != record['plan_sha256']): raise ValueError('Configuration review revision changed')
        # Older configuration records gain a read projection; package/run/activation history is untouched.
        record['tests'] = self._test_reasons(record)
        return record

    def _installed(self, record):
        prefix = Path(record['installed_prefix'])
        if record['install']['status'] != 'passed': raise ValueError('Actual installation required')
        for item in record['install']['files']:
            owned(prefix, item['path'])
            value = read_bytes(prefix, item['path'])
            if len(value) != item['size'] or sha(value) != item['sha256']: raise ValueError('Installed tool changed')

    def execute(self, data):
        with self.service.tool_configuration_lock:
            record = self._get(data, True)
            if record['status'] != 'planned': return self.status({'configuration_id': record['id']})
            package, _environment = self._fresh(record, True)
            self._reference(package)
            record = self._save(record, status='installing')
            try:
                prefix = Path(record['installed_prefix']); owned(self.service.root, str(prefix.relative_to(self.service.root)), directory=True)
                if prefix.exists(): raise ValueError('New private installation prefix required')
                prefix.parent.mkdir(parents=True, exist_ok=True)
                temporary = prefix.parent / ('staging-' + secrets.token_hex(8)); temporary.mkdir()
                installed = []
                for entry in record['entries']:
                    value = read_bytes(package['snapshot_root'], entry)
                    target = temporary / entry; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(value)
                    installed.append({'path': entry, 'size': len(value), 'sha256': sha(value)})
                temporary.rename(prefix)
                record = self._save(record, install={'status': 'passed', 'files': installed, 'method': 'private-copy-sha256'}, status='testing')
                self._installed(record); self._fresh(record, True)
                for test in record['tests']:
                    spec = {'project_id': record['target']['project_id'], 'environment_id': record['target']['environment_id'], 'engine': 'installation.check', 'gpu': 0, 'max_seconds': record['max_seconds'], 'inputs': {'run.py': str(prefix / test['entrypoint'])}, 'parameters': {'installation_case': 'worker'}, 'idempotency_key': 'tool-config:' + record['id'] + ':' + sha(test['id'].encode())[:20], 'name': 'Tool reference ' + test['id']}
                    with self.store.lock:
                        self._fresh(record); self._installed(record)
                        run = self.service.prepare(spec)
                    test['run_id'] = run['id']; test['request_hash'] = run['request_hash']; test['status'] = 'prepared'
                    record = self._save(record, tests=record['tests'])
                    run = self.service.validate(run['id'])
                    if run['status'] != 'ready': raise ValueError('Reference test input validation failed')
                    with self.store.lock:
                        self._fresh(record, True); self._installed(record)
                        run = self.service.submit(run['id'])
                    test['status'] = run['status']
                    record = self._save(record, tests=record['tests'])
                return self.status({'configuration_id': record['id']})
            except Exception as error:
                self._save(record, status='failed', reason=str(error)[:2000])
                raise

    def _evidence(self, record, test):
        return reference_evidence(self.service, record, test)

    def status(self, data):
        with self.service.tool_configuration_lock:
            record = self._get(data)
            if record['status'] == 'installing':
                return self._save(record, status='unknown', reason='Installation was interrupted; inspect this attempt, never restart it automatically')
            if record['status'] == 'unknown' and record['install']['status'] != 'passed': return record
            if record['status'] in ('testing', 'tested', 'active', 'unknown'):
                try:
                    self._fresh(record); self._installed(record)
                    if record['status'] == 'active': return record
                    tests = []; evidence_error = None
                    for test in record['tests']:
                        try:
                            tests.append({**test, **(self._evidence(record, test) if test['run_id'] else {'status': 'not_run'})})
                        except (OSError, ValueError, KeyError) as error:
                            evidence_error = str(error)[:2000]
                            tests.append({**test, 'status': 'failed', 'reason': evidence_error})
                    statuses = [item['status'] for item in tests]
                    state = 'stale' if evidence_error else 'tested' if all(item == 'passed' for item in statuses) else 'unknown' if any(item in ('unknown', 'draft', 'ready', 'not_run', 'validating') for item in statuses) else 'failed' if any(item in ('failed', 'cancelled') for item in statuses) else 'testing'
                    if tests != record['tests'] or state != record['status']: record = self._save(record, tests=tests, status=state, **({'reason': evidence_error} if evidence_error else {}))
                except (OSError, ValueError, KeyError) as error:
                    record = self._save(record, status='stale', reason=str(error)[:2000])
            return record

    def activate(self, data):
        with self.service.tool_configuration_lock, self.store.lock:
            record = self._get(data, True)
            record = self.status({'configuration_id': record['id']})
            if record['status'] == 'active': return self.read({'configuration_id': record['id']})
            if record['status'] != 'tested': raise ValueError('All actual installed functional tests must pass before activation')
            package, _environment = self._fresh(record, True); self._installed(record)
            for test in record['tests']:
                if self._evidence(record, test)['status'] != 'passed': raise ValueError('Actual complete test evidence required')
            body = '# Configured CPU worker reference\n\n' + SCOPE + '\n\n'
            body += '## Normal operation\n\nUse the complete function run_spec below with a fresh idempotency_key for each newly reviewed request. The fixed run.py input is the installed program; there are no user input files, adjustable parameters or optional values. installation_case=worker is fixed, not a user option. CPU serial resources are one thread, one process and zero GPUs; gpu=0 is the existing authorization slot. Keep the recorded project, environment, installed path and time bound.\n\n'
            body += 'Prepare that exact run through Studio, review its actual immutable input snapshots and target, then stop for human execution approval. Only the human execution channel validates and submits the existing run. The worker creates a separate run directory; worker_argv executes the snapshotted run.py in its results directory (task_workdir). argv identifies the installed source entrypoint. Do not execute the installed source in the installation prefix.\n\n'
            body += 'Read run status and collect its artifacts. The normal product is smoke-result.json (JSON) in task_workdir. To inspect it use read_artifact with the existing run_id and that filename. The reference_criteria below state the actual independent setup/test checks, including supervisor exit.json, child.json PID, JSON contents and the console.log marker. A historical passed status or hash alone does not establish a new run passed.\n\n'
            body += 'On failed or cancelled runs, retain that run and report its persisted validation/error/exit reason; inspect its console without substituting output. For unknown status or an unconfirmed response, read the same original run and never prepare or submit a replacement automatically. If the configuration, interpreter or installed files are stale, stop for explicit repair/update. Normal operation uses this snapshot and the installed source; no installation or delivery document is needed.\n\n## Exact execution facts\n\n'
            functions = []
            for feature in package['manifest']['functions']:
                entry = str(Path(record['installed_prefix']) / feature['entrypoint'])
                run_spec = {'project_id': record['target']['project_id'], 'environment_id': record['target']['environment_id'], 'engine': REFERENCE_CRITERIA['run']['engine'], 'gpu': 0, 'max_seconds': record['max_seconds'], 'inputs': {'run.py': entry}, 'parameters': copy.deepcopy(REFERENCE_CRITERIA['run']['parameters']), 'idempotency_key': '{new_reviewed_request_id}'}
                functions.append({**copy.deepcopy(feature), 'installed_entrypoint': entry, 'argv': [record['python']['path'], entry], 'working_directory': '{task_workdir}',
                    'worker_argv': Adapter(REFERENCE_CRITERIA['run']['engine']).prepare(run_spec, _environment),
                    'input_files': [{'name': 'run.py', 'source': entry, 'format': 'python', 'required': True, 'role': 'Fixed installed engine program; no user-supplied input'}],
                    'output_files': [{'port_id': feature['outputs'][0]['id'], 'name': REFERENCE_CRITERIA['output']['name'], 'format': REFERENCE_CRITERIA['output']['format'], 'directory': '{task_workdir}', 'required': True}],
                    'parameter_policy': {'user_adjustable': False, 'optional_inputs': [], 'optional_parameters': [], 'fixed_parameters': copy.deepcopy(REFERENCE_CRITERIA['run']['parameters'])},
                    'resources': {'hardware': 'cpu', 'parallelism': 'serial', 'threads': 1, 'processes': 1, 'gpus': 0, 'authorization_gpu_slot': 0, 'max_seconds': record['max_seconds']},
                    'failure_handling': {'declared': feature['operation']['failure_handling'], 'failed_or_cancelled': 'Retain the original run; report persisted validation/error/exit reason and inspect console', 'unknown': 'Read the same original run; never automatically prepare, resubmit or fall back', 'stale_configuration': 'Stop for explicit repair/update; never silently reinstall'},
                    'run_spec': run_spec})
            facts = {'configuration_id': record['id'], 'package_id': record['package_id'], 'package_version': record['package_version'], 'manifest_sha256': record['manifest_sha256'], 'source_commit': package['source_commit'], 'target': record['target'], 'environment_sha256': record['environment_sha256'], 'python': record['python']['path'], 'installed_prefix': record['installed_prefix'], 'environment': copy.deepcopy(package['manifest']['environment']), 'functions': functions, 'reference_criteria': copy.deepcopy(REFERENCE_CRITERIA), 'tests': record['tests'], 'scientific_status': 'not_run'}
            body += '```json\n' + json.dumps(facts, ensure_ascii=False, indent=2) + '\n```\n'
            skill_id = sha(body.encode('utf-8'))
            skill = {'schema_version': 1, 'id': skill_id, 'configuration_id': record['id'], 'sha256': skill_id, 'body': body, 'facts': facts, 'scope': SCOPE}
            activation = {'schema_version': 1, 'id': record['id'], 'configuration_id': record['id'], 'package_id': record['package_id'], 'package_version': record['package_version'], 'environment_sha256': record['environment_sha256'], 'execution_skill_id': skill_id, 'revision': record['revision'] + 1}
            record = {**record, 'status': 'active', 'revision': record['revision'] + 1, 'execution_skill_id': skill_id}
            self.store.put_many([('tool-execution-skill', skill), ('tool-activation', activation), ('tool-configuration', record)])
            return self.read({'configuration_id': record['id']})

    def read(self, data):
        with self.service.tool_configuration_lock:
            record = self.status(data)
            package = self._package(record)
            from studio_worker.tools.archive_guard import archived_resources
            alias = self.store.get('tool-package-alias', package['id'])
            facts = {'package_id': record['package_id'], 'package_version': record['package_version'], 'manifest_sha256': record['manifest_sha256'], 'source_commit': package['source_commit'], 'functions': copy.deepcopy(package['manifest']['functions']), 'target': record['target'], 'environment_sha256': record['environment_sha256'], 'archive_revision': alias.get('revision', 1), 'archived_resources': [item for item in archived_resources(self.service) if item['configuration_id'] == record['id']]}
            if record['status'] != 'active': return {'schema_version': 1, 'status': record['status'], 'configuration_id': record['id'], 'revision': record['revision'], **facts, 'reason': record.get('reason', 'No active execution skill'), 'scope': SCOPE}
            activation = self.store.get('tool-activation', record['id'])
            skill = self.store.get('tool-execution-skill', activation['execution_skill_id'])
            if skill['id'] != record['execution_skill_id'] or sha(skill['body'].encode('utf-8')) != skill['sha256'] or activation['environment_sha256'] != record['environment_sha256']: raise ValueError('Execution snapshot identity changed')
            return {'schema_version': 1, 'status': 'active', 'configuration_id': record['id'], 'revision': record['revision'], **facts, 'execution_skill': copy.deepcopy(skill), 'scope': SCOPE}
