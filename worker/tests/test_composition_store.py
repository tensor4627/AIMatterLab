import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"studio_worker"))
import json,tempfile,threading,unittest
from pathlib import Path
from composition_store import CompositionStore,JOURNAL
class PairStoreTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve();self.store=CompositionStore(self.root,threading.RLock());self.target=self.root/"cv-test"
 def identity(self,r):return {"journal_sha256":r["journal_sha256"],"files":{name:item["sha256"] for name,item in r["files"].items()}}
 def first(self):return self.store.save(self.target,{"nodes":[]},"# graph source\n",{"journal_sha256":None,"files":{}})
 def test_same_directory_cas_and_both_files_read_back(self):
  first=self.first();second=self.store.save(self.target,{"nodes":[{"id":"cv"}]},"# changed source\n",self.identity(first))
  self.assertEqual(second["status"],"rendered");self.assertEqual(second["directory"],str(self.target));self.assertNotEqual(second["journal_sha256"],first["journal_sha256"]);self.assertEqual(second["source"],"# changed source\n")
  with self.assertRaisesRegex(ValueError,"hash conflict"):self.store.save(self.target,{"nodes":[]},"# stale",self.identity(first))
  self.assertEqual(self.store.read(self.target)["source"],"# changed source\n")
 def test_external_source_change_blocks_instead_of_certifying_old_graph(self):
  self.first();(self.target/"build_bias.py").write_text("# edited outside pair",encoding="utf8")
  result=self.store.read(self.target);self.assertEqual(result["status"],"blocked");self.assertNotIn("source",result)
  with self.assertRaisesRegex(ValueError,"differs"):self.store.save(self.target,{"nodes":[]},"# render",self.identity(result))
 def test_incomplete_graph_is_saved_as_draft_and_does_not_expose_stale_source(self):
  first=self.first();result=self.store.save(self.target,{"nodes":[{"kind":"cv","params":{}}]},None,self.identity(first))
  self.assertEqual(result["status"],"draft");self.assertNotIn("source",result);self.assertTrue((self.target/"build_bias.py").exists());self.assertEqual(result["graph"]["nodes"][0]["params"],{})
 def test_interrupted_second_file_write_leaves_pending_journal_and_blocks_consumers(self):
  first=self.first();replace=self.store._replace
  def fail(path,data):
   if path.name=="build_bias.py":raise OSError("simulated disk failure")
   replace(path,data)
  self.store._replace=fail
  with self.assertRaises(OSError):self.store.save(self.target,{"nodes":[{"id":"changed"}]},"# new",self.identity(first))
  self.assertEqual(json.loads((self.target/JOURNAL).read_text(encoding="utf8"))["status"],"pending")
  reopened=CompositionStore(self.root,threading.RLock());result=reopened.read(self.target);self.assertEqual(result["status"],"blocked");self.assertNotIn("source",result)
 def test_legacy_pair_requires_exact_both_hashes_before_adoption(self):
  self.target.mkdir();(self.target/"workflow.json").write_text('{"nodes":[]}',encoding="utf8");(self.target/"build_bias.py").write_text("# old",encoding="utf8")
  old=self.store.read(self.target);self.assertEqual(old["status"],"legacy")
  with self.assertRaisesRegex(ValueError,"hash conflict"):self.store.save(self.target,{"nodes":[]},"# new",{"journal_sha256":None,"files":{}})
  self.assertEqual(self.store.save(self.target,{"nodes":[]},"# new",self.identity(old))["status"],"rendered")
 def test_explicit_repair_requires_the_current_entire_pair_and_journal_hash(self):
  old=self.first();(self.target/"build_bias.py").write_text("# external edit",encoding="utf8")
  current=self.store.read(self.target);self.assertEqual(current["status"],"blocked")
  with self.assertRaisesRegex(ValueError,"hash conflict"):self.store.save(self.target,{"nodes":[]},"# repaired",self.identity(old),repair=True)
  repaired=self.store.save(self.target,{"nodes":[]},"# explicitly regenerated",self.identity(current),repair=True)
  self.assertEqual(repaired["status"],"rendered");self.assertEqual(repaired["source"],"# explicitly regenerated")
 def test_escape_and_linked_targets_are_refused(self):
  with self.assertRaises(ValueError):self.store.read(self.root.parent/"other")
  self.first()
  try:(self.target/"workflow.json").unlink();(self.target/"workflow.json").symlink_to(self.target/"build_bias.py")
  except OSError as error:self.skipTest("Symlink privilege unavailable: "+str(error))
  with self.assertRaisesRegex(ValueError,"ordinary owned"):self.store.read(self.target)
if __name__=="__main__":unittest.main()
