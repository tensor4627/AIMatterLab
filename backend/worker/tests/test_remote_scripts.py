"""Execute the real upload/validation/receipt scripts against local scheduler fixtures.
This tests infrastructure, never actual LSF/Slurm or scientific engines."""
import json,os,shlex,subprocess,sys,tempfile,time,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_worker.service import Service
from studio_worker.cluster import Clusters
SCHEDULER = r'''#!/usr/bin/python3
import json,os,re,subprocess,sys
from pathlib import Path
root=Path(os.environ["FIXTURE_QUEUE_ROOT"]);state=root/"job.json";cmd=Path(sys.argv[0]).name
if cmd in ("bsub","sbatch"):
 d=Path.cwd();script=(d/"job.sh").read_text()
 name=re.search(r"(?:-J |--job-name=)(gss-[a-z0-9]+)",script).group(1)
 if not (root/"owner-cancel").exists():
  subprocess.Popen(["bash","job.sh"],cwd=d,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
 state.write_text(json.dumps({"id":"123","name":name,"directory":str(d)}))
 print("Job <123> is submitted to queue <fixture>." if cmd=="bsub" else "123")
else:
 v=json.loads(state.read_text());receipt=Path(v["directory"])/"exit.json"
 status="RUNNING"
 if receipt.exists():status="COMPLETED" if json.loads(receipt.read_text())["exit_code"]==0 else "FAILED"
 if cmd=="bjobs" and "-l" not in sys.argv:print("123|"+{"RUNNING":"RUN","COMPLETED":"DONE","FAILED":"EXIT"}[status]+"|"+v["name"])
 elif cmd=="bjobs":
  cancelled=(root/"owner-cancel").exists()
  print("Job <123>, Job Name <"+v["name"]+">, User <fixture>, Status <"+("EXIT" if cancelled else {"RUNNING":"RUN","COMPLETED":"DONE","FAILED":"EXIT"}[status])+">")
  if cancelled:print("     TERM_OWNER: job killed by owner.")
 elif cmd=="squeue":
  if status=="RUNNING":print("123|"+status+"|"+v["name"])
 elif cmd=="sacct":print("123|"+status+"|"+v["name"]+"|")
'''
class LocalWire:
    def __init__(self,p):self.p=p
    def run(self,script,data=None,timeout=40):
        r=subprocess.run(["bash","-lc",self.p.get("activation","")+"\n"+script],input=data,capture_output=True,timeout=timeout)
        if r.returncode:raise RuntimeError(r.stderr.decode()[-2000:])
        return r.stdout.decode()
class WireIntegration(unittest.TestCase):
    def execute(self,scheduler,missing_pydyn=False,owner_cancel=False):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/"inputs").mkdir();(root/"bin").mkdir()
            if owner_cancel:(root/"owner-cancel").touch()
            for command in ("bsub","bjobs","sbatch","squeue","sacct"):
                f=root/"bin"/command;f.write_text(SCHEDULER);f.chmod(0o755)
            (root/"inputs/run.py").write_bytes((Path(__file__).resolve().parents[3]/"installation/examples/worker-smoke.py").read_bytes())
            environment={"executables":{"python":sys.executable}}
            engine="installation.check";parameters={"installation_case":"worker"}
            if missing_pydyn:
                # Controlled missing import on the simulated compute node.
                package=root/"fixture-modules/pydyn";package.mkdir(parents=True)
                (package/"__init__.py").write_text("raise ModuleNotFoundError('controlled remote missing pydyn')\n")
                environment['repositories']={'pydyn':str(package.parent)}
                engine="pydyn.md";parameters={}
            service=Service(root/"worker",schedule=False);cluster=Clusters(service,transport=LocalWire)
            try:
                p=cluster.register({"name":"local scheduler fixture","scheduler":scheduler,"target":"fixture@example.test","port":22,"ssh_client":"/usr/bin/ssh","remote_root":str(root/"remote"),"queue":"fixture","activation":"export PATH="+shlex.quote(str(root/"bin"))+":$PATH\nexport FIXTURE_QUEUE_ROOT="+shlex.quote(str(root)),"environment":environment})
                project=service.register_project({"name":"local fixture","policy":{"engines":[engine],"clusters":[p["id"]],"input_roots":[str(root/"inputs")]}})
                run=cluster.prepare({"project_id":project["id"],"cluster_id":p["id"],"engine":engine,"inputs":{"run.py":str(root/"inputs/run.py")},"parameters":parameters,"gpu":0,"max_seconds":20,"resources":{"queue":"fixture","cpus":1,"gpus":0,"memory_mb":1024},"idempotency_key":"key"})
                cluster.validate(run["id"]);submitted=cluster.submit(run["id"]);self.assertEqual(submitted["status"],"queued",submitted.get("error"))
                for _ in range(50):
                    result=cluster.poll(run["id"])
                    if result["status"] in ("succeeded","failed","cancelled"):break
                    time.sleep(.1)
                if owner_cancel:
                    self.assertEqual(result["status"],"cancelled")
                    self.assertTrue(result["identity_verified"])
                    self.assertFalse(result.get("exit"))
                    return
                if missing_pydyn:
                    self.assertEqual(result["status"],"failed")
                    self.assertEqual(result["scientific_validation"]["status"],"failed")
                    self.assertIn("pydyn",result["scientific_validation"]["message"])
                    self.assertNotIn("STUDIO_WORKER_SMOKE_OK",cluster.read(run["id"])["text"])
                    self.assertFalse((Path(run['remote_directory'])/'simulation/smoke-result.json').exists())
                    return
                self.assertEqual(result["status"],"succeeded")
                self.assertEqual(result["scientific_validation"]["status"],"passed")
                self.assertEqual(result["scientific_validation"]["scientific_status"],"not_run")
                self.assertIn("not a PyDyn check",result["scientific_validation"]["scope"])
                self.assertIn("STUDIO_WORKER_SMOKE_OK",cluster.read(run["id"])["text"])
            finally:service.close();service.store.db.close()
    def test_lsf_archive_gate_and_exit_receipt(self):self.execute("lsf")
    def test_lsf_owner_termination_proves_cancellation(self):self.execute("lsf",owner_cancel=True)
    def test_slurm_archive_gate_and_exit_receipt(self):self.execute("slurm")
    def test_remote_missing_pydyn_stops_before_user_script(self):self.execute("slurm",missing_pydyn=True)
