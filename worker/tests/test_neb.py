import importlib.util
import tempfile
import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.adapters import Adapter
from studio_worker.neb_checks import contract, validate
from studio_worker.scientific import probe_modules

XYZ='2\nLattice="10 0 0 0 10 0 0 0 10" Properties=species:S:1:pos:R:3 pbc="T T T"\nC 0 0 0\nC 1.5 0 0\n'
class NativeNEB(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  for n in ['is.xyz','fs.xyz']:(self.root/n).write_text(XYZ)
  (self.root/'nep.txt').write_text('nep4 1 C\n')
  self.inputs={n:str(self.root/n) for n in ['run.in','is.xyz','fs.xyz','nep.txt']}
  self.write('potential ./nep.txt\nneb_set interpolate 5 p 30 no_ina\nneb_run fire 0.01 1000\n')
 def write(self,s): (self.root/'run.in').write_text(s)
 def test_native_route_needs_no_model_xyz_or_bias(self):
  env={'executables':{'gpu-sampling':sys.executable}}
  self.assertEqual(Adapter('gpumd.neb').prepare({'inputs':self.inputs,'parameters':{}},env),[sys.executable])
  self.assertEqual(probe_modules('gpumd.neb'),('torch','ase'))
 def test_selected_bias_is_not_silently_ignored(self):
  with self.assertRaisesRegex(ValueError,'not a bias'):
   Adapter('gpumd.neb').prepare({'inputs':self.inputs,'parameters':{'bias_file':'explicit.pt2'}},{})
 def test_native_settings_and_declared_controls(self):
  r=contract(self.root,self.inputs,{'max_steps':1000,'force_tolerance':0.01,'cell_mode':'variable','pressure_gpa':30,'interpolate':5,'ina':False})
  self.assertEqual(r['structure_files'],['is.xyz','fs.xyz']);self.assertEqual(r['potential_files'],['nep.txt'])
 def test_parameter_change_requires_matching_actual_input(self):
  with self.assertRaisesRegex(ValueError,'differs from run.in'):contract(self.root,self.inputs,{'max_steps':100})
 def test_explicit_fixed_cell(self):
  self.write('potential nep.txt\nneb_set no_vc interpolate 3\nneb_run fire 0.02 5\n')
  self.assertEqual(contract(self.root,self.inputs)['cell_mode'],'fixed')
 def test_duplicate_native_run_and_md_mix_rejected(self):
  original=(self.root/'run.in').read_text()
  for extra in ['run 5\n','minimize fire 0.1 5\n','neb_run fire 0.01 10\n']:
   self.write(original+extra)
   with self.assertRaisesRegex(ValueError,'exactly one'):contract(self.root,self.inputs)
 def test_external_and_unsnapshotted_references_rejected(self):
  for name in ['/tmp/is.xyz','../is.xyz','missing.xyz']:
   self.write('potential nep.txt\nneb_set is_name '+name+'\nneb_run fire 0.01 10\n')
   with self.assertRaises(ValueError):contract(self.root,self.inputs)
 def test_missing_default_endpoint_rejected(self):
  self.inputs.pop('fs.xyz')
  with self.assertRaisesRegex(ValueError,'not snapshotted'):contract(self.root,self.inputs)
 def test_nonfinite_and_unsupported_optimizer_rejected(self):
  for args in ['fire nan 10','fire 0 10','fire 0.01 0','lbfgs 0.01 10']:
   self.write('potential nep.txt\nneb_run '+args+'\n')
   with self.assertRaises(ValueError):contract(self.root,self.inputs)
 def test_no_binary_format_substitution(self):
  self.write('potential nep.txt\noutput_format zbxyz precision lossless\nneb_run fire 0.01 10\n')
  with self.assertRaisesRegex(ValueError,'binary paths'):contract(self.root,self.inputs)
 @unittest.skipUnless(importlib.util.find_spec('ase'),'ASE geometry checks run separately in registered runtime')
 def test_real_xyz_geometry_and_species_gate(self):
  payload={'directory':str(self.root),'inputs':list(self.inputs)}
  r=validate(payload);self.assertEqual(r['n_atoms'],2);self.assertEqual(r['scientific_status'],'not_run')
  (self.root/'fs.xyz').write_text(XYZ.replace('C 1.5','Si 1.5'))
  with self.assertRaisesRegex(ValueError,'element order'):validate(payload)
 @unittest.skipUnless(importlib.util.find_spec('ase'),'ASE geometry checks run separately in registered runtime')
 def test_mismatched_cell_and_potential_species(self):
  self.write('potential nep.txt\n# match_cell_to_initial is only a comment\nneb_set no_vc interpolate 3\nneb_run fire 0.01 10\n')
  (self.root/'fs.xyz').write_text(XYZ.replace('10 0 0','11 0 0',1))
  with self.assertRaisesRegex(ValueError,'matching cells'):validate({'directory':str(self.root),'inputs':list(self.inputs)})
  (self.root/'fs.xyz').write_text(XYZ);(self.root/'nep.txt').write_text('nep4 1 Si\n')
  with self.assertRaisesRegex(ValueError,'species'):validate({'directory':str(self.root),'inputs':list(self.inputs)})
