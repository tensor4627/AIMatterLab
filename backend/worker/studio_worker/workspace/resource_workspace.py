"""Desktop-confirmed root and durable, same-resource conversation directories."""
from datetime import date
from hashlib import sha256
from itertools import count
import json
import os
from pathlib import Path
import pwd
import re
import stat
import time
from uuid import uuid4

from studio_worker.compute.ssh_service import active, identity
from studio_worker.infrastructure.store import encoded


WORKSPACE = 'resource-workspace'
SESSIONS = 'resource-workspace-session'
CLAIM = '.aimatterlab-claim'
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _digest(*values):
    return sha256(json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def _text(value, limit):
    return isinstance(value, str) and 0 < len(value) <= limit and not re.search(r'[\x00-\x1f\x7f]', value)


def _hash(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value) is not None


def _data(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields.split()):
        raise ValueError('Invalid resource workspace request')
    return value


def _actual_resource(service):
    if not active(service):
        raise PermissionError('An authenticated SSH job service is required')
    host = identity(service.root)
    host_identity = {key: host[key] for key in ('hostname', 'uid', 'machineId')}
    account = pwd.getpwuid(host_identity['uid']).pw_name
    marker = service.root / 'ssh-service.json'
    if marker.is_symlink() or not marker.is_file() or marker.stat().st_uid != os.getuid():
        raise PermissionError('SSH service profile receipt unavailable')
    profile_id = json.loads(marker.read_text()).get('profile_id')
    if not _text(profile_id, 200):
        raise PermissionError('SSH service profile receipt unavailable')
    return _digest(profile_id, host['hostname'], host['uid'], host['machineId'], account), profile_id, account, host_identity


def _check_directory(path, writable=False):
    if not path.is_absolute() or path.resolve(strict=True) != path or not path.is_dir():
        raise ValueError(f'Resource workspace path changed: {path}')
    if not os.access(path, os.X_OK | (os.W_OK if writable else 0)):
        raise PermissionError(f'Resource workspace path is not writable: {path}')
    return path


def _layout(service, root):
    if not _text(root, 4096) or not root.startswith('/') or root.startswith('//') or root == '/' or str(Path(root)) != root:
        raise ValueError('A canonical absolute resource workspace path is required')
    directory = _check_directory(Path(root))
    for name in ('workfile', 'software'):
        child = directory / name
        # The root may be the user's home. Its content directories cannot
        # contain the service itself or live alongside its private runtime.
        if child == service.root or child in service.root.parents:
            raise PermissionError('Resource files and the job service must have separate directories')
        if service.root in child.parents and not child.is_relative_to(service.root / 'projects'):
            raise PermissionError('Resource files and the job service must have separate directories')
        _check_directory(child, writable=True)
    return directory


def register(service, data):
    _data(data, 'resource_id workspace_id profile_id root account host_identity')
    resource_id, profile_id, account, host = _actual_resource(service)
    if (data['resource_id'], data['profile_id'], data['account'], data['host_identity']) != (resource_id, profile_id, account, host):
        raise PermissionError('Resource workspace does not belong to the authenticated account')
    root = _layout(service, data['root'])
    workspace_id = _digest(resource_id, str(root))
    if data['workspace_id'] != workspace_id:
        raise PermissionError('Resource workspace identity changed')
    return service.store.put(WORKSPACE, {'id': workspace_id, **data})


def verified_workspace(service, resource_id, workspace_id):
    """Return only a registration owned by the current service and login account."""
    if not _hash(resource_id) or not _hash(workspace_id):
        raise ValueError('Invalid resource workspace identity')
    actual, profile, account, host = _actual_resource(service)
    if actual != resource_id:
        raise PermissionError('Resource workspace does not belong to the authenticated account')
    value = service.store.get(WORKSPACE, workspace_id)
    if (value['resource_id'], value['profile_id'], value['account'], value['host_identity']) != (resource_id, profile, account, host) or value['workspace_id'] != workspace_id:
        raise PermissionError('Resource workspace registration changed')
    _layout(service, value['root'])
    return value


def _session_id(resource_id, provider, thread_id):
    if provider not in ('codex', 'kimi', 'qwen', 'deepseek', 'compatible') or not _text(thread_id, 512):
        raise ValueError('Select the original conversation')
    if not _hash(resource_id):
        raise ValueError('Invalid resource identity')
    return _digest(resource_id, provider, thread_id)


def _date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('A local calendar date is required')
    return date.fromisoformat(value).isoformat()


def _stored(store, session_id):
    row = store.db.execute('SELECT data FROM objects WHERE kind=? AND id=?', (SESSIONS, session_id)).fetchone()
    return json.loads(row[0]) if row else None


def _put(store, value):
    store.db.execute('INSERT OR REPLACE INTO objects VALUES(?,?,?)', (SESSIONS, value['id'], encoded(value)))


def _claim_token(day_fd, name):
    try:
        folder = os.open(name, DIR_FLAGS, dir_fd=day_fd)
    except OSError:
        return None
    try:
        fd = os.open(CLAIM, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folder)
        with os.fdopen(fd, 'rb') as marker:
            info = os.fstat(marker.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size != 32 or info.st_uid != os.getuid():
                return None
            return marker.read(33).decode('ascii')
    except (OSError, UnicodeError):
        return None
    finally:
        os.close(folder)


def _day_fd(root, day, create=False):
    workfile = os.open(root / 'workfile', DIR_FLAGS)
    try:
        if create:
            try:
                os.mkdir(day, dir_fd=workfile)
            except FileExistsError:
                pass
        return os.open(day, DIR_FLAGS, dir_fd=workfile)
    finally:
        os.close(workfile)


def _claim_directory(root, claim):
    day_fd = _day_fd(root, claim['date'], create=True)
    try:
        entries = os.listdir(day_fd)
        for name in entries:
            match = re.fullmatch(r'task-([1-9][0-9]{0,12})', name)
            if match and _claim_token(day_fd, name) == claim['token']:
                return int(match[1])
        for number in count(1):
            name = f'task-{number}'
            try:
                os.mkdir(name, dir_fd=day_fd)
            except FileExistsError:
                continue
            folder = os.open(name, DIR_FLAGS, dir_fd=day_fd)
            try:
                fd = os.open(CLAIM, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=folder)
                with os.fdopen(fd, 'w', encoding='ascii') as marker:
                    marker.write(claim['token'])
                    marker.flush()
                    os.fsync(marker.fileno())
            finally:
                os.close(folder)
            return number
    finally:
        os.close(day_fd)


def _verified_path(workspace, claim):
    number = claim.get('task_number')
    if type(number) is not int or number < 1:
        raise ValueError('Conversation workspace has no confirmed work directory')
    root, day = Path(workspace['root']), _date(claim['date'])
    name = f'task-{number}'
    day_fd = _day_fd(root, day)
    try:
        if _claim_token(day_fd, name) != claim['token']:
            raise PermissionError('The recorded conversation workspace was moved or replaced')
    finally:
        os.close(day_fd)
    return _check_directory(root / 'workfile' / day / name, writable=True)


def _receipt(workspace, claim, path):
    return {**{key: claim[key] for key in ('resource_id', 'workspace_id', 'provider', 'thread_id', 'date', 'task_number')},
            'root': workspace['root'], 'path': str(path), 'checked_at': int(time.time() * 1000)}


def session(service, data, *, allocate=False):
    fields = 'resource_id provider thread_id'
    _data(data, fields + (' workspace_id date' if allocate else ''))
    session_id = _session_id(data['resource_id'], data['provider'], data['thread_id'])
    if not allocate:
        with service.store.database_access():
            claim = _stored(service.store, session_id)
        if not claim or not claim.get('task_number'):
            return None
        workspace = verified_workspace(service, claim['resource_id'], claim['workspace_id'])
        return _receipt(workspace, claim, _verified_path(workspace, claim))

    store = service.store
    # Commit the claim identity and first local date before the filesystem
    # side effect. A lost response or worker restart therefore retains them.
    with store.database_access(), store.db:
        store.db.execute('BEGIN IMMEDIATE')
        claim = _stored(store, session_id)
        if claim is None:
            workspace = verified_workspace(service, data['resource_id'], data['workspace_id'])
            claim = {**data, 'date': _date(data['date']), 'id': session_id, 'token': uuid4().hex}
            _put(store, claim)
    with store.database_access(), store.db:
        store.db.execute('BEGIN IMMEDIATE')
        claim = _stored(store, session_id)
        workspace = verified_workspace(service, claim['resource_id'], claim['workspace_id'])
        if not claim.get('task_number'):
            claim['task_number'] = _claim_directory(Path(workspace['root']), claim)
            _put(store, claim)
        path = _verified_path(workspace, claim)
        return _receipt(workspace, claim, path)


def verified_session_directory(service, receipt, *, provider, thread_id):
    """Resolve a frozen execution receipt independently of the current default root."""
    _data(receipt, 'resource_id workspace_id provider thread_id root path date task_number checked_at')
    if (receipt['provider'], receipt['thread_id']) != (provider, thread_id):
        raise PermissionError('The work directory belongs to another conversation')
    expected = session(service, {'resource_id': receipt['resource_id'], 'provider': provider, 'thread_id': thread_id})
    if not expected or any(receipt[key] != expected[key] for key in expected if key != 'checked_at'):
        raise PermissionError('The confirmed conversation workspace changed')
    return Path(expected['path'])
