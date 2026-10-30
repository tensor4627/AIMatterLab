import copy,importlib.util,json,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
entry=load("studio_install_entry",ROOT/"scripts/one_prompt.py")
runtime=load("studio_install_runtime",ROOT/"installation/runtime.py")
class Installation(unittest.TestCase):
 def config(self,root):
  return {"schema_version":1,"desktop":{},"worker":{"root":str(root/"worker"),"distribution":"Ubuntu"},
   "compute":{"kind":"wsl","environment":{"executables":{"python":sys.executable},"repositories":{},"variables":{}}},"cases":["worker"],"gpu":0}
 def test_missing_or_stale_receipts_cannot_succeed(self):
  self.assertFalse(entry.finalize({},"new",["worker"])["installation_success"])
  records={k:{"fingerprint":"old","result":{"status":"passed"}} for k in entry.REQUIRED}
  self.assertFalse(entry.finalize(records,"new",["worker"])["installation_success"])
 def test_unexecuted_selected_case_cannot_succeed(self):
  records={k:{"fingerprint":"new","result":{"status":"passed"}} for k in entry.REQUIRED}
  records["smoke"]["result"]["checks"]=[{"id":"worker","status":"passed"}]
  self.assertFalse(entry.finalize(records,"new",["worker","pydyn-md"])["installation_success"])
  records["smoke"]["result"]["checks"].append({"id":"pydyn-md","status":"blocked"})
  self.assertFalse(entry.finalize(records,"new",["worker","pydyn-md"])["installation_success"])
 def test_existing_prefix_never_modified(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/"user-file").write_text("preserve")
   cfg=self.config(root);cfg["bootstrap"]={"enabled":True,"root":str(root),"packages":[]}
   with self.assertRaises(ValueError):runtime.bootstrap(cfg)
   self.assertEqual((root/"user-file").read_text(),"preserve")
 def test_remote_install_needs_site_policy(self):
  cfg={"compute":{"kind":"ssh"},"bootstrap":{"enabled":True}}
  self.assertEqual(runtime.bootstrap(cfg)["status"],"blocked")
 def test_real_worker_short_case_and_idempotence(self):
  with tempfile.TemporaryDirectory() as tmp:
   cfg=self.config(Path(tmp));cfg.update(_suite_root=str(ROOT),_fingerprint="fixture")
   a=runtime.smoke(cfg);self.assertEqual(a["status"],"passed")
   b=runtime.smoke(cfg);self.assertEqual(a["checks"][0]["run_id"],b["checks"][0]["run_id"])
   from studio_worker.service import Service
   service=Service(cfg['worker']['root'],schedule=False)
   try:
    run=service.store.run(a['checks'][0]['run_id'])
    self.assertEqual(run['engine'],'installation.check')
    self.assertEqual(run['validation']['scientific_status'],'not_run')
   finally:service.close();service.store.db.close()

 def test_fixed_cases_match_shipped_sources_and_reject_modified_code(self):
  from studio_worker.adapters import Adapter,INSTALLATION_CHECKS
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);script=root/'run.py';adapter=Adapter('installation.check')
   for case,filename in (('worker','worker-smoke.py'),('reference-md','reference-md.py')):
    script.write_bytes((ROOT/'installation/examples'/filename).read_bytes())
    spec={'inputs':{'run.py':str(script)},'parameters':{'installation_case':case}}
    report=adapter.validate(spec,{'executables':{'python':sys.executable}},root)
    self.assertEqual(report['scientific_status'],'not_run')
    script.write_text(script.read_text()+'\nprint("modified")\n')
    with self.assertRaisesRegex(ValueError,'differs from the shipped'):adapter.validate(spec,{'executables':{'python':sys.executable}},root)
   self.assertEqual(set(INSTALLATION_CHECKS),{'worker','reference-md'})
   self.assertFalse((root/'smoke-result.json').exists())

 def test_internal_fixed_checks_require_explicit_authorization_and_cannot_be_general_python(self):
  from studio_worker.adapters import Adapter,ENGINES
  from studio_worker.service import Service
  from studio_worker.scientific import probe_modules
  self.assertNotIn('installation.check',ENGINES)
  self.assertEqual(probe_modules('installation.check'),())
  adapter=Adapter('installation.check');env={'executables':{'python':sys.executable}}
  for parameters in ({},{'installation_case':'pydyn-md'},{'installation_case':'worker','skip_gate':True}):
   with self.assertRaises(ValueError):adapter.prepare({'inputs':{'run.py':'fixture'},'parameters':parameters},env)
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);source=root/'run.py';source.write_bytes((ROOT/'installation/examples/worker-smoke.py').read_bytes())
   service=Service(root/'worker',schedule=False)
   try:
    env=service.register_environment({'name':'fixture','executables':{'python':sys.executable}})
    project=service.register_project({'name':'Default scientific policy','policy':{'input_roots':[str(root)],'environments':[env['id']]}})
    self.assertNotIn('installation.check',project['policy']['engines'])
    with self.assertRaises(PermissionError):service.prepare({'project_id':project['id'],'environment_id':env['id'],'engine':'installation.check','inputs':{'run.py':str(source)},'parameters':{'installation_case':'worker'},'gpu':0,'max_seconds':10,'idempotency_key':'must-not-launch'})
   finally:service.close();service.store.db.close()
 def test_unshipped_case_is_blocked(self):
  with tempfile.TemporaryDirectory() as tmp:
   cfg=self.config(Path(tmp));cfg.update(_suite_root=str(ROOT),_fingerprint="fixture",cases=["nep-train"])
   a=runtime.smoke(cfg);self.assertEqual(a["status"],"blocked");self.assertEqual(a["checks"][0]["status"],"blocked")

 def test_changed_request_cannot_duplicate_unknown_installation(self):
  from studio_worker.service import Service
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);cfg=self.config(root);cfg.update(_suite_root=str(ROOT),_fingerprint="new")
   source=root/"run.py";source.write_text("print('not submitted')")
   s=Service(cfg["worker"]["root"],schedule=False)
   e=s.register_environment({"name":"Old explicit environment","executables":{"python":sys.executable}})
   p=s.register_project({"name":"old","policy":{"input_roots":[str(root)],"environments":[e["id"]]}})
   r=s.prepare({"name":"Install worker","project_id":p["id"],"environment_id":e["id"],"engine":"pydyn.md","gpu":0,"max_seconds":10,"inputs":{"run.py":str(source)},"parameters":{},"idempotency_key":"old:worker"})
   s.store.update(r,status="unknown");s.close();s.store.db.close()
   result=runtime.smoke(cfg);self.assertEqual(result["status"],"blocked")
   s=Service(cfg["worker"]["root"],schedule=False)
   try:self.assertEqual(len(s.store.runs()),1)
   finally:s.close();s.store.db.close()
