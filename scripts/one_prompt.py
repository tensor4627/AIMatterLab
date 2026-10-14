"""Framework-neutral installer entry point. Keep configuration and evidence under ignored .studio/."""
import argparse,base64,hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"worker"))
REQUIRED=("desktop","target-probe","smoke")
def fingerprint(config):
    files=[ROOT/"installation/runtime.py",ROOT/"scripts/one_prompt.py",ROOT/"package.json",ROOT/"pnpm-lock.yaml",*(ROOT/"installation/examples").glob("*.py"),*(ROOT/"desktop").glob("*.mjs"),*(ROOT/"worker/studio_worker").glob("*.py"),*(ROOT/"src").glob("*.tsx"),*(ROOT/"src").glob("*.ts"),ROOT/"src/style.css"]
    digest=hashlib.sha256()
    digest.update(json.dumps(config,sort_keys=True).encode())
    for file in sorted(files):digest.update(file.read_bytes())
    return digest.hexdigest()
def validate(config):
    if config.get("schema_version")!=1:raise ValueError("Unsupported install configuration")
    compute=config["compute"]
    if compute.get("kind") not in ("wsl","ssh"):raise ValueError("Choose WSL or SSH compute")
    python=compute["environment"]["executables"]["python"]
    if not isinstance(python,str) or not python.startswith("/") or "\n" in python:raise ValueError("Register the target Python absolute path")
    if not config.get("cases") or any(not isinstance(v,str) for v in config["cases"]):raise ValueError("Select installation short cases")
    worker=config["worker"]
    if not isinstance(worker.get("root"),str) or not worker["root"].startswith(("/","~/")):raise ValueError("Choose a dedicated Linux worker root")
    if worker["root"] in ("/","~/","/home","/usr"):raise ValueError("Dedicated worker root required")
    if compute["kind"]=="ssh":
        from studio_worker.cluster import profile,resources
        p=profile({**compute["connection"],"environment":compute["environment"]})
        resources(compute["resources"],p,120)
        if compute["resources"]["cpus"]>2 or compute["resources"]["gpus"]>1 or compute["resources"]["memory_mb"]>8192:raise ValueError("Installation short cases are limited to 2 CPU, 1 GPU and 8192 MB")
    return config
def linux_path(value):
    path=str(Path(value).resolve())
    if os.name=="nt":return "/mnt/"+path[0].lower()+"/"+path[3:].replace("\\","/")
    return path
def invoke(config,action,approved=False):
    source=(ROOT/"installation/runtime.py").read_text()
    code="import base64;exec(compile(base64.b64decode("+repr(base64.b64encode(source.encode()).decode())+"),'studio-install-runtime','exec'))"
    payload={"action":action,"config":{**config,"_suite_root":linux_path(ROOT),"_fingerprint":fingerprint(config)},"approved":approved}
    if config["compute"]["kind"]=="ssh" and action!="smoke":
        import shlex
        from studio_worker.cluster import SSH,profile
        p=profile({**config["compute"]["connection"],"environment":config["compute"]["environment"]})
        payload["config"]={"compute":{"kind":"ssh","environment":config["compute"]["environment"]},"bootstrap":config.get("bootstrap",{})}
        text=SSH(p).run(shlex.join(["python3","-c",code]),data=json.dumps(payload).encode(),timeout=1200 if action=="configure" else 90)
    else:
        args=["python3","-c",code]
        if os.name=="nt":args=["wsl.exe","-d",config["worker"]["distribution"],"--",*args]
        result=subprocess.run(args,input=json.dumps(payload),capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=1200 if action=="configure" else 900)
        if result.returncode:raise RuntimeError("Target runtime failed; private connection details withheld")
        text=result.stdout
    lines=[v[len("__STUDIO_INSTALL__"):] for v in text.splitlines() if v.startswith("__STUDIO_INSTALL__")]
    if not lines:raise RuntimeError("Target runtime did not return an install receipt")
    return json.loads(lines[-1])
def desktop(config,state):
    pnpm=config["desktop"].get("pnpm") or ("pnpm.cmd" if os.name=="nt" else "pnpm")
    if config["desktop"].get("install_dependencies",True):
        commands=[[pnpm,"install","--frozen-lockfile"],[pnpm,"run","build"]]
    else:commands=[[pnpm,"run","build"]]
    for index,argv in enumerate(commands):
        result=subprocess.run(argv,cwd=ROOT,capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=1200)
        (state/("desktop-command-"+str(index)+".log")).write_text(result.stdout+result.stderr,encoding="utf-8")
        if result.returncode:return {"status":"failed","scope":"desktop dependency or build command"}
    electron=ROOT/"node_modules/.bin"/("electron.cmd" if os.name=="nt" else "electron")
    env=os.environ.copy()
    env.update(STUDIO_VERIFY_ROOT=str(state),STUDIO_INSTALL_CONFIG=str(Path(config["_config_path"]).resolve()),STUDIO_PROFILE_DIR=str(state/"desktop-profile"))
    result=subprocess.run([str(electron),str(ROOT),"--studio-install-verify"],env=env,capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=240)
    (state/"desktop-verify.log").write_text(result.stdout+result.stderr,encoding="utf-8")
    report=state/"desktop-install.json"
    if not report.exists():return {"status":"blocked","scope":"desktop verification did not produce a receipt"}
    receipt=json.loads(report.read_text())
    if result.returncode or receipt["status"]!="passed":return receipt
    # A separate launcher preserves the verified profile without replacing existing installations.
    if os.name=="nt":
        def literal(value):return "'"+str(value).replace("'","''")+"'"
        (state/"Launch-Studio.ps1").write_text("$env:STUDIO_PROFILE_DIR="+literal(state/"desktop-profile")+"\n& "+literal(electron)+" "+literal(ROOT)+"\n",encoding="utf-8")
    else:
        import shlex
        (state/"launch-studio.sh").write_text("#!/bin/sh\nexport STUDIO_PROFILE_DIR="+shlex.quote(str(state/"desktop-profile"))+"\nexec "+shlex.join([str(electron),str(ROOT)])+"\n")
        (state/"launch-studio.sh").chmod(0o700)
    return receipt
def finalize(records,signature,cases):
    missing=[name for name in REQUIRED if name not in records or records[name].get("fingerprint")!=signature]
    if missing:return {"status":"blocked","installation_success":False,"missing":missing}
    statuses=[records[name]["result"]["status"] for name in REQUIRED]
    smoke=records["smoke"]["result"].get("checks",[])
    complete=all(v=="passed" for v in statuses) and {v["id"] for v in smoke}==set(cases) and all(v["status"]=="passed" for v in smoke)
    return {"status":"passed" if complete else "failed" if "failed" in statuses else "blocked","installation_success":complete,"selected_cases":cases,"scope":"Verified desktop, provider call and selected target short cases only","checks":{name:records[name]["result"] for name in REQUIRED}}
def main(argv=None):
    parser=argparse.ArgumentParser()
    parser.add_argument("action",choices=("plan","target-probe","configure","smoke","desktop","finalize"))
    parser.add_argument("--config",required=True);parser.add_argument("--state-dir",default=str(ROOT/".studio/installation"))
    parser.add_argument("--approve-submit",action="store_true",help="Only after reviewing the remote short-case scripts and resource limits")
    args=parser.parse_args(argv)
    state=Path(args.state_dir).resolve()
    if state==ROOT or ROOT in state.parents and state.relative_to(ROOT).parts[0]!=".studio":raise ValueError("Keep installation state under ignored .studio or outside the checkout")
    state.mkdir(parents=True,exist_ok=True)
    try:
        config=validate(json.loads(Path(args.config).read_text(encoding="utf-8")));signature=fingerprint(config)
        config["_config_path"]=args.config
        record_path=state/"receipts.json"
        records=json.loads(record_path.read_text()) if record_path.exists() else {}
        if args.action=="plan":
            result={"status":"passed","scope":"Plan only; no install, SSH or jobs","steps":["configure target if needed","target-probe","smoke","desktop","finalize"],"selected_cases":config["cases"],"cluster_submit_requires_review":config["compute"]["kind"]=="ssh"}
        elif args.action=="finalize":result=finalize(records,signature,config["cases"])
        elif args.action=="smoke" and records.get("smoke",{}).get("fingerprint")==signature and records["smoke"]["result"].get("status")=="passed":result={**records["smoke"]["result"],"receipt_cache":True}
        elif args.action=="desktop":result=desktop(config,state)
        else:result=invoke({k:v for k,v in config.items() if k!="_config_path"},{"target-probe":"probe"}.get(args.action,args.action),args.approve_submit)
        if args.action not in ("plan","finalize"):
            records[args.action]={"fingerprint":signature,"result":result}
            record_path.write_text(json.dumps(records,indent=2),encoding="utf-8")
        # Configure returns a new environment for explicit review; never silently edits the user's configuration.
        (state/(args.action+".json")).write_text(json.dumps(result,indent=2),encoding="utf-8")
        public={k:result[k] for k in ("status","installation_success","selected_cases","missing","scope") if k in result}
        print(json.dumps(public))
        return 0 if result["status"]=="passed" else 2
    except Exception:
        result={"status":"blocked","installation_success":False,"reason":"Configuration or action unavailable; inspect private state and correct missing inputs"}
        (state/(args.action+".json")).write_text(json.dumps(result,indent=2),encoding="utf-8");print(json.dumps(result));return 2
if __name__=="__main__":raise SystemExit(main())
