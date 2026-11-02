import ast,builtins,contextlib,copy,importlib.util,io,json,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('smoke_config',ROOT/'scripts/science_smoke_config.py')
config=importlib.util.module_from_spec(spec);spec.loader.exec_module(config)

class ScienceSmokeConfig(unittest.TestCase):
 def value(self,root):
  return {'schema_version':1,'base_dir':str(root/'fresh'),'python':str(root/'registered-python'),'sampling_repository':str(root/'registered-sampling'),
   'repositories':{key:str(root/key) for key in ('pydyn','pygas','hotpp')},'executables':{key:str(root/key) for key in ('gpumd','nep','gpu-sampling')},'skills':{'nep-regression-rmse':str(root/'registered-skill')}}
 def write(self,root,value):
  file=root/'private.json';file.write_text(json.dumps(value),encoding='utf-8');return file
 def test_explicit_config_loads_paths_without_creating_runtime(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);value=self.value(root);loaded=config.load_config(self.write(root,value))
   self.assertEqual(loaded,value);self.assertFalse((root/'fresh').exists())
 def test_missing_config_and_help_return_without_scientific_import_or_mkdir(self):
  with patch.object(Path,'mkdir',side_effect=AssertionError('No runtime directory')),contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
   for args,code in (([],2),(['--help'],0)):
    with self.subTest(args=args),self.assertRaises(SystemExit) as error:config.parse_config_args(args,environ={})
    self.assertEqual(error.exception.code,code)
 def test_explicit_cli_takes_precedence_over_explicit_environment_reference(self):
  with patch.object(config,'load_config',return_value={'selected':True}) as load:
   self.assertEqual(config.parse_config_args(['--config','chosen.json'],environ={config.CONFIG_ENV:'other.json'}),{'selected':True});load.assert_called_once_with('chosen.json')
  with patch.object(config,'load_config',return_value={}) as load:
   config.parse_config_args([],environ={config.CONFIG_ENV:'environment.json'});load.assert_called_once_with('environment.json')
 def test_existing_history_is_preserved_and_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);value=self.value(root);base=root/'fresh';base.mkdir();record=base/'run-record';record.write_bytes(b'synthetic preserved history')
   with self.assertRaisesRegex(ValueError,'fresh isolated'):config.load_config(self.write(root,value))
   self.assertEqual(record.read_bytes(),b'synthetic preserved history')
 def test_partial_relative_and_control_character_paths_are_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);original=self.value(root)
   for change in (lambda v:v.update(python='relative/python'),lambda v:v.update(base_dir='bad\npath'),lambda v:v.pop('repositories'),lambda v:v['executables'].pop('gpumd'),lambda v:v.update(schema_version=True)):
    value=copy.deepcopy(original);change(value)
    with self.subTest(value_keys=sorted(value)),self.assertRaises(ValueError):config.load_config(self.write(root,value))
   self.assertFalse((root/'fresh').exists())
 def test_checkout_configuration_must_stay_ignored(self):
  with self.assertRaisesRegex(ValueError,'ignored'):config.load_config(ROOT/'untracked-private-config.json')
 def test_importing_runner_initializes_no_science_or_service(self):
  original=builtins.__import__;seen=[]
  def guarded(name,*args,**kwargs):
   if name.split('.')[0] in ('studio_worker','ase','numpy','yaml','torch','cupy'):raise AssertionError('Scientific import before explicit config')
   seen.append(name);return original(name,*args,**kwargs)
  runner_spec=importlib.util.spec_from_file_location('portable_smoke_runner',ROOT/'scripts/science-smoke.py');runner=importlib.util.module_from_spec(runner_spec)
  with patch('builtins.__import__',side_effect=guarded),patch.object(Path,'mkdir',side_effect=AssertionError('No runtime directory')):runner_spec.loader.exec_module(runner)
  self.assertFalse(hasattr(runner,'service'));self.assertFalse(hasattr(runner,'BASE'))
 def test_actual_cli_entry_gates_before_runtime_and_retains_cleanup(self):
  tree=ast.parse((ROOT/'scripts/science-smoke.py').read_text(encoding='utf-8'));entry=tree.body[-1]
  self.assertIsInstance(entry,ast.If)
  compiled=compile(ast.Module(body=[entry],type_ignores=[]),'runner-entry-only','exec')
  for exit_code in (0,2,None):
   calls=[]
   def parse():
    calls.append('parse')
    if exit_code is not None:raise SystemExit(exit_code)
    return {'explicit':True}
   def configure(value):self.assertEqual(value,{'explicit':True});calls.append('configure')
   namespace={'__name__':'__main__','configure':configure,'main':lambda:calls.append('main'),'service':types.SimpleNamespace(close=lambda:calls.append('close')),'evidence':lambda:calls.append('evidence')}
   with patch.dict('sys.modules',{'science_smoke_config':types.SimpleNamespace(parse_config_args=parse)}):
    if exit_code is not None:
     with self.assertRaises(SystemExit) as error:exec(compiled,namespace)
     self.assertEqual(error.exception.code,exit_code);self.assertEqual(calls,['parse'])
    else:exec(compiled,namespace);self.assertEqual(calls,['parse','configure','main','close','evidence'])

if __name__=='__main__':unittest.main()
