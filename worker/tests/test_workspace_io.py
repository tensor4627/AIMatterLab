import unittest,tempfile
from pathlib import Path
from studio_worker.service import Service
from studio_worker.server import dispatch,tools
class WorkspaceIO(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.s=Service(self.root/'worker',schedule=False);self.p=self.s.register_project({'id':'p','name':'p','policy':{'input_roots':[str(self.root/'approved')],'environments':[],'engines':[]}});(self.root/'approved').mkdir()
 def tearDown(self):self.s.close();self.s.store.db.close();self.temp.cleanup()
 def call(self,route,**data):return dispatch(self.s,'POST','/api/workspace/'+route,{'project_id':'p',**data})
 def test_nested_save_read_and_compare_before_overwrite(self):
  first=self.call('write',name='cv-hash/build_bias.py',content='temp=300')
  read=self.call('read',name='cv-hash/build_bias.py');self.assertEqual(read['text'],'temp=300');self.assertEqual(first['sha256'],read['sha256'])
  with self.assertRaisesRegex(ValueError,'expected_sha256'):self.call('write',name='cv-hash/build_bias.py',content='temp=310')
  second=self.call('write',name='cv-hash/build_bias.py',content='temp=310',expected_sha256=read['sha256']);self.assertNotEqual(first['sha256'],second['sha256'])
  with self.assertRaisesRegex(ValueError,'conflict'):self.call('write',name='cv-hash/build_bias.py',content='temp=320',expected_sha256=read['sha256'])
  self.assertEqual(self.call('read',name='cv-hash/build_bias.py')['text'],'temp=310')
 def test_explicit_desktop_editor_save_keeps_legacy_human_boundary(self):
  self.call('write',name='edited.py',content='a=1')
  dispatch(self.s,'POST','/api/workspace/write',{'project_id':'p','name':'edited.py','content':'a=2'},admin=True)
  self.assertEqual(self.call('read',name='edited.py')['text'],'a=2')
  with self.assertRaises(ValueError):self.call('write',name='/'.join(['x']*13),content='bad')
 def test_existing_authorized_inputs_are_readable_without_importing_or_executing(self):
  p=self.root/'approved'/'run.py';p.write_text('raise RuntimeError("must never execute")');r=self.call('read',name=str(p));self.assertIn('must never execute',r['text']);self.assertFalse(r['binary'])
  p=self.root/'approved'/'model.pt';p.write_bytes(b'not a safe model');r=self.call('read',name=str(p));self.assertTrue(r['binary']);self.assertIsNone(r['text'])
 def test_bounded_reads_and_no_arbitrary_path_or_nested_write_escape(self):
  self.call('write',name='large.txt',content='a'*300000);r=self.call('read',name='large.txt');self.assertEqual(len(r['text']),256*1024);self.assertTrue(r['truncated'])
  for route in ['read','write']:
   for name in ['../secret.txt','/etc/passwd']:
    with self.assertRaises(ValueError):self.call(route,name=name,content='forbidden')
 def test_asset_kind_errors_point_to_text_reader_and_mcp_annotation(self):
  with self.assertRaisesRegex(ValueError,'read_project_input'):self.s.inspect('p','none','x','script')
  t=next(t for t in tools() if t['name']=='read_project_input');self.assertTrue(t['annotations']['readOnlyHint'])

 def test_utf8_chunks_do_not_replace_split_chinese_characters(self):
  text='a'*(256*1024-1)+'中文末尾';self.call('write',name='unicode.py',content=text);first=self.call('read',name='unicode.py');second=self.call('read',name='unicode.py',offset=first['offset']);self.assertEqual(first['text']+second['text'],text);self.assertNotIn('\ufffd',first['text']+second['text'])
  bad=self.root/'approved'/'binary.py';bad.write_bytes(b'bad\xffutf8');r=self.call('read',name=str(bad));self.assertTrue(r['binary']);self.assertIsNone(r['text'])

 def test_regression_inspector_keeps_existing_scientific_analysis_available(self):
  import sys
  self.s.register_environment({'id':'e','name':'test','executables':{'python':sys.executable}});p=self.s.store.get('project','p');p['policy']['environments']=['e'];self.s.store.put('project',p)
  folder=self.root/'approved'/'predictions';folder.mkdir();(folder/'energy_test.out').write_text('1 1\n2 2\n');(folder/'force_test.out').write_text('0 0 0 0 0 0\n')
  report=self.s.inspect('p','e',str(folder),'regression');self.assertEqual(report['metrics']['energy']['rmse'],0);self.assertEqual(report['metrics']['virial']['status'],'not_run')
  enum=next(t for t in tools() if t['name']=='inspect_asset')['inputSchema']['properties']['kind']['enum'];self.assertIn('regression',enum);self.assertNotIn('script',enum)

class SourcePreservation(unittest.TestCase):
 def test_engine_processes_never_generate_source_bytecode(self):
  from studio_worker.adapters import process_env
  self.assertEqual(process_env({})['PYTHONDONTWRITEBYTECODE'],'1')
  self.assertEqual(process_env({'variables':{'PYTHONDONTWRITEBYTECODE':'1'}})['PYTHONDONTWRITEBYTECODE'],'1')
  with self.assertRaises(ValueError):process_env({'variables':{'PYTHONDONTWRITEBYTECODE':'0'}})
