"""Public versioned adapter parameter contracts; no engine execution."""
import json
from pathlib import Path
CONTRACTS=json.loads(Path(__file__).with_name('engine_contracts.json').read_text(encoding='utf-8'))
def describe(engine):
 if engine not in CONTRACTS['engines']:raise ValueError('Unsupported engine')
 return {'engine':engine,'schema_version':CONTRACTS['schema_version'],'scope':CONTRACTS['scope'],**CONTRACTS['engines'][engine],'runtime_validation':'not_run'}
