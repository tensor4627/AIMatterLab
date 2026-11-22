import base64,io,json,re,shlex,sys,tarfile,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.service import Service
from studio_worker.cluster import Clusters,profile,batch_script
from studio_worker.server import dispatch,tools
class FakeSSH:
    calls=[];state="RUN";lost=False;wrong_name=False
    def __init__(self,p):self.p=p
    def run(self,script,data=None,timeout=40):
        self.calls.append((script,data))
        code=shlex.split(script)[-1]
        match=re.search(r"base64.b64decode\('([^']+)'\)",code)
        if not match:return ""
        p=json.loads(base64.b64decode(match.group(1)))
        if data is not None:
            if self.lost:raise ConnectionError("lost")
            return "__STUDIO_JSON__"+json.dumps({"nonce":p["nonce"],"job_id":"123"})
        if "scheduler_state" in script:
            result={"job_id":p["job_id"],"scheduler_state":self.state,"identity_verified":not self.wrong_name}
            if self.wrong_name:result.pop("scheduler_state")
            return "__STUDIO_JSON__"+json.dumps(result)
        return ""
class ClusterLifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.inputs=self.root/"inputs";self.inputs.mkdir();(self.inputs/"run.py").write_text("print('fixture')")
        self.service=Service(self.root/"service",schedule=False)
        self.cluster=Clusters(self.service,transport=FakeSSH);self.service.clusters=self.cluster
        self.profile=self.cluster.register({"name":"fixture","scheduler":"lsf","target":"fixture@example.test","port":22,"ssh_client":"/usr/bin/ssh","remote_root":"/tmp/studio-fixture","queue":"fixture","environment":{"executables":{"python":"/usr/bin/python3"}}})
        self.project=self.service.register_project({"name":"fixture","policy":{"input_roots":[str(self.inputs)],"clusters":[self.profile["id"]]}})
        FakeSSH.calls=[];FakeSSH.lost=False;FakeSSH.state="RUN";FakeSSH.wrong_name=False
    def tearDown(self):
        self.service.close();self.service.store.db.close();self.tmp.cleanup()
    def spec(self,**changes):
        return {"name":"infrastructure fixture","project_id":self.project["id"],"cluster_id":self.profile["id"],"engine":"pydyn.md","inputs":{"run.py":str(self.inputs/"run.py")},"parameters":{},"gpu":0,"max_seconds":60,"idempotency_key":"key","resources":{"cpus":1,"gpus":0,"memory_mb":1024,"queue":"fixture"},**changes}
    def submitted(self):
        r=self.cluster.prepare(self.spec());self.cluster.validate(r["id"]);return self.cluster.submit(r["id"])
    def test_prepare_no_ssh_side_effect_private_fields_absent(self):
        r=self.cluster.prepare(self.spec());self.assertEqual(r["status"],"draft");self.assertEqual(r["scientific_validation"]["status"],"not_run");self.assertFalse(FakeSSH.calls)
        for k in ("target","port","identity_file"):self.assertNotIn(k,r["cluster"])
    def test_mcp_cannot_register_authorize_or_revise_but_can_execute_authorized_snapshot(self):
        for target in ("/api/clusters","/api/cluster/profile","/api/cluster/revise"):
            with self.assertRaises(PermissionError):dispatch(self.service,"POST",target,{},False)
        names=[t["name"] for t in tools()];self.assertIn("present_task",names);self.assertIn("prepare_cluster_run",names);self.assertIn("submit_cluster_run",names)
        run=self.cluster.prepare(self.spec())
        submitted=dispatch(self.service,'POST','/api/cluster/submit',{'run_id':run['id']},False)
        self.assertEqual(submitted['status'],'queued')

    def test_only_desktop_revision_can_set_parent_ancestry(self):
        prepare, revise = '/api/cluster/prepare', '/api/cluster/revise'
        original = dispatch(self.service, 'POST', prepare, {'spec':self.spec()}, False)
        identifier = original['id']
        self.assertEqual(original['status'], 'draft')
        for admin in (False, True):
            with self.subTest(admin=admin), self.assertRaisesRegex(ValueError, 'Revision identity is worker-owned'):
                dispatch(self.service, 'POST', prepare, {'spec':self.spec(revision_of=identifier, idempotency_key='forged')}, admin)
        with self.assertRaisesRegex(ValueError, 'Unsupported revision field'):
            dispatch(self.service, 'POST', revise, {'run_id':identifier, 'changes':{'revision_of':'forged-parent'}}, True)
        self.assertNotIn('superseded_by', self.cluster.raw(identifier))
        self.assertEqual([run['id'] for run in self.cluster.store.list('cluster-run')], [identifier])
        revised = dispatch(self.service, 'POST', revise, {'run_id':identifier, 'changes':{'name':'Reviewed draft'}}, True)
        self.assertEqual(revised['revision_of'], identifier)
        self.assertEqual(self.cluster.raw(identifier)['superseded_by'], revised['id'])
        self.assertFalse(FakeSSH.calls)

    def test_private_auth_and_tunnel_endpoints_are_admin_only_not_mcp_tools(self):
        from studio_worker.server import TOOL_ROUTES
        for group, operations in (('auth', ('plan','start','read','input','resize','finish')),
                                  ('tunnel', ('plan','start','status','close'))):
            for operation in operations:
                target='/api/cluster/'+group+'/'+operation
                with self.assertRaises(PermissionError):dispatch(self.service,'POST',target,{},False)
                self.assertNotIn(target,[value[1] for value in TOOL_ROUTES.values()])
        self.assertIsNone(self.cluster._auth)

    def test_key_route_defaults_preserve_legacy_via_and_interactive_route_requires_explicit_migration(self):
        from studio_worker.cluster import profile
        saved=self.cluster.store.get('cluster',self.profile['id'])
        saved.pop('auth_mode',None);saved['via']=['existing-login'];saved['identity_file']='/fixture/reference'
        original=profile(saved)
        self.assertEqual(original['auth_mode'],'key');self.assertEqual(original['via'],['existing-login'])
        self.assertEqual(original['identity_file'],'/fixture/reference')
        with self.assertRaisesRegex(ValueError,'legacy remote via'):profile({**saved,'auth_mode':'interactive'})
        updated=profile({**saved,'via':[],'auth_mode':'interactive','proxy_jump':['fixture@jump.invalid:2201']})
        self.assertEqual(updated['proxy_jump'],['fixture@jump.invalid:2201'])

    def test_interactive_transport_receives_exact_old_snapshot_without_current_profile_substitution(self):
        from studio_worker.cluster import Clusters
        observed=[]
        class Auth:
            def execute(self,p,script,data=None,timeout=40):observed.append((dict(p),script));return 'fixture'
            def close(self):pass
        original={**self.cluster.store.get('cluster',self.profile['id']),'auth_mode':'interactive','version':1}
        default=Clusters(self.service);default._auth=Auth()
        self.cluster.store.put('cluster',{**original,'version':2,'host':'new.invalid','target':'fixture@new.invalid'})
        self.assertEqual(default.transport(original).run('readonly fixture'),'fixture')
        self.assertEqual(observed[0][0]['version'],1);self.assertNotEqual(observed[0][0]['host'],'new.invalid')
        self.assertFalse(FakeSSH.calls)

    def test_missing_lease_agent_error_has_safe_human_action_and_never_tty_details(self):
        from studio_worker.ssh_auth import AuthError
        from studio_worker.server import mcp_tool_call
        class MissingLease:
            def __init__(self,_p):pass
            def run(self,*_args,**_kwargs):raise AuthError('needs_human_auth')
        self.cluster.transport=MissingLease
        result=mcp_tool_call(self.service,{'name':'probe_cluster','arguments':{'cluster_id':self.profile['id']}})
        content=json.loads(result['content'][0]['text'])
        self.assertEqual(content['status'],'needs_human_auth');self.assertFalse(content['automatic_retry'])
        self.assertIn('human',content['next_step'].lower());self.assertNotIn('privateOutput',content)

    def test_original_auth_source_reads_raw_immutable_run_and_policy_without_polling_or_latest_substitution(self):
        run=self.submitted();original=self.cluster.raw(run['id']);saved=self.cluster.store.get('cluster',self.profile['id'])
        self.cluster.register({**saved,'host':'latest.example.invalid','target':'other@latest.example.invalid','username':'other'})
        before=len(FakeSSH.calls);source=self.cluster.original_auth_source(run['id'])
        self.assertEqual(source['profile'],original['cluster_snapshot']);self.assertEqual(source['profile']['version'],1)
        self.assertEqual(source['sourceReceipt']['runId'],run['id']);self.assertEqual(source['sourceReceipt']['nonce'],original['nonce'])
        self.assertEqual(source['sourceReceipt']['projectId'],self.project['id']);self.assertEqual(len(source['sourceReceipt']['snapshotDigest']),64)
        self.assertEqual(source['origin']['kind'],'original-run');self.assertNotIn('nonce',source['origin']);self.assertNotIn('host',source['origin'])
        self.assertEqual(len(FakeSSH.calls),before);self.assertEqual(self.cluster.raw(run['id']),original)
        project=self.cluster.store.get('project',self.project['id']);project['policy']['clusters']=[];self.cluster.store.put('project',project)
        with self.assertRaises(PermissionError):self.cluster.original_auth_source(run['id'])

    def test_original_key_check_preserves_legacy_windows_key_and_via_semantics_without_health_or_profile_writes(self):
        from unittest.mock import patch
        import subprocess
        from studio_worker.cluster import SSH
        saved=self.cluster.store.get('cluster',self.profile['id'])
        original={**saved,'ssh_client':'/mnt/c/Windows/System32/OpenSSH/ssh.exe','identity_file':'/mnt/c/fixture-key-reference',
                  'via':['existing-inner'],'proxy_jump':['existing-alias'],'auth_mode':'key'}
        self.cluster.transport=lambda p:SSH(p);before=self.cluster.store.get('cluster',self.profile['id'])
        with patch('studio_worker.source_git_identity._bounded_process',return_value=subprocess.CompletedProcess([],0,'fixture\n','')) as called:
            self.assertEqual(self.cluster.original_key_check(original),{'status':'passed'})
        args,options=called.call_args;argv=args[0]
        self.assertEqual(argv[0],original['ssh_client']);self.assertEqual(argv[argv.index('-i')+1],original['identity_file'])
        self.assertEqual(argv[argv.index('-J')+1],'existing-alias');self.assertIn('existing-inner',argv[-1]);self.assertNotIn('-M',argv);self.assertNotIn('-S',argv)
        self.assertEqual(options,{'env':None,'timeout':25,'stdout_limit':8192,'stderr_limit':8192})
        with patch('studio_worker.cluster.subprocess.run',return_value=subprocess.CompletedProcess([],0,b'fixture\n',b'')) as legacy:
            self.assertEqual(SSH(original).run('id -un',timeout=25),'fixture\n')
        self.assertEqual(legacy.call_args.args[0],argv)
        self.assertEqual(legacy.call_args.kwargs,{'input':None,'capture_output':True,'timeout':25})
        self.assertEqual(self.cluster.store.get('cluster',self.profile['id']),before);self.assertIsNone(self.cluster._auth)

    def bounded_key_fixture(self, program, *, timeout=25):
        """Only an owned inert Python producer is executed, never an SSH client."""
        import os,subprocess
        from contextlib import ExitStack
        from unittest.mock import patch,Mock
        from studio_worker.cluster import SSH
        from studio_worker.source_git_identity import _bounded_process
        owned=[];counts={'stdout':0,'stderr':0};real_read=os.read
        def popen(*args,**kwargs):
            process=subprocess.Popen(*args,**kwargs)
            process.kill=Mock(wraps=process.kill);process.wait=Mock(wraps=process.wait)
            owned.append(process);return process
        def read(fd,size):
            chunk=real_read(fd,size)
            for process in owned:
                for name in counts:
                    stream=getattr(process,name)
                    if not stream.closed and stream.fileno()==fd:counts[name]+=len(chunk)
            return chunk
        def bounded(args,**kwargs):
            self.assertEqual(kwargs['timeout'],25)
            self.assertEqual(kwargs['stdout_limit'],8192);self.assertEqual(kwargs['stderr_limit'],8192)
            return _bounded_process(args,**{**kwargs,'timeout':timeout},popen=popen)
        self.cluster.transport=lambda p:SSH(p)
        stack=ExitStack()
        stack.enter_context(patch.object(SSH,'_key_args',return_value=[sys.executable,'-c',program]))
        stack.enter_context(patch('studio_worker.source_git_identity._bounded_process',side_effect=bounded))
        stack.enter_context(patch('studio_worker.source_git_identity.os.read',side_effect=read))
        self.addCleanup(stack.close)
        return owned,counts

    def assert_owned_key_process_closed(self, owned, *, killed=False):
        self.assertEqual(len(owned),1)
        self.assertIsNotNone(owned[0].returncode)
        self.assertTrue(owned[0].wait.called)
        if killed:self.assertTrue(owned[0].kill.called)
        self.assertTrue(owned[0].stdout.closed);self.assertTrue(owned[0].stderr.closed)

    def test_original_key_stdout_budget_stops_actual_producer_before_full_collection(self):
        marker=self.root/'stdout-producer-completed'
        program=("import os,pathlib\nfor _ in range(16384):os.write(1,b'x'*1024)\n"
                 f"pathlib.Path({str(marker)!r}).write_text('completed')")
        owned,counts=self.bounded_key_fixture(program)
        with self.assertRaisesRegex(ConnectionError,'^Original SSH user check failed$'):
            self.cluster.original_key_check(self.cluster.store.get('cluster',self.profile['id']))
        self.assertFalse(marker.exists());self.assertEqual(counts['stdout'],8193)
        self.assertLessEqual(counts['stderr'],8193);self.assert_owned_key_process_closed(owned,killed=True)

    def test_original_key_stderr_budget_stops_actual_banner_producer_and_never_returns_it(self):
        marker=self.root/'stderr-producer-completed'
        program=("import os,pathlib\nos.write(1,b'fixture\\n')\n"
                 "for _ in range(16384):os.write(2,b'private-banner-sentinel'*64)\n"
                 f"pathlib.Path({str(marker)!r}).write_text('completed')")
        owned,counts=self.bounded_key_fixture(program)
        with self.assertRaisesRegex(ConnectionError,'^Original SSH user check failed$') as failure:
            self.cluster.original_key_check(self.cluster.store.get('cluster',self.profile['id']))
        self.assertNotIn('private-banner-sentinel',str(failure.exception));self.assertFalse(marker.exists())
        self.assertEqual(counts['stderr'],8193);self.assertLessEqual(counts['stdout'],8193)
        self.assert_owned_key_process_closed(owned,killed=True)

    def test_original_key_valid_user_and_exact_stderr_budget_pass_without_health_write(self):
        original=self.cluster.store.get('cluster',self.profile['id'])
        owned,counts=self.bounded_key_fixture("import os\nos.write(2,b'x'*8192)\nos.write(1,b'fixture\\n')")
        self.assertEqual(self.cluster.original_key_check(original),{'status':'passed'})
        self.assertEqual(counts,{'stdout':8,'stderr':8192});self.assert_owned_key_process_closed(owned)
        self.assertEqual(self.cluster.store.get('cluster',self.profile['id']),original);self.assertIsNone(self.cluster._auth)

    def test_original_key_timeout_kills_and_reaps_only_owned_inert_process(self):
        import time
        owned,_counts=self.bounded_key_fixture("import time\ntime.sleep(10)",timeout=.15)
        started=time.monotonic()
        with self.assertRaisesRegex(ConnectionError,'^Original SSH user check failed$'):
            self.cluster.original_key_check(self.cluster.store.get('cluster',self.profile['id']))
        self.assertLess(time.monotonic()-started,3);self.assert_owned_key_process_closed(owned,killed=True)

    def test_original_key_small_failure_or_invalid_output_has_fixed_safe_failure(self):
        from contextlib import ExitStack
        from unittest.mock import patch
        from studio_worker.cluster import SSH
        import subprocess
        self.cluster.transport=lambda p:SSH(p)
        original=self.cluster.store.get('cluster',self.profile['id'])
        for result in (subprocess.CompletedProcess([],255,'private-stdout','private-stderr'),
                       subprocess.CompletedProcess([],0,'different-user\n',''),
                       subprocess.CompletedProcess([],0,'fixture\nextra-line\n','')):
            with self.subTest(returncode=result.returncode,output=result.stdout), ExitStack() as stack:
                stack.enter_context(patch('studio_worker.source_git_identity._bounded_process',return_value=result))
                with self.assertRaisesRegex(ConnectionError,'^Original SSH user check failed$') as failure:
                    self.cluster.original_key_check(original)
                self.assertNotIn('private-',str(failure.exception))

    def test_poll_missing_auth_surfaces_safe_original_run_action_even_without_job_id_and_never_resubmits(self):
        from studio_worker.ssh_auth import AuthError
        run=self.submitted();raw=self.cluster.raw(run['id']);self.cluster.save(raw,status='unknown',job_id=None,submit_attempted=True)
        calls=[]
        class Missing:
            def __init__(self,p):self.p=p
            def run(self,*args,**kwargs):calls.append('readonly');raise AuthError('needs_human_auth')
        self.cluster.transport=Missing;result=self.cluster.poll(run['id'])
        self.assertEqual(result['status'],'unknown');self.assertIsNone(result['job_id']);self.assertTrue(result['submit_attempted'])
        self.assertEqual(result['connection_action'],{'kind':'authenticate_original_run','code':'needs_human_auth','runId':run['id']})
        self.assertNotIn('nonce',result['connection_action']);self.assertNotIn('host',result['connection_action'])
        self.cluster.submit(run['id']);self.assertEqual(calls,['readonly'])
        class Generic:
            def __init__(self,p):pass
            def run(self,*args,**kwargs):raise ConnectionError('Synthetic remote outage')
        self.cluster.transport=Generic;later=self.cluster.poll(run['id']);self.assertEqual(later['connection_action'],result['connection_action'])
        class Observed:
            def __init__(self,p):pass
            def run(self,*args,**kwargs):return '__STUDIO_JSON__'+json.dumps({'state':'unknown','job_id':None})
        self.cluster.transport=Observed;fresh=self.cluster.poll(run['id']);self.assertEqual(fresh['status'],'unknown');self.assertIsNone(fresh.get('connection_action'))
        self.assertIsNone(fresh['job_id']);self.assertTrue(fresh['submit_attempted'])

    def test_poll_auth_hint_retains_original_scheduler_identity_and_snapshot_after_current_profile_edit(self):
        from studio_worker.ssh_auth import AuthError
        run=self.submitted();raw=self.cluster.raw(run['id']);snapshot=raw['cluster_snapshot'];seen=[]
        current=self.cluster.store.get('cluster',self.profile['id']);self.cluster.register({**current,'host':'latest.example.invalid'})
        class Missing:
            def __init__(self,p):seen.append(p)
            def run(self,*args,**kwargs):raise AuthError('needs_human_auth')
        self.cluster.transport=Missing;result=self.cluster.poll(run['id']);self.assertEqual(result['job_id'],'123')
        self.assertEqual(seen,[snapshot]);self.assertEqual(result['connection_action']['runId'],run['id']);self.assertEqual(result['status'],'unknown')

    def interactive_ready(self):
        saved=self.cluster.store.get('cluster',self.profile['id'])
        self.cluster.register({**saved,'auth_mode':'interactive','via':[],'proxy_jump':[]})
        run=self.cluster.prepare(self.spec());self.cluster.validate(run['id'])
        self.cluster.transport=self.cluster._transport
        return run

    def test_missing_interactive_lease_is_ready_zero_dispatch_not_unknown_submission(self):
        from studio_worker.ssh_auth import AuthError
        run=self.interactive_ready();calls=[];store=self.cluster.store
        class Missing:
            def resolve(self,p):
                self_case.assertFalse(store.lock._is_owned())
                calls.append(('preflight',p['version']));raise AuthError('needs_human_auth')
            def execute(self,*args,**kwargs):raise AssertionError('No dispatch')
            def close(self):pass
        self_case=self;self.cluster._auth=Missing()
        with self.assertRaisesRegex(AuthError,'needs_human_auth'):self.cluster.submit(run['id'])
        actual=self.cluster.raw(run['id']);self.assertEqual(actual['status'],'ready')
        self.assertFalse(actual.get('submit_attempted'));self.assertEqual(len(calls),1);self.assertFalse(FakeSSH.calls)

    def test_master_loss_after_successful_auth_preflight_remains_unknown_and_never_replays(self):
        from studio_worker.ssh_auth import AuthError
        run=self.interactive_ready();calls=[];store=self.cluster.store;self_case=self
        class Lost:
            def resolve(self,p):self_case.assertFalse(store.lock._is_owned());calls.append('preflight');return {}
            def execute(self,*args,**kwargs):
                actual=store.get('cluster-run',run['id']);self_case.assertEqual(actual['status'],'unknown');self_case.assertTrue(actual['submit_attempted'])
                calls.append('dispatch');raise AuthError('needs_human_auth')
            def close(self):pass
        self.cluster._auth=Lost();result=self.cluster.submit(run['id'])
        self.assertEqual(result['status'],'unknown');self.assertTrue(result['submit_attempted'])
        self.cluster.submit(run['id']);self.assertEqual(calls,['preflight','dispatch'])

    def test_submit_auth_preflight_releases_store_lock_for_concurrent_private_profile_read(self):
        import threading
        from studio_worker.ssh_auth import AuthError
        run=self.interactive_ready();entered=threading.Event();release=threading.Event();read_done=threading.Event();errors=[];auth_lock=threading.RLock();store=self.cluster.store
        class Waiting:
            def resolve(self,p):entered.set();release.wait(2);return {}
            def execute(self,*args,**kwargs):raise AuthError('needs_human_auth')
            def close(self):pass
        self.cluster._auth=Waiting()
        def submit():
            try:self.cluster.submit(run['id'])
            except Exception as exc:errors.append(exc)
        def private_read():
            with auth_lock:store.get('cluster',self.profile['id']);read_done.set()
        operation=threading.Thread(target=submit);operation.start()
        try:
            self.assertTrue(entered.wait(1));reader=threading.Thread(target=private_read);reader.start();self.assertTrue(read_done.wait(.5));reader.join(1)
        finally:release.set();operation.join(3)
        self.assertFalse(operation.is_alive());self.assertFalse(errors)

    def test_profile_change_during_outside_lock_auth_preflight_cannot_mark_a_stale_snapshot_submitted(self):
        run=self.interactive_ready();store=self.cluster.store
        class Changed:
            def resolve(self,p):current=store.get('cluster',p['id']);store.put('cluster',{**current,'version':current['version']+1});return {}
            def execute(self,*args,**kwargs):raise AssertionError('No stale dispatch')
            def close(self):pass
        self.cluster._auth=Changed()
        with self.assertRaisesRegex(ValueError,'profile changed'):self.cluster.submit(run['id'])
        actual=self.cluster.raw(run['id']);self.assertEqual(actual['status'],'ready');self.assertFalse(actual.get('submit_attempted'))

    def test_concurrent_private_routes_share_one_worker_owned_auth_manager(self):
        import threading,time
        from unittest.mock import patch
        from studio_worker.cluster import Clusters
        import studio_worker.ssh_auth as auth
        created=[];results=[]
        class Manager:
            def __init__(self,service):created.append(service);time.sleep(.02)
            def close(self):pass
        controller=Clusters(self.service)
        with patch.object(auth,'SSHAuth',Manager):
            threads=[threading.Thread(target=lambda:results.append(controller.auth)) for _ in range(8)]
            for thread in threads:thread.start()
            for thread in threads:thread.join(1)
        self.assertEqual(len(created),1);self.assertEqual(len(results),8)
        self.assertTrue(all(value is results[0] for value in results));controller.close()
    def test_unknown_submit_never_retries(self):
        r=self.cluster.prepare(self.spec());self.cluster.validate(r["id"]);FakeSSH.lost=True
        r=self.cluster.submit(r["id"]);self.assertEqual(r["status"],"unknown")
        count=len(FakeSSH.calls);self.cluster.submit(r["id"]);self.assertEqual(len(FakeSSH.calls),count)
    def test_readonly_control_never_executes_scientific_activation(self):
        from studio_worker.cluster import python_script
        p=self.cluster.store.get("cluster",self.profile["id"])
        p["activation"]="DANGEROUS_SETUP_NOT_FOR_PROBE"
        self.assertNotIn("DANGEROUS_SETUP_NOT_FOR_PROBE",python_script(p,"print(1)",{}))

    def test_local_and_remote_share_project_concurrency(self):
        r=self.cluster.prepare(self.spec());self.cluster.validate(r["id"])
        self.service.store.add_run({"id":"local-fixture","project_id":self.project["id"],"idempotency_key":"local-key","request_hash":"fixture","status":"running"})
        with self.assertRaises(PermissionError):self.cluster.submit(r["id"])
        self.assertFalse(FakeSSH.calls)

    def test_idempotent_and_conflict(self):
        a=self.cluster.prepare(self.spec());b=self.cluster.prepare(self.spec());self.assertEqual(a["id"],b["id"])
        with self.assertRaises(ValueError):self.cluster.prepare(self.spec(name="different"))
    def test_resource_and_cluster_authorization(self):
        with self.assertRaises(PermissionError):self.cluster.prepare(self.spec(resources={"cpus":65,"queue":"fixture"}))
        self.project["policy"]["clusters"]=[];self.service.store.put("project",self.project)
        with self.assertRaises(PermissionError):self.cluster.prepare(self.spec())
    def test_cancel_requires_matching_identity(self):
        r=self.submitted();FakeSSH.wrong_name=True
        with self.assertRaises(ValueError):self.cluster.cancel(r["id"])

    def test_managed_known_cancel_requires_known_scheduler_status_at_the_signal_gate(self):
        run = self.submitted()
        FakeSSH.state = 'UNKNOWN_FUTURE_SCHEDULER_STATUS'
        with self.assertRaisesRegex(ValueError, 'Original scheduler status could not be confirmed'):
            dispatch(self.service, 'POST', '/api/cluster/cancel', {'run_id': run['id'], 'require_known': True}, admin=False)
        actual = self.cluster.raw(run['id'])
        self.assertTrue(actual['identity_verified'])
        self.assertEqual(actual['status'], 'unknown')
        self.assertFalse(actual['cancellation']['signal_sent'])
        self.assertFalse(any(script.startswith('bkill ') for script, _ in FakeSSH.calls))

    def test_cancel_after_failed_poll_does_not_use_a_previously_verified_job_id(self):
        run=self.submitted()
        self.assertTrue(self.cluster.poll(run['id'])['identity_verified'])
        class Offline(FakeSSH):
            def run(self,script,data=None,timeout=40):
                if script.startswith('bkill '):
                    raise AssertionError('A failed identity check must not dispatch cancellation')
                raise ConnectionError('Read unavailable')
        self.cluster.transport=Offline
        with self.assertRaisesRegex(ValueError,'unverified'):
            self.cluster.cancel(run['id'])
        actual=self.cluster.raw(run['id'])
        self.assertEqual(actual['job_id'], '123')
        self.assertFalse(actual['identity_verified'])
        self.assertFalse(actual['cancellation']['signal_sent'])

    def test_cancellation_intent_survives_a_lost_remote_acknowledgement(self):
        run=self.submitted();owner=self
        class LostCancellation(FakeSSH):
            def run(self,script,data=None,timeout=40):
                if script.startswith('bkill '):
                    owner.assertTrue(owner.cluster.raw(run['id'])['cancel_requested'])
                    raise ConnectionError('cancel acknowledgement lost')
                return super().run(script,data,timeout)
        self.cluster.transport=LostCancellation
        with self.assertRaisesRegex(ConnectionError,'acknowledgement lost'):self.cluster.cancel(run['id'])
        persisted=self.cluster.raw(run['id'])
        self.assertTrue(persisted['cancel_requested'])
        self.assertEqual(persisted['cancellation']['status'],'unconfirmed')
        self.assertIsNone(persisted['cancellation']['signal_sent'])
        self.assertGreater(persisted['cancellation']['requested_at'],0)
        self.assertNotIn(persisted['status'],('cancelled','succeeded'))

    def test_cancellation_is_durable_before_the_first_remote_status_query(self):
        run=self.submitted()
        def unavailable(_identifier):
            self.assertTrue(self.cluster.raw(run['id'])['cancel_requested'])
            raise ConnectionError('status query interrupted')
        self.cluster.poll=unavailable
        with self.assertRaisesRegex(ConnectionError,'status query interrupted'):self.cluster.cancel(run['id'])
        actual=self.cluster.raw(run['id']);self.assertTrue(actual['cancel_requested']);self.assertFalse(actual['cancellation']['signal_sent'])

    def test_exit_zero_and_failed_scientific_findings_are_independent(self):
        run=self.submitted()
        class Completed(FakeSSH):
            def run(self,script,data=None,timeout=40):
                return '__STUDIO_JSON__'+json.dumps({'job_id':'123','scheduler_state':'DONE','identity_verified':True,'exit':{'exit_code':0},'validation':{'status':'failed','message':'scientific warning'}})
        self.cluster.transport=Completed
        result=self.cluster.poll(run['id'])
        self.assertEqual(result['status'],'succeeded')
        self.assertEqual(result['scientific_validation']['status'],'failed')
        self.assertFalse(any("bkill 123" in text for text,_ in FakeSSH.calls))
    def test_receipts_persist_across_reopen(self):
        r=self.submitted();self.assertEqual(r["status"],"queued");r=self.cluster.poll(r["id"]);self.assertEqual(r["status"],"running")
        identifier=r["id"];self.service.close();self.service.store.db.close()
        self.service=Service(self.root/"service",schedule=False);self.cluster=Clusters(self.service,transport=FakeSSH)
        self.assertEqual(self.cluster.run(identifier)["job_id"],"123")
    def test_revision_new_snapshot_old_draft_cannot_submit(self):
        r=self.cluster.prepare(self.spec());revision=self.cluster.revise(r["id"],{"parameters":{"temperature":300},"inputs":{"run.py":r["directory"]+"/simulation/run.py"}})
        self.assertNotEqual(r["id"],revision["id"]);self.assertEqual(revision["parameters"]["temperature"],300)
        with self.assertRaises(ValueError):self.cluster.submit(r["id"])
        self.assertFalse(FakeSSH.calls)
    def test_archive_contains_real_gate_no_connection(self):
        r=self.cluster.prepare(self.spec());raw=self.cluster.raw(r["id"])
        with tarfile.open(fileobj=io.BytesIO(self.cluster.archive(raw)),mode="r:gz") as t:
            files=t.getnames();self.assertIn(".studio/validate.py",files);self.assertIn(".studio/studio_worker/tools/derivatives.py",files);self.assertIn(".studio/studio_worker/derivative_selection.py",files);self.assertIn(".studio/studio_worker/composition_store.py",files);self.assertIn(".studio/studio_worker/tools/neb_checks.py",files)
            for name in ("tools/__init__.py","tools/adapters.py","tools/engine_contracts.py","tools/derivative_selection.py","engine_contracts.py","engine_contracts.json"):
                self.assertIn(".studio/studio_worker/"+name,files)
            gate=t.extractfile(".studio/validate.py").read().decode();self.assertIn("Adapter(r['engine']).validate",gate);self.assertIn("_original(environment,None)",gate)
            self.assertIn("from studio_worker.tools.adapters import Adapter",gate)
            spec=json.load(t.extractfile(".studio/run.json"));self.assertNotIn("cluster_snapshot",spec)
            # Exercise the exact archive source package independently of this checkout.
            with tempfile.TemporaryDirectory() as tmp:
                extracted=Path(tmp)
                for name in files:
                    if name.startswith('.studio/studio_worker/'):
                        target=extracted/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(t.extractfile(name).read())
                import subprocess
                code="""import importlib,pathlib,sys
sys.path.insert(0,sys.argv[1])
from studio_worker.tools import adapters
assert importlib.import_module('studio_worker.adapters') is adapters
from studio_worker.tools.engine_contracts import describe
assert describe('pydyn.md')['runtime_validation']=='not_run'
assert pathlib.Path(adapters.SCIENTIFIC).is_file()
sys.path.insert(0,str(pathlib.Path(sys.argv[1])/'studio_worker'))
from derivative_selection import selection
assert selection({},2)['indices']==[0,1]
print('archive imports passed; no engine executed')
"""
                result=subprocess.run([sys.executable,'-I','-B','-c',code,str(extracted/'.studio')],capture_output=True,text=True,timeout=20)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertIn('archive imports passed',result.stdout)
    def test_explicit_slurm_qos_is_validated_and_in_reviewed_script(self):
        from studio_worker.compute.cluster import resources
        current = self.cluster.raw(self.cluster.prepare(self.spec())["id"])
        profile = {**current["cluster_snapshot"], "scheduler": "slurm"}
        requested = {**current["resources"], "qos": "science-high"}
        reviewed = resources(requested, profile, 60)
        self.assertIn("#SBATCH --qos=science-high\n", batch_script({**current, "resources": reviewed, "cluster_snapshot": profile}))
        self.assertNotIn("#SBATCH --qos", batch_script({**current, "cluster_snapshot": profile}))
        for bad in ("", "-bad", "normal\n#SBATCH --nodes=40", None):
            with self.assertRaises(ValueError):
                resources({**requested, "qos": bad}, profile, 60)
        with self.assertRaises(ValueError):
            resources(requested, current["cluster_snapshot"], 60)

    def test_lsf_slurm_script_and_scope_guards(self):
        r=self.cluster.raw(self.cluster.prepare(self.spec())["id"]);self.assertIn("#BSUB -q fixture",r["script"]);self.assertIn('"$HOME"',batch_script({**r,"remote_directory":"~/.gss/id"}))
        r["cluster_snapshot"]["scheduler"]="slurm";s=batch_script(r);self.assertIn("#SBATCH --partition=fixture",s);self.assertIn("#SBATCH --export=NONE",s)
        with self.assertRaises(ValueError):profile({**r["cluster_snapshot"],"target":"-oProxyCommand=bad"})
        with self.assertRaises(ValueError):profile({**r["cluster_snapshot"],"remote_root":"/"})

    def test_explicit_username_legacy_and_missing_user(self):
        from studio_worker.cluster import ssh_endpoint
        self.assertEqual(ssh_endpoint({"target":"remote@example.test"}),("example.test","remote"))
        self.assertEqual(ssh_endpoint({"target":"old@example.test","host":"example.test","username":"edited"}),("example.test","edited"))
        with self.assertRaises(ValueError):ssh_endpoint({"host":"example.test"})
        with self.assertRaises(ValueError):ssh_endpoint({"host":"example.test","username":"-oProxyCommand=bad"})
        public=self.cluster.register({**self.cluster.store.get("cluster",self.profile["id"]),"username":"edited"})
        self.assertNotIn("username",public);self.assertNotIn("host",public)

    def test_ssh_argv_forces_user_even_with_a_local_config(self):
        from studio_worker.cluster import SSH
        from unittest.mock import patch
        import subprocess
        p=self.cluster.store.get("cluster",self.profile["id"])
        with patch("studio_worker.cluster.subprocess.run",return_value=subprocess.CompletedProcess([],0,b"fixture",b"")) as call:
            SSH(p).run("id -un")
        argv=call.call_args.args[0]
        self.assertEqual(argv[argv.index("-l")+1],"fixture")
        self.assertIn("example.test",argv);self.assertNotIn("fixture@example.test",argv)

    def test_connection_check_does_not_save_or_disclose_user(self):
        class IdentityWire:
            def __init__(self,p):self.p=p
            def run(self,script,**kwargs):
                self.assert_script=script
                return self.p["username"]+"\n"
        self.cluster.transport=IdentityWire
        p=self.cluster.store.get("cluster",self.profile["id"]);count=len(self.cluster.store.list("cluster"))
        result=self.cluster.test_connection(p)
        self.assertEqual(result["status"],"passed");self.assertNotIn("fixture",str(result))
        self.assertEqual(len(self.cluster.store.list("cluster")),count)
        with self.assertRaises(PermissionError):dispatch(self.service,"POST","/api/cluster/test",{"connection":p},False)

    def test_controlled_profile_and_register_accept_complete_bracketed_ipv6_jumps(self):
        saved=self.cluster.store.get('cluster',self.profile['id'])
        jumps=['fixture@[2001:db8::1]:2222','fixture@[::1]:22','fixture@jump.invalid:2201']
        value={**saved,'auth_mode':'interactive','proxy_jump':jumps,'via':[]}
        self.assertEqual(profile(value)['proxy_jump'],jumps)
        policy=self.service.store.get('project',self.project['id'])['policy']
        result=self.cluster.register(value)
        current=self.cluster.store.get('cluster',result['id'])
        self.assertEqual(current['proxy_jump'],jumps);self.assertEqual(current['auth_mode'],'interactive')
        self.assertEqual(current['version'],saved['version']+1)
        self.assertEqual(self.service.store.get('project',self.project['id'])['policy'],policy)
        self.assertFalse(FakeSSH.calls)

    def test_controlled_profile_register_reject_incomplete_or_invalid_jumps_without_saving(self):
        saved=self.cluster.store.get('cluster',self.profile['id'])
        invalid=[['bare.invalid'],['fixture@host.invalid'],['host.invalid:22'],['@host.invalid:22'],
                 ['fixture@host.invalid:0'],['fixture@host.invalid:65536'],['fixture@[1::2::3]:22'],
                 ['fixture@[2001:db8::1]'],['fixture@[2001:db8::1]:bad'],['fixture@host.invalid:22;extra'],
                 [False],'fixture@host.invalid:22']
        versions=self.cluster.store.list('cluster-version')
        for jumps in invalid:
            with self.subTest(jumps=jumps):
                value={**saved,'auth_mode':'interactive','proxy_jump':jumps,'via':[]}
                with self.assertRaises(ValueError):profile(value)
                with self.assertRaises(ValueError):self.cluster.register(value)
                self.assertEqual(self.cluster.store.get('cluster',saved['id']),saved)
                self.assertEqual(self.cluster.store.list('cluster-version'),versions)
        self.assertFalse(FakeSSH.calls)

    def test_legacy_key_proxyjump_alias_grammar_is_preserved(self):
        saved=self.cluster.store.get('cluster',self.profile['id'])
        value={**saved,'auth_mode':'key','proxy_jump':['existing-alias'],'via':['existing-inner']}
        self.assertEqual(profile(value)['proxy_jump'],['existing-alias'])
        self.assertEqual(profile(value)['via'],['existing-inner'])
        result=self.cluster.register(value)
        self.assertEqual(self.cluster.store.get('cluster',result['id'])['proxy_jump'],['existing-alias'])
        self.assertFalse(FakeSSH.calls)

    def identity_check_transport(self, failure=False):
        class IdentityWire:
            def __init__(self,p):self.p=p
            def run(self,script,**kwargs):
                if failure:raise ConnectionError('Synthetic identity check failure')
                return self.p['username']+'\n'
        self.cluster.transport=IdentityWire

    def test_auth_mode_mismatch_never_assigns_unsaved_key_health_to_saved_interactive_route(self):
        saved=self.cluster.store.get('cluster',self.profile['id'])
        self.cluster.register({**saved,'auth_mode':'interactive','proxy_jump':[],'via':[]})
        current=self.cluster.store.get('cluster',saved['id'])
        self.identity_check_transport()
        result=self.cluster.test_connection({**current,'auth_mode':'key'})
        self.assertEqual(result['status'],'passed')  # only the inert unsaved-form check
        self.assertEqual(self.cluster.store.get('cluster',saved['id']),current)

    def test_jump_mismatch_never_assigns_direct_form_health_to_saved_jump_route(self):
        saved=self.cluster.store.get('cluster',self.profile['id'])
        self.cluster.register({**saved,'auth_mode':'key','proxy_jump':['existing-alias']})
        current=self.cluster.store.get('cluster',saved['id'])
        self.identity_check_transport()
        self.assertEqual(self.cluster.test_connection({**current,'proxy_jump':[]})['status'],'passed')
        self.assertEqual(self.cluster.store.get('cluster',saved['id']),current)

    def test_dirty_key_direct_check_pass_or_failure_does_not_mutate_saved_interactive_jump_evidence(self):
        saved=self.cluster.store.get('cluster',self.profile['id'])
        self.cluster.register({**saved,'auth_mode':'interactive','proxy_jump':['fixture@[2001:db8::1]:2222'],'via':[]})
        current=self.cluster.store.get('cluster',saved['id'])
        current.update(connection_check={'status':'passed','version':current['version'],'attempted_at':1},probe={'queues':['original']})
        self.cluster.store.put('cluster',current)
        form={**current,'auth_mode':'key','proxy_jump':[]}
        for failure in (False,True):
            with self.subTest(failure=failure):
                self.identity_check_transport(failure)
                if failure:
                    with self.assertRaises(ConnectionError):self.cluster.test_connection(form)
                else:self.assertEqual(self.cluster.test_connection(form)['status'],'passed')
                self.assertEqual(self.cluster.store.get('cluster',saved['id']),current)

    def test_matching_interactive_ipv6_route_can_record_its_own_connection_check(self):
        saved=self.cluster.store.get('cluster',self.profile['id'])
        self.cluster.register({**saved,'auth_mode':'interactive','proxy_jump':['fixture@[::1]:2222'],'via':[]})
        current=self.cluster.store.get('cluster',saved['id'])
        self.identity_check_transport();self.cluster.test_connection(current)
        after=self.cluster.store.get('cluster',saved['id'])
        self.assertEqual(after['connection_check']['status'],'passed')
        self.assertEqual(after['connection_check']['version'],current['version'])
        self.assertEqual(after['auth_mode'],'interactive');self.assertEqual(after['proxy_jump'],current['proxy_jump'])

    def test_legacy_missing_auth_and_jump_fields_equal_explicit_defaults_for_health_only(self):
        for explicit_saved in (False,True):
            with self.subTest(explicit_saved=explicit_saved):
                current=self.cluster.store.get('cluster',self.profile['id'])
                current.pop('connection_check',None);current.pop('probe',None)
                if explicit_saved:current.update(auth_mode='key',proxy_jump=[])
                else:current.pop('auth_mode',None);current.pop('proxy_jump',None)
                self.cluster.store.put('cluster',current)
                form=dict(current)
                if explicit_saved:form.pop('auth_mode',None);form.pop('proxy_jump',None)
                else:form.update(auth_mode='key',proxy_jump=[])
                self.identity_check_transport();self.cluster.test_connection(form)
                after=self.cluster.store.get('cluster',current['id'])
                self.assertEqual(after['connection_check']['status'],'passed')
                self.assertEqual('auth_mode' in after,explicit_saved)
                self.assertEqual('proxy_jump' in after,explicit_saved)

    def test_unsaved_key_identity_check_remains_available_without_registering_health_or_profile(self):
        current=self.cluster.store.get('cluster',self.profile['id'])
        form={**current,'auth_mode':'key','proxy_jump':[]};form.pop('id');form.pop('version')
        self.identity_check_transport();self.assertEqual(self.cluster.test_connection(form)['status'],'passed')
        self.assertEqual(self.cluster.store.list('cluster'),[current])

    def test_present_task_contract_requires_top_level_fields(self):
        schema=next(t['inputSchema'] for t in tools() if t['name']=='present_task')
        self.assertEqual(schema['properties']['steps']['items']['anyOf'][0],{'type':'string'})
        with self.assertRaises(ValueError):dispatch(self.service,'POST','/api/tasks/present',{'task_id':'draft','workflow':{'steps':['prepare']},'parameters':{},'missing_fields':[]},False)
        draft=dispatch(self.service,'POST','/api/tasks/present',{'task_id':'draft','name':'MD','steps':['prepare'],'parameters':{'temperature':345},'missing_fields':['structure']},False)
        self.assertEqual(draft['parameters']['temperature'],345);self.assertEqual(draft['status'],'draft')
