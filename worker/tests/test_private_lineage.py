import copy,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.service import Service
from studio_worker.custom_cv_service import CustomCvService
from studio_worker.private_lineage import propagate,versions_for
from test_custom_cv import SPEC

class ExactPrivateVersions(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.service=Service(Path(self.temp.name)/'worker',schedule=False);self.addCleanup(self.close);self.cv=CustomCvService(self.service)
  self.directory=self.service.root/'projects/owned/inputs/cv-conversation';self.directory.mkdir(parents=True);self.input=self.directory/'workflow.json';self.input.write_text('{}')
  self.item=self.cv.library.propose(SPEC,{'atom_i':0,'atom_j':1},workspace_id='conversation',project_id='owned');self.item=self.cv.library.approve_formula(self.item['id'],self.item['expected']);self.item=self.cv.library.share(self.item['id'],self.item['expected'],'codex',True);self.old=self.version(self.item);self.lineage(self.item)
 def close(self):self.service.close();self.service.store.db.close()
 def version(self,item):return {'entry_id':item['id'],**{key:item[key]for key in('spec_sha256','code_sha256','parameters_sha256')}}
 def lineage(self,item):
  self.service.store.put('private-cv-lineage',{'id':'canonical','entry_id':item['id'],'project_id':'owned','workspace_id':'conversation','bindings':{key:item[key]for key in('spec_sha256','code_sha256','parameters_sha256')},'paths':[str(self.input)]})
 def add_policy_run(self,name,versions):
  directory=self.service.root/'runs'/name;directory.mkdir(parents=True);path=directory/'input.py';path.write_text('# software policy fixture, never executed')
  run={'id':name,'project_id':'owned','idempotency_key':name,'request_hash':name,'status':'draft','directory':str(directory),'private_cv_entries':[self.item['id']]}
  if versions is not None:run['private_cv_versions']=versions
  self.service.store.add_run(run);return path
 def test_current_same_project_copies_do_not_create_mutable_duplicate_lineage(self):
  for _ in range(3):self.assertEqual(propagate(self.service,[str(self.input)],'owned'),[self.item['id']])
  self.assertEqual(len(self.service.store.list('private-cv-lineage')),1);self.assertEqual(versions_for(self.service,[str(self.input)]),[self.old])
 def test_new_shared_revision_does_not_authorize_old_runs_or_depend_on_prepare_order(self):
  old_path=self.add_policy_run('old',[self.old]);self.item=self.cv.library.propose(SPEC,{'atom_i':1,'atom_j':0},workspace_id='conversation',project_id='owned',identifier=self.item['id'],expected=self.item['expected']);self.lineage(self.item)
  self.assertIn('owned',self.cv.access('codex')['blocked_project_ids']);self.item=self.cv.library.share(self.item['id'],self.item['expected'],'codex',True);new=self.version(self.item);self.add_policy_run('current',[new]);self.add_policy_run('unknown',None)
  for _ in range(3):
   access=self.cv.access('codex');self.assertEqual(access['blocked_project_ids'],[]);self.assertEqual(access['blocked_run_ids'],['old','unknown']);self.assertIn(str(old_path.parent),access['blocked_paths']);propagate(self.service,[str(self.input)],'owned')
  self.assertEqual(versions_for(self.service,[str(old_path)]),[self.old]);self.assertEqual(versions_for(self.service,[str(self.input)]),[new])
  self.item=self.cv.library.share(self.item['id'],self.item['expected'],'codex',False);self.assertEqual(self.cv.access('codex')['blocked_run_ids'],['current','old','unknown'])
 def test_cross_project_old_run_copy_retains_old_version_before_any_bytes_are_copied(self):
  old_path=self.add_policy_run('old',[self.old]);self.item=self.cv.library.propose(SPEC,{'atom_i':1,'atom_j':0},workspace_id='conversation',project_id='owned',identifier=self.item['id'],expected=self.item['expected']);self.lineage(self.item);self.item=self.cv.library.share(self.item['id'],self.item['expected'],'codex',True)
  propagate(self.service,[str(old_path)],'target');rows=[row for row in self.service.store.list('private-cv-lineage')if row['project_id']=='target'];self.assertEqual(len(rows),1);self.assertEqual(rows[0]['bindings']['parameters_sha256'],self.old['parameters_sha256']);self.assertIn('target',self.cv.access('codex')['blocked_project_ids']);self.assertFalse((self.service.root/'projects/target').exists())
 def test_empty_legacy_run_versions_cannot_be_replaced_by_current_sharing_on_copy(self):
  path=self.add_policy_run('empty',[]);self.assertEqual(versions_for(self.service,[str(path)]),[{'entry_id':self.item['id'],'version_status':'unknown'}]);propagate(self.service,[str(path)],'target')
  self.assertIn('empty',self.cv.access('codex')['blocked_run_ids']);self.assertIn('target',self.cv.access('codex')['blocked_project_ids'])
 def test_legacy_shadow_record_is_retained_without_granting_its_old_run(self):
  self.add_policy_run('old',[self.old]);legacy={**self.service.store.get('private-cv-lineage','canonical'),'id':'legacy-shadow','source_project_id':'owned'};self.service.store.put('private-cv-lineage',legacy)
  self.item=self.cv.library.propose(SPEC,{'atom_i':1,'atom_j':0},workspace_id='conversation',project_id='owned',identifier=self.item['id'],expected=self.item['expected']);self.lineage(self.item);self.item=self.cv.library.share(self.item['id'],self.item['expected'],'codex',True)
  access=self.cv.access('codex');self.assertEqual(access['blocked_project_ids'],[]);self.assertEqual(access['blocked_run_ids'],['old']);self.assertEqual(len(self.service.store.list('private-cv-lineage')),2)

if __name__=='__main__':unittest.main()
