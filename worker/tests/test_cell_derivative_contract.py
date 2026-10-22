import sys,copy,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.cell_derivative_contract import supported_graph,derive
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
if __name__=='__main__':unittest.main()
