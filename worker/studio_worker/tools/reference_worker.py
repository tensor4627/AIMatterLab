"""Shared fixed CPU engineering reference facts and independent actual-run evidence."""
import json
from pathlib import Path

from .package_contract import encoded, read_bytes, sha
from ..runtime_guides import fingerprint

SCOPE = 'CPU worker child-process engineering reference only; no general installer or scientific validation'
REFERENCE_CRITERIA = {
    'scope': SCOPE,
    'run': {'engine': 'installation.check', 'parameters': {'installation_case': 'worker'}, 'status': 'succeeded', 'validation_status': 'passed', 'snapshot_hashes_unchanged': True},
    'output': {'name': 'smoke-result.json', 'run_path': 'results/smoke-result.json', 'format': 'json', 'required_fields': {'status': 'passed', 'case': 'worker', 'scope': 'infrastructure only'}, 'pid': 'Positive integer equal to child.json pid'},
    'supervisor': {'run_path': 'exit.json', 'exit_code': 0, 'cancelled': False, 'reason': None, 'must_equal_persisted_run_exit': True},
    'child': {'run_path': 'child.json', 'pid': 'Actual child process identity; must match output pid'},
    'console': {'run_path': 'console.log', 'required_line': 'STUDIO_WORKER_SMOKE_OK'},
}


def run_reason(run):
    """Explain a non-passing observation from durable run facts, never caller claims."""
    status = run['status']; exit_value = run.get('exit') or {}
    for label, value in (('Run error', run.get('error')), ('Supervisor reason', exit_value.get('reason')), ('Cancellation reason', run.get('cancel_reason'))):
        if isinstance(value, str) and value: return (label + ': ' + value)[:2000]
    validation = run.get('validation') or {}
    if validation.get('status') != 'passed' and isinstance(validation.get('message'), str) and validation['message']:
        return ('Validation ' + str(validation.get('status', 'unconfirmed')) + ': ' + validation['message'])[:2000]
    if status == 'cancelled':
        return 'Supervisor receipt records cancellation' if exit_value.get('cancelled') is True else 'Persisted run status is cancelled; no supervisor reason is recorded'
    if status == 'failed':
        return 'Supervisor exit code: ' + str(exit_value['exit_code']) if type(exit_value.get('exit_code')) is int else 'Persisted run status is failed; no additional error is recorded'
    if status == 'unknown': return 'Persisted run status is unknown; no terminal result has been confirmed'
    if status in ('draft', 'ready', 'validating'): return 'Persisted run remains ' + status + '; execution has not been confirmed'
    return None


def reference_evidence(service, expected, test):
    """Verify a caller-inaccessible Store binding and actual immutable process receipts."""
    run = service.store.run(test['run_id']); criteria = REFERENCE_CRITERIA
    if run['request_hash'] != test['request_hash'] or run['project_id'] != expected['target']['project_id'] or run['environment_id'] != expected['target']['environment_id'] or fingerprint(run['environment_snapshot']) != expected['environment_sha256'] or run['engine'] != criteria['run']['engine'] or run['parameters'] != criteria['run']['parameters']: raise ValueError('Bound test run identity changed')
    if run['status'] != criteria['run']['status']: return {'status': run['status'], 'run_id': run['id'], 'reason': run_reason(run)}
    service.verify_snapshot(run)
    root = Path(run['directory'])
    output = json.loads(read_bytes(root, criteria['output']['run_path'], 65536))
    exit_value = json.loads(read_bytes(root, criteria['supervisor']['run_path'], 65536))
    child = json.loads(read_bytes(root, criteria['child']['run_path'], 65536))
    if exit_value != run.get('exit') or any(exit_value.get(key) != criteria['supervisor'][key] for key in ('exit_code', 'cancelled', 'reason')) or exit_value.get('cancelled') is not False: raise ValueError('Actual supervisor exit required')
    if any(output.get(key) != value for key, value in criteria['output']['required_fields'].items()) or type(output.get('pid')) is not int or output['pid'] <= 0 or output['pid'] != child.get('pid'): raise ValueError('Reference output failed the fixed independent criteria')
    if criteria['console']['required_line'] not in read_bytes(root, criteria['console']['run_path'], 65536).decode('utf-8').splitlines(): raise ValueError('Reference completion marker unavailable')
    if run.get('validation', {}).get('status') != criteria['run']['validation_status']: raise ValueError('Test validation receipt unavailable')
    return {'status': 'passed', 'run_id': run['id'], 'reason': None, 'output_sha256': sha(encoded(output)), 'exit_sha256': sha(encoded(exit_value)), 'child_sha256': sha(encoded(child))}
