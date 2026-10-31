"""Real public source bytes, read as AST only; synthetic identity/authorization fixtures."""
import ast, builtins, copy, hashlib, json, shutil, textwrap, unittest
from pathlib import Path
from unittest.mock import patch
from studio_worker import environment_api as api, runtime_guides as guides
import test_environment_api as fixtures

NEW_IDS = (
 'pydyn/dynamics/ensembles/verlet.py::VelocityVerlet.__init__',
 'pydyn/dynamics/initializer.py::MaxwellBoltzmannDistribution.__init__',
 'pydyn/dynamics/initializer.py::MaxwellBoltzmannDistribution.initialize',
 'pydyn/neighbors/cuda_neighbor.py::CudaNeighborList.__init__',
 'pydyn/forces/evaluator.py::ForceEvaluator.from_model',
 'pydyn/observers.py::Observer.__init__',
 'pydyn/observers.py::Observer.__call__',
 'pydyn/observers.py::TableLogger.__init__',
 'pydyn/observers.py::TableLogger.initialize',
 'pydyn/observers.py::TableLogger.observe',
 'pydyn/observers.py::TrajectoryWriter.__init__',
 'pydyn/observers.py::TrajectoryWriter.observe',
 'pydyn/context.py::SimulationContext.resolve',
 'pydyn/context.py::SimulationContext.get_temperature',
 'pydyn/context.py::ResolvedSimulationContext.get_temperature',
 'pydyn/dynamics/ensembles/base.py::Ensemble.step',
 'pydyn/neighbors/cuda_neighbor.py::CudaNeighborList.find_neighbor',
)

class PublicDriverContract(unittest.TestCase):
 def setUp(self):
  self.harness=fixtures.Tests(methodName='runTest');self.harness.setUp();self.addCleanup(self.harness.doCleanups)
  self.fixture=Path(__file__).parent/'fixtures/pydyn_sampling_public_minimal'
  self.manifest=json.loads((self.fixture/'contracts.json').read_text(encoding='utf8'))
  for record in self.manifest['files']:
   raw=record['source_utf8'].encode()
   self.assertEqual(hashlib.sha256(raw).hexdigest(),record['sha256'])
   target=self.harness.repo/record['name'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
  self.harness.record()
 def read(self,**extra):return self.harness.read(**extra)
 def test_minimum_driver_construction_is_actually_advertised(self):
  index={row['symbol_id']for row in self.read()['api']}
  self.assertFalse(set(NEW_IDS)-index,'Missing current public driver contracts: '+repr(sorted(set(NEW_IDS)-index)))
 def test_every_new_excerpt_is_exact_observed_source_without_import_or_evaluation(self):
  real_import=builtins.__import__
  def guarded(name,*args,**kwargs):
   if name.split('.')[0]in ('pydyn','torch','cupy','ase','base'):raise AssertionError('Target module import forbidden')
   return real_import(name,*args,**kwargs)
  for offset in range(0,len(NEW_IDS),4):
   with patch.object(builtins,'__import__',side_effect=guarded),patch.object(builtins,'eval',side_effect=AssertionError('eval forbidden')):
    result=self.read(api_symbols=list(NEW_IDS[offset:offset+4]))
   self.assertLessEqual(result['api_excerpts']['bytes'],16384)
   self.assertEqual(result['api_excerpts']['evaluation'],'not_evaluated')
   for entry in result['api_excerpts']['symbols']:
    source=(self.harness.repo/entry['source']['name']).read_bytes().decode()
    exact=''.join(source.splitlines(keepends=True)[entry['source']['line']-1:entry['source']['end_line']])
    self.assertEqual(entry['code'],exact)
    self.assertEqual(hashlib.sha256(exact.encode()).hexdigest(),entry['excerpt_sha256'])
    self.assertEqual(entry['excerpt_sha256'],self.manifest['contracts'][entry['symbol_id']]['excerpt_sha256'])
 def test_existing_observed_receipt_covers_new_files_without_probe_or_record(self):
  before=guides.RuntimeGuides(self.harness.root/'runtime-guides').read(self.harness.env,'pydyn.sampling')
  with patch.object(guides.RuntimeGuides,'record',side_effect=AssertionError('Automatic record forbidden')):
   result=self.read(api_symbols=list(NEW_IDS[:4]))
  after=guides.RuntimeGuides(self.harness.root/'runtime-guides').read(self.harness.env,'pydyn.sampling')
  self.assertEqual(before,after);self.assertEqual(result['observed_receipt_sha256'],before['receipt'])
 def test_missing_new_file_observation_is_not_filled_from_current_source(self):
  receipt=guides.RuntimeGuides(self.harness.root/'runtime-guides').read(self.harness.env,'pydyn.sampling')
  receipt['facts']['file_observations']=[r for r in receipt['facts']['file_observations']if not r['path'].replace('\\','/').endswith('/pydyn/observers.py')]
  with patch.object(api.RuntimeGuides,'read',return_value=receipt):self.harness.error('api_source_observation_missing',self.read)
 def test_changed_new_source_refuses_old_receipt(self):
  file=self.harness.repo/'pydyn/dynamics/initializer.py';file.write_bytes(file.read_bytes()+b'\n# changed\n')
  self.harness.error('observed_runtime_required',self.read)
 def test_unadvertised_neighbor_internals_and_loader_still_rejected(self):
  for symbol in ['pydyn/neighbors/cuda_neighbor.py::CudaNeighborList._search_once','pydyn/forces/evaluator.py::ForceRegistry.from_model','pydyn/forces/ml.py::TorchMLForceModel.load_torchscript_model']:
   self.harness.error('unsupported_symbol',lambda:self.read(api_symbols=[symbol]))
 def test_fixed_real_index_remains_within_original_32k_budget(self):
  result=self.read();self.assertEqual(len(result['files']),17);self.assertEqual(len(result['api']),67)
  self.assertLessEqual(len(json.dumps(result,ensure_ascii=False).encode()),32768)
  self.assertEqual(result['limits'],{'max_symbols':4,'max_excerpt_utf8_bytes':16384,'partial':True})
 def test_new_contract_still_rejects_five_and_oversize_selections(self):
  self.harness.error('invalid_input',lambda:self.read(api_symbols=list(NEW_IDS[:5])))
  file=self.harness.repo/'pydyn/observers.py';file.write_text('class Observer:\n    def __call__(self,sim):\n'+''.join('        # '+('x'*200)+'\n'for _ in range(90))+'        return None\n')
  self.harness.record();self.harness.error('excerpt_budget',lambda:self.read(api_symbols=['pydyn/observers.py::Observer.__call__']))
 def test_initializer_exposes_rng_semantics_without_inventing_seed_argument(self):
  result=self.read(api_symbols=[NEW_IDS[1],NEW_IDS[2]])['api_excerpts']['symbols']
  constructor=ast.parse(textwrap.dedent(result[0]['code'].replace('\r\n','\n'))).body[0]
  self.assertEqual([arg.arg for arg in constructor.args.args],['self','target_temp'])
  self.assertIn('cp.random.standard_normal',result[1]['code']);self.assertIn('Constants.kB',result[1]['code'])
 def test_logger_distinguishes_wall_clock_from_scientific_time_and_interval(self):
  ids=['pydyn/observers.py::TableLogger.initialize','pydyn/observers.py::TableLogger.observe','pydyn/observers.py::Observer.__call__','pydyn/observers.py::Observer.__init__']
  codes={row['symbol_id']:row['code']for row in self.read(api_symbols=ids)['api_excerpts']['symbols']}
  self.assertIn('datetime.now()',codes[ids[1]]);self.assertIn('sim.step_count',codes[ids[1]])
  self.assertIn('sim.step_count % self.interval',codes[ids[2]]);self.assertIn('positive integer',codes[ids[3]])
 def test_only_optional_low_level_reads_are_labeled_source_integration_contracts(self):
  result=self.read(api_symbols=list(NEW_IDS[-2:]))
  self.assertTrue(all(row['kind']=='integration_contract'for row in result['api_excerpts']['symbols']))
  self.assertIn('not',result['scope']);self.assertIn('runtime',result['scope'])
 def test_published_existing_sampling_fields_and_dtype_stay_honest(self):
  ids=['pydyn/sampling/runtime.py::SamplingConfig','pydyn/forces/ml.py::TorchMLForceModel.model_dtype','pydyn/forces/ml.py::TorchMLForceModel.result_dtype','pydyn/forces/hotpp_force.py::MiaoForceModel.build_input']
  items=self.read(api_symbols=ids)['api_excerpts']['symbols'];fields={r['name']:r for r in items[0]['fields']}
  self.assertEqual(fields['history_capacity']['default_expression'],'2');self.assertEqual(fields['kernel_capacity']['default_expression'],'2')
  self.assertEqual(items[1]['expression'],'torch.float32');self.assertEqual(items[2]['expression'],'cp.float64')
  self.assertIn('dtype=torch.float32',items[3]['code']);self.assertIn('dtype=torch.long',items[3]['code'])

if __name__=='__main__':unittest.main()
