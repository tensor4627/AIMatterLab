"""Resource-local Git for source acquisition and private tool metadata."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

from studio_worker.infrastructure.util import atomic_json
from studio_worker.tools.resource_tool_manifest import file_receipt, public_url
from studio_worker.tools.resource_tool_sources import MAX_PACKAGE, extract_archive, public_addresses


def _run(command, *, cwd=None, env=None, timeout=18):
    return subprocess.run(command, cwd=cwd, env=env, timeout=timeout, check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout.strip()


class ResourceGit:
    def __init__(self, executable, method, helpers=None):
        self.executable = str(executable)
        self.method = method
        self.helpers = str(helpers) if helpers else None

    def run(self, *argv, timeout=18, cwd=None):
        env = {key:value for key,value in os.environ.items() if not key.startswith('GIT_')}
        env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull, GIT_CONFIG_NOSYSTEM='1', GIT_TERMINAL_PROMPT='0', LESS='FRX')
        if self.helpers:
            env['GIT_EXEC_PATH'] = self.helpers
        git = [self.executable, '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never',
               '-c', 'credential.helper=', '-c', 'core.askPass=', '-c', 'http.followRedirects=false', *argv]
        command = ['/bin/bash', '-lc', 'module load git >/dev/null 2>&1 && exec "$@"', 'aimatterlab-git', *git] if self.method == 'site-module' else git
        return _run(command, cwd=cwd, env=env, timeout=timeout)

    def run_bytes(self, *argv, timeout=18, cwd=None):
        env = {key:value for key,value in os.environ.items() if not key.startswith('GIT_')}
        env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull, GIT_CONFIG_NOSYSTEM='1', GIT_TERMINAL_PROMPT='0', LESS='FRX')
        if self.helpers:
            env['GIT_EXEC_PATH'] = self.helpers
        git = [self.executable, '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never',
               '-c', 'credential.helper=', '-c', 'core.askPass=', '-c', 'http.followRedirects=false', *argv]
        command = ['/bin/bash', '-lc', 'module load git >/dev/null 2>&1 && exec "$@"', 'aimatterlab-git', *git] if self.method == 'site-module' else git
        return subprocess.run(command, cwd=cwd, env=env, timeout=timeout, check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout

    def observe(self):
        version = self.run('--version')
        if not re.fullmatch(r'git version [0-9].*', version):
            raise ValueError('Git did not return a valid version')
        return {'method':self.method, 'version':version, 'executable':self.executable,
                'sha256':file_receipt(self.executable)['sha256']}


def find_git(software):
    home = software / 'git'
    if home.is_dir() and not home.is_symlink():
        for marker in sorted(home.glob('*/.aimatterlab-git.json'))[-16:]:
            try:
                data = json.loads(marker.read_text())
                executable = (marker.parent / data['executable']).resolve(strict=True)
                if not executable.is_relative_to(marker.parent):
                    continue
                helpers = (marker.parent / data['helpers']).resolve(strict=True) if data.get('helpers') else None
                if helpers and not helpers.is_relative_to(marker.parent):
                    continue
                if file_receipt(executable)['sha256'] != data['sha256']:
                    continue
                candidate = ResourceGit(executable, 'workspace-package', helpers)
                return candidate, candidate.observe()
            except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
                continue
    primary = shutil.which('git')
    if primary:
        candidate = ResourceGit(Path(primary).resolve(), 'site')
        try:
            return candidate, candidate.observe()
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
    try:
        module = _run(['/bin/bash', '-lc', 'module load git >/dev/null 2>&1 && command -v git'], timeout=8)
        if module.startswith('/') and Path(module).is_file():
            candidate = ResourceGit(Path(module).resolve(), 'site-module')
            return candidate, candidate.observe()
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return None, None


def install_git(software, package, executable, checksum, *, debian=False):
    root = software / 'git'
    root.mkdir(mode=0o700, exist_ok=True)
    if root.is_symlink():
        raise ValueError('User Git directory must remain inside the confirmed workspace')
    destination = root / checksum[:24]
    staging = root / ('.' + checksum[:24] + '.new')
    if destination.exists():
        git, receipt = find_git(software)
        if not git:
            raise ValueError('User Git exists but fails its version probe')
        return git, receipt
    if staging.exists():
        if staging.is_symlink():
            raise ValueError('Unsafe Git staging directory')
        shutil.rmtree(staging)
    staging.mkdir(mode=0o700)
    try:
        if debian:
            unpacked = staging / '.package.tar'
            with unpacked.open('xb') as stream:
                subprocess.run(['dpkg-deb', '--fsys-tarfile', str(package)], stdout=stream,
                               stderr=subprocess.PIPE, timeout=40, check=True)
            extract_archive(unpacked, staging)
            unpacked.unlink()
        else:
            extract_archive(package, staging)
        entrypoint = (staging / executable).resolve(strict=True)
        if not entrypoint.is_relative_to(staging) or not entrypoint.is_file():
            raise ValueError('Git executable is outside its package')
        entrypoint.chmod(0o700)
        helpers = next((candidate for candidate in ('usr/lib/git-core','libexec/git-core','lib/git-core') if (staging / candidate).is_dir()), None)
        candidate = ResourceGit(entrypoint, 'workspace-package', staging/helpers if helpers else None)
        receipt = candidate.observe()
        atomic_json(staging / '.aimatterlab-git.json', {'executable':executable, 'helpers':helpers, 'sha256':receipt['sha256']})
        staging.rename(destination)
        git = ResourceGit(destination/executable, 'workspace-package', destination/helpers if helpers else None)
        return git, git.observe()
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def install_system_package(software, staging):
    """Extract an authenticated platform package without root or system modifications."""
    if not all(shutil.which(entry) for entry in ('apt-get', 'apt-cache', 'dpkg-deb')):
        return None, None
    apt = ['apt-get', '-o', 'APT::Get::AllowUnauthenticated=false', '-o', 'Acquire::AllowInsecureRepositories=false',
           '-o', 'Acquire::Retries=0', '-o', 'Acquire::https::Timeout=10', '-o', 'Acquire::http::Timeout=10']
    query = _run(['apt-cache', 'policy', 'git'])
    version = re.search(r'^\s*Candidate:\s*(\S+)$', query, re.M)
    if not version or not re.fullmatch(r'[A-Za-z0-9+.:~_-]+', version[1]) or not version[1][0].isdigit():
        return None, None
    source = 'git=' + version[1]
    metadata = _run(['apt-cache','show',source])
    hashes = set(re.findall(r'^SHA256:\s*([a-f0-9]{64})$', metadata, re.M))
    if not hashes:
        return None, None
    cache = staging / 'apt-git'
    cache.mkdir(mode=0o700, exist_ok=True)
    for previous in cache.glob('git_*.deb'):
        previous.unlink()
    _run([*apt, 'download', source], cwd=cache, timeout=35)
    files = list(cache.glob('git_*.deb'))
    if len(files) != 1:
        raise ValueError('Platform Git package download returned an unexpected file')
    receipt = file_receipt(files[0], MAX_PACKAGE)
    if receipt['sha256'] not in hashes:
        raise ValueError('Platform Git package checksum does not match the repository index')
    return install_git(software, files[0], 'usr/bin/git', receipt['sha256'], debian=True)


def checkout(git, source, staging, bundle=None):
    url, commit = source['url'], source['commit']
    options = []
    if bundle is None:
        host = public_url(url).hostname
        addresses = ['[' + item + ']' if ':' in item else item for item in public_addresses(host)]
        options = ['-c', 'http.curloptResolve=' + host + ':443:' + ','.join(addresses)]
    command = ['init','--quiet']
    if len(commit) == 64:
        command += ['--object-format=sha256']
    git.run(*command, cwd=staging)
    if bundle is not None:
        heads = git.run('bundle','list-heads',str(bundle), cwd=staging).splitlines()
        aliases = [line.split(' ', 1)[1] for line in heads if line.startswith(commit + ' ') and ' ' in line]
        if not aliases:
            raise ValueError('The supplied Git bundle does not contain the pinned commit')
        git.run('-c','protocol.file.allow=always','fetch','--quiet','--no-tags',str(bundle),aliases[0],timeout=80,cwd=staging)
    else:
        git.run(*options,'fetch','--quiet','--depth=1','--no-tags','--',url,commit,timeout=80,cwd=staging)
    git.run('-c','core.protectHFS=true','-c','core.protectNTFS=true','checkout','--quiet','--detach','FETCH_HEAD','--',cwd=staging)
    if git.run('rev-parse','HEAD',cwd=staging) != commit:
        raise ValueError('Source checkout did not reproduce the pinned commit')
    git.run('remote','add','origin',url,cwd=staging)


def blob_objects(git, repo, commit):
    if git.run('rev-parse', '--verify', 'HEAD', cwd=repo) != commit:
        raise ValueError('Checked-out Git commit differs from the reviewed source')
    status = git.run_bytes('-c', 'core.filemode=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', ':!.aimatterlab-source.json', cwd=repo)
    if status:
        raise ValueError('Checked-out Git repository has unexpected local changes')
    raw = git.run_bytes('ls-tree', '-r', '-z', '--full-tree', commit, cwd=repo).decode('utf-8')
    blobs = {}
    for entry in raw.split('\0'):
        if not entry:
            continue
        match = re.fullmatch(r'(100644|100755|120000) blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)', entry)
        if not match:
            raise ValueError('Unsupported entry in reviewed Git source tree')
        if match[1] != '120000':
            blobs[match[3]] = match[2]
    return blobs


def record_tool(git, software, configuration_id, metadata):
    repo = software / '.aimatterlab' / 'tools'
    repo.mkdir(mode=0o700, exist_ok=True)
    if repo.is_symlink() or (repo/'.git').is_symlink():
        raise ValueError('Unsafe resource tool registry directory')
    if not (repo / '.git').exists():
        if any(repo.iterdir()):
            raise ValueError('The resource tool registry path already contains unrelated files')
        git.run('init','--quiet',cwd=repo)
    if git.run('rev-parse','--show-toplevel',cwd=repo) != str(repo):
        raise ValueError('Resource tool registry Git root differs')
    relative = configuration_id + '.json'
    file = repo / relative
    if file.is_symlink() or file.with_suffix('.json.tmp').is_symlink():
        raise ValueError('Unsafe resource tool registry entry')
    atomic_json(file, metadata)
    git.run('add','--',relative,cwd=repo)
    changes = git.run('status','--porcelain','--',relative,cwd=repo)
    if changes:
        git.run('-c','user.name=AIMatterLab','-c','user.email=local@aimatterlab.invalid',
                'commit','--quiet','--only','-m','Register reviewed execution: ' + metadata['tool']['id'],'--',relative,cwd=repo)
    return {'path':str(repo), 'commit':git.run('log','-1','--format=%H','--',relative,cwd=repo),
            'manifest_sha256':file_receipt(file)['sha256']}
