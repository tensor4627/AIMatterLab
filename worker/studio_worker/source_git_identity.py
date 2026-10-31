"""Bounded public-source Git identity; never repairs or writes Git metadata."""
import hashlib
import os
import re
import stat
import subprocess
from pathlib import Path


class SourceGitError(ValueError):
    def __init__(self, message, *, status='not_run'):
        super().__init__(message)
        self.status = status


def _path(path):
    path = Path(path).absolute()
    for part in [path, *path.parents]:
        if part.is_symlink():
            raise SourceGitError('Linked source Git metadata refused')
    return path.resolve(strict=True)


def _control(path):
    path = _path(path)
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > 4096:
        raise SourceGitError('Bounded regular Git control file required')
    with path.open('rb') as stream:
        raw = stream.read(4097)
    after = path.stat()
    if len(raw) > 4096 or (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
        raise SourceGitError('Git control metadata changed during read')
    text = raw.decode('utf-8')
    if '\0' in text or not text.endswith('\n') or '\n' in text.rstrip('\r\n') or '\r' in text.rstrip('\r\n'):
        raise SourceGitError('Single canonical Git control line required')
    return text.rstrip('\r\n'), hashlib.sha256(raw).hexdigest()


def _environment():
    value = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    # Preserve ordinary nonexecuting config (for example autocrlf/excludes).
    # Executable helpers are disabled by fixed per-command overrides below.
    value.update(GIT_TERMINAL_PROMPT='0', GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1')
    return value


def _run(command, *, run=subprocess.run, env=None, strip_output=True):
    try:
        result = run(command, capture_output=True, text=True, timeout=8, env=env or _environment())
    except FileNotFoundError as error:
        raise SourceGitError('Source Git executable unavailable', status='blocked') from error
    except subprocess.TimeoutExpired as error:
        raise SourceGitError('Bounded source Git observation timed out', status='unknown') from error
    except OSError as error:
        raise SourceGitError('Bounded source Git command unavailable') from error
    if result.returncode or len(result.stdout.encode()) > 262144 or len(result.stderr.encode()) > 8192:
        raise SourceGitError('Source Git identity unavailable')
    return result.stdout.strip() if strip_output else result.stdout


def _windows(value):
    if not isinstance(value,str) or value!=value.strip() or any(ord(c)<32 for c in value):
        raise SourceGitError('Ambiguous Git path whitespace/control refused')
    if not re.fullmatch(r'[A-Za-z]:[/\\][^\r\n\0]+', value):
        return False
    parts = value[3:].replace('\\', '/').split('/')
    if any(x in ('', '.', '..') for x in parts) or ':' in value[2:]:
        raise SourceGitError('Ambiguous Windows Git path refused')
    return True


def _map(value, *, run=subprocess.run, mapper=None):
    if not _windows(value):
        raise SourceGitError('Only rooted drive-letter Git paths may be mapped')
    if mapper is not None:
        mapped = mapper(value)
    else:
        if os.name != 'posix' or 'microsoft' not in Path('/proc/sys/kernel/osrelease').read_text().lower():
            raise SourceGitError('Windows Git path mapping requires WSL')
        mapped = _run(['wslpath', '-u', value], run=run,strip_output=False)
        if mapped.endswith('\n'):mapped=mapped[:-1]
    if not isinstance(mapped, str) or mapped!=mapped.strip() or any(ord(c)<32 for c in mapped) or not mapped.startswith('/') or '\\' in mapped or any(p in ('.', '..') for p in mapped.split('/')):
        raise SourceGitError('Invalid mapped Git metadata path')
    return _path(mapped)


def git_identity(root, *, run=subprocess.run, mapper=None):
    """Trusted registered source root only. Fixed HEAD/status; no arbitrary verbs."""
    root = _path(root)
    if not root.is_dir():
        raise SourceGitError('Registered repository directory required')
    pointer = root / '.git'
    _path(pointer)
    bindings = []
    admin = common = None
    mechanism = 'native_git'
    if pointer.is_file():
        line, digest = _control(pointer)
        if not line.startswith('gitdir: '):
            raise SourceGitError('Invalid Git worktree pointer')
        value = line[8:]
        if _windows(value) and os.name != 'nt':
            mechanism = 'validated_windows_worktree'
            admin = _map(value, run=run, mapper=mapper)
            if not admin.is_dir() or admin.parent.name != 'worktrees' or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', admin.name) or admin.parent.parent.name != '.git':
                raise SourceGitError('Expected linked worktree administration layout')
            common = _path(admin.parent.parent)
            cd, cd_hash = _control(admin / 'commondir')
            if cd.replace('\\', '/') != '../..' or _path(admin / cd) != common:
                raise SourceGitError('Foreign worktree common directory refused')
            back, back_hash = _control(admin / 'gitdir')
            backlink = _map(back, run=run, mapper=mapper) if _windows(back) else _path(back)
            if backlink != pointer:
                raise SourceGitError('Worktree backlink does not match selected root')
            _, head_hash = _control(admin / 'HEAD')
            bindings = [(pointer, digest), (admin / 'commondir', cd_hash), (admin / 'gitdir', back_hash), (admin / 'HEAD', head_hash)]
    command = ['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.hooksPath=' + os.devnull, '-c', 'maintenance.auto=false', '-c', 'gc.auto=0']
    env = _environment()
    if admin is None:
        command += ['-C', str(root)]
    else:
        command += ['--git-dir=' + str(admin), '--work-tree=' + str(root)]
        env['GIT_COMMON_DIR'] = str(common)
    values = [_run(command + tail, run=run, env=env) for tail in (['rev-parse', 'HEAD'], ['status', '--porcelain'])]
    if not re.fullmatch(r'[a-f0-9]{40}|[a-f0-9]{64}', values[0]):
        raise SourceGitError('Invalid source commit identity')
    for control, before in bindings:
        if _control(control)[1] != before:
            raise SourceGitError('Git control binding changed during observation')
    return {'commit': values[0], 'dirty': bool(values[1]), 'status_sha256': hashlib.sha256(values[1].encode()).hexdigest(), 'mechanism': mechanism}
