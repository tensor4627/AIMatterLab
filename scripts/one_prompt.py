"""Framework-neutral installer entry point. Keep configuration and evidence under ignored .studio/."""
import argparse,base64,datetime,hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"worker"))
REQUIRED=("desktop","target-probe","smoke")
def claim_audit_root(location,guard,role):
    path=Path(location).expanduser()
    if '..' in path.parts:raise ValueError('Audit directory aliases are not allowed')
    absolute=path.absolute();canonical=path.resolve()
    if absolute!=canonical or path.is_symlink():raise ValueError('Audit directory aliases are not allowed')
    if canonical.exists() and not canonical.is_dir():raise ValueError('Audit directory must be a dedicated directory')
    expected={'schema_version':1,'mode':'reuse-existing','role':role,'root':str(canonical),'audit_id':guard['audit_id'],'fingerprint':guard['fingerprint']}
    marker=canonical/'.studio-reuse-audit.json'
    if marker.is_symlink():raise ValueError('Linked audit ownership markers are not allowed')
    if marker.exists():
        if not marker.is_file() or marker.stat().st_size>4096 or json.loads(marker.read_text(encoding='utf-8'))!=expected:raise ValueError('Audit directory ownership differs; choose new dedicated roots')
        return expected
    if canonical.exists() and any(canonical.iterdir()):raise ValueError('Existing nonempty directory is not owned by this audit; choose new dedicated roots')
    canonical.mkdir(parents=True,exist_ok=True,mode=0o700)
    with marker.open('x',encoding='utf-8') as stream:json.dump(expected,stream,sort_keys=True)
    marker.chmod(0o600)
    return expected

def fingerprint(config):
    files=[ROOT/"INSTALL_AGENT.md",ROOT/"AGENTS.md",ROOT/"docs/one-prompt-install.md",ROOT/"installation/manifest.json",ROOT/"installation/runtime.py",ROOT/"scripts/one_prompt.py",ROOT/"package.json",ROOT/"pnpm-lock.yaml",ROOT/"index.html",ROOT/"vite.config.ts",ROOT/"tsconfig.json",ROOT/"worker/studio_worker/engine_contracts.json"]
    for name in ("desktop-launch.mjs","start.mjs","dev.mjs","windows-launch-preflight.ps1"):
        file=ROOT/"scripts"/name
        if file.exists() or file.is_symlink():files.append(file)
    surfaces={"installation/examples":("**/*.py",),"agents/skills":("**/*.md","**/*.py","**/*.json","**/*.yaml","**/*.yml","**/*.toml"),"desktop":("**/*.mjs","**/*.cjs","**/*.ts","**/*.json"),"shared":("**/*.mjs","**/*.json"),"worker":("**/*.py",),"src":("**/*.tsx","**/*.ts","**/*.css")}
    for directory,patterns in surfaces.items():
        for pattern in patterns:
            for file in (ROOT/directory).glob(pattern):
                parts=file.relative_to(ROOT/directory).parts
                if "__pycache__" in parts or directory=="worker" and "tests" in parts:continue
                if file.is_symlink():raise ValueError("Review linked source files before installation readiness checks")
                if file.is_file():files.append(file)
    if (ROOT/"worker/pyproject.toml").is_file():files.append(ROOT/"worker/pyproject.toml")
    digest=hashlib.sha256()
    digest.update(json.dumps(config,sort_keys=True).encode())
    for file in sorted(set(files)):
        if file.is_symlink():raise ValueError("Review linked source files before installation readiness checks")
        digest.update(str(file.relative_to(ROOT)).replace("\\","/").encode("utf-8"));digest.update(b"\0");digest.update(file.read_bytes());digest.update(b"\0")
    return digest.hexdigest()
def validate(config):
    if config.get("schema_version")!=1:raise ValueError("Unsupported install configuration")
    source_ids=config.get("desktop",{}).get("source_ids")
    if source_ids is not None and (not isinstance(source_ids,list) or any(value not in ("pygas","pydyn","gpumd","hotpp","torchnep") for value in source_ids)):raise ValueError("Choose an explicit scientific source summary allowlist")
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
def invoke(config,action,approved=False,audit_guard=None):
    source=(ROOT/"installation/runtime.py").read_text()
    code="import base64;exec(compile(base64.b64decode("+repr(base64.b64encode(source.encode()).decode())+"),'studio-install-runtime','exec'))"
    signature=fingerprint(config)
    if audit_guard and signature!=audit_guard["fingerprint"]:raise ValueError("Source changed during audit; choose fresh dedicated roots")
    payload={"action":action,"config":{**config,"_suite_root":linux_path(ROOT),"_fingerprint":signature},"approved":approved}
    if audit_guard:payload["config"]["_reuse_guard"]=audit_guard
    if config["compute"]["kind"]=="ssh" and action not in ("smoke","audit-root"):
        import shlex
        from studio_worker.cluster import SSH,profile
        p=profile({**config["compute"]["connection"],"environment":config["compute"]["environment"]})
        payload["config"]={"compute":{"kind":"ssh","environment":config["compute"]["environment"]},"bootstrap":config.get("bootstrap",{}),"cases":config.get("cases",[])}
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
def _desktop_report_snapshot(report):
    if report.is_symlink():raise ValueError("Desktop receipt must be a regular file")
    if not report.exists():return None,None
    if not report.is_file():raise ValueError("Desktop receipt must be a regular file")
    before=report.stat()
    if before.st_size>1024*1024:raise ValueError("Desktop receipt exceeds the bounded read limit")
    data=report.read_bytes();after=report.stat()
    identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    if identity(before)!=identity(after):raise ValueError("Desktop receipt changed during read")
    return {"stat":list(identity(after)),"sha256":hashlib.sha256(data).hexdigest()},data

def _write_desktop_launcher(state,node,*,windows):
    start=str(ROOT/"scripts/start.mjs")
    if windows:
        def batch(value):
            value=str(value)
            if any(c in value for c in '\"\r\n\0'):raise ValueError("Windows launcher paths cannot contain quotes or control characters")
            return value.replace("%","%%")
        node_cmd,start_cmd,profile_cmd,root_cmd=(batch(value) for value in (node,start,state/"desktop-profile",ROOT))
        text='@echo off\nsetlocal DisableDelayedExpansion\nset "STUDIO_PROFILE_DIR='+profile_cmd+'"\ncd /d "'+root_cmd+'"\nif errorlevel 1 exit /b 1\n"'+node_cmd+'" "'+start_cmd+'"\nexit /b %errorlevel%\n'
        (state/"Launch-Studio.cmd").write_text(text,encoding="utf-8")
        def literal(value):return "'"+str(value).replace("'","''")+"'"
        text="$env:STUDIO_PROFILE_DIR="+literal(state/"desktop-profile")+"\nSet-Location -LiteralPath "+literal(ROOT)+"\n& "+literal(node)+" "+literal(start)+"\nexit $LASTEXITCODE\n"
        (state/"Launch-Studio.ps1").write_text(text,encoding="utf-8")
    else:
        import shlex
        text="#!/bin/sh\ncd "+shlex.quote(str(ROOT))+" || exit 1\nexport STUDIO_PROFILE_DIR="+shlex.quote(str(state/"desktop-profile"))+"\nexec "+shlex.join([node,start])+"\n"
        launcher=state/"launch-studio.sh";launcher.write_text(text,encoding="utf-8");launcher.chmod(0o700)

def desktop(config,state,*,reuse_existing=False):
    node=config["desktop"].get("node") or "node"
    action="Launch from a normal desktop context; agents must request normal execution permission, then retry the guarded launcher."
    if not isinstance(node,str) or any(c in node for c in "\0\r\n"):return {"status":"blocked","reason":"invalid_desktop_node","user_action":"Choose an existing Node executable path."}
    env=os.environ.copy()
    env.update(STUDIO_VERIFY_ROOT=str(state),STUDIO_INSTALL_CONFIG=str(Path(config["_config_path"]).resolve()),STUDIO_PROFILE_DIR=str(state/"desktop-profile"))
    start=str(ROOT/"scripts/start.mjs")
    try:
        preflight=subprocess.run([node,start,"--preflight-only"],cwd=ROOT,env=env,capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=30)
        (state/"desktop-preflight.log").write_text(preflight.stdout+preflight.stderr,encoding="utf-8")
        observed=json.loads(preflight.stdout)
    except (OSError,subprocess.TimeoutExpired,ValueError):return {"status":"blocked","scope":"desktop launch preflight","reason":"desktop_preflight_unavailable","user_action":action}
    if preflight.returncode or not isinstance(observed,dict) or observed.get("status")!="allowed":
        reason=observed.get("reason") if isinstance(observed,dict) else None
        return {"status":"blocked","scope":"desktop launch preflight","reason":reason if reason in ("restricted_token","token_probe_failed","invalid_preflight_arguments") else "desktop_preflight_blocked","user_action":action}
    pnpm=config["desktop"].get("pnpm") or ("pnpm.cmd" if os.name=="nt" else "pnpm")
    if not reuse_existing and config["desktop"].get("install_dependencies",True):
        commands=[[pnpm,"install","--frozen-lockfile"],[pnpm,"run","build"]]
    else:commands=[[pnpm,"run","build"]]
    for index,argv in enumerate(commands):
        result=subprocess.run(argv,cwd=ROOT,capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=1200)
        (state/("desktop-command-"+str(index)+".log")).write_text(result.stdout+result.stderr,encoding="utf-8")
        if result.returncode:return {"status":"failed","scope":"desktop dependency or build command"}
    report=state/"desktop-install.json"
    try:before,_=_desktop_report_snapshot(report)
    except (OSError,ValueError):return {"status":"blocked","reason":"desktop_receipt_unavailable","user_action":"Inspect the existing desktop receipt; it was preserved."}
    try:result=subprocess.run([node,start,"--studio-install-verify"],cwd=ROOT,env=env,capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=240)
    except (OSError,subprocess.TimeoutExpired):return {"status":"blocked","reason":"desktop_verification_unavailable","user_action":"Inspect desktop verification logs and retry through the guarded launcher."}
    (state/"desktop-verify.log").write_text(result.stdout+result.stderr,encoding="utf-8")
    try:after,data=_desktop_report_snapshot(report)
    except (OSError,ValueError):after,data=None,None
    evidence={"before":before,"after":after,"fresh":after is not None and after!=before}
    if result.returncode:return {"status":"failed","scope":"desktop verification process exited unsuccessfully","reason":"desktop_verification_exit","exit_code":result.returncode,"receipt_evidence":evidence,"user_action":"Inspect desktop-verify.log; a previous receipt cannot override this process failure."}
    if not evidence["fresh"]:return {"status":"blocked","scope":"desktop verification did not produce a fresh receipt","reason":"desktop_receipt_not_fresh","receipt_evidence":evidence,"user_action":"Retain the previous report and rerun desktop verification through the guarded launcher."}
    try:receipt=json.loads(data.decode("utf-8-sig"))
    except (UnicodeError,ValueError):receipt=None
    if not isinstance(receipt,dict) or receipt.get("status") not in ("passed","failed","blocked"):return {"status":"blocked","reason":"invalid_desktop_receipt","receipt_evidence":evidence,"user_action":"Inspect the current desktop verification report."}
    receipt={**receipt,"receipt_evidence":evidence}
    if receipt["status"]!="passed":return receipt
    # A separate launcher preserves the verified profile without replacing existing installations.
    _write_desktop_launcher(state,node,windows=os.name=="nt")
    return receipt
def finalize(records,signature,cases,*,readiness_only=False):
    missing=[name for name in REQUIRED if name not in records or records[name].get("fingerprint")!=signature]
    if missing:return {"status":"blocked","installation_success":False,"missing":missing}
    if not readiness_only and any(records[name].get("verification_mode")=="reuse-existing" for name in REQUIRED):return {"status":"blocked","installation_success":False,"scope":"Reuse-existing audit receipts cannot finalize a fresh installation; run the ordinary installation gates separately"}
    statuses=[records[name]["result"]["status"] for name in REQUIRED]
    smoke=records["smoke"]["result"].get("checks",[])
    complete=all(v=="passed" for v in statuses) and {v["id"] for v in smoke}==set(cases) and all(v["status"]=="passed" for v in smoke)
    return {"status":"passed" if complete else "failed" if "failed" in statuses else "blocked","installation_success":complete,"selected_cases":cases,"scope":"Verified desktop, provider call and selected target short cases only","checks":{name:records[name]["result"] for name in REQUIRED}}
def reuse_existing(config,state,records,signature,approved=False,reuse_smoke_receipt=False):
    """Audit explicit existing dependencies inside exclusively owned audit roots."""
    now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
    started=now();guard={'fingerprint':signature,'audit_id':hashlib.sha256((str(state.resolve())+'\0'+signature).encode()).hexdigest()}
    if config.get('bootstrap',{}).get('enabled'):
        return {'status':'blocked','reuse_existing':True,'dry_run':True,'installation_success':False,'reuse_readiness_success':False,'audit_root_owned':False,'scope':'Existing environments only; disable bootstrap before auditing reuse'}
    try:claim_audit_root(state,guard,'controller')
    except (ValueError,OSError):return {'status':'blocked','reuse_existing':True,'dry_run':True,'installation_success':False,'reuse_readiness_success':False,'audit_root_owned':False,'scope':'Choose new dedicated controller and worker audit directories; existing content was not changed'}
    target={k:v for k,v in config.items() if k!='_config_path'};checks={}
    skipped=[{'action':'download','status':'not_run','reason':'Explicit reuse-existing dry-run'},{'action':'target-install/configure','status':'not_run','reason':'Reuse the selected registered interpreter and engine paths'},{'action':'desktop-package-install','status':'not_run','reason':'Dependency installation is disabled in reuse-existing mode'}]
    def save(action,result,observed_at=None):
        observed_at=observed_at or now();result={**result,'observed_at':observed_at,'receipt_cache':bool(result.get('receipt_cache'))}
        records[action]={'fingerprint':signature,'verification_mode':'reuse-existing','checked_at':observed_at,'result':result}
        (state/'receipts.json').write_text(json.dumps(records,indent=2),encoding='utf-8');(state/(action+'.json')).write_text(json.dumps(result,indent=2),encoding='utf-8');checks[action]=result
        return result
    def frozen():return fingerprint(target)==signature
    def source_changed():return {'status':'blocked','reuse_existing':True,'dry_run':True,'installation_success':False,'reuse_readiness_success':False,'audit_root_owned':True,'source_changed':True,'checks':checks,'scope':'Source fingerprint changed during audit; no later phase was started. Choose fresh controller and worker roots'}
    if not frozen():return source_changed()
    ownership=save('audit-root',invoke(target,'audit-root',approved,audit_guard=guard))
    if ownership.get('status')!='passed':return {'status':'blocked','reuse_existing':True,'dry_run':True,'installation_success':False,'reuse_readiness_success':False,'audit_root_owned':True,'checks':checks,'skipped_actions':skipped,'scope':'Worker audit ownership not verified; no Service or desktop was started'}
    old_probe=records.get('target-probe',{});old_record=records.get('smoke',{});old_smoke=old_record.get('completed_receipt') or old_record
    if not frozen():return source_changed()
    probe=save('target-probe',invoke(target,'probe',approved,audit_guard=guard))
    identity=lambda value:hashlib.sha256(json.dumps({key:item for key,item in value.items() if key not in ('observed_at','receipt_cache')},sort_keys=True).encode()).hexdigest()
    changed=(old_probe.get('fingerprint')==signature and old_probe.get('result',{}).get('status')=='passed' and identity(old_probe['result'])!=identity(probe)) or (old_smoke.get('fingerprint')==signature and old_smoke.get('probe_identity') is not None and old_smoke['probe_identity']!=identity(probe))
    dirty=any(value.get('dirty') is True for value in probe.get('repositories',{}).values())
    prior_smoke=old_smoke.get('fingerprint')==signature and old_smoke.get('result',{}).get('status')=='passed'
    if not frozen():return source_changed()
    if probe.get('status')!='passed':smoke={'status':'not_run','scope':'Selected environment probe is blocked'}
    elif changed:smoke={'status':'blocked','scope':'Actual registered environment identity changed; choose new controller and worker audit roots without changing existing jobs'}
    elif prior_smoke and reuse_smoke_receipt and not dirty and old_smoke.get('probe_identity')==identity(probe):
        smoke={**old_smoke['result'],'receipt_cache':True,'scope':'Explicit historical smoke receipt; current probe and provider are separate checks'}
    elif prior_smoke:smoke={'status':'blocked','scope':'Completed smoke evidence already exists; choose fresh roots or explicitly reuse an unchanged clean-source historical receipt'}
    else:smoke=invoke(target,'smoke',approved,audit_guard=guard)
    saved_smoke=save('smoke',smoke,old_smoke.get('checked_at') if smoke.get('receipt_cache') else None)
    if saved_smoke.get('status')=='passed' and not saved_smoke.get('receipt_cache'):
        records['smoke']['completed_receipt']={'fingerprint':signature,'checked_at':records['smoke']['checked_at'],'result':saved_smoke,'probe_identity':identity(probe)}
    elif prior_smoke:records['smoke']['completed_receipt']=old_smoke
    (state/'receipts.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
    if not frozen():return source_changed()
    snapshot_hash=None
    if probe.get('status')=='passed':
        snapshot=state/'audit-config.json';snapshot_bytes=json.dumps(target,indent=2).encode('utf-8');snapshot_hash=hashlib.sha256(snapshot_bytes).hexdigest();snapshot.write_bytes(snapshot_bytes);snapshot.chmod(0o600)
        if hashlib.sha256(snapshot.read_bytes()).hexdigest()!=snapshot_hash:return {**source_changed(),'source_changed':False,'configuration_changed':True,'scope':'Validated configuration snapshot changed; no desktop was started'}
        save('desktop',desktop({**config,'_config_path':str(snapshot)},state,reuse_existing=True))
        if hashlib.sha256(snapshot.read_bytes()).hexdigest()!=snapshot_hash:return {**source_changed(),'source_changed':False,'configuration_changed':True,'scope':'Validated configuration snapshot changed during desktop verification; choose fresh roots'}
    else:save('desktop',{'status':'not_run','scope':'Selected environment probe is blocked'})
    if not frozen():return source_changed()
    final=finalize(records,signature,config['cases'],readiness_only=True)
    cached=bool(smoke.get('receipt_cache'))
    return {'status':final['status'],'reuse_existing':True,'dry_run':True,'installation_success':False,'reuse_readiness_success':final['installation_success'],'audit_root_owned':True,'selected_cases':config['cases'],'checks':checks,'cached_evidence':cached,'config_snapshot_sha256':snapshot_hash,'skipped_actions':skipped,'fingerprint':signature,'started_at':started,'finished_at':now(),'scope':'Current probe/provider with explicitly historical smoke' if cached else 'Existing-machine readiness only; download and installation skipped; actual current probe/provider and selected short cases required'}

def main(argv=None):
    parser=argparse.ArgumentParser()
    parser.add_argument("action",choices=("plan","target-probe","configure","smoke","desktop","finalize","reuse-existing"))
    parser.add_argument("--config",required=True);parser.add_argument("--state-dir",default=str(ROOT/".studio/installation"))
    parser.add_argument("--reuse-smoke-receipt",action="store_true",help="Explicitly retain an unchanged clean-source historical smoke receipt; not fresh scientific evidence")
    parser.add_argument("--approve-submit",action="store_true",help="Only after reviewing the remote short-case scripts and resource limits")
    args=parser.parse_args(argv)
    requested_state=Path(args.state_dir).expanduser()
    state=requested_state.resolve()
    if args.action=="reuse-existing" and requested_state.absolute()!=state:raise ValueError("Audit directory aliases are not allowed")
    if state==ROOT or ROOT in state.parents and state.relative_to(ROOT).parts[0]!=".studio":raise ValueError("Keep installation state under ignored .studio or outside the checkout")
    if args.action!="reuse-existing":state.mkdir(parents=True,exist_ok=True)
    audit_owned=args.action!="reuse-existing"
    try:
        config=validate(json.loads(Path(args.config).read_text(encoding="utf-8")));signature=fingerprint(config)
        config["_config_path"]=args.config
        if args.action=="reuse-existing":
            guard={'fingerprint':signature,'audit_id':hashlib.sha256((str(state.resolve())+'\0'+signature).encode()).hexdigest()};claim_audit_root(state,guard,'controller');audit_owned=True
        record_path=state/"receipts.json"
        records=json.loads(record_path.read_text()) if record_path.exists() else {}
        if args.action=="plan":
            result={"status":"passed","scope":"Plan only; no install, SSH or jobs","steps":["configure target if needed","target-probe","smoke","desktop","finalize"],"selected_cases":config["cases"],"cluster_submit_requires_review":config["compute"]["kind"]=="ssh"}
        elif args.action=="finalize":result=finalize(records,signature,config["cases"])
        elif args.action=="reuse-existing":
            result=reuse_existing(config,state,records,signature,args.approve_submit,args.reuse_smoke_receipt);audit_owned=result.get("audit_root_owned",False)
        elif args.action=="smoke" and records.get("smoke",{}).get("verification_mode")!="reuse-existing" and records.get("smoke",{}).get("fingerprint")==signature and records["smoke"]["result"].get("status")=="passed":result={**records["smoke"]["result"],"receipt_cache":True}
        elif args.action=="desktop":result=desktop(config,state)
        else:result=invoke({k:v for k,v in config.items() if k!="_config_path"},{"target-probe":"probe"}.get(args.action,args.action),args.approve_submit)
        if args.action not in ("plan","finalize","reuse-existing"):
            records[args.action]={"fingerprint":signature,"verification_mode":"installation","checked_at":records.get(args.action,{}).get("checked_at") if result.get("receipt_cache") else datetime.datetime.now(datetime.timezone.utc).isoformat(),"result":result}
            record_path.write_text(json.dumps(records,indent=2),encoding="utf-8")
        # Configure returns a new environment for explicit review; never silently edits the user's configuration.
        if audit_owned:(state/(args.action+".json")).write_text(json.dumps(result,indent=2),encoding="utf-8")
        public={k:result[k] for k in ("status","installation_success","reuse_readiness_success","selected_cases","missing","scope","reason","user_action") if k in result}
        print(json.dumps(public))
        return 0 if result["status"]=="passed" else 2
    except Exception:
        result={"status":"blocked","installation_success":False,"reason":"Configuration or action unavailable; inspect private state and correct missing inputs"}
        if audit_owned:(state/(args.action+".json")).write_text(json.dumps(result,indent=2),encoding="utf-8")
        print(json.dumps(result));return 2
if __name__=="__main__":raise SystemExit(main())
