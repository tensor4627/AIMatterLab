"""Typed definitions and argument expansion for resource-private executables."""
import hashlib
import json
import math
import re
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

from studio_worker.infrastructure.util import stable_file_snapshot


SLUG = re.compile(r'[a-z][a-z0-9-]{0,62}')
PORT = re.compile(r'[A-Za-z][A-Za-z0-9_-]{0,62}')
SHA256 = re.compile(r'[a-f0-9]{64}')
TOKEN = re.compile(r'\{(input|output|param):([A-Za-z][A-Za-z0-9_-]{0,62})\}')


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def fields(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= value.keys() or set(value) - set(required) - set(optional):
        raise ValueError('Invalid resource tool request fields')
    return value


def string(value, limit=512):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError('Expected a bounded text value')
    return value


def match(value, pattern, message):
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ValueError(message)
    return value


def relative_path(value):
    string(value, 240)
    parts = value.split('/')
    if any(part in ('', '.', '..') or not re.fullmatch(r'[A-Za-z0-9_.+-]{1,100}', part) for part in parts):
        raise ValueError('Use a portable path within the reviewed tool directory')
    return str(PurePosixPath(value))


def absolute_path(value):
    string(value, 2048)
    if not value.startswith('/') or value.startswith('//') or any(part in ('.', '..') for part in value.split('/')) or '\\' in value:
        raise ValueError('Use an absolute path on the selected SSH resource')
    return Path(value)


def public_url(value, *, redirect=False):
    url = urlsplit(string(value, 4096 if redirect else 2048))
    if (url.scheme != 'https' or not url.hostname or url.username is not None or url.password is not None or
            url.port not in (None, 443) or url.fragment or (url.query and not redirect) or '\\' in value):
        raise ValueError('Use a public HTTPS release URL without credentials or signed query parameters')
    return url


def artifact(value):
    fields(value, ('kind', 'sha256', 'filename', 'executable'), ('url',))
    if value['kind'] not in ('archive', 'binary'):
        raise ValueError('Choose an archive or standalone binary')
    match(value['sha256'], SHA256, 'Pin the SHA-256 of the release file')
    name = relative_path(value['filename'])
    if '/' in name:
        raise ValueError('Use a single release filename')
    relative_path(value['executable'])
    if value.get('url') is not None:
        public_url(value['url'])
    return value


def numeric(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise ValueError('Invalid ' + label)
    return value


def bounded_arg(value, limit):
    if not isinstance(value, str) or len(value) > limit or '\0' in value:
        raise ValueError('Invalid argument value')


def port_map(value):
    if not isinstance(value, dict) or len(value) > 32:
        raise ValueError('Use at most 32 ports per direction')
    names = []
    for key, item in value.items():
        match(key, PORT, 'Invalid port identity')
        fields(item, ('filename', 'format'))
        name = relative_path(item['filename'])
        if name.startswith('.studio/'):
            raise ValueError('The job service reserves .studio')
        names.append(name)
        match(item['format'], re.compile(r'[A-Za-z0-9][A-Za-z0-9+._/-]{0,63}'), 'Invalid port format')
    if len(names) != len(set(names)):
        raise ValueError('Each port needs a distinct filename')
    return value


def _matches_scalar(value, kind):
    if kind == 'string':
        if type(value) is not str:
            return False
        bounded_arg(value, 1024)
        return True
    if kind == 'boolean':
        return type(value) is bool
    if kind == 'integer':
        return type(value) is int
    if kind == 'number':
        return type(value) in (int, float) and math.isfinite(value)
    return False


def parameter_map(value):
    if not isinstance(value, dict) or len(value) > 32:
        raise ValueError('Use a bounded set of scalar parameters')
    for key, item in value.items():
        match(key, PORT, 'Invalid parameter identity')
        if type(item) is str:
            bounded_arg(item, 1024)
        elif not (type(item) in (bool, int) or type(item) is float and math.isfinite(item)):
            raise ValueError('Tool arguments use finite scalar parameters')
    return value


def parameter_specs_map(value):
    if not isinstance(value, dict) or len(value) > 32:
        raise ValueError('Use a bounded set of scalar parameter specifications')
    for key, item in value.items():
        match(key, PORT, 'Invalid parameter identity')
        fields(item, ('type', 'required'), ('default',))
        kind = item['type']
        if kind not in ('string', 'boolean', 'integer', 'number') or type(item['required']) is not bool:
            raise ValueError('Invalid parameter specification: ' + key)
        if item['required']:
            if 'default' in item:
                raise ValueError('Required parameter cannot declare a default: ' + key)
        else:
            if 'default' not in item or not _matches_scalar(item['default'], kind):
                raise ValueError('Optional parameter requires a typed scalar default: ' + key)
    return value


def args_for(manifest, parameters):
    parameter_map(parameters)
    specs = manifest.get('parameter_specs')
    if specs is not None:
        values = {}
        for name in parameters:
            if name not in specs:
                raise ValueError('Unknown or incompatible parameter: ' + name)
        for name, spec in specs.items():
            if name in parameters:
                value = parameters[name]
                if not _matches_scalar(value, spec['type']):
                    raise ValueError('Unknown or incompatible parameter: ' + name)
                values[name] = value
            elif spec['required']:
                raise ValueError('Missing required parameter: ' + name)
            else:
                values[name] = spec['default']
    else:
        defaults = manifest.get('parameters', {})
        for name, value in parameters.items():
            if name not in defaults:
                raise ValueError('Unknown or incompatible parameter: ' + name)
            expected = type(defaults[name])
            if expected is float:
                compatible = type(value) in (int, float) and math.isfinite(value)
            else:
                compatible = type(value) is expected
            if not compatible:
                raise ValueError('Unknown or incompatible parameter: ' + name)
        values = {**defaults, **parameters}
    bindings = {'input': {key: item['filename'] for key, item in manifest['inputs'].items()},
                'output': {key: item['filename'] for key, item in manifest['outputs'].items()}, 'param': values}

    def expand(match_):
        kind, name = match_.groups()
        if name not in bindings[kind]:
            raise ValueError('Unknown template reference: ' + match_[0])
        value = bindings[kind][name]
        return ('true' if value else 'false') if type(value) is bool else str(value)

    return [TOKEN.sub(expand, word) for word in manifest['argv']]


def manifest(value, route):
    fields(value, ('id', 'name', 'version', 'source', 'argv', 'inputs', 'outputs', 'test'),
           ('description', 'citations', 'interpreter', 'dependencies', 'parameters', 'parameter_specs',
            'support_files', 'git_bootstrap', 'build'))
    match(value['id'], SLUG, 'Tool ID must be a lowercase name using letters, digits, and hyphens')
    string(value['name'], 100)
    match(value['version'], re.compile(r'[A-Za-z0-9][A-Za-z0-9._+-]{0,63}'), 'Use a concrete tool version')
    if 'description' in value:
        string(value['description'], 300)
    if 'interpreter' in value and value['interpreter'] not in ('bash', 'python'):
        raise ValueError('Choose a supported script interpreter')
    citations = value.get('citations', [])
    if not isinstance(citations, list) or len(citations) > 12:
        raise ValueError('Use a bounded set of tool references')
    for citation in citations:
        fields(citation, ('url',), ('title', 'version'))
        public_url(citation['url'])
        for key in ('title', 'version'):
            if key in citation:
                string(citation[key], 240)
    source = value['source']
    if not isinstance(source, dict):
        raise ValueError('Specify the tool program source')
    kind = source.get('kind')
    if kind == 'installed':
        fields(source, ('kind', 'executable'), ('sha256',))
        absolute_path(source['executable'])
        if 'sha256' in source:
            match(source['sha256'], SHA256, 'Invalid installed program checksum')
    elif kind == 'git':
        fields(source, ('kind', 'url', 'commit', 'executable'))
        public_url(source['url'])
        match(source['commit'], re.compile(r'[a-f0-9]{40}|[a-f0-9]{64}'), 'Pin the full source commit ID')
        relative_path(source['executable'])
    else:
        artifact(source)
    if (route == 'existing' and kind != 'installed' or route == 'fresh' and (kind == 'installed' or not source.get('url'))):
        raise ValueError('The chosen onboarding route does not match the source')
    if 'build' in value:
        if kind not in ('archive','git'):
            raise ValueError('Build steps require a pinned source archive or repository')
        build = fields(value['build'], ('steps','max_seconds'))
        numeric(build['max_seconds'], 1, 86400, 'build duration')
        if not isinstance(build['steps'], list) or not 1 <= len(build['steps']) <= 16:
            raise ValueError('Use a bounded sequence of concrete build commands')
        for step in build['steps']:
            fields(step, ('command','args'), ('cwd',))
            match(step['command'], PORT, 'Use a registered executable or command name for each build step')
            if 'cwd' in step:
                relative_path(step['cwd'])
            if not isinstance(step['args'], list) or len(step['args']) > 64:
                raise ValueError('Use a bounded build argument vector')
            for word in step['args']:
                bounded_arg(word, 2048)
    if 'git_bootstrap' in value:
        artifact(value['git_bootstrap'])
        if value['git_bootstrap']['kind'] != 'archive':
            raise ValueError('User-level Git requires a compatible package archive')
    for field, validator in (('support_files', relative_path), ('dependencies', lambda key: match(key, PORT, 'Use registered executable names for dependencies'))):
        entries = value.get(field, [])
        if not isinstance(entries, list) or len(entries) > 32:
            raise ValueError('Invalid ' + field)
        for entry in entries:
            validator(entry)
        if len(set(entries)) != len(entries):
            raise ValueError('Duplicate ' + field)
    arguments = value['argv']
    if not isinstance(arguments, list) or len(arguments) > 96:
        raise ValueError('Use a bounded argument vector')
    for word in arguments:
        bounded_arg(word, 2048)
        if re.search(r'\{(?:input|output|param):', TOKEN.sub('', word)):
            raise ValueError('Invalid template reference')
    inputs, outputs = port_map(value['inputs']), port_map(value['outputs'])
    if not outputs or {port['filename'] for port in inputs.values()} & {port['filename'] for port in outputs.values()}:
        raise ValueError('Declare observable output files distinct from the input files')
    test = fields(value['test'], ('inputs', 'max_seconds'), ('parameters', 'resources', 'outputs'))
    if not isinstance(test['inputs'], dict) or set(test['inputs']) != set(inputs):
        raise ValueError('Minimal test inputs must match all input ports')
    for fixture in test['inputs'].values():
        if not isinstance(fixture, dict) or len(fixture) != 1:
            raise ValueError('Supply a test input path or small fixture text')
        if 'path' in fixture:
            absolute_path(fixture['path'])
        elif not isinstance(fixture.get('text'), str) or len(fixture['text'].encode()) > 16 * 1024 or '\0' in fixture['text']:
            raise ValueError('Use a test file for larger or binary fixtures')
    numeric(test['max_seconds'], 1, 600, 'minimal test duration')
    checks = test.get('outputs', {})
    if not isinstance(checks, dict) or not set(checks) <= set(outputs):
        raise ValueError('Test output criteria must reference declared output ports')
    for check in checks.values():
        fields(check, (), ('sha256','contains','json_keys','min_bytes'))
        if 'sha256' in check:
            match(check['sha256'], SHA256, 'Invalid expected output SHA-256')
        if 'contains' in check:
            string(check['contains'], 4096)
        if 'min_bytes' in check:
            numeric(check['min_bytes'], 0, 2147483647, 'minimum expected output size')
        if 'json_keys' in check:
            keys = check['json_keys']
            if not isinstance(keys, list) or not keys or len(keys) > 32:
                raise ValueError('Provide a finite list of expected JSON keys')
            for key in keys:
                string(key, 120)
    resources = fields(test.get('resources', {}), (), ('cpus', 'gpus', 'memory_mb', 'qos'))
    for key in ('cpus', 'gpus', 'memory_mb'):
        if key in resources:
            numeric(resources[key], 0 if key == 'gpus' else 1, 2147483647, key)
    if 'qos' in resources:
        match(resources['qos'], re.compile(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}'), 'Invalid scheduler quality of service')
    if 'parameters' in value:
        parameter_map(value['parameters'])
    if 'parameter_specs' in value:
        specs = parameter_specs_map(value['parameter_specs'])
        for key, item in value.get('parameters', {}).items():
            if key not in specs:
                raise ValueError('Setup parameter is not declared in parameter_specs: ' + key)
            spec = specs[key]
            if spec['required']:
                raise ValueError('Required parameter cannot declare a setup default: ' + key)
            if (not _matches_scalar(item, spec['type']) or
                    (type(item) is bool) != (type(spec['default']) is bool) or
                    item != spec['default']):
                raise ValueError('Setup default differs from declared parameter default: ' + key)
    args_for(value, test.get('parameters', {}))
    if len(json.dumps(value, ensure_ascii=False).encode()) > 192 * 1024:
        raise ValueError('Tool configuration exceeds the review budget')
    return value


def file_receipt(path, maximum=None):
    # The resolved path is saved alongside its digest, so changes to symlink
    # targets and changes to the original bytes can be distinguished.
    resolved = Path(path).resolve(strict=True)
    if not resolved.is_file():
        raise ValueError('A regular tool file is required')
    receipt = stable_file_snapshot(resolved, max_bytes=maximum)
    return {'path': str(resolved), 'sha256': receipt['sha256'], 'size': receipt['size']}
