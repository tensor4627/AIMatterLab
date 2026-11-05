"""Setup discovery tests; mocked receipts never count as scientific evidence."""
import json,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.service import Service
from studio_worker.server import dispatch,tools
from studio_worker.compute_setup import discover,adopt,readiness,draft,signature
from studio_worker.cluster import public

class ComputeSetup(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.service=Service(self.root/'worker',schedule=False)
  self.python=self.root/'python';self.python.write_text('fixture');self.python.chmod(0o755)
  self.spec={'name':'fixture','executables':{'python':str(self.python)},'repositories':{},'variables':{}}
  self.item={'id':'candidate','status':'discovered','spec':self.spec,'python':str(self.python),'python_stat':[self.python.stat().st_mtime_ns,self.python.stat().st_size],'observation':{'cuda':{'torch':{'available':True}}}}
  self.receipt={'id':'local','identity':'snapshot','observed_at':time.time(),'entries':[self.item]};self.service.store.put('compute-discovery',self.receipt)
 def tearDown(self):
  self.service.close();self.service.store.db.close();self.tmp.cleanup()
 def test_adopt_is_idempotent_and_never_changes_projects_or_jobs(self):
  first=adopt(self.service,{'identity':'snapshot','candidates':['candidate']});second=adopt(self.service,{'identity':'snapshot','candidates':['candidate']})
  self.assertEqual(first['environments'],second['environments']);self.assertEqual(len(self.service.store.list('environment')),1);self.assertFalse(self.service.store.list('project'));self.assertFalse(self.service.store.runs())
 def test_mcp_cannot_register_or_grant_and_read_tools_are_available(self):
  with self.assertRaises(PermissionError):dispatch(self.service,'POST','/api/environments/adopt',{'identity':'snapshot','candidates':['candidate']},admin=False)
  with self.assertRaises(PermissionError):dispatch(self.service,'POST','/api/environments',self.spec,admin=False)
  definitions={tool['name']:tool for tool in tools()}
  self.assertTrue(definitions['compute_readiness']['annotations']['readOnlyHint']);self.assertTrue(definitions['discover_local_environments']['annotations']['readOnlyHint'])
 def test_stale_candidate_or_changed_interpreter_is_rejected(self):
  with self.assertRaises(ValueError):adopt(self.service,{'identity':'old','candidates':['candidate']})
  self.python.write_text('changed interpreter')
  with self.assertRaisesRegex(ValueError,'interpreter changed'):adopt(self.service,{'identity':'snapshot','candidates':['candidate']})
  self.assertFalse(self.service.store.list('environment'))
 def test_existing_explicit_registration_is_not_overwritten(self):
  original=self.service.register_environment({**self.spec,'id':'manual','name':'User environment','version':7})
  adopted=adopt(self.service,{'identity':'snapshot','candidates':['candidate']})
  self.assertEqual(adopted['environments'][0],original);self.assertEqual(self.service.store.get('environment','manual'),original)
  self.assertTrue(readiness(self.service)['environments'][0]['cuda']['torch']['available'])
 def test_failed_discovery_is_explicit_no_environment_is_registered(self):
  with patch('studio_worker.compute_setup.candidates',return_value=[str(self.python)]),patch('studio_worker.compute_setup.native_paths',return_value={}),patch('studio_worker.compute_setup.subprocess.run',side_effect=OSError('fixture')):
   result=discover(self.service,force=True)
  self.assertEqual(result['entries'][0]['status'],'blocked');self.assertFalse(self.service.store.list('environment'))
 def test_private_connection_details_never_appear_in_readiness(self):
  self.service.clusters.register({'id':'cluster','name':'fixture','scheduler':'lsf','host':'private.invalid','username':'scientist','port':2345,'ssh_client':'/usr/bin/ssh','remote_root':'/tmp/science'})
  text=json.dumps(readiness(self.service));self.assertNotIn('private.invalid',text);self.assertNotIn('2345',text);self.assertNotIn('scientist@',text)
 def test_cluster_stale_health_is_not_current_success(self):
  profile={'version':2,'connection_check':{'version':1,'status':'passed','observed_at':time.time()}}
  self.assertEqual(public(profile)['connection_check']['status'],'stale')
 def test_failed_probe_clears_previous_success_without_changing_profile_version(self):
  self.service.clusters.register({'id':'cluster','name':'fixture','scheduler':'lsf','host':'private.invalid','username':'scientist','port':2345,'ssh_client':'/usr/bin/ssh','remote_root':'/tmp/science'})
  original=self.service.store.get('cluster','cluster');self.service.clusters._connection_result(original,{'status':'passed'},{'queues':['q']})
  with patch.object(self.service.clusters,'transport',side_effect=ConnectionError('fixture')):
   with self.assertRaises(ConnectionError):self.service.clusters.probe('cluster')
  current=self.service.store.get('cluster','cluster');self.assertEqual(current['version'],original['version']);self.assertEqual(current['connection_check']['status'],'failed');self.assertNotIn('probe',current)
 def test_probe_cannot_overwrite_newer_connection_version(self):
  self.service.clusters.register({'id':'cluster','name':'fixture','scheduler':'lsf','host':'private.invalid','username':'scientist','port':2345,'ssh_client':'/usr/bin/ssh','remote_root':'/tmp/science'})
  old=self.service.store.get('cluster','cluster');new=self.service.clusters.register({**old,'host':'new.invalid','target':''})
  self.service.clusters._connection_result(old,{'status':'passed'},{'queues':['old']})
  current=self.service.store.get('cluster','cluster');self.assertEqual(current['host'],'new.invalid');self.assertNotIn('probe',current);self.assertEqual(public(current)['connection_check']['status'],'not_run')
 def test_agent_can_propose_settings_but_only_desktop_can_register(self):
  proposed=dispatch(self.service,'POST','/api/environments/draft',{'proposal':self.spec},admin=False)
  self.assertEqual(proposed['status'],'draft');self.assertFalse(self.service.store.list('environment'));self.assertFalse(self.service.store.list('project'))
  with self.assertRaises(ValueError):draft(self.service,{**self.spec,'policy':{'gpus':[0]}})
 def test_older_success_cannot_replace_newer_failed_connection_check(self):
  self.service.clusters.register({'id':'cluster','name':'fixture','scheduler':'lsf','host':'private.invalid','username':'scientist','port':2345,'ssh_client':'/usr/bin/ssh','remote_root':'/tmp/science'})
  profile=self.service.store.get('cluster','cluster');old={**profile,'_check_started_at':1};new={**profile,'_check_started_at':2}
  self.service.clusters._connection_result(new,{'status':'failed'})
  self.service.clusters._connection_result(old,{'status':'passed'},{'queues':['old']})
  current=self.service.store.get('cluster','cluster');self.assertEqual(current['connection_check']['status'],'failed');self.assertNotIn('probe',current)
 def test_human_save_applies_setup_draft_once_and_preserves_history(self):
  proposal=draft(self.service,self.spec)
  value=dispatch(self.service,'POST','/api/environments',{**self.spec,'setup_draft_id':proposal['id']},admin=True)
  self.assertEqual(self.service.store.get('environment-draft',proposal['id'])['environment_id'],value['id'])
  self.assertEqual(draft(self.service,self.spec)['status'],'applied')
  with self.assertRaises(ValueError):dispatch(self.service,'POST','/api/environments',{**self.spec,'setup_draft_id':proposal['id']},admin=True)
  self.assertEqual(len(self.service.store.list('environment')),1)
 def test_missing_setup_draft_cannot_partially_register_environment(self):
  with self.assertRaises(ValueError):self.service.register_environment({**self.spec,'setup_draft_id':'missing'})
  self.assertFalse(self.service.store.list('environment'))
 def test_added_cli_capability_creates_new_identity_instead_of_overwriting_old_auto_environment(self):
  old=self.service.register_environment({**self.spec,'id':'auto-wsl-candidate','version':1})
  self.item['observation']['modules']={'hotpp':{'available':True}};self.service.store.put('compute-discovery',self.receipt)
  added=adopt(self.service,{'identity':'snapshot','candidates':['candidate']})['environments'][0]
  self.assertNotEqual(added['id'],old['id']);self.assertTrue(Path(added['executables']['hotpp']).is_file())
  self.assertEqual(self.service.store.get('environment',old['id']),old)
