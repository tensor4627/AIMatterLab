"""Independently attest an exact tool-group text for the fixed CPU reference subset."""
import copy
import json
import re

from studio_worker.tools.configurations import package_key, request
from studio_worker.tools.package_contract import encoded, sha, validate_tool_package


def identifier(value):
    if type(value) is not str or len(value) > 96 or not re.fullmatch(r'[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*', value): raise ValueError('Bounded tool-group identifier required')
    return value


def exact(value, allowed, required=None):
    if type(value) is not dict or set(value) - set(allowed) or set(allowed if required is None else required) - set(value): raise ValueError('Exact tool-group declaration required')


def unique(values):
    if len(values) != len(set(values)): raise ValueError('Duplicate tool-group identity')


def group_version(text):
    if type(text) is not str: raise ValueError('Exact UTF-8 group definition text required')
    try: raw = text.encode('utf-8')
    except UnicodeError as error: raise ValueError('Exact UTF-8 group definition text required') from error
    if not raw or len(raw) > 512 * 1024: raise ValueError('Group definition text must fit 512 KiB')
    return sha(b'studio.tool-group/1\0' + raw)


def inspect_group(service, value):
    request(value, ('id', 'version', 'definition_text'))
    identifier(value['id'])
    if group_version(value['definition_text']) != value['version']: raise ValueError('Exact tool-group version differs from definition text')
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result: raise ValueError('Duplicate group JSON field')
            result[key] = item
        return result
    try: definition = json.loads(value['definition_text'], object_pairs_hook=pairs)
    except (TypeError, RecursionError, json.JSONDecodeError) as error: raise ValueError('Valid bounded group JSON required') from error
    exact(definition, ('schema_version', 'id', 'name', 'inputs', 'steps', 'outputs'))
    if type(definition['schema_version']) is not int or definition['schema_version'] != 1 or definition['id'] != value['id']: raise ValueError('Group declaration identity differs')
    name = definition['name']
    if type(name) is not str or not name.strip() or len(name) > 200: raise ValueError('Bounded group name required')
    if definition['inputs'] != [] or type(definition['inputs']) is not list: raise ValueError('Only no-input fixed CPU tool groups are supported')
    if type(definition['steps']) is not list or not 1 <= len(definition['steps']) <= 128 or type(definition['outputs']) is not list or not 1 <= len(definition['outputs']) <= 128: raise ValueError('Bounded nonempty group steps/products required')
    steps = {}
    for source in definition['steps']:
        exact(source, ('id', 'tool_id', 'package_version', 'function_id', 'inputs', 'parameters', 'depends_on'), ('id', 'tool_id', 'package_version', 'function_id', 'inputs'))
        step_id = identifier(source['id']); identifier(source['tool_id']); identifier(source['function_id'])
        if step_id in steps or type(source['inputs']) is not dict or source['inputs'] or type(source.get('parameters', {})) is not dict or source.get('parameters', {}): raise ValueError('Only unique fixed no-input/no-parameter steps are supported')
        package = service.store.get('tool-package-version', package_key(source['tool_id'], source['package_version']))
        manifest = validate_tool_package(package['manifest']); parallel = manifest['environment']['parallelism']
        if manifest['id'] != source['tool_id'] or manifest['environment']['hardware'] != 'cpu' or parallel != {'supported': ['serial'], 'threads': 1, 'processes': 1, 'gpus': 0}: raise ValueError('Only serial CPU group packages are supported')
        feature = next((item for item in manifest['functions'] if item['id'] == source['function_id']), None)
        if feature is None or feature['engine'] != 'installation.check' or feature['operation']['command'] != ['{python}', '{entrypoint}'] or feature['inputs'] or feature['parameters'] or len(feature['outputs']) != 1 or feature['outputs'][0]['type'] != 'file' or feature['outputs'][0]['format'] != 'json': raise ValueError('Only fixed installation.check/worker group functions are supported')
        dependencies = source.get('depends_on', [])
        if type(dependencies) is not list: raise ValueError('Explicit step dependencies required')
        for dependency in dependencies: identifier(dependency)
        unique(dependencies)
        steps[step_id] = {'id': step_id, 'tool_id': source['tool_id'], 'package_version': source['package_version'], 'function_id': source['function_id'], 'parameters': {}, 'inputs': {}, 'depends_on': list(dependencies), 'outputs': copy.deepcopy(feature['outputs']), 'engine': feature['engine']}
    for step in steps.values():
        if step['id'] in step['depends_on'] or any(dependency not in steps for dependency in step['depends_on']): raise ValueError('Unknown or self step dependency')
    outputs = []
    for output in definition['outputs']:
        exact(output, ('id', 'step_id', 'port_id', 'required'), ('id', 'step_id', 'port_id'))
        identifier(output['id']); identifier(output['step_id']); identifier(output['port_id'])
        required = output.get('required', True)
        if type(required) is not bool: raise ValueError('Boolean final product requirement required')
        upstream = steps.get(output['step_id']); port = next((item for item in upstream['outputs'] if item['id'] == output['port_id']), None) if upstream else None
        if port is None or required and not port['required']: raise ValueError('Final product is unavailable or not guaranteed')
        outputs.append({**copy.deepcopy(output), 'required': required, 'type': port['type'], 'format': port['format']})
    unique([output['id'] for output in outputs]); order = []; active = set(); visited = set()
    def visit(key):
        if key in active: raise ValueError('Cyclic tool-group dependency')
        if key in visited: return
        active.add(key)
        for dependency in steps[key]['depends_on']: visit(dependency)
        active.remove(key); visited.add(key); order.append(key)
    for output in outputs: visit(output['step_id'])
    if len(visited) != len(steps): raise ValueError('Every step must lead to a final product')
    compiled = {'schema_version': 1, 'id': definition['id'], 'name': name.strip(), 'inputs': [], 'steps': [steps[key] for key in order], 'outputs': outputs, 'execution_order': order, 'status': 'definition_checked', 'execution_status': 'not_run'}
    return {'schema_version': 1, 'id': sha((value['id'] + '\0' + value['version']).encode()), 'group_id': value['id'], 'group_version': value['version'], 'definition_text': value['definition_text'], 'definition': definition, 'compiled': compiled}
