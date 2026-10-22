import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"studio_worker"))
import unittest,copy
from pathlib import Path
from pygas_catalog import catalog
from pygas_values import compiler_graph,normalize_graph
from pygas_dimensions import validate_dimensions
ROOT=Path(__file__).resolve().parents[3]/"pygas"
class DimensionGuard(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  if not (ROOT/"tools/cv_bias_gui_server.py").is_file():raise unittest.SkipTest("Registered sibling pyGAS source unavailable; source-bound integration not_run")
  cls.receipt=catalog({"id":"pygas","root":str(ROOT)});cls.cat=cls.receipt["catalog"]
 def graph(self,**params):
  return {"parameter_format":"structured-v1","nodes":[{"id":"bias","kind":"bias","class_name":"FFWTPDMetaDGaussianBias","params":{"sigma":[0.1,0.2],"scale":[1,1],"weight":[0.01],"temp":300,"pdl":[[-3.14,3.14],[-3.14,3.14]],"bias_factor":10,**params}}]}
 def check(self,g,size=2):return validate_dimensions(compiler_graph(g,self.cat),self.receipt,{"cv_size":size})
 def test_actual_internal_dtype_enum_cannot_be_bypassed_by_legacy_integer_dtype(self):
  for value in ('torch.long','torch.int64','long','int64'):
   graph={"nodes":[{"id":"cn","kind":"cv","class_name":"CoordNum","params":{"internal_dtype":value}}]}
   with self.assertRaisesRegex(ValueError,"internal_dtype"):compiler_graph(graph,self.cat)
  for value in ('float64','float32',None):
   graph={"parameter_format":"structured-v1","nodes":[{"id":"cn","kind":"cv","class_name":"CoordNum","params":{"internal_dtype":value}}]}
   self.assertEqual(compiler_graph(graph,self.cat)['nodes'][0]['params']['internal_dtype'],'None' if value is None else 'torch.'+value)
 def test_source_known_zero_dimensional_scalar_needs_explicit_identity_before_collect(self):
  graph={"parameter_format":"structured-v1","nodes":[{"id":"v","kind":"cv","class_name":"Volume","params":{"scale":1}},{"id":"collect","kind":"collect"}],"edges":[{"source":{"node":"v","port":"value"},"target":{"node":"collect","port":"value"}}]}
  with self.assertRaisesRegex(ValueError,"0D scalar"):validate_dimensions(compiler_graph(graph,self.cat),self.receipt,{"cv_size":1})
  graph['nodes'].append({"id":"reshape","kind":"reduce","params":{"operation":"identity"}});graph['edges']=[{"source":{"node":"v","port":"value"},"target":{"node":"reshape","port":"value"}},{"source":{"node":"reshape","port":"value"},"target":{"node":"collect","port":"value"}}]
  self.assertEqual(validate_dimensions(compiler_graph(graph,self.cat),self.receipt,{"cv_size":1})['status'],'passed')
 def test_all_five_source_known_scalar_families_require_explicit_adapter(self):
  families={'Volume':{'scale':1},'PairwiseDistanceMean':{},'PeriodicTorsion':{'atom_idx':[0,1,2,3]},'Torsion':{'idx':[0,1,2,3]},'PairEntropy':{'sigma':.1,'r_ic':.1,'r_oc':3,'dx':.1}}
  for family,params in families.items():
   with self.subTest(family=family):
    entry=next(e for e in self.cat['cv'] if e['name']==family);self.assertEqual(entry['semantics']['output_rank'],0)
    graph={'parameter_format':'structured-v1','nodes':[{'id':'cv','kind':'cv','class_name':family,'params':params},{'id':'collect','kind':'collect'}],'edges':[{'source':{'node':'cv','port':'value'},'target':{'node':'collect','port':'value'}}]}
    with self.assertRaisesRegex(ValueError,'0D scalar'):validate_dimensions(compiler_graph(graph,self.cat),self.receipt,{'cv_size':1},{'n_atoms':4})
 def test_full_ordered_widths_and_periods(self):
  self.assertEqual(self.check(self.graph())["status"],"passed")
  for params in ({"sigma":[0.1]},{"scale":[1]},{"sigma":[0,0.2]},{"pdl":[[0,0],[-3,3]]},{"pdl":[[-3,3]]},{"temp":0},{"bias_factor":1}):
   with self.assertRaises(ValueError):self.check(self.graph(**params))
 def test_nonunit_mask_warns_without_rescaling_and_asymmetric_wrap_is_explicit(self):
  result=self.check(self.graph(scale=[2,5],pdl=[[0,6.28],[-3.14,3.14]]))
  self.assertEqual({v["field"] for v in result["warnings"]},{"scale","pdl"})
  self.assertEqual(self.graph(scale=[2,5])["nodes"][0]["params"]["scale"],[2,5])
  self.assertEqual(len(self.check(self.graph(scale=[0,0]))["warnings"]),1)
 def test_index_bounds_come_from_actual_structure_and_source_hints(self):
  graph={"parameter_format":"structured-v1","nodes":[{"kind":"cv","id":"phi","class_name":"PeriodicTorsion","params":{"atom_idx":[0,1,2,4]}}]}
  compiled=compiler_graph(graph,self.cat)
  with self.assertRaisesRegex(ValueError,"actual zero-based"):validate_dimensions(compiled,self.receipt,{"cv_size":1},{"n_atoms":4})
  self.assertEqual(validate_dimensions(compiled,self.receipt,{"cv_size":1},{"n_atoms":5})["status"],"passed")
 def test_legacy_torsion_rejects_fractional_wrong_length_and_out_of_range_indexes(self):
  graph={"parameter_format":"structured-v1","nodes":[{"kind":"cv","id":"torsion","class_name":"Torsion","params":{"idx":[0,1,2,3]}}]}
  for idx in ([0,1.9,2,3],[0,1,2],[-1,1,2,3]):
   graph["nodes"][0]["params"]["idx"]=idx
   with self.assertRaises(ValueError):compiler_graph(graph,self.cat)
  graph["nodes"][0]["params"]["idx"]=[0,1,2,4]
  with self.assertRaisesRegex(ValueError,"actual zero-based"):validate_dimensions(compiler_graph(graph,self.cat),self.receipt,{"cv_size":1},{"n_atoms":4})
 def test_identity_must_not_hide_vector_dimensions_or_tuple_outputs(self):
  g={"parameter_format":"structured-v1","nodes":[{"id":"c","kind":"cv","class_name":"GeoCenter","params":{"idx":[0,1]}},{"id":"r","kind":"reduce","params":{"operation":"identity"}}],"edges":[{"source":{"node":"c","port":"value"},"target":{"node":"r","port":"value"}}]}
  with self.assertRaisesRegex(ValueError,"identity preserves"):validate_dimensions(compiler_graph(g,self.cat),self.receipt,{"cv_size":1},{"n_atoms":2})
  g["nodes"][1]["params"]["operation"]="mean";self.assertEqual(validate_dimensions(compiler_graph(g,self.cat),self.receipt,{"cv_size":1},{"n_atoms":2})["status"],"passed")
  g["nodes"][0]={"id":"c","kind":"cv","class_name":"Volume","params":{"scale":1}};g["nodes"][1]["params"]["operation"]="identity";self.assertEqual(validate_dimensions(compiler_graph(g,self.cat),self.receipt,{"cv_size":1})["status"],"passed")
  g["nodes"][0]={"id":"c","kind":"cv","class_name":"ZoneSelect","params":{"lb":[0,0,0],"ub":[1,1,1]}};g["nodes"][1]["params"]["operation"]="mean"
  with self.assertRaisesRegex(ValueError,"dynamic tuple"):validate_dimensions(compiler_graph(g,self.cat),self.receipt,{"cv_size":1})
  g["nodes"][0]={"id":"c","kind":"cv","class_name":"GroupVector","params":{"idxA":[0],"idxB":[1]}}
  with self.assertRaisesRegex(ValueError,"dynamic tuple"):validate_dimensions(compiler_graph(g,self.cat),self.receipt,{"cv_size":1},{"n_atoms":2})
 def test_known_cv_size_cannot_be_overridden_to_hide_components(self):
  g={"parameter_format":"structured-v1","nodes":[{"id":"c","kind":"cv","class_name":"GeoCenter","output_size":1,"params":{"idx":[0,1]}}]}
  with self.assertRaisesRegex(ValueError,"Declared CV size"):validate_dimensions(compiler_graph(g,self.cat),self.receipt,{"cv_size":1},{"n_atoms":2})
 def test_incomplete_legacy_data_can_normalize_but_never_render_ready(self):
  g=self.graph();del g["parameter_format"];g["nodes"][0]["params"]={"sigma":"torch.tensor([0.1,0.2], dtype=torch.float64)"}
  n=normalize_graph(g,self.cat)
  self.assertEqual(n["nodes"][0]["params"]["sigma"],[0.1,0.2])
  with self.assertRaises(ValueError):compiler_graph(n,self.cat)
 def test_stale_semantics_cannot_activate_guards_and_volume_zero_is_rejected(self):
  receipt=copy.deepcopy(self.receipt);entry=next(e for e in receipt["catalog"]["bias"] if e["name"]=="FFWTPDMetaDGaussianBias");entry["semantics"]["sha256"]="0"*64
  with self.assertRaisesRegex(ValueError,"Stale class semantics"):validate_dimensions(compiler_graph(self.graph(),self.cat),receipt,{"cv_size":2})
  g={"parameter_format":"structured-v1","nodes":[{"id":"vol","kind":"cv","class_name":"Volume","params":{"scale":0}}]}
  with self.assertRaisesRegex(ValueError,"nonzero"):validate_dimensions(compiler_graph(g,self.cat),self.receipt,{"cv_size":1})
if __name__=="__main__":unittest.main()
