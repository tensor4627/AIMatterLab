"""Runtime metadata projection only; synthetic receipts, no target imports/probe."""
import copy,hashlib,importlib.util,json,pathlib,sys,tempfile,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from studio_worker import runtime_projection as projection,server
from studio_worker.runtime_guides import RuntimeGuides

def receipt(facts,status=None):
 return {'status':status or facts['state'],'receipt':hashlib.sha256((json.dumps(facts,ensure_ascii=False,indent=2)+'\n').encode()).hexdigest(),'skill_sha256':'e'*64,'facts':facts}
def fixture():
 return receipt({'schema_version':1,'environment_id':'selected','engine':'pydyn.sampling','configuration_sha256':'c'*64,'state':'observed','observed_at':1,
  'python':{'executable':'/registered/python','version':'3.12\nactual version','registration_match':True},'executables':{'python':'/registered/python'},
  'repositories':{'pydyn':{'path':'/public/.codex/worktrees/synthetic/pydyn','commit':None,'dirty':None,'status':'not_run'}},
  'modules':{'pydyn':{'file':'/public/.codex/worktrees/synthetic/pydyn/pydyn/__init__.py','version':'0.1','source_sha256':'a'*64,'status':'passed','registration_match':True}},
  'capabilities':{'pygas':{},'pydyn_sampling':{'available':True,'origin':'/public/.codex/worktrees/synthetic/pydyn/pydyn/sampling/__init__.py','upstream':{'commit':'b'*40,'version':'public-v1'}}},
  'native_runtime':{'status':'not_run','scope':'No native ELF check for this route'},'cuda':{'available':True,'version':'12.8','gpu':'synthetic GPU'},'scientific_status':'not_run'})
ARGS={'environment_id':'selected','engine':'pydyn.sampling'}
class ProjectionTests(unittest.TestCase):
 def call(self,value,args=ARGS):
  with patch.object(server,'dispatch',return_value=value):return server.mcp_tool_call(object(),{'name':'read_runtime_guide','arguments':args})
 def test_actual_mcp_three_paths_hash_only_and_raw_receipt_unchanged(self):
  raw=fixture();before=copy.deepcopy(raw);r=self.call(raw);self.assertFalse(r['isError']);v=json.loads(r['content'][0]['text']);self.assertNotIn('.codex',json.dumps(v));self.assertEqual(raw,before);self.assertEqual(v['receipt'],raw['receipt']);self.assertEqual(v['environment_id'],'selected');self.assertEqual(v['engine'],'pydyn.sampling');self.assertEqual(v['facts']['repositories']['pydyn']['commit'],None);self.assertEqual(v['facts']['repositories']['pydyn']['status'],'not_run')
  for item,key,original,role in[(v['facts']['repositories']['pydyn'],'path',raw['facts']['repositories']['pydyn']['path'],'registered_source:pydyn'),(v['facts']['modules']['pydyn'],'file',raw['facts']['modules']['pydyn']['file'],'imported_module:pydyn'),(v['facts']['capabilities']['pydyn_sampling'],'origin',raw['facts']['capabilities']['pydyn_sampling']['origin'],'sampling_module_origin')]:
   self.assertNotIn(key,item);self.assertEqual(item[key+'_identity'],{'role':role,'available':True,'redacted':True,'path_sha256':hashlib.sha256(original.encode()).hexdigest()})
  self.assertTrue(v['projection']['source_path_fields_redacted']);self.assertNotIn('path_fields_redacted',v['projection']);self.assertIn('does not hash',v['projection']['receipt_scope']);self.assertEqual(v['facts']['python']['executable'],'/registered/python')
 def test_all_known_software_modules_redact_consistently(self):
  f=fixture()['facts'];f['repositories']={n:{'path':'/public/.codex/worktrees/'+n}for n in projection.KNOWN_SOFTWARE};f['modules']={n:{'file':'/public/.codex/worktrees/'+n+'.py'}for n in projection.KNOWN_MODULES};v=projection.guide_for_agent(receipt(f),ARGS);self.assertNotIn('.codex',json.dumps(v));self.assertEqual(len(v['facts']['modules']),6);self.assertEqual(len(v['facts']['repositories']),5)
 def test_none_module_and_sampling_origin_are_unavailable_not_error(self):
  f=fixture()['facts'];f['engine']='pydyn.md';f['capabilities']['pydyn_sampling'].update(available=False,origin=None);f['modules']['cupy']={'file':None,'version':None,'status':'blocked'};raw=receipt(f);v=projection.guide_for_agent(raw,{'environment_id':'selected','engine':'pydyn.md'});self.assertEqual(v['status'],'observed');self.assertFalse(v['facts']['capabilities']['pydyn_sampling']['available']);self.assertIsNone(v['facts']['capabilities']['pydyn_sampling']['origin']);self.assertNotIn('path_sha256',v['facts']['capabilities']['pydyn_sampling']['origin_identity']);self.assertFalse(v['facts']['modules']['cupy']['file_identity']['available'])
 def test_real_ordinary_md_guide_with_unavailable_sampling_remains_observed(self):
  with tempfile.TemporaryDirectory(prefix='runtime-view-')as tmp:
   root=pathlib.Path(tmp);repo=root/'public';(repo/'pydyn').mkdir(parents=True);module=repo/'pydyn/__init__.py';module.write_text('# synthetic source, never import');env={'id':'selected','executables':{'python':sys.executable},'repositories':{'pydyn':str(repo)}};probe={'scope':{'engine':'pydyn.md'},'executable':sys.executable,'python':sys.version,'modules':{'pydyn':{'file':str(module),'status':'passed'}},'repositories':{'pydyn':{'path':str(repo),'commit':None,'dirty':None,'status':'not_run'}},'pydyn_sampling':False,'pydyn_sampling_origin':None};g=RuntimeGuides(root/'guides');g.record(env,'pydyn.md',probe);raw=g.read(env,'pydyn.md');self.assertEqual(raw['status'],'observed');before=copy.deepcopy(raw);view=projection.guide_for_agent(raw,{'environment_id':'selected','engine':'pydyn.md'});self.assertEqual(view['status'],'observed');self.assertIsNone(view['facts']['capabilities']['pydyn_sampling']['origin']);self.assertEqual(raw,before)
 def test_real_md_upstream_descriptive_commit_markers_preserve_raw_value(self):
  with tempfile.TemporaryDirectory(prefix='runtime-upstream-view-')as tmp:
   root=pathlib.Path(tmp);repo=root/'public';(repo/'pydyn').mkdir(parents=True);module=repo/'pydyn/__init__.py';module.write_text('# synthetic source, never import');env={'id':'selected','executables':{'python':sys.executable},'repositories':{'pydyn':str(repo)}};g=RuntimeGuides(root/'guides')
   for marker in('A'*40,'unknown'):
    with self.subTest(marker=marker):
     probe={'scope':{'engine':'pydyn.md'},'executable':sys.executable,'python':sys.version,'modules':{'pydyn':{'file':str(module),'status':'passed'}},'repositories':{'pydyn':{'path':str(repo),'commit':None,'dirty':None,'status':'not_run'}},'pydyn_sampling':False,'pydyn_sampling_origin':None,'pygas_upstream':{'commit':marker}}
     g.record(env,'pydyn.md',probe);raw=g.read(env,'pydyn.md');before=copy.deepcopy(raw);v=projection.guide_for_agent(raw,{'environment_id':'selected','engine':'pydyn.md'});self.assertEqual(v['status'],'observed');self.assertEqual(v['facts']['capabilities']['pydyn_sampling']['upstream']['commit'],marker);self.assertEqual(v['facts']['repositories']['pydyn']['status'],'not_run');self.assertEqual(raw,before)
 def test_blocked_real_probe_receipt_and_missing_native_module_do_not_upgrade(self):
  with tempfile.TemporaryDirectory(prefix='runtime-blocked-view-')as tmp:
   env={'id':'selected','executables':{'python':sys.executable}};g=RuntimeGuides(pathlib.Path(tmp));g.record_failure(env,'gpumd.md',RuntimeError('synthetic failure'));raw=g.read(env,'gpumd.md');v=projection.guide_for_agent(raw,{'environment_id':'selected','engine':'gpumd.md'});self.assertEqual(v['status'],'blocked');self.assertEqual(v['facts']['probe_status'],'failed')
  f=fixture()['facts'];f['state']='blocked';f['modules']['ase']={'file':None,'version':None,'status':'blocked'};f['native_runtime']={'status':'blocked','executable':None,'sha256':None,'scope':'Unavailable native executable'};v=projection.guide_for_agent(receipt(f),ARGS);self.assertEqual(v['status'],'blocked');self.assertIsNone(v['facts']['native_runtime']['executable']);self.assertEqual(v['facts']['modules']['ase']['status'],'blocked')
 def test_unknown_nested_fields_not_forwarded(self):
  f=fixture()['facts'];f['unknown_body']={'body':'SENTINEL'};f['python']['unknown_body']={'body':'SENTINEL'};f['modules']['pydyn']['body']='SENTINEL';f['modules']['unknown']={'file':'SENTINEL','body':'SENTINEL'};f['capabilities']['unknown']={'body':'SENTINEL'};f['capabilities']['pydyn_sampling']['body']='SENTINEL';f['capabilities']['pydyn_sampling']['upstream']['unknown']={'body':'SENTINEL'};v=projection.guide_for_agent(receipt(f),ARGS);self.assertNotIn('SENTINEL',json.dumps(v))
 def test_known_nested_body_leaves_are_rejected(self):
  paths=[('python','version'),('native_runtime','scope'),('cuda','gpu'),('cuda','version'),('repositories','pydyn','commit'),('modules','pydyn','version'),('modules','pydyn','file'),('capabilities','pydyn_sampling','upstream','version'),('capabilities','pydyn_sampling','upstream','commit'),('capabilities','pydyn_sampling','available')]
  for path in paths:
   for body in[{'body':'SENTINEL'},['SENTINEL']]:
    with self.subTest(path=path,body=type(body).__name__):
     f=fixture()['facts'];v=f
     for key in path[:-1]:v=v[key]
     v[path[-1]]=body;r=self.call(receipt(f));self.assertTrue(r['isError']);self.assertNotIn('SENTINEL',r['content'][0]['text'])
  f=fixture()['facts'];f['capabilities']['sampling']={'body':'SENTINEL'};self.assertTrue(self.call(receipt(f))['isError'])
 def test_hash_commit_flag_and_length_types_are_checked(self):
  for change in[lambda f:f['repositories']['pydyn'].update(commit='notcommit'),lambda f:f['modules']['pydyn'].update(source_sha256='notsha'),lambda f:f['python'].update(registration_match=1),lambda f:f['python'].update(version='x'*2049),lambda f:f['cuda'].update(available='yes'),lambda f:f.update(observed_at=float('inf'))]:
   f=fixture()['facts'];change(f)
   with self.assertRaises(ValueError):projection.guide_for_agent(receipt(f),ARGS)
 def test_expected_environment_engine_and_raw_receipt_mutations_rejected(self):
  for change in[lambda v:v.update(environment_id='other'),lambda v:v['facts'].update(environment_id='other'),lambda v:v.update(engine='pydyn.md'),lambda v:v['facts'].update(engine='pydyn.md'),lambda v:v.update(receipt='0'*64),lambda v:v.update(status='blocked')]:
   v=fixture();change(v);self.assertTrue(self.call(v)['isError'])
 def test_untouched_other_paths_stay_present_for_generic_guard(self):
  f=fixture()['facts'];f['native_runtime']['scope']='/protected/.ssh/hidden';v=projection.guide_for_agent(receipt(f),ARGS);self.assertEqual(v['facts']['native_runtime']['scope'],'/protected/.ssh/hidden');self.assertEqual(v['facts']['python']['executable'],'/registered/python')
 def test_stale_and_not_run_no_facts_preserve_status_and_selected_identity(self):
  for status in('stale','not_run','blocked'):
   v=projection.guide_for_agent({'status':status,'environment_id':'selected','engine':'pydyn.sampling','reason':'actual missing observation'},ARGS);self.assertEqual(v['status'],status);self.assertNotIn('facts',v)
 def test_other_tool_result_is_unchanged(self):
  value={'private_path':'/protected/.ssh/key'};self.assertIs(projection.result_for_agent('read_project_input',value),value)
if __name__=='__main__':unittest.main()
