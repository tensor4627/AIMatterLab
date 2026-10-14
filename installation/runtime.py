"""Target-side install recipes and local worker coordinator. Standard library until science tests."""
import hashlib,json,os,re,shutil,subprocess,sys,time
from pathlib import Path
STATUSES={"passed","failed","blocked","not_run"}
LOG_ROOT=None
CASES={"worker":"worker-smoke.py","reference-md":"reference-md.py","pydyn-md":"pydyn-md.py"}
def run(argv,cwd=None,env=None,timeout=900):
    p=subprocess.run(argv,cwd=cwd,env=env,capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=timeout)
    if LOG_ROOT:
        folder=Path(LOG_ROOT);folder.mkdir(parents=True,exist_ok=True)
        (folder/(str(time.time_ns())+".log")).write_text(p.stdout+p.stderr)
    if p.returncode:raise RuntimeError("Command failed; inspect private install logs")
    return p.stdout
def target_env(environment):
    env=os.environ.copy()
    env["PYTHONPATH"]=os.pathsep.join(environment.get("repositories",{}).values())
    for key,value in environment.get("variables",{}).items():
        if key not in ("LD_LIBRARY_PATH","LIBRARY_PATH","OMP_NUM_THREADS","MKL_NUM_THREADS"):raise ValueError("Unsupported loader variable")
        env[key]=str(value)
    return env
def probe(config):
    environment=config["compute"]["environment"];python=environment["executables"]["python"]
    code="import importlib.util,importlib.metadata,json,sys;names=['ase','numpy','torch','cupy','pydyn','pygas','hotpp'];out={'python':sys.version.split()[0],'modules':{n:importlib.util.find_spec(n) is not None for n in names}};print(json.dumps(out))"
    value=json.loads(run([python,"-c",code],env=target_env(environment),timeout=60).strip().splitlines()[-1])
    return {"status":"passed","scope":"target import discovery only; scientific tests not_run","observation":value}
def bootstrap(config):
    global LOG_ROOT
    recipe=config.get("bootstrap",{})
    if not recipe.get("enabled"):return {"status":"passed","scope":"reuse explicit existing environment; no mutation","environment":config["compute"]["environment"]}
    if config["compute"]["kind"]=="ssh" and not recipe.get("allow_login_install"):
        return {"status":"blocked","scope":"site policy must allow login-node installation or submit the recipe as a reviewed setup job"}
    root=Path(recipe["root"]).expanduser().resolve()
    if not root.is_absolute() or root in (Path("/"),Path.home(),Path("/home"),Path("/usr"),Path("/opt")):raise ValueError("Dedicated managed prefix required")
    stamp=hashlib.sha256(json.dumps(recipe,sort_keys=True).encode()).hexdigest()
    marker=root/".studio-managed"
    if root.exists() and any(root.iterdir()) and (not marker.exists() or marker.read_text()!=stamp):
        raise ValueError("Existing prefix is not this installation; choose a new prefix")
    root.mkdir(parents=True,exist_ok=True);root.chmod(0o700);marker.write_text(stamp);LOG_ROOT=root/"setup-logs"
    python=root/"venv/bin/python"
    if not python.exists():run([recipe.get("python","python3"),"-m","venv",str(root/"venv")])
    packages=recipe.get("packages",[])
    if any(not re.fullmatch(r"[A-Za-z0-9_.\-\[\],]+==[A-Za-z0-9_.+]+",v) for v in packages):raise ValueError("Pin bootstrap packages with exact versions")
    if packages:run([str(python),"-m","pip","install",*packages])
    repositories={}
    for source in recipe.get("sources",[]):
        if not re.fullmatch(r"[a-z][a-z0-9-]*",source["name"]) or not re.fullmatch(r"[0-9a-f]{40}",source["commit"]):raise ValueError("Pin source name and full commit")
        from urllib.parse import urlparse
        u=urlparse(source["url"])
        if u.scheme!="https" or u.hostname!="github.com" or u.username or u.password:raise ValueError("Use credential-free GitHub source URLs")
        directory=root/"sources"/source["name"];directory.parent.mkdir(exist_ok=True)
        if not directory.exists():
            run(["git","clone","--no-checkout",source["url"],str(directory)])
            run(["git","-C",str(directory),"checkout","--detach",source["commit"]])
        actual=run(["git","-C",str(directory),"rev-parse","HEAD"]).strip()
        dirty=run(["git","-C",str(directory),"status","--porcelain"]).strip()
        if actual!=source["commit"] or dirty:raise ValueError("Managed source changed; do not switch or reset it")
        if source.get("install",True):run([str(python),"-m","pip","install","--no-deps","-e",str(directory)])
        repositories[source["name"]]=str(directory)
    freeze=run([str(python),"-m","pip","freeze"])
    (root/"installed-packages.txt").write_text(freeze)
    environment={**config["compute"]["environment"],"executables":{**config["compute"]["environment"]["executables"],"python":str(python)},"repositories":{**config["compute"]["environment"].get("repositories",{}),**repositories}}
    return {"status":"passed","scope":"managed venv configured; scientific tests still required","pinned_sources":len(repositories),"requested_packages":len(packages),"environment":environment,"package_snapshot_sha256":hashlib.sha256(freeze.encode()).hexdigest()}
def smoke(config,approved=False):
    # Runs on the LOCAL WSL controller, including when compute is SSH.
    repo=Path(config["_suite_root"]);sys.path.insert(0,str(repo/"worker"))
    from studio_worker.service import Service
    from studio_worker.util import atomic_json
    state=Path(config["worker"]["root"]).expanduser()
    service=Service(state,schedule=False)
    checks=[];environment=config["compute"]["environment"]
    inputs=state/"install-inputs"/config["_fingerprint"];inputs.mkdir(parents=True,exist_ok=True)
    project_id="install-"+config["_fingerprint"][:12];cluster=None
    try:
        prior=service.store.runs()+service.store.list("cluster-run")
        unresolved=[v for v in prior if v.get("name","").startswith("Install ") and v["status"] in ("unknown","queued","running") and not v.get("idempotency_key","").startswith(config["_fingerprint"]+":")]
        if unresolved:return {"status":"blocked","checks":[{"id":case,"status":"blocked","reason":"A previous installation run is unresolved; reconcile it before changing the request"} for case in config["cases"]]}
        if config["compute"]["kind"]=="wsl":
            import threading
            service.scheduler=threading.Thread(target=service.loop,daemon=True);service.scheduler.start()
        env=service.register_environment({**environment,"id":"install-environment","name":"Explicit installation environment"})
        if config["compute"]["kind"]=="ssh":
            p={**config["compute"]["connection"],"environment":environment,"id":"install-target"}
            try:previous=service.store.get("cluster","install-target")
            except ValueError:previous=None
            if previous and all(previous.get(k)==v for k,v in p.items()):cluster=previous
            else:service.clusters.register(p);cluster=service.store.get("cluster","install-target")
        project=service.register_project({"id":project_id,"name":"Bounded installation short cases","policy":{
            "engines":["pydyn.md"],"gpus":[config.get("gpu",0)],"max_seconds":120,"max_concurrent":1,
            "input_roots":[str(inputs)],"environments":[env["id"]],"clusters":[cluster["id"]] if cluster else []}})
        for case in config["cases"]:
            if case not in CASES:
                checks.append({"id":case,"status":"blocked","reason":"No shipped acceptance fixture; add and verify a versioned module case before selecting it"});continue
            folder=inputs/case;folder.mkdir(exist_ok=True);source=folder/"run.py"
            source.write_bytes((repo/"installation/examples"/CASES[case]).read_bytes())
            spec={"project_id":project_id,"engine":"pydyn.md","gpu":config.get("gpu",0),"max_seconds":120,
                  "idempotency_key":config["_fingerprint"]+":"+case,"name":"Install "+case,"inputs":{"run.py":str(source)},"parameters":{}}
            if cluster:
                spec.update(cluster_id=cluster["id"],resources=config["compute"]["resources"])
                result=service.clusters.prepare(spec)
                if not approved:
                    checks.append({"id":case,"status":"blocked","run_id":result["id"],"reason":"Draft prepared; review in Studio and approve before cluster submission"});continue
                if result["status"] in ("draft","ready"):result=service.clusters.validate(result["id"])
                result=service.clusters.submit(result["id"])
            else:
                spec["environment_id"]=env["id"];result=service.prepare(spec)
                if result["status"]=="draft":result=service.validate(result["id"])
                if result["status"]=="ready":result=service.submit(result["id"])
            started=time.monotonic()
            while result["status"] in ("queued","running") and time.monotonic()-started<180:
                time.sleep(.5 if not cluster else 3)
                result=service.clusters.poll(result["id"]) if cluster else service.store.run(result["id"])
            if result["status"]!="succeeded":
                checks.append({"id":case,"status":"blocked" if result["status"] in ("unknown","queued","running") else "failed","run_id":result["id"],"reason":"Worker status "+result["status"]+"; never automatically resubmit unknown"});continue
            if cluster:
                import base64
                asset=service.clusters.browse(project_id,cluster["id"],result["id"]+"/simulation/smoke-result.json")
                proof=json.loads(base64.b64decode(asset["base64"]))
            else:proof=json.loads((Path(result["directory"])/"results/smoke-result.json").read_text())
            expected=proof.get("status")=="passed" and proof.get("case")==case
            if case!="worker":expected=expected and proof.get("atoms")==32 and proof.get("steps")==5 and proof.get("finite_energy") is True and proof.get("moved") is True
            checks.append({"id":case,"status":"passed" if expected else "failed","run_id":result["id"],"scope":proof.get("scope",""),"assertions":{k:proof.get(k) for k in ("atoms","steps","finite_energy","moved") if k in proof}})
        report={"status":"passed" if checks and all(c["status"]=="passed" for c in checks) else "blocked" if any(c["status"]=="blocked" for c in checks) else "failed","checks":checks,"scope":"Only the selected, actually executed short cases"}
        atomic_json(state/"install-smoke.json",report);return report
    finally:service.close();service.store.db.close()
def main(value):
    action=value["action"];config=value["config"]
    try:
        if action=="probe":result=probe(config)
        elif action=="configure":result=bootstrap(config)
        elif action=="smoke":result=smoke(config,value.get("approved",False))
        else:raise ValueError("Unknown installer action")
    except BlockingIOError:result={"status":"blocked","reason":"Existing worker owns this state; use Studio monitoring or choose a separate installation root, never kill or resubmit jobs"}
    except (ValueError,PermissionError) as error:result={"status":"blocked","reason":str(error)}
    except Exception:result={"status":"failed","reason":"Target action failed; inspect private evidence, not public logs"}
    print("__STUDIO_INSTALL__"+json.dumps(result),flush=True)
    return result
if __name__=="__main__":main(json.load(sys.stdin))
