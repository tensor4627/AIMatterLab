import copy,importlib.util,json,tempfile,unittest
from pathlib import Path
from studio_worker import runtime_guides as module
class RuntimeGuideTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.guides=module.RuntimeGuides(self.root)
  self.environment={"id":"selected-env","name":"test","executables":{"python":"/explicit/env/bin/python","gpu-sampling":"/explicit/bin/gpu-sampling"},"variables":{"LD_LIBRARY_PATH":"private-loader-value"},"credentials":"never-emit"}
  self.probe={"scope":{"engine":"gpumd.sampling"},"executable":"/actual/python","python":"3.actual","modules":{"pygas":{"version":"actual-version","file":"/explicit/pygas/base/__init__.py","source_sha256":"actualhash","status":"passed","token":"never-emit"}},"repositories":{"pygas":{"path":"/explicit/pygas","commit":"actual-commit","dirty":True,"private":"never-emit"}},"native_runtime":{"status":"passed","executable":"/explicit/bin/gpu-sampling","sha256":"exehash"},"cuda_available":True,"cuda":"actual-cuda"}
  self.actual_python=self.root/'python';self.actual_python.write_text('test interpreter identity only')
  self.actual_native=self.root/'gpu-sampling';self.actual_native.write_text('test executable identity only')
  self.actual_module=self.root/'module.py';self.actual_module.write_text('test module identity only')
  self.environment['executables']['python']=str(self.actual_python);self.environment['executables']['gpu-sampling']=str(self.actual_native);self.probe['executable']=str(self.actual_python);self.probe['native_runtime']['executable']=str(self.actual_native);self.probe['modules']['pygas']['file']=str(self.actual_module)
 def test_observed_reuse_writes_local_runtime_skill_with_only_whitelisted_facts(self):
  facts=self.guides.record(self.environment,"gpumd.sampling",self.probe,123);self.assertEqual(facts["state"],"observed");self.assertEqual(facts["scientific_status"],"not_run");self.assertEqual(facts["python"]["executable"],str(self.actual_python));receipt=json.loads((self.root/"selected-env/gpumd.sampling/current.json").read_text())["receipt"];text=(self.root/"selected-env/gpumd.sampling/versions"/receipt/"SKILL.md").read_text(encoding="utf-8");self.assertNotIn("never-emit",text);self.assertNotIn("private-loader-value",text);self.assertIn("actual-commit",text);self.assertEqual(self.guides.read(self.environment,"gpumd.sampling")["status"],"observed")
 def test_missing_and_configuration_changed_guides_require_probe_without_install_or_run_mutation(self):
  self.assertEqual(self.guides.read(self.environment,"gpumd.sampling")["status"],"not_run");self.guides.record(self.environment,"gpumd.sampling",self.probe);changed=copy.deepcopy(self.environment);changed["variables"]["LD_LIBRARY_PATH"]="changed";self.assertEqual(self.guides.read(changed,"gpumd.sampling")["status"],"stale");self.assertEqual(self.guides.read(self.environment,"gpumd.sampling")["status"],"observed");self.assertFalse((self.root/"runs").exists())
 def test_wrong_scope_or_path_is_rejected_and_blocked_module_never_becomes_validated_runtime(self):
  with self.assertRaises(ValueError):self.guides.record(self.environment,"pydyn.md",self.probe)
  with self.assertRaises(ValueError):self.guides.directory("../escape","gpumd.md")
  self.probe["modules"]["pygas"]["registration_match"]=False;self.assertEqual(self.guides.record(self.environment,"gpumd.sampling",self.probe)["state"],"blocked")
 def test_pair_receipt_is_immutable_atomic_and_tampering_stales_without_touching_runs(self):
  self.guides.record(self.environment,"gpumd.sampling",self.probe,123);first=self.guides.read(self.environment,"gpumd.sampling");self.assertEqual(first["facts"]["source_build_relation"]["status"],"not_run");version=self.root/"selected-env/gpumd.sampling/versions"/first["receipt"];(version/"SKILL.md").write_text("changed");self.assertEqual(self.guides.read(self.environment,"gpumd.sampling")["status"],"stale");self.assertFalse((self.root/"runs").exists())
 def test_changed_observed_source_is_stale_without_reinstallation(self):
  source=self.root/'actual.py';source.write_text('first');self.probe['modules']['pygas']['file']=str(source);self.guides.record(self.environment,'gpumd.sampling',self.probe);self.assertEqual(self.guides.read(self.environment,'gpumd.sampling')['status'],'observed');source.write_text('changed bytes');self.assertEqual(self.guides.read(self.environment,'gpumd.sampling')['status'],'stale');self.assertFalse((self.root/'runs').exists())
 def test_failed_native_loader_keeps_runtime_guide_blocked(self):
  self.probe['native_runtime']['status']='blocked';self.assertEqual(self.guides.record(self.environment,'gpumd.sampling',self.probe)['state'],'blocked')
 def test_same_metadata_rewrite_is_detected_by_content_hash(self):
  import os
  source=self.root/'actual.py';source.write_text('first');self.probe['modules']['pygas']['file']=str(source);self.guides.record(self.environment,'gpumd.sampling',self.probe);before=source.stat();source.write_text('other');os.utime(source,ns=(before.st_atime_ns,before.st_mtime_ns));self.assertEqual(self.guides.read(self.environment,'gpumd.sampling')['status'],'stale')
 def test_linked_owned_environment_is_rejected_before_write(self):
  outside=self.root/'outside';outside.mkdir();link=self.root/'selected-env'
  try:link.symlink_to(outside,target_is_directory=True)
  except OSError:self.skipTest('Symlink privilege unavailable')
  with self.assertRaises(ValueError):self.guides.record(self.environment,'gpumd.sampling',self.probe)
  self.assertFalse((outside/'gpumd.sampling').exists())
 def test_missing_required_observed_file_remains_blocked(self):
  self.actual_native.unlink();facts=self.guides.record(self.environment,'gpumd.sampling',self.probe);self.assertEqual(facts['state'],'blocked');self.assertIn('native',facts['file_observations_status']['unavailable_roles'])
 def test_selected_venv_link_retarget_stales_even_if_old_target_exists(self):
  first=self.root/'first';second=self.root/'second';first.write_text('first');second.write_text('second');link=self.root/'venv-python'
  try:link.symlink_to(first)
  except OSError:self.skipTest('Symlink privilege unavailable')
  self.probe['executable']=str(link);self.environment['executables']['python']=str(link);self.guides.record(self.environment,'gpumd.sampling',self.probe);link.unlink();link.symlink_to(second);self.assertEqual(self.guides.read(self.environment,'gpumd.sampling')['status'],'stale');self.assertTrue(first.is_file())


class RuntimeGuideScopeTests(unittest.TestCase):
 setUp=RuntimeGuideTests.setUp
 def test_different_actual_interpreter_never_becomes_observed(self):
  other=self.root/'other-python';other.write_text('different');self.probe['executable']=str(other)
  self.assertEqual(self.guides.record(self.environment,'gpumd.sampling',self.probe)['state'],'blocked')
 def test_only_selected_sdk_is_watched_and_nested_change_is_detected(self):
  sdk=self.root/'sdk';base=sdk/'base';base.mkdir(parents=True);(base/'__init__.py').write_text('from .nested.cv import value')
  nested=base/'nested';nested.mkdir();cv=nested/'cv.py';cv.write_text('value=1')
  other=self.root/'unrelated';(other/'hotpp').mkdir(parents=True);unrelated=other/'hotpp/model.py';unrelated.write_text('model=1')
  self.environment['repositories']={'pygas':str(sdk),'hotpp':str(other)}
  self.probe['modules']['pygas']['file']=str(base/'__init__.py');self.probe['repositories']={'pygas':{'path':str(sdk)},'hotpp':{'path':str(other)}}
  facts=self.guides.record(self.environment,'gpumd.sampling',self.probe);self.assertEqual(set(facts['repositories']),{'pygas'})
  unrelated.write_text('model=2');self.assertEqual(self.guides.read(self.environment,'gpumd.sampling')['status'],'observed')
  cv.write_text('value=2');self.assertEqual(self.guides.read(self.environment,'gpumd.sampling')['status'],'stale')
 def test_selected_source_import_outside_registration_is_blocked(self):
  self.environment['repositories']={'pygas':str(self.root/'registered')}
  self.assertEqual(self.guides.record(self.environment,'gpumd.sampling',self.probe)['state'],'blocked')
 def test_source_hash_changed_after_probe_is_not_committed(self):
  self.probe['modules']['pygas']['source_sha256']=module.file_digest(self.actual_module);self.actual_module.write_text('newsource')
  with self.assertRaisesRegex(ValueError,'changed during probe'):self.guides.record(self.environment,'gpumd.sampling',self.probe)
  self.assertEqual(self.guides.read(self.environment,'gpumd.sampling')['status'],'not_run')
 def test_selected_sampling_capability_is_required_without_blocking_ordinary_md(self):
  self.probe['modules']={'pydyn':{'file':str(self.actual_module),'status':'passed'}};self.probe['pydyn_sampling']=False
  self.probe['scope']['engine']='pydyn.md';self.assertEqual(self.guides.record(self.environment,'pydyn.md',self.probe)['state'],'observed')
  self.probe['scope']['engine']='pydyn.sampling';self.assertEqual(self.guides.record(self.environment,'pydyn.sampling',self.probe)['state'],'blocked')
  self.probe['pydyn_sampling']=True;self.probe['pydyn_sampling_origin']=str(self.actual_module);self.probe['pygas_upstream']={'commit':'pinned','token':'never-emit'}
  facts=self.guides.record(self.environment,'pydyn.sampling',self.probe);self.assertEqual(facts['state'],'observed');self.assertEqual(facts['capabilities']['pydyn_sampling']['upstream'],{'commit':'pinned'})
 def test_hotpp_launcher_is_required_and_watched(self):
  self.probe['scope']['engine']='hotpp.train';self.environment['executables']['hotpp']=str(self.actual_native)
  self.assertEqual(self.guides.record(self.environment,'hotpp.train',self.probe)['state'],'observed');self.actual_native.write_text('changedlauncher')
  self.assertEqual(self.guides.read(self.environment,'hotpp.train')['status'],'stale')
 def test_linked_guide_root_read_is_stale_not_foreign_content(self):
  self.guides.record(self.environment,'gpumd.sampling',self.probe);outside=self.root/'outside';outside.mkdir();link=self.root/'linked'
  try:link.symlink_to(outside,target_is_directory=True)
  except OSError:self.skipTest('Symlink privilege unavailable')
  self.assertEqual(module.RuntimeGuides(link).read(self.environment,'gpumd.sampling')['status'],'stale')

 def test_oversized_or_linked_pointer_is_rejected_before_content_read(self):
  self.guides.record(self.environment,'gpumd.sampling',self.probe);pointer=self.root/'selected-env/gpumd.sampling/current.json';pointer.write_text('x'*4097)
  self.assertEqual(self.guides.read(self.environment,'gpumd.sampling')['status'],'stale')
  pointer.unlink();outside=self.root/'outside-pointer';outside.write_text('foreign content must not be read')
  try:pointer.symlink_to(outside)
  except OSError:self.skipTest('Symlink privilege unavailable')
  self.assertEqual(self.guides.read(self.environment,'gpumd.sampling')['status'],'stale')

 def test_added_or_renamed_selected_module_stales_only_selected_guide(self):
  sdk=self.root/'sdk';base=sdk/'base';base.mkdir(parents=True);init=base/'__init__.py';init.write_text('initial')
  self.environment['repositories']={'pygas':str(sdk)};self.probe['modules']['pygas']['file']=str(init);self.probe['repositories']={'pygas':{'path':str(sdk)}}
  facts=self.guides.record(self.environment,'gpumd.sampling',self.probe);self.assertEqual(facts['source_watch'][0]['files'],['__init__.py'])
  new=base/'discovered.py';new.write_text('newCV=1');self.assertEqual(self.guides.read(self.environment,'gpumd.sampling')['status'],'stale')
  self.guides.record(self.environment,'gpumd.sampling',self.probe);new.rename(base/'renamed.py');self.assertEqual(self.guides.read(self.environment,'gpumd.sampling')['status'],'stale')
 def test_removed_selected_module_is_stale_even_without_importing_it(self):
  sdk=self.root/'sdk';base=sdk/'base';base.mkdir(parents=True);init=base/'__init__.py';init.write_text('initial');extra=base/'discovered.py';extra.write_text('CV=1')
  self.environment['repositories']={'pygas':str(sdk)};self.probe['modules']['pygas']['file']=str(init);self.probe['repositories']={'pygas':{'path':str(sdk)}}
  self.guides.record(self.environment,'gpumd.sampling',self.probe);extra.unlink();self.assertEqual(self.guides.read(self.environment,'gpumd.sampling')['status'],'stale')

if __name__=='__main__':unittest.main()
