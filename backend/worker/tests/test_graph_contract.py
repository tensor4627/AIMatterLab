import hashlib,tempfile,types,unittest
from pathlib import Path
from studio_worker.source_projects import graph_authoring_contract,inspect_source

PUBLIC_FIXTURE="""raise RuntimeError('THIS MODULE MUST NEVER BE IMPORTED')
RUNTIME_PORTS={'pos':'pos','edge_index':'side_array'}
def _mode(graph):
    return graph.get('mode','cvonly')
def _node_ports(node,catalog,mode):
    return ({'cell':'cell'},{'value':'value'})
def _edge_endpoint(edge,side):
    raw=edge[side]
    if not isinstance(raw,dict):raise ValueError('structured endpoint required')
    return raw['node'],raw['port']
def validate_graph(graph,catalog):
    if 'kind' not in graph['nodes'][0]:raise ValueError('kind required')
    return {'cv_size':1}
def _reduce_expression(source,operation):
    return source+'.reshape(-1)[:1]'
"""
class GraphContract(unittest.TestCase):
 def test_actual_rules_are_source_bound_and_never_execute_top_level_code(self):
  sha=hashlib.sha256(PUBLIC_FIXTURE.encode()).hexdigest();out=graph_authoring_contract(PUBLIC_FIXTURE,sha)
  self.assertEqual(out['status'],'passed');self.assertEqual(out['source']['sha256'],sha);self.assertEqual(out['runtime_ports']['edge_index'],'side_array');self.assertIn("raw['node'],raw['port']",out['entrypoints']['_edge_endpoint']);self.assertIn("'kind' not in",out['entrypoints']['validate_graph']);self.assertEqual(out['validation'],'not_run')
 def test_changed_or_unavailable_api_has_no_compatibility_claim(self):
  for code in ('def other(): pass','def _mode(: pass',PUBLIC_FIXTURE.replace("RUNTIME_PORTS={'pos':'pos','edge_index':'side_array'}","RUNTIME_PORTS=__import__('os').environ")):
   out=graph_authoring_contract(code,'sha');self.assertEqual(out['status'],'blocked');self.assertNotIn('entrypoints',out)
 def test_bounded_excerpt_refuses_oversized_code(self):
  code=PUBLIC_FIXTURE.replace("return graph.get('mode','cvonly')",'return '+repr('x'*25000));self.assertEqual(graph_authoring_contract(code,'sha')['status'],'blocked')
 def test_registered_inspection_returns_same_hash_and_rules(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'tools').mkdir();(root/'tools/graph_workflow.py').write_text(PUBLIC_FIXTURE,encoding='utf-8');out=inspect_source({'id':'pygas','root':str(root)});f=next(f for f in out['files'] if f['name']=='tools/graph_workflow.py');self.assertEqual(out['graph_contract']['source']['sha256'],f['sha256']);self.assertTrue(out['capabilities']['graph_renderer'])
 def test_public_class_methods_are_optional_bounded_and_never_imported(self):
  code="raise RuntimeError('never import')\nclass ScalarCV:\n def __init__(self):pass\n @staticmethod\n def minimum_image(pos,cell):\n  return (pos/cell).round()\n def forward(self,pos,cell):\n  return self.minimum_image(pos,cell).mean()\n"
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'base').mkdir();file=root/'base/colvar.py';file.write_text(code,encoding='utf-8');source={'id':'pygas','root':str(root)}
   self.assertNotIn('symbol_excerpts',inspect_source(source));out=inspect_source(source,['ScalarCV']);result=out['symbol_excerpts'];self.assertEqual(result['status'],'passed');item=result['symbols'][0];self.assertEqual(item['source']['sha256'],hashlib.sha256(file.read_bytes()).hexdigest());self.assertIn('.mean()',item['methods']['forward']['source']);self.assertIn('staticmethod',item['methods']['minimum_image']['decorators']);self.assertLessEqual(result['bytes'],16384);self.assertEqual(result['validation'],'not_run')
   self.assertEqual(inspect_source(source,['Unknown'])['symbol_excerpts']['status'],'blocked')
   file.write_text(code.replace('return self.minimum_image(pos,cell).mean()', 'return '+repr('x'*17000)),encoding='utf-8');blocked=inspect_source(source,['ScalarCV'])['symbol_excerpts'];self.assertEqual(blocked['status'],'blocked');self.assertNotIn('symbols',blocked)
 def test_symbols_cannot_request_paths_duplicates_or_unbounded_classes(self):
  for symbols in ('ScalarCV',['../private.py'],['x']*5,['ScalarCV','ScalarCV'],[{}]):
   with self.assertRaises(ValueError):inspect_source({'id':'pygas','root':'/never/read'},symbols)
 def test_graph_contract_exposes_actual_reduce_and_studio_required_io(self):
  out=graph_authoring_contract(PUBLIC_FIXTURE,hashlib.sha256(PUBLIC_FIXTURE.encode()).hexdigest());self.assertIn('.reshape(-1)[:1]',out['entrypoints']['_reduce_expression']);io=out['studio_io'];self.assertEqual(io['required_settings'],['atoms_path','pt_path']);self.assertEqual(io['workflow_path'],'workflow.json');self.assertIn("('atoms_path','pt_path')",io['entrypoints']['portable_graph']);self.assertEqual(io['status'],'passed');self.assertIn('no backend fallback',io['guidance'])
 def test_source_tool_forwards_optional_symbols_and_preserves_read_only_schema(self):
  from studio_worker.server import dispatch,tools
  schema=next(tool for tool in tools() if tool['name']=='inspect_source_project');self.assertNotIn('symbols',schema['inputSchema']['required']);self.assertEqual(schema['inputSchema']['properties']['symbols']['maxItems'],4);self.assertTrue(schema['annotations']['readOnlyHint'])
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'base').mkdir();(root/'base/colvar.py').write_text('class Sample:\n def __init__(self):pass\n def forward(self):return 1\n',encoding='utf-8');source={'id':'pygas','root':str(root)};store=types.SimpleNamespace(get=lambda kind,key:source);service=types.SimpleNamespace(store=store)
   result=dispatch(service,'POST','/api/source-project/inspect',{'source_id':'pygas','symbols':['Sample']});self.assertEqual(result['symbol_excerpts']['symbols'][0]['name'],'Sample')
if __name__=='__main__':unittest.main()
