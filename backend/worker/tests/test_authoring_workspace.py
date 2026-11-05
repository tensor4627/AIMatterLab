import unittest,tempfile,sys
from pathlib import Path
from studio_worker.service import Service
from studio_worker.server import dispatch

class AuthoringWorkspace(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.s=Service(Path(self.temp.name)/'worker',schedule=False)
  self.s.register_environment({'id':'cpu','name':'authoring','executables':{'python':sys.executable}})
 def tearDown(self):self.s.close();self.s.store.db.close();self.temp.cleanup()
 def ensure(self,**kw):return dispatch(self.s,'POST','/api/authoring/context',{'workspace_id':'task','name':'CV',**kw},admin=True)
 def test_empty_catalog_and_stale_project_are_repaired_without_execution_grants(self):
  c=self.ensure(project_id='stale');p=c['project'];self.assertEqual(p['policy']['engines'],[]);self.assertEqual(p['policy']['clusters'],[]);self.assertEqual(c['environment_id'],'cpu');self.assertEqual(self.ensure()['project']['id'],p['id']);self.assertEqual(len(self.s.store.list('project')),1)
  with self.assertRaises(PermissionError):self.s.authorize({'project_id':p['id'],'engine':'pygas.build','environment_id':'cpu','gpu':0,'max_seconds':1})
 def test_mcp_cannot_create_workspace_or_adopt_or_change_policy(self):
  for route in ['/api/authoring/context','/api/authoring/adopt']:
   with self.assertRaises(PermissionError):dispatch(self.s,'POST',route,{'workspace_id':'t'},admin=False)
  self.assertEqual(self.s.store.list('project'),[])
 def test_existing_project_policy_is_preserved(self):
  p=self.s.register_project({'id':'real','name':'real','policy':{'input_roots':[str(self.s.root)],'environments':['cpu'],'engines':['pydyn.md']}});self.assertEqual(self.ensure(project_id='real')['project'],p)
 def test_import_selected_structure_and_adopt_actual_inputs_without_broad_read_grant(self):
  file=Path(self.temp.name)/'model.xyz';file.write_text('1\n\nH 0 0 0\n');c=self.ensure(structure_paths=[str(file)]);copied=c['imports'][0]['path'];self.assertEqual(Path(copied).name,'model.xyz');self.assertTrue(Path(copied).is_file());self.assertEqual(self.ensure(project_id=c['project']['id'],structure_paths=[copied])['imports'][0]['path'],copied);self.assertNotIn(str(file.parent),c['project']['policy']['input_roots']);self.assertEqual(len(c['assets']),1)
  p=self.s.register_project({'id':'compute','name':'compute','policy':{'input_roots':[str(self.s.root/'compute')],'environments':['cpu'],'engines':['pydyn.md']}});out=dispatch(self.s,'POST','/api/authoring/adopt',{'source_project_id':c['project']['id'],'target_project_id':p['id'],'paths':[copied]},admin=True);self.assertEqual(Path(out['paths'][copied]).read_bytes(),file.read_bytes());self.assertEqual(self.s.store.get('project','compute'),p)
 def test_private_file_and_symlink_import_rejected(self):
  with self.assertRaises(ValueError):self.ensure(structure_paths=['/tmp/secret.json'])
  file=Path(self.temp.name)/'a.xyz';file.write_text('H');link=Path(self.temp.name)/'b.xyz';link.symlink_to(file)
  with self.assertRaises(ValueError):self.ensure(structure_paths=[str(link)])

 def test_another_tasks_automatic_draft_is_not_reused(self):
  first=self.ensure();second=dispatch(self.s,'POST','/api/authoring/context',{'workspace_id':'other','project_id':first['project']['id'],'name':'New workflow'},admin=True)
  self.assertNotEqual(first['project']['id'],second['project']['id']);self.assertEqual(second['project']['authoring_task_id'],'other');self.assertEqual(second['project']['policy']['engines'],[])
 def test_human_selected_scientific_file_is_copied_without_loading_or_broad_roots(self):
  file=Path(self.temp.name)/'model.pt';file.write_bytes(b'never deserialize this input')
  c=self.ensure(selected_paths=[str(file)]);target=Path(c['imports'][0]['path']);self.assertEqual(target.name,'model.pt');self.assertEqual(target.read_bytes(),file.read_bytes());self.assertEqual(c['assets'][0]['kind'],'input');self.assertNotIn(str(file.parent),c['project']['policy']['input_roots'])
  with self.assertRaises(ValueError):self.ensure(selected_paths=[str(Path(self.temp.name)/'id_rsa')])
 def test_short_draft_name_does_not_embed_the_whole_multiline_request(self):
  c=self.ensure(name='x'*100+'\nprivate second line');self.assertLessEqual(len(c['project']['name']),33);self.assertNotIn('second line',c['project']['name'])
