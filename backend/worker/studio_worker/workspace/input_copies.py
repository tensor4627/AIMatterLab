"""Copy an explicit set of files on the selected worker into one project input directory."""
import contextlib
import errno
import hashlib
import json
import os
import stat
import tempfile
from pathlib import Path

from studio_worker.infrastructure.util import leaf
from studio_worker.tools.archive_guard import assert_guidance_read, guard_path_before_resolve
from studio_worker.workspace.private_lineage import current_rows, versions_for

FILE_LIMIT = 512 * 1024 * 1024
SET_LIMIT = 1024 * 1024 * 1024
BLOCK = 1024 * 1024
PRIVATE_PARTS = {'.ssh', '.aws', '.azure', '.gnupg', '.kube', '.codex', '.git', 'custom-cv-library'}


def _check_source(service, path):
    parts = {part.casefold() for part in path.parts}
    name = path.name.casefold()
    if (parts & PRIVATE_PARTS or name.split('.')[0] in {'credentials', 'secrets', 'tokens'}
            or name == '.env' or name.startswith('.env.') or name.startswith(('id_rsa', 'id_ed25519', 'id_ecdsa'))
            or name.endswith(('.pem', '.key')) or name == 'materials-project.bin'
            or path.is_relative_to(service.root) or path.parts[1:2] in [('proc',), ('sys',), ('dev',), ('etc',)]):
        raise PermissionError('Select a data file outside account settings and managed worker state')
    assert_guidance_read(service, path)


@contextlib.contextmanager
def _directory(path):
    """Pin each real directory before accessing its child."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    fd = os.open(path.anchor, flags)
    try:
        for part in path.parts[1:]:
            child = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = child
        yield fd
    finally:
        os.close(fd)


def _identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def _guard_private_sources(service, paths):
    registered = {Path(path).resolve() for binding in current_rows(service) for path in binding.get('paths', [])}
    if registered.intersection(paths) or versions_for(service, paths):
        raise PermissionError('Use the sharing flow for a private workflow input')


def _transfer(path, budget, output=None):
    with _directory(path.parent) as parent:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as source:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_size > budget:
                raise ValueError('Select a regular file within the input copy size limit')
            checksum, size = hashlib.sha256(), 0
            while block := source.read(BLOCK):
                size += len(block)
                if size > budget:
                    raise ValueError('Input grew beyond the copy size limit')
                checksum.update(block)
                if output is not None:
                    output.write(block)
            if (size != before.st_size or _identity(os.fstat(fd)) != _identity(before)
                    or _identity(os.stat(path.name, dir_fd=parent, follow_symlinks=False)) != _identity(before)):
                raise ValueError('Input changed while copying')
            return size, checksum.hexdigest(), _identity(before)


def copy_inputs(service, data):
    if not isinstance(data, dict) or set(data) != {'project_id', 'sources'}:
        raise ValueError('Provide a project and an explicit list of source files')
    sources = data['sources']
    if not isinstance(sources, list) or not 1 <= len(sources) <= 64:
        raise ValueError('Select between one and 64 input files')
    project = service.store.get('project', leaf(data['project_id']))
    root = service.root / 'projects' / project['id'] / 'inputs'
    if root.resolve(strict=True) != root:
        raise ValueError('The destination must be the current real project input directory')
    requested = []
    for value in sources:
        if (not isinstance(value, str) or not value.startswith(('/', '~/')) or len(value) > 4096
                or any(ord(c) < 32 for c in value) or '\\' in value or str(Path(value)) != value
                or value.startswith('//') or '..' in Path(value).parts):
            raise ValueError('Select explicit absolute files on the current compute resource')
        path = Path(value).expanduser()
        _check_source(service, path)
        guard_path_before_resolve(service, path)
        resolved = path.resolve(strict=True)
        _check_source(service, resolved)
        requested.append((path, resolved))
    resolved_paths = {resolved for _, resolved in requested}
    _guard_private_sources(service, resolved_paths)
    if len({path for path, _ in requested}) != len(sources):
        raise ValueError('Each input source may appear only once')
    base = Path(os.path.commonpath([str(p.parent) for p, _ in requested]))
    with _directory(root.parent) as project_fd, _directory(root) as root_fd:
        # Keep incomplete files outside the published input tree, on the project filesystem.
        pinned = Path('/proc/self/fd') / str(project_fd)
        with tempfile.TemporaryDirectory(prefix='.copy-', dir=pinned) as temporary:
            stage = Path(temporary)
            rows, observed, total = [], [], 0
            for original, (source, resolved) in zip(sources, requested):
                name = service.input_name(source.relative_to(base).as_posix())
                output = stage / name
                output.parent.mkdir(parents=True, exist_ok=True)
                with output.open('xb') as stream:
                    size, sha, identity = _transfer(resolved, min(FILE_LIMIT, SET_LIMIT - total), stream)
                total += size
                observed.append((source, resolved, identity))
                rows.append({'source': original, 'name': name, 'size': size, 'sha256': sha})
            manifest = sorted((r['name'], r['size'], r['sha256']) for r in rows)
            key = hashlib.sha256(json.dumps(manifest, ensure_ascii=False).encode()).hexdigest()
            folder = 'import-' + key
            with service.store.lock:
                _guard_private_sources(service, resolved_paths)
                for source, resolved, identity in observed:
                    if source.resolve(strict=True) != resolved or _identity(resolved.stat()) != identity:
                        raise ValueError('A source changed before the input set was published')
                if not os.path.samestat(os.fstat(root_fd), root.stat()) or root.resolve(strict=True) != root:
                    raise ValueError('The project input directory changed during the copy')
                try:
                    os.stat(folder, dir_fd=root_fd, follow_symlinks=False)
                except FileNotFoundError:
                    try:
                        os.rename(stage.name, folder, src_dir_fd=project_fd, dst_dir_fd=root_fd)
                    except OSError as error:
                        if error.errno not in (errno.EEXIST, errno.ENOTEMPTY):
                            raise
                # An edited existing copy is never replaced. Verify every returned file.
                for row in rows:
                    target = root / folder / row['name']
                    size, sha, _ = _transfer(target, row['size'])
                    if size != row['size'] or sha != row['sha256']:
                        raise ValueError('An existing workspace copy differs; its contents were preserved')
                    row.update(path=str(target), status='passed', mode='copy')
            return {'project_id': project['id'], 'directory': str(root / folder), 'files': rows}
