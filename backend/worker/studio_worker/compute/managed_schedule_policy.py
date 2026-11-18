"""Validate the fixed managed-compute actions and project ownership binding."""

import hashlib
import json
import math
import re


DEFAULT_INTERVAL = 1800
DEFAULT_BUDGET = 48
MAX_BUDGET = 336
SCHEDULE_KINDS = ('poll', 'action', 'script', 'wake_agent')
LOGS = ('console.log', 'queue.out', 'queue.err')
SCHEDULER_TERMINAL = frozenset(('COMPLETED', 'DONE', 'FAILED', 'EXIT', 'CANCELLED', 'TIMEOUT', 'OUT_OF_MEMORY'))
SCOPE_KEYS = ('provider', 'threadId', 'taskId', 'projectId', 'runId')
PLAN_KEYS = ('name', 'intervalSeconds', 'maxRuns', 'expiresAt', 'timeoutSeconds', 'action', 'script', 'wakeText')
UPSERT_KEYS = ('sourceId', 'scope', 'kind', 'key', 'delegationId', 'mutationId', 'expectedRevision', *PLAN_KEYS)


def fields(value, allowed, required=()):
    if not isinstance(value, dict) or set(value) - set(allowed) or not set(required) <= value.keys():
        raise ValueError('Invalid managed schedule fields')
    return value


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:+@~-]{0,511}', value):
        raise ValueError('Invalid managed schedule identifier')
    return value


def number(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f'Use an integer between {minimum} and {maximum}')
    return value


def text(value, limit, *, multiline=False):
    if (not isinstance(value, str) or not value.strip() or len(value.encode()) > limit or '\x00' in value or
            not multiline and any(ord(char) < 32 for char in value)):
        raise ValueError('Invalid or oversized managed schedule text')
    return value


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def normalize_scope(value, kind):
    fields(value, SCOPE_KEYS, SCOPE_KEYS)
    return {key: None if key == 'runId' and kind == 'wake_agent' and item is None else identifier(item)
            for key, item in value.items()}


def schedule_plan(data, previous, now):
    kind = data['kind']
    body = {**(previous or {}), **data}
    plan = {
        'name': text(body.get('name', data.get('key', kind)), 200),
        'intervalSeconds': number(body.get('intervalSeconds', DEFAULT_INTERVAL), 1, 2**31 - 1),
        'maxRuns': number(body.get('maxRuns', DEFAULT_BUDGET), 1, MAX_BUDGET),
        'timeoutSeconds': number(body.get('timeoutSeconds', 300 if kind == 'script' else 30), 1, 2**31 - 1),
    }
    default_expiry = math.ceil(now) + plan['intervalSeconds'] * (plan['maxRuns'] + 1)
    plan['expiresAt'] = number(body.get('expiresAt', default_expiry), 1, 253402300799)
    if (not previous or 'expiresAt' in data and data['expiresAt'] != previous['expiresAt']) and plan['expiresAt'] <= now:
        raise ValueError('The schedule expiry must be in the future')
    if previous and plan['maxRuns'] < previous['count']:
        raise ValueError('The new execution budget is smaller than the recorded count')
    for key, applies in [('script', kind == 'script'), ('action', kind == 'action'), ('wakeText', kind == 'wake_agent')]:
        if key in data and not applies:
            raise ValueError('The plan field does not apply to this schedule kind')
    if kind == 'wake_agent':
        plan['wakeText'] = text(body['wakeText'], 2048, multiline=True).strip()
    if kind == 'action':
        action = fields(body['action'], ('type', 'name', 'offset'), ('type',))
        if action['type'] == 'status' and set(action) == {'type'}:
            plan['action'] = action
        elif action['type'] == 'read_log' and action.get('name') in LOGS:
            plan['action'] = {'type': 'read_log', 'name': action['name'],
                              'offset': number(action.get('offset', 0), 0, 2**53 - 1)}
        else:
            raise ValueError('Select the fixed status or bounded log action')
    if kind == 'script':
        script = fields(data['script'], ('language', 'text', 'resources'), ('language', 'text')) if 'script' in data else body['script']
        if script['language'] not in ('bash', 'python'):
            raise ValueError('Select Bash or Python for the scheduler child')
        program = text(script['text'], 64 * 1024, multiline=True)
        resources = fields(script.get('resources', {}), ('cpus', 'gpus', 'memory_mb'))
        for key, value in resources.items():
            number(value, 0 if key == 'gpus' else 1, 2**31 - 1)
        sha256 = hashlib.sha256(program.encode()).hexdigest()
        prior = previous['script'] if previous else {}
        same_source = (prior.get('language'), prior.get('sha256')) == (script['language'], sha256)
        plan['script'] = {'language': script['language'], 'text': program, 'resources': resources, 'sha256': sha256,
                          'version': prior.get('version', 0) + int(not same_source)}
    return plan


def plan_snapshot(schedule):
    plan = {key: schedule[key] for key in PLAN_KEYS if key in schedule}
    if 'script' in plan:
        plan['script'] = {key: value for key, value in plan['script'].items() if key != 'text'}
    return plan


def project_parent(service, scope, previous=None):
    service.store.get('project', scope['projectId'])
    run_id = scope['runId']
    if run_id is None:
        return None, None
    if service.store.db_exists('cluster-run', run_id):
        run = service.clusters.raw(run_id)
        if run['project_id'] != scope['projectId'] or run.get('managed_child'):
            raise PermissionError('The parent run does not belong to this authorized project')
        service.clusters.allowed(run['project_id'], run['cluster_id'])
        profile = run['cluster_snapshot']
        if service.ssh_service_mode and profile.get('transport_kind') != 'ssh-service-local':
            raise PermissionError('The parent run belongs to a different authenticated service')
        reference = {'kind': 'cluster', 'nonce': run['nonce'], 'profileSha256': fingerprint(profile),
                     'clusterId': run['cluster_id'], 'directory': run['remote_directory']}
    else:
        run = service.store.run(run_id)
        if run['project_id'] != scope['projectId'] or service.ssh_service_mode:
            raise PermissionError('The parent run does not belong to this authorized local project')
        reference = {'kind': 'local', 'requestSha256': run['request_hash']}
    if previous is not None and previous != reference:
        raise PermissionError('The original parent run identity changed')
    return run, reference


def project_run(row):
    snapshot = row.get('cluster_snapshot', {})
    scheduler_state = row.get('scheduler_state') if row.get('identity_verified') is True else None
    local_observed = None
    if not snapshot and (row.get('exit') or row['status'] == 'running' and row.get('identity')):
        local_observed = row.get('updated_at') or row.get('started_at')
    return {
        'id': row['id'], 'projectId': row['project_id'], 'status': row['status'],
        'jobId': row.get('job_id'), 'scheduler': snapshot.get('scheduler'),
        'schedulerState': scheduler_state, 'schedulerTerminal': scheduler_state in SCHEDULER_TERMINAL,
        'updatedAt': row.get('updated_at'), 'observedAt': row.get('observed_at') or local_observed,
        'managedObservation': row.get('managed_schedule_parent', False) is True,
        **({'scheduleId': row['managed_child']['scheduleId'], 'parentRunId': row['managed_child']['scope']['runId']}
           if row.get('managed_child') else {}),
    }
