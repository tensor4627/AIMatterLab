import sys,unittest,tempfile,json,copy,hashlib
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.store import Store
from studio_worker.server import dispatch,TOOL_ROUTES
from studio_worker.runtime_guides import fingerprint
class Identity(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name));self.environment={"id":"env","name":"中文 环境","executables":{"python":"/registered/python"},"variables":{"THREAD_SETTING":1}}
  self.run={"id":"run","project_id":"owned","environment_id":"env","engine":"pygas.build","environment_snapshot":copy.deepcopy(self.environment),"status":"draft","request_hash":"test","idempotency_key":"key"};self.store.add_run(self.run);self.service=SimpleNamespace(store=self.store)
 def tearDown(self):self.store.db.close();self.temp.cleanup()
 def identity(self,args=None,admin=True):return dispatch(self.service,"POST","/api/run/environment-identity",args or {"run_id":"run"},admin=admin)
 def test_actual_dispatch_is_readonly_admin_minimal_closed_shape(self):
  before=self.store.run("run");v=self.identity();self.assertEqual(v["configuration_sha256"],fingerprint(self.environment));self.assertEqual(set(v),{"kind","run_id","project_id","environment_id","engine","configuration_sha256","interpreter"});self.assertEqual(self.store.run("run"),before);self.assertFalse(any(path=="/api/run/environment-identity" for _,path,_ in TOOL_ROUTES.values()))
 def test_int_float_lexemes_use_actual_python_immutable_hash_not_current_registration(self):
  a=self.identity()["configuration_sha256"];self.run["environment_snapshot"]["variables"]["THREAD_SETTING"]=1.0;self.store.update(self.run,environment_snapshot=self.run["environment_snapshot"])
  b=self.identity()["configuration_sha256"];self.assertNotEqual(a,b);self.assertEqual(self.environment["variables"]["THREAD_SETTING"],1);self.assertEqual(b,fingerprint(self.store.run("run")["environment_snapshot"]))
 def test_same_id_python_repository_loader_extra_fields_change_identity(self):
  before=self.identity()["configuration_sha256"]
  for key,value in [("executables",{"python":"/unreviewed/python"}),("repositories",{"pygas":"/unreviewed/repo"}),("variables",{"LD_LIBRARY_PATH":"/unreviewed/loader"}),("unknown",True)]:
   with self.subTest(key=key):
    changed=copy.deepcopy(self.run);changed["environment_snapshot"][key]=value;self.store.update(changed,environment_snapshot=changed["environment_snapshot"]);self.assertNotEqual(self.identity()["configuration_sha256"],before)
 def test_nonadmin_and_forged_unknownkeys_are_blocked(self):
  with self.assertRaises(PermissionError):self.identity(admin=False)
  for extra in ("snapshot","environment_id","configuration_sha256","path","project_id"):
   with self.subTest(extra=extra):
    with self.assertRaises(ValueError):self.identity({"run_id":"run",extra:"forged"})
 def test_unknown_run_and_missing_snapshot_are_blocked(self):
  with self.assertRaises(ValueError):self.identity({"run_id":"unknown"})
  for value in (None,{"id":"env"},{"id":"other","executables":{"python":"/env/python"}}):
   self.run["environment_snapshot"]=value;self.store.update(self.run,environment_snapshot=value)
   with self.assertRaises(ValueError):self.identity()
if __name__=="__main__":unittest.main()
