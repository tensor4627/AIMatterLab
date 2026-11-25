"""Worker-created scheduler invocations for reviewed graphs and tool configuration tests."""
import os
from pathlib import Path
from hashlib import sha256
import re
import shlex

from studio_worker.infrastructure.util import stable_file_snapshot


def private_engine(name):
    return isinstance(name, str) and re.fullmatch(r'private\.[a-z][a-z0-9-]{0,62}', name) is not None


def source_digest(path):
    return stable_file_snapshot(Path(path).resolve(strict=True))['sha256']


def invocation(argv, version, inputs, output_root, owner, activation, writable_roots=()):
    root = Path(output_root)
    if not root.is_absolute() or root.resolve(strict=True) != root or not root.is_dir():
        raise ValueError('An existing verified invocation workspace is required')
    if not isinstance(argv, list) or not argv or any(type(arg) is not str or '\0' in arg for arg in argv):
        raise ValueError('A frozen argument vector is required')
    executable = Path(argv[0])
    if not executable.is_absolute() or not os.access(executable, os.X_OK):
        raise ValueError('The reviewed executable is unavailable')
    if activation is not None and (not isinstance(activation, str) or '\0' in activation or len(activation) > 8192):
        raise ValueError('Invalid activation recipe')
    files = dict(version.get('files', {}))
    files[str(executable)] = version['executable_sha256']
    for name, expected in files.items():
        if not Path(name).is_absolute() or source_digest(name) != expected:
            raise ValueError('The reviewed tool file changed: ' + name)
    if version.get('install_tree_sha256'):
        from studio_worker.tools import resource_tool_build as builder
        install_root = Path(version.get('install_root', ''))
        if not install_root.is_absolute() or install_root.resolve(strict=True) != install_root or not install_root.is_dir():
            raise ValueError('The reviewed tool directory changed: ' + str(install_root))
        if builder.source_tree(install_root) != version['install_tree_sha256']:
            raise ValueError('The reviewed tool directory changed: ' + str(install_root))
    for item in inputs.values():
        observed = stable_file_snapshot(item['path'])
        if any(observed[k] != item[k] for k in ('sha256', 'size')):
            raise ValueError('The reviewed input bytes changed')
    if len(writable_roots) > 1 or writable_roots and owner.get('kind') != 'configuration-build':
        raise PermissionError('Only the reviewed configuration build can write to its source staging directory')
    extra = []
    for source in writable_roots:
        work = Path(source)
        if not work.is_absolute() or work.resolve(strict=True) != work or not work.is_dir():
            raise ValueError('The reviewed build writing directory changed')
        extra.append(str(work))
    return {'argv': argv, 'files': files, 'version':version, 'inputs':inputs, 'root':str(root),
            'owner':owner, 'activation':activation, **({'writable_roots':extra} if extra else {})}


def job_root(run):
    bound = run.get('bound_invocation')
    if bound:
        if run['cluster_snapshot'].get('transport_kind') != 'ssh-service-local':
            raise ValueError('A resource-bound invocation requires the original same-host scheduler')
        return bound['root']
    return run['cluster_snapshot']['remote_root']


def confinement_source():
    return Path(__file__).with_name('workspace_confinement.py').read_bytes()


def bound_batch_body(run, python, remote, exports, receipt):
    """Run the allocation's validation and execution under separate path bounds."""
    profile, resources, bound = run['cluster_snapshot'], run['resources'], run['bound_invocation']
    limit = resources['seconds']
    prelude = ['set -u', 'readonly _STUDIO_COMPUTE_CWD="$1"',
               'if [ "${CUDA_VISIBLE_DEVICES+x}" = x ]; then _STUDIO_ASSIGNED_CUDA=$CUDA_VISIBLE_DEVICES; _STUDIO_HAS_CUDA=1; fi',
               profile.get('activation',''), bound.get('activation') or '',
               'if [ "${_STUDIO_HAS_CUDA:-0}" = 1 ]; then export CUDA_VISIBLE_DEVICES=$_STUDIO_ASSIGNED_CUDA; fi',
               *exports, 'cd -P -- "$_STUDIO_COMPUTE_CWD" && [ "$(pwd -P)" = "$_STUDIO_COMPUTE_CWD" ] || exit 76',
               'mkdir -p -- .aimatterlab-tmp .aimatterlab-cache || exit 76',
               'export TMPDIR="$PWD/.aimatterlab-tmp" XDG_CACHE_HOME="$PWD/.aimatterlab-cache" PYTHONDONTWRITEBYTECODE=1']
    trusted = '.studio/workspace-confinement.py'
    expected = sha256(confinement_source()).hexdigest()
    gpu = ' --gpu' if resources.get('gpus', 0) > 0 else ''
    def launch(cwd, command, seconds, additional=''):
        content = shlex.quote('\n'.join([*prelude, 'exec ' + command]))
        return f'timeout --signal=TERM --kill-after=15s {seconds}s {python} -I {trusted} {cwd} {cwd} \'\'{gpu}{additional} /bin/bash -c {content} aimatterlab {cwd}'
    build_roots = ''.join(' --write ' + shlex.quote(path) for path in bound.get('writable_roots', ()))
    validate = launch('"$PWD"', python + ' .studio/validate.py', limit)
    execute = launch('"$PWD/simulation"', shlex.join(run['command']), '"$remaining"', build_roots)
    return ['set -u','cd -P ' + remote + ' || exit 76',
            f'printf \'%s  %s\\n\' {expected} {trusted} | sha256sum --status -c || exit 76',
            'start=$SECONDS', validate + ' >validation.stdout 2>validation.stderr',
            'status=$?',f'remaining=$(({limit}-(SECONDS-start)))',
            'if [ "$status" -eq 0 ] && [ "$remaining" -gt 0 ]; then',
            ' ' + execute + ' >console.log 2>&1', ' status=$?',
            'elif [ $remaining -le 0 ]; then',' status=124','fi',
            python+' -c '+shlex.quote(receipt)+' "$status"','exit "$status"']


# Runs inside the allocation immediately before the reviewed program. Never imports user code.
COMPUTE_CHECK = """
import hashlib, json, os, shutil
from pathlib import Path
def check(path, expected):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != expected:
        raise ValueError('Frozen file differs in compute-node environment: ' + str(path))
r = json.loads(Path('.studio/run.json').read_text())
for command in r['bound_invocation']['version'].get('dependencies', []):
    if not shutil.which(command):
        raise ValueError('Missing tool dependency in compute allocation: ' + command)
for name, expected in r['bound_invocation']['files'].items():
    resolved = r['bound_invocation']['version'].get('resolved_files', {}).get(name)
    if resolved and str(Path(name).resolve(strict=True)) != resolved:
        raise ValueError('Frozen link resolves to a different compute-node file: ' + name)
    check(name, expected)
install_tree = r['bound_invocation']['version'].get('install_tree_sha256')
if install_tree:
    root = Path(r['bound_invocation']['version'].get('install_root', ''))
    if not root.is_absolute() or root.resolve(strict=True) != root or not root.is_dir():
        raise ValueError('Frozen tool directory changed in compute-node environment: ' + str(root))
    entries = []
    for current, dirs, names in os.walk(root, followlinks=False):
        current = Path(current)
        for name in dirs:
            p = current / name
            if name == '.git' or not p.is_symlink():
                continue
            if not p.resolve(strict=True).is_relative_to(root):
                raise ValueError('Tool directory link leaves reviewed tree')
            entries.append((p.relative_to(root).as_posix(), 'directory-link', os.readlink(p)))
        dirs[:] = sorted(name for name in dirs if name != '.git' and not (current / name).is_symlink())
        for name in sorted(names):
            p = current / name
            if p == root / '.aimatterlab-source.json':
                continue
            rel = p.relative_to(root).as_posix()
            if p.is_symlink() and not p.resolve(strict=True).is_relative_to(root):
                raise ValueError('Tool file link leaves reviewed tree: ' + rel)
            if not p.is_file():
                raise ValueError('Unexpected non-file in tool directory: ' + rel)
            st = p.stat()
            d = hashlib.sha256()
            with open(p, 'rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    d.update(block)
            entries.append((rel, d.hexdigest(), os.readlink(p) if p.is_symlink() else bool(st.st_mode & 0o111)))
    if hashlib.sha256(json.dumps(sorted(entries), separators=(',', ':')).encode()).hexdigest() != install_tree:
        raise ValueError('Frozen tool directory differs in compute-node environment: ' + str(root))
for item in r['snapshots']:
    check(Path('simulation') / item['name'], item['sha256'])
if not os.access(r['command'][0], os.X_OK):
    raise ValueError('Reviewed tool is not executable in this allocation')
temporary = Path('.bound-execution-check.tmp')
temporary.write_text(json.dumps({'status':'passed','required':True,'scope':'Compute-node tool, dependency and input identity'}))
temporary.replace('execution-check.json')
"""
