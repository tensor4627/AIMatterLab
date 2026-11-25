"""Worker-owned installation, minimal scheduler tests, and private activation."""
import base64
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time

from studio_worker.compute.ssh_service import assert_binding
from studio_worker.infrastructure.util import atomic_json, contained, stable_file_snapshot
from studio_worker.tools import resource_tool_git as git_ops
from studio_worker.tools import resource_tool_build as builder
from studio_worker.tools.resource_tool_manifest import (
    SHA256, SLUG, absolute_path, args_for, fields, file_receipt, fingerprint, manifest, match, numeric, relative_path,
)
from studio_worker.tools.resource_tool_sources import CHUNK, MAX_PACKAGE, copy_release, discover, download, extract_archive


SETUP = 'resource-tool-setup'
ACTIVE = 'resource-tool-activation'
TEST_ENGINE = 'installation.check'
MAX_FIXTURE = 16 * 1024 * 1024
MAX_TEST_TEXT = 2 * 1024 * 1024
ROUTES = ('fresh', 'existing', 'custom')
REQUEST_ID = re.compile(r'[A-Za-z0-9_-]{8,120}')
RUN_ID = re.compile(r'[a-f0-9]{24}')


class TestOutputsError(ValueError):
    def __init__(self, message, outputs):
        super().__init__(message)
        self.outputs = outputs


def verified_workspace(service, resource_id, workspace_id):
    from studio_worker.workspace.resource_workspace import verified_workspace as check
    return check(service, resource_id, workspace_id)


def checked_folder(parent, name, create=False):
    item = parent / name
    if create:
        item.mkdir(mode=0o700, exist_ok=True)
    if item.resolve(strict=True) != item or not item.is_dir():
        raise ValueError('Folder changed or points outside its expected location: ' + str(item))
    return item


def environment_hash(profile):
    return fingerprint([profile['environment'], profile.get('activation', '')])


def duration(definition):
    return max(definition['test']['max_seconds'], definition.get('build', {}).get('max_seconds', 0))


def _target(service, project_id, cluster_id, queue_id, seconds, resources):
    project, profile = service.clusters.allowed(project_id, cluster_id)
    assert_binding(service, profile)
    if project.get('authoring_only') or TEST_ENGINE not in project['policy']['engines'] or seconds > project['policy']['max_seconds']:
        raise PermissionError('Select a project that authorizes installation checks on this scheduler')
    spec = {'resources':{**resources, **({'queue_target_id':queue_id} if queue_id else {})},
            'engine':TEST_ENGINE, 'max_seconds':seconds}
    resolved, allocation, queue, _policy = service.clusters.select_queue_target(project, profile, spec)
    environment_id = queue['id'] if queue else 'cluster:' + profile['id']
    target = {'project_id':project_id, 'cluster_id':cluster_id, 'environment_id':environment_id,
              'queue':allocation['queue'], 'scheduler':profile['scheduler'],
              **({'queue_target_id':queue['id']} if queue else {})}
    return target, project, profile, resolved, allocation


def _closure(source, executable, files, interpreter, profile, dependencies):
    registered = profile['environment']['executables']
    prefix = []
    closure = {**files,source:executable,**{registered[name]:file_receipt(registered[name]) for name in dependencies if name in registered}}
    if interpreter:
        program = registered.get(interpreter) or ('/bin/bash' if interpreter == 'bash' else None)
        if not program:
            raise ValueError('The selected queue environment requires a registered Python interpreter')
        entry = file_receipt(program)
        prefix.append(program)
        closure[program] = entry
    else:
        program = source
        entry = executable
    if not os.access(program, os.X_OK) or not Path(source).is_file():
        raise ValueError('The reviewed executable is not available on the selected resource')
    return [*prefix, source], {
        'executable':program, 'executable_sha256':entry['sha256'],
        'tool_executable':source, 'tool_executable_sha256':executable['sha256'],
        'files':{name:row['sha256'] for name,row in closure.items()},
        'resolved_files':{name:row['path'] for name,row in closure.items()},
        'dependencies':[name for name in dependencies if name not in registered],
    }


def _verify_files(version):
    for name, expected in {**version['files'], version['executable']:version['executable_sha256']}.items():
        observed = file_receipt(name)
        if observed['path'] != version.get('resolved_files', {}).get(name,name) or observed['sha256'] != expected:
            raise ValueError('The tested executable or supporting file changed: ' + name)


def resolve_invocation(service, tool_id, parameters, *, environment_id=None, cluster_id=None, activation_id=None):
    """Resolve an active template from the original worker, account, and environment."""
    if not isinstance(tool_id, str) or not tool_id.startswith('private.') or not SLUG.fullmatch(tool_id[8:]):
        return None
    rows = sorted(service.store.list(ACTIVE), key=lambda row: row['activated_at'], reverse=True)
    for row in rows:
        target = row['target']
        if (row['engine'] != tool_id or environment_id is not None and target['environment_id'] != environment_id or
                cluster_id is not None and target['cluster_id'] != cluster_id or
                activation_id is not None and row['id'] != activation_id):
            continue
        verified_workspace(service, row['resource_id'], row['workspace_id'])
        profile = service.store.get('cluster', target['cluster_id'])
        assert_binding(service, profile)
        effective = profile
        if target.get('queue_target_id'):
            effective = next((queue for queue in profile.get('queue_targets', [])
                              if queue['id'] == target['queue_target_id'] and queue['enabled']), None)
        if not effective or environment_hash(effective) != row['environment_sha256']:
            continue
        _verify_files(row['version'])
        definition = row['manifest']
        return {'activationId':row['id'], 'catalogueSha256':row['catalogue_sha256'],
                'inputs':{key:(item['filename'],item['format']) for key,item in definition['inputs'].items()},
                'outputs':{key:(item['filename'],item['format']) for key,item in definition['outputs'].items()},
                'argv':row['command_prefix'] + args_for(definition, parameters), 'version':row['version']}
    return None


def registered_engines(service):
    engines = {TEST_ENGINE}
    for row in service.store.list(ACTIVE):
        try:
            verified_workspace(service, row['resource_id'], row['workspace_id'])
        except (PermissionError, OSError, ValueError):
            continue
        engines.add(row['engine'])
    return sorted(engines)


class ResourceTools:
    def __init__(self, service):
        self.service, self.store = service, service.store
        with self.store.lock:
            if not hasattr(service, '_resource_tool_workers'):
                service._resource_tool_workers = {}
                service._resource_tool_install = threading.Lock()
        self.workers = service._resource_tool_workers

    def _workspace(self, data):
        return verified_workspace(self.service, data['resource_id'], data['workspace_id'])

    def _row(self, data):
        identifier = match(data['setup_id'], SHA256, 'Select a resource tool configuration')
        row = self.store.get(SETUP, identifier)
        if row['resource_id'] != data['resource_id']:
            raise PermissionError('This configuration belongs to another resource')
        self._workspace(row)
        return row

    def _public(self, row):
        keys = ('id', 'resource_id', 'workspace_id', 'route', 'status', 'stage', 'revision', 'plan_sha256',
                'manifest', 'target', 'install_root', 'activity', 'build', 'test', 'activation_id', 'skill', 'supply', 'message',
                'onboarding')
        return {key:deepcopy(row[key]) for key in keys if key in row}

    def _save(self, row, **updates):
        with self.store.lock:
            row = self.store.get(SETUP, row['id'])
            if any(row.get(key) != value for key,value in updates.items()):
                row = self.store.put(SETUP, {**row, **updates, 'revision':row['revision'] + 1})
            return row

    def _activity(self, row, stage, state, note, **changes):
        with self.store.lock:
            current = self.store.get(SETUP, row['id'])
            event = {'stage':stage, 'status':state, 'message':note}
            activity = current['activity'] if current['activity'][-1:] == [event] else (current['activity'] + [event])[-24:]
            return self._save(current, stage=stage, activity=activity, **changes)

    def list(self, data):
        fields(data, ('resource_id','workspace_id'), ('project_id',))
        workspace = self._workspace(data)
        setups, targets, profiles = [], [], {}
        for profile in self.store.list('cluster'):
            if profile.get('transport_kind') != 'ssh-service-local':
                continue
            try:
                assert_binding(self.service, profile)
            except (OSError, PermissionError, ValueError):
                continue
            profiles[profile['id']] = profile
        for row in self.store.list(SETUP):
            if row['resource_id'] == data['resource_id'] and (not data.get('project_id') or row['target']['project_id'] == data['project_id']):
                setups.append(self._public(row))
        visible = set()
        for project in self.store.list('project'):
            if data.get('project_id') and data['project_id'] != project['id']:
                continue
            for cluster_id in project['policy'].get('clusters', []):
                profile = profiles.get(cluster_id)
                if not profile:
                    continue
                visible.add(cluster_id)
                choices = [queue['id'] for queue in profile['queue_targets']] if 'queue_targets' in profile else [None]
                for queue_id in choices:
                    try:
                        target, *_ = _target(self.service, project['id'], cluster_id, queue_id, 1,
                                             {'cpus':1,'gpus':0,'memory_mb':1})
                    except (ValueError, PermissionError):
                        continue
                    targets.append(target)
        schedulers = [
            {'id':item['id'], 'name':item['name'], 'scheduler':item['scheduler'],
             'queue_targets':'queue_targets' in item, **({'queue':item['queue']} if item.get('queue') else {})}
            for item in profiles.values() if not data.get('project_id') or item['id'] in visible
        ]
        return {'setups':sorted(setups, key=lambda row:row['id']), 'targets':targets, 'schedulers':schedulers,
                'workfile_root':str(Path(workspace['root'])/'workfile')}

    def discover(self, data):
        fields(data, ('resource_id','workspace_id','directory'))
        self._workspace(data)
        return discover(data['directory'])

    def _review_inputs(self, workspace, definition, project):
        roots = [Path(workspace['root'])/'workfile', *project['policy'].get('input_roots', []),
                 self.service.root/'projects'/project['id']/'inputs']
        result = {}
        for port, fixture in definition['test']['inputs'].items():
            if 'path' in fixture:
                source = contained(absolute_path(fixture['path']), roots)
                result[port] = file_receipt(source, MAX_FIXTURE)
            else:
                content = fixture['text'].encode()
                result[port] = {'sha256':hashlib.sha256(content).hexdigest(), 'size':len(content)}
        return result

    def plan(self, data):
        fields(data, ('resource_id','workspace_id','request_id','route','manifest','project_id','cluster_id','environment_id'),
               ('queue_target_id','candidate','prior_run_id','onboarding'))
        workspace = self._workspace(data)
        request = match(data['request_id'], REQUEST_ID, 'Use a stable setup request identity')
        if data['route'] not in ROUTES:
            raise ValueError('Select a tool configuration route')
        definition = manifest(data['manifest'], data['route'])
        onboarding = tool_onboarding(data['onboarding'], definition) if 'onboarding' in data else None
        target, project, profile, effective, allocation = _target(
            self.service, data['project_id'], data['cluster_id'], data.get('queue_target_id'),
            duration(definition), definition['test'].get('resources', {}))
        if target['environment_id'] != data['environment_id']:
            raise ValueError('Selected scheduler environment differs from the reviewed choice')
        source = definition['source']
        candidate = data.get('candidate')
        prior = data.get('prior_run_id')
        if prior is not None:
            match(prior, RUN_ID, 'Use the original job-service run ID')
        if data['route'] == 'existing' and candidate is None:
            raise ValueError('Choose or confirm one representative script')
        installed = None
        if source['kind'] == 'installed':
            installed = file_receipt(absolute_path(source['executable']))
            if source.get('sha256') and installed['sha256'] != source['sha256']:
                raise ValueError('The installed program checksum differs from the reviewed source')
        if candidate is not None:
            fields(candidate, ('path','sha256'))
            if source['kind'] != 'installed' or candidate['path'] != source['executable'] or candidate['sha256'] != installed['sha256']:
                raise ValueError('The selected script changed; scan and review it again')
        fixtures = self._review_inputs(workspace, definition, project)
        software = Path(workspace['root']) / 'software'
        source_id = fingerprint([source, definition.get('support_files', [])])
        identifier = fingerprint([workspace['id'],request])
        install_key = identifier if 'build' in definition else source_id
        destination = software / definition['id'] / (definition['version'] + '-' + install_key[:16])
        if source['kind'] == 'installed':
            destination = Path(installed['path']).parent
        preview = {'id':identifier, 'resource_id':data['resource_id'], 'workspace_id':data['workspace_id'],
                   'route':data['route'], 'manifest':definition, 'target':target, 'install_root':str(destination),
                   'allocation':allocation, 'project_revision':project['revision'], 'profile_version':profile['version'],
                   'environment_sha256':environment_hash(effective), 'fixtures':fixtures, 'installed_source':installed,
                   'prior_run_id':prior}
        if onboarding is not None:
            preview['onboarding'] = onboarding
        plan_sha256 = fingerprint(preview)
        with self.store.lock:
            if self.store.db_exists(SETUP, identifier):
                previous = self.store.get(SETUP, identifier)
                if previous['plan_sha256'] != plan_sha256:
                    raise ValueError('This request ID already has a different reviewed plan')
                return self._public(previous)
            row = self.store.put(SETUP, {**preview, 'schema_version':1, 'plan_sha256':plan_sha256, 'revision':1,
                                         'status':'planned', 'stage':'review', 'activity':[]})
            return self._public(row)

    def _check_plan(self, row):
        definition, target = row['manifest'], row['target']
        selected, project, profile, effective, allocation = _target(
            self.service, target['project_id'], target['cluster_id'], target.get('queue_target_id'),
            duration(definition), definition['test'].get('resources', {}))
        if ((selected, project['revision'], profile['version'], allocation, environment_hash(effective)) !=
                (target, row['project_revision'], row['profile_version'], row['allocation'], row['environment_sha256'])):
            raise ValueError('The project grant, queue or environment changed; review a new configuration')
        return project, effective

    def start(self, data):
        fields(data, ('resource_id','setup_id','revision','plan_sha256'))
        with self.store.lock:
            row = self._row(data)
            if row['status'] != 'planned' or row['revision'] != data['revision'] or row['plan_sha256'] != data['plan_sha256']:
                raise ValueError('Configuration review changed; reopen it before running a test')
            self._check_plan(row)
            row = self._activity(row, 'verify', 'pending', 'Checking the reviewed resource and release', status='acquiring')
        self._kick(row)
        return self._public(row)

    def _staging(self, row):
        software = Path(self._workspace(row)['root']) / 'software'
        control = checked_folder(software, '.aimatterlab', create=True)
        setups = checked_folder(control, 'setups', create=True)
        return software, checked_folder(setups, row['id'], create=True)

    def _package(self, row, staging, which, source):
        path = staging / (which + '.release')
        if path.is_symlink():
            raise ValueError('Release staging file changed')
        expected = source.get('sha256')
        if path.is_file():
            if expected and file_receipt(path, MAX_PACKAGE)['sha256'] != expected:
                raise ValueError('Staged package checksum changed')
            return path
        if not source.get('url'):
            self._activity(row, 'transfer', 'pending', 'Choose the reviewed local release file or its path on this resource',
                           status='needs_file', supply=which)
            return None
        self._activity(row, 'cluster_download', 'pending', 'Downloading the pinned release from the cluster')
        try:
            download(source['url'], path, expected)
        except (OSError, ValueError, ConnectionError):
            self._activity(row, 'cluster_download', 'failed', 'The cluster could not acquire the pinned release')
            self._activity(row, 'desktop_download', 'pending', 'Cluster download failed. Trying the same release on the desktop',
                           status='desktop_fallback', supply=which)
            return None
        self._activity(row, 'cluster_download', 'passed', 'Cluster release checksum verified')
        return path

    def _git(self, row, software, staging):
        source = row['manifest'].get('git_bootstrap')
        with self.service._resource_tool_install:
            git, receipt = git_ops.find_git(software)
            if git:
                return git,receipt
            if not (staging / 'git.release').exists():
                try:
                    git, receipt = git_ops.install_system_package(software, staging)
                except (OSError, ValueError, subprocess.SubprocessError):
                    git = None
                if git:
                    return git,receipt
        if not source:
            raise ValueError('Git is unavailable. Add a compatible pinned Git archive to the configuration or enable the site Git module')
        package = self._package(row, staging, 'git', source)
        if not package:
            return None,None
        with self.service._resource_tool_install:
            return git_ops.install_git(software, package, source['executable'], source['sha256'])

    def _install(self, row, software, staging, git):
        definition = row['manifest']
        source = definition['source']
        if source['kind'] == 'installed':
            observed = file_receipt(source['executable'])
            if observed != row['installed_source']:
                raise ValueError('Installed source bytes changed after review')
            return observed
        group = checked_folder(software, definition['id'], create=True)
        destination = Path(row['install_root'])
        if destination.parent != group:
            raise ValueError('The planned installation is outside its tool directory')

        def existing():
            marker = destination / '.aimatterlab-source.json'
            if destination.resolve(strict=True) != destination or marker.is_symlink():
                raise ValueError('Installation directory changed')
            recorded = json.loads(marker.read_text())
            if recorded['source'] != source:
                raise ValueError('Installed release identity differs')
            if 'build' in definition and row.get('build', {}).get('status') != 'passed':
                return {'build_root':str(destination),'source_tree_sha256':recorded['source_tree_sha256']}
            result = file_receipt(destination / source['executable'])
            expected = row['build']['program']['sha256'] if 'build' in definition else recorded['executable_sha256']
            if not Path(result['path']).is_relative_to(destination) or result['sha256'] != expected:
                raise ValueError('Installed executable differs; configure a new version or restore the original bytes')
            return result

        if destination.exists():
            return existing()
        package = None
        if source['kind'] != 'git':
            package = self._package(row, staging, 'package', source)
            if not package:
                return None
        root = Path(tempfile.mkdtemp(prefix='.install-', dir=group))
        try:
            if source['kind'] == 'git':
                bundle = staging / 'package.release'
                try:
                    git_ops.checkout(git, source, root, bundle if bundle.is_file() else None)
                except (OSError, ValueError, subprocess.SubprocessError):
                    if bundle.is_file():
                        raise ValueError('The supplied Git bundle failed checkout for the pinned commit')
                    self._activity(row, 'cluster_download', 'failed', 'The cluster could not fetch the pinned Git commit')
                    self._activity(row, 'desktop_download', 'pending', 'Cluster Git fetch failed. Trying the pinned commit on the desktop',
                                   status='desktop_fallback', supply='package')
                    return None
                self._activity(row, 'verify', 'passed', 'Pinned Git commit checked out')
            elif source['kind'] == 'archive':
                extract_archive(package, root)
            else:
                executable = root / source['executable']
                executable.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(package, executable)
            marker = root / '.aimatterlab-source.json'
            if marker.exists() or marker.is_symlink() or marker.with_suffix('.json.tmp').is_symlink():
                raise ValueError('Release uses an application-managed filename')
            if 'build' in definition:
                metadata = {'source_tree_sha256':builder.source_tree(root)}
            else:
                executable = (root / source['executable']).resolve(strict=True)
                if not executable.is_relative_to(root) or not executable.is_file():
                    raise ValueError('Release does not contain the reviewed executable path')
                executable.chmod(0o700)
                metadata = {'executable_sha256':file_receipt(executable)['sha256']}
            atomic_json(marker, {'source':source, **metadata})
            with self.service._resource_tool_install:
                if not destination.exists():
                    root.rename(destination)
            return existing()
        finally:
            if root.exists():
                shutil.rmtree(root)

    def _test_inputs(self, row, workspace, staging, project):
        if self._review_inputs(workspace, row['manifest'], project) != row['fixtures']:
            raise ValueError('Minimal test input bytes changed since the review')
        result = {}
        inputs = checked_folder(staging, 'fixtures', create=True)
        definition = row['manifest']
        for port, source in definition['test']['inputs'].items():
            receipt = row['fixtures'][port]
            if 'path' not in source:
                path = inputs / port
                if not path.exists():
                    with path.open('xb') as output:
                        output.write(source['text'].encode())
                receipt = file_receipt(path, MAX_FIXTURE)
                if receipt['path'] != str(path) or {key:receipt[key] for key in ('size','sha256')} != row['fixtures'][port]:
                    raise ValueError('Frozen minimal test fixture changed')
            result[definition['inputs'][port]['filename']] = receipt
        return result

    @staticmethod
    def _allocated_success(run):
        exit_receipt = run.get('exit') or {}
        if (run.get('status') != 'succeeded' or not run.get('job_id') or exit_receipt.get('nonce') != run['nonce'] or
                exit_receipt.get('exit_code') != 0 or (run.get('execution_check') or {}).get('status') != 'passed'):
            raise ValueError('A successful allocated-node execution receipt is required')

    def _used_outputs(self, row, run):
        self._allocated_success(run)
        simulation = Path(run['remote_directory']) / 'simulation'
        checked_folder(simulation.parent, simulation.name)
        results, failures = {}, []
        criteria = row['manifest']['test'].get('outputs', {})
        for key,item in row['manifest']['outputs'].items():
            path = simulation / item['filename']
            try:
                observed = file_receipt(path)
                if observed['path'] != str(path):
                    raise ValueError('Output is redirected')
                rules = criteria.get(key,{})
                checks = {'min_bytes':observed['size'] >= rules.get('min_bytes',1)}
                if 'sha256' in rules:
                    checks['sha256'] = observed['sha256'] == rules['sha256']
                inspect_json = 'json_keys' in rules or item['format'].lower() in ('json','application/json')
                if 'contains' in rules or inspect_json:
                    try:
                        meta, content = stable_file_snapshot(path, include_bytes=True, max_bytes=MAX_TEST_TEXT)
                        parsed = content.decode('utf-8') if meta['sha256'] == observed['sha256'] else None
                    except (OSError, ValueError):
                        parsed = None
                    if 'contains' in rules:
                        checks['contains'] = parsed is not None and rules['contains'] in parsed
                    if inspect_json:
                        try:
                            document = json.loads(parsed)
                            checks['json'] = True
                        except (TypeError, ValueError):
                            document = None
                            checks['json'] = False
                        if 'json_keys' in rules:
                            checks['json_keys'] = isinstance(document, dict) and set(rules['json_keys']) <= document.keys()
                results[key] = {field:observed[field] for field in ('sha256','size')} | {
                    'checks':{rule:'passed' if success else 'failed' for rule,success in checks.items()}}
                failures.extend(key + '.' + rule for rule,success in checks.items() if not success)
            except (OSError, ValueError):
                failures.append(key + ' (missing or redirected)')
        if failures:
            raise TestOutputsError('Minimal test output checks failed: ' + ', '.join(failures), results)
        return results

    def _reuse(self, row, key):
        for past in self.store.list(SETUP):
            if past['id'] == row['id'] or past.get('test_key') != key or past['status'] != 'active':
                continue
            try:
                run = self.service.clusters.raw(past['test']['run_id'])
                if (run.get('bound_invocation') or {}).get('owner') != {'kind':'configuration','id':past['id']}:
                    continue
                if self._used_outputs(row, run) == past['test']['outputs']:
                    return run
            except (OSError, KeyError, ValueError):
                continue
        return None

    def _explicit_prior(self, row, argv, version, inputs):
        if not row.get('prior_run_id'):
            return None
        try:
            run = self.service.clusters.raw(row['prior_run_id'])
            target = row['target']
            profile = run['cluster_snapshot']
            assert_binding(self.service, profile)
            binding = run.get('bound_invocation') or {}
            dependencies = binding.get('version', {}).get('dependencies', [])
            expected = {**version['files'],version['executable']:version['executable_sha256']}
            observed = {item['name']:(item['sha256'],item['size']) for item in run['snapshots']}
            wanted = {name:(item['sha256'],item['size']) for name,item in inputs.items()}
            prior_version = binding.get('version', {})
            if (run['command'] == argv and binding.get('files') == expected and dependencies == version['dependencies'] and
                    prior_version.get('version') == version['version'] and prior_version.get('resolved_files') == version['resolved_files'] and
                    prior_version.get('onboarding') == version.get('onboarding') and
                    run['project_id'] == target['project_id'] and run['cluster_id'] == target['cluster_id'] and
                    run.get('queue_target_snapshot', {}).get('id') == target.get('queue_target_id') and
                    environment_hash(profile) == row['environment_sha256'] and observed == wanted):
                self._used_outputs(row, run)
                return run
        except (OSError, KeyError, ValueError, PermissionError):
            pass
        self._activity(row, 'test', 'pending', 'The previous run does not establish this source, template, environment and outputs. Preparing a minimal test')
        return None

    def _job(self, row, workspace, phase, argv, version, inputs, parameters, *, writable_roots=()):
        base = checked_folder(Path(workspace['root'])/'workfile', '.aimatterlab-tool-tests', create=True)
        setup = checked_folder(base, row['id'], create=True)
        output_root = checked_folder(setup, phase, create=True)
        target, definition = row['target'], row['manifest']
        resources = deepcopy(definition['test'].get('resources', {}))
        if target.get('queue_target_id'):
            resources['queue_target_id'] = target['queue_target_id']
        spec = {'project_id':target['project_id'], 'cluster_id':target['cluster_id'], 'engine':TEST_ENGINE,
                'max_seconds':definition[phase]['max_seconds'], 'resources':resources, 'parameters':parameters,
                'name':'Tool ' + phase + ' ' + definition['id'], 'idempotency_key':'resource-tool:' + phase + ':' + row['id']}
        owner = {'kind':'configuration-build' if phase == 'build' else 'configuration', 'id':row['id']}
        self._check_plan(row)
        return self.service.clusters.prepare_bound(spec, argv=argv, version=version, inputs=inputs,
                                                    output_root=output_root, owner=owner, writable_roots=writable_roots)

    def _prepare_build(self, row, workspace, staging, effective, source, git):
        definition = row['manifest']
        root = Path(source['build_root'])
        steps, files, resolved = [], {}, {}
        registered = effective['environment']['executables']
        for step in definition['build']['steps']:
            options = deepcopy(step)
            if step['command'] in registered:
                logical = registered[step['command']]
                receipt = file_receipt(logical)
                files[logical] = receipt['sha256']
                resolved[logical] = receipt['path']
                options['executable'] = logical
            steps.append(options)
        program = file_receipt(registered['python'])
        runner = staging/'build.py'
        supplied = file_receipt(builder.__file__)
        if runner.is_symlink():
            raise ValueError('Build runner staging path was replaced')
        if not runner.exists():
            shutil.copyfile(supplied['path'],runner)
        if file_receipt(runner)['sha256'] != supplied['sha256']:
            raise ValueError('Frozen build runner contents changed')
        recipe = {'root':str(root),'source_tree_sha256':source['source_tree_sha256'],
                  'steps':steps,'executable':definition['source']['executable']}
        payload = staging/'build.json'
        if payload.is_symlink() or payload.with_suffix('.json.tmp').is_symlink():
            raise ValueError('Build recipe staging path was replaced')
        if not payload.exists():
            atomic_json(payload,recipe)
        elif json.loads(payload.read_text(encoding='utf-8')) != recipe:
            raise ValueError('Frozen build recipe changed')
        version = { 'version':definition['version'], 'executable':registered['python'], 'executable_sha256':program['sha256'],
                    'resolved_files':{**resolved,registered['python']:program['path']},
                    'files':{**files,str(runner):supplied['sha256'],str(payload):file_receipt(payload)['sha256']} }
        run = self._job(row,workspace,'build',[registered['python'],str(runner),str(payload)],version,{}, {},writable_roots=(root,))
        updated = self._activity(row,'build','pending','Prepared the reviewed source build on the selected queue',
                                 status='testing',git=git,build=self._test_summary(run))
        self._observe_job(updated,'build')

    def _prepare(self, row):
        workspace = self._workspace(row)
        project, effective = self._check_plan(row)
        software, staging = self._staging(row)
        self._activity(row, 'git', 'pending', 'Checking resource-local Git')
        git, receipt = self._git(row, software, staging)
        if git is None:
            return
        self._activity(row, 'git', 'passed', receipt['version'] + ' (' + receipt['method'] + ')')
        executable = self._install(row, software, staging, git)
        if executable is None:
            return
        if 'build_root' in executable:
            self._prepare_build(row, workspace, staging, effective, executable, receipt)
            return
        definition = row['manifest']
        source = definition['source']
        base = Path(executable['path']).parent if source['kind'] == 'installed' else Path(row['install_root'])
        command = source['executable'] if source['kind'] == 'installed' else str(base/source['executable'])
        files = {}
        for name in definition.get('support_files', []):
            observed = file_receipt(base/name)
            if not Path(observed['path']).is_relative_to(base):
                raise ValueError('A supporting file points outside its reviewed installation')
            files[str(base/name)] = observed
        onboarding = row.get('onboarding')
        if onboarding and (executable['sha256'] != onboarding['entrypoint'] or
                           any(files[str(base/name)]['sha256'] != digest for name,digest in onboarding['support'].items())):
            raise ValueError('The entrypoint or supporting files differ from the selected tool package')
        prefix, version = _closure(command, executable, files, definition.get('interpreter'), effective, definition.get('dependencies', []))
        version['version'] = definition['version']
        if onboarding:
            version['onboarding'] = onboarding
        inputs = self._test_inputs(row, workspace, staging, project)
        parameters = definition['test'].get('parameters', {})
        argv = prefix + args_for(definition, parameters)
        key = fingerprint([row['resource_id'], row['workspace_id'], row['manifest'], row['target'], row['environment_sha256'],
                           row['allocation'], row['fixtures'], version])
        prior = self._explicit_prior(row, argv, version, inputs) or self._reuse(row, key)
        if prior:
            row = self._save(row, git=receipt, version=version, command_prefix=prefix, test_key=key)
            self._activate(row, prior, reused=True)
            return
        draft = self._job(row,workspace,'test',argv,version,inputs,parameters)
        row = self._activity(row, 'test', 'pending', 'Prepared the reviewed minimal scheduler job',
                             status='testing', git=receipt, version=version, command_prefix=prefix, test_key=key,
                             test=self._test_summary(draft))
        self._observe_job(row,'test')

    @staticmethod
    def _test_summary(run, **extras):
        return {'run_id':run['id'], 'status':run['status'], 'directory':run.get('remote_directory'),
                **({'job_id':run['job_id']} if run.get('job_id') else {}), **extras}

    def _observe_job(self, row, phase):
        clusters = self.service.clusters
        run = clusters.raw(row[phase]['run_id'])
        owner = {'kind':'configuration-build' if phase=='build' else 'configuration','id':row['id']}
        if (run.get('bound_invocation') or {}).get('owner') != owner:
            raise ValueError('The original scheduler operation does not belong to this configuration')
        if run['status'] in ('draft', 'ready') and not run.get('submit_attempted'):
            self._check_plan(row)
            if run['status'] == 'draft':
                clusters.validate(run['id'])
            try:
                run = clusters.submit(run['id'])
            except PermissionError as error:
                if str(error) != 'Project concurrency limit reached':
                    raise
                return
        if run['status'] == 'succeeded':
            if phase == 'build':
                self._allocated_success(run)
                root = Path(row['install_root'])
                filename = row['manifest']['source']['executable']
                program = file_receipt(root/filename)
                if not Path(program['path']).is_relative_to(root):
                    raise ValueError('Built program is outside its reviewed installation')
                self._activity(row,phase,'passed','Versioned source build passed on the selected resource',
                               status='acquiring',build=self._test_summary(run,status='passed',program=program))
            else:
                self._activate(row, run)
        elif run['status'] in ('failed', 'cancelled'):
            self._activity(row, phase, 'failed', 'The scheduler ' + phase + ' did not complete successfully',
                           status='failed', **{phase:self._test_summary(run)})
        else:
            self._save(row, status='unknown' if run['status'] == 'unknown' else 'testing', **{phase:self._test_summary(run)})

    def _activate(self, row, run, reused=False):
        self._check_plan(row)
        try:
            outputs = self._used_outputs(row, run)
        except TestOutputsError as error:
            self._activity(row,'test','failed',str(error),status='failed',message=str(error),
                           test=self._test_summary(run,status='failed',outputs=error.outputs))
            return
        _verify_files(row['version'])
        definition = row['manifest']
        identifier = fingerprint([row['id'], row['test_key'], run['id'], outputs])
        test = self._test_summary(run, status='passed', reused=reused, outputs=outputs)
        if row.get('onboarding'):
            test['onboarding'] = row['onboarding']
        summary = {key:row[key] for key in ('resource_id','workspace_id','target','environment_sha256')}
        metadata = {'tool':{key:definition[key] for key in ('id','name','version','source','argv','inputs','outputs',
                    'interpreter','dependencies','parameters','support_files') if key in definition},
                    'target':row['target'], 'environment_sha256':row['environment_sha256'],
                    'version':row['version'], 'git':row['git'], 'source_documents':definition.get('citations', []),
                    'test':{'fixtures':row['fixtures'], 'run_id':run['id'], 'job_id':run['job_id'], 'outputs':outputs,
                            'recipe':{key:definition['test'][key] for key in ('max_seconds','resources','parameters','outputs')
                                      if key in definition['test']}}}
        if 'build' in row:
            metadata['build'] = {'recipe':definition['build'],'receipt':row['build']}
        if row.get('onboarding'):
            metadata['onboarding'] = row['onboarding']
        software, _staging = self._staging(row)
        with self.service._resource_tool_install:
            git, receipt = git_ops.find_git(software)
            if not git or receipt != row['git']:
                raise ValueError('The Git entry point used for this configuration changed')
            catalog = git_ops.record_tool(git, software, row['id'], metadata)
        version = {**row['version'], 'activation_id':identifier, 'resource_tool_sha256':catalog['manifest_sha256']}
        skill = execution_skill(definition, row['target'], version, test, identifier)
        active = {**summary, 'id':identifier, 'engine':'private.' + definition['id'], 'manifest':definition,
                  'version':version, 'catalogue_sha256':catalog['manifest_sha256'], 'catalog':catalog,
                  'activated_at':time.time(), 'command_prefix':row['command_prefix'], 'execution_skill':skill, 'test':test}
        with self.store.lock:
            current = self.store.get(SETUP, row['id'])
            self.store.put_many([(ACTIVE,active), (SETUP,{**current,'activation_id':identifier, 'status':'active', 'stage':'active',
                'test':test, 'revision':current['revision']+1,
                'skill':{key:skill[key] for key in ('name','sha256')}|{'status':'available'},
                'activity':current['activity']+[{'stage':'test','status':'reused' if reused else 'passed',
                    'message':'Reused the matching verified test receipt' if reused else 'Minimal scheduler test and declared outputs verified'}]})])

    def _kick(self, row):
        if row['status'] not in ('acquiring', 'testing', 'unknown'):
            return
        with self.store.lock:
            if row['id'] in self.workers:
                return

            def work():
                try:
                    current = self.store.get(SETUP, row['id'])
                    if current['status'] == 'acquiring':
                        self._prepare(current)
                    elif current['status'] in ('testing', 'unknown'):
                        self._observe_job(current, 'build' if current['stage']=='build' else 'test')
                except Exception as error:
                    message = str(error)[:350] if isinstance(error, (OSError, ValueError, PermissionError)) else 'The installation or scheduler operation failed; check the setup receipt'
                    current = self.store.get(SETUP, row['id'])
                    self._activity(current, current['stage'], 'failed', message, status='failed', message=message)
                finally:
                    with self.store.lock:
                        self.workers.pop(row['id'], None)

            if len(self.workers) >= 2:
                return  # Other setups remain durably queued for the next tick.
            thread = threading.Thread(target=work, daemon=True, name='resource-tool-setup')
            self.workers[row['id']] = thread
            thread.start()

    def tick(self):
        for row in self.store.list(SETUP):
            self._kick(row)

    def status(self, data):
        fields(data, ('resource_id','setup_id'))
        row = self._row(data)
        self._kick(row)
        return self._public(row)

    def skill(self, data):
        fields(data, ('resource_id','setup_id'))
        row = self._row(data)
        if row['status'] != 'active':
            raise ValueError('A verified minimal test receipt is required')
        return self.store.get(ACTIVE, row['activation_id'])['execution_skill']

    def _supply(self, data, *, manual=False):
        row = self._row(data)
        if row['status'] not in (('needs_file',) if manual else ('needs_file','desktop_fallback')):
            raise ValueError('This configuration is not waiting for a release file')
        if 'revision' in data and row['revision'] != data['revision']:
            raise ValueError('Release request changed; refresh the tool setup')
        target = row['supply']
        source = row['manifest']['git_bootstrap' if target == 'git' else 'source']
        self._check_plan(row)
        return row, target, source

    def desktop_failed(self, data):
        fields(data, ('resource_id','setup_id'))
        with self.store.lock:
            row, target, _source = self._supply(data)
            if row['status'] == 'needs_file':
                return self._public(row)
            changed = self._activity(row, 'desktop_download', 'failed',
                'Desktop acquisition also failed. Select the pinned local file or enter its location on this resource',
                status='needs_file', supply=target)
            return self._public(changed)

    def supply_remote(self, data):
        fields(data, ('resource_id','setup_id','revision','path'))
        with self.service._resource_tool_install:
            row, target, source = self._supply(data, manual=True)
            _software, staging = self._staging(row)
            copy_release(absolute_path(data['path']), staging/(target + '.release'), source.get('sha256'))
            result = self._activity(row, 'verify', 'passed', 'Selected remote release file verified', status='acquiring', supply=None)
        self._kick(result)
        return self._public(result)

    @staticmethod
    def _transfer_path(staging, target, checksum):
        return staging/(target + '-' + checksum + '.upload')

    def transfer(self, data, operation):
        expected = ('resource_id','setup_id','sha256','size')
        fields(data, expected + (('offset','chunk','chunk_sha256') if operation == 'chunk' else ()))
        size = numeric(data['size'], 1, MAX_PACKAGE, 'release transfer size')
        checksum = match(data['sha256'], SHA256, 'A release checksum is required')
        with self.service._resource_tool_install:
            row, target, source = self._supply(data)
            if source.get('sha256') and checksum != source['sha256']:
                raise ValueError('Uploaded release checksum differs from the confirmed configuration')
            _software, staging = self._staging(row)
            partial = self._transfer_path(staging, target, checksum)
            if partial.is_symlink():
                raise ValueError('The partial transfer was replaced')
            offset = partial.stat().st_size if partial.is_file() else 0
            if offset > size:
                raise ValueError('Partial release size exceeds the advertised transfer')
            if operation == 'offset':
                return {'offset':offset}
            if operation == 'chunk':
                return self._append_chunk(row, partial, offset, size, data)
            if offset != size or file_receipt(partial, MAX_PACKAGE)['sha256'] != checksum:
                raise ValueError('Transferred release is incomplete or has a different checksum')
            partial.replace(staging/(target + '.release'))
            result = self._activity(row, 'transfer', 'passed', 'Pinned release transferred and verified',
                                    status='acquiring', supply=None)
        self._kick(result)
        return self._public(result)

    def _append_chunk(self, row, partial, offset, size, data):
        supplied = numeric(data['offset'], 0, size, 'release transfer offset')
        if not isinstance(data['chunk'], str) or len(data['chunk']) > ((CHUNK+2)//3)*4:
            raise ValueError('Release chunk exceeds its byte budget')
        block = base64.b64decode(data['chunk'], validate=True)
        if not 0 < len(block) <= CHUNK or supplied+len(block) > size or hashlib.sha256(block).hexdigest() != data['chunk_sha256']:
            raise ValueError('Interrupted or changed release chunk')
        if supplied != offset:
            if supplied < offset and supplied+len(block) <= offset:
                with partial.open('rb') as stream:
                    stream.seek(supplied)
                    if stream.read(len(block)) == block:
                        return {'offset':offset}
            raise ValueError('Release transfer offset changed; read it before retrying')
        with os.fdopen(os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600), 'ab') as stream:
            stream.write(block)
            stream.flush()
            os.fsync(stream.fileno())
        self._activity(row, 'transfer', 'pending', 'Transferring the release through the original SSH connection')
        return {'offset':offset+len(block)}


def tool_onboarding(value, definition):
    fields(value, ('package_id','package_version','manifest_sha256','source_commit','function_id',
                   'reference_test_case_id','entrypoint','support'))
    if value['package_id'] != definition['id']:
        raise ValueError('The tool package and setup IDs differ')
    for key in ('package_version','manifest_sha256','entrypoint'):
        match(value[key], SHA256, 'Expected the exact registered package and entrypoint digests')
    match(value['source_commit'], re.compile(r'[a-f0-9]{40}|[a-f0-9]{64}'), 'Expected the registered commit')
    for key in ('function_id','reference_test_case_id'):
        match(value[key], re.compile(r'(?=.{1,96}$)[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*'), 'Expected a declared function or reference case')
    source = definition['source']
    if (source['kind'] == 'git' and source['commit'] != value['source_commit'] or
        source['kind'] == 'installed' and source.get('sha256') != value['entrypoint'] or
        source['kind'] not in ('git','installed')):
        raise ValueError('Use the exact checked-out source or installed entrypoint from the selected tool package')
    if not isinstance(value['support'], dict) or set(value['support']) != set(definition.get('support_files', [])):
        raise ValueError('Pin every reviewed package support file')
    for name, digest in value['support'].items():
        relative_path(name)
        match(digest, SHA256, 'Expected the registered support file digest')
    return deepcopy(value)


def execution_skill(definition, target, version, test, activation_id):
    name = 'tool-' + definition['id'][:40] + '-' + activation_id[:12]
    description = 'Run ' + definition['id'] + ' on the resource and environment verified by its minimal scheduler test.'
    quote = chr(96)

    def code(value):
        return quote + value.replace(quote, "'") + quote

    template = ''.join('- ' + code(word) + '\n' for word in definition['argv'])
    ports = '\n'.join(direction.capitalize() + ': ' + ', '.join(
        key + ' → ' + code(item['filename']) + ' (' + item['format'] + ')' for key,item in definition[direction].items())
        for direction in ('inputs','outputs'))
    if len((template + ports).encode()) > 10500:
        template = 'Read the complete frozen argument and port definitions in the active resource tool configuration.\n'
        ports = 'Inputs: ' + ', '.join(definition['inputs']) + '\nOutputs: ' + ', '.join(definition['outputs'])
    onboarding = version.get('onboarding')
    delivery = ('Registered delivery ' + code(onboarding['package_id']+'@'+onboarding['package_version']) +
                ', source commit ' + code(onboarding['source_commit']) + ', declaration SHA-256 ' +
                code(onboarding['manifest_sha256']) + '. Function ' + code(onboarding['function_id']) +
                ' uses reference case ' + code(onboarding['reference_test_case_id']) +
                '. Below is the outcome of the reviewed target test.\n\n') if onboarding else ''
    body = ('---\nname: ' + name + '\ndescription: ' + description + '\n---\n\n'
            '# ' + definition['name'] + ' ' + definition['version'] + '\n\n'
            'Use ' + code('private.' + definition['id']) + ' in a confirmed workflow on this resource. '
            'Use the registered allocation and environment ' + code(target['environment_id']) + ' on ' + code(target['cluster_id']) + '.\n\n' +
            delivery + 'The executable entry is ' + code(version['tool_executable']) + '.\n\n## Arguments\n\n' + template +
            '\n' + ports +
            '\n\nUse ' + code('read_session_workspace') + ' to find the conversation work directory. '
            'Open the workflow run receipt for the precise scheduler job, outputs, and job logs. '
            'If a job submission is uncertain, check its original receipt before another attempt. '
            'When an executable, environment, template or output requirement changes, configure and test the new combination.\n\n'
            'Read the minimal test under job ' + code(test['job_id']) + ' and activation ' + code(activation_id) + '.\n')
    return {'name':name,'body':body,'sha256':hashlib.sha256(body.encode()).hexdigest()}
