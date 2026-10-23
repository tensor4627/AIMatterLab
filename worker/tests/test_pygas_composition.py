import sys,tempfile,json,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.service import Service
from studio_worker.server import dispatch,tools
from studio_worker.pygas_composition import save,response,resolve_input,assets
from unittest.mock import patch

class CompositionService(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);root=Path(self.temp.name).resolve();self.repo=root/'repo';(self.repo/'tools').mkdir(parents=True);(self.repo/'base').mkdir()
  (self.repo/'tools/cv_bias_gui_server.py').write_text("EXCLUDED_CV=set()\nEXCLUDED_BIAS=set()\nEXCLUDED_SWITCH=set()\nEXCLUDED_NEIGHBOR=set()\nFORWARD_ARG_MAP={'pos':'pos'}\nCV_OUTPUT_SIZES={'ExampleCV':1}\nraise RuntimeError('CATALOG MUST NOT IMPORT')\n",encoding='utf8')
  for name in ('colvar','bias','neighbor','switch'):(self.repo/'base'/f'{name}.py').write_text(('class ExampleCV:\n def __init__(self, n_atoms:int, cutoff:float):pass\n def forward(self,pos):pass\n' if name=='colvar' else '# no classes\n'),encoding='utf8')
  self.service=Service(root/'worker',schedule=False);self.addCleanup(self.close)
  self.env=self.service.register_environment({'id':'authoring','name':'test','executables':{'python':sys.executable}})
  self.project=self.service.register_project({'id':'owned','name':'test','policy':{'input_roots':[str(root/'permitted')],'environments':['authoring']}})
  self.service.store.put('source-project',{'id':'pygas','root':str(self.repo)})
  self.data={'project_id':'owned','environment_id':'authoring','source_id':'pygas','workspace_id':'conversation'}
  self.graph={'parameter_format':'structured-v1','version':2,'mode':'cvonly','settings':{},'nodes':[{'id':'cv','kind':'cv','class_name':'ExampleCV','params':{}}],'edges':[]}
 def close(self):self.service.close();self.service.store.db.close()
 def test_incomplete_graph_persists_same_pair_without_import_or_execution(self):
  first=save(self.service,{**self.data,'graph':self.graph});self.assertEqual(first['composition']['status'],'draft');self.assertIn('cv.cutoff',first['missing_fields']);self.assertFalse(Path(first['composition']['sourcePath']).exists());self.assertEqual(self.service.store.runs(),[])
  second=save(self.service,{**self.data,'path':first['composition']['graphPath'],'expected':first['composition']['expected'],'catalog_files':first['catalog']['source']['files'],'graph':{**self.graph,'nodes':[{'id':'cv','kind':'cv','class_name':'ExampleCV','params':{'cutoff':3.0}}]}})
  self.assertEqual(first['composition']['graphPath'],second['composition']['graphPath']);self.assertNotIn('cv.cutoff',second['missing_fields']);self.assertTrue(second['render_blocked'])
  with self.assertRaisesRegex(ValueError,'hash conflict'):save(self.service,{**self.data,'path':first['composition']['graphPath'],'expected':first['composition']['expected'],'graph':self.graph})
 def test_reopening_existing_pair_requires_cas_and_current_catalog(self):
  first=save(self.service,{**self.data,'graph':self.graph})
  with self.assertRaisesRegex(ValueError,'current graph/source'):save(self.service,{**self.data,'graph':self.graph})
  with self.assertRaisesRegex(ValueError,'Catalog changed'):save(self.service,{**self.data,'expected':first['composition']['expected'],'catalog_files':{},'graph':self.graph})
 def test_legacy_executable_expression_is_never_evaluated_or_saved(self):
  graph={**self.graph,'parameter_format':'legacy','nodes':[{'id':'cv','kind':'cv','class_name':'ExampleCV','params':{'cutoff':"__import__('os').system('touch forbidden')"}}]}
  with self.assertRaisesRegex(ValueError,'Arbitrary calls'):save(self.service,{**self.data,'graph':graph})
  self.assertEqual(response(self.service,self.data)['graph'],None)
 def test_foreign_pair_and_file_reads_never_gain_authorization(self):
  with self.assertRaisesRegex(ValueError,'owned unlinked'):response(self.service,{**self.data,'path':str(self.repo/'workflow.json')})
  with self.assertRaisesRegex(ValueError,'authorized roots'):resolve_input(str(self.repo/'foreign.xyz'),self.repo,[],self.service.root/'projects/owned/inputs',self.project)
  with self.assertRaises(PermissionError):dispatch(self.service,'POST','/api/pygas/composition/read',self.data,admin=False)
 def test_asset_listing_never_hashes_unselected_project_contents(self):
  root=self.service.root/'projects/owned/inputs';root.mkdir(parents=True);target=root/'large-trajectory.xyz'
  with target.open('wb') as stream:stream.truncate(64*1024*1024)
  self.service.store.put('artifact',{'id':'trajectory','project_id':'owned','name':target.name,'path':str(target),'kind':'structure','sha256':'a'*64})
  with patch('studio_worker.pygas_composition.digest',side_effect=AssertionError('Unselected files must not be read')):
   result=assets(self.service,self.project,root)
  self.assertEqual(len(result),1);self.assertEqual(result[0]['sha256'],'a'*64);self.assertIn('recorded_metadata',result[0]['hash_status'])
 def test_catalog_reader_is_public_bounded_and_legacy_generator_retired(self):
  result=dispatch(self.service,'POST','/api/pygas/catalog',{'source_id':'pygas','classes':['ExampleCV']});self.assertEqual(result['catalog']['cv'][0]['params'][1]['name'],'cutoff')
  with self.assertRaises(PermissionError):dispatch(self.service,'POST','/api/pygas/catalog',{'source_id':'pygas','all':True})
  with self.assertRaisesRegex(ValueError,'retired'):dispatch(self.service,'POST','/api/templates/bias',{'parameters':{}})
  names={t['name']:t for t in tools()};self.assertNotIn('generate_bias',names);self.assertTrue(names['inspect_pygas_catalog']['annotations']['readOnlyHint'])

class EmptyCompositionInitialization(unittest.TestCase):
 setUp=CompositionService.setUp
 close=CompositionService.close
 def request(self,**changes):
  current=response(self.service,self.data)
  return {**self.data,'expected':{'journal_sha256':None,'files':{}},'catalog_files':current['catalog']['source']['files'],'files':[],**changes}
 def test_empty_init_is_create_only_cvonly_draft_without_code_render_or_run(self):
  from studio_worker.pygas_composition import initialize
  request=self.request()
  with patch('studio_worker.pygas_composition.run_json',side_effect=AssertionError('No source renderer or engine may run')):
   result=initialize(self.service,request)
  self.assertEqual(result['composition']['status'],'draft');self.assertTrue(result['render_blocked']);self.assertEqual(result['graph']['mode'],'cvonly');self.assertEqual(result['graph']['nodes'],[]);self.assertEqual(result['graph']['edges'],[]);self.assertIsNone(result['composition']['source_sha256']);self.assertFalse(Path(result['composition']['sourcePath']).exists());self.assertEqual(self.service.store.runs(),[])
  with self.assertRaisesRegex(ValueError,'already exist'):initialize(self.service,request)
  self.assertEqual(response(self.service,self.data)['composition']['expected'],result['composition']['expected'])
 def test_mcp_and_extra_caller_data_cannot_initialize(self):
  from studio_worker.pygas_composition import initialize
  request=self.request()
  with self.assertRaises(PermissionError):dispatch(self.service,'POST','/api/pygas/composition/initialize',request,admin=False)
  self.assertNotIn('initialize_composition',{t['name']for t in tools()})
  for extra in ({'path':'/foreign/workflow.json'},{'graph':{}},{'expected':None},{'expected':{'journal_sha256':'old','files':{}}},{'catalog_files':{}}):
   with self.assertRaises(ValueError):initialize(self.service,{**request,**extra})
  self.assertIsNone(response(self.service,self.data)['graph'])
 def test_existing_unindexed_partial_hidden_and_empty_directories_are_never_overwritten(self):
  from studio_worker.pygas_composition import initialize
  request=self.request();root=self.service.root/'projects/owned/inputs'
  for i,name in enumerate(('workflow.json','build_bias.py','.studio-composition.json','unknown-input.txt',None)):
   workspace='occupied'+str(i);directory=root/('cv-'+workspace);directory.mkdir()
   if name:(directory/name).write_text('preserve these bytes',encoding='utf8')
   with self.assertRaises((ValueError,KeyError,json.JSONDecodeError)):initialize(self.service,{**request,'workspace_id':workspace})
   if name:self.assertEqual((directory/name).read_text(encoding='utf8'),'preserve these bytes')
 def test_unique_exact_selected_structure_is_retained_without_scientific_defaults(self):
  from studio_worker.pygas_composition import initialize
  from studio_worker.util import digest
  request=self.request();target=self.service.root/'projects/owned/inputs/selected.xyz';target.write_text('1\n\nCu 0 0 0\n',encoding='utf8')
  self.service.store.put('artifact',{'id':'structure','project_id':'owned','name':target.name,'path':str(target),'kind':'structure','sha256':digest(target)})
  with patch.object(self.service,'inspect',return_value={'n_atoms':1,'numbers':[29]}):result=initialize(self.service,{**request,'files':[str(target),str(target)]})
  self.assertEqual(result['graph']['settings']['atoms_path'],target.as_posix())
  for field in ('sigma','temperature','temp','weight','pt_path'):self.assertNotIn(field,result['graph']['settings'])
  self.assertEqual(result['graph']['nodes'],[])
 def test_ambiguous_or_changed_structure_cannot_be_silently_selected(self):
  from studio_worker.pygas_composition import initialize
  from studio_worker.util import digest
  request=self.request();paths=[]
  for i in range(2):
   target=self.service.root/'projects/owned/inputs'/('s'+str(i)+'.xyz');target.write_text('1\n\nCu 0 0 0\n',encoding='utf8');paths.append(str(target));self.service.store.put('artifact',{'id':'s'+str(i),'project_id':'owned','name':target.name,'path':str(target),'kind':'structure','sha256':digest(target)})
  with self.assertRaisesRegex(ValueError,'one explicit structure'):initialize(self.service,{**request,'files':paths})
  Path(paths[0]).write_text('changed bytes',encoding='utf8')
  with self.assertRaisesRegex(ValueError,'registered hash'):initialize(self.service,{**request,'files':[paths[0]]})
 def test_failure_after_exclusive_creation_is_visible_and_cannot_be_reinitialized(self):
  from studio_worker.pygas_composition import initialize
  request=self.request()
  with patch('studio_worker.pygas_composition.save',side_effect=OSError('interrupted save')):
   with self.assertRaisesRegex(OSError,'interrupted save'):initialize(self.service,request)
  with self.assertRaisesRegex(ValueError,'already exist'):initialize(self.service,request)

class IncompleteReductionDraft(unittest.TestCase):
 setUp=CompositionService.setUp
 close=CompositionService.close
 def test_blank_reduction_draft_saves_without_choosing_a_reducer_or_rendering(self):
  from studio_worker.pygas_values import compiler_graph
  for i,values in enumerate(({}, {'operation':None}, {'operation':''})):
   graph={**self.graph,'nodes':[{'id':'manual-reduce','kind':'reduce','params':values}]}
   with patch('studio_worker.pygas_composition.run_json',side_effect=AssertionError('An incomplete reducer cannot render')):result=save(self.service,{**self.data,'workspace_id':'reduction-'+str(i),'graph':graph})
   self.assertIn('manual-reduce.operation',result['missing_fields']);self.assertEqual(result['graph']['nodes'][0]['params'],values);self.assertEqual(result['composition']['status'],'draft');self.assertFalse(Path(result['composition']['sourcePath']).exists())
   with self.assertRaisesRegex(ValueError,'Explicit reduction operation'):compiler_graph(graph,result['catalog']['catalog'],require_complete=True)
 def test_unknown_reducer_keys_and_operations_remain_rejected_even_as_drafts(self):
  from studio_worker.pygas_values import compiler_graph
  for values in ({'hidden':'mean'},{'operation':'automatic'},{'operation':'mean','extra':1}):
   with self.assertRaises(ValueError):compiler_graph({**self.graph,'nodes':[{'id':'r','kind':'reduce','params':values}]},{},require_complete=False)

class SavedCompositionReadGuard(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  from studio_worker.pygas_catalog import catalog
  cls.source={'id':'pygas','root':str(Path(__file__).resolve().parents[3]/'pygas')}
  if not (Path(cls.source['root'])/'tools/cv_bias_gui_server.py').is_file():raise unittest.SkipTest('Registered sibling source unavailable; actual catalog read not_run')
  cls.receipt=catalog(cls.source)
 def fixture(self,identity=True):
  import hashlib
  from studio_worker.composition_store import encoded
  graph={'parameter_format':'structured-v1','nodes':[{'id':'v','kind':'cv','class_name':'Volume','params':{'scale':1}},{'id':'collect','kind':'collect'}],'edges':[{'source':{'node':'v','port':'value'},'target':{'node':'collect','port':'value'}}]}
  if identity:
   graph['nodes'].append({'id':'r','kind':'reduce','params':{'operation':'identity'}});graph['edges']=[{'source':{'node':'v','port':'value'},'target':{'node':'r','port':'value'}},{'source':{'node':'r','port':'value'},'target':{'node':'collect','port':'value'}}]
  body='raise RuntimeError("read must not execute the generated program")\n'
  header={'root':self.source['root'],'files':self.receipt['source']['files'],'catalog_files':self.receipt['source']['files'],'composition':{'schema':'studio.composition/1','graph_sha256':hashlib.sha256(encoded(graph)).hexdigest(),'body_sha256':hashlib.sha256(body.encode()).hexdigest(),'inputs':{}}}
  return graph,{'source':'# studio-pygas-source: '+json.dumps(header)+'\n'+body},header,body
 def check(self,graph,state,directory):
  from studio_worker.pygas_composition import readonly_render_checks
  return readonly_render_checks(graph,state,self.receipt,{},self.source,Path(directory))
 def test_old_rendered_direct_scalar_is_rejected_without_execution_or_rewrite(self):
  graph,state,_,_=self.fixture(False)
  with tempfile.TemporaryDirectory() as directory,self.assertRaisesRegex(ValueError,'0D scalar'):self.check(graph,state,directory)
 def test_source_consistent_identity_pair_is_read_only_and_stale_sources_are_blocked(self):
  graph,state,header,body=self.fixture()
  with tempfile.TemporaryDirectory() as directory:
   self.assertEqual(self.check(graph,state,directory)['status'],'passed');self.assertEqual(list(Path(directory).iterdir()),[])
   header['catalog_files']={};state['source']='# studio-pygas-source: '+json.dumps(header)+'\n'+body
   with self.assertRaisesRegex(ValueError,'settings/catalog source changed'):self.check(graph,state,directory)
 def test_bound_selected_input_changes_are_rejected_without_rebuilding(self):
  import hashlib
  graph,state,header,body=self.fixture()
  with tempfile.TemporaryDirectory() as directory:
   target=Path(directory)/'model.xyz';target.write_bytes(b'first');header['composition']['inputs']={'model.xyz':hashlib.sha256(b'first').hexdigest()};state['source']='# studio-pygas-source: '+json.dumps(header)+'\n'+body
   self.assertEqual(self.check(graph,state,directory)['status'],'passed');target.write_bytes(b'changed')
   with self.assertRaisesRegex(ValueError,'input changed'):self.check(graph,state,directory)

if __name__=='__main__':unittest.main()
