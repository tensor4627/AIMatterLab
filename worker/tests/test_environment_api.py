"""Selected-environment public API boundaries, using synthetic source and receipts only."""
import copy,json,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
from studio_worker import environment_api as api,runtime_guides as guides,server
# Independent fixed fixture map: expanding product file scope requires reviewing fixtures too.
FIXTURE_METHODS={
'pydyn/dynamics/driver.py':{'Simulation':('__init__','run','prepare','attach','finalize')},
'pydyn/dynamics/ensembles/nvt.py':{'NVTBerendsen':('__init__',),'NVTNoseHoover':('__init__',)},
'pydyn/dynamics/ensembles/npt.py':{'MTTKNPT':('__init__',)},
'pydyn/context.py':{'SimulationContext':('__init__',),'TargetStress':('__init__',)},
'pydyn/state.py':{'State':('__init__','from_atoms')},
'pydyn/forces/base.py':{'ForceModel':('__init__',)},
'pydyn/forces/hotpp_force.py':{'MiaoForceModel':('__init__','neighbor_request','build_input','map_properties','run_model','update_results')},
'pydyn/sampling/integrations/pydyn.py':{'PyGASForceModel':('__init__','validate','neighbor_request','on_initialize','before_step','geometry_changed','after_step','on_finalize','compute'),'BiasedForceEvaluator':('__init__','validate_properties','invalidate','begin_batch','end_batch','compute')},
'pydyn/sampling/runtime.py':{'SamplingConfig':('__post_init__','route'),'BiasRuntime':('__init__','evaluate','evaluate_masked','commit','state_dict','load_state_dict')},
'pydyn/sampling/__init__.py':{},
}
class Store:
 def __init__(self,project,env):self.data={'project':{project['id']:project},'environment':{env['id']:env}}
 def get(self,k,i):return self.data[k][i]
 def list(self,k):return list(self.data.get(k,{}).values())
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='studio-api-test-');self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.repo=self.root/'public';self.repo.mkdir();self.python=self.root/'python';self.python.write_text('identity only; never execute')
  for name,classes in FIXTURE_METHODS.items():
   p=self.repo/name;p.parent.mkdir(parents=True,exist_ok=True);code=''
   for cls,methods in classes.items():
    code+='class '+cls+':\n'
    if cls=='SamplingConfig':code+='    mode: str = "wtmetad"\n    limit: int = dangerous_default()\n'
    for method in methods:code+='    def '+method+'(self, value=None):\n        return value\n'
    if not methods and cls!='SamplingConfig':code+='    pass\n'
   p.write_text(code or '# fixed export metadata\n')
  for name in guides.SAMPLING_PROVENANCE:(self.repo/name).write_text(json.dumps({'commit':'a'*40,'version':'v1','repository':'https://example.test/public.git','unknown_secret':'never-return','source':'public integration'}))
  self.env={'id':'target','name':'synthetic target','executables':{'python':str(self.python)},'repositories':{'pydyn':str(self.repo)},'variables':{}}
  self.project={'id':'project','authoring_only':True,'policy':{'environments':['target'],'engines':[]}}
  self.service=types.SimpleNamespace(root=self.root,store=Store(self.project,self.env));self.probe={'scope':{'engine':'pydyn.sampling'},'executable':str(self.python),'modules':{'pydyn':{'file':str(self.repo/'pydyn/__init__.py'),'status':'passed'}},'repositories':{'pydyn':{'path':str(self.repo),'commit':'a'*40,'dirty':False,'status':'passed'}},'pydyn_sampling':True,'pydyn_sampling_origin':str(self.repo/'pydyn/sampling/__init__.py'),'pygas_upstream':{'commit':'a'*40}}
  (self.repo/'pydyn/__init__.py').write_text('# synthetic package, never imported\n');self.record();self.data={'project_id':'project','environment_id':'target','engine':'pydyn.sampling'}
  self.git=patch.object(api,'git_identity',return_value={'commit':'a'*40,'dirty':False,'status_sha256':'b'*64});self.git.start();self.addCleanup(self.git.stop)
 def record(self):return guides.RuntimeGuides(self.root/'runtime-guides').record(self.env,'pydyn.sampling',self.probe)
 def read(self,**extra):return api.inspect(self.service,{**self.data,**extra})
 def error(self,code,fn):
  with self.assertRaises(api.ApiReadError)as cm:fn()
  self.assertEqual(cm.exception.code,code)
 def test_authoring_only_empty_job_grant_read_passes_and_does_not_grant(self):
  before=copy.deepcopy(self.service.store.data);r=self.read();self.assertEqual(r['status'],'passed');self.assertTrue(r['partial']);self.assertEqual(before,self.service.store.data);self.assertEqual(self.project['policy']['engines'],[]);
  from studio_worker.service import Service
  with self.assertRaisesRegex(PermissionError,'Engine is not authorized'):Service.authorize(self.service,{'project_id':'project','environment_id':'target','engine':'pydyn.sampling','gpu':0,'max_seconds':300})
  self.assertFalse((self.root/'runs').exists())
 def test_core_sampling_miao_and_exact_driver_lifecycle_advertised(self):
  ids={v['symbol_id']for v in self.read()['api']}
  for value in ['pydyn/state.py::State.from_atoms','pydyn/forces/hotpp_force.py::MiaoForceModel.build_input','pydyn/dynamics/driver.py::Simulation.prepare','pydyn/dynamics/driver.py::Simulation.attach','pydyn/dynamics/driver.py::Simulation.finalize','pydyn/sampling/runtime.py::SamplingConfig']:self.assertIn(value,ids)
 def test_excerpt_is_exact_source_with_unevaluated_defaults_no_import_or_eval(self):
  import builtins
  real=builtins.__import__
  def importing(name,*a,**kw):
   if name.split('.')[0]in ('pydyn','torch','ase','cupy','base'):raise AssertionError('target import')
   return real(name,*a,**kw)
  with patch.object(builtins,'__import__',side_effect=importing),patch.object(builtins,'eval',side_effect=AssertionError('eval')):
   r=self.read(api_symbols=['pydyn/sampling/runtime.py::SamplingConfig','pydyn/forces/hotpp_force.py::MiaoForceModel.build_input'])
  self.assertEqual(len(r['api_excerpts']['symbols']),2);self.assertIn('dangerous_default()',r['api_excerpts']['symbols'][0]['code'])
 def test_compute_without_job_engine_grant_still_read_allowed(self):self.project['authoring_only']=False;self.assertEqual(self.read()['status'],'passed')
 def test_denied_environment(self):self.project['policy']['environments']=[];self.error('access_denied',self.read)
 def test_wrong_route(self):self.error('invalid_input',lambda:self.read(engine='pydyn.md'))
 def test_caller_root_rejected(self):self.error('invalid_input',lambda:self.read(root=str(self.repo)))
 def test_selector_traversal(self):self.error('invalid_input',lambda:self.read(api_symbols=['../private.py::X']))
 def test_five_selectors(self):self.error('invalid_input',lambda:self.read(api_symbols=['x.py::X'+str(i)for i in range(5)]))
 def test_duplicate_selector(self):self.error('invalid_input',lambda:self.read(api_symbols=['x.py::X']*2))
 def test_unsupported_selector_no_global_fallback(self):self.error('unsupported_symbol',lambda:self.read(api_symbols=['pydyn/global.py::Hidden']))
 def test_stale_source(self):(self.repo/'pydyn/state.py').write_text('# changed');self.error('observed_runtime_required',self.read)
 def test_missing_observed_body_not_inferred_from_init(self):
  guide=guides.RuntimeGuides(self.root/'runtime-guides').read(self.env,'pydyn.sampling');guide['facts']['file_observations']=[x for x in guide['facts']['file_observations']if not x['path'].endswith('state.py')]
  with patch.object(api.RuntimeGuides,'read',return_value=guide):self.error('api_source_observation_missing',self.read)
 def test_old_guide_missing_json_observation_typed(self):
  guide=guides.RuntimeGuides(self.root/'runtime-guides').read(self.env,'pydyn.sampling');del guide['facts']['sampling_provenance']
  with patch.object(api.RuntimeGuides,'read',return_value=guide):self.error('api_provenance_observation_missing',self.read)
 def test_git_changed(self):
  with patch.object(api,'git_identity',return_value={'commit':'c'*40,'dirty':False}):self.error('git_identity_changed',self.read)
 def test_wrong_origin(self):
  guide=guides.RuntimeGuides(self.root/'runtime-guides').read(self.env,'pydyn.sampling');guide['facts']['capabilities']['pydyn_sampling']['origin']=str(self.root/'ordinary/__init__.py')
  with patch.object(api.RuntimeGuides,'read',return_value=guide):self.error('runtime_origin_mismatch',self.read)
 def test_json_changed_blocks_strict_API_but_module_scope_remains(self):
  (self.repo/guides.SAMPLING_PROVENANCE[0]).write_text('{}');g=guides.RuntimeGuides(self.root/'runtime-guides').read(self.env,'pydyn.sampling');self.assertEqual(g['status'],'observed');self.assertEqual(g['api_provenance']['status'],'stale');self.error('api_provenance_observation_missing',self.read)
 def test_json_unknown_and_url_credentials_not_emitted(self):
  p=self.repo/guides.SAMPLING_PROVENANCE[0];p.write_text(json.dumps({'repository':'https://user:secret@example.test/a?token=bad','unknown_secret':'never-return','commit':'a'*40}));self.record();r=self.read();s=json.dumps(r['provenance']);self.assertNotIn('secret',s);self.assertNotIn('token',s);self.assertNotIn('repository',json.dumps(r['provenance']['files'][0]['public']))
 def test_json_symlink_refused(self):
  p=self.repo/guides.SAMPLING_PROVENANCE[0];p.unlink();outside=self.root/'outside.json';outside.write_text('{}')
  try:p.symlink_to(outside)
  except OSError:self.skipTest('OS symlink privilege unavailable')
  self.error('api_provenance_observation_missing',self.read)
 def test_source_symlink_refused(self):
  p=self.repo/'pydyn/state.py';p.unlink();outside=self.root/'outside.py';outside.write_text('class State: pass')
  try:p.symlink_to(outside)
  except OSError:self.skipTest('OS symlink privilege unavailable')
  self.error('observed_runtime_required',self.read)
 def test_excerpt_budget_no_truncation(self):
  p=self.repo/'pydyn/dynamics/driver.py';p.write_text('class Simulation:\n    def run(self):\n'+''.join('        # '+('x'*200)+'\n'for _ in range(90))+'        return None\n');self.record();self.error('excerpt_budget',lambda:self.read(api_symbols=['pydyn/dynamics/driver.py::Simulation.run']))
 def test_single_file_budget(self):
  p=self.repo/'pydyn/state.py';p.write_text('#'+'x'*262144);self.record();self.error('unsafe_source',self.read)
 def test_mutation_during_read(self):
  old=api.extract
  def mutate(*a):
   self.project['policy']['environments']=[];return old(*a)
  with patch.object(api,'extract',side_effect=mutate):self.error('source_changed',self.read)
 def test_total_input_budget(self):
  for name in list(FIXTURE_METHODS)[:9]:(self.repo/name).write_text('#'+('x'*240000))
  self.record();self.error('input_budget',self.read)
 def test_ambiguous_public_class_refused(self):
  p=self.repo/'pydyn/state.py';p.write_text('class State:\n    pass\nclass State:\n    pass\n');self.record();self.error('ambiguous_symbol',self.read)
 def test_missing_lifecycle_not_inferred(self):
  p=self.repo/'pydyn/dynamics/driver.py';p.write_text('class Simulation:\n    def run(self,n): return n\n');self.record();self.assertNotIn('pydyn/dynamics/driver.py::Simulation.prepare',[v['symbol_id']for v in self.read()['api']])
 def test_metadata_budget(self):
  with patch.object(api,'extract',side_effect=lambda name,*a:{name:{'symbol_id':name,'source':{'description':'x'*33000},'code':''}}):self.error('metadata_budget',self.read)
 def test_old_guide_stays_readable_but_inspector_requires_new_provenance(self):
  g=guides.RuntimeGuides(self.root/'runtime-guides');facts=g.read(self.env,'pydyn.sampling')['facts'];del facts['sampling_provenance'];g._commit(facts);self.assertEqual(g.read(self.env,'pydyn.sampling')['status'],'observed');self.error('api_provenance_observation_missing',self.read)
 def test_normal_probe_missing_one_JSON_keeps_observed_scope_and_strict_API_denies(self):
  (self.repo/guides.SAMPLING_PROVENANCE[1]).unlink();facts=self.record();self.assertEqual(facts['state'],'observed');self.assertTrue(facts['capabilities']['pydyn_sampling']['available']);self.assertEqual(facts['sampling_provenance']['status'],'not_recorded');g=guides.RuntimeGuides(self.root/'runtime-guides').read(self.env,'pydyn.sampling');self.assertEqual(g['status'],'observed');self.assertEqual(g['api_provenance']['status'],'not_recorded');self.error('api_provenance_observation_missing',self.read)
 def test_admin_endpoint_direct_mcp_rejected_zero_reader(self):
  with patch.object(api,'inspect',side_effect=AssertionError('dispatched')):
   with self.assertRaises(PermissionError):server.dispatch(self.service,'POST','/api/environment-api/read',self.data,admin=False)
  self.assertFalse(any(t['name']=='inspect_environment_api'for t in server.tools()))
 def test_real_admin_endpoint_passes_read_and_classifies_failure(self):
  self.assertEqual(server.dispatch(self.service,'POST','/api/environment-api/read',self.data,admin=True)['status'],'passed');v=server.dispatch(self.service,'POST','/api/environment-api/read',{**self.data,'api_symbols':['x.py::X']},admin=True);self.assertEqual(v['operation_state'],'read_started');self.assertEqual(v['status'],'blocked')
class GraphContractTests(unittest.TestCase):
 def test_derived_constructor_value_is_rejected_without_mutation(self):
  from studio_worker import pygas_values as values
  graph={'nodes':[{'id':'cv','kind':'cv','class_name':'Example','params':{'n_atoms':32}}]};before=copy.deepcopy(graph)
  with self.assertRaisesRegex(ValueError,r'nodes\[0\].*n_atoms.*omit'):values.normalize_graph(graph,{'cv':[{'name':'Example','params':[{'name':'n_atoms','required':True,'type_hint':'int'}]}]})
  self.assertEqual(graph,before)
 def test_reducer_error_names_correct_storage_path_and_preserves_value(self):
  from studio_worker import pygas_values as values
  graph={'nodes':[{'id':'mean','kind':'reduce','operation':'mean'}]};before=copy.deepcopy(graph)
  with self.assertRaisesRegex(ValueError,r'nodes\[0\].*operation.*params.operation'):values.normalize_graph(graph,{})
  self.assertEqual(graph,before);graph['nodes'][0].pop('operation');graph['nodes'][0]['params']={'operation':'mean'};self.assertEqual(values.normalize_graph(graph,{},require_complete=True)['nodes'][0]['params']['operation'],'mean')
 def test_contract_tracks_actual_validator_bytes_and_constants(self):
  import hashlib
  from studio_worker import pygas_values as values
  contract=values.studio_graph_input_contract();self.assertEqual(contract['source']['sha256'],hashlib.sha256(Path(values.__file__).read_bytes()).hexdigest());self.assertEqual(set(contract['allowed_properties']['node']),values.NODE_KEYS);self.assertEqual(contract['reduce']['parameter_path'],'params.operation');self.assertEqual(set(contract['structure_derived']['parameter_names']),values.STRUCTURE_DERIVED_PARAMS)
 def test_unknown_fields_do_not_echo_value_or_unsafe_id(self):
  from studio_worker import pygas_values as values
  graph={'nodes':[{'id':'unsafe\nlabel','kind':'reduce','unknown_key':'DO_NOT_ECHO','params':{'operation':'mean'}}]}
  with self.assertRaises(ValueError)as cm:values.normalize_graph(graph,{})
  self.assertIn('unknown_key',str(cm.exception));self.assertNotIn('DO_NOT_ECHO',str(cm.exception));self.assertNotIn('unsafe\nlabel',str(cm.exception))
if __name__=='__main__':unittest.main()
