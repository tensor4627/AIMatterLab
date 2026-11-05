import sys,unittest,tempfile,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.server import dispatch,tools
from studio_worker.service import Service
from studio_worker.source_projects import inspect_source
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'studio_worker'))
from structure_tools import create,suggest

class Authoring(unittest.TestCase):
 def test_source_requires_desktop_and_reads_actual_signature(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);repo=root/'repo';(repo/'base').mkdir(parents=True)
   (repo/'base/colvar.py').write_text('class RealCV:\n def __init__(self, cutoff=4.):pass\n def forward(self,pos,cell):pass\n')
   service=Service(root/'worker',schedule=False)
   try:
    with self.assertRaises(PermissionError):dispatch(service,'POST','/api/source-projects',{'id':'pygas','root':str(repo)})
    dispatch(service,'POST','/api/source-projects',{'id':'pygas','root':str(repo)},admin=True)
    result=dispatch(service,'POST','/api/source-project/inspect',{'source_id':'pygas'})
    cv=result['catalog']['base/colvar.py'][0];self.assertEqual(cv['name'],'RealCV');self.assertEqual(cv['constructor'][0]['default'],'4.')
    self.assertEqual(result['validation'],'not_run');self.assertFalse(result['capabilities']['graph_compiler'])
    (repo/'base/colvar.py').write_text('class OtherCV:\n def __init__(self):pass\n')
    self.assertEqual(inspect_source({'id':'pygas','root':str(repo)})['catalog']['base/colvar.py'][0]['name'],'OtherCV')
   finally:service.close();service.store.db.close()
 def test_ase_asset_reloaded_with_provenance_and_limits(self):
  with tempfile.TemporaryDirectory() as d:
   result=create({'recipe':{'kind':'bulk','name':'Cu','cubic':True,'repeat':[2,2,2]},'output_path':str(Path(d)/'cu.xyz')})
   self.assertEqual(result['n_atoms'],32);self.assertTrue(Path(result['path']).is_file());self.assertEqual(result['validation']['status'],'passed');self.assertTrue(result['provenance']['assumptions'])
   with self.assertRaises(ValueError):create({'recipe':{'kind':'bulk','name':'Cu','repeat':[100,100,100]},'output_path':str(Path(d)/'huge.xyz')})
   with self.assertRaises(ValueError):create({'recipe':{'kind':'explicit','symbols':'H2','positions':[[0,0,0],[0,0,0]]},'output_path':str(Path(d)/'overlap.xyz')})
 def test_unauthorized_environment_cannot_author(self):
  with tempfile.TemporaryDirectory() as d:
   service=Service(Path(d)/'worker',schedule=False)
   try:
    p=service.register_project({'name':'test','policy':{'input_roots':[d],'environments':[]}})
    with self.assertRaises(PermissionError):service.authoring({'project_id':p['id'],'environment_id':'unknown','recipe':{}},'create_structure')
   finally:service.close();service.store.db.close()
 def test_mcp_catalog_exposes_authoring_not_submission(self):
  names={t['name'] for t in tools()}
  self.assertTrue({'list_source_projects','inspect_source_project','create_structure','render_pygas_workflow'}<=names)
  self.assertNotIn('submit_run',names)
  for tool in tools():
   if tool['name'] in ('inspect_source_project','suggest_parameters'):self.assertTrue(tool['annotations']['readOnlyHint'])

class Suggestions(unittest.TestCase):
 def test_inferred_facts_and_pilot_defaults_preserve_user_choices(self):
  with tempfile.TemporaryDirectory() as d:
   path=str(Path(d)/'h2.xyz');create({'recipe':{'kind':'molecule','name':'H2'},'output_path':path})
   r=suggest({'path':path,'intent':{'temperature_K':450,'time_step_fs':0.1,'enhanced_sampling':True}})
   self.assertEqual(r['parameters']['temperature_K']['value'],450);self.assertEqual(r['parameters']['time_step_fs']['value'],0.1)
   self.assertEqual(r['parameters']['n_atoms']['value'],2);self.assertEqual(r['parameters']['pilot_steps']['confidence'],'technical default');self.assertEqual(r['unresolved'][0]['field'],'cv_definition')
   r=suggest({'path':path,'intent':{'ambient':True}});self.assertEqual(r['parameters']['temperature_K']['value'],300);self.assertEqual(r['parameters']['temperature_K']['confidence'],'proposal')
 def test_source_build_gate_rejects_different_or_changed_registration(self):
  from studio_worker.adapters import Adapter
  import hashlib
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);repo=root/'repo';(repo/'base').mkdir(parents=True);f=repo/'base/colvar.py';f.write_text('# actual')
   source={'root':str(repo),'colvar_sha256':hashlib.sha256(f.read_bytes()).hexdigest()};(root/'build_bias.py').write_text('# studio-pygas-source: '+json.dumps(source)+'\nprint("not executed")')
   spec={'inputs':{'build_bias.py':'ignored'},'parameters':{},'gpu':0}
   with self.assertRaisesRegex(ValueError,'differs from registered'):Adapter('pygas.build').validate(spec,{'repositories':{}},root)
   f.write_text('# changed')
   with self.assertRaisesRegex(ValueError,'changed after graph'):Adapter('pygas.build').validate(spec,{'repositories':{'pygas':str(repo)}},root)
 def test_database_provenance_is_desktop_owned(self):
  with tempfile.TemporaryDirectory() as d:
   service=Service(Path(d)/'worker',schedule=False)
   try:
    with self.assertRaises(PermissionError):dispatch(service,'POST','/api/structures/import-material',{})
   finally:service.close();service.store.db.close()

class TechnicalSuggestions(unittest.TestCase):
 def test_temperature_alias_and_history_capacity_are_not_user_blockers(self):
  with tempfile.TemporaryDirectory() as d:
   path=str(Path(d)/'h2.xyz');create({'recipe':{'kind':'molecule','name':'H2'},'output_path':path})
   r=suggest({'path':path,'intent':{'temperature':300,'enhanced_sampling':True,'cv_definition':'distance','steps':100,'pace':10}})
   self.assertEqual(r['parameters']['temperature_K']['value'],300);self.assertEqual(r['parameters']['history_capacity']['value'],11);self.assertEqual(r['parameters']['dtype']['value'],'float64');self.assertEqual(r['unresolved'],[]);self.assertEqual(r['topology']['peptide_torsion_candidates'],[])

class PortableWorkflow(unittest.TestCase):
 def test_only_io_paths_are_relocated_and_backend_and_scientific_nodes_are_preserved(self):
  from studio_worker.structure_tools import portable_graph
  graph={'version':2,'settings':{'atoms_path':'/private/draft/model.xyz','pt_path':'/private/draft/bias.pt2','artifact_formats':['aoti'],'deployment_backend':'aoti','temperature':300},'nodes':[{'kind':'bias','params':{'height':0.001,'sigma':0.1}}],'edges':[]}
  before=json.loads(json.dumps(graph));canonical,bindings=portable_graph(graph)
  self.assertEqual(graph,before);self.assertEqual(canonical['nodes'],graph['nodes']);self.assertEqual(canonical['settings']['atoms_path'],'model.xyz');self.assertEqual(canonical['settings']['pt_path'],'bias.pt2');self.assertEqual(canonical['settings']['workflow_path'],'workflow.json');self.assertEqual(canonical['settings']['deployment_backend'],'aoti');self.assertEqual(bindings['atoms_path']['source'],'/private/draft/model.xyz')
  with self.assertRaises(ValueError):portable_graph({'settings':{'atoms_path':'model.xyz','pt_path':'model.xyz'}})

 def test_real_v1_v2_output_names_and_adapter_gate(self):
  from studio_worker.structure_tools import portable_graph,graph_snapshot_io
  from studio_worker.adapters import Adapter
  import hashlib
  cases=[(1,{},'bias.custom',['bias.custom'],[]),(2,{'artifact_formats':['aoti'],'deployment_backend':'aoti'},'bias.pt',['bias.pt2'],['bias.manifest.json']),(2,{'artifact_formats':['torchscript','aoti'],'deployment_backend':'aoti'},'bias.pt',['bias.pt','bias.pt2'],['bias.manifest.json'])]
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);repo=root/'repo';(repo/'base').mkdir(parents=True);f=repo/'base/colvar.py';f.write_text('# registered')
   for version,extra,target,outputs,manifests in cases:
    canonical,_=portable_graph({'version':version,'settings':{'atoms_path':'/draft/model.xyz','pt_path':'/draft/'+target,**extra}});io=graph_snapshot_io(canonical)
    self.assertEqual(io['outputs'],outputs);self.assertEqual(io['manifests'],manifests)
    source={'root':str(repo),'colvar_sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'io':io}
    (root/'build_bias.py').write_text('# studio-pygas-source: '+json.dumps(source)+'\npass')
    spec={'inputs':dict.fromkeys(['build_bias.py','model.xyz','workflow.json'],'snapshot'),'parameters':{'output_file':outputs[0]},'gpu':0};env={'repositories':{'pygas':str(repo)}}
    if any(name.endswith('.pt2') for name in outputs):
     with self.assertRaisesRegex(ValueError,'AOTI needs explicit'):Adapter('pygas.build').validate(spec,env,root)
    else:self.assertEqual(Adapter('pygas.build').validate(spec,env,root)['status'],'passed')
    spec['parameters']['output_file']='undeclared.pt'
    with self.assertRaisesRegex(ValueError,'Declared build output'):Adapter('pygas.build').validate(spec,env,root)
    spec['parameters']['output_file']=outputs[0];del spec['inputs']['workflow.json']
    with self.assertRaisesRegex(ValueError,'Missing inputs'):Adapter('pygas.build').validate(spec,env,root)
