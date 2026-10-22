import sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.pygas_composition import resolve_input

class OwnedRelativeInputs(unittest.TestCase):
 def test_saved_relative_structure_wins_over_unrelated_same_basename(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp).resolve();owned=root/'cv-owned';other=root/'import-other';owned.mkdir();other.mkdir()
   (owned/'model.xyz').write_text('owned immutable structure');(other/'model.xyz').write_text('different selected candidate')
   assets=[{'path':str(p),'name':'model.xyz'}for p in(owned/'model.xyz',other/'model.xyz')]
   project={'policy':{'input_roots':[]}}
   self.assertEqual(resolve_input('model.xyz',owned,assets,root,project),owned/'model.xyz')
   self.assertEqual(resolve_input(str(other/'model.xyz'),owned,assets,root,project),other/'model.xyz')
   self.assertEqual((owned/'model.xyz').read_text(),'owned immutable structure')
 def test_missing_relative_file_still_requires_unique_authorized_source(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp).resolve();owned=root/'cv-owned';owned.mkdir();assets=[]
   for name in('a','b'):
    folder=root/name;folder.mkdir();p=folder/'model.xyz';p.write_text(name);assets.append({'path':str(p),'name':'model.xyz'})
   with self.assertRaisesRegex(ValueError,'explicit authorized'):resolve_input('model.xyz',owned,assets,root,{'policy':{'input_roots':[]}})
   self.assertEqual(resolve_input('model.xyz',owned,assets[:1],root,{'policy':{'input_roots':[]}}),Path(assets[0]['path']))
 def test_relative_traversal_cannot_select_another_composition(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp).resolve();owned=root/'cv-owned';owned.mkdir();(root/'model.xyz').write_text('other')
   with self.assertRaisesRegex(ValueError,'traverse'):resolve_input('../model.xyz',owned,[],root,{'policy':{'input_roots':[]}})

 def test_owned_directory_is_not_replaced_by_a_different_asset_file(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp).resolve();owned=root/'cv-owned';owned.mkdir();(owned/'model.xyz').mkdir();other=root/'model.xyz';other.write_text('other')
   with self.assertRaisesRegex(ValueError,'ordinary'):resolve_input('model.xyz',owned,[{'path':str(other),'name':'model.xyz'}],root,{'policy':{'input_roots':[]}})
 def test_leaf_broken_and_ancestor_links_are_rejected(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp).resolve();owned=root/'cv-owned';owned.mkdir();folder=owned/'actual';folder.mkdir();(folder/'model.xyz').write_text('owned')
   try:
    (owned/'leaf.xyz').symlink_to(folder/'model.xyz');(owned/'broken.xyz').symlink_to(folder/'missing.xyz');(owned/'linked').symlink_to(folder,target_is_directory=True)
   except OSError as error:self.skipTest('Host cannot create test-owned symbolic links: '+str(error))
   for name in('leaf.xyz','broken.xyz','linked/model.xyz'):
    with self.subTest(name=name),self.assertRaisesRegex(ValueError,'Linked'):resolve_input(name,owned,[],root,{'policy':{'input_roots':[]}})

if __name__=='__main__':unittest.main()
