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
  base=Path(__file__).resolve().parents[2]/".studio"/"test-fixtures"/"runtime-projection";base.mkdir(parents=True,exist_ok=True)
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
