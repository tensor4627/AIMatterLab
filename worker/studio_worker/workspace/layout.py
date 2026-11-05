"""No-follow worker-generated directories and reconstructible metadata mirrors."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import secrets
import stat


def parts(relative):
    if type(relative) is not str or not relative or Path(relative).is_absolute() or '\\' in relative or any(part in ('', '.', '..') for part in relative.split('/')):
        raise ValueError('Owned relative workflow path required')
    return relative.split('/')


@contextmanager
def opened_directory(root, relative):
    root = Path(root)
    if os.name != 'posix' or not root.is_absolute(): raise ValueError('POSIX owned workflow directories required')
    names = [*root.parts[1:], *parts(relative)]; flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    handles = []; chain = []
    try:
        parent = os.open('/', flags); handles.append(parent)
        for index, name in enumerate(names):
            if index >= len(root.parts) - 1:
                try: os.mkdir(name, 0o700, dir_fd=parent)
                except FileExistsError: pass
            fd = os.open(name, flags, dir_fd=parent); handles.append(fd)
            identity = os.fstat(fd)
            if not stat.S_ISDIR(identity.st_mode): raise ValueError('Regular workflow directory required')
            chain.append((parent, name, identity.st_dev, identity.st_ino)); parent = fd
        yield parent
        for parent, name, device, inode in chain:
            current = os.stat(name, dir_fd=parent, follow_symlinks=False)
            if not stat.S_ISDIR(current.st_mode) or (current.st_dev, current.st_ino) != (device, inode): raise ValueError('Workflow directory was replaced or linked')
    finally:
        for fd in reversed(handles): os.close(fd)


def directory(root, relative):
    with opened_directory(root, relative): pass
    return Path(root) / relative


def new_run_directory(root, relative, run_id):
    if len(parts(run_id)) != 1: raise ValueError('Worker-generated run identity required')
    with opened_directory(root, relative) as parent: os.mkdir(run_id, 0o700, dir_fd=parent)
    return Path(root) / relative / run_id


def mirror(root, relative, value):
    names = parts(relative); filename = names[-1]
    with opened_directory(root, '/'.join(names[:-1])) as parent:
        temporary = '.workflow-mirror-' + secrets.token_hex(12)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        try:
            contents = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')
            offset = 0
            while offset < len(contents):
                count = os.write(fd, contents[offset:])
                if count <= 0: raise OSError('Incomplete workflow mirror write')
                offset += count
            os.fsync(fd)
            os.replace(temporary, filename, src_dir_fd=parent, dst_dir_fd=parent)
        finally:
            os.close(fd)
            try: os.unlink(temporary, dir_fd=parent)
            except FileNotFoundError: pass
