"""Stage desktop-selected bytes in the current project's inputs."""
import base64
import binascii
import hashlib
import os
import re
import stat
from pathlib import Path

from studio_worker.infrastructure.util import leaf
from studio_worker.workspace.input_copies import BLOCK, FILE_LIMIT, _directory, _identity


def _file_size(fd):
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError('An uploaded input must be a regular single-link file')
    return info.st_size


def _verify(fd, size, checksum):
    if _file_size(fd) != size:
        raise ValueError('Uploaded input size differs')
    before = _identity(os.fstat(fd))
    digest = hashlib.sha256()
    with os.fdopen(os.dup(fd), 'rb') as stream:
        stream.seek(0)
        for block in iter(lambda: stream.read(BLOCK), b''):
            digest.update(block)
    if digest.hexdigest() != checksum or _identity(os.fstat(fd)) != before:
        raise ValueError('Uploaded input SHA-256 differs')


def upload_input(service, data):
    action = data.get('action')
    fields = {'action', 'project_id', 'name', 'size', 'sha256'}
    if action not in ('status', 'chunk', 'finish') or set(data) != (fields | {'offset', 'chunk'} if action == 'chunk' else fields):
        raise ValueError('Provide an exact input upload request')
    name, size, sha = leaf(data['name']), data['size'], data['sha256']
    if len(name) > 200 or re.search(r'[\x00-\x1f:]', name):
        raise ValueError('Invalid input basename')
    if type(size) is not int or not 0 <= size <= FILE_LIMIT or not isinstance(sha, str) or not re.fullmatch('[a-f0-9]{64}', sha):
        raise ValueError('A bounded file size and SHA-256 are required')
    project_id = leaf(data['project_id'])
    root = service.root / 'projects' / project_id / 'inputs'
    key = hashlib.sha256((name + '\0' + sha).encode('utf-8')).hexdigest()
    folder, partial = 'import-' + key, '.input-upload-' + key
    flags = os.O_NOFOLLOW | os.O_NONBLOCK
    receipt = {'project_id': project_id, 'path': str(root / folder / name), 'name': name, 'sha256': sha,
               'size': size, 'offset': size, 'status': 'passed', 'mode': 'copy'}
    asset_id = 'upload-' + project_id + '-' + key
    kind = 'structure' if name == 'POSCAR' or Path(name).suffix.lower() in {'.xyz', '.extxyz', '.cif', '.pdb', '.vasp'} else 'input'

    def registered():
        service.store.put('artifact', {**receipt, 'id': asset_id, 'kind': kind})
        return {**receipt, 'asset_id': asset_id, 'kind': kind}

    with service.store.lock, _directory(root.parent) as project_fd, _directory(root) as root_fd:
        service.store.get('project', project_id)
        try:
            final_dir = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
        except FileNotFoundError:
            final_dir = None
        if final_dir is not None:
            try:
                try:
                    saved = os.open(name, os.O_RDONLY | flags, dir_fd=final_dir)
                except FileNotFoundError:
                    saved = None
                if saved is not None:
                    try:
                        _verify(saved, size, sha)
                        return registered()
                    finally:
                        os.close(saved)
            finally:
                os.close(final_dir)

        if action == 'chunk':
            offset, encoded = data['offset'], data['chunk']
            if type(offset) is not int or not 0 <= offset < size or not isinstance(encoded, str) or len(encoded) > 4 * ((BLOCK + 2) // 3):
                raise ValueError('Invalid input upload chunk')
            try:
                block = base64.b64decode(encoded, validate=True)
            except binascii.Error as error:
                raise ValueError('Invalid input upload bytes') from error
            if not 0 < len(block) <= min(BLOCK, size - offset):
                raise ValueError('Invalid input upload chunk size')

        try:
            fd = os.open(partial, os.O_RDWR | flags | (os.O_CREAT if action == 'chunk' or size == 0 and action == 'finish' else 0), 0o600, dir_fd=project_fd)
        except FileNotFoundError:
            if action == 'status':
                return {'offset': 0}
            raise ValueError('The input upload has no staged bytes') from None
        try:
            current = _file_size(fd)
            if current > size:
                raise ValueError('Staged input exceeds its declared size')
            if action == 'status':
                return {'offset': current}
            if action == 'chunk':
                end = offset + len(block)
                if offset < current and end <= current and os.pread(fd, len(block), offset) == block:
                    return {'offset': end}
                if offset != current:
                    raise ValueError('Input upload offset changed. Read the current offset and retry.')
                while offset < end:
                    count = os.pwrite(fd, block[offset - data['offset']:], offset)
                    if count <= 0:
                        raise OSError('Incomplete input upload write')
                    offset += count
                return {'offset': end}

            try:
                _verify(fd, size, sha)
            except ValueError:
                if current == size:
                    os.unlink(partial, dir_fd=project_fd)
                raise
            os.fsync(fd)
            if not os.path.samestat(os.fstat(root_fd), root.stat()) or root.resolve() != root:
                raise ValueError('Project inputs changed during upload')
            if not os.path.samestat(os.fstat(fd), os.stat(partial, dir_fd=project_fd, follow_symlinks=False)):
                raise ValueError('Staged input changed before publication')
            try:
                os.mkdir(folder, 0o700, dir_fd=root_fd)
            except FileExistsError:
                pass
            destination = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
            try:
                os.link(partial, name, src_dir_fd=project_fd, dst_dir_fd=destination, follow_symlinks=False)
                os.unlink(partial, dir_fd=project_fd)
            finally:
                os.close(destination)
            return registered()
        finally:
            os.close(fd)
