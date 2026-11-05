import sys, unittest, copy
from pathlib import Path
from unittest.mock import patch
from subprocess import CompletedProcess
ROOT=Path.cwd()
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'backend/worker'))
import studio_worker
studio_worker.__path__.insert(0,str(Path(__file__).resolve().parents[1]/'studio_worker'))
from studio_worker.adapters import Adapter
from studio_worker.derivative_selection import validate_controls
ROUTES=('bias.validate','gpumd.sampling','pydyn.sampling')
ENV={'executables':{'python':sys.executable,'gpu-sampling':sys.executable}}
def spec(engine='bias.validate',mode='opes',**controls):
 return {'engine':engine,'gpu':0,'inputs':{n:'/fixture/'+n for n in ['bias.pt','model.xyz','run.py','run.in','GAScfg.yaml']},'parameters':{'bias_file':'bias.pt','structure_file':'model.xyz','mode':mode,'cv_size':1,'cutoff':3,'atom_selection':list(range(32)),'cv':{'atom_selection':list(range(32))},**controls}}
class OpesNumericalContract(unittest.TestCase):
 def test_prepare_and_validate_reject_every_explicit_namespace_before_any_runtime(self):
  for engine in ROUTES:
   for controls in ({'validation':{'atom_selection':list(range(32)),'fd_step':1e-5,'fd_atol':1e-8}},{'validation':{}},{'fd_step':1e-5},{'fd_atol':1e-8},{'validation':None}):
    with self.subTest(engine=engine,controls=controls):
     a=Adapter(engine);s=spec(engine,**controls)
     with patch.object(a,'runtime_check',side_effect=AssertionError('runtime forbidden')),patch('studio_worker.adapters.subprocess.run',side_effect=AssertionError('process forbidden')):
      with self.assertRaisesRegex(ValueError,'OPES stateful finite-difference validation is not implemented'):a.prepare(s,ENV)
      with self.assertRaisesRegex(ValueError,'OPES stateful finite-difference validation is not implemented'):a.validate(s,ENV,ROOT)
 def test_no_fd_opes_prepares_all_routes_and_preserves_cv_atoms(self):
  for engine in ROUTES:
   a=Adapter(engine);s=spec(engine);before=copy.deepcopy(s)
   with patch.object(a,'bias_command',return_value=['serialized-abi-fixture']):self.assertTrue(a.prepare(s,ENV))
   self.assertEqual(s,before);validate_controls(s['parameters'],engine)
 def test_actual_adapter_report_marks_derivatives_not_run_for_all_routes(self):
  for engine in ROUTES:
   a=Adapter(engine);s=spec(engine);probe={'scope':{'engine':engine},'executable':sys.executable,'pydyn_sampling':True}
   with patch.object(a,'runtime_check',return_value={'status':'not_run'}),patch.object(a,'input_contract'),patch.object(a,'bias_command',return_value=['serialized-abi-fixture']),patch('studio_worker.adapters.subprocess.run',return_value=CompletedProcess([],0,'fixture ABI/state success','')),patch('studio_worker.adapters.run_json',side_effect=AssertionError('FD must not run')) as fd,patch('studio_worker.science_checks.check_gascfg'):
    result=a.validate(s,ENV,ROOT,probe_report=probe)
   self.assertEqual(result['status'],'passed');self.assertEqual(result['artifact_status'],'passed');self.assertEqual(result['scientific_status'],'not_run');self.assertEqual(result['derivatives']['status'],'not_run');self.assertIn('not implemented',result['derivatives']['reason']);self.assertNotIn('sampled finite differences',result['scope']);self.assertIn('finite differences not_run',result['scope']);fd.assert_not_called()
 def test_metad_controls_still_reach_actual_derivative_path(self):
  p={'validation':{'atom_selection':[0,1],'fd_step':1e-5,'fd_atol':1e-8},'fd_step':1e-5,'fd_atol':1e-8}
  for engine in ROUTES:validate_controls(spec(engine,'metad',**p)['parameters'],engine)
  a=Adapter('bias.validate');s=spec(mode='metad',**p)
  with patch.object(a,'bias_command',return_value=['serialized-abi-fixture']),patch('studio_worker.adapters.subprocess.run',return_value=CompletedProcess([],0,'fixture','')),patch('studio_worker.adapters.run_json',return_value={'status':'passed','fixture':True}) as fd:
   result=a.validate(s,ENV,ROOT)
  self.assertEqual(result['derivatives'],{'status':'passed','fixture':True});self.assertEqual(fd.call_args.args[3]['validation'],p['validation']);self.assertEqual(fd.call_args.args[3]['atom_selection'],list(range(32)));self.assertIn('sampled finite differences',result['scope'])
if __name__=='__main__':unittest.main(verbosity=2)
