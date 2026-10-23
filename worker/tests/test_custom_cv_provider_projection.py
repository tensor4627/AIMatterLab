"""Provider projection is a definition-only grant, not the desktop admin record."""
import copy,json,sys,tempfile,threading,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.custom_cv_service import CustomCvService
from studio_worker.custom_cv_registry import Registry
from test_custom_cv import SPEC

IDENTITY=('spec_sha256','code_sha256','parameters_sha256','revision')
BODY={'id','workspace_id','project_id',*IDENTITY,'expected','spec','parameter_values','code'}
class CurrentDefinitionProjection(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.cv=CustomCvService.__new__(CustomCvService);self.cv.lock=threading.RLock();self.cv.library=Registry(Path(self.temp.name).resolve()/'private')
  self.ctx={'project':{'id':'owned'},'workspace':'conversation'};self.cv.context=lambda data:self.ctx
  self.item=self.cv.library.propose(SPEC,{'atom_i':0,'atom_j':1},workspace_id='conversation',project_id='owned')
  self.item=self.cv.library.approve_formula(self.item['id'],self.item['expected']);self.item=self.cv.library.approve_code(self.item['id'],self.item['expected']);self.item=self.cv.library.share(self.item['id'],self.item['expected'],'codex',True)
  self.data={'id':self.item['id'],'provider':'codex'}
 def test_serialized_body_is_exact_current_definition_allowlist_not_admin_record(self):
  seeded=copy.deepcopy(self.item);forbidden=['numerical','results','result','report','reports','formula_approval','code_approval','git_commit','runtime','structure','library_review','library_history','history','approvals','reuse_of','updated_at','created_at','numerical_receipt_sha256','class_name','future_unknown_field']
  for key in forbidden:seeded[key]={'unexpected_private_marker':'private-'+key}
  seeded['expected']['unexpected_result']='private-expected-extra'
  with patch.object(self.cv,'owned',return_value=seeded):result=self.cv.provider_status(self.data,body=True)
  self.assertEqual(set(result),{'status','allowed','id','expected','entry'});self.assertEqual(set(result['entry']),BODY)
  self.assertEqual(result['entry']['spec'],self.item['spec']);self.assertEqual(result['entry']['parameter_values'],self.item['parameter_values']);self.assertEqual(result['entry']['code'],self.item['code'])
  exact={key:self.item[key]for key in IDENTITY};self.assertEqual(result['expected'],exact);self.assertEqual(result['entry']['expected'],exact)
  raw=json.dumps(result,sort_keys=True)
  for key in forbidden:self.assertNotIn('private-'+key,raw);self.assertNotIn('private-expected-extra',raw)
  self.assertEqual(self.cv.library.read(self.item['id'])['numerical'],self.item['numerical'])
 def test_status_without_body_never_returns_a_definition_or_admin_fields(self):
  result=self.cv.provider_status(self.data);self.assertEqual(set(result),{'status','allowed','id','expected'});self.assertEqual(result['expected'],{key:self.item[key]for key in IDENTITY})
 def test_revocation_and_value_version_change_block_until_new_exact_consent(self):
  first=self.cv.provider_status(self.data,body=True);self.item=self.cv.library.share(self.item['id'],self.item['expected'],'codex',False)
  self.assertEqual(self.cv.provider_status(self.data,body=True)['allowed'],False);self.assertNotIn('entry',self.cv.provider_status(self.data,body=True))
  self.item=self.cv.library.share(self.item['id'],self.item['expected'],'codex',True);self.item=self.cv.library.propose(SPEC,{'atom_i':1,'atom_j':0},workspace_id='conversation',project_id='owned',identifier=self.item['id'],expected=self.item['expected'])
  denied=self.cv.provider_status(self.data,body=True);self.assertFalse(denied['allowed']);self.assertNotIn('entry',denied)
  self.item=self.cv.library.share(self.item['id'],self.item['expected'],'codex',True);current=self.cv.provider_status(self.data,body=True)
  self.assertNotEqual(current['expected']['parameters_sha256'],first['expected']['parameters_sha256']);self.assertEqual(current['entry']['parameter_values'],{'atom_i':1,'atom_j':0});self.assertNotIn('history',current['entry'])
 def test_grant_is_not_inherited_by_other_providers_or_foreign_owner(self):
  for provider in ('kimi','qwen','deepseek'):
   result=self.cv.provider_status({**self.data,'provider':provider},body=True);self.assertFalse(result['allowed']);self.assertNotIn('entry',result)
  with self.assertRaises(PermissionError):self.cv.provider_status({**self.data,'provider':'unknown'},body=True)
  for ctx in ({'project':{'id':'other'},'workspace':'conversation'},{'project':{'id':'owned'},'workspace':'other'}):
   self.ctx=ctx
   with self.assertRaises(PermissionError):self.cv.provider_status(self.data,body=True)
 def test_revocation_changes_revision_so_prior_proposal_CAS_cannot_write(self):
  prior=copy.deepcopy(self.item['expected']);revoked=self.cv.library.share(self.item['id'],prior,'codex',False)
  self.assertNotEqual(revoked['revision'],prior['revision'])
  with self.assertRaisesRegex(ValueError,'conflict'):
   self.cv.library.propose(SPEC,{'atom_i':1,'atom_j':0},workspace_id='conversation',project_id='owned',identifier=self.item['id'],expected=prior)
  current=self.cv.library.read(self.item['id']);self.assertEqual(current['parameter_values'],self.item['parameter_values']);self.assertFalse(current['sharing']['codex'])
 def test_unapproved_current_definition_has_no_invented_code_or_approval(self):
  item=self.cv.library.propose(SPEC,{'atom_i':0,'atom_j':1},workspace_id='conversation',project_id='owned');item=self.cv.library.share(item['id'],item['expected'],'codex',True)
  body=self.cv.provider_status({'id':item['id'],'provider':'codex'},body=True)['entry'];self.assertEqual(set(body),BODY-{'code'});self.assertIsNone(body['code_sha256']);self.assertNotIn('formula_approval',body)
 def test_projection_does_not_mutate_internal_admin_evidence(self):
  seeded=copy.deepcopy(self.item)
  with patch.object(self.cv,'owned',return_value=seeded):result=self.cv.provider_status(self.data,body=True)
  result['entry']['spec']['formula']='changed response';result['entry']['parameter_values']['atom_i']=99;result['entry']['expected']['revision']='changed response'
  self.assertEqual(seeded,self.item)

if __name__=='__main__':unittest.main()
