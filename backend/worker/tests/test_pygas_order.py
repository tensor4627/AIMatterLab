import sys,unittest,copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.pygas_catalog import catalog
from studio_worker.pygas_order import validate_order_change
from studio_worker.pygas_composition import draft_graph
from studio_worker.pygas_settings import validate_settings
ROOT=Path(__file__).resolve().parents[4]/'pygas'
class OrderedSourceContract(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  if not (ROOT/'tools/cv_bias_gui_server.py').is_file():raise unittest.SkipTest('Actual pyGAS sibling unavailable; source-bound integration not_run')
  cls.receipt=catalog({'id':'pygas','root':str(ROOT)})
 def graph(self):
  edge=lambda node,port,target,tp:{'source':{'node':node,'port':port},'target':{'node':target,'port':tp}}
  return {'version':2,'parameter_format':'structured-v1','mode':'metad','settings':{'atoms_path':'model.xyz','pt_path':'bias.pt'},'nodes':[{'id':'v','kind':'cv','class_name':'Volume','params':{'scale':1.0}},{'id':'g','kind':'cv','class_name':'GeoCenter','params':{'idx':[0,1]}},{'id':'t','kind':'cv','class_name':'PeriodicTorsion','params':{'atom_idx':[0,1,2,3]}},{'id':'collect','kind':'collect'},{'id':'bias','kind':'bias','class_name':'FFWTPDMetaDGaussianBias','params':{'sigma':[1,2,3,4,5],'scale':[1,0,1,1,1],'pdl':[[i,i+10] for i in range(5)],'weight':[0.01],'temp':300,'bias_factor':10}},{'id':'out','kind':'output'}],'edges':[edge('v','value','collect','value'),edge('g','value','collect','value'),edge('t','value','collect','value'),edge('collect','cv','bias','cv'),edge('collect','cv','out','cv'),edge('bias','bias','out','bias')]}
 def test_whole_block_permutation_requires_exact_ordered_bias_rows(self):
  old=self.graph();new=copy.deepcopy(old);new['edges']=[new['edges'][2],new['edges'][0],new['edges'][1],*new['edges'][3:]]
  with self.assertRaisesRegex(ValueError,'exact corresponding'):validate_order_change(old,new,self.receipt)
  permutation=[4,0,1,2,3]
  for key in ('sigma','scale','pdl'):new['nodes'][4]['params'][key]=[old['nodes'][4]['params'][key][i] for i in permutation]
  self.assertEqual(validate_order_change(old,new,self.receipt)['permutation'],permutation)
  new['nodes'][4]['params']['temp']=310
  with self.assertRaisesRegex(ValueError,'exact corresponding'):validate_order_change(old,new,self.receipt)
 def test_opes_and_unreviewed_bias_cannot_be_permuted_implicitly(self):
  old=self.graph();old['mode']='opes';new=copy.deepcopy(old);new['edges'][:2]=list(reversed(new['edges'][:2]))
  with self.assertRaisesRegex(ValueError,'OPES dimension-order'):validate_order_change(old,new,self.receipt)
 def test_partial_typed_fields_persist_as_missing_without_zero_fill(self):
  graph=self.graph();graph['nodes'][4]['params']['pdl']=[[-3.14,None],[None,None]];graph['nodes'][4]['params']['sigma']=[]
  result,missing=draft_graph(graph,self.receipt);self.assertEqual(result['nodes'][4]['params']['pdl'],graph['nodes'][4]['params']['pdl']);self.assertIn('bias.pdl',missing);self.assertIn('bias.sigma',missing)
  graph['nodes'][2]['params']['atom_idx']=[0,None,2,3];self.assertIn('t.atom_idx',draft_graph(graph,self.receipt)[1])
 def test_global_types_and_studio_default_do_not_copy_gui_aoti_default(self):
  graph=self.graph();result,_=draft_graph(graph,self.receipt);self.assertEqual(result['settings']['artifact_formats'],['torchscript']);self.assertEqual(result['settings']['deployment_backend'],'torchscript')
  for settings in ({'max_neighbors':3.5},{'cast_history_internal_dtype':'false'},{'dtype_expr':'torch.int64'},{'opes':{'made_up':1}},{'pt_path':'chosen.pt2','artifact_formats':['torchscript'],'deployment_backend':'torchscript'}):
   with self.assertRaises(ValueError):validate_settings(settings,self.receipt['settings_schema'])
  graph['settings']['pt_path']='chosen.pt2';result,_=draft_graph(graph,self.receipt);self.assertEqual(result['settings']['deployment_backend'],'aoti')
if __name__=='__main__':unittest.main()
