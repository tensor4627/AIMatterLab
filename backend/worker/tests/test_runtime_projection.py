import copy,json,unittest
from studio_worker.runtime_projection import result_for_agent
class RuntimeProjection(unittest.TestCase):
 def test_full_private_receipt_is_unchanged_and_loader_facts_keep_their_actual_status(self):
  receipt={'status':'observed','environment_id':'chosen','engine':'pygas.build','receipt':'f'*64,'skill_sha256':'e'*64,'facts':{'python':{'executable':'/registered/python','version':'3.12','registration_match':True},'capabilities':{'sampling':False},'scientific_status':'not_run','source_watch':[{'private_watch':'MUST_NOT_ATTACH'}],'file_observations':[{'raw':'MUST_NOT_ATTACH'}]}};before=copy.deepcopy(receipt);value=result_for_agent('read_runtime_guide',receipt)
  self.assertEqual(receipt,before);self.assertNotIn('MUST_NOT_ATTACH',json.dumps(value));self.assertEqual(value['receipt'],receipt['receipt']);self.assertEqual(value['skill_sha256'],receipt['skill_sha256']);self.assertFalse(value['facts']['capabilities']['sampling']);self.assertEqual(value['facts']['scientific_status'],'not_run')
 def test_missing_or_failed_receipt_never_becomes_observed_and_other_results_stay_exact(self):
  for status in('not_run','blocked','stale'):
   value=result_for_agent('read_runtime_guide',{'status':status,'reason':'Real current cause'});self.assertEqual(value['status'],status);self.assertNotIn('facts',value)
  value={'payload':[1,2,3]};self.assertIs(result_for_agent('read_log',value),value)
 def test_probe_reply_uses_actual_recorded_receipt_instead_of_repeating_import_and_install_inventories(self):
  value=result_for_agent('probe_environment',{'runtime_guide':{'status':'blocked','reason':'Actual selected import failed'},'private_loader_env':'MUST_NOT_ATTACH','modules_dump':'MUST_NOT_ATTACH'});self.assertEqual(value['runtime_guide']['status'],'blocked');self.assertNotIn('MUST_NOT_ATTACH',json.dumps(value))
 def test_projection_keeps_actual_worker_receipt_identity_and_stale_result(self):
  import sys,tempfile,hashlib
  from pathlib import Path
  from studio_worker.runtime_guides import RuntimeGuides
  base=Path(__file__).resolve().parents[3]/".studio"/"test-fixtures"/"runtime-projection";base.mkdir(parents=True,exist_ok=True)
  with tempfile.TemporaryDirectory(prefix="owned-receipt-",dir=base)as folder:
   env={"id":"owned-projection-fixture","executables":{"python":sys.executable}}
   probe={"scope":{"engine":"pygas.build"},"python":sys.version.split()[0],"executable":sys.executable,"modules":{},"repositories":{}}
   guides=RuntimeGuides(Path(folder));guides.record(env,"pygas.build",probe)
   before={p.relative_to(folder).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()for p in Path(folder).rglob("*")if p.is_file()}
   receipt=guides.read(env,"pygas.build");value=result_for_agent("read_runtime_guide",receipt)
   self.assertEqual(value["status"],"observed");self.assertEqual(value["receipt"],receipt["receipt"]);self.assertEqual(value["skill_sha256"],receipt["skill_sha256"])
   self.assertEqual(value["facts"]["python"]["executable"],sys.executable);self.assertEqual(value["facts"]["scientific_status"],"not_run")
   self.assertNotIn("file_observations",value["facts"])
   after={p.relative_to(folder).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()for p in Path(folder).rglob("*")if p.is_file()};self.assertEqual(before,after)
   changed={**env,"label":"changed registration"};stale=result_for_agent("read_runtime_guide",guides.read(changed,"pygas.build"))
   self.assertEqual(stale["status"],"stale");self.assertNotIn("facts",stale)

if __name__=='__main__':unittest.main()

class ClusterMetadataProjection(unittest.TestCase):
 def fixture(self):
  secret='PRIVATE_CLUSTER_SENTINEL'
  return {'id':'owned-cluster','name':secret,'scheduler':'lsf','version':3,'host':secret,'username':secret,'port':secret,'identity_file':secret,'queue':secret,'activation':secret,'environment':{'executables':{'python':secret}},'queue_targets':[{'queue':secret,'environment':secret}], 'probe':{'queue_status':'passed','queues':[secret,secret,'other-private-queue'],'nodes':[secret],'stdout':secret},'connection_check':{'status':'passed','ssh_status':'passed','scheduler_status':'passed','compute_node_status':'not_run','observed_at':123.5,'version':3,'hostname':secret,'queue':secret,'nodes':[secret],'reason':secret,'nested':{'secret':secret}}}
 def test_both_cluster_tools_return_only_allowlisted_metadata_and_preserve_original(self):
  cluster=self.fixture();before=copy.deepcopy(cluster)
  projected=result_for_agent('list_clusters',[cluster])[0]
  self.assertEqual(projected,{'id':'owned-cluster','scheduler':'lsf','version':3,'connection_check':{'status':'passed','ssh_status':'passed','scheduler_status':'passed','compute_node_status':'not_run','observed_at':123.5,'version':3},'visible_queue_count':2,'declared_target_count':1,'scope':'Cluster metadata and queue visibility only; no authorization or execution inferred.'})
  ready={'environments':[],'clusters':[cluster],'scope':'existing readiness'}
  self.assertEqual(result_for_agent('compute_readiness',ready),{'environments':[],'clusters':[projected],'scope':'existing readiness'})
  self.assertNotIn('PRIVATE_CLUSTER_SENTINEL',json.dumps(projected));self.assertNotIn('other-private-queue',json.dumps(projected));self.assertEqual(cluster,before)
 def test_missing_stale_invalid_health_never_claims_passed_or_invents_queue_observation(self):
  for state in ('failed','stale','not_run','needs_human_auth'):
   result=result_for_agent('list_clusters',[{'id':'fixture','connection_check':{'status':state,'observed_at':float('nan'),'reason':'PRIVATE'}}])[0]
   self.assertEqual(result['connection_check'],{'status':state});self.assertNotIn('visible_queue_count',result)
  for probe in ({'queue_status':'blocked','queues':[]},{'queues':[]}):
   self.assertNotIn('visible_queue_count',result_for_agent('list_clusters',[{'id':'fixture','probe':probe}])[0])
  self.assertEqual(result_for_agent('list_clusters',[{'id':'fixture','probe':{'queue_status':'passed','queues':[]}}])[0]['visible_queue_count'],0)
  result=result_for_agent('list_clusters',[{'id':'fixture','version':True,'scheduler':'PRIVATE','connection_check':{'status':{'value':'passed'},'observed_at':'PRIVATE'}}])[0]
  self.assertEqual(result['connection_check'],{});self.assertNotIn('scheduler',result);self.assertNotIn('version',result)
 def test_environment_compact_and_unrelated_desktop_result_are_not_changed(self):
  env={'id':'local','name':'Local','executables':{'python':'/approved/local/python'},'observation':{'cuda':{'available':False},'modules':{'ase':{'available':True}}}}
  result=result_for_agent('compute_readiness',{'environments':[env],'clusters':[],'scope':'saved local registrations'})
  self.assertEqual(result['environments'],[{'id':'local','name':'Local','python':'/approved/local/python','cuda':{'available':False},'modules':{'ase':True},'scientific_status':'not_run'}])
  value={'private':'desktop data'};self.assertIs(result_for_agent('unrelated_tool',value),value)
