import sys,copy,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.derivative_selection import selection,validate_controls
class NumericalSelection(unittest.TestCase):
 def test_large_cv_group_is_preserved_and_only_bounded_force_components_are_sampled(self):
  p={'atom_selection':list(range(108))};before=copy.deepcopy(p);result=selection(p,108)
  self.assertEqual(p,before);self.assertEqual(result['declared_cv_atoms'],list(range(108)));self.assertEqual(len(result['indices']),8);self.assertEqual(result['indices'][0],0);self.assertEqual(result['indices'][-1],107);self.assertIn('not all-atom',result['source'])
 def test_explicit_numerical_subset_does_not_redefine_cv(self):
  p={'atom_selection':list(range(108)),'validation':{'atom_selection':[0,15,31,46,61,76,92,107],'fd_step':1e-5,'fd_atol':1e-4}};before=copy.deepcopy(p);result=selection(p,108)
  self.assertEqual(result['indices'],p['validation']['atom_selection']);self.assertEqual(p,before);self.assertEqual(result['structure_atoms'],108)
 def test_small_legacy_group_and_default_have_explicit_coverage(self):
  self.assertEqual(selection({'atom_selection':[3,1,3]},4)['indices'],[3,1]);self.assertEqual(selection({},3)['indices'],[0,1,2]);self.assertIn('CV group not inferred',selection({},3)['source'])
 def test_closed_technical_namespace_and_supported_routes(self):
  for value in (None,[],{'temperature':300},{'bias':{'sigma':.1}},{'atom_selection':[]},{'atom_selection':[0,0]},{'atom_selection':[True]},{'atom_selection':[1.0]},{'atom_selection':[-1]},{'atom_selection':list(range(33))},{'fd_step':0},{'fd_step':.01},{'fd_atol':float('nan')},{'fd_atol':.1}):
   with self.subTest(value=value),self.assertRaises(ValueError):validate_controls({'validation':value})
  for engine in ('gpumd.sampling','pydyn.sampling','bias.validate'):validate_controls({'validation':{'atom_selection':[0]}},engine)
  with self.assertRaises(ValueError):validate_controls({'validation':{'atom_selection':[0]}},'gpumd.md')
 def test_actual_structure_bounds_and_legacy_conflicts_fail_closed(self):
  for p in ({'atom_selection':[108]},{'atom_selection':[-1]},{'atom_selection':[True]},{'validation':{'atom_selection':[108]}},{'fd_step':1e-4,'validation':{'fd_step':1e-5}}):
   with self.subTest(p=p),self.assertRaises(ValueError):selection(p,108)
  validate_controls({'fd_step':1e-5,'validation':{'fd_step':1e-5}})
if __name__=='__main__':unittest.main()


class DeclaredCvAliases(__import__('unittest').TestCase):
 def test_nested_full_group_remains_full_with_independent_fd_sample(self):
  from studio_worker.derivative_selection import selection,cv_atoms
  full=list(range(108));parameters={'cv':{'atom_selection':full},'validation':{'atom_selection':[0,15,30,45,60,75,90,107]}}
  result=selection(parameters,108)
  self.assertEqual(result['declared_cv_atoms'],full)
  self.assertEqual(result['indices'],parameters['validation']['atom_selection'])
  self.assertEqual(cv_atoms({'atom_selection':full,'cv':{'atoms_zero_based':full}}),full)
 def test_conflicting_aliases_never_choose_one_group(self):
  from studio_worker.derivative_selection import cv_atoms
  for value in ({'atom_selection':[0,1],'cv':{'atom_selection':[0,2]}},{'cv':{'atom_selection':[0,1],'atoms_zero_based':[1,0]}}):
   with self.assertRaisesRegex(ValueError,'Conflicting'):cv_atoms(value)


class DeclaredCvAliasTypes(__import__('unittest').TestCase):
 def test_python_numeric_equality_cannot_launder_boolean_or_float_aliases(self):
  from studio_worker.derivative_selection import cv_atoms
  for value in ({'atom_selection':[1],'cv':{'atom_selection':[True]}},{'atom_selection':[0],'cv':{'atom_selection':[0.0]}},{'cv':{'atom_selection':[1.0],'atoms_zero_based':[1]}},{'cv':{'atom_selection':[]}},{'cv':{'atom_selection':'0,1'}}):
   with self.subTest(value=value),self.assertRaisesRegex(ValueError,'nonnegative integers'):cv_atoms(value)
