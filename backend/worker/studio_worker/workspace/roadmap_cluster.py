"""Bind one workflow graph to the scheduler on its authenticated SSH resource."""
from pathlib import Path
import time

from studio_worker.compute.ssh_service import assert_binding
from studio_worker.compute.bound_cluster import private_engine
from studio_worker.tools.package_contract import sha, encoded
from studio_worker.workspace.layout import directory
from studio_worker.workspace.roadmap_tools import TOOLS, FORMATS, consumed, file_identity


class MissingTools(ValueError):
    def __init__(self, steps):
        self.steps = steps
        super().__init__('Configure the tools used by these steps on this resource')


def cluster_target(service, target, engine, selected):
    cluster_id = target['cluster_id']
    project, profile = service.clusters.allowed(target['project_id'], cluster_id)
    if profile.get('transport_kind') != 'ssh-service-local':
        raise PermissionError('Select a scheduler registered on the original job service')
    assert_binding(service, profile)
    if engine not in project['policy']['engines'] or not 0 < target['max_seconds'] <= project['policy']['max_seconds']:
        raise PermissionError('Project authorization does not cover this tool or duration')
    resources = dict(target['resources'])
    if selected:
        resources.pop('queue', None)
        resources.pop('account', None)
        resources['queue_target_id'] = selected
    resolved, allocation, queue, policy = service.clusters.select_queue_target(project, profile, {
        'resources':resources, 'engine':engine, 'max_seconds':target['max_seconds']})
    env_id = queue['id'] if queue else 'cluster:' + cluster_id
    node_target = {'project_id':project['id'], 'cluster_id':cluster_id, 'resources':allocation,
                   'profile_version':profile['version'], 'max_seconds':target['max_seconds'],
                   'gpu':target['gpu'], 'queue_policy_sha256':sha(encoded(policy)),
                   'queue_activation_sha256':sha(encoded(resolved.get('activation', '')))}
    return node_target, {**resolved['environment'], 'id':env_id}


def declared_tool(service, engine, parameters, env_id, cluster_id, *, activation_id=None):
    if not private_engine(engine):
        return None
    from studio_worker.tools.resource_tools import resolve_invocation
    return resolve_invocation(service, engine, parameters, environment_id=env_id, cluster_id=cluster_id, activation_id=activation_id)


def installation_available(service, target, engine, selected):
    _, profile = service.clusters.allowed(target['project_id'],target['cluster_id'])
    assert_binding(service, profile)
    environment_id = selected or target['resources'].get('queue_target_id')
    if 'queue_targets' not in profile:
        environment_id = 'cluster:' + profile['id']
    try:
        return declared_tool(service,engine,{},environment_id,profile['id']) is not None
    except (FileNotFoundError, ValueError):
        return False


def execution_root(service, state):
    workspace = state['workspace_receipt']
    from studio_worker.workspace.resource_workspace import verified_session_directory
    base = verified_session_directory(service, workspace, provider=workspace['provider'], thread_id=workspace['thread_id'])
    return directory(base, 'runs/' + state['id'])


def check_target(service, snapshot, node):
    target, env = cluster_target(service, snapshot['target'], node['tool'],
                                 node['target']['resources'].get('queue_target_id'))
    project = service.store.get('project', target['project_id'])
    if target != node['target'] or env != node['environment'] or sha(encoded(project['policy'])) != snapshot['project_policy_sha256']:
        raise ValueError('The confirmed allocation, environment or project policy changed')
    if private_engine(node['tool']):
        tool = declared_tool(service, node['tool'], node['parameters'], env['id'], target['cluster_id'],
                             activation_id=node['version'].get('activation_id'))
        if not tool or tool['version'] != node['version'] or tool['argv'] != node['argv'] or tool.get('activation') != node.get('activation'):
            raise ValueError('The confirmed tool installation or template changed')
    else:
        from studio_worker.workspace.roadmap_tools import tool_identity
        if tool_identity(node['tool'], env) != node['version']:
            raise ValueError('The confirmed tool installation changed')


def collect(state, node, active, run):
    receipt = run.get('exit') or {}
    if not run.get('job_id') or receipt.get('nonce') != run['nonce'] or receipt.get('exit_code') != 0:
        raise ValueError('The original scheduler job and its successful exit receipt are required')
    root = Path(run['remote_directory']) / 'simulation'
    produced = {}
    for port, ref in node['outputs'].items():
        path = root / ref['name']
        if path.resolve(strict=True) != path or not path.is_file():
            raise ValueError('Missing or replaced workflow output: ' + port)
        observer = FORMATS.get(ref['format'])
        observed = observer(path) if observer else {**file_identity(path), 'facts':{}}
        produced[ref['resource']] = {**ref, **observed, 'path':str(path), 'observed_at':time.time(),
            'producer':{'step_id':node['id'], 'port':port, 'run_id':run['id']}}
    if node['tool'] in TOOLS:
        active['consumed'] = consumed(run, active['inputs'], produced.values(), output_root=root)
    state['artifacts'].update(produced)
    active.update(status='passed', run_status=run['status'])


def advance(controller, state, snapshot, node, active):
    from studio_worker.workspace.roadmap_execution import binding
    service = controller.service
    clusters = service.clusters
    key = 'roadmap:' + sha(encoded([state['id'], node['id']]))
    owner = binding(state, node)
    if active.get('run_id'):
        run = clusters.raw(active['run_id'])
    else:
        run = next((r for r in service.store.list('cluster-run') if r['project_id'] == node['target']['project_id']
                    and r['idempotency_key'] == key), None)
    if run is None:
        if active['status'] not in ('pending', 'preparing'):
            active.update(status='unknown', reason='Reconcile the original scheduler submission')
            return
        check_target(service, snapshot, node)
        inputs = controller._build(state, snapshot, node)
        if node['tool'] == 'gpumd.md':
            from studio_worker.workspace.roadmap_tools import md_velocity_source
            observed = md_velocity_source(inputs['structure']['path'], node['native_controls'])
            if node['velocity_initialization']['source'] != 'upstream_structure' and observed != node['velocity_initialization']:
                raise ValueError('The MD velocity initialization changed')
        active.update(status='preparing', inputs=inputs)
        controller.store.put('roadmap-state', state)
        target = node['target']
        spec = {k:target[k] for k in ('project_id', 'cluster_id', 'max_seconds', 'resources')}
        spec.update(engine=node['tool'], name=node['label'], parameters=node['parameters'], idempotency_key=key,
                    studio_workflow_binding=owner)
        record = clusters.prepare_bound(spec, argv=node['argv'], version=node['version'],
            inputs={v['name']:v for v in inputs.values()}, output_root=directory(execution_root(service,state),'steps/'+node['id']),
            owner=owner, activation=node.get('activation'))
        run = clusters.raw(record['id'])
    bound = run.get('bound_invocation') or {}
    if bound.get('owner') != owner or run.get('command') != node['argv'] or run['idempotency_key'] != key:
        raise ValueError('Scheduler run is not the invocation frozen for this step')
    active.update(run_id=run['id'], run_status=run['status'], job_id=run.get('job_id'), directory=run['remote_directory'])
    if run['status'] in ('draft', 'ready'):
        check_target(service, snapshot, node)
        if run.get('submit_attempted'):
            active.update(status='unknown', reason='Submission already attempted; reconcile its receipt')
            return
        # Clusters.submit durably reserves a unique attempt before contacting the scheduler.
        active.update(status='prepared')
        controller.store.put('roadmap-state', state)
        try:
            result = clusters.submit(run['id'])
        except PermissionError as error:
            if str(error) != 'Project concurrency limit reached':
                raise
            return
        active.update(status='unknown' if result['status']=='unknown' else 'submitted', run_status=result['status'], job_id=result.get('job_id'))
    elif run['status'] == 'succeeded':
        collect(state, node, active, run)
    elif run['status'] in ('failed', 'cancelled'):
        active.update(status=run['status'], reason=run.get('error') or str(run.get('exit')))
    else:
        active.update(status='unknown' if run['status']=='unknown' else 'submitted')
