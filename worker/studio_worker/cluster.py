"""SSH scheduler control; local worker owns records, schedulers own remote processes."""
import base64
import hashlib
import io
import json
import math
import os
import re
import secrets
import shlex
import shutil
import subprocess
import tarfile
import time
from pathlib import Path
from .adapters import Adapter, ENGINES
from .util import atomic_json, contained, digest, leaf

TOKEN = re.compile(r"^[A-Za-z0-9_.@:/+-]+$")
MARKER = "__STUDIO_JSON__"
TERMINAL = ("succeeded", "failed", "cancelled")


def word(value, name="value"):
    if not isinstance(value, str) or not value or len(value) > 256 or not TOKEN.fullmatch(value) or value.startswith("-"):
        raise ValueError("Invalid " + name)
    return value


def profile(value):
    p = dict(value)
    if p.get("scheduler") not in ("lsf", "slurm"):
        raise ValueError("Select LSF or Slurm")
    word(p["target"], "SSH target")
    port = p.get("port", 22)
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("Invalid SSH port")
    p["port"] = port
    for hop in p.get("via", []):
        word(hop, "SSH hop")
    for key in ("ssh_client", "remote_root"):
        if not isinstance(p.get(key), str) or "\n" in p[key] or "\0" in p[key] or not p[key].startswith(("/", "~/")):
            raise ValueError("Absolute client and scoped remote root required")
    root = p["remote_root"]
    if root in ("/", "~", "~/") or ".." in root.split("/"):
        raise ValueError("Dedicated remote run root required")
    for root in p.get("read_roots",[]):
        if not isinstance(root,str) or not root.startswith(("/", "~/")) or "\\n" in root:raise ValueError("Explicit remote read roots required")
    if len(p.get("activation", "")) > 8192:
        raise ValueError("Activation script exceeds limit")
    e = p.setdefault("environment", {"executables": {"python": "/usr/bin/python3"}})
    for path in [*e.get("executables", {}).values(), *e.get("repositories", {}).values()]:
        if not isinstance(path, str) or not path.startswith("/") or "\n" in path or "\0" in path:
            raise ValueError("Remote environment paths must be absolute")
    if not e.get("executables", {}).get("python"):
        raise ValueError("Register target Python")
    for key,value in e.get("variables",{}).items():
        if key not in ("LD_LIBRARY_PATH","LIBRARY_PATH","OMP_NUM_THREADS","MKL_NUM_THREADS") or not isinstance(value,(str,int)) or "\\n" in str(value) or "\\x00" in str(value):
            raise ValueError("Unsupported target loader variable")
    p.setdefault("lsf_memory_scope","per_slot")
    if p["lsf_memory_scope"] not in ("per_slot","per_job"):raise ValueError("Confirm LSF memory reservation semantics")
    p.setdefault("name", "SSH cluster")
    p.setdefault("limits", {"cpus": 64, "gpus": 8, "memory_mb": 262144})
    for k in ("cpus", "gpus", "memory_mb"):
        if type(p["limits"].get(k)) is not int or p["limits"][k] < 0:
            raise ValueError("Explicit resource limits required")
    return p


def public(p):
    return {k: p.get(k) for k in ("id", "name", "scheduler", "version", "queue", "environment", "limits", "activation", "probe", "lsf_memory_scope")}


class SSH:
    def __init__(self, p):
        self.p = p

    def run(self, script, data=None, timeout=40):
        p = self.p
        args = [p["ssh_client"], "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
                "-o", "ConnectTimeout=12", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2"]
        if p.get("identity_file"):
            args += ["-i", p["identity_file"]]
        args += ["-p", str(p["port"])]
        remote = "bash -lc " + shlex.quote(script)
        for hop in reversed(p.get("via", [])):
            remote = "ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes " + shlex.quote(hop) + " " + shlex.quote(remote)
        args += [p["target"], remote]
        try:
            result = subprocess.run(args, input=data, capture_output=True, timeout=timeout)
        except (subprocess.TimeoutExpired, OSError):
            raise ConnectionError("SSH transport unavailable; connection details withheld") from None
        if result.returncode:
            raise ConnectionError("Remote command failed; inspect private cluster diagnostics") from None
        if len(result.stdout) > 4 * 1024 * 1024:
            raise ValueError("Remote response exceeds bound")
        return result.stdout.decode("utf8", "replace")


def python_script(p, source, payload):
    code = "import base64,json; p=json.loads(base64.b64decode(" + repr(base64.b64encode(json.dumps(payload).encode()).decode()) + "));\n" + source
    return shlex.join(["python3", "-c", code])


def parse_output(output):
    lines = [line[len(MARKER):] for line in output.splitlines() if line.startswith(MARKER)]
    if not lines:
        raise ValueError("Remote response has no structured receipt")
    return json.loads(lines[-1])


def resources(value, p, seconds):
    r = dict(value)
    for key, default in (("cpus", 1), ("gpus", 0), ("memory_mb", 1024)):
        r.setdefault(key, default)
        if type(r[key]) is not int or r[key] < (1 if key != "gpus" else 0) or r[key] > p["limits"][key]:
            raise PermissionError("Resource exceeds cluster limit: " + key)
    r.setdefault("queue", p.get("queue", ""))
    if not r["queue"]:
        raise ValueError("Explicit queue/partition required")
    word(r["queue"], "queue")
    if r.get("account"):
        word(r["account"], "scheduler account")
    r["seconds"] = int(seconds)
    return r


def batch_script(run):
    p, r = run["cluster_snapshot"], run["resources"]
    name, remote = run["job_name"], run["remote_directory"]
    header = ["#!/bin/bash"]
    if p["scheduler"] == "slurm":
        header += [f"#SBATCH --job-name={name}", f"#SBATCH --partition={r['queue']}",
                   "#SBATCH --nodes=1", f"#SBATCH --cpus-per-task={r['cpus']}", f"#SBATCH --mem={r['memory_mb']}M",
                   f"#SBATCH --time={math.ceil(r['seconds']/60)}", "#SBATCH --output=queue.out",
                   "#SBATCH --error=queue.err", "#SBATCH --export=NONE"]
        if r["gpus"]:
            header.append(f"#SBATCH --gres=gpu:{r['gpus']}")
        if r.get("account"):
            header.append("#SBATCH --account=" + r["account"])
    else:
        header += [f"#BSUB -J {name}", f"#BSUB -q {r['queue']}", f"#BSUB -n {r['cpus']}",
                   f"#BSUB -W {math.ceil(r['seconds']/60)}", f"#BSUB -M {r['memory_mb']}MB",
                   f"#BSUB -R \"rusage[mem={math.ceil(r['memory_mb']/r['cpus']) if p.get('lsf_memory_scope','per_slot')=='per_slot' else r['memory_mb']}] span[hosts=1]\"", "#BSUB -o queue.out", "#BSUB -e queue.err", "#BSUB -env none"]
        if r["gpus"]:
            header.append(f'#BSUB -gpu "num={r["gpus"]}"')
        if r.get("account"):
            header.append("#BSUB -P " + r["account"])
    python = shlex.quote(p["environment"]["executables"]["python"])

    remote_path='"$HOME"/'+shlex.quote(remote[2:]) if remote.startswith("~/") else shlex.quote(remote)
    receipt="import json,os,sys;json.dump({'nonce':"+repr(run["nonce"])+",'exit_code':int(sys.argv[1])},open('exit.tmp','w'));os.replace('exit.tmp','exit.json')"
    exports=["export "+key+"="+shlex.quote(str(value)) for key,value in p["environment"].get("variables",{}).items()]
    paths=list(p["environment"].get("repositories",{}).values())
    if paths:exports.append("export PYTHONPATH="+shlex.quote(":".join(paths))+':'+chr(36)+'{PYTHONPATH:-}')
    body=["set -u",'if [ "'+chr(36)+'{CUDA_VISIBLE_DEVICES+x}" = x ]; then _STUDIO_ASSIGNED_CUDA='+chr(36)+'CUDA_VISIBLE_DEVICES; _STUDIO_HAS_CUDA=1; fi',p.get("activation",""),
          'if [ "'+chr(36)+'{_STUDIO_HAS_CUDA:-0}" = 1 ]; then export CUDA_VISIBLE_DEVICES='+chr(36)+'_STUDIO_ASSIGNED_CUDA; fi',*exports,"cd "+remote_path+" || exit 1","start=$SECONDS",
          f"timeout --signal=TERM --kill-after=15s {r['seconds']}s {python} .studio/validate.py >validation.stdout 2>validation.stderr",
          "status=$?",f"remaining=$(({r['seconds']}-(SECONDS-start)))",
          'if [ "$status" -eq 0 ] && [ "$remaining" -gt 0 ]; then',
          " cd simulation || exit 1",
          ' timeout --signal=TERM --kill-after=15s "$remaining"s '+shlex.join(run["command"])+" >../console.log 2>&1",
          " status=$?"," cd ..","elif [ $remaining -le 0 ]; then"," status=124","fi",
          python+" -c "+shlex.quote(receipt)+' "$status"','exit "$status"']
    return "\n".join(header+body)+"\n"



class PlanningAdapter(Adapter):
    def executable(self, environment, name):
        path = environment.get("executables", {}).get(name)
        if not path or not path.startswith("/"):
            raise ValueError("Register remote executable: " + name)
        return path

    def bias_command(self, spec, environment):
        p = spec["parameters"]
        repo = environment.get("repositories", {}).get("pygas")
        if not repo:
            raise ValueError("Register target pyGAS repository")
        return [self.executable(environment, "python"), repo + "/agents/skills/pygas-check-gpumd-contract/scripts/validate_model.py",
                p["bias_file"], p["structure_file"]]


class Clusters:
    def __init__(self, service, transport=SSH):
        self.service, self.store, self.transport = service, service.store, transport
        self.last_poll = 0

    def register(self, value):
        p = profile(value)
        p.setdefault("id", secrets.token_hex(10))
        leaf(p["id"])
        previous = next((x for x in self.store.list("cluster") if x["id"] == p["id"]), None)
        p["version"] = (previous or {}).get("version", 0) + 1
        skill_root=self.service.root/"cluster-skills"/p["id"]/("v"+str(p["version"]))
        skill_root.mkdir(parents=True,exist_ok=True)
        source="# Cluster submission skill\n\n"+json.dumps({k:p.get(k) for k in ("id","name","version","scheduler","queue","limits","lsf_memory_scope","environment")},indent=2)+"\n\nUse only registered cluster IDs; never put SSH addresses, ports, keys or model proxy credentials in prompts or scripts. Probe the login node, then confirm queue/resource semantics with the user. Use present_task to show workflow and parameters. Prepare immutable inputs with prepare_cluster_run and STOP for the user to review the batch script and click Submit. Scientific validation executes on allocated compute nodes before the engine; never treat login-node discovery as science validation. Do not change project authorization. Never resubmit an unknown run; reconcile receipts and scheduler job identity. Read bounded logs and assets through cluster tools.\n\n"+str(p.get("notes",""))
        (skill_root/"SKILL.md").write_text(source,encoding="utf8")
        self.store.put("cluster-version",{**p,"id":p["id"]+"-v"+str(p["version"])})
        self.store.put("cluster", p)
        return public(p)

    def allowed(self, project_id, cluster_id):
        project = self.store.get("project", project_id)
        if cluster_id not in project["policy"].get("clusters", []):
            raise PermissionError("Cluster is not authorized for this project")
        return project, self.store.get("cluster", cluster_id)

    def probe(self, cluster_id):
        p = self.store.get("cluster", cluster_id)
        source = """
import os,pathlib,shutil,subprocess
out={'scope':'login-node observation; compute-node GPU and scientific validation not_run','scheduler':p['scheduler'],'commands':{},'queues':[],'python':os.sys.version.split()[0]}
for name in ['bsub','bjobs','bqueues','bkill','sbatch','squeue','sacct','sinfo','scancel','nvidia-smi','module']:
 out['commands'][name]=bool(shutil.which(name))
cmd=['bqueues','-noheader','-o','queue_name:80'] if p['scheduler']=='lsf' else ['sinfo','-h','-o','%P']
try:
 result=subprocess.run(cmd,capture_output=True,text=True,timeout=12)
 if result.returncode==0:out['queues']=[x.strip().rstrip('*') for x in result.stdout.splitlines() if x.strip()][:100]
except Exception:pass
out['executables']={k:{'exists':pathlib.Path(v).is_file(),'executable':os.access(v,os.X_OK)} for k,v in p['executables'].items()}
print('__STUDIO_JSON__'+json.dumps(out))
"""
        payload={"scheduler":p["scheduler"],"executables":p["environment"]["executables"]}
        script=python_script({**p,"environment":{"executables":{"python":"python3"}}},source,payload)
        result = parse_output(self.transport(p).run(script))
        p["probe"] = {**result, "observed_at":time.time()}
        self.store.put("cluster", p)
        return result

    def skill(self,project_id,cluster_id):
        _,p=self.allowed(project_id,cluster_id)
        file=self.service.root/"cluster-skills"/p["id"]/("v"+str(p["version"]))/"SKILL.md"
        if not file.is_file():raise ValueError("Save the profile to register its versioned skill")
        return {"cluster_id":p["id"],"version":p["version"],"source":file.read_text("utf8")}

    def draft(self, data):
        self.allowed(data["project_id"], data["cluster_id"])
        proposal = data["proposal"]
        if not isinstance(proposal, dict) or any(k not in ("queue","activation","environment","limits","notes","lsf_memory_scope") for k in proposal):
            raise ValueError("Only reviewable environment/skill fields can be proposed")
        return self.store.put("cluster-draft", {"id":secrets.token_hex(10), "kind":"cluster-setup", **data, "status":"draft"})

    def prepare(self, spec):
        spec = dict(spec)
        project, p = self.allowed(spec["project_id"], spec["cluster_id"])
        if spec["engine"] not in project["policy"]["engines"] or spec["engine"] not in ENGINES:
            raise PermissionError("Engine is not authorized")
        if type(spec.get("max_seconds")) is not int:raise ValueError("Integer wall-clock limit required")
        if not 0 < int(spec["max_seconds"]) <= project["policy"]["max_seconds"]:
            raise PermissionError("Duration exceeds project authorization")
        key = spec["idempotency_key"]
        if not isinstance(key, str) or not 1 <= len(key) <= 128:
            raise ValueError("Bounded idempotency key required")
        fingerprint = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()
        previous = next((r for r in self.store.list("cluster-run") if r["project_id"]==spec["project_id"] and r["idempotency_key"]==key), None)
        if previous:
            if previous["request_hash"] != fingerprint:
                raise ValueError("Idempotency conflict")
            return self.run(previous["id"])
        r = resources(spec.get("resources", {}), p, spec["max_seconds"])
        if (spec["engine"].endswith("sampling") or spec["engine"]=="bias.validate") and r["gpus"]<1:
            raise ValueError("Bias target validation requires a GPU allocation")
        command = PlanningAdapter(spec["engine"]).prepare(spec, p["environment"])
        identifier = secrets.token_hex(12)
        directory = self.service.root / "cluster-runs" / identifier
        (directory/"simulation").mkdir(parents=True)
        snapshots = []
        roots = project["policy"]["input_roots"] + [str(self.service.root/"projects"/project["id"]/"inputs")]
        parent=None
        if spec.get("revision_of"):
            parent=self.raw(spec["revision_of"])
            if parent["project_id"]!=project["id"] or parent["status"] not in ("draft","ready"):
                raise PermissionError("Only an unsubmitted run in the same project may be revised")
            roots.append(parent["directory"])
        try:
            for name, src in spec["inputs"].items():
                self.service.input_name(name)
                source = contained(src, roots)
                if not source.is_file():
                    raise ValueError("Input unavailable")
                dst = directory/"simulation"/name
                dst.parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(source,dst)
                dst.chmod(0o444)
                snapshots.append({"name":name,"source":str(source),"sha256":digest(dst),"size":dst.stat().st_size})
            run = {**spec,"id":identifier,"kind":"cluster-run","name":spec.get("name",spec["engine"]),
                   "request_hash":fingerprint,"directory":str(directory),"snapshots":snapshots,"command":command,
                   "resources":r,"cluster_snapshot":p,"status":"draft","validation":{"status":"not_run"},
                   "scientific_validation":{"status":"not_run"},"nonce":secrets.token_hex(16),
                   "remote_directory":p["remote_root"].rstrip("/")+"/"+identifier,
                   "job_name":"gss-"+identifier,"job_id":None,"created_at":time.time(),"updated_at":time.time()}
            if run["remote_directory"].startswith("~/"):
                # Bash can expand $HOME while retaining a quoted relative suffix.
                run["remote_directory"]=run["remote_directory"]
            run["script"] = batch_script(run)
            atomic_json(directory/"run.json",run)
            self.store.put("cluster-run",run)
            if parent:self.save(parent,superseded_by=identifier)
            return self.run(identifier)
        except Exception:
            shutil.rmtree(directory)
            raise

    def raw(self, identifier):
        return self.store.get("cluster-run", identifier)

    def save(self, r, **changes):
        r.update(changes,updated_at=time.time())
        self.store.put("cluster-run",r)
        self.store.event(r["id"],{"kind":"cluster-run","state":r["status"]})
        atomic_json(Path(r["directory"])/"run.json",r)
        return r

    def run(self, identifier):
        r = dict(self.raw(identifier))
        r["cluster"] = public(r.pop("cluster_snapshot"))
        return r

    def validate(self, identifier):
        r = self.raw(identifier)
        project,current=self.allowed(r["project_id"],r["cluster_id"])
        if r["engine"] not in project["policy"]["engines"] or r["max_seconds"]>project["policy"]["max_seconds"]:
            raise PermissionError("Current project policy no longer permits this draft")
        if current["version"]!=r["cluster_snapshot"]["version"]:
            raise ValueError("Cluster profile changed; create a new reviewed draft")
        resources(r["resources"],current,r["max_seconds"])
        if r["status"] not in ("draft","ready"):
            raise ValueError("Submitted inputs are immutable")
        for asset in r["snapshots"]:
            if digest(Path(r["directory"])/"simulation"/asset["name"]) != asset["sha256"]:
                raise ValueError("Input snapshot changed")
        PlanningAdapter(r["engine"]).prepare(r,r["cluster_snapshot"]["environment"])
        resources(r["resources"],r["cluster_snapshot"],r["max_seconds"])
        self.save(r,status="ready",validation={"status":"passed","scope":"local immutable inputs and scheduler resource contract only; scientific checks run on execution node"})
        return self.run(identifier)

    def revise(self,identifier,changes):
        parent=self.raw(identifier)
        allowed=("name","engine","max_seconds","resources","inputs","parameters")
        if any(k not in allowed for k in changes):raise ValueError("Unsupported revision field")
        spec={k:parent[k] for k in ("project_id","cluster_id",*allowed) if k in parent}
        spec.update(changes)
        spec.update(revision_of=identifier,idempotency_key=secrets.token_hex(16))
        return self.prepare(spec)

    def archive(self, r):
        buffer = io.BytesIO()
        root = Path(r["directory"])
        validate = """import sys,json,os
from pathlib import Path
sys.path.insert(0,str(Path('.studio').resolve()))
from studio_worker.adapters import Adapter
from studio_worker.util import atomic_json,digest,contained
r=json.load(open('.studio/run.json'))
environment=r['environment_snapshot']
import studio_worker.adapters as a
_original=a.process_env
a.process_env=lambda environment,gpu=None:_original(environment,None)
for a in r['snapshots']:
 f=contained(Path('simulation')/a['name'],[Path('simulation')])
 if digest(f)!=a['sha256']:raise ValueError('Remote immutable input changed')
try:
 atomic_json('environment.json',Adapter(r['engine']).probe(environment))
 Adapter(r['engine']).prepare(r,environment)
 report=Adapter(r['engine']).validate(r,environment,Path('simulation').resolve())
 atomic_json('validation.json',report)
except Exception as e:
 atomic_json('validation.json',{'status':'failed','message':str(e)})
 raise
"""
        with tarfile.open(fileobj=buffer,mode="w:gz") as tar:
            def add(name, content):
                b=content.encode() if isinstance(content,str) else content
                info=tarfile.TarInfo(name);info.size=len(b);info.mode=0o600
                tar.addfile(info,io.BytesIO(b))
            for asset in r["snapshots"]:
                tar.add(root/"simulation"/asset["name"],arcname="simulation/"+asset["name"],recursive=False)
            add("job.sh",r["script"])
            payload={**r,"environment_snapshot":r["cluster_snapshot"]["environment"],"gpu":r.get("gpu",0)}
            # No SSH target, port, key or connection information is copied to the cluster.
            payload.pop("cluster_snapshot",None);payload.pop("cluster",None)
            add(".studio/run.json",json.dumps(payload))
            add(".studio/validate.py",validate)
            for name in ["__init__.py","adapters.py","util.py","scientific.py","science_checks.py","derivatives.py"]:
                add(".studio/studio_worker/"+name,Path(__file__).with_name(name).read_bytes())
        return buffer.getvalue()

    def submit(self, identifier):
        with self.store.lock:
            r=self.raw(identifier)
            project,p=self.allowed(r["project_id"],r["cluster_id"])
            if r.get("superseded_by"):raise ValueError("Review and submit the revised snapshot")
            if r["status"] in ("queued","running","unknown",*TERMINAL):
                return self.run(identifier)
            if r["status"]!="ready" or r["validation"]["status"]!="passed":
                raise ValueError("Review and validate before submitting")
            self.validate(identifier)
            busy=[x for x in self.store.list("cluster-run") if x["project_id"]==r["project_id"] and x["status"] in ("queued","running","unknown")]
            if len(busy)+sum(x["project_id"]==r["project_id"] and x["status"] in ("running","unknown") for x in self.store.runs())>=project["policy"]["max_concurrent"]:
                raise PermissionError("Project concurrency limit reached")
            # Persist uncertain state BEFORE any remote submission; never retry this operation automatically.
            self.save(r,status="unknown",submit_attempted=True)
        source="""
import pathlib,tarfile,sys,io,subprocess,os
root=pathlib.Path(p['root']).expanduser().resolve();root.mkdir(parents=True,exist_ok=True)
d=root/p['id']
if d.exists():raise ValueError('Run directory already exists; reconcile only')
d.mkdir()
with tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()),mode='r:gz') as t:
 for member in t.getmembers():
  q=(d/member.name).resolve()
  if d not in q.parents or member.issym() or member.islnk() or not member.isfile():raise ValueError('Unsafe input archive')
 t.extractall(d,filter='data') if sys.version_info>=(3,12) else t.extractall(d)
(d/'.submit-attempt').write_text(p['nonce'])
cmd=['bsub','-env','none'] if p['scheduler']=='lsf' else ['sbatch','--parsable','job.sh']
with open(d/'job.sh','rb') as script:
 result=subprocess.run(cmd,cwd=d,stdin=script if p['scheduler']=='lsf' else subprocess.DEVNULL,capture_output=True)
out=result.stdout.decode('utf8','replace')
import re
match=re.search(r'Job <([0-9]+)>',out) if p['scheduler']=='lsf' else re.match(r'^([0-9]+)(?:;[A-Za-z0-9_.-]+)?\\s*$',out.strip())
if result.returncode or not match:raise RuntimeError('Submission uncertain; reconcile without retry')
record={'id':p['id'],'nonce':p['nonce'],'job_id':match.group(1)}
(d/'.submission-receipt.json').write_text(json.dumps(record))
print('__STUDIO_JSON__'+json.dumps(record))
"""
        try:
            result=parse_output(self.transport(p).run(python_script(p,source,{"root":p["remote_root"],"id":r["id"],"nonce":r["nonce"],"scheduler":p["scheduler"]}),data=self.archive(r),timeout=90))
            if result.get("nonce")!=r["nonce"] or not re.fullmatch(r"[0-9]+",result.get("job_id","")):
                raise ValueError("Invalid scheduler receipt")
            self.save(r,status="queued",job_id=result["job_id"])
        except Exception:
            self.save(r,status="unknown",error="Submission reply unavailable; reconcile only, never resubmit")
        return self.run(identifier)

    def poll(self, identifier):
        r=self.raw(identifier);self.allowed(r["project_id"],r["cluster_id"])
        if r["status"] in ("draft","ready",*TERMINAL):
            return self.run(identifier)
        p=r["cluster_snapshot"]
        source="""
import pathlib,subprocess
d=pathlib.Path(p['root']).expanduser().resolve()/p['id'];out={'job_id':p.get('job_id'),'state':'unknown'}
receipt=d/'.submission-receipt.json'
if receipt.exists():
 v=json.load(open(receipt))
 if v.get('nonce')==p['nonce']:out['job_id']=v['job_id']
if not out['job_id'] and (d/'.submit-attempt').exists() and (d/'.submit-attempt').read_text()==p['nonce']:
 if p['scheduler']=='lsf':
  found=subprocess.run(['bjobs','-a','-J',p['name'],'-l'],capture_output=True,text=True,timeout=15)
  import re
  matches=re.findall(r'Job\\s*<([0-9]+)>',found.stdout)
 else:
  found=subprocess.run(['squeue','-h','--name',p['name'],'-o','%i|%j'],capture_output=True,text=True,timeout=15)
  matches=[row.split('|')[0] for row in found.stdout.splitlines() if row.split('|')[-1].strip()==p['name']]
 if len(matches)==1:out['job_id']=matches[0]
if (d/'exit.json').exists():
 v=json.load(open(d/'exit.json'))
 if v.get('nonce')==p['nonce']:out['exit']=v
if (d/'validation.json').exists():out['validation']=json.load(open(d/'validation.json'))
if out['job_id']:
 if p['scheduler']=='lsf':cmd=['bjobs','-a','-l',out['job_id']]
 else:cmd=['squeue','-h','-j',out['job_id'],'-o','%i|%T|%j']
 result=subprocess.run(cmd,capture_output=True,text=True,timeout=15)
 rows=[x.strip().split('|') for x in result.stdout.splitlines() if x.strip()]
 if p['scheduler']=='lsf':
  import re
  text=re.sub(r'\\n\\s+','',result.stdout)
  jid=re.search(r'Job\\s*<([0-9]+)>',text);name=re.search(r'Job Name\\s*<([^>]+)>',text);state=re.search(r'Status\\s*<([^>]+)>',text)
  rows=[[jid.group(1),state.group(1),''.join(name.group(1).split())]] if jid and name and state else []
 if p['scheduler']=='slurm' and not rows:
  result=subprocess.run(['sacct','-X','-n','-P','-j',out['job_id'],'--format=JobIDRaw,State,JobName%80'],capture_output=True,text=True,timeout=15)
  rows=[x.strip().split('|') for x in result.stdout.splitlines() if x.strip()]
 for row in rows:
  if len(row)>=3 and row[0].strip()==out['job_id'] and row[2].strip()==p['name']:
   out['scheduler_state']=row[1].strip().split()[0];out['identity_verified']=True
print('__STUDIO_JSON__'+json.dumps(out))
"""
        try:
            result=parse_output(self.transport(p).run(python_script(p,source,{"root":p["remote_root"],"id":r["id"],"nonce":r["nonce"],"job_id":r["job_id"],"scheduler":p["scheduler"],"name":r["job_name"]})))
            state=result.get("scheduler_state","unknown").upper()
            mapped={"PEND":"queued","PENDING":"queued","RUN":"running","RUNNING":"running","PSUSP":"queued","USUSP":"queued","SSUSP":"queued","CONFIGURING":"queued","COMPLETING":"running","EXIT":"failed","FAILED":"failed","TIMEOUT":"failed","OUT_OF_MEMORY":"failed","CANCELLED":"cancelled"}
            status=mapped.get(state,"unknown")
            if result.get("exit"):
                status="succeeded" if result["exit"]["exit_code"]==0 else "failed"
                if result.get("validation",{}).get("status")!="passed" and status=="succeeded":
                    status="unknown"
            if state in ("EXIT","CANCELLED") and r.get("cancel_requested") and result.get("exit",{}).get("exit_code")!=0:status="cancelled"
            self.save(r,status=status,job_id=result.get("job_id") or r["job_id"],scheduler_state=state,
                      scientific_validation=result.get("validation",r.get("scientific_validation")),exit=result.get("exit"),identity_verified=result.get("identity_verified",False))
        except Exception:
            self.save(r,status="unknown",error="SSH or scheduler state unavailable; no resubmission")
        return self.run(identifier)

    def cancel(self, identifier):
        current=self.poll(identifier);r=self.raw(identifier)
        if current["status"] in TERMINAL:return current
        if not r.get("job_id") or not r.get("identity_verified"):
            raise ValueError("Cannot cancel an unverified scheduler identity")
        p=r["cluster_snapshot"]
        command=["bkill" if p["scheduler"]=="lsf" else "scancel",r["job_id"]]
        self.transport(p).run(shlex.join(command))
        self.save(r,cancel_requested=True)
        return self.run(identifier)

    def read(self, identifier, name="console.log", offset=0):
        r=self.raw(identifier);self.allowed(r["project_id"],r["cluster_id"])
        if name not in ("console.log","queue.out","queue.err","validation.stdout","validation.stderr"):
            raise ValueError("Select a bounded known log")
        p=r["cluster_snapshot"]
        source="""
import pathlib
d=pathlib.Path(p['root']).expanduser().resolve()/p['id'];f=(d/p['name']).resolve()
if d.resolve() not in f.parents:raise ValueError('Invalid log path')
text='';offset=0
if f.is_file():
 with open(f,'rb') as stream:
  stream.seek(max(0,int(p['offset'])));text=stream.read(262144).decode('utf8','replace');offset=stream.tell()
print('__STUDIO_JSON__'+json.dumps({'text':text,'offset':offset}))
"""
        return parse_output(self.transport(p).run(python_script(p,source,{"root":p["remote_root"],"id":r["id"],"name":name,"offset":offset})))


    def browse(self,project_id,cluster_id,relative="",root_index=0,offset=0):
        _,p=self.allowed(project_id,cluster_id)
        roots=[p["remote_root"],*p.get("read_roots",[])]
        if type(root_index) is not int or not 0<=root_index<len(roots):raise ValueError("Select a registered read root")
        if not isinstance(relative,str) or len(relative)>1024 or "\\x00" in relative or relative.startswith("/"):raise ValueError("Relative path required")
        source="""
import pathlib,base64,hashlib
root=pathlib.Path(p['root']).expanduser().resolve();target=(root/p['relative']).resolve()
if target!=root and root not in target.parents:raise ValueError('Outside read root')
out={'relative':p['relative'],'exists':target.exists()}
if target.is_dir():
 out['entries']=[{'name':f.name,'directory':f.is_dir(),'symlink':f.is_symlink(),'size':f.stat().st_size} for f in list(target.iterdir())[:500]]
elif target.is_file():
 size=target.stat().st_size
 with open(target,'rb') as stream:
  stream.seek(max(0,int(p['offset'])));content=stream.read(262144);position=stream.tell()
 out.update(size=size,offset=position,base64=base64.b64encode(content).decode())
 if p['offset']==0:
  h=hashlib.sha256()
  with open(target,'rb') as stream:
   for b in iter(lambda:stream.read(1048576),b''):h.update(b)
  out['sha256']=h.hexdigest()
print('__STUDIO_JSON__'+json.dumps(out))
"""
        return parse_output(self.transport(p).run(python_script({**p,"environment":{"executables":{"python":"python3"}}},source,{"root":roots[root_index],"relative":relative,"offset":offset})))

    def tick(self):
        if time.time()-self.last_poll<15:return
        self.last_poll=time.time()
        for r in self.store.list("cluster-run"):
            if r["status"] in ("queued","running","unknown"):self.poll(r["id"])
