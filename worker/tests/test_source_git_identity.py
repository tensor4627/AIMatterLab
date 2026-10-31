"""Synthetic public Git metadata only; never engine imports or live repositories."""
import hashlib,importlib.util,json,os,runpy,subprocess,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];CANDIDATE=ROOT/'worker/studio_worker'
sys.path.insert(0,str(ROOT/'worker'))
from studio_worker import runtime_guides

def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);
 if '.'in name:setattr(sys.modules[name.rsplit('.',1)[0]],name.rsplit('.',1)[1],module)
 return module
from studio_worker import source_git_identity as helper,scientific,environment_api as api

def git(root,*args):
 return subprocess.check_output(['git','-c','user.name=Synthetic','-c','user.email=synthetic@example.test','-C',str(root),*args],text=True,stderr=subprocess.PIPE).strip()
def snapshot(root):
 return {str(p.relative_to(root)):(hashlib.sha256(p.read_bytes()).hexdigest(),p.stat().st_mtime_ns)for p in root.rglob('*')if p.is_file()}
@unittest.skipUnless(os.name=='posix','WSL path-mapping cases; native Git identity tested separately')
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='studio-git-readonly-');self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.main=self.root/'Main Repo';self.main.mkdir();git(self.main,'init');(self.main/'public.txt').write_text('main\n');git(self.main,'add','public.txt');git(self.main,'commit','-m','synthetic');self.mainhead=git(self.main,'rev-parse','HEAD');self.link=self.root/'folder with spaces'/'linked';self.link.parent.mkdir();git(self.main,'worktree','add','-b','selected',str(self.link));(self.link/'public.txt').write_text('selected\n');git(self.link,'add','public.txt');git(self.link,'commit','-m','selected synthetic');self.selected=git(self.link,'rev-parse','HEAD');self.admin=self.main/'.git/worktrees/linked';self.win_admin='D:/synthetic/Main Repo/.git/worktrees/linked';self.win_back='C:/synthetic/folder with spaces/linked/.git'
 def mapped(self):
  (self.link/'.git').write_text('gitdir: '+self.win_admin+'\n');(self.admin/'gitdir').write_text(self.win_back+'\n')
 def mapper(self,value):
  return str({self.win_admin:self.admin,self.win_back:self.link/'.git'}[value])
 def test_native_repository_and_native_linked_worktree_are_distinct(self):
  self.assertEqual(helper.git_identity(self.main)['commit'],self.mainhead);r=helper.git_identity(self.link);self.assertEqual(r['commit'],self.selected);self.assertFalse(r['dirty']);self.assertNotEqual(self.mainhead,self.selected)
 def test_windows_mapping_uses_selected_branch_and_changes_no_metadata(self):
  self.mapped();before=snapshot(self.main/'.git');root_before=snapshot(self.link);r=helper.git_identity(self.link,mapper=self.mapper);self.assertEqual(r['commit'],self.selected);self.assertFalse(r['dirty']);self.assertEqual(r['mechanism'],'validated_windows_worktree');self.assertEqual(snapshot(self.main/'.git'),before);self.assertEqual(snapshot(self.link),root_before)
 def test_dirty_is_actual_status_not_coerced_to_clean(self):
  self.mapped();(self.link/'public.txt').write_text('changed\n');self.assertTrue(helper.git_identity(self.link,mapper=self.mapper)['dirty'])
 def test_wrong_backlink_and_commondir_rejected(self):
  self.mapped();(self.admin/'gitdir').write_text(str(self.main/'.git')+'\n')
  with self.assertRaisesRegex(helper.SourceGitError,'backlink'):helper.git_identity(self.link,mapper=self.mapper)
  (self.admin/'gitdir').write_text(self.win_back+'\n');(self.admin/'commondir').write_text('../../elsewhere\n')
  with self.assertRaises(helper.SourceGitError):helper.git_identity(self.link,mapper=self.mapper)
 def test_symlink_control_and_ancestor_refused(self):
  self.mapped();p=self.admin/'gitdir';p.unlink();p.symlink_to(self.link/'public.txt')
  with self.assertRaisesRegex(helper.SourceGitError,'Linked'):helper.git_identity(self.link,mapper=self.mapper)
  alias=self.root/'alias';alias.symlink_to(self.link,target_is_directory=True)
  with self.assertRaisesRegex(helper.SourceGitError,'Linked'):helper.git_identity(alias,mapper=self.mapper)
 def test_oversized_or_multiline_controls_refused(self):
  self.mapped()
  for text in ['x'*4097+'\n','gitdir: '+self.win_admin+'\nextra\n']:
   (self.link/'.git').write_text(text)
   with self.assertRaises(helper.SourceGitError):helper.git_identity(self.link,mapper=self.mapper)
 def test_missing_metadata_foreign_admin_and_unsupported_mapper_refused(self):
  self.mapped();(self.admin/'gitdir').unlink()
  with self.assertRaises((helper.SourceGitError,OSError)):helper.git_identity(self.link,mapper=self.mapper)
  with self.assertRaises(helper.SourceGitError):helper._map('D:/safe',mapper=lambda _: '../escape')
  with self.assertRaises(helper.SourceGitError):helper._map('//server/share')
  with self.assertRaises(helper.SourceGitError):helper._map('D:/safe/../escape')
 def test_fixed_argv_and_environment_strip_ambient_git_authority(self):
  self.mapped();calls=[]
  def run(command,**kw):
   calls.append((command,kw));self.assertNotIn('GIT_DIR',kw['env']);self.assertEqual(kw['env']['GIT_COMMON_DIR'],str(self.main/'.git'));self.assertEqual(kw['env']['GIT_OPTIONAL_LOCKS'],'0');return types.SimpleNamespace(returncode=0,stdout=self.selected+'\n'if command[-2:]==['rev-parse','HEAD']else'',stderr='')
  with patch.dict(os.environ,{'GIT_DIR':'foreign','GIT_CONFIG_COUNT':'1','GIT_CONFIG_KEY_0':'core.fsmonitor','GIT_CONFIG_VALUE_0':'forbidden'}):helper.git_identity(self.link,mapper=self.mapper,run=run)
  self.assertEqual(len(calls),2)
  for command,_ in calls:self.assertIn('--no-optional-locks',command);self.assertIn('core.fsmonitor=false',command);self.assertIn('--work-tree='+str(self.link),command)
 def test_windows_edge_whitespace_is_rejected_internal_spaces_preserved(self):
  for value in [' D:/safe','D:/safe ','D:/safe\t']:
   with self.assertRaises(helper.SourceGitError):helper._map(value,mapper=lambda _:str(self.admin))
  with self.assertRaises(helper.SourceGitError):helper._map('D:/safe',mapper=lambda _:' '+str(self.admin))
  with self.assertRaises(helper.SourceGitError):helper._map('D:/safe',run=lambda *a,**k:types.SimpleNamespace(returncode=0,stdout=str(self.admin)+' \n',stderr=''))
 def test_control_reads_request_at_most_4097_bytes(self):
  self.mapped();opened=[];real=Path.open
  class Reader:
   def __init__(self,stream):self.stream=stream
   def __enter__(self):return self
   def __exit__(self,*args):self.stream.close()
   def read(self,n):opened.append(n);return self.stream.read(n)
  def opening(path,*a,**kw):return Reader(real(path,*a,**kw))
  with patch.object(Path,'open',opening):helper.git_identity(self.link,mapper=self.mapper)
  self.assertTrue(opened);self.assertEqual(set(opened),{4097})
 def test_git_timeout_invalid_head_and_output_budget(self):
  for run in [lambda *a,**k:(_ for _ in ()).throw(subprocess.TimeoutExpired('git',8)),lambda *a,**k:types.SimpleNamespace(returncode=0,stdout='z'*40,stderr=''),lambda *a,**k:types.SimpleNamespace(returncode=0,stdout='a'*262145,stderr='')]:
   with self.assertRaises(helper.SourceGitError):helper.git_identity(self.main,run=run)
 def test_control_changed_during_command_is_rejected(self):
  self.mapped()
  def run(command,**kw):
   (self.admin/'gitdir').write_text('/different/.git\n');return types.SimpleNamespace(returncode=0,stdout=self.selected+'\n'if command[-2:]==['rev-parse','HEAD']else'',stderr='')
  with self.assertRaisesRegex(helper.SourceGitError,'changed'):helper.git_identity(self.link,mapper=self.mapper,run=run)
 def test_probe_repository_observer_and_inspector_share_actual_helper(self):
  self.mapped();identity=lambda root:helper.git_identity(root,mapper=self.mapper)
  with patch.object(scientific,'probe_modules',return_value=()),patch.object(scientific,'git_identity',side_effect=identity),patch.object(scientific.importlib,'import_module',side_effect=AssertionError('no engine imports')):
   r=scientific.probe({'engine':'synthetic','repositories':{'pydyn':str(self.link)}})
  with patch.object(api,'source_git_identity',side_effect=identity):current=api.git_identity(self.link)
  self.assertEqual(r['repositories']['pydyn']['commit'],current['commit']);self.assertEqual(r['repositories']['pydyn']['dirty'],current['dirty']);self.assertEqual(r['repositories']['pydyn']['status'],'passed')
 def test_script_and_package_entry_import_only_owned_stdlib_helper(self):
  with patch.object(sys,'path',[str(CANDIDATE),*sys.path]):script=runpy.run_path(str(CANDIDATE/'scientific.py'),run_name='synthetic_not_main')
  self.assertIn('git_identity',script);self.assertTrue(callable(scientific.git_identity));self.assertNotIn('torch',sys.modules);self.assertNotIn('pydyn',sys.modules)

 def test_legacy_null_git_guide_remains_observed_but_new_api_refuses(self):
  fixture_module=load('synthetic_environment_api_tests',ROOT/'worker/tests/test_environment_api.py');f=fixture_module.Tests('test_authoring_only_empty_job_grant_read_passes_and_does_not_grant');f.setUp();self.addCleanup(f.doCleanups);f.probe['repositories']['pydyn'].update(commit=None,dirty=None,status='not_run');f.record();guide=runtime_guides.RuntimeGuides(f.service.root/'runtime-guides').read(f.env,'pydyn.sampling');self.assertEqual(guide['status'],'observed');f.error('source_git_observation_missing',f.read)

if __name__=='__main__':unittest.main()

class NativeIdentityTests(unittest.TestCase):
 def test_native_read_keeps_ordinary_configuration_semantics_and_no_git_writes(self):
  with tempfile.TemporaryDirectory(prefix="studio-native-git-") as folder:
   root=Path(folder);git(root,"init");(root/"public.txt").write_bytes(b"native\n");git(root,"add","public.txt");git(root,"commit","-m","synthetic native");head=git(root,"rev-parse","HEAD");expected=bool(git(root,"status","--porcelain"));before=snapshot(root/".git");actual=helper.git_identity(root);self.assertEqual(actual["commit"],head);self.assertEqual(actual["dirty"],expected);self.assertEqual(actual["mechanism"],"native_git");self.assertEqual(snapshot(root/".git"),before)

if __name__=='__main__':unittest.main()
