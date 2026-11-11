"""Server-owned SSH login-host identity and reviewed same-host scheduler transport."""
import copy
import os
from pathlib import Path
import socket
import json


def identity(root):
    machine = Path('/etc/machine-id').read_text().strip()
    hostname = socket.gethostname()
    if not machine or len(machine) > 256 or not hostname or len(hostname) > 255:
        raise ValueError('SSH service host identity unavailable')
    return {'root': str(Path(root).resolve()), 'hostname': hostname, 'uid': os.getuid(), 'machineId': machine}


def active(service):
    return getattr(service, 'ssh_service_mode', False) is True


def mode_for_root(root):
    if os.environ.get('STUDIO_SSH_SERVICE_ROOT') != str(root):
        return False
    marker = Path(root) / 'ssh-service.json'
    if marker.is_symlink() or not marker.is_file() or marker.stat().st_uid != os.getuid():
        raise ValueError('SSH service namespace receipt unavailable')
    value = json.loads(marker.read_text())
    if (not isinstance(value, dict) or set(value) != {'schema_version', 'profile_id', 'role'} or
            value['schema_version'] != 1 or value['role'] != 'ssh-login-service'):
        raise ValueError('SSH service namespace receipt unavailable')
    return True


def require_local_execution(service):
    if active(service):
        raise PermissionError('SSH login service cannot execute local calculations; use a reviewed Slurm/LSF allocation')


def scheduler_profile(service, data):
    import pwd
    if not active(service):
        raise PermissionError('Same-host scheduler requires the selected SSH service')
    allowed = {'id', 'version', 'name', 'scheduler', 'queue', 'environment', 'limits', 'remote_root',
               'read_roots', 'activation', 'lsf_memory_scope', 'queue_targets', 'notes'}
    required = {'name', 'scheduler', 'environment', 'limits', 'remote_root', 'read_roots'}
    if not isinstance(data, dict) or set(data) - allowed or not required <= data.keys():
        raise ValueError('Explicit reviewed scheduler/environment/resource policy required')
    if not isinstance(data['limits'], dict) or set(data['limits']) != {'cpus', 'gpus', 'memory_mb'}:
        raise ValueError('Explicit resource limits required')
    value = copy.deepcopy(data)
    value.update(transport_kind='ssh-service-local', service_binding=identity(service.root),
                 host='localhost', username=pwd.getpwuid(os.getuid()).pw_name, port=22,
                 ssh_client='/bin/false', auth_mode='key', proxy_jump=[], via=[], identity_file='')
    return service.clusters.register(value)


def assert_binding(service, profile):
    if not active(service) or profile.get('service_binding') != identity(service.root):
        raise PermissionError('Restore the original SSH service host and data root; transport substitution is forbidden')


class SameHostTransport:
    def __init__(self, service, profile):
        assert_binding(service, profile)
        self.service, self.profile = service, copy.deepcopy(profile)

    def run(self, script, data=None, timeout=40):
        from studio_worker.compute.ssh_auth import bounded_run
        assert_binding(self.service, self.profile)
        # This runs only existing Clusters-generated, quoted control scripts.
        # The scheduler still owns execution; no ssh-to-self or new login occurs.
        result = bounded_run(['/bin/bash', '-lc', script], input=data, timeout=timeout, limit=4 * 1024 * 1024)
        assert_binding(self.service, self.profile)
        if result.returncode:
            raise ConnectionError('Same-host scheduler operation unconfirmed; reconcile existing state')
        return result.stdout.decode('utf8', 'replace')

    def original_key_identity(self):
        import pwd
        assert_binding(self.service, self.profile)
        return pwd.getpwuid(os.getuid()).pw_name
