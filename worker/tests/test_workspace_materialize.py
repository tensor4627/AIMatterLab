import sys,unittest,tempfile,threading,importlib.util,os
from pathlib import Path
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor
repository_root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(repository_root/'worker'))
from studio_worker.store import Store
from studio_worker.service import Service
spec=importlib.util.spec_from_file_location('studio_worker.workspace_materialize',repository_root/'worker/studio_worker/workspace_materialize.py');module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
class CreateOrIdentical(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.store=Store(self.root);self.store.put('project',{'id':'owned','name':'synthetic','policy':{'engines':[],'input_roots':[]}});self.service=SimpleNamespace(root=self.root,store=self.store,input_name=Service.input_name);self.data={'project_id':'owned','name':'stage/input.in','content':'run 12\n'}
 def tearDown(self):self.store.db.close();self.tmp.cleanup()
 def create(self,data=None,admin=True):return module.materialize_input(self.service,data or self.data,admin)
 def test_creates_exact_bytes_and_identical_retry_without_replacement(self):
  a=self.create();p=Path(a['path']);identity=(p.stat().st_ino,p.stat().st_mtime_ns);b=self.create();self.assertEqual(a['status'],'created');self.assertEqual(b['status'],'identical');self.assertEqual(p.read_bytes(),b'run 12\n');self.assertEqual((p.stat().st_ino,p.stat().st_mtime_ns),identity);self.assertEqual(p.stat().st_nlink,1);self.assertFalse(list(p.parent.glob('.studio-create-*')))
 def test_different_existing_bytes_rejected_and_preserved(self):
  a=self.create();before=Path(a['path']).read_bytes();changed={**self.data,'content':'run 999\n'}
  with self.assertRaisesRegex(ValueError,'never overwrite'):self.create(changed)
  self.assertEqual(Path(a['path']).read_bytes(),before)
 def test_unknown_fields_paths_and_oversize_fail(self):
  for change in ({'name':'../outside.in'},{'name':'/absolute.in'},{'expected_sha256':'a'*64},{'content':'x'*(2*1024*1024+1)},{'content':''},{'content':'a\x00b'},{'path':'other'}):
   with self.subTest(change=list(change)):
    with self.assertRaises((ValueError,PermissionError)):self.create({**self.data,**change})
 def test_nonadmin_cannot_create_any_directory(self):
  with self.assertRaises(PermissionError):self.create(admin=False)
  self.assertFalse((self.root/'projects').exists())
 def test_unknown_project_does_not_create_root(self):
  with self.assertRaises(ValueError):self.create({**self.data,'project_id':'unknown'})
  self.assertFalse((self.root/'projects').exists())
 def test_existing_hardlinked_input_is_not_adopted_as_regular_stage(self):
  parent=self.root/'projects/owned/inputs/stage';parent.mkdir(parents=True);other=self.root/'other';other.write_bytes(b'run 12\n');os.link(other,parent/'input.in')
  with self.assertRaisesRegex(ValueError,'single-link'):self.create()
  self.assertEqual(other.read_bytes(),b'run 12\n')
 def test_concurrent_identical_retries_share_one_complete_file(self):
  with ThreadPoolExecutor(max_workers=4)as pool:results=list(pool.map(lambda _:self.create(),range(8)))
  self.assertEqual(sum(v['status']=='created'for v in results),1);self.assertEqual(len(set(v['sha256']for v in results)),1)
 def test_exclusive_link_race_never_overwrites_other_writer(self):
  from unittest.mock import patch
  original=os.link
  def race(source,target,**kwargs):
   fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600,dir_fd=kwargs['dst_dir_fd']);os.write(fd,b'external\n');os.close(fd);raise FileExistsError()
  with patch.object(module.os,'link',side_effect=race),self.assertRaisesRegex(ValueError,'never overwrite'):self.create()
  self.assertEqual((self.root/'projects/owned/inputs/stage/input.in').read_bytes(),b'external\n')
  self.assertFalse(list((self.root/'projects/owned/inputs/stage').glob('.studio-create-*')))
 def test_utf8_content_hashes_actual_bytes(self):
  value=self.create({**self.data,'content':'# \u6d4b\u8bd5\nrun 12\n'});self.assertEqual(Path(value['path']).read_bytes(),'# \u6d4b\u8bd5\nrun 12\n'.encode());self.assertEqual(value['size'],len(Path(value['path']).read_bytes()))


class LinkedPaths(unittest.TestCase):
 setUp=CreateOrIdentical.setUp
 tearDown=CreateOrIdentical.tearDown
 create=CreateOrIdentical.create
 def test_posix_symlink_ancestors_and_targets_are_rejected(self):
  if os.name!='posix':self.skipTest('Actual worker requires POSIX; WSL check supplies symlink evidence')
  real=self.root/'real';real.mkdir();parent=self.root/'projects/owned/inputs';parent.mkdir(parents=True);(parent/'stage').symlink_to(real,target_is_directory=True)
  with self.assertRaisesRegex(ValueError,'Linked'):self.create()
  (parent/'stage').unlink();(parent/'stage').mkdir();outside=self.root/'external.in';outside.write_bytes(b'run 12\n');(parent/'stage/input.in').symlink_to(outside)
  with self.assertRaisesRegex(ValueError,'Linked'):self.create()
  self.assertEqual(outside.read_bytes(),b'run 12\n')


class RootAndParentRaces(unittest.TestCase):
 setUp=CreateOrIdentical.setUp
 tearDown=CreateOrIdentical.tearDown
 create=CreateOrIdentical.create
 def test_project_and_inputs_root_aliases_cannot_write_other_project(self):
  for level in('project','inputs'):
   with self.subTest(level=level):
    owned=self.root/'projects/owned';other=self.root/'projects/other/inputs';other.mkdir(parents=True,exist_ok=True)
    if owned.is_symlink():owned.unlink()
    elif owned.exists():
     import shutil;shutil.rmtree(owned)
    if level=='project':owned.symlink_to(other.parent,target_is_directory=True)
    else:owned.mkdir();(owned/'inputs').symlink_to(other,target_is_directory=True)
    with self.assertRaisesRegex(ValueError,'Linked'):self.create()
    self.assertFalse(list(other.rglob('input.in')))
 def test_parent_swap_to_symlink_does_not_redirect_and_created_file_is_cleaned(self):
  from unittest.mock import patch
  parent=self.root/'projects/owned/inputs/stage';parent.mkdir(parents=True);other=self.root/'other';other.mkdir();moved=self.root/'original-stage';link=os.link
  def swap(source,target,**kwargs):parent.rename(moved);parent.symlink_to(other,target_is_directory=True);return link(source,target,**kwargs)
  with patch.object(module.os,'link',side_effect=swap),self.assertRaisesRegex(ValueError,'linked or replaced'):self.create()
  self.assertFalse((other/'input.in').exists());self.assertFalse((moved/'input.in').exists());self.assertFalse(list(moved.glob('.studio-create-*')))

class ActualDispatch(unittest.TestCase):
 def test_candidate_dispatch_exposes_no_mcp_tool_and_preserves_nonadmin_boundary(self):
  spec=importlib.util.spec_from_file_location('studio_worker.materialize_candidate_server',repository_root/'worker/studio_worker/server.py');server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
  self.assertFalse(any(route=='/api/workspace/materialize'for _,route,_ in server.TOOL_ROUTES.values()))
  with tempfile.TemporaryDirectory()as directory:
   root=Path(directory);store=Store(root);store.put('project',{'id':'owned','name':'synthetic'});service=SimpleNamespace(root=root,store=store,input_name=Service.input_name)
   try:
    data={'project_id':'owned','name':'stage/run.in','content':'run 12\n'}
    with self.assertRaises(PermissionError):server.dispatch(service,'POST','/api/workspace/materialize',data,admin=False)
    value=server.dispatch(service,'POST','/api/workspace/materialize',data,admin=True);self.assertEqual(value['status'],'created');self.assertEqual(Path(value['path']).read_bytes(),b'run 12\n')
   finally:store.db.close()
if __name__=='__main__':unittest.main()

