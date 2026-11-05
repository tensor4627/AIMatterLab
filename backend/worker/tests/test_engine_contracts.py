import ast,json,tempfile,unittest
from pathlib import Path
from studio_worker.engine_contracts import describe,CONTRACTS
from studio_worker.adapters import ENGINES
from studio_worker.server import dispatch,tools
from studio_worker.service import Service
class EngineContracts(unittest.TestCase):
 def test_generated_worker_resource_matches_the_canonical_contract(self):
  worker=Path(__file__).resolve().parents[1]
  canonical=worker.parent.parent/'contracts/tools/engine-contracts.json'
  self.assertEqual((worker/'studio_worker/engine_contracts.json').read_bytes(),canonical.read_bytes())
  self.assertEqual(CONTRACTS,json.loads(canonical.read_text(encoding='utf-8')))

 def test_public_contracts_cover_every_registered_engine_and_actual_required_calls(self):
  self.assertEqual(set(CONTRACTS['engines']),set(ENGINES))
  for engine in ENGINES:self.assertEqual(describe(engine)['runtime_validation'],'not_run')
  # Required keys remain aligned with the concrete Adapter.prepare branch calls.
  source=(Path(__file__).parents[1]/'studio_worker/tools/adapters.py').read_text()
  for node in ast.walk(ast.parse(source)):
   if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='parameters' and len(node.args)>1 and isinstance(node.args[1],ast.Tuple):
    keys=set(ast.literal_eval(node.args[1]));self.assertTrue(any(keys==set(c['required_parameters']) for c in CONTRACTS['engines'].values()),keys)
 def test_mcp_discovery_is_read_only_and_cannot_grant_an_environment(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=Service(Path(tmp),schedule=False)
   try:
    value=dispatch(s,'POST','/api/engine/describe',{'engine':'pydyn.sampling'},admin=False);self.assertEqual(value['required_parameters'],['bias_file','structure_file','cv_size','cutoff','mode']);self.assertEqual(s.store.list('project'),[])
    tool=next(t for t in tools() if t['name']=='describe_engine');self.assertTrue(tool['annotations']['readOnlyHint'])
   finally:s.close();s.store.db.close()

 def test_neb_declared_keys_match_the_real_input_checker(self):
  source=(Path(__file__).parents[1]/'studio_worker/tools/neb_checks.py').read_text();tree=ast.parse(source);keys=set()
  for node in ast.walk(tree):
   if isinstance(node,ast.Assign):
    if any(isinstance(target,ast.Name) and target.id=='actual' for target in node.targets) and isinstance(node.value,ast.Dict):keys.update(k.value for k in node.value.keys)
    for target in node.targets:
     if isinstance(target,ast.Subscript) and isinstance(target.value,ast.Name) and target.value.id=='actual' and isinstance(target.slice,ast.Constant):keys.add(target.slice.value)
  self.assertEqual(keys,set(describe('gpumd.neb')['parameter_groups']['neb']['allowed_keys']))
