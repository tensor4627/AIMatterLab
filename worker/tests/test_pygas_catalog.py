import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"studio_worker"))
import hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
from pygas_catalog import catalog

class CatalogTests(unittest.TestCase):
 def fixture(self):
  temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);root=Path(temp.name);(root/"tools").mkdir();(root/"base").mkdir()
  (root/"tools/cv_bias_gui_server.py").write_text("EXCLUDED_CV={'CV'}\nEXCLUDED_BIAS={'Bias'}\nEXCLUDED_SWITCH={'Base'}\nEXCLUDED_NEIGHBOR=set()\nFORWARD_ARG_MAP={'pos':'pos','cell':'cell','side_array':'side_array'}\nCV_OUTPUT_SIZES={'RealCV':1}\nraise RuntimeError('MUST NEVER IMPORT')",encoding="utf-8")
  for kind,name in [('colvar','RealCV'),('bias','RealBias'),('switch','RealSwitch'),('neighbor','RealNeighbor')]:
   args={'colvar':'pos, cell','bias':'cv, cv_traj','switch':'pos','neighbor':'pos, cell, side_array'}[kind]
   (root/f'base/{kind}.py').write_text(f'class {name}:\n    """Real source documentation."""\n    def __init__(self, atom_idx: list, n_atoms: int, weight: float=0.2, active=True, internal_dtype=None): pass\n    def forward(self,{args}): pass\n',encoding='utf-8')
  return root
 def test_parameters_are_actual_typed_schema_not_gui_example_values(self):
  root=self.fixture();result=catalog({'id':'pygas','root':str(root),'commit':'actual-source-only'})
  self.assertEqual({k:len(v) for k,v in result['catalog'].items()},{'cv':1,'bias':1,'switch':1,'neighbor':1});entry=result['catalog']['cv'][0]
  self.assertEqual(entry['forward_args'],['pos','cell']);self.assertEqual(entry['output_size'],1);params={p['name']:p for p in entry['params']}
  self.assertTrue(params['atom_idx']['required']);self.assertEqual(params['n_atoms']['type_hint'],'int');self.assertEqual(params['weight']['default_value'],0.2);self.assertEqual(params['active']['default_value'],True);self.assertTrue(params['internal_dtype']['default_is_literal']);self.assertEqual(result['validation'],'not_run')
  self.assertEqual(entry['source']['sha256'],hashlib.sha256((root/'base/colvar.py').read_bytes()).hexdigest())
 def test_unknown_forward_and_base_class_are_not_offered(self):
  root=self.fixture();p=root/'base/colvar.py';p.write_text(p.read_text()+"class CV:\n def __init__(self):pass\n def forward(self,pos):pass\nclass Hidden:\n def __init__(self):pass\n def forward(self,unknown):pass\n")
  self.assertEqual([v['name'] for v in catalog({'root':str(root)})['catalog']['cv']],['RealCV'])
 def test_missing_or_changed_gui_contract_blocks_no_fake_schema(self):
  root=self.fixture();p=root/'tools/cv_bias_gui_server.py';p.write_text(p.read_text().replace('CV_OUTPUT_SIZES','CHANGED_API'))
  with self.assertRaisesRegex(ValueError,'unsupported'):catalog({'root':str(root)})

if __name__=='__main__':unittest.main()
