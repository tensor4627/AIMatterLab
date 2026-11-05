import contextlib,copy,hashlib,importlib.util,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[3]
# This test becomes worker/tests/test_reuse_existing.py after the Round 2 gate.
ROOT=ROOT if (ROOT/'scripts/one_prompt.py').is_file() else Path.cwd()
spec=importlib.util.spec_from_file_location('reuse_entry',ROOT/'scripts/one_prompt.py');entry=importlib.util.module_from_spec(spec);spec.loader.exec_module(entry)
class ReuseExisting(unittest.TestCase):
 def setUp(self):
  self.source_signature='current';self.actual_fingerprint=entry.fingerprint;self.fingerprint=patch.object(entry,'fingerprint',side_effect=lambda config:self.source_signature);self.fingerprint.start();self.addCleanup(self.fingerprint.stop)
 def config(self):return {'schema_version':1,'desktop':{'install_dependencies':True},'worker':{'root':'/tmp/studio-test','distribution':'Ubuntu'},'compute':{'kind':'wsl','environment':{'executables':{'python':'/usr/bin/python3'}}},'bootstrap':{'enabled':False},'cases':['worker']}
 def test_reuse_enforces_no_bootstrap_or_dependency_install_and_preserves_config(self):
  calls=[];cfg=self.config();before=copy.deepcopy(cfg)
  def invoke(c,action,approved=False,**kw):
   calls.append(action);return {'status':'passed','checks':[{'id':'worker','status':'passed'}]} if action=='smoke' else {'status':'passed'}
  def desktop(c,state,**kw):calls.append(('desktop',kw));return {'status':'passed'}
  with tempfile.TemporaryDirectory() as tmp,patch.object(entry,'invoke',invoke),patch.object(entry,'desktop',desktop):
   result=entry.reuse_existing(cfg,Path(tmp),{},'current')
   self.assertEqual(calls,['audit-root','probe','smoke',('desktop',{'reuse_existing':True})]);self.assertTrue(result['reuse_readiness_success']);self.assertFalse(result['installation_success']);self.assertTrue(result['dry_run']);self.assertEqual(cfg,before);self.assertTrue(all(v['status']=='not_run' for v in result['skipped_actions']))
 def test_missing_selected_case_cannot_be_reported_ready(self):
  cfg=self.config();cfg['cases']=['worker','gpumd-md']
  with tempfile.TemporaryDirectory() as tmp,patch.object(entry,'invoke',return_value={'status':'passed','checks':[{'id':'worker','status':'passed'}]}),patch.object(entry,'desktop',return_value={'status':'passed'}):
   result=entry.reuse_existing(cfg,Path(tmp),{},'current');self.assertFalse(result['reuse_readiness_success']);self.assertFalse(result['installation_success'])
 def test_enabled_bootstrap_blocks_without_any_target_action(self):
  cfg=self.config();cfg['bootstrap']['enabled']=True
  with tempfile.TemporaryDirectory() as tmp,patch.object(entry,'invoke') as invoke,patch.object(entry,'desktop') as desktop:
   result=entry.reuse_existing(cfg,Path(tmp),{},'current');self.assertEqual(result['status'],'blocked');invoke.assert_not_called();desktop.assert_not_called()
 def test_stale_signature_runs_current_probe_provider_and_explicit_smoke_cache_retains_original_time(self):
  self.source_signature='new'
  cfg=self.config();old={k:{'fingerprint':'old','result':{'status':'passed'}} for k in entry.REQUIRED}
  def invoked(c,action,approved=False,**kw):return {'status':'passed','checks':[{'id':'worker','status':'passed'}]} if action=='smoke' else {'status':'passed'}
  with tempfile.TemporaryDirectory() as tmp,patch.object(entry,'invoke',side_effect=invoked) as invoke,patch.object(entry,'desktop',return_value={'status':'passed'}) as desktop:
   first=entry.reuse_existing(cfg,Path(tmp),old,'new');self.assertTrue(first['reuse_readiness_success']);self.assertFalse(first['cached_evidence']);self.assertEqual(invoke.call_count,3);self.assertEqual(desktop.call_count,1)
   smoke_time=old['smoke']['checked_at'];second=entry.reuse_existing(cfg,Path(tmp),old,'new',reuse_smoke_receipt=True);self.assertTrue(second['reuse_readiness_success']);self.assertEqual(second['checks']['smoke']['observed_at'],smoke_time);self.assertTrue(second['checks']['smoke']['receipt_cache']);self.assertFalse(second['checks']['target-probe']['receipt_cache']);self.assertFalse(second['checks']['desktop']['receipt_cache']);self.assertTrue(second['cached_evidence']);self.assertEqual(invoke.call_count,5);self.assertEqual(desktop.call_count,2)
 def test_unknown_controller_directory_is_not_changed_even_by_main_error_receipt(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);state=root/'production';state.mkdir();(state/'catalog.db').write_bytes(b'production-state');cfg=root/'config.json';cfg.write_text(json.dumps(self.config()),encoding='utf-8');before={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in state.iterdir()}
   with patch.object(entry,'fingerprint',return_value='current'),patch.object(entry,'invoke') as invoke,contextlib.redirect_stdout(io.StringIO()):status=entry.main(['reuse-existing','--config',str(cfg),'--state-dir',str(state)])
   self.assertEqual(status,2);invoke.assert_not_called();self.assertEqual({f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in state.iterdir()},before)
 def test_marker_rejects_wrong_role_root_alias_and_new_fingerprint(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/'owned';guard={'fingerprint':'current','audit_id':'audit'};entry.claim_audit_root(root,guard,'controller');before=(root/'.studio-reuse-audit.json').read_bytes()
   for path,value,role in [(root,guard,'worker'),(root,dict(guard,fingerprint='changed'),'controller'),(root/'..'/root.name,guard,'controller')]:
    with self.assertRaises(ValueError):entry.claim_audit_root(path,value,role)
   self.assertEqual((root/'.studio-reuse-audit.json').read_bytes(),before)
 def test_probe_identity_change_blocks_historical_smoke_without_changing_owned_marker(self):
  cfg=self.config();records={}
  def invoked(c,action,approved=False,**kw):return {'status':'passed','checks':[{'id':'worker','status':'passed'}]} if action=='smoke' else {'status':'passed','identity':'one'}
  with tempfile.TemporaryDirectory() as tmp,patch.object(entry,'invoke',side_effect=invoked),patch.object(entry,'desktop',return_value={'status':'passed'}):
   state=Path(tmp);entry.reuse_existing(cfg,state,records,'current');marker=(state/'.studio-reuse-audit.json').read_bytes()
   def changed(c,action,approved=False,**kw):return {'status':'passed','identity':'two'}
   with patch.object(entry,'invoke',side_effect=changed):result=entry.reuse_existing(cfg,state,records,'current',reuse_smoke_receipt=True)
   self.assertFalse(result['reuse_readiness_success']);self.assertEqual(result['checks']['smoke']['status'],'blocked');self.assertEqual((state/'.studio-reuse-audit.json').read_bytes(),marker)
   with patch.object(entry,'invoke',side_effect=changed):again=entry.reuse_existing(cfg,state,records,'current',reuse_smoke_receipt=True)
   self.assertFalse(again['reuse_readiness_success']);self.assertEqual(again['checks']['smoke']['status'],'blocked')
 def test_reuse_receipts_cannot_be_promoted_to_installation_success(self):
  cfg=self.config();records={}
  def invoked(c,action,approved=False,**kw):return {'status':'passed','checks':[{'id':'worker','status':'passed'}]} if action=='smoke' else {'status':'passed'}
  with tempfile.TemporaryDirectory() as tmp,patch.object(entry,'invoke',side_effect=invoked),patch.object(entry,'desktop',return_value={'status':'passed'}):
   result=entry.reuse_existing(cfg,Path(tmp),records,'current');self.assertTrue(result['reuse_readiness_success']);final=entry.finalize(records,'current',cfg['cases']);self.assertEqual(final['status'],'blocked');self.assertFalse(final['installation_success']);self.assertTrue(all(v['verification_mode']=='reuse-existing' for v in records.values()))
 def test_default_reentry_cannot_discard_completion_then_mislabel_old_run_as_fresh(self):
  cfg=self.config();records={};actions=[]
  def invoked(c,action,approved=False,**kw):
   actions.append(action);return {'status':'passed','checks':[{'id':'worker','status':'passed'}]} if action=='smoke' else {'status':'passed'}
  with tempfile.TemporaryDirectory() as tmp,patch.object(entry,'invoke',side_effect=invoked),patch.object(entry,'desktop',return_value={'status':'passed'}):
   state=Path(tmp);first=entry.reuse_existing(cfg,state,records,'current');self.assertTrue(first['reuse_readiness_success'])
   for _ in range(2):
    result=entry.reuse_existing(cfg,state,records,'current');self.assertFalse(result['reuse_readiness_success']);self.assertEqual(result['checks']['smoke']['status'],'blocked')
   self.assertEqual(actions.count('smoke'),1)
 def test_source_change_during_audit_blocks_before_later_phase(self):
  cfg=self.config();records={};actions=[]
  def invoked(c,action,approved=False,**kw):actions.append(action);return {'status':'passed'}
  with tempfile.TemporaryDirectory() as tmp,patch.object(entry,'fingerprint',side_effect=['current','changed']),patch.object(entry,'invoke',side_effect=invoked),patch.object(entry,'desktop') as desktop:
   result=entry.reuse_existing(cfg,Path(tmp),records,'current');self.assertEqual(result['status'],'blocked');self.assertTrue(result['source_changed']);self.assertFalse(result['reuse_readiness_success']);self.assertEqual(actions,['audit-root']);desktop.assert_not_called()
 def test_desktop_reads_the_frozen_config_not_a_mutable_external_path(self):
  cfg=self.config();cfg['_config_path']='/external/config.json'
  def invoked(c,action,approved=False,**kw):return {'status':'passed','checks':[{'id':'worker','status':'passed'}]} if action=='smoke' else {'status':'passed'}
  def desktop(c,state,**kw):
   snapshot=Path(c['_config_path']);self.assertEqual(snapshot.parent,state);self.assertEqual(json.loads(snapshot.read_text(encoding='utf-8')),{k:v for k,v in cfg.items() if k!='_config_path'});return {'status':'passed'}
  with tempfile.TemporaryDirectory() as tmp,patch.object(entry,'invoke',side_effect=invoked),patch.object(entry,'desktop',side_effect=desktop):
   result=entry.reuse_existing(cfg,Path(tmp),{},'current');self.assertTrue(result['reuse_readiness_success']);self.assertEqual(cfg['_config_path'],'/external/config.json')
 def test_install_source_summary_scope_is_explicit_and_validated(self):
  cfg=self.config();cfg['worker']['root']='/tmp/studio-audit'
  for ids in ([],['pygas'],['pygas','pydyn','gpumd','hotpp','torchnep']):
   cfg['desktop']['source_ids']=ids;self.assertEqual(entry.validate(cfg)['desktop']['source_ids'],ids)
  for ids in ('pygas',['private-repo'],[{}]):
   cfg['desktop']['source_ids']=ids
   with self.assertRaises(ValueError):entry.validate(cfg)
 def test_fingerprint_covers_deployment_code_contracts_public_skill_schema_and_nested_styles(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)
   names=['INSTALL_AGENT.md','AGENTS.md','docs/one-prompt-install.md','installation/manifest.json','installation/runtime.py','scripts/one_prompt.py','package.json','pnpm-lock.yaml','index.html','backend/worker/pyproject.toml','vite.config.ts','tsconfig.json','desktop/generated/v2/Protocol.ts','backend/worker/studio_worker/engine_contracts.json','backend/worker/studio_worker/pygas-editor-hints.json','backend/worker/studio_worker/tool_package.schema.json','backend/worker/install.py','agent/builtin-skills/public/references/profile.schema.json','frontend/presentation/theme/nested.css','contracts/tools/engine-contracts.json','contracts/dto/workspace.ts','backend/main/workspace/routes.mjs','agent/context/task-turn-context.mjs','frontend/api/studio.ts','frontend/presentation/assets/icon.svg']
   for name in names:
    file=root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('baseline',encoding='utf-8')
   with patch.object(entry,'ROOT',root),patch.object(entry,'fingerprint',self.actual_fingerprint):
    before=entry.fingerprint({})
    for name in names:
     file=root/name;file.write_text('changed',encoding='utf-8');self.assertNotEqual(entry.fingerprint({}),before,name);file.write_text('baseline',encoding='utf-8')
    for name in ('backend/worker/tests/excluded.py','.studio/tool-packages/example-package/source/private.py','.studio/tool-packages/example-package/execution/SKILL.md'):
     excluded=root/name;excluded.parent.mkdir(parents=True,exist_ok=True);excluded.write_text('not deployed',encoding='utf-8');self.assertEqual(entry.fingerprint({}),before,name)
 def test_remote_probe_receives_selected_case_requirements_without_controller_connection(self):
  cfg=self.config();cfg['compute']['kind']='ssh';cfg['compute']['connection']={'host':'example.invalid','username':'synthetic'};cfg['cases']=['pydyn-md']
  with patch('studio_worker.cluster.profile',return_value={}),patch('studio_worker.cluster.SSH') as transport:
   transport.return_value.run.return_value='__STUDIO_INSTALL__'+json.dumps({'status':'passed'})
   self.assertEqual(entry.invoke(cfg,'probe')['status'],'passed')
   payload=json.loads(transport.return_value.run.call_args.kwargs['data']);self.assertEqual(payload['config']['cases'],['pydyn-md']);self.assertNotIn('connection',payload['config']['compute'])

if __name__=='__main__':unittest.main()
