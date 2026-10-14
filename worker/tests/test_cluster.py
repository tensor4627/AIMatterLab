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
    def test_mcp_cannot_register_authorize_revise_submit(self):
        for target in ("/api/clusters","/api/cluster/profile","/api/cluster/submit","/api/cluster/validate","/api/cluster/revise","/api/cluster/cancel"):
            with self.assertRaises(PermissionError):dispatch(self.service,"POST",target,{},False)
        names=[t["name"] for t in tools()];self.assertIn("present_task",names);self.assertIn("prepare_cluster_run",names);self.assertNotIn("submit_cluster_run",names)
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
            files=t.getnames();self.assertIn(".studio/validate.py",files);self.assertIn(".studio/studio_worker/derivatives.py",files)
            gate=t.extractfile(".studio/validate.py").read().decode();self.assertIn("Adapter(r['engine']).validate",gate);self.assertIn("_original(environment,None)",gate)
            spec=json.load(t.extractfile(".studio/run.json"));self.assertNotIn("cluster_snapshot",spec)
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

    def test_present_task_contract_requires_top_level_fields(self):
        schema=next(t['inputSchema'] for t in tools() if t['name']=='present_task')
        self.assertEqual(schema['properties']['steps']['items']['anyOf'][0],{'type':'string'})
        with self.assertRaises(ValueError):dispatch(self.service,'POST','/api/tasks/present',{'task_id':'draft','workflow':{'steps':['prepare']},'parameters':{},'missing_fields':[]},False)
        draft=dispatch(self.service,'POST','/api/tasks/present',{'task_id':'draft','name':'MD','steps':['prepare'],'parameters':{'temperature':345},'missing_fields':['structure']},False)
        self.assertEqual(draft['parameters']['temperature'],345);self.assertEqual(draft['status'],'draft')
