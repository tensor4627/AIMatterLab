import tempfile,unittest,sys
from pathlib import Path
from studio_worker.service import Service
from studio_worker.server import dispatch

class WorkspaceLayout(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=Service(Path(self.tmp.name)/'worker',schedule=False)
  self.s.register_environment({'id':'python','name':'fixture','executables':{'python':sys.executable}})
 def tearDown(self):self.s.close();self.s.store.db.close();self.tmp.cleanup()
 def call(self,action,data,admin=True):return dispatch(self.s,'POST','/api/studio-workspace/'+action,data,admin=admin)
 def create(self):return self.call('create',{'id':'workspace-cu','name':'Cu sampling','asset_mode':'copy'})
 def test_named_layout_does_not_grant_execution_or_replace_another_project(self):
  w=self.create();p=self.s.store.get('project',w['id']);self.assertEqual(p['policy']['engines'],[])
  self.assertTrue((Path(w['root'])/'gpumd/inputs').is_dir());self.assertTrue((Path(w['root'])/'pygas/biases').is_dir())
  self.assertEqual(self.create()['id'],w['id']);self.assertEqual(len(self.s.store.list('project')),1)
  with self.assertRaises(ValueError):self.call('create',{'id':w['id'],'name':'foreign','asset_mode':'copy'})
 def test_mcp_cannot_choose_create_retain_or_import(self):
  for action in ['create','read','import','retain']:
   with self.assertRaises(PermissionError):self.call(action,{},admin=False)
  self.assertEqual(self.s.store.list('project'),[])
 def test_copy_deduplicates_and_links_remain_links_with_exact_file_grants(self):
  w=self.create();source=Path(self.tmp.name)/'atoms.xyz';source.write_text('1\n\nH 0 0 0\n')
  args={'project_id':w['id'],'source':str(source),'role':'structure','mode':'copy'}
  copied=self.call('import',args);self.assertEqual(self.call('import',args)['path'],copied['path'])
  self.assertFalse(Path(copied['path']).is_symlink());self.assertNotIn(str(source.parent),self.s.store.get('project',w['id'])['policy']['input_roots'])
  linked=self.call('import',{**args,'mode':'link'});self.assertTrue(Path(linked['path']).is_symlink())
  policy=self.s.store.get('project',w['id'])['policy'];self.assertIn(str(source),policy['input_roots']);self.assertNotIn(str(source.parent),policy['input_roots'])
  read=dispatch(self.s,'POST','/api/workspace/read',{'project_id':w['id'],'name':linked['path']},admin=False);self.assertEqual(read['sha256'],linked['sha256'])
  source.write_text('changed')
  with self.assertRaises(ValueError):self.call('import',{**args,'source':linked['path']})
  self.assertEqual(Path(copied['path']).read_text(),'1\n\nH 0 0 0\n')
 def test_retain_only_previously_authorized_inputs_without_copying_or_engine_grants(self):
  w=self.create();owned=Path(self.tmp.name)/'owned';owned.mkdir();file=owned/'run.in';file.write_text('run 1')
  self.s.register_project({'id':'previous','name':'previous','policy':{'engines':[],'input_roots':[str(owned)]}})
  self.call('retain',{'project_id':w['id'],'previous_project_id':'previous','sources':[str(file)]})
  p=self.s.store.get('project',w['id']);self.assertIn(str(file),p['policy']['input_roots']);self.assertNotIn(str(owned),p['policy']['input_roots']);self.assertEqual(p['policy']['engines'],[])
  outside=Path(self.tmp.name)/'private';outside.write_text('unselected')
  with self.assertRaises(ValueError):self.call('retain',{'project_id':w['id'],'previous_project_id':'previous','sources':[str(outside)]})
 def test_reused_workspace_is_shared_only_after_explicit_desktop_binding(self):
  w=self.create()
  for task in ['one','two']:
   value=dispatch(self.s,'POST','/api/authoring/context',{'workspace_id':task,'project_id':w['id'],'name':task},admin=True)
   self.assertEqual(value['project']['id'],w['id'])
  self.assertEqual(len(self.s.store.list('project')),1)
 def test_symlink_directory_and_unregistered_target_are_refused(self):
  w=self.create();root=Path(w['root']);source=Path(self.tmp.name)/'atoms.xyz';source.write_text('1')
  folder=root/'assets/structures';folder.rmdir();folder.symlink_to(Path(self.tmp.name),target_is_directory=True)
  with self.assertRaises(ValueError):self.call('import',{'project_id':w['id'],'source':str(source),'mode':'copy','role':'structure'})
  self.assertEqual(source.read_text(),'1')

if __name__=='__main__':unittest.main()
