"""Public versioned adapter parameter contracts; no engine execution.

engine_contracts.json is the generated standalone resource copied from
contracts/tools/engine-contracts.json by scripts/sync-tool-contracts.mjs.
The worker always consumes its local resource, including outside a checkout.
"""
import json
from pathlib import Path
CONTRACTS=json.loads((Path(__file__).parent.parent/'engine_contracts.json').read_text(encoding='utf-8'))


def rule(engine):
    if engine not in CONTRACTS['engines']:
        return None
    return CONTRACTS['engines'][engine]


def describe(engine):
    value=rule(engine)
    if value is None:raise ValueError('Unsupported engine')
    return {'engine':engine,'schema_version':CONTRACTS['schema_version'],'scope':CONTRACTS['scope'],**value,'runtime_validation':'not_run'}


def aimlab_tool_id(engine):
    value=rule(engine) or {}
    return value.get('aimlab_tool_id')


def repository_key(tool_id):
    return (CONTRACTS.get('aimlab_repository_keys') or {}).get(tool_id)


def declaration_tokens(engine):
    value=rule(engine) or {}
    return [str(item) for item in value.get('declaration_tokens') or []]


def transform_parameters(engine, parameters):
    """Apply the declared public-semantics transforms before binding a production argv.

    Only explicit, reviewed transforms are applied; unknown values are rejected instead of
    being passed through silently. The original mapping is never mutated.
    """
    result=dict(parameters or {})
    value=rule(engine) or {}
    for name, mapping in (value.get('parameter_transforms') or {}).items():
        if name not in result or result[name] is None:
            continue
        selected=result[name]
        if selected not in mapping:
            raise ValueError('Unsupported '+engine+' parameter '+name+': '+str(selected))
        result[name]=mapping[selected]
    return result
