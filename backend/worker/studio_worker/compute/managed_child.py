"""Prepare immutable temporary scripts for a child Slurm or LSF allocation."""

import io
import json
import secrets
import shlex
import tarfile
import time
from pathlib import Path

from studio_worker.infrastructure.util import atomic_json, stable_file_snapshot


def checked_target(service, parent, timeout, requested):
    from studio_worker.compute.cluster import resources

    original = parent['cluster_snapshot']
    project, current = service.clusters.allowed(parent['project_id'], parent['cluster_id'])
    if (current['version'] != original['version'] or current['scheduler'] != original['scheduler'] or
            parent['engine'] not in project['policy']['engines'] or timeout > project['policy']['max_seconds']):
        raise PermissionError('The original scheduler or project grant no longer permits this child')
    if service.ssh_service_mode and original.get('transport_kind') != 'ssh-service-local':
        raise PermissionError('Temporary scripts require the same-host authenticated service')
    # Allocate within the resources of the approved parent on its exact queue.
    caps = parent['resources']
    actual = {'cpus': 1, 'gpus': 0, 'memory_mb': min(512, caps['memory_mb']), **requested}
    if any(actual[key] > caps[key] for key in actual):
        raise PermissionError('Child resources exceed the original allocation')
    actual.update({key: caps[key] for key in ('queue', 'account', 'qos', 'queue_target_id') if key in caps})
    target = parent.get('queue_target_snapshot')
    if target:
        profile, granted, selected, _policy = service.clusters.select_queue_target(project, current, {
            'engine': parent['engine'], 'max_seconds': timeout, 'resources': actual,
        })
        if selected != target or any(profile[key] != original[key] for key in ('environment', 'activation', 'limits', 'queue')):
            raise PermissionError('The original queue target changed')
        return granted
    if ('queue_targets' in current or current['id'] in project['policy'].get('cluster_queue_policies', {})):
        raise PermissionError('Current queue policy requires an explicitly reviewed target')
    return resources(actual, current, timeout)


def prepare_child(service, schedule, active, parent):
    config = schedule['script']
    duration = schedule['timeoutSeconds']
    actual = checked_target(service, parent, duration, config['resources'])
    identifier = secrets.token_hex(12)
    directory = service.root / 'cluster-runs' / identifier
    simulation = directory / 'simulation'
    simulation.mkdir(parents=True)
    name = 'scheduled.sh' if config['language'] == 'bash' else 'scheduled.py'
    payload = config['text'].encode()
    path = simulation / name
    path.write_bytes(payload)
    path.chmod(0o444)
    now = time.time()
    profile = parent['cluster_snapshot']
    binding = {'scheduleId': schedule['id'], 'occurrence': active['occurrence'], 'sourceId': schedule['sourceId'],
               'scope': schedule['scope'], 'parentNonce': parent['nonce'], 'parentDirectory': parent['remote_directory'],
               'configSha256': active['configSha256'], 'language': config['language']}
    child = {
        'id': identifier, 'kind': 'cluster-run', 'name': schedule['name'], 'project_id': parent['project_id'],
        'cluster_id': parent['cluster_id'], 'engine': parent['engine'], 'parameters': {}, 'inputs': {},
        'idempotency_key': active['id'], 'request_hash': active['configSha256'],
        'cluster_snapshot': profile, 'resources': actual, 'max_seconds': duration, 'managed_child': binding,
        'directory': str(directory), 'remote_directory': profile['remote_root'].rstrip('/') + '/' + identifier,
        'status': 'ready', 'job_name': 'gss-' + identifier, 'job_id': None, 'nonce': secrets.token_hex(16),
        'created_at': now, 'updated_at': now,
        'snapshots': [{'name': name, 'source_kind': 'managed_script', 'size': len(payload), 'sha256': config['sha256']}],
        'validation': {'status': 'passed', 'scope': 'immutable script and original scheduler resource bounds'},
        'scientific_validation': {'status': 'not_run'},
    }
    child['script'] = child_batch(child)
    atomic_json(directory / 'run.json', child)
    return child


def validate_child(service, child):
    binding = child['managed_child']
    parent = service.clusters.raw(binding['scope']['runId'])
    if (parent['project_id'] != child['project_id'] or parent['nonce'] != binding['parentNonce'] or
            parent['cluster_snapshot'] != child['cluster_snapshot'] or parent['remote_directory'] != binding['parentDirectory']):
        raise PermissionError('The original parent run changed')
    requested = {key: child['resources'][key] for key in ('cpus', 'gpus', 'memory_mb')}
    if checked_target(service, parent, child['max_seconds'], requested) != child['resources']:
        raise PermissionError('The child allocation no longer matches the original authorized target')
    snapshot_bytes(child)
    if child_batch(child) != child['script']:
        raise ValueError('Immutable child job script changed')


def snapshot_bytes(child):
    asset = child['snapshots'][0]
    snapshot, payload = stable_file_snapshot(Path(child['directory']) / 'simulation' / asset['name'], include_bytes=True,
                                             max_bytes=64 * 1024)
    if snapshot['sha256'] != asset['sha256'] or snapshot['size'] != asset['size']:
        raise ValueError('Immutable temporary script changed')
    return payload


def shell_path(value):
    return '"$HOME"/' + shlex.quote(value[2:]) if value.startswith('~/') else shlex.quote(value)


def child_batch(run):
    from studio_worker.compute.cluster import scheduler_headers

    profile, binding = run['cluster_snapshot'], run['managed_child']
    environment = profile['environment']
    python = environment['executables']['python']
    asset = run['snapshots'][0]
    command = ['/bin/bash', '--noprofile', '--norc', asset['name']] if binding['language'] == 'bash' else [python, '-u', asset['name']]
    verify = 'import hashlib,sys; sys.exit(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest()!=sys.argv[2])'
    receipt = ('import json,os,sys; json.dump({"nonce":' + repr(run['nonce']) + ',"exit_code":int(sys.argv[1])},'
               'open("exit.tmp","w")); os.replace("exit.tmp","exit.json")')
    duration = run['max_seconds']
    exports = ['export ' + key + '=' + shlex.quote(str(value)) for key, value in environment.get('variables', {}).items()]
    repositories = list(environment.get('repositories', {}).values())
    if repositories:
        exports.append('export PYTHONPATH=' + shlex.quote(':'.join(repositories)) + ':${PYTHONPATH:-}')
    return '\n'.join([*scheduler_headers(run), 'set -u', 'umask 077',
                      'if [ "${CUDA_VISIBLE_DEVICES+x}" = x ]; then STUDIO_ASSIGNED_CUDA=$CUDA_VISIBLE_DEVICES; STUDIO_ASSIGNED=1; fi',
                      profile.get('activation', ''), *exports,
                      'if [ "${STUDIO_ASSIGNED:-0}" = 1 ]; then export CUDA_VISIBLE_DEVICES=$STUDIO_ASSIGNED_CUDA; fi',
                      'cd ' + shell_path(run['remote_directory']) + ' || exit 1',
                      'export AIMATTERLAB_PARENT_RUN_DIR=' + shell_path(binding['parentDirectory']),
                      'export AIMATTERLAB_SCHEDULE_ID=' + shlex.quote(binding['scheduleId']),
                      'export AIMATTERLAB_OCCURRENCE=' + str(binding['occurrence']),
                      'if ' + shlex.join([python, '-c', verify, 'simulation/' + asset['name'], asset['sha256']]) + '; then',
                      f' (cd simulation && timeout --signal=TERM --kill-after=5s {duration}s {shlex.join(command)}) >console.log 2>&1',
                      ' status=$?', 'else', ' status=65', 'fi',
                      shlex.join([python, '-c', receipt]) + ' "$status"', 'exit "$status"', ''])


def archive_child(child):
    asset = child['snapshots'][0]
    binding = {key: child['managed_child'][key] for key in ('scheduleId', 'occurrence', 'scope', 'configSha256', 'language')}
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
        for name, value in [('simulation/' + asset['name'], snapshot_bytes(child)), ('job.sh', child['script'].encode()),
                            ('.studio/schedule.json', json.dumps({**binding, 'scriptSha256': asset['sha256']}).encode())]:
            info = tarfile.TarInfo(name)
            info.mode, info.size = 0o600, len(value)
            archive.addfile(info, io.BytesIO(value))
    return buffer.getvalue()
