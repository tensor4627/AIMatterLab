import copy,hashlib,json,sys,tempfile,unittest,uuid
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.service import Service
from studio_worker.custom_cv_service import CustomCvService
from studio_worker.custom_cv_catalog import checked_entry
from studio_worker.custom_formula import stable,sha
from test_custom_cv import SPEC

class ReferenceAndAttemptScope(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve();self.service=Service(self.root/'worker',schedule=False);self.addCleanup(self.close)
  self.environment=self.service.register_environment({'id':'registered','name':'Scope unit fixture','executables':{'python':sys.executable}})
  self.project=self.service.register_project({'id':'owned','name':'Scope unit fixture','policy':{'input_roots':[str(self.root/'inputs')],'environments':['registered']}})
  self.cv=CustomCvService(self.service);self.directory=self.service.root/'projects/owned/inputs/cv-conversation';self.directory.mkdir(parents=True);self.structure=self.directory/'model.xyz';self.structure.write_bytes(b'unit geometry content - scientific.py mocked only in scope tests')
  self.item=self.cv.library.propose(SPEC,{'atom_i':0,'atom_j':1},workspace_id='conversation',project_id='owned');self.item=self.cv.library.approve_formula(self.item['id'],self.item['expected']);self.item=self.cv.library.approve_code(self.item['id'],self.item['expected'])
  self.ctx={'project':self.project,'environment':self.environment,'source':{'id':'pygas'},'root':self.directory.parent,'directory':self.directory,'workspace':'conversation','structure':{'id':'selected-'+hashlib.sha256(self.structure.read_bytes()).hexdigest(),'path':str(self.structure),'name':self.structure.name,'sha256':hashlib.sha256(self.structure.read_bytes()).hexdigest()},'runtime':{'status':'observed','receipt':'f'*64,'facts':{'python':{'executable':sys.executable,'registration_match':True}}}}
  self.data={'id':self.item['id'],'expected':self.item['expected'],'workspace_id':'conversation','project_id':'owned','environment_id':'registered'}
 def close(self):self.service.close();self.service.store.db.close()
 def reference(self,**changes):
  value={'schema_version':1,'kind':'independent_cv_reference','cv':[1.25],'spec_sha256':self.item['spec_sha256'],'parameters_sha256':self.item['parameters_sha256'],'structure_sha256':self.ctx['structure']['sha256'],'provenance':{'kind':'declared_independent_method','method':'Separately declared independent reference geometry method'}};value.update(changes)
  path=self.directory/'oracle.cv-reference.json';path.write_bytes(stable(value));self.service.store.put('artifact',{'id':'reference','project_id':'owned','name':path.name,'path':str(path),'kind':'reference','sha256':hashlib.sha256(path.read_bytes()).hexdigest()});return path
 def test_exact_external_values_parameters_and_honest_method_are_bound(self):
  self.reference();value=self.cv.independent(self.ctx,{'reference_asset_id':'reference'},self.item);self.assertEqual(value['cv'],[1.25]);self.assertEqual(value['provenance']['kind'],'declared_independent_method');self.assertEqual(value['provenance']['parameters_sha256'],self.item['parameters_sha256']);self.assertNotIn('human_supplied',value['provenance'])
  for change in ({'parameters_sha256':'0'*64},{'structure_sha256':'0'*64},{'spec_sha256':'0'*64},{'cv':[float('inf')]},{'provenance':{'kind':'human_supplied','method':'unverified assertion'}}):
   with self.subTest(change=change):
    # Write finite canonical fixture manually only for the nonfinite negative.
    if change.get('cv')==[float('inf')]:
     path=self.directory/'oracle.cv-reference.json';path.write_text(json.dumps({'schema_version':1,'kind':'independent_cv_reference','cv':[float('inf')],'spec_sha256':self.item['spec_sha256'],'parameters_sha256':self.item['parameters_sha256'],'structure_sha256':self.ctx['structure']['sha256'],'provenance':{'kind':'declared_independent_method','method':'Separate reference'}}));self.service.store.put('artifact',{'id':'reference','project_id':'owned','name':path.name,'path':str(path),'kind':'reference','sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    else:self.reference(**change)
    with self.assertRaises(ValueError):self.cv.independent(self.ctx,{'reference_asset_id':'reference'},self.item)
 def test_external_scope_keeps_values_and_parameter_hash_without_calling_it_human_supplied(self):
  self.reference()
  with patch('studio_worker.util.run_json',return_value={'n_atoms':2,'cell':[[5,0,0],[0,5,0],[0,0,5]],'pbc':[True]*3}):scope=self.cv.scope(self.ctx,{'reference_asset_id':'reference'},self.item)
  self.assertEqual(scope['reference_kind'],'external-declared');self.assertEqual(scope['reference']['cv'],[1.25]);self.assertEqual(scope['bindings']['parameters_sha256'],self.item['parameters_sha256']);self.assertEqual(scope['fd_atom_indices'],[1,0]);self.assertEqual(scope['sha256'],sha({k:v for k,v in scope.items()if k!='sha256'}))
 def test_reference_file_change_and_forged_runtime_are_refused(self):
  path=self.reference();path.write_bytes(path.read_bytes()+b' ')
  with self.assertRaisesRegex(ValueError,'changed'):self.cv.independent(self.ctx,{'reference_asset_id':'reference'},self.item)
  self.ctx['runtime']['facts']['python']['executable']='/different/python'
  with patch('studio_worker.util.run_json',return_value={'n_atoms':2}),self.assertRaisesRegex(ValueError,'interpreter'):self.cv.scope(self.ctx,{},self.item)
 def test_active_and_unknown_attempts_never_launch_a_new_uuid(self):
  for state in ('launching','running','unknown'):
   with self.subTest(state=state):
    self.service.store.put('custom-cv-attempt',{'id':'already','entry_id':self.item['id'],'workspace_id':'conversation','status':state})
    with patch.object(self.cv,'context',return_value=self.ctx),patch.object(self.cv,'status',return_value={'status':state}),patch.object(self.cv,'scope',side_effect=AssertionError('unknown attempt reached a new numerical scope'))as next_scope,self.assertRaisesRegex(ValueError,'running or unknown'):
     self.cv.validate({**self.data,'human_action_id':str(uuid.uuid4())})
    next_scope.assert_not_called()
 def test_nested_success_cannot_override_a_blocked_overall_receipt(self):
  item=copy.deepcopy(self.item);item['numerical']={'status':'blocked','reusable_primitive':{'status':'passed'},'numerical_self_consistency':{'status':'passed'},'independent_reference':{'status':'passed'}}
  with self.assertRaisesRegex(ValueError,'current passed'):checked_entry(item)

class CurrentStructureSelection(unittest.TestCase):
 setUp=ReferenceAndAttemptScope.setUp
 close=ReferenceAndAttemptScope.close
 def asset(self,path=None,kind='structure',project='owned',identifier='structure'):
  path=path or self.structure;self.service.store.put('artifact',{'id':identifier,'project_id':project,'name':path.name,'path':str(path),'kind':kind,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()});return str(path)
 def actual_context(self,files,**extra):
  with patch('studio_worker.pygas_composition.context',return_value=(self.project,self.environment,{'id':'pygas'},self.directory.parent)),patch.object(self.service,'read_runtime_guide',return_value=self.ctx['runtime']):return self.cv.context({**self.data,'files':files,**extra})
 def test_unique_selected_registered_structure_binds_without_hidden_alias_and_rehashes(self):
  selected=self.asset();first=self.actual_context([selected]);self.assertEqual(first['structure']['path'],selected);self.assertEqual(first['structure']['sha256'],hashlib.sha256(self.structure.read_bytes()).hexdigest());self.structure.write_bytes(b'new selected structure bytes, no numerical or scientific assertion');second=self.actual_context([selected]);self.assertNotEqual(first['structure']['sha256'],second['structure']['sha256']);self.assertNotEqual(first['structure']['id'],second['structure']['id'])
 def test_repeated_identical_path_and_duplicate_asset_metadata_are_one_structure(self):
  selected=self.asset();self.asset(identifier='duplicate');self.assertEqual(self.actual_context([selected,selected])['structure']['path'],selected)
 def test_multiple_distinct_selected_structures_including_equal_basenames_are_ambiguous(self):
  first=self.asset();other=self.directory/'other'/self.structure.name;other.parent.mkdir();other.write_bytes(b'other fixture');second=self.asset(other,identifier='second')
  with self.assertRaisesRegex(ValueError,'Several selected structure'):self.actual_context([first,second])
 def test_unselected_unregistered_nonstructure_or_foreign_project_cannot_be_inferred(self):
  selected=self.asset();self.assertIsNone(self.actual_context([])['structure']);self.assertIsNone(self.actual_context([self.structure.name])['structure']);self.service.store.put('artifact',{'id':'structure','project_id':'foreign','name':self.structure.name,'path':selected,'kind':'structure'});self.assertIsNone(self.actual_context([selected])['structure']);self.asset(kind='input');self.assertIsNone(self.actual_context([selected])['structure']);self.assertIsNone(self.actual_context([str(self.directory/'absent.xyz')])['structure'])
 def test_explicit_structure_stays_authoritative_over_other_selected_assets(self):
  first=self.asset();other=self.directory/'second.xyz';other.write_bytes(b'other fixture');second=self.asset(other,identifier='second');self.assertEqual(self.actual_context([first,second],structure_path=second)['structure']['path'],second)
 def test_fallback_rejects_malformed_or_unbounded_current_file_lists(self):
  self.asset()
  for invalid in (None,{},str(self.structure),[1],[''],['/owned/line\npath'],['/owned/file']*257):
   with self.subTest(value=repr(invalid)[:80]),self.assertRaisesRegex(ValueError,'bounded list'):self.actual_context(invalid)

if __name__=='__main__':unittest.main()
