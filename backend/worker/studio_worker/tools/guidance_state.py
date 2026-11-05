"""Administrative persisted guidance identity, without runtime or file inspection."""
import copy
import hashlib
import json

from studio_worker.tools.archive_guard import archived_resources

SCOPE = 'Persisted activation metadata only; no current-environment validation, skill body or file inspection'


def guidance_state(service, data):
    if type(data) is not dict or data:
        raise ValueError('Guidance state requires an exact empty request')
    with service.store.lock:
        activations = sorted(service.store.list('tool-activation'), key=lambda item: item['configuration_id'])
        configurations = {item['id']: item for item in service.store.list('tool-configuration')}
        packages = {(item['package_id'], item['package_version']): item for item in service.store.list('tool-package-version')}
        aliases = {item['id']: item for item in service.store.list('tool-package-alias')}
        metadata = []
        for activation in activations:
            record = configurations.get(activation['configuration_id'])
            if record is None:
                raise ValueError('Persisted activation configuration is unavailable; retain archive restrictions')
            package = packages.get((record['package_id'], record['package_version']))
            if package is None:
                raise ValueError('Persisted activation package is unavailable; retain archive restrictions')
            if any(item.get('schema_version') != 1 for item in (activation, record, package)):
                raise ValueError('Unsupported persisted guidance schema; retain archive restrictions')
            alias = aliases.get(package['id'], {'roots': [], 'revision': 0})
            skill = service.store.get('tool-execution-skill', activation['execution_skill_id'])
            if skill.get('configuration_id') != record['id'] or skill.get('id') != activation['execution_skill_id']:
                raise ValueError('Persisted activation skill identity differs; retain archive restrictions')
            metadata.append({
                'configuration_id': record['id'], 'revision': record['revision'],
                'status': record['status'], 'has_activation': True,
                'package_id': record['package_id'], 'package_version': record['package_version'],
                'source_commit': package['source_commit'], 'manifest_sha256': record['manifest_sha256'],
                'target': copy.deepcopy(record['target']), 'environment_sha256': record['environment_sha256'],
                'archive_revision': alias.get('revision', 0), 'snapshot_root': package['snapshot_root'],
                'origin_roots': sorted(set(alias['roots']) - {package['snapshot_root']}),
                'functions': [{'id': item['id'], 'engine': item['engine']} for item in package['manifest']['functions']],
                'execution_skill': {'id': skill['id'], 'sha256': skill['sha256']},
            })
        resources = sorted(archived_resources(service), key=lambda item: (item['path'], item['role'], item['configuration_id']))
        value = {'schema_version': 1, 'configurations': metadata, 'archived_resources': resources, 'scope': SCOPE}
        identity = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('utf-8')
        return {**value, 'revision': hashlib.sha256(identity).hexdigest()}
