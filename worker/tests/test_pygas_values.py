import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"studio_worker"))
import unittest
from pygas_values import value_expression,compiler_graph,normalize_graph
class Values(unittest.TestCase):
 def test_typed_and_legacy_tensor_data_preserve_dtype(self):
  p={"name":"atom_idx","type_hint":"tensor"}
  self.assertEqual(value_expression([0,1,2,3],p),"torch.tensor([0, 1, 2, 3])")
  self.assertEqual(value_expression("torch.tensor([0,1,2,3], dtype=torch.long)",p),"torch.tensor([0, 1, 2, 3], dtype=torch.long)")
  self.assertAlmostEqual(float(value_expression("2*torch.pi",{"name":"scale","type_hint":"float"})),6.283185307179586)
  self.assertEqual(value_expression("float64",{"name":"internal_dtype"},legacy=False),"torch.float64")
 def test_no_arbitrary_calls_or_hidden_file_reads(self):
  for text in ["__import__('os').system('id')","open('/tmp/a').read()","[x for x in range(3)]","torch.tensor([1],device=open('a'))","torch.tensor([1],dtype=getattr(torch,'float'))","float('nan')"]:
   with self.assertRaises(ValueError):value_expression(text,{"name":"sigma","type_hint":"tensor"})
 def test_required_module_defaults_and_unknown_fields(self):
  cat={"cv":[{"name":"Example","params":[{"name":"n_atoms","required":True},{"name":"switch_func","is_module_param":True,"required":True},{"name":"a","required":True,"type_hint":"float"},{"name":"optional","required":False,"default":"None"}]}]}
  graph={"nodes":[{"id":"cv","kind":"cv","class_name":"Example","params":{"a":2}}]}
  self.assertEqual(compiler_graph(graph,cat)["nodes"][0]["params"],{"a":"2"})
  for params in [{},{"a":2,"other":3},{"a":2,"switch_func":"evil()"},{"a":2,"n_atoms":10}]:
   with self.assertRaises(ValueError):compiler_graph({"nodes":[{**graph["nodes"][0],"params":params}]},cat)
  self.assertEqual(graph["nodes"][0]["params"],{"a":2})
 def test_codegen_settings_are_fixed_expressions(self):
  for key,value in [("device_expr","open('a')"),("dtype_expr","__import__('os')")]:
   with self.assertRaises(ValueError):compiler_graph({"nodes":[],"settings":{key:value}}, {})

 def test_tensor_shape_and_numeric_data_are_checked(self):
  for value in [["text"],[None],[[1],[2,3]],True]:
   with self.assertRaises(ValueError):value_expression(value,{"name":"sigma","type_hint":"tensor"},legacy=False)
 def test_unknown_fields_and_quoted_codegen_names_are_rejected(self):
  cases=[{"nodes":[],"extra":"x"},{"nodes":[],"settings":{"extra":"x"}},{"nodes":[{"kind":"output","params":{"x":1}}]},{"nodes":[{"kind":"reduce","params":{"operation":"mean","extra":1}}]},{"nodes":[],"settings":{"pt_path":'bias"; unexpected() #.pt'}}]
  for graph in cases:
   with self.assertRaises(ValueError):compiler_graph(graph,{})

 def test_normalization_preserves_tensor_dtype_and_rejects_invalid_index_shape(self):
  p={"name":"atom_idx","type_hint":"expr","required":True,"editor_hint":{"editor":"integer_vector","shape":[4],"serializer":"literal"}}
  cat={"cv":[{"name":"PeriodicTorsion","params":[p]}]};g={"nodes":[{"kind":"cv","id":"cv","class_name":"PeriodicTorsion","params":{"atom_idx":"[0, 1, 2, 3]"}}]}
  n=normalize_graph(g,cat);self.assertEqual(n['nodes'][0]['params']['atom_idx'],[0,1,2,3]);self.assertEqual(n['parameter_format'],'structured-v1');self.assertEqual(compiler_graph(n,cat)['nodes'][0]['params']['atom_idx'],'[0, 1, 2, 3]')
  for value in [[0,1,2],[-1,1,2,3],[0,1,2.2,3]]:
   with self.assertRaises(ValueError):value_expression(value,p,legacy=False)
  c={"cv":[{"name":"Other","params":[{"name":"sigma","type_hint":"tensor","required":True}]}]};g['nodes'][0].update(class_name='Other',params={'sigma':'torch.tensor([0.1], dtype=torch.float64)'});n=normalize_graph(g,c);self.assertEqual(n['nodes'][0]['parameter_dtypes']['sigma'],'torch.float64');self.assertIn('dtype=torch.float64',compiler_graph(n,c)['nodes'][0]['params']['sigma'])

 def test_dtype_options_cannot_be_bypassed_or_change_scalar_types(self):
  param={'name':'dtype','editor_hint':{'editor':'enum','options':['float32','float64']}}
  self.assertEqual(value_expression('torch.double',param),'torch.float64')
  with self.assertRaises(ValueError):value_expression('torch.int64',param)
  c={'cv':[{'name':'Scalar','params':[{'name':'a','type_hint':'float','required':True}]}]}
  with self.assertRaises(ValueError):compiler_graph({'nodes':[{'kind':'cv','class_name':'Scalar','params':{'a':2},'parameter_dtypes':{'a':'torch.float64'}}]},c)

 def test_floating_tensor_constructor_uses_reviewed_graph_precision(self):
  cat={'bias':[{'name':'B','params':[{'name':'sigma','type_hint':'tensor','required':True}]}]}
  graph={'parameter_format':'structured-v1','settings':{'dtype_expr':'torch.double'},'nodes':[{'kind':'bias','class_name':'B','params':{'sigma':[0.12345678901234568]}}]}
  text=compiler_graph(graph,cat)['nodes'][0]['params']['sigma'];self.assertIn('dtype=torch.double',text);self.assertIn('0.12345678901234568',text)
  graph['nodes'][0]['parameter_dtypes']={'sigma':'torch.float32'};self.assertIn('dtype=torch.float32',compiler_graph(graph,cat)['nodes'][0]['params']['sigma'])
