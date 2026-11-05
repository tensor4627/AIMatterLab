"""Real synthetic subprocess tests; no engine, worker or live repository."""
import importlib.util,os,pathlib,subprocess,sys,threading,time,unittest
from unittest.mock import patch
WORKER=pathlib.Path(__file__).resolve().parents[1]
file=WORKER/'studio_worker/tools/source_git_identity.py';spec=importlib.util.spec_from_file_location('owned_stream_helper',file);helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
class StreamingTests(unittest.TestCase):
 def run_child(self,code,**options):
  owned=[];reads={'stdout':0,'stderr':0};real_read=os.read;real_popen=subprocess.Popen
  def opening(*a,**k):
   self.assertFalse(k['shell']);self.assertEqual(k['stdin'],subprocess.DEVNULL)
   p=real_popen(*a,**k);owned.append(p);return p
  def reading(fd,n):
   data=real_read(fd,n)
   if owned:
    for name in reads:
     stream=getattr(owned[0],name)
     if not stream.closed and fd==stream.fileno():reads[name]+=len(data)
   return data
  before={t.ident for t in threading.enumerate()}
  try:
   with patch.object(helper.os,'read',reading):
    result=helper._bounded_process([sys.executable,'-B','-c',code],env=helper._environment(),popen=opening,**options)
   return result
  finally:
   self.last=owned;self.reads=reads
   self.assertTrue(owned)
   for p in owned:self.assertIsNotNone(p.poll());self.assertTrue(p.stdout.closed);self.assertTrue(p.stderr.closed)
   self.assertEqual(before,{t.ident for t in threading.enumerate()})
 def test_large_stdout_stops_at_real_limit_plus_sentinel(self):
  with self.assertRaisesRegex(helper.SourceGitError,'stdout byte budget'):
   self.run_child("import os,time;os.write(1,b'x'*2000000);time.sleep(30)")
  self.assertEqual(self.reads['stdout'],262145);self.assertLessEqual(self.reads['stderr'],8193)
 def test_large_stderr_stops_at_real_limit_plus_sentinel(self):
  with self.assertRaisesRegex(helper.SourceGitError,'stderr byte budget'):
   self.run_child("import os,time;os.write(2,b'x'*2000000);time.sleep(30)")
  self.assertEqual(self.reads['stderr'],8193);self.assertLessEqual(self.reads['stdout'],262145)
 def test_both_streams_are_drained_without_pipe_deadlock(self):
  r=self.run_child("import os\nfor i in range(64):\n os.write(1,b'o'*2048)\n os.write(2,b'e'*64)\n")
  self.assertEqual(r.returncode,0);self.assertEqual(len(r.stdout),131072);self.assertEqual(len(r.stderr),4096)
 def test_simultaneous_flood_is_stopped_without_unbounded_reads(self):
  with self.assertRaises(helper.SourceGitError):
   self.run_child("import os,threading,time\na=threading.Thread(target=lambda:os.write(1,b'o'*4000000));b=threading.Thread(target=lambda:os.write(2,b'e'*4000000));a.start();b.start();a.join();b.join();time.sleep(30)")
  self.assertLessEqual(self.reads['stdout'],262145);self.assertLessEqual(self.reads['stderr'],8193)
 def test_exact_boundary_and_split_utf8_are_preserved(self):
  r=self.run_child("import os;os.write(1,'é'.encode()*131072);os.write(2,b'e'*8192)")
  self.assertEqual(r.stdout,'é'*131072);self.assertEqual(r.stderr,'e'*8192)
 def test_slow_flow_has_absolute_deadline_not_inactivity_reset(self):
  started=time.monotonic()
  with self.assertRaises(subprocess.TimeoutExpired):
   self.run_child("import os,time\nwhile True:\n os.write(1,b'x');time.sleep(.025)\n",timeout=.2)
  self.assertLess(time.monotonic()-started,3)
 def test_child_closes_pipes_then_lingers_is_still_timed_out(self):
  with self.assertRaises(subprocess.TimeoutExpired):self.run_child("import os,time;os.close(1);os.close(2);time.sleep(30)",timeout=.2)
 def test_nonzero_exit_is_returned_for_existing_run_classification(self):
  r=self.run_child("import os;os.write(2,b'bounded cause');raise SystemExit(7)")
  self.assertEqual(r.returncode,7);self.assertEqual(r.stderr,'bounded cause')
 def test_invalid_utf8_fails_without_leaked_handles(self):
  with self.assertRaisesRegex(helper.SourceGitError,'UTF-8'):self.run_child("import os;os.write(1,b'\\xff')")
 def test_timeout_does_not_kill_unrelated_process(self):
  sentinel=subprocess.Popen([sys.executable,'-B','-c','import time;time.sleep(30)'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  try:
   with self.assertRaises(subprocess.TimeoutExpired):self.run_child('import time;time.sleep(30)',timeout=.15)
   self.assertIsNone(sentinel.poll())
  finally:sentinel.kill();sentinel.wait(timeout=2)
 def test_default_run_branch_uses_real_bounded_reader(self):
  self.assertEqual(helper._run([sys.executable,'-B','-c',"print(' real metadata ')"]),'real metadata')
  with self.assertRaisesRegex(helper.SourceGitError,'stdout byte budget'):helper._run([sys.executable,'-B','-c',"import os;os.write(1,b'x'*2000000)"])
 def test_injected_run_contract_and_status_mapping_stay_compatible(self):
  import types
  seen=[]
  def fake(command,**kwargs):seen.append(kwargs);return types.SimpleNamespace(returncode=0,stdout='identity\n',stderr='')
  self.assertEqual(helper._run(['synthetic'],run=fake),'identity');self.assertTrue(seen[0]['capture_output']);self.assertEqual(seen[0]['timeout'],8)
  with self.assertRaises(helper.SourceGitError)as cm:helper._run(['synthetic'],run=lambda *a,**k:(_ for _ in()).throw(FileNotFoundError()))
  self.assertEqual(cm.exception.status,'blocked')
  with self.assertRaises(helper.SourceGitError)as cm:helper._run(['synthetic'],run=lambda *a,**k:(_ for _ in()).throw(subprocess.TimeoutExpired('synthetic',8)))
  self.assertEqual(cm.exception.status,'unknown')
if __name__=='__main__':unittest.main()
