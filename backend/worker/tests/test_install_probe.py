import contextlib,hashlib,importlib.util,io,json,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[3]
ROOT=ROOT if (ROOT/'backend/worker').is_dir() else Path.cwd()
spec=importlib.util.spec_from_file_location('probe_runtime',ROOT/'installation/runtime.py');runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
class InstallProbe(unittest.TestCase):
 def test_probe_hashes_registered_files_without_executing_them_or_changing_configuration(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);native=root/'engine';native.write_text('#!/bin/sh\nexit 99\n',encoding='utf-8');native.chmod(0o700);cfg={'compute':{'environment':{'executables':{'python':sys.executable,'gpu-sampling':str(native)},'repositories':{},'variables':{}}}}
   def run(argv,**kwargs):
    self.assertEqual(argv[:2],[sys.executable,'-c']);self.assertEqual(kwargs['env']['PYTHONDONTWRITEBYTECODE'],'1');return json.dumps({'python':'3.10','executable':sys.executable,'modules':{'torch':{'status':'blocked'}},'cuda':{}})
   with patch.object(runtime,'run',side_effect=run) as calls:result=runtime.probe(cfg)
   self.assertEqual(result['status'],'passed');self.assertEqual(calls.call_count,1);self.assertEqual(result['executables']['gpu-sampling']['sha256'],hashlib.sha256(native.read_bytes()).hexdigest());self.assertEqual(result['observation']['executable'],sys.executable);self.assertIn('no native engine launch',result['scope'].lower());self.assertEqual(cfg['compute']['environment']['variables'],{})
 def test_pygas_cannot_resolve_a_generic_base_package_without_a_registered_source(self):
  cfg={'compute':{'environment':{'executables':{'python':sys.executable},'repositories':{},'variables':{}}}}
  def child(argv,**kwargs):
   self.assertEqual(argv[:2],[sys.executable,'-c']);output=io.StringIO()
   with patch('importlib.util.find_spec',side_effect=lambda name:object() if name=='base' else None) as find,patch('importlib.import_module',return_value=types.SimpleNamespace(__file__='/other/base.py')) as imported,contextlib.redirect_stdout(output):
    exec(compile(argv[2],'<probe>','exec'),{})
   imported.assert_not_called();self.assertNotIn('base',[call.args[0] for call in find.call_args_list]);return output.getvalue()
  with patch.object(runtime,'run',side_effect=child):result=runtime.probe(cfg)
  self.assertEqual(result['observation']['modules']['pygas']['status'],'blocked')
 def test_explicit_missing_python_blocks_without_launching_any_command(self):
  with tempfile.TemporaryDirectory() as tmp:
   cfg={'compute':{'environment':{'executables':{'python':str(Path(tmp)/'absent')},'repositories':{},'variables':{}}},'cases':['worker']}
   with patch.object(runtime,'run') as run:result=runtime.probe(cfg)
   self.assertEqual(result['status'],'blocked');self.assertEqual(result['python_check']['status'],'blocked');run.assert_not_called()
 def test_explicit_nonexecutable_file_blocks_even_when_python_imports_work(self):
  with tempfile.TemporaryDirectory() as tmp:
   native=Path(tmp)/'engine';native.write_text('never execute',encoding='utf-8');cfg={'compute':{'environment':{'executables':{'python':sys.executable,'gpumd':str(native)},'repositories':{},'variables':{}}},'cases':['worker']}
   with patch.object(runtime,'run',return_value=json.dumps({'python':'3.12','executable':sys.executable,'modules':{},'cuda':{}})),patch.object(runtime.os,'access',side_effect=lambda file,mode:Path(file)!=native):result=runtime.probe(cfg)
   self.assertEqual(result['status'],'blocked');self.assertEqual(result['executables']['gpumd']['status'],'blocked')
 def test_selected_case_requires_real_imports_while_optional_modules_do_not_block(self):
  cfg={'compute':{'environment':{'executables':{'python':sys.executable},'repositories':{},'variables':{}}},'cases':['reference-md']}
  observed={'python':'3.12','executable':sys.executable,'modules':{'ase':{'status':'passed'},'numpy':{'status':'blocked'},'torch':{'status':'blocked'}},'cuda':{}}
  with patch.object(runtime,'run',return_value=json.dumps(observed)):result=runtime.probe(cfg)
  self.assertEqual(result['status'],'blocked');self.assertEqual(result['required_modules']['numpy']['status'],'blocked');self.assertNotIn('torch',result['required_modules'])
  observed['modules']['numpy']['status']='passed'
  with patch.object(runtime,'run',return_value=json.dumps(observed)):result=runtime.probe(cfg)
  self.assertEqual(result['status'],'passed');self.assertEqual(result['observation']['modules']['torch']['status'],'blocked')
  cfg['cases']=['pydyn-md'];observed['modules'].update(pydyn={'status':'passed'},cupy={'status':'blocked'})
  with patch.object(runtime,'run',return_value=json.dumps(observed)):result=runtime.probe(cfg)
  self.assertEqual(result['status'],'blocked');self.assertEqual(result['required_modules']['cupy']['status'],'blocked');self.assertNotIn('torch',result['required_modules'])
 def test_registered_repository_missing_or_unidentified_blocks_without_altering_it(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);cfg={'compute':{'environment':{'executables':{'python':sys.executable},'repositories':{'pygas':str(root/'absent')},'variables':{}}},'cases':['worker']};observed={'python':'3.12','executable':sys.executable,'modules':{},'cuda':{}}
   with patch.object(runtime,'run',return_value=json.dumps(observed)):result=runtime.probe(cfg)
   self.assertEqual(result['status'],'blocked');self.assertEqual(result['repositories']['pygas']['status'],'blocked');self.assertFalse((root/'absent').exists())
   cfg['compute']['environment']['repositories']['pygas']=str(root)
   with patch.object(runtime,'run',return_value=json.dumps(observed)),patch.object(runtime.subprocess,'run',return_value=types.SimpleNamespace(returncode=1,stdout='')):result=runtime.probe(cfg)
   self.assertEqual(result['status'],'blocked');self.assertEqual(result['repositories']['pygas']['status'],'blocked');self.assertEqual(list(root.iterdir()),[])
 def test_audit_smoke_rejects_nonempty_unowned_worker_before_opening_service(self):
  sys.path.insert(0,str(ROOT/'backend/worker'))
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);database=root/'studio.sqlite';database.write_bytes(b'production registration database');before={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in root.iterdir()};cfg={'_suite_root':str(ROOT),'worker':{'root':str(root)},'_reuse_guard':{'fingerprint':'current','audit_id':'audit'}}
   with patch('studio_worker.service.Service') as service:
    with self.assertRaises(ValueError):runtime.smoke(cfg)
   service.assert_not_called();self.assertEqual({f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in root.iterdir()},before)
 def test_installer_loader_policy_preserves_existing_variables_but_forbids_source_bytecode_writes(self):
  environment={'repositories':{},'variables':{'PYTHONDONTWRITEBYTECODE':'1','OPENBLAS_NUM_THREADS':'1','NUMEXPR_NUM_THREADS':'1'}};self.assertEqual(runtime.target_env(environment)['PYTHONDONTWRITEBYTECODE'],'1');self.assertEqual(environment['variables']['PYTHONDONTWRITEBYTECODE'],'1')
  for key,value in [('PYTHONDONTWRITEBYTECODE','0'),('UNAPPROVED_ENV','1')]:
   with self.assertRaises(ValueError):runtime.target_env({'repositories':{},'variables':{key:value}})
if __name__=='__main__':unittest.main()
