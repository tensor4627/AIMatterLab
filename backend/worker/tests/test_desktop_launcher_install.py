import importlib.util,json,subprocess,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('desktop_install_entry',ROOT/'scripts/one_prompt.py')
entry=importlib.util.module_from_spec(spec);spec.loader.exec_module(entry)

class DesktopLauncherInstall(unittest.TestCase):
 def config(self,state,node=None):
  desktop={'install_dependencies':True}
  if node is not None:desktop['node']=node
  return {'desktop':desktop,'_config_path':str(state/'config.json')}
 def result(self,code=0,stdout=''):
  return SimpleNamespace(returncode=code,stdout=stdout,stderr='')
 def test_blocked_preflight_starts_no_dependency_build_or_target_and_preserves_old_report(self):
  with tempfile.TemporaryDirectory() as tmp:
   state=Path(tmp);report=state/'desktop-install.json';report.write_text('{"status":"passed"}',encoding='utf-8');old=report.read_bytes()
   with patch.object(entry.subprocess,'run',return_value=self.result(2,'{"status":"blocked","reason":"restricted_token"}')) as run:
    result=entry.desktop(self.config(state),state)
   self.assertEqual(result['status'],'blocked');self.assertEqual(result['reason'],'restricted_token');self.assertTrue(result['user_action']);self.assertEqual(run.call_count,1)
   self.assertEqual(run.call_args.args[0],['node',str(ROOT/'scripts/start.mjs'),'--preflight-only']);self.assertEqual(run.call_args.kwargs['cwd'],ROOT);self.assertEqual(run.call_args.kwargs['timeout'],30);self.assertNotIn('shell',run.call_args.kwargs)
   self.assertEqual(report.read_bytes(),old)
 def test_stale_passed_report_and_nonzero_exit_cannot_pass(self):
  with tempfile.TemporaryDirectory() as tmp:
   state=Path(tmp);report=state/'desktop-install.json';report.write_text('{"status":"passed"}',encoding='utf-8');old=report.read_bytes()
   def run(argv,**kwargs):return self.result(7) if '--studio-install-verify' in argv else self.result(0,'{"status":"allowed"}')
   with patch.object(entry.subprocess,'run',side_effect=run):result=entry.desktop(self.config(state),state)
   self.assertEqual(result['status'],'failed');self.assertEqual(result['exit_code'],7);self.assertEqual(report.read_bytes(),old)
   self.assertFalse((state/'Launch-Studio.ps1').exists());self.assertFalse((state/'launch-studio.sh').exists())
   self.assertFalse((state/'Launch-Studio.cmd').exists())
 def test_zero_exit_with_unchanged_report_is_blocked(self):
  with tempfile.TemporaryDirectory() as tmp:
   state=Path(tmp);report=state/'desktop-install.json';report.write_text('{"status":"passed"}',encoding='utf-8')
   with patch.object(entry.subprocess,'run',return_value=self.result(0,'{"status":"allowed"}')):result=entry.desktop(self.config(state),state)
   self.assertEqual(result['status'],'blocked');self.assertEqual(result['reason'],'desktop_receipt_not_fresh');self.assertFalse(result['receipt_evidence']['fresh'])
 def test_nonzero_exit_cannot_pass_even_with_new_passed_receipt(self):
  with tempfile.TemporaryDirectory() as tmp:
   state=Path(tmp)
   def run(argv,**kwargs):
    if '--studio-install-verify' in argv:
     (state/'desktop-install.json').write_text('{"status":"passed"}',encoding='utf-8');return self.result(9)
    return self.result(0,'{"status":"allowed"}')
   with patch.object(entry.subprocess,'run',side_effect=run):result=entry.desktop(self.config(state),state)
   self.assertEqual(result['status'],'failed');self.assertEqual(result['exit_code'],9);self.assertTrue(result['receipt_evidence']['fresh'])
 def test_fresh_receipt_uses_same_guard_and_profile_and_generates_guarded_launcher(self):
  with tempfile.TemporaryDirectory(prefix="studio install '") as tmp:
   state=Path(tmp);node="C:/Fixture Node's/node.exe";calls=[]
   def run(argv,**kwargs):
    calls.append((argv,kwargs))
    if '--studio-install-verify' in argv:(state/'desktop-install.json').write_text('{"status":"passed","current":true}',encoding='utf-8')
    return self.result(0,'{"status":"allowed"}')
   with patch.object(entry.subprocess,'run',side_effect=run):result=entry.desktop(self.config(state,node),state)
   self.assertEqual(result['status'],'passed');self.assertTrue(result['current']);self.assertTrue(result['receipt_evidence']['fresh'])
   self.assertEqual(calls[0][0],[node,str(ROOT/'scripts/start.mjs'),'--preflight-only']);self.assertEqual(calls[-1][0],[node,str(ROOT/'scripts/start.mjs'),'--studio-install-verify'])
   self.assertEqual(calls[0][1]['env']['STUDIO_PROFILE_DIR'],calls[-1][1]['env']['STUDIO_PROFILE_DIR']);self.assertEqual(calls[-1][1]['env']['STUDIO_PROFILE_DIR'],str(state/'desktop-profile'))
   self.assertTrue(all(call[1]['cwd']==ROOT for call in calls));self.assertTrue(all(not any('electron' in arg for arg in call[0]) for call in calls))
   for windows in (True,False):
    entry._write_desktop_launcher(state,node,windows=windows)
    text=(state/('Launch-Studio.ps1' if windows else 'launch-studio.sh')).read_text(encoding='utf-8')
    self.assertIn('STUDIO_PROFILE_DIR',text);self.assertIn('start.mjs',text);self.assertNotIn('electron',text)
    if windows:self.assertIn("C:/Fixture Node''s/node.exe",text);self.assertIn("''",text);self.assertIn('$LASTEXITCODE',text)
    else:
     import shlex
     line=next(line for line in text.splitlines() if line.startswith('exec '));self.assertEqual(shlex.split(line[5:]),[node,str(ROOT/'scripts/start.mjs')])
 def test_windows_cmd_preserves_percent_and_bang_paths_without_policy_bypass(self):
  with tempfile.TemporaryDirectory(prefix='studio %fixture%!') as tmp:
   state=Path(tmp);node='C:/Fixture %NODE%!/node.exe';root=state/'source %ROOT%!'
   with patch.object(entry,'ROOT',root):entry._write_desktop_launcher(state,node,windows=True)
   text=(state/'Launch-Studio.cmd').read_text(encoding='utf-8')
   self.assertIn('setlocal DisableDelayedExpansion',text);self.assertIn('"C:/Fixture %%NODE%%!/node.exe"',text)
   self.assertIn('set "STUDIO_PROFILE_DIR='+str(state/'desktop-profile').replace('%','%%')+'"',text)
   self.assertIn('"'+str(root/'scripts/start.mjs').replace('%','%%')+'"',text);self.assertIn('exit /b %errorlevel%',text)
   self.assertNotIn('powershell',text.lower());self.assertNotIn('bypass',text.lower());self.assertNotIn('electron',text.lower());self.assertTrue((state/'Launch-Studio.ps1').is_file())
 def test_windows_cmd_rejects_quote_or_control_characters_before_writing_launchers(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=Path(tmp)
   for bad in ('bad"path','bad\rpath','bad\npath','bad\0path'):
    for field in ('node','profile','start'):
     with self.subTest(field=field,bad=repr(bad)):
      state=base/bad if field=='profile' else base;root=base/bad if field=='start' else ROOT;node=bad if field=='node' else 'node'
      with patch.object(entry,'ROOT',root),self.assertRaises(ValueError):entry._write_desktop_launcher(state,node,windows=True)
   self.assertFalse((base/'Launch-Studio.cmd').exists());self.assertFalse((base/'Launch-Studio.ps1').exists())
 def test_preflight_unavailable_timeout_or_malformed_response_never_starts_target(self):
  for outcome in (FileNotFoundError(),subprocess.TimeoutExpired(['node'],30),self.result(0,'not json')):
   with self.subTest(outcome=type(outcome).__name__),tempfile.TemporaryDirectory() as tmp:
    state=Path(tmp)
    with patch.object(entry.subprocess,'run',side_effect=outcome if isinstance(outcome,Exception) else None,return_value=outcome) as run:result=entry.desktop(self.config(state),state)
    self.assertEqual(result['status'],'blocked');self.assertTrue(result['reason']);self.assertTrue(result['user_action']);self.assertEqual(run.call_count,1)
 def test_fingerprint_changes_with_each_guard_file(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);names=['INSTALL_AGENT.md','AGENTS.md','docs/one-prompt-install.md','installation/manifest.json','installation/runtime.py','scripts/one_prompt.py','package.json','pnpm-lock.yaml','index.html','vite.config.ts','tsconfig.json','backend/worker/studio_worker/engine_contracts.json','backend/worker/studio_worker/pygas-editor-hints.json','backend/worker/studio_worker/tool_package.schema.json']
   guards=['scripts/desktop-launch.mjs','scripts/start.mjs','scripts/dev.mjs','scripts/windows-launch-preflight.ps1','scripts/sync-tool-contracts.mjs']
   for name in names+guards:
    file=root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('baseline',encoding='utf-8')
   with patch.object(entry,'ROOT',root):
    before=entry.fingerprint({})
    for name in guards:
     file=root/name;file.write_text('guard changed',encoding='utf-8');self.assertNotEqual(entry.fingerprint({}),before,name);file.write_text('baseline',encoding='utf-8')

if __name__=='__main__':unittest.main()
