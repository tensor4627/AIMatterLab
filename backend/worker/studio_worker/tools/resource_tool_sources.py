"""Bounded release acquisition and read-only discovery on an authenticated resource."""
import hashlib
import http.client
import ipaddress
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import socket
import stat
import tarfile
import time
from urllib.parse import urljoin, urlunsplit
import zipfile

from studio_worker.tools.resource_tool_manifest import absolute_path, file_receipt, fingerprint, public_url


MAX_PACKAGE = 1024 * 1024 * 1024
CHUNK = 1024 * 1024
MAX_EXTRACTED = 4 * MAX_PACKAGE
MAX_ARCHIVE_ENTRIES = 25000
MAX_SCAN_ENTRIES = 2500
MAX_SCRIPT = 96 * 1024
SUFFIXES = ('.sh', '.slurm', '.sbatch', '.lsf', '.pbs', '.bash', '.job', '.py')
TOOLS = re.compile(r'(?<![A-Za-z0-9_.-])(gpumd|lmp(?:_[A-Za-z0-9_-]+)?|lammps|pydyn|pygas|plumed|torchnep|nep|deepmd|dp|vasp(?:_[A-Za-z0-9_-]+)?)(?=\s|$)')
ACTIVATE = re.compile(r'^\s*(?:module\s+(?:load|add|switch)\s+([^#;]+)|(?:conda|mamba)\s+activate\s+([A-Za-z0-9_.+-]+)|source\s+([^\s;#]+/bin/activate))')


def script_class(body):
    lines = body.splitlines()
    lsf = any(line.lstrip().startswith('#BSUB ') for line in lines)
    slurm = any(line.lstrip().startswith('#SBATCH ') for line in lines)
    initialized = [line.strip() for line in lines if not line.lstrip().startswith('#')]
    modules = sorted({' '.join(part.split()) for line in initialized if (found := ACTIVATE.match(line)) for part in found.groups() if part})[:8]
    entrypoints = {match[0] for line in initialized for match in TOOLS.finditer(line)}
    if not entrypoints:
        for line in initialized:
            try:
                words = shlex.split(line, comments=True)
            except ValueError:
                continue
            if not words:
                continue
            if words[0] in ('exec', 'srun', 'mpirun', 'mpiexec', 'python', 'python3', 'bash'):
                candidate = next((word for word in words[1:] if '/' in word and not word.startswith('-')), '')
            else:
                candidate = words[0] if words[0].startswith(('/', './')) else ''
            if candidate and re.fullmatch(r'[A-Za-z0-9_.+-]{1,72}', PurePosixPath(candidate).name):
                entrypoints.add(PurePosixPath(candidate).name)
    scheduler = 'slurm' if slurm else ('lsf' if lsf else 'direct')
    return ', '.join(sorted(entrypoints)[:8]) or 'unclassified', scheduler, tuple(modules)


def discover(directory):
    root = absolute_path(directory).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Select a script directory on this SSH resource')
    candidates, count, truncated = {}, 0, False
    for current, directories, names in os.walk(root, followlinks=False):
        directories[:] = sorted(name for name in directories if not name.startswith('.') and
                                len(Path(current).relative_to(root).parts) < 4 and not (Path(current) / name).is_symlink())
        count += len(directories) + len(names)
        if count > MAX_SCAN_ENTRIES:
            truncated = True
        for name in sorted(names)[:max(0, MAX_SCAN_ENTRIES - count + len(names))]:
            path = Path(current) / name
            if name.startswith('.') or path.is_symlink() or not path.is_file() or path.suffix.lower() not in SUFFIXES:
                continue
            try:
                if path.stat().st_size > MAX_SCRIPT:
                    continue
                with path.open('rb') as stream:
                    raw = stream.read(MAX_SCRIPT + 1)
                if len(raw) > MAX_SCRIPT or b'\0' in raw:
                    continue
                body = raw.decode('utf-8')
            except (OSError, UnicodeDecodeError):
                continue
            kind = script_class(body)
            tool, scheduler, activation = kind
            if scheduler == 'direct' and tool == 'unclassified' and not body.startswith('#!'):
                continue
            if kind not in candidates:
                if len(candidates) == 64:
                    truncated = True
                    continue
                candidates[kind] = {'id': fingerprint(kind)[:24], 'path': str(path), 'tool':tool, 'scheduler':scheduler,
                                    'environment':list(activation), 'sha256':hashlib.sha256(raw).hexdigest(), 'count':0,
                                    'evidence': ([] if scheduler == 'direct' else ['#SBATCH' if scheduler == 'slurm' else '#BSUB']) +
                                                ([] if tool == 'unclassified' else ['Program invocation: ' + tool]) +
                                                (['Explicit environment activation'] if activation else []), 'examples':[]}
            group = candidates[kind]
            group['count'] += 1
            if len(group['examples']) < 8:
                group['examples'].append(str(path))
        if count > MAX_SCAN_ENTRIES:
            break
    return {'directory':str(root), 'candidates':list(candidates.values()), 'truncated':truncated}


def public_addresses(host):
    if host.lower().rstrip('.').endswith(('.localhost', '.local', '.internal')) or '.' not in host and ':' not in host:
        raise ValueError('Release source must resolve to a public network address')
    addresses = {item[4][0] for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
    if not addresses or any(not ipaddress.ip_address(addr).is_global or ipaddress.ip_address(addr).is_multicast for addr in addresses):
        raise ValueError('Release source must resolve to a public network address')
    return sorted(addresses, key=lambda address: (':' in address, address))


def download(url, final, expected, *, budget=MAX_PACKAGE, timeout=80):
    """Stream from a public HTTPS endpoint. Resolve independently at each redirect."""
    deadline = time.monotonic() + timeout
    temporary = final.with_suffix('.http-part')
    try:
        for hop in range(6):
            parsed = public_url(url, redirect=bool(hop))
            addresses = public_addresses(parsed.hostname)
            connection = http.client.HTTPSConnection(parsed.hostname, timeout=10)

            def dial(_address, *args, **kwargs):
                last = None
                for ip in addresses:
                    if time.monotonic() >= deadline:
                        break
                    try:
                        return socket.create_connection((ip, 443), *args, **kwargs)
                    except OSError as error:
                        last = error
                raise ConnectionError('No public release server address connected') from last

            connection._create_connection = dial
            try:
                route = urlunsplit(('', '', parsed.path or '/', parsed.query, ''))
                connection.request('GET', route, headers={'Accept-Encoding':'identity', 'User-Agent':'AIMatterLab release acquisition'})
                response = connection.getresponse()
                if response.status in (301, 302, 303, 307, 308) and response.getheader('Location'):
                    url = urljoin(url, response.getheader('Location'))
                    continue
                if response.status != 200:
                    raise ConnectionError('Release server returned HTTP ' + str(response.status))
                declared = response.getheader('Content-Length')
                if declared is not None and (not declared.isdecimal() or int(declared) > budget):
                    raise ValueError('Release exceeds available transfer budget')
                checksum = hashlib.sha256()
                total = 0
                with temporary.open('wb') as stream:
                    while (block := response.read1(CHUNK)):
                        total += len(block)
                        if total > budget or time.monotonic() > deadline:
                            raise TimeoutError('Release transfer exceeded its byte or time limit')
                        stream.write(block)
                        checksum.update(block)
                if total == 0 or checksum.hexdigest() != expected:
                    raise ValueError('Release checksum does not match the pinned version')
                temporary.replace(final)
                return file_receipt(final, budget)
            finally:
                connection.close()
        raise ConnectionError('Too many release redirects')
    except http.client.HTTPException as error:
        raise ConnectionError('The release server did not complete the HTTP response') from error
    finally:
        temporary.unlink(missing_ok=True)


def checked_archive_path(name):
    path = PurePosixPath(name)
    if name.startswith('/') or '\\' in name or not path.parts or len(name) > 1024 or any(
            part in ('..', '.git') or any(ord(char) < 32 or ord(char) == 127 for char in part) for part in path.parts):
        raise ValueError('Archive contains an unsafe path')
    return path


def extract_archive(source, destination):
    # Build in a fresh directory. Links are published only after all regular
    # files have been written, so no archive entry can redirect extraction.
    total, count, links = 0, 0, []

    def save(name, size, mode, open_file):
        nonlocal total, count
        path = destination / checked_archive_path(name)
        count += 1
        total += size
        if count > MAX_ARCHIVE_ENTRIES or total > MAX_EXTRACTED:
            raise ValueError('Expanded archive exceeds the tool package budget')
        if open_file is None:
            path.mkdir(parents=True, exist_ok=True)
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        with open_file() as stream, path.open('xb') as target:
            remaining = size
            while (block := stream.read(min(CHUNK, remaining + 1))):
                remaining -= len(block)
                if remaining < 0:
                    raise ValueError('Archive member exceeds its declared size')
                target.write(block)
            if remaining:
                raise ValueError('Archive member is incomplete')
        path.chmod(0o700 if mode & 0o111 else 0o600)

    def remember_link(name, target, *, same_root=False):
        # Reject absolute paths and resolve relative targets lexically with all
        # parent segments confined to the new tool directory.
        path = checked_archive_path(name)
        raw = PurePosixPath(target)
        if raw.is_absolute() or '\\' in target or not raw.parts or len(target) > 1024:
            raise ValueError('Archive contains an unsafe file link')
        parents = [] if same_root else list(path.parent.parts)
        for component in raw.parts:
            if component == '..':
                if not parents:
                    raise ValueError('Archive file link escapes the package')
                parents.pop()
            else:
                parents.append(component)
        source = destination / checked_archive_path('/'.join(parents))
        links.append((destination/path, source))
        if len(links) > MAX_ARCHIVE_ENTRIES:
            raise ValueError('Archive file count exceeds the tool package budget')

    if zipfile.is_zipfile(source):
        with zipfile.ZipFile(source) as archive:
            for item in archive.infolist():
                mode = item.external_attr >> 16
                if stat.S_ISLNK(mode):
                    if item.file_size > 1024:
                        raise ValueError('Archive contains an oversized file link')
                    remember_link(item.filename, archive.read(item).decode('utf-8'))
                else:
                    save(item.filename, item.file_size, mode,
                         None if item.is_dir() else lambda: archive.open(item))
    else:
        with tarfile.open(source, mode='r|*') as archive:
            for item in archive:
                if item.issym() or item.islnk():
                    remember_link(item.name, item.linkname, same_root=item.islnk())
                elif item.isdir() or item.isfile():
                    # Archives often include the extraction directory itself.
                    if item.isdir() and item.name.rstrip('/') == '.':
                        continue
                    save(item.name, item.size, item.mode,
                         None if item.isdir() else lambda: archive.extractfile(item))
                else:
                    raise ValueError('Archive contains a device, pipe, or other unsupported entry')
    while links:
        pending = []
        for path, target in links:
            if not target.exists():
                pending.append((path, target))
                continue
            if not target.is_file() or not target.resolve().is_relative_to(destination):
                raise ValueError('Archive link does not target a regular file in this package')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.symlink_to(os.path.relpath(target, path.parent))
        if len(pending) == len(links):
            raise ValueError('Archive contains an unresolved file link')
        links = pending


def copy_release(source, final, digest):
    observed = file_receipt(source, MAX_PACKAGE)
    if digest is not None and observed['sha256'] != digest:
        raise ValueError('Selected release checksum differs from the configuration')
    temporary = final.with_suffix('.copy-part')
    try:
        shutil.copyfile(observed['path'], temporary)
        if file_receipt(temporary, MAX_PACKAGE)['sha256'] != observed['sha256']:
            raise ValueError('Selected release changed while copying')
        temporary.replace(final)
    finally:
        temporary.unlink(missing_ok=True)
