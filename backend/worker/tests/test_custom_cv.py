import copy,json,tempfile,unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.custom_formula import schema,module_source,parameter_values
from studio_worker.custom_cv_registry import Registry
SPEC={'name':'Selected MIC distance','formula':'s=||MIC(r_j-r_i; H)||','expression':'norm(mic(pos[atom_j]-pos[atom_i], cell))','symbols':[{'name':'r_i,r_j','meaning':'ordered selected atom coordinates','units':'Angstrom','domain':'actual structure coordinates'}],'units':'Angstrom','domain':'nonsingular row cell; away from MIC ties and zero distance','pbc':'row_mic','atom_selection':[0,1],'output_size':1,'parameters':[{'name':'atom_i','type':'integer','units':'zero-based index','description':'First ordered atom','required':True,'min':0},{'name':'atom_j','type':'integer','units':'zero-based index','description':'Second ordered atom','required':True,'min':0}],'invariances':['translation','periodic_translation'],'singularities':['zero distance; minimum-image switching boundaries']}
class FormulaData(unittest.TestCase):
 def test_actual_generator_is_deterministic_and_no_arbitrary_calls(self):
  first=module_source(SPEC);self.assertEqual(first,module_source(SPEC));self.assertIn('self._cvp_atom_j',first['source']);self.assertIn('torch.linalg.vector_norm',first['source'])
  for expr in ('__import__("os").system("echo forbidden")','pos.__class__','open("secret")','[x for x in pos]','norm(pos, cell)','mic(pos[0],cell) + unknown','getattr(pos,"x")'):
   with self.subTest(expr=expr),self.assertRaises(ValueError):schema({**SPEC,'expression':expr})
 def test_typed_values_exact_schema_missing_is_draft(self):
  self.assertEqual(parameter_values(SPEC,{'atom_i':0},False)[1],['atom_j'])
  for values in ({'atom_i':True,'atom_j':1},{'atom_i':.5,'atom_j':1},{'atom_i':0,'atom_j':-1},{'atom_i':0,'atom_j':1,'temperature':300}):
   with self.assertRaises(ValueError):parameter_values(SPEC,values)
 def test_typed_expression_blocks_plain_constants_indexes_and_wrong_rank(self):
  for expression in ('pi','5','norm(1)','pos[0.5]','pos[1,4]','stack(pos[0])','dot(pos,cell)','stack([pos[0],norm(pos[1])])'):
   with self.subTest(expression=expression),self.assertRaises(ValueError):schema({**SPEC,'expression':expression})
class PrivateLifecycle(unittest.TestCase):
 def test_formula_before_code_review_before_numbers_and_same_formula_reuse(self):
  with tempfile.TemporaryDirectory() as tmp:
   r=Registry(Path(tmp)/'private-cv');first=r.propose(SPEC,{'atom_i':0,'atom_j':1},workspace_id='current',project_id='owned');self.assertIsNone(first['code_sha256']);self.assertIsNone(first['formula_approval']);self.assertFalse(first.get('sharing'))
   self.assertEqual(r.read(first['id'],'deepseek')['sharing'],'permission_required')
   with self.assertRaisesRegex(ValueError,'Confirm'):r.approve_code(first['id'],first['expected'])
   second=r.approve_formula(first['id'],first['expected'],provider='codex',share=True);self.assertTrue(second['code_sha256']);self.assertEqual(second['numerical']['status'],'not_run');self.assertIsNone(second['code_approval']);self.assertIn('code',r.read(second['id'],'codex'))
   with self.assertRaisesRegex(ValueError,'conflict'):r.approve_code(second['id'],first['expected'])
   third=r.approve_code(second['id'],second['expected']);self.assertEqual(third['code_approval']['code_sha256'],second['code_sha256']);self.assertEqual(third['numerical']['status'],'not_run')
   changed=r.propose(SPEC,{'atom_i':1,'atom_j':0},workspace_id='current',project_id='owned',identifier=third['id'],expected=third['expected']);self.assertEqual(changed['formula_approval'],third['formula_approval']);self.assertEqual(changed['code_sha256'],third['code_sha256']);self.assertNotEqual(changed['parameters_sha256'],third['parameters_sha256']);self.assertEqual(changed['numerical']['status'],'not_run')
   revised=r.propose({**SPEC,'formula':'scaled distance','expression':'2*norm(mic(pos[atom_j]-pos[atom_i],cell))'},changed['parameter_values'],workspace_id='current',project_id='owned',identifier=changed['id'],expected=changed['expected']);self.assertIsNone(revised['formula_approval']);self.assertIsNone(revised['code_sha256']);self.assertFalse(revised.get('sharing'))
   self.assertGreaterEqual(int(r.git('rev-list','--count','HEAD').strip()),6)
 def test_foreign_conversation_and_forged_numeric_report_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   r=Registry(Path(tmp)/'private-cv');first=r.propose(SPEC,{'atom_i':0,'atom_j':1},workspace_id='current',project_id='owned')
   with self.assertRaisesRegex(ValueError,'conversation-owned'):r.propose(SPEC,first['parameter_values'],workspace_id='foreign',project_id='owned',identifier=first['id'],expected=first['expected'])
   with self.assertRaisesRegex(ValueError,'Review implementation'):r.record_numerical(first['id'],first['expected'],{'status':'passed'})
class ImmutableBoundary(unittest.TestCase):
 def test_changed_spec_or_values_cannot_be_approved_with_old_identity(self):
  for kind,key in (('specs','spec_sha256'),('values','parameters_sha256')):
   with self.subTest(kind=kind),tempfile.TemporaryDirectory()as tmp:
    r=Registry(Path(tmp)/'private-cv');item=r.propose(SPEC,{'atom_i':0,'atom_j':1},workspace_id='current',project_id='owned')
    path=r.root/kind/(item[key]+'.json');path.write_bytes(path.read_bytes()+b' ')
    with self.assertRaisesRegex(ValueError,'hash differs'):r.approve_formula(item['id'],item['expected'])
 def test_external_gitdir_and_entry_traversal_are_refused(self):
  with tempfile.TemporaryDirectory()as tmp:
   base=Path(tmp);r=Registry(base/'private-cv');item=r.propose(SPEC,{'atom_i':0,'atom_j':1},workspace_id='current',project_id='owned')
   entry=r.root/'entries'/(item['id']+'.json');raw=json.loads(entry.read_text());raw['spec_sha256']='../../outside';entry.write_text(json.dumps(raw))
   with self.assertRaisesRegex(ValueError,'identity|committed revision'):r.read(item['id'])
   external=Registry(base/'external');linked=base/'linked';linked.mkdir();(linked/'.git').write_text('gitdir: '+str(external.root/'.git')+'\n')
   before=external.git('rev-parse','HEAD')
   with self.assertRaisesRegex(ValueError,'actual Git directory'):Registry(linked)
   self.assertEqual(external.git('rev-parse','HEAD'),before)
 def test_changed_approval_object_and_code_cannot_be_reused(self):
  from studio_worker.custom_formula import sha
  for target in ('approval','source'):
   with self.subTest(target=target),tempfile.TemporaryDirectory()as tmp:
    r=Registry(Path(tmp)/'private-cv');item=r.propose(SPEC,{'atom_i':0,'atom_j':1},workspace_id='current',project_id='owned');item=r.approve_formula(item['id'],item['expected'])
    path=r.root/('approvals/'+sha(item['formula_approval'])+'.json'if target=='approval'else'sources/'+item['code_sha256']+'.py');path.write_bytes(path.read_bytes()+b' ')
    with self.assertRaisesRegex(ValueError,'hash differs'):r.approve_code(item['id'],item['expected'])
 def test_interrupted_commit_blocks_then_explicit_owned_pointer_recovery(self):
  with tempfile.TemporaryDirectory()as tmp:
   r=Registry(Path(tmp)/'private-cv');first=r.propose(SPEC,{'atom_i':0,'atom_j':1},workspace_id='current',project_id='owned');original=r.git
   def failing(*args):
    if args[0]=='commit':raise ValueError('injected local commit interruption')
    return original(*args)
   r.git=failing
   with self.assertRaisesRegex(ValueError,'interruption'):r.approve_formula(first['id'],first['expected'])
   r.git=original
   with self.assertRaisesRegex(ValueError,'Interrupted'):r.read(first['id'])
   journal=r.pending();self.assertEqual(r.recover(journal['sha256'])['recovery'],'rolled_back_pointer');self.assertEqual(r.read(first['id'])['expected'],first['expected'])
   self.assertIsNotNone(r.approve_formula(first['id'],first['expected'])['code_sha256'])

class BoundedFormula(unittest.TestCase):
 def test_dispersed_fd_scope_covers_the_same_declared_atoms(self):
  from studio_worker.custom_formula import fd_atoms,referenced_atoms
  for count in (2,8,9,16,256):
   spec={**SPEC,'expression':'mean(pos[:,0])','atom_selection':list(range(count)),'parameters':[]}
   group=referenced_atoms(spec,{},count);coverage=fd_atoms(group)
   self.assertEqual(group,list(range(count)));self.assertEqual(len(coverage),min(8,count));self.assertEqual(coverage[0],0);self.assertEqual(coverage[-1],count-1)
  with self.assertRaisesRegex(ValueError,'atom_selection'):
   referenced_atoms({**SPEC,'atom_selection':[0,1,999]}, {'atom_i':0,'atom_j':1},2)
  with self.assertRaisesRegex(ValueError,'outside'):
   referenced_atoms({**SPEC,'atom_selection':[0]}, {'atom_i':0,'atom_j':1},2)
 def test_stable_softmin_is_supported_but_unbounded_power_is_refused(self):
  spec={**SPEC,'expression':'-temperature*logsumexp(stack([-norm(mic(pos[1]-pos[0],cell))/temperature,-norm(mic(pos[2]-pos[0],cell))/temperature]))','atom_selection':[0,1,2], 'parameters':[{'name':'temperature','type':'number','units':'Angstrom','description':'Positive smoothing length','required':True,'min':0.01}]}
  source=module_source(spec)['source'];self.assertIn('torch.logsumexp',source);self.assertIn('dim=0',source)
  for expression in ('norm(pos)**100','norm(pos)**atom_i'):
   with self.assertRaisesRegex(ValueError,'power'):schema({**SPEC,'expression':expression})
 def test_value_change_resets_sharing_and_reuse_does_not_mutate_source(self):
  with tempfile.TemporaryDirectory()as tmp:
   r=Registry(Path(tmp)/'private');item=r.propose(SPEC,{'atom_i':0,'atom_j':1},workspace_id='first',project_id='owned');item=r.approve_formula(item['id'],item['expected']);item=r.approve_code(item['id'],item['expected']);item=r.share(item['id'],item['expected'],'deepseek',True)
   original=copy.deepcopy(item);cloned=r.reuse(item['id'],item['expected'],workspace_id='second',project_id='owned')
   self.assertEqual(r.read(item['id'])['expected'],original['expected']);self.assertNotEqual(cloned['id'],item['id']);self.assertFalse(cloned['sharing']);self.assertEqual(cloned['numerical']['status'],'not_run');self.assertEqual(cloned['code_approval'],original['code_approval'])
   changed=r.propose(SPEC,{'atom_i':1,'atom_j':0},workspace_id='first',project_id='owned',identifier=item['id'],expected=item['expected']);self.assertFalse(changed['sharing']);self.assertEqual(changed['numerical']['status'],'not_run')
 def test_git_executable_config_attributes_and_links_fail_before_git(self):
  for attack in ('config','attributes','hooks','alternates','symlink'):
   with self.subTest(attack=attack),tempfile.TemporaryDirectory()as tmp:
    r=Registry(Path(tmp)/'private');item=r.propose(SPEC,{'atom_i':0,'atom_j':1},workspace_id='first',project_id='owned')
    if attack=='config':
     with (r.root/'.git/config').open('a')as stream:stream.write('\n[filter "unsafe"]\n clean = forbidden-command\n')
    elif attack=='attributes':(r.root/'.gitattributes').write_text('* filter=unsafe\n')
    elif attack=='hooks':(r.root/'.empty-hooks/pre-commit').write_text('exit 0\n')
    elif attack=='alternates':(r.root/'.git/objects/info/alternates').write_text('/unrelated\n')
    else:(r.root/'.git/linked').symlink_to(r.root/'entries')
    with self.assertRaises(ValueError):r.approve_formula(item['id'],item['expected'])

if __name__=='__main__':unittest.main()
