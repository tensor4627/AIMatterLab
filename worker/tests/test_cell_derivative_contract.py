import sys,copy,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.cell_derivative_contract import supported_graph,derive,supported_private_graph,private_producer
class CellSourceContract(unittest.TestCase):
 def graph(self):
  nodes=[{'id':k,'kind':k}for k in ('input','neighbor','switch','cv','reduce','collect','output','bias')]
  data={n['id']:n for n in nodes};data['neighbor']['class_name']='PCVectorLB';data['switch']['class_name']='LessThanCubic';data['cv']['class_name']='CoordNum';data['reduce']['params']={'operation':'mean'};data['bias']['class_name']='MetaDGaussianBias'
  paths=[('input','pos','neighbor','pos'),('input','cell','neighbor','cell'),('input','side_array','neighbor','side_array'),('neighbor','pcvector','cv','pcvector'),('neighbor','side_array','cv','side_array'),('switch','switch','cv','switch_func'),('cv','value','reduce','value'),('reduce','value','collect','value'),('collect','cv','output','cv'),('collect','cv','bias','cv'),('input','cv_traj','bias','cv_traj'),('input','bias_traj','bias','bias_traj'),('bias','bias','output','bias')]
  return {'mode':'metad','nodes':nodes,'edges':[{'source':{'node':a,'port':b},'target':{'node':c,'port':d}}for a,b,c,d in paths]}
 def test_only_complete_reviewed_single_neighbor_cn_mean_metad_paths(self):
  for neighbor in ('PCVectorLB','PCVectorTypesFilter'):
   for bias in ('MetaDGaussianBias','WTMetaDGaussianBias','FFWTPDMetaDGaussianBias'):
    g=self.graph();next(n for n in g['nodes']if n['kind']=='neighbor')['class_name']=neighbor;next(n for n in g['nodes']if n['kind']=='bias')['class_name']=bias;self.assertTrue(supported_graph(g))
 def test_extra_or_changed_nodes_edges_reductions_and_dimensions_fail_closed(self):
  for change in (lambda g:g['nodes'].append({'id':'extra','kind':'cv','class_name':'Volume'}),lambda g:g['edges'].append({'source':{'node':'input','port':'pos'},'target':{'node':'cv','port':'pos'}}),lambda g:g['edges'].pop(),lambda g:g['edges'].append(copy.deepcopy(g['edges'][0])),lambda g:g['nodes'][3].update(class_name='PeriodicTorsion'),lambda g:g['nodes'][4].update(params={'operation':'first'}),lambda g:g['nodes'][3].update(output_size=1),lambda g:g['nodes'][3].update(id='neighbor'),lambda g:g.update(mode='opes')):
   g=self.graph();change(g);self.assertFalse(supported_graph(g))
 def test_non_sampling_and_opes_never_search_producers_or_read_inputs(self):
  for run in ({'engine':'gpumd.md','parameters':{}},{'engine':'gpumd.sampling','parameters':{'mode':'opes'}}):self.assertIsNone(derive(None,run))
 def test_parameter_claim_is_overwritten_by_the_trusted_adapter_keyword(self):
  from unittest.mock import patch
  from subprocess import CompletedProcess
  from studio_worker.adapters import Adapter
  adapter=Adapter('bias.validate');spec={'engine':'bias.validate','gpu':0,'inputs':{'bias.pt':'/f/bias.pt','model.xyz':'/f/model.xyz'},'parameters':{'bias_file':'bias.pt','structure_file':'model.xyz','mode':'static','cv_size':1,'cutoff':3,'_studio_cell_contract':{'convention':'forged'}}}
  calls=[]
  def execute(*args,**kwargs):calls.append(args[3]);return {'status':'passed'}
  with patch.object(adapter,'bias_command',return_value=['fixture']),patch('studio_worker.adapters.subprocess.run',return_value=CompletedProcess([],0,'{}','')),patch('studio_worker.adapters.run_json',side_effect=execute):adapter.validate(spec,{'executables':{'python':sys.executable}},Path.cwd())
  self.assertEqual(len(calls),1);self.assertIsNone(calls[0]['_studio_cell_contract'])

class PrivateCellGraphClosure(unittest.TestCase):
 def graph(self):
  nodes=[{'id':kind,'kind':kind}for kind in('input','neighbor','cv','collect','output','bias')];by={node['kind']:node for node in nodes};by['neighbor']['class_name']='PCVectorLB';by['cv'].update(id='custom_abc',class_name='StudioCustom_expected');by['bias']['class_name']='WTMetaDGaussianBias'
  edges=[('input','pos','neighbor','pos'),('input','cell','neighbor','cell'),('input','side_array','neighbor','side_array'),('input','pos','custom_abc','pos'),('input','cell','custom_abc','cell'),('input','side_array','custom_abc','side_array'),('custom_abc','value','collect','value'),('collect','cv','output','cv'),('collect','cv','bias','cv'),('input','cv_traj','bias','cv_traj'),('input','bias_traj','bias','bias_traj'),('bias','bias','output','bias')]
  return {'mode':'metad','metadata':{'studio_custom_cvs':[{'id':'abc','class_name':'StudioCustom_expected','output_size':1}]},'nodes':nodes,'edges':[{'source':{'node':a,'port':b},'target':{'node':c,'port':d}}for a,b,c,d in edges]}
 def test_only_one_direct_fixed_size_private_primitive_with_compiler_required_neighbor(self):
  from studio_worker.cell_derivative_contract import supported_private_graph
  for bias in('WTMetaDGaussianBias','MetaDGaussianBias','FFWTPDMetaDGaussianBias','FlexibleWallBias'):
   graph=self.graph();next(node for node in graph['nodes']if node['kind']=='bias')['class_name']=bias
   if bias=='FlexibleWallBias':graph['edges']=[edge for edge in graph['edges']if edge['source']['port']!='bias_traj']
   self.assertTrue(supported_private_graph(graph))
 def test_unknown_topology_or_dimensions_fail_closed_without_approval_lookup(self):
  from studio_worker.cell_derivative_contract import supported_private_graph,private_producer
  for change in(lambda graph:graph['nodes'].append({'id':'reduce','kind':'reduce'}),lambda graph:graph['edges'].pop(),lambda graph:graph['edges'].append(copy.deepcopy(graph['edges'][0])),lambda graph:graph['metadata']['studio_custom_cvs'][0].update(output_size=2),lambda graph:graph['nodes'][2].update(class_name='Unknown'),lambda graph:graph['metadata'].update(studio_custom_cvs=[]),lambda graph:graph.update(mode='opes'),lambda graph:graph['nodes'].pop(1)):
   graph=self.graph();change(graph);self.assertFalse(supported_private_graph(graph));self.assertIsNone(private_producer(None,graph,None))

class PrivateIdentityContract(unittest.TestCase):
 def graph(self):
  graph=PrivateCellGraphClosure().graph()
  edge=next(edge for edge in graph['edges']if edge['source']['node']=='custom_abc' and edge['target']['node']=='collect')
  graph['edges'].remove(edge);graph['nodes'].append({'id':'identity','kind':'reduce','params':{'operation':'identity'}})
  graph['edges'].extend([{'source':{'node':'custom_abc','port':'value'},'target':{'node':'identity','port':'value'}},{'source':{'node':'identity','port':'value'},'target':{'node':'collect','port':'value'}}]);return graph
 def test_only_exact_explicit_scalar_identity_with_each_supported_bias(self):
  for bias in('MetaDGaussianBias','WTMetaDGaussianBias','FFWTPDMetaDGaussianBias','FlexibleWallBias'):
   for neighbor in('PCVectorLB','PCVectorTypesFilter'):
    graph=self.graph();next(n for n in graph['nodes']if n['kind']=='bias')['class_name']=bias;next(n for n in graph['nodes']if n['kind']=='neighbor')['class_name']=neighbor
    if bias=='FlexibleWallBias':graph['edges']=[e for e in graph['edges']if e['source']['port']!='bias_traj']
    with self.subTest(bias=bias,neighbor=neighbor):self.assertTrue(supported_private_graph(graph))
 def test_semantically_different_or_unproved_reductions_are_rejected(self):
  for params in({}, {'operation':'mean'},{'operation':'sum'},{'operation':'first'},{'operation':'IDENTITY'},{'operation':'unknown'},{'operation':'identity','extra':True}):
   graph=self.graph();graph['nodes'][-1]['params']=params
   with self.subTest(params=params):self.assertFalse(supported_private_graph(graph));self.assertIsNone(private_producer(None,graph,None))
 def test_changed_width_bypass_duplicate_missing_or_extra_edges_failclosed(self):
  changes=[lambda g:g['metadata']['studio_custom_cvs'][0].update(output_size=2),lambda g:g['nodes'][-1].update(output_size=1),lambda g:g['nodes'][-1].update(id='custom_abc'),lambda g:g['nodes'].append({'id':'second','kind':'reduce','params':{'operation':'identity'}}),lambda g:g['edges'].append(copy.deepcopy(g['edges'][-1])),lambda g:g['edges'].pop(),lambda g:g['edges'].append({'source':{'node':'custom_abc','port':'value'},'target':{'node':'collect','port':'value'}})]
  for index,change in enumerate(changes):
   graph=self.graph();change(graph)
   with self.subTest(index=index):self.assertFalse(supported_private_graph(graph));self.assertIsNone(private_producer(None,graph,None))

if __name__=='__main__':unittest.main()


class PrivateTargetFallback(unittest.TestCase):
 def test_private_opes_and_unproved_topology_cannot_take_public_legacy_fallback(self):
  from unittest.mock import Mock,patch
  service=Mock();service.store.list.return_value=[{'project_id':'owned'}]
  for mode in('opes','wtmetad','static'):
   with self.subTest(mode=mode),patch('studio_worker.cell_derivative_contract._derive',return_value=None),self.assertRaisesRegex(ValueError,'unsupported|proof'):
    derive(service,{'engine':'bias.validate','project_id':'owned','parameters':{'mode':mode}})
 def test_existing_public_opes_remains_unchanged(self):
  from unittest.mock import Mock
  service=Mock();service.store.list.return_value=[]
  self.assertIsNone(derive(service,{'engine':'bias.validate','project_id':'public','parameters':{'mode':'opes'}}))
