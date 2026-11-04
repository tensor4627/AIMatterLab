"""Portable tool declarations and bounded worker-side resource attestation."""
import copy
import configparser
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess

SCHEMA = json.loads((Path(__file__).parent.parent / 'tool_package.schema.json').read_text(encoding='utf-8'))


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def sha(value):
    return hashlib.sha256(value).hexdigest()


def _matches(value, kind):
    if kind == 'null': return value is None
    if kind == 'object': return type(value) is dict
    if kind == 'array': return type(value) is list
    if kind == 'integer': return type(value) in (int, float) and abs(value) <= 9007199254740991 and math.isfinite(value) and int(value) == value
    if kind == 'number': return type(value) in (int, float) and abs(value) <= 1.7976931348623157e308 and math.isfinite(value)
    return type(value) is {'string': str, 'boolean': bool}.get(kind)


def _equal(a, b):
    if type(a) in (int, float) and type(b) in (int, float): return a == b
    return type(a) is type(b) and a == b


def _normalize(value, rule, where):
    if '$ref' in rule: return _normalize(value, SCHEMA['$defs'][rule['$ref'].split('/')[-1]], where)
    if 'const' in rule and not _equal(value, rule['const']): raise ValueError(where + ': unsupported constant')
    if 'enum' in rule and not any(_equal(value, item) for item in rule['enum']): raise ValueError(where + ': unsupported value')
    kinds = rule.get('type', [])
    if isinstance(kinds, str): kinds = [kinds]
    if kinds and not any(_matches(value, kind) for kind in kinds): raise ValueError(where + ': invalid type')
    if type(value) is str:
        if len(value) < rule.get('minLength', 0) or len(value) > rule.get('maxLength', float('inf')) or 'pattern' in rule and re.search(rule['pattern'], value) is None: raise ValueError(where + ': invalid text')
    if type(value) in (int, float) and (value < rule.get('minimum', -float('inf')) or value > rule.get('maximum', float('inf'))): raise ValueError(where + ': out of range')
    if type(value) is list:
        if len(value) < rule.get('minItems', 0) or len(value) > rule.get('maxItems', float('inf')): raise ValueError(where + ': invalid number of entries')
        return [_normalize(item, rule['items'], where + '[' + str(index) + ']') if 'items' in rule else copy.deepcopy(item) for index, item in enumerate(value)]
    if type(value) is dict and 'properties' in rule:
        properties = rule['properties']
        if rule.get('additionalProperties') is False and set(value) - set(properties): raise ValueError(where + ': unknown field')
        if set(rule.get('required', [])) - set(value): raise ValueError(where + ': required field missing')
        return {key: _normalize(value[key], child, where + '.' + key) if key in value else copy.deepcopy(child['default']) for key, child in properties.items() if key in value or 'default' in child}
    return copy.deepcopy(value)


def portable_resource_path(value):
    if type(value) is not str or not value or len(value) > 512 or re.search(r'[\\<>:"|?*\x00-\x1f\x7f]', value) or value.startswith('/') or any(part in ('', '.', '..') for part in value.split('/')): raise ValueError('Canonical package-relative resource path required')
    return value


def _unique(items):
    ids = [item if type(item) is str else item['id'] for item in items]
    if len(set(ids)) != len(ids): raise ValueError('Duplicate tool identifier')


def validate_tool_package(value):
    count = 0
    def visit(item, depth=0):
        nonlocal count
        count += 1
        if count > 12000 or depth > 24: raise ValueError('Tool declaration complexity exceeds supported bound')
        if item is None or type(item) in (bool, str): return
        if type(item) in (int, float) and abs(item) <= 1.7976931348623157e308 and math.isfinite(item): return
        if type(item) is list:
            for child in item: visit(child, depth + 1)
            return
        if type(item) is dict and all(type(key) is str for key in item):
            for child in item.values(): visit(child, depth + 1)
            return
        raise ValueError('Plain finite JSON required')
    visit(value)
    if len(encoded(value)) > 512 * 1024: raise ValueError('Tool declaration exceeds 512 KiB')
    result = _normalize(value, SCHEMA, 'manifest')
    portable_resource_path(result['repository']['path']); portable_resource_path(result['manual'])
    for role in ('installation', 'configuration'):
        for name in result['guidance'][role]: portable_resource_path(name)
    tests = result['tests']
    if tests['directory'] != result['id'] + '-tests': raise ValueError('Standard tool-tests directory required')
    def in_tests(name):
        portable_resource_path(name)
        if not name.startswith(tests['directory'] + '/'): raise ValueError('Test entry must belong to standard test directory')
    in_tests(tests['introduction'])
    if not tests['introduction'].endswith('.md'): raise ValueError('Markdown test introduction required')
    _unique(result['environment']['parallelism']['supported']); _unique(result['functions']); _unique(tests['cases'])
    for feature in result['functions']:
        portable_resource_path(feature['entrypoint'])
        for group in ('inputs', 'outputs', 'parameters', 'tests'): _unique(feature[group])
        for item in feature['inputs'] + feature['outputs'] + feature['parameters']:
            if not item['required'] and ('default' not in item or not (item.get('default_behavior') or '').strip() or not (item.get('default_source') or '').strip()): raise ValueError('Optional resources/parameters require default, default_behavior and default_source')
            if item['required'] and 'default' in item: raise ValueError('Required resource cannot silently default')
            if item['type'] not in ('value', 'file', 'files', 'directory') and item.get('default') is not None and not _matches(item['default'], item['type']): raise ValueError('Parameter default type differs')
        if any(re.search(r'[\r\n\x00]', token) for token in feature['operation']['command']): raise ValueError('Control character in argv')
    for case in tests['cases']:
        in_tests(case['directory']); in_tests(case['instructions'])
        if not case['instructions'].startswith(case['directory'] + '/') or not case['instructions'].endswith('.md'): raise ValueError('Test instructions must be case Markdown')
        for name in [case['entrypoint'], *case['resources'], *[item['path'] for item in case['expected_outputs']]]: portable_resource_path(name)
        feature = next((item for item in result['functions'] if item['id'] == case['function_id']), None)
        if feature is None or case['id'] not in feature['tests']: raise ValueError('Test/function coverage disagrees')
    for feature in result['functions']:
        for identifier in feature['tests']:
            if not any(case['id'] == identifier and case['function_id'] == feature['id'] for case in tests['cases']): raise ValueError('Declared functional test missing')
    if result['environment']['hardware'] == 'cpu' and result['environment']['parallelism']['gpus'] != 0: raise ValueError('CPU tool cannot default to GPU use')
    return result


def tool_package_resources(manifest):
    value = validate_tool_package(manifest)
    names = ['tool.json', value['manual'], value['guidance']['delivery'], *value['guidance']['installation'], *value['guidance']['configuration'], *[item['entrypoint'] for item in value['functions']], value['tests']['introduction']]
    for case in value['tests']['cases']: names.extend([case['instructions'], case['entrypoint'], *case['resources']])
    return sorted(set(names), key=lambda name: name.encode('utf-8'))


def owned(root, name='', directory=False):
    root = Path(root).absolute()
    if root.resolve() != root: raise ValueError('Linked package or owned directory refused')
    target = root / name
    target.relative_to(root)
    current = root
    for part in ('', *Path(name).parts):
        if part: current = current / part
        if current.is_symlink(): raise ValueError('Linked package resource refused')
    if target.exists() and (not target.is_dir() if directory else not target.is_file()): raise ValueError('Unexpected package resource kind')
    return target


def resolve_resource(root, name):
    root = owned(root, directory=True)
    portable_resource_path(name)
    pending = list(Path(name).parts); current = root; followed = set()
    while pending:
        current = current / pending.pop(0)
        if current.is_symlink():
            if current in followed or len(followed) >= 40: raise ValueError('Cyclic package link refused')
            followed.add(current)
            target = os.readlink(current)
            if not target or Path(target).is_absolute() or re.match(r'^[A-Za-z]:', target) or re.search(r'[\\\x00-\x1f\x7f]', target): raise ValueError('Only internal relative package links supported')
            expanded = Path(os.path.normpath(current.parent / target))
            try: relative = expanded.relative_to(root)
            except ValueError: raise ValueError('Package link escaped its root')
            pending = [*relative.parts, *pending]; current = root
    if not current.exists(): raise ValueError('Package link target unavailable')
    return current


def read_bytes(root, name, maximum=8 * 1024 * 1024):
    portable_resource_path(name)
    path = resolve_resource(root, name)
    if not path.is_file(): raise ValueError('Regular package resource required')
    before = path.stat()
    if before.st_size > maximum: raise ValueError('Package resource exceeds supported bound')
    value = path.read_bytes(); after = path.stat()
    if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns): raise ValueError('Package resource changed during read')
    return value


def package_identity_text(identifier, commit, manifest_sha256, files):
    return 'studio.tool-package/1\0' + identifier + '\0' + commit + '\0' + manifest_sha256 + '\0' + ''.join(item['path'] + '\0' + item['kind'] + '\0' + (item['target'] or '') + '\0' + str(item['size']) + '\0' + item['sha256'] + '\n' for item in files)


def load_package(root, expected_version=None):
    root = owned(root, directory=True)
    raw = read_bytes(root, 'tool.json', 512 * 1024)
    manifest = validate_tool_package(json.loads(raw))
    repository = resolve_resource(root, manifest['repository']['path'])
    git_directory = repository / '.git'
    if not git_directory.is_dir() or git_directory.is_symlink() or any((git_directory / name).exists() for name in ('objects/info/alternates', 'commondir', 'shallow')): raise ValueError('Independent complete snapshot Git directory required')
    for current, directories, files in os.walk(git_directory, followlinks=False):
        if any((Path(current) / name).is_symlink() for name in [*directories, *files]): raise ValueError('Linked snapshot Git administration refused')
        if any(name.endswith('.promisor') for name in files): raise ValueError('Partial snapshot object stores are unsupported')
    configuration = configparser.RawConfigParser()
    configuration.read_string((git_directory / 'config').read_text(encoding='utf-8'))
    if set(configuration.sections()) - {'core', 'extensions'} or any(key not in {'repositoryformatversion', 'bare', 'logallrefupdates', 'autocrlf', 'eol', 'filemode', 'symlinks', 'ignorecase', 'precomposeunicode'} for key in configuration.options('core')) or configuration.has_section('extensions') and set(configuration.options('extensions')) - {'objectformat'}: raise ValueError('Snapshot Git configuration must remain local and inert')
    environment = {**{key: value for key, value in os.environ.items() if not key.startswith('GIT_')}, 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_SYSTEM': os.devnull, 'GIT_OPTIONAL_LOCKS': '0', 'GIT_TERMINAL_PROMPT': '0', 'GIT_NO_LAZY_FETCH': '1'}
    def git(*args):
        result = subprocess.run(['git', '--no-optional-locks', '-C', str(repository), *args], capture_output=True, env=environment, timeout=10)
        if result.returncode or len(result.stdout) > 2 * 1024 * 1024: raise ValueError('Snapshot Git identity unavailable')
        return result.stdout
    if git('rev-parse', 'HEAD').decode().strip() != manifest['repository']['commit']: raise ValueError('Snapshot source commit differs')
    for name in [manifest['guidance']['delivery'], *manifest['guidance']['installation'], *manifest['guidance']['configuration']]:
        if not resolve_resource(root, name).is_file(): raise ValueError('Guidance resources must be files with explicit roles')
    names = set(tool_package_resources(manifest))
    tracked = set()
    for row in git('ls-tree', '-r', '-z', 'HEAD').split(b'\0'):
        if not row: continue
        metadata, name = row.split(b'\t', 1)
        mode, kind, _identifier = metadata.split()
        if mode not in (b'100644', b'100755', b'120000') or kind != b'blob': raise ValueError('Only tracked files/internal links supported')
        original = portable_resource_path(name.decode('utf-8')); tracked.add(original)
        logical = manifest['repository']['path'] + '/' + original
        if mode == b'120000' and (not (root / logical).is_symlink() or git('cat-file', 'blob', _identifier.decode()) != os.readlink(root / logical).encode('utf-8')): raise ValueError('Snapshot link differs from tracked source')
        names.add(logical)
    tests_root = resolve_resource(root, manifest['tests']['directory'])
    if not tests_root.is_dir(): raise ValueError('Standard tests directory required')
    for entry in [item['entrypoint'] for item in manifest['functions']] + [item['entrypoint'] for item in manifest['tests']['cases']]:
        actual = resolve_resource(root, entry)
        if not actual.is_file(): raise ValueError('Program entrypoint must be a regular target')
        if actual.is_relative_to(repository):
            if actual.relative_to(repository).as_posix() not in tracked: raise ValueError('Original repository program must belong to Git HEAD')
        elif not actual.is_relative_to(tests_root):
            raise ValueError('External program wrapper must belong to the standard tests directory')
    resources = {}; directories_seen = set(); total = 0
    def collect(name, ancestors=()):
        nonlocal total
        portable_resource_path(name)
        for parent in list(Path(name).parents)[:-1]:
            if (root / parent).is_symlink() and parent.as_posix() not in resources: collect(parent.as_posix())
        path = root / name; resolved = resolve_resource(root, name)
        if resolved.is_dir() and resolved in ancestors: raise ValueError('Cyclic package directory closure refused')
        if path.is_symlink():
            raw = os.readlink(path).encode('utf-8')
            resources[name] = {'path': name, 'kind': 'symlink', 'target': raw.decode('utf-8'), 'size': len(raw), 'sha256': sha(raw)}
            collect(resolved.relative_to(root).as_posix(), ancestors)
        if resolved.is_dir():
            # Bind the complete logical directory view as well as physical targets.
            if name in directories_seen: return
            directories_seen.add(name)
            for item in sorted(path.iterdir()):
                if item.name == '.git': continue
                collect(item.relative_to(root).as_posix(), (*ancestors, resolved))
        elif name not in resources:
            raw = read_bytes(root, name, 16 * 1024 * 1024); total += len(raw)
            if len(resources) >= 4096 or total > 128 * 1024 * 1024: raise ValueError('Snapshot resource budget exceeded')
            resources[name] = {'path': name, 'kind': 'file', 'target': None, 'size': len(raw), 'sha256': sha(raw)}
    collect(manifest['tests']['directory'])
    for name in names: collect(name)
    resources = [resources[name] for name in sorted(resources, key=lambda item: item.encode('utf-8'))]
    manifest_sha256 = sha(raw)
    version = sha(package_identity_text(manifest['id'], manifest['repository']['commit'], manifest_sha256, resources).encode('utf-8'))
    if expected_version is not None and expected_version != version: raise ValueError('Tool package version changed')
    return {'manifest': manifest, 'files': resources, 'manifest_sha256': manifest_sha256, 'package_id': manifest['id'], 'package_version': version, 'snapshot_root': str(root)}
