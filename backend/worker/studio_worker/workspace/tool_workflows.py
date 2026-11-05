"""Exact tool-group workspace snapshots composed over the existing worker run lifecycle."""
import copy
from dataclasses import dataclass
import json
from pathlib import Path
import re
import time

from studio_worker.workspace.group_contract import inspect_group
from studio_worker.workspace.layout import directory, mirror, new_run_directory
from studio_worker.tools.configurations import ToolConfigurations, identifier, request
from studio_worker.tools.package_contract import encoded, sha
from studio_worker.tools.reference_worker import REFERENCE_CRITERIA, reference_evidence

SCOPE = 'Manual-step fixed serial CPU worker engineering workflow only; no general shell, resource-edge or scientific executor'


class StaleWorkflow(ValueError):
    pass


@dataclass(frozen=True)
class RunContext:
    execution_id: str
    step_id: str
    token: object


def _context(service, context):
    if not isinstance(context, RunContext) or context.token is not service._tool_workflow_token:
        raise PermissionError('Worker-owned workflow execution context required')
    return context


def prepare_binding(service, context, spec):
    context = _context(service, context); owner = ToolWorkflows(service)
    execution = owner._execution(context.execution_id); step = owner._step(execution, context.step_id)
    if step['status'] != 'preparing' or encoded(spec) != encoded(step.get('spec')): raise PermissionError('Exact persisted workflow preparation intent required')
    owner._fresh_step(execution, step)
    return owner._binding(execution, step)


def run_directory(service, context, run_id):
    context = _context(service, context); owner = ToolWorkflows(service)
    execution = owner._execution(context.execution_id); step = owner._step(execution, context.step_id)
    if step['status'] != 'preparing': raise PermissionError('Persisted workflow preparation intent required')
    return new_run_directory(service.root, owner._step_relative(execution, step), run_id)


def assert_bound_run(service, run, context, phase):
    if not run.get('studio_workflow_binding'): return
    context = _context(service, context); owner = ToolWorkflows(service)
    execution = owner._execution(context.execution_id); step = owner._step(execution, context.step_id)
    if step['status'] != phase: raise PermissionError('Human-reviewed workflow execution phase required')
    owner._fresh_step(execution, step); owner._check_run(execution, step, run)


class ToolWorkflows:
    def __init__(self, service):
        self.service = service; self.store = service.store; self.configurations = ToolConfigurations(service)

    def _execution(self, execution_id):
        identifier(execution_id); value = self.store.get('workflow-execution', execution_id)
        if value.get('schema_version') != 1 or sha(encoded(value['snapshot'])) != value['snapshot_sha256']: raise ValueError('Workflow execution snapshot identity changed')
        frozen = value['snapshot']
        if value['id'] != execution_id or any(encoded(value[key]) != encoded(frozen[key]) for key in ('workflow_id', 'workspace_id', 'target', 'group', 'root')) or [step['id'] for step in value['steps']] != frozen['execution_order']: raise ValueError('Workflow execution identity differs from its snapshot')
        for step, source in zip(value['steps'], frozen['steps']):
            if any(step[key] != source[key] for key in ('id', 'tool_id', 'package_version', 'function_id')) or any(step[key] != source['configuration'][key] for key in ('configuration_id', 'execution_skill_id', 'execution_skill_sha256')): raise ValueError('Workflow step identity differs from its snapshot')
        return value

    def _step(self, execution, step_id):
        if type(step_id) is not str: raise ValueError('Exact workflow step required')
        step = next((item for item in execution['steps'] if item['id'] == step_id), None)
        if step is None: raise ValueError('Unknown workflow step')
        return step

    def _snapshot_step(self, execution, step):
        return next(item for item in execution['snapshot']['steps'] if item['id'] == step['id'])

    def _configuration(self, configuration_id, function_id):
        active = self.configurations.read({'configuration_id': configuration_id})
        if active['status'] != 'active' or not active.get('execution_skill'): raise StaleWorkflow(active.get('reason') or 'Existing active tool configuration required')
        record = self.store.get('tool-configuration', configuration_id)
        feature = next((item for item in active['execution_skill']['facts']['functions'] if item['id'] == function_id), None)
        if feature is None: raise StaleWorkflow('Configured function is unavailable')
        identity = {'configuration_id': configuration_id, 'execution_skill_id': active['execution_skill']['id'], 'execution_skill_sha256': active['execution_skill']['sha256'], 'package_id': active['package_id'], 'package_version': active['package_version'], 'manifest_sha256': active['manifest_sha256'], 'source_commit': active['source_commit'], 'target': active['target'], 'environment_sha256': record['environment_sha256'], 'authorization_sha256': record['authorization_sha256'], 'python': record['python'], 'installed_prefix': record['installed_prefix'], 'install_files': record['install']['files'], 'max_seconds': record['max_seconds']}
        return identity, feature

    def _fresh_step(self, execution, step, cache=None):
        frozen = self._snapshot_step(execution, step)
        key = (step['configuration_id'], step['function_id'])
        try:
            if cache is not None and key in cache: current, feature = cache[key]
            else:
                current, feature = self._configuration(*key)
                if cache is not None: cache[key] = (current, feature)
            if encoded(current) != encoded(frozen['configuration']) or current['target'] != execution['target'] or feature['installed_entrypoint'] != frozen['installed_entrypoint']: raise StaleWorkflow('Workflow package, configuration, environment, authorization, interpreter or installed source changed')
            return current, feature
        except (OSError, ValueError, KeyError, PermissionError) as error:
            if isinstance(error, StaleWorkflow): raise
            raise StaleWorkflow(str(error)[:2000]) from error

    def _binding(self, execution, step):
        return {'schema_version': 1, 'workflow_id': execution['workflow_id'], 'execution_id': execution['id'], 'step_id': step['id'], 'snapshot_sha256': execution['snapshot_sha256'], 'group_id': execution['group']['id'], 'group_version': execution['group']['version'], 'configuration_id': step['configuration_id'], 'execution_skill_id': step['execution_skill_id'], 'execution_skill_sha256': step['execution_skill_sha256']}

    def _step_relative(self, execution, step):
        workflow = self.store.get('workflow', execution['workflow_id'])
        expected = 'projects/' + execution['workspace_id'] + '/workflows/' + workflow['directory_name'] + '-' + workflow['id']
        if workflow.get('schema_version') != 2 or workflow['root'] != str(self.service.root / expected) or execution['root'] != str(self.service.root / expected / 'executions' / execution['id']): raise StaleWorkflow('Owned workflow root identity differs')
        index = execution['snapshot']['execution_order'].index(step['id']) + 1
        return expected + '/executions/' + execution['id'] + '/steps/' + str(index).zfill(3) + '-' + step['tool_id'] + '-' + step['id']

    def _expected_spec(self, execution, step):
        spec = copy.deepcopy(step['spec']); spec['studio_workflow_binding'] = self._binding(execution, step)
        return spec

    def _check_run(self, execution, step, run):
        expected = self._expected_spec(execution, step)
        digest = sha(json.dumps(expected, sort_keys=True).encode())
        if run['request_hash'] != step['run_request_hash'] or digest != run['request_hash'] or any(encoded(run.get(key)) != encoded(value) for key, value in expected.items()): raise StaleWorkflow('Bound workflow run request identity changed')
        if step['run_id'] is not None and run['id'] != step['run_id']: raise StaleWorkflow('Workflow step run identity changed')
        if run['directory'] != str(self.service.root / self._step_relative(execution, step) / run['id']): raise StaleWorkflow('Workflow run directory identity changed')
        if step.get('review') and (run['snapshots'] != step['review']['inputs'] or run['command'] != step['review']['argv']): raise StaleWorkflow('Reviewed immutable run snapshots or argv changed')
        self.service.verify_snapshot(run)

    def _review(self, execution, step, run):
        frozen = self._snapshot_step(execution, step); configuration = frozen['configuration']
        value = {'execution_id': execution['id'], 'step_id': step['id'], 'snapshot_sha256': execution['snapshot_sha256'], 'run_id': run['id'], 'request_hash': run['request_hash'], 'argv': copy.deepcopy(run['command']), 'inputs': copy.deepcopy(run['snapshots']), 'target': copy.deepcopy(execution['target']), 'directory': run['directory'], 'working_directory': str(Path(run['directory']) / 'results'), 'criteria': copy.deepcopy(REFERENCE_CRITERIA), 'group_id': execution['group']['id'], 'group_version': execution['group']['version'], 'function_id': step['function_id'], **copy.deepcopy(configuration)}
        value['review_sha256'] = sha(encoded(value)); return value

    def _derive(self, execution):
        steps = execution['steps']; statuses = [step['status'] for step in steps]
        execution['status'] = 'stale' if execution.get('blocked_reason') else 'passed' if all(status == 'passed' for status in statuses) else 'unknown' if 'unknown' in statuses else 'stale' if 'stale' in statuses else 'failed' if 'failed' in statuses else 'cancelled' if 'cancelled' in statuses else 'running' if any(status in ('queued', 'running') for status in statuses) else 'submitting' if 'submitting' in statuses else 'validating' if 'validating' in statuses else 'preparing' if 'preparing' in statuses else 'prepared' if 'prepared' in statuses else 'planned'
        execution['reason'] = execution.get('blocked_reason') or next((step['reason'] for step in steps if step['status'] in ('unknown', 'stale', 'failed', 'cancelled') and step.get('reason')), None)
        return execution

    def _mirrors(self, workflow, execution):
        root = Path(workflow['root']).relative_to(self.service.root).as_posix()
        mirror(self.service.root, root + '/workflow.json', workflow)
        mirror(self.service.root, root + '/executions/' + execution['id'] + '/execution.json', execution)

    def _save(self, execution):
        execution = self._derive(execution)
        execution['revision'] += 1; execution['updated_at'] = time.time()
        workflow = self.store.get('workflow', execution['workflow_id'])
        workflow['run_ids'] = list(dict.fromkeys([*workflow['run_ids'], *(step['run_id'] for step in execution['steps'] if step['run_id'])]))
        workflow['status'] = execution['status']
        self.store.put_many([('workflow', workflow), ('workflow-execution', execution)])
        try: self._mirrors(workflow, execution)
        except (OSError, ValueError) as error: self.store.event(None, {'kind': 'workflow-mirror', 'execution_id': execution['id'], 'error': str(error)[:2000]})
        return execution

    def _response(self, execution):
        execution = copy.deepcopy(execution); next_step = next((item for item in execution['steps'] if item['status'] != 'passed'), None)
        for step in execution['steps']:
            dependencies = self._snapshot_step(execution, step)['depends_on']
            step['eligible'] = execution['status'] not in ('stale', 'unknown', 'failed', 'cancelled') and step is next_step and step['status'] == 'pending' and all(self._step(execution, dependency)['status'] == 'passed' for dependency in dependencies)
            step.setdefault('run_status', None)
        return {'workflow': self.store.get('workflow', execution['workflow_id']), 'execution': execution}

    def create(self, data):
        request(data, ('request_id', 'name', 'directory_name', 'workspace_id', 'target', 'tool_groups', 'configurations'))
        identifier(data['request_id']); request(data['target'], ('target', 'project_id', 'environment_id'))
        if data['target']['target'] != 'local': raise ValueError('Only explicit local tool workflows supported')
        for key in ('workspace_id',):
            if type(data[key]) is not str or not re.fullmatch(r'[A-Za-z0-9_-]{3,80}', data[key]): raise ValueError('Existing Studio workspace identity required')
        if type(data['name']) is not str or not data['name'].strip() or len(data['name']) > 200 or re.search(r'[\x00-\x1f]', data['name']): raise ValueError('Bounded workflow name required')
        if type(data['directory_name']) is not str or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', data['directory_name']): raise ValueError('Safe workflow main directory name required')
        if type(data['tool_groups']) is not list or len(data['tool_groups']) != 1 or type(data['configurations']) is not list: raise ValueError('Exactly one bounded fixed tool group and explicit configurations required')
        workflow_id = 'workflow-' + sha(data['request_id'].encode())[:24]; execution_id = 'execution-' + sha(('first\0' + workflow_id).encode())[:24]; request_sha = sha(encoded(data))
        with self.service.tool_workflow_lock, self.service.tool_configuration_lock, self.store.lock:
            previous = next((item for item in self.store.list('workflow-execution') if item['id'] == execution_id), None)
            if previous is not None:
                if previous['request_sha256'] != request_sha: raise ValueError('Workflow creation request was already used differently')
                return self._response(self._refresh(previous))
            workspace = self.store.get('project', data['workspace_id'])
            if not workspace.get('studio_workspace') or workspace.get('authoring_only') is not True or data['workspace_id'] == data['target']['project_id']: raise PermissionError('Existing authoring workspace and separate explicit compute project required')
            group = inspect_group(self.service, data['tool_groups'][0]); bindings = {}
            for item in data['configurations']:
                request(item, ('step_id', 'configuration_id')); identifier(item['configuration_id'])
                if item['step_id'] in bindings: raise ValueError('Duplicate configured step')
                bindings[item['step_id']] = item['configuration_id']
            compiled = group['compiled']
            if set(bindings) != set(compiled['execution_order']): raise ValueError('All and only group steps require explicit active configurations')
            frozen_steps = []; steps = []
            for source in compiled['steps']:
                current, feature = self._configuration(bindings[source['id']], source['function_id'])
                if current['target'] != data['target'] or current['package_id'] != source['tool_id'] or current['package_version'] != source['package_version']: raise PermissionError('Group configuration must match exact package/function and same explicit compute project/environment')
                frozen_steps.append({**copy.deepcopy(source), 'configuration': current, 'installed_entrypoint': feature['installed_entrypoint']})
                steps.append({'id': source['id'], 'tool_id': source['tool_id'], 'package_version': source['package_version'], 'function_id': source['function_id'], 'configuration_id': current['configuration_id'], 'execution_skill_id': current['execution_skill_id'], 'execution_skill_sha256': current['execution_skill_sha256'], 'status': 'pending', 'reason': 'Not executed: explicit preparation and human review required', 'run_id': None, 'run_status': None, 'review': None})
            old_group = next((item for item in self.store.list('tool-group-version') if item['id'] == group['id']), None)
            if old_group is not None and encoded(old_group) != encoded(group): raise ValueError('Immutable worker tool-group version differs')
            relative = 'projects/' + data['workspace_id'] + '/workflows'; main_name = data['directory_name'] + '-' + workflow_id
            main_root = new_run_directory(self.service.root, relative, main_name)
            execution_root = directory(self.service.root, relative + '/' + main_name + '/executions/' + execution_id)
            snapshot = {'schema_version': 1, 'workflow_id': workflow_id, 'workflow_revision': 1, 'workspace_id': data['workspace_id'], 'target': copy.deepcopy(data['target']), 'group': {'id': group['group_id'], 'version': group['group_version']}, 'root': str(execution_root), 'execution_order': compiled['execution_order'], 'steps': frozen_steps, 'scope': SCOPE}
            workflow = {'schema_version': 2, 'id': workflow_id, 'project_id': data['target']['project_id'], 'workspace_id': data['workspace_id'], 'name': data['name'].strip(), 'directory_name': data['directory_name'], 'root': str(main_root), 'steps': copy.deepcopy(compiled['steps']), 'run_ids': [], 'tool_group_refs': [copy.deepcopy(snapshot['group'])], 'execution_ids': [execution_id], 'revision': 1, 'status': 'planned', 'execution_mode': 'manual_step_review'}
            execution = {'schema_version': 1, 'id': execution_id, 'workflow_id': workflow_id, 'revision': 1, 'status': 'planned', 'reason': None, 'execution_mode': 'manual_step_review', 'workspace_id': data['workspace_id'], 'target': copy.deepcopy(data['target']), 'group': copy.deepcopy(snapshot['group']), 'root': str(execution_root), 'steps': steps, 'snapshot': snapshot, 'snapshot_sha256': sha(encoded(snapshot)), 'request_sha256': request_sha, 'created_at': time.time(), 'scope': SCOPE, 'scientific_status': 'not_run'}
            self.store.put_many([('tool-group-version', old_group or group), ('workflow', workflow), ('workflow-execution', execution)])
            try: self._mirrors(workflow, execution)
            except (OSError, ValueError) as error: self.store.event(None, {'kind': 'workflow-mirror', 'execution_id': execution_id, 'error': str(error)[:2000]})
            return self._response(execution)

    def _revised(self, execution, expected):
        if type(expected) is not int or execution['revision'] != expected: raise ValueError('Workflow execution revision changed; read and review it again')

    def prepare(self, data):
        request(data, ('execution_id', 'step_id', 'expected_revision', 'request_id')); identifier(data['request_id'])
        with self.service.tool_workflow_lock, self.service.tool_configuration_lock, self.store.lock:
            execution = self._refresh(self._execution(data['execution_id'])); step = self._step(execution, data['step_id'])
            if step.get('request_id') == data['request_id'] and step.get('prepare_revision') == data['expected_revision']: return self._response(execution)
            self._revised(execution, data['expected_revision'])
            if not self._step(self._response(execution)['execution'], step['id'])['eligible']: raise PermissionError('Only the next pending step with independently passed dependencies may prepare')
            current, feature = self._fresh_step(execution, step)
            key = 'workflow:' + sha((execution['id'] + '\0' + step['id']).encode())[:48]
            step.update(status='preparing', reason=None, request_id=data['request_id'], prepare_revision=execution['revision'], idempotency_key=key)
            step['spec'] = {'project_id': execution['target']['project_id'], 'environment_id': execution['target']['environment_id'], 'engine': 'installation.check', 'gpu': 0, 'max_seconds': current['max_seconds'], 'inputs': {'run.py': feature['installed_entrypoint']}, 'parameters': {'installation_case': 'worker'}, 'idempotency_key': key, 'workflow_id': execution['workflow_id'], 'origin': 'desktop', 'name': self.store.get('workflow', execution['workflow_id'])['name'][:100] + ' · ' + step['id']}
            step['run_request_hash'] = sha(json.dumps(self._expected_spec(execution, step), sort_keys=True).encode())
            execution = self._save(execution)
            try:
                context = RunContext(execution['id'], step['id'], self.service._tool_workflow_token)
                run = self.service.prepare(step['spec'], _workflow_context=context)
                self._check_run(execution, step, run)
                step.update(run_id=run['id'], run_status=run['status'], review=self._review(execution, step, run), status='prepared', reason=None)
                return self._response(self._save(execution))
            except Exception as error:
                step.update(status='unknown', reason=('Preparation result was not confirmed: ' + str(error))[:2000])
                self._save(execution); raise

    def execute(self, data):
        request(data, ('execution_id', 'step_id', 'expected_revision', 'review_sha256'))
        with self.service.tool_workflow_lock, self.service.tool_configuration_lock:
            execution = self._refresh(self._execution(data['execution_id'])); step = self._step(execution, data['step_id'])
            if not step.get('review') or data['review_sha256'] != step['review']['review_sha256']: raise ValueError('Actual prepared workflow review identity required')
            if step['status'] in ('queued', 'running', 'passed', 'failed', 'cancelled', 'unknown', 'stale'): return self._response(execution)
            self._revised(execution, data['expected_revision'])
            if execution.get('blocked_reason') or step['status'] != 'prepared' or not step['run_id']: raise PermissionError('Existing prepared step and fresh human review required')
            with self.store.lock:
                self._fresh_step(execution, step); run = self.store.run(step['run_id']); self._check_run(execution, step, run)
                if run['status'] not in ('draft', 'ready'): raise PermissionError('Unknown or submitted runs are never resubmitted')
                step.update(status='validating', reason=None); execution = self._save(execution)
            context = RunContext(execution['id'], step['id'], self.service._tool_workflow_token)
            try:
                run = self.service.validate(step['run_id'], _workflow_context=context)
                if run['status'] != 'ready' or run.get('validation', {}).get('status') != 'passed': raise ValueError(run.get('validation', {}).get('message', 'Actual workflow target validation failed'))
                with self.store.lock:
                    self._fresh_step(execution, step); self._check_run(execution, step, run)
                    step.update(status='submitting'); execution = self._save(execution)
                    run = self.service.submit(step['run_id'], _workflow_context=context)
                    step.update(status=run['status'], run_status=run['status'], reason=None)
                    return self._response(self._save(execution))
            except Exception as error:
                phase = step['status']; step.update(status='unknown' if phase == 'submitting' else 'stale' if isinstance(error, StaleWorkflow) else 'failed', reason=str(error)[:2000])
                self._save(execution); raise

    def _refresh(self, execution):
        original = encoded(execution); cache = {}; blocked = None
        for step in execution['steps']:
            try: self._fresh_step(execution, step, cache)
            except (OSError, ValueError, KeyError, PermissionError) as error: blocked = str(error)[:2000]
            if step['status'] == 'pending': continue
            try:
                run = self.store.run(step['run_id']) if step['run_id'] else self.store.by_key(execution['target']['project_id'], step['idempotency_key'])
                if run is None:
                    step.update(status='unknown', reason='No durable run confirms the recorded preparation; never create another attempt automatically'); continue
                self._check_run(execution, step, run)
                if not step['run_id']:
                    step.update(run_id=run['id'], review=self._review(execution, step, run), status='prepared', reason=None)
                step['run_status'] = run['status']
                if run['status'] in ('draft', 'ready'):
                    if step['status'] == 'validating': step.update(status='prepared', reason='Validation was interrupted; review this same run again before explicit execution')
                    elif step['status'] not in ('prepared', 'failed', 'stale'): step.update(status='unknown', reason='Submission is unconfirmed; inspect the same existing run, never resubmit automatically')
                elif run['status'] == 'validating': step.update(status='unknown', reason='Run validation is unconfirmed; no automatic submit')
                else:
                    frozen = self._snapshot_step(execution, step)['configuration']
                    evidence = reference_evidence(self.service, frozen, {'run_id': run['id'], 'request_hash': step['run_request_hash']})
                    step.update(status=evidence['status'], reason=evidence['reason'])
                    if evidence['status'] == 'passed': step['evidence'] = evidence
            except (OSError, ValueError, KeyError, PermissionError) as error:
                step.update(status='stale', reason=str(error)[:2000]); blocked = str(error)[:2000]
        if blocked: execution['blocked_reason'] = blocked
        self._derive(execution)
        return self._save(execution) if encoded(execution) != original else execution

    def status(self, data):
        request(data, ('execution_id',))
        with self.service.tool_workflow_lock, self.service.tool_configuration_lock, self.store.lock:
            return self._response(self._refresh(self._execution(data['execution_id'])))

    def read(self, data):
        return self.status(data)
