"""Run a frozen source build in the selected scheduler allocation."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


MAX_ENTRIES = 25000
MAX_BYTES = 4 * 1024 * 1024 * 1024


def source_tree(root):
    marker = '.aimatterlab-source.json'
    files = []
    size = 0
    for current, dirs, entries in os.walk(root, followlinks=False):
        current = Path(current)
        for name in dirs:
            path=current/name
            if name == '.git' or not path.is_symlink():
                continue
            if not path.resolve(strict=True).is_relative_to(root):
                raise ValueError('Source directory link leaves the reviewed tree')
            files.append((path.relative_to(root).as_posix(),'directory-link',os.readlink(path)))
        dirs[:] = sorted(name for name in dirs if name != '.git' and not (current/name).is_symlink())
        for name in sorted(entries):
            path = current / name
            if path == root / marker:
                continue
            relative = path.relative_to(root).as_posix()
            if path.is_symlink() and not path.resolve(strict=True).is_relative_to(root):
                raise ValueError('Source file link leaves the reviewed tree: ' + relative)
            if not path.is_file() or len(files) >= MAX_ENTRIES:
                raise ValueError('Source tree has too many files or a non-file entry')
            before = path.stat()
            checksum = hashlib.sha256()
            with path.open('rb') as stream:
                while (block := stream.read(1024 * 1024)):
                    size += len(block)
                    if size > MAX_BYTES:
                        raise ValueError('Reviewed source tree exceeds the byte budget')
                    checksum.update(block)
            after = path.stat()
            if (before.st_size,before.st_mtime_ns,before.st_ino,before.st_ctime_ns) != (after.st_size,after.st_mtime_ns,after.st_ino,after.st_ctime_ns):
                raise ValueError('Source tree changed while being verified')
            files.append((relative,checksum.hexdigest(), os.readlink(path) if path.is_symlink() else bool(before.st_mode & 0o111)))
    return hashlib.sha256(json.dumps(sorted(files), separators=(',', ':')).encode()).hexdigest()


def build(recipe):
    root = Path(recipe['root'])
    if root.resolve(strict=True) != root or source_tree(root) != recipe['source_tree_sha256']:
        raise ValueError('The reviewed source tree changed before the build')
    for step in recipe['steps']:
        directory = (root / step.get('cwd','')).resolve(strict=True)
        if not directory.is_dir() or not directory.is_relative_to(root):
            raise ValueError('Build directory is outside the installed source')
        executable = step.get('executable') or shutil.which(step['command'])
        if not executable:
            raise ValueError('Missing build command in the allocated environment: ' + step['command'])
        print('Build: ' + step['command'] + ' in ' + str(directory), flush=True)
        subprocess.run([executable, *step['args']], cwd=directory, check=True, stdin=subprocess.DEVNULL)
    executable = (root / recipe['executable']).resolve(strict=True)
    if not executable.is_relative_to(root) or not executable.is_file():
        raise ValueError('Successful build did not create the reviewed executable')


if __name__ == '__main__':
    build(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')))
