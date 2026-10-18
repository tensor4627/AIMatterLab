import sys,unittest,tempfile,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.server import dispatch,tools
from studio_worker.service import Service
from studio_worker.source_projects import inspect_source
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'studio_worker'))
from structure_tools import create

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
