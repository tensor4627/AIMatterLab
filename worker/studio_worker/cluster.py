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
import threading
import time
from pathlib import Path
from .adapters import Adapter, ENGINES
from .util import atomic_json, contained, digest, leaf

TOKEN = re.compile(r"^[A-Za-z0-9_.@:/+-]+$")
MARKER = "__STUDIO_JSON__"
TERMINAL = ("succeeded", "failed", "cancelled")

TRANSFER_CHUNK = 512 * 1024
TRANSFER_TOTAL = 128 * 1024 * 1024
TRANSFER_FILES = 128
# Names verified against the GPUMD/GPU-Sampling output contracts; other outputs
# remain explicitly selectable relative to this run, rather than globbed.
DEFAULT_COLLECT = (
    "console.log", "environment.json", "validation.json", "exit.json",
    "queue.out", "queue.err", "validation.stdout", "validation.stderr",
    "simulation/neb_energies.out", "simulation/final_traj.xyz", "simulation/interpolate.xyz",
    "simulation/peek_traj.xyz", "simulation/neb_fire_diagnostics.out", "simulation/neb_fire_imagewise.out",
    "simulation/thermo.out", "simulation/dump.xyz", "simulation/restart.xyz",
    "simulation/GASCVlog.txt", "simulation/GASGaussian.txt",
    "simulation/metrics.csv", "simulation/trajectory.extxyz", "simulation/checkpoint.json", "simulation/completion.json",
    "simulation/sampling-logs/GASCVlog.txt", "simulation/sampling-logs/GASCVsteps.txt", "simulation/sampling-logs/GASGaussian.txt",
    "simulation/OPES_COLVAR", "simulation/OPES_KERNELS", "simulation/OPES_STATE.pt",
)


def remote_source(value, allow_home=False):
    if (not isinstance(value, str) or not value or len(value) > 2048 or
            any(ord(c) < 32 or ord(c) == 127 for c in value) or "\\" in value or
            not (value.startswith("/") or (allow_home and value.startswith("~/"))) or
            any(part in (".", "..") for part in value.split("/"))):
        raise ValueError("Scoped absolute remote source path required")
    return value


def directory_prefix(value):
    if value is None:
        return ""
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", value):
        raise ValueError("Directory name must be a safe relative prefix")
    return value


# This small program is sent over the existing SSH control channel. No target
# installation is needed. Every open walks directory descriptors with NOFOLLOW,
# so both ordinary symlinks and parent replacement races fail closed.
TRANSFER_PROGRAM = r"""
import os,stat,pathlib,hashlib,base64
CHUNK=524288;TOTAL=134217728

def identity(st):
 return {k:int(getattr(st,k)) for k in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns')}

def absolute(value):
 if not isinstance(value,str) or not value or len(value)>2048 or '\\' in value or any(ord(c)<32 or ord(c)==127 for c in value) or any(x in ('.','..') for x in value.split('/')):raise ValueError('Invalid transfer path')
 value=os.path.expanduser(value)
 if not value.startswith('/'):raise ValueError('Absolute transfer path required')
 return pathlib.PurePosixPath(value)

def open_source(value):
 candidate=absolute(value);roots=[absolute(x) for x in p['roots']]
 root=next((r for r in roots if r in candidate.parents),None)
 if root is None:raise ValueError('Outside registered transfer roots')
 flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
 directory=os.open('/',flags)
 try:
  for component in root.parts[1:]:
   child=os.open(component,flags,dir_fd=directory);os.close(directory);directory=child
  parts=candidate.relative_to(root).parts
  for component in parts[:-1]:
   child=os.open(component,flags,dir_fd=directory);os.close(directory);directory=child
  fd=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory)
 finally:os.close(directory)
 try:
  if not stat.S_ISREG(os.fstat(fd).st_mode):raise ValueError('Regular transfer file required')
  return os.fdopen(fd,'rb')
 except Exception:
  os.close(fd);raise

def metadata(value):
 with open_source(value) as stream:
  before=identity(os.fstat(stream.fileno()));size=before['st_size']
  if size<0 or size>min(TOTAL,p.get('max_size',TOTAL)):raise ValueError('Transfer size exceeds bound')
  h=hashlib.sha256()
  count=0
  for block in iter(lambda:stream.read(CHUNK),b''):
   count+=len(block)
   if count>size:raise ValueError('Transfer source grew while hashing')
   h.update(block)
  after=identity(os.fstat(stream.fileno()))
  if before!=after:raise ValueError('Transfer source changed while hashing')
  return {'size':size,'sha256':h.hexdigest(),'identity':before}

op=p['op']
if op=='stat':out=metadata(p['path'])
elif op=='chunk':
 offset=p['offset'];length=p['length']
 if type(offset) is not int or offset<0 or type(length) is not int or not 1<=length<=CHUNK:raise ValueError('Invalid transfer chunk')
 with open_source(p['path']) as stream:
  before=identity(os.fstat(stream.fileno()))
  if before!=p['identity'] or offset+length>before['st_size']:raise ValueError('Transfer source identity changed')
  stream.seek(offset);block=stream.read(length);after=identity(os.fstat(stream.fileno()))
  if before!=after or len(block)!=length:raise ValueError('Interrupted or changed source')
 out={'offset':offset+len(block),'base64':base64.b64encode(block).decode(),'sha256':hashlib.sha256(block).hexdigest(),'identity':after}
elif op=='list':
 root=absolute(p['root']);names=p['names'];out={'files':[],'missing':[]};total=0
 if not isinstance(names,list) or len(names)>128 or len(set(names))!=len(names):raise ValueError('Bounded unique result names required')
 for name in names:
  if not isinstance(name,str) or not name or len(name)>240 or '\\' in name or ':' in name or name.startswith('/') or any(x in ('','.','..') for x in name.split('/')):raise ValueError('Invalid result name')
  try:meta=metadata(str(root/name))
  except FileNotFoundError:
   if not p.get('optional'):raise
   out['missing'].append(name);continue
  total+=meta['size']
  if total>TOTAL:raise ValueError('Result transfer total exceeds bound')
  out['files'].append({'name':name,**meta})
else:raise ValueError('Unsupported transfer operation')
print('__STUDIO_JSON__'+json.dumps(out))
"""


def word(value, name="value"):
    if not isinstance(value, str) or not value or len(value) > 256 or not TOKEN.fullmatch(value) or value.startswith("-"):
        raise ValueError("Invalid " + name)
    return value


def ssh_endpoint(value):
    legacy = value.get("target", "")
    if not isinstance(legacy, str):
        raise ValueError("Invalid SSH target")
    if legacy:word(legacy,"legacy SSH target")
    parts = legacy.strip().split("@")
    if len(parts)>2:raise ValueError("Invalid SSH target")
    host = value.get("host") or parts[-1]
    username = value.get("username", parts[0] if len(parts) == 2 else "")
    if not isinstance(host, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.:-]{0,255}", host):
        raise ValueError("Explicit SSH hostname required")
    if not isinstance(username, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]{0,63}", username):
        raise ValueError("Set an explicit SSH username; the local Windows user is never assumed")
    return host, username


def profile(value):
    p = dict(value)
    if p.get("scheduler") not in ("lsf", "slurm"):
        raise ValueError("Select LSF or Slurm")
    host, username = ssh_endpoint(p)
    p.update(host=host, username=username, target=username+"@"+host)
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
    if not isinstance(p.get("read_roots", []), list) or len(p.get("read_roots", [])) > 64:
        raise ValueError("Bounded explicit remote read roots required")
    for root in p.get("read_roots", []):
        remote_source(root, allow_home=True)
    if len(p.get("activation", "")) > 8192:
        raise ValueError("Activation script exceeds limit")
    e = p.setdefault("environment", {"executables": {"python": "/usr/bin/python3"}})
    for path in [*e.get("executables", {}).values(), *e.get("repositories", {}).values()]:
        if not isinstance(path, str) or not path.startswith("/") or "\n" in path or "\0" in path:
            raise ValueError("Remote environment paths must be absolute")
    if not e.get("executables", {}).get("python"):
        raise ValueError("Register target Python")
    for key,value in e.get("variables",{}).items():
        if key not in ("LD_LIBRARY_PATH","LIBRARY_PATH","OMP_NUM_THREADS","MKL_NUM_THREADS","OPENBLAS_NUM_THREADS","NUMEXPR_NUM_THREADS") or not isinstance(value,(str,int)) or "\\n" in str(value) or "\\x00" in str(value):
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
        host, username = ssh_endpoint(p)
        args = [p["ssh_client"], "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
                "-o", "ConnectTimeout=12", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2"]
        if p.get("identity_file"):
            args += ["-i", p["identity_file"]]
        args += ["-l", username, "-p", str(p["port"])]
        remote = "bash -lc " + shlex.quote(script)
        for hop in reversed(p.get("via", [])):
            remote = "ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes " + shlex.quote(hop) + " " + shlex.quote(remote)
        args += [host, remote]
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
        runtime = "pydyn" if self.engine=="pydyn.sampling" else "pygas"
        repo = environment.get("repositories", {}).get(runtime)
        if not repo:
            raise ValueError("Register target pyGAS repository")
        return [self.executable(environment, "python"), repo + "/agents/skills/pygas-check-gpumd-contract/scripts/validate_model.py",
                p["bias_file"], p["structure_file"]]


class Clusters:
    def __init__(self, service, transport=SSH):
        self.service, self.store, self.transport = service, service.store, transport
        self.last_poll = 0
        self.prepare_lock = threading.RLock()

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

    def test_connection(self, value):
        p = profile(value)
        observed = self.transport(p).run("id -un", timeout=25).strip().splitlines()
        if not observed or observed[-1] != p["username"]:
            raise ConnectionError("Remote username differs; check the explicit SSH username")
        return {"status":"passed","username_matches":True,"scope":"SSH authentication only; no files changed or jobs submitted"}

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

    def _transfer(self, p, payload):
        output = self.transport(p).run(python_script(p, TRANSFER_PROGRAM, payload), timeout=60)
        if not isinstance(output, str) or len(output.encode("utf8")) >= 4 * 1024 * 1024:
            raise ValueError("Transfer response exceeds bound")
        result = parse_output(output)
        if not isinstance(result, dict):
            raise ValueError("Invalid transfer receipt")
        return result

    @staticmethod
    def _metadata(value, budget=TRANSFER_TOTAL):
        if (not isinstance(value, dict) or type(value.get("size")) is not int or
                not 0 <= value["size"] <= budget or not isinstance(value.get("sha256"), str) or
                not re.fullmatch(r"[0-9a-f]{64}", value["sha256"])):
            raise ValueError("Invalid or oversized transfer metadata")
        identity = value.get("identity")
        if (not isinstance(identity, dict) or set(identity) != {"st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns"} or
                any(type(v) is not int for v in identity.values()) or identity["st_size"] != value["size"]):
            raise ValueError("Invalid transfer source identity")
        return {k: value[k] for k in ("size", "sha256", "identity")}

    def _download(self, p, source, roots, target, budget, expected=None):
        payload = {"path":source, "roots":roots, "max_size":budget}
        metadata = self._metadata(self._transfer(p, {**payload, "op":"stat"}), budget)
        if expected is not None and metadata != self._metadata(expected, budget):
            raise ValueError("Remote transfer source changed")
        target = Path(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        created = False
        try:
            h, offset = hashlib.sha256(), 0
            with open(target, "xb") as stream:
                created = True
                while offset < metadata["size"]:
                    length = min(TRANSFER_CHUNK, metadata["size"] - offset)
                    chunk = self._transfer(p, {**payload, "op":"chunk", "offset":offset,
                                              "length":length, "identity":metadata["identity"]})
                    try:
                        content = base64.b64decode(chunk.get("base64", ""), validate=True)
                    except Exception:
                        raise ValueError("Invalid transfer chunk encoding") from None
                    if (len(content) != length or chunk.get("offset") != offset + length or
                            chunk.get("identity") != metadata["identity"] or
                            chunk.get("sha256") != hashlib.sha256(content).hexdigest()):
                        raise ValueError("Interrupted or corrupt transfer chunk")
                    stream.write(content); h.update(content); offset += len(content)
            if h.hexdigest() != metadata["sha256"] or target.stat().st_size != metadata["size"] or digest(target) != metadata["sha256"]:
                raise ValueError("Local transfer hash differs from remote source")
            final = self._metadata(self._transfer(p, {**payload, "op":"stat"}), budget)
            if final != metadata:
                raise ValueError("Remote transfer source changed during download")
            return metadata
        except Exception:
            if created:
                target.unlink(missing_ok=True)
            raise

    @staticmethod
    def remote_name(run):
        root = run["cluster_snapshot"]["remote_root"].rstrip("/")
        name = run["remote_directory"][len(root) + 1:] if run["remote_directory"].startswith(root + "/") else ""
        if not name or "/" in name or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", name):
            raise ValueError("Recorded remote run directory is outside its registered root")
        expected = (directory_prefix(run.get("directory_name")) + "-" if run.get("directory_name") else "") + run["id"]
        if name != expected:
            raise ValueError("Recorded remote run identity does not match its directory")
        return name

    def prepare(self, spec):
        # A retry arriving during a transfer must reuse the completed draft,
        # rather than allocate a second immutable snapshot for the same key.
        with self.prepare_lock:
            return self._prepare(spec)

    def _prepare(self, spec):
        spec = dict(spec)
        local_inputs = spec.get("inputs", {})
        remote_inputs = spec.get("remote_inputs", {})
        if not isinstance(local_inputs, dict) or not isinstance(remote_inputs, dict):
            raise ValueError("Input mappings are required")
        local_inputs, remote_inputs = dict(local_inputs), dict(remote_inputs)
        if len(local_inputs) + len(remote_inputs) > TRANSFER_FILES:
            raise ValueError("Input file count exceeds bound")
        if set(local_inputs) & set(remote_inputs):
            raise ValueError("Local and remote inputs cannot use the same run filename")
        for name in (*local_inputs, *remote_inputs):
            self.service.input_name(name)
        for source in remote_inputs.values():
            remote_source(source)
        prefix = directory_prefix(spec.get("directory_name"))
        spec["inputs"], spec["remote_inputs"] = local_inputs, remote_inputs
        project, p = self.allowed(spec["project_id"], spec["cluster_id"])
        if remote_inputs and not p.get("read_roots"):
            raise PermissionError("Register explicit remote read roots before importing inputs")
        if spec["engine"] not in project["policy"]["engines"] or spec["engine"] not in ENGINES:
            raise PermissionError("Engine is not authorized")
        if type(spec.get("max_seconds")) is not int:
            raise ValueError("Integer wall-clock limit required")
        if not 0 < spec["max_seconds"] <= project["policy"]["max_seconds"]:
            raise PermissionError("Duration exceeds project authorization")
        key = spec["idempotency_key"]
        if not isinstance(key, str) or not 1 <= len(key) <= 128:
            raise ValueError("Bounded idempotency key required")
        fingerprint = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()
        previous = next((r for r in self.store.list("cluster-run") if r["project_id"] == spec["project_id"] and r["idempotency_key"] == key), None)
        if previous:
            if previous["request_hash"] != fingerprint:
                raise ValueError("Idempotency conflict")
            return self.run(previous["id"])
        r = resources(spec.get("resources", {}), p, spec["max_seconds"])
        if (spec["engine"].endswith("sampling") or spec["engine"] == "bias.validate") and r["gpus"] < 1:
            raise ValueError("Bias target validation requires a GPU allocation")
        # Adapter and compute-node gates must see the complete run filename map.
        spec["inputs"] = {**local_inputs, **remote_inputs}
        command = PlanningAdapter(spec["engine"]).prepare(spec, p["environment"])
        roots = project["policy"]["input_roots"] + [str(self.service.root/"projects"/project["id"]/"inputs")]
        parent = None
        if spec.get("revision_of"):
            parent = self.raw(spec["revision_of"])
            if parent["project_id"] != project["id"] or parent["status"] not in ("draft", "ready"):
                raise PermissionError("Only an unsubmitted run in the same project may be revised")
            roots.append(parent["directory"])
        identifier = secrets.token_hex(12)
        directory = self.service.root / "cluster-runs" / identifier
        (directory/"simulation").mkdir(parents=True)
        snapshots, total = [], 0
        try:
            for name, src in local_inputs.items():
                source = contained(src, roots)
                if not source.is_file():
                    raise ValueError("Input unavailable")
                size = source.stat().st_size
                if size > TRANSFER_TOTAL - total:
                    raise ValueError("Input total exceeds transfer bound")
                before = digest(source)
                dst = directory/"simulation"/name
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, dst)
                if dst.stat().st_size != size or digest(dst) != before or source.stat().st_size != size or digest(source) != before:
                    raise ValueError("Local input changed while creating snapshot")
                dst.chmod(0o444)
                total += size
                snapshots.append({"name":name, "source":str(source), "source_kind":"local", "sha256":before, "size":size})
            for name, source in remote_inputs.items():
                dst = directory/"simulation"/name
                meta = self._download(p, source, p["read_roots"], dst, TRANSFER_TOTAL-total)
                dst.chmod(0o444); total += meta["size"]
                snapshots.append({"name":name, "source":source, "source_kind":"remote", "cluster_id":p["id"],
                                  "sha256":meta["sha256"], "size":meta["size"], "remote_identity":meta["identity"]})
            run = {**spec, "id":identifier, "kind":"cluster-run", "name":spec.get("name",spec["engine"]),
                   "request_hash":fingerprint, "directory":str(directory), "snapshots":snapshots, "command":command,
                   "local_inputs":local_inputs, "resources":r, "cluster_snapshot":p, "status":"draft", "validation":{"status":"not_run"},
                   "scientific_validation":{"status":"not_run"}, "nonce":secrets.token_hex(16),
                   "remote_directory":p["remote_root"].rstrip("/")+"/"+(prefix+"-" if prefix else "")+identifier,
                   "job_name":"gss-"+identifier, "job_id":None, "created_at":time.time(), "updated_at":time.time()}
            self.remote_name(run)
            run["script"] = batch_script(run)
            atomic_json(directory/"run.json", run)
            self.store.put("cluster-run", run)
            if parent:
                self.save(parent, superseded_by=identifier)
            return self.run(identifier)
        except Exception:
            shutil.rmtree(directory)
            raise

    def input_file(self, identifier, name):
        run = self.raw(identifier)
        self.allowed(run["project_id"], run["cluster_id"])
        self.service.input_name(name)
        asset = next((a for a in run["snapshots"] if a["name"] == name), None)
        if asset is None:
            raise ValueError("Select an input recorded in this run snapshot")
        root = Path(run["directory"])/"simulation"
        file = contained(root/name, [root])
        if (root/name).is_symlink() or not file.is_file() or digest(file) != asset["sha256"] or file.stat().st_size != asset["size"]:
            raise ValueError("Immutable input snapshot changed")
        result = {"name":name, "editable":False, "sha256":asset["sha256"], "size":asset["size"], "source_kind":asset.get("source_kind", "local")}
        if asset["size"] > 2*1024*1024:
            return {**result, "preview_available":False, "reason":"Input exceeds the 2 MiB text preview bound"}
        with open(file, "rb") as stream:
            data = stream.read(2*1024*1024+1)
        if len(data) != asset["size"] or hashlib.sha256(data).hexdigest() != asset["sha256"]:
            raise ValueError("Immutable input snapshot changed during preview")
        try:
            if file.suffix.lower() in (".pt", ".pt2", ".pth", ".npy", ".npz", ".so", ".bin"):
                raise UnicodeError("binary artifact")
            text = data.decode("utf8")
            if b"\0" in data:
                raise UnicodeError("binary")
        except UnicodeError:
            return {**result, "preview_available":False, "binary":True, "reason":"Binary input has no text preview"}
        return {**result, "preview_available":True, "binary":False, "text":text}

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
        allowed=("name","engine","max_seconds","resources","inputs","remote_inputs","directory_name","parameters")
        if any(k not in allowed for k in changes):raise ValueError("Unsupported revision field")
        spec={k:parent[k] for k in ("project_id","cluster_id",*allowed) if k in parent}
        spec["inputs"] = dict(parent.get("local_inputs", {k:v for k,v in parent["inputs"].items() if k not in parent.get("remote_inputs", {})}))
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
 print('Studio validation: environment probe started',file=sys.stderr,flush=True)
 observed=Adapter(r['engine']).probe(environment)
 print('Studio validation: environment probe finished',file=sys.stderr,flush=True)
 atomic_json('environment.json',observed)
 Adapter(r['engine']).prepare(r,environment)
 report=Adapter(r['engine']).validate(r,environment,Path('simulation').resolve(),probe_report=observed)
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
            for name in ["__init__.py","adapters.py","util.py","scientific.py","science_checks.py","derivatives.py","neb_checks.py", "structure_tools.py"]:
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
d=root/p.get('directory',p['id'])
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
            result=parse_output(self.transport(p).run(python_script(p,source,{"root":p["remote_root"],"id":r["id"],"directory":self.remote_name(r),"nonce":r["nonce"],"scheduler":p["scheduler"]}),data=self.archive(r),timeout=90))
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
d=pathlib.Path(p['root']).expanduser().resolve()/p.get('directory',p['id']);out={'job_id':p.get('job_id'),'state':'unknown'}
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
            result=parse_output(self.transport(p).run(python_script(p,source,{"root":p["remote_root"],"id":r["id"],"directory":self.remote_name(r),"nonce":r["nonce"],"job_id":r["job_id"],"scheduler":p["scheduler"],"name":r["job_name"]})))
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
d=pathlib.Path(p['root']).expanduser().resolve()/p.get('directory',p['id']);f=(d/p['name']).resolve()
if d.resolve() not in f.parents:raise ValueError('Invalid log path')
text='';offset=0
if f.is_file():
 with open(f,'rb') as stream:
  stream.seek(max(0,int(p['offset'])));text=stream.read(262144).decode('utf8','replace');offset=stream.tell()
print('__STUDIO_JSON__'+json.dumps({'text':text,'offset':offset}))
"""
        return parse_output(self.transport(p).run(python_script(p,source,{"root":p["remote_root"],"id":r["id"],"directory":self.remote_name(r),"name":name,"offset":offset})))


    @staticmethod
    def _local_directory(path, root):
        path, root = Path(path), Path(root).resolve()
        if path.is_symlink() or path.resolve() != path or root not in path.parents:
            raise ValueError("Local collection path is outside this run")
        return path

    def collect(self, identifier, names=None):
        """Recover bounded terminal-run files; this never submits or runs a job."""
        run = self.raw(identifier)
        self.allowed(run["project_id"], run["cluster_id"])
        if run["status"] not in TERMINAL:
            raise ValueError("Only terminal cluster runs may be collected")
        self.remote_name(run)
        optional = names is None
        names = list(DEFAULT_COLLECT) if names is None else names
        if not isinstance(names, list) or not names or len(names) > TRANSFER_FILES or any(not isinstance(name, str) for name in names) or len(set(names)) != len(names):
            raise ValueError("Select bounded unique result filenames")
        for name in names:
            self.service.input_name(name)
            if name.split("/")[0] in (".studio", "collection.json") or name.startswith(".submission-") or name == ".submit-attempt":
                raise ValueError("Internal control files are not result artifacts")
        names = sorted(names)
        p, remote = run["cluster_snapshot"], run["remote_directory"]
        manifest = self._transfer(p, {"op":"list", "root":remote, "roots":[remote], "names":names, "optional":optional, "max_size":TRANSFER_TOTAL})
        if not isinstance(manifest.get("files"), list) or not isinstance(manifest.get("missing"), list):
            raise ValueError("Invalid result manifest")
        observed, total = {}, 0
        for item in manifest["files"]:
            name = item.get("name") if isinstance(item, dict) else None
            if name not in names or name in observed:
                raise ValueError("Unexpected or duplicate result filename")
            meta = self._metadata(item, TRANSFER_TOTAL-total)
            observed[name] = meta; total += meta["size"]
        missing = manifest["missing"]
        if len(set(missing)) != len(missing) or set(observed) & set(missing) or set(observed) | set(missing) != set(names) or (missing and not optional):
            raise ValueError("Incomplete result manifest")
        if not observed:
            raise ValueError("No requested result artifacts exist")
        directory = self._local_directory(run["directory"], self.service.root/"cluster-runs")
        if directory != self.service.root/"cluster-runs"/run["id"]:
            raise ValueError("Local run directory identity differs")
        staging = directory/(".collect-"+secrets.token_hex(12))
        staging.mkdir()
        try:
            for name, meta in observed.items():
                self._download(p, remote.rstrip("/")+"/"+name, [remote], staging/name, TRANSFER_TOTAL, expected=meta)
            fingerprint = hashlib.sha256(json.dumps({"run_id":run["id"], "requested":names, "missing":missing, "files":[{"name":name, "size":meta["size"], "sha256":meta["sha256"]} for name, meta in sorted(observed.items())]}, sort_keys=True).encode()).hexdigest()
            collection_id = fingerprint[:24]
            with self.store.lock:
                latest = self.raw(identifier)
                self.allowed(latest["project_id"], latest["cluster_id"])
                if latest["status"] not in TERMINAL:
                    raise ValueError("Run is no longer terminal")
                results = directory/"results"
                self._local_directory(results, directory)
                results.mkdir(exist_ok=True)
                destination = results/collection_id
                self._local_directory(destination, results)
                existing = {a["id"]:a for a in self.store.list("artifact")}
                artifacts, files = [], []
                for name, meta in sorted(observed.items()):
                    asset_id = hashlib.sha256(("cluster-result:"+run["id"]+":"+name).encode()).hexdigest()[:24]
                    old = existing.get(asset_id)
                    if old:
                        if old.get("run_id") != run["id"] or old.get("sha256") != meta["sha256"] or old.get("size") != meta["size"]:
                            raise ValueError("Collected artifact content conflicts with its recorded identity")
                        file = self._local_directory(old["path"], results)
                        if not file.is_file() or file.stat().st_size != meta["size"] or digest(file) != meta["sha256"]:
                            raise ValueError("Existing local result changed; refusing to overwrite")
                        artifact = old
                    else:
                        artifact = {"id":asset_id, "project_id":run["project_id"], "run_id":run["id"], "name":name,
                                    "path":str(destination/name), "kind":"cluster-result", "sha256":meta["sha256"], "size":meta["size"],
                                    "metadata":{"source":{"kind":"cluster-run", "run_id":run["id"], "cluster_id":run["cluster_id"],
                                                          "remote_name":name, "remote_sha256":meta["sha256"]},
                                                "scientific_validation":run.get("scientific_validation", {"status":"not_run"})}}
                    artifacts.append(artifact)
                    files.append({"name":name, "size":meta["size"], "sha256":meta["sha256"], "artifact_id":asset_id})
                previous = next((m for m in self.store.list("cluster-collection") if m["id"] == collection_id), None)
                record = previous or {"id":collection_id, "run_id":run["id"], "project_id":run["project_id"], "cluster_id":run["cluster_id"],
                                      "files":files, "missing":missing, "created_at":time.time(), "transfer_status":"passed", "scope":"hash-verified file retrieval only"}
                atomic_json(staging/"collection.json", record)
                if destination.exists():
                    for name, meta in observed.items():
                        file = self._local_directory(destination/name, destination)
                        if not file.is_file() or file.stat().st_size != meta["size"] or digest(file) != meta["sha256"]:
                            raise ValueError("Existing collection differs; refusing to overwrite")
                    if not (destination/"collection.json").is_file() or json.loads((destination/"collection.json").read_text("utf8")) != record:
                        raise ValueError("Existing collection manifest differs")
                    shutil.rmtree(staging)
                else:
                    os.rename(staging, destination)
                for artifact in artifacts:
                    self.store.put("artifact", artifact)
                self.store.put("cluster-collection", record)
                self.save(latest, collection_ids=sorted(set(latest.get("collection_ids", [])) | {collection_id}))
                return {"run":identifier, "manifest":record, "files":artifacts, "artifacts":artifacts}
        finally:
            if staging.exists():
                shutil.rmtree(staging)

    def result_file(self, identifier, name):
        run=self.raw(identifier);self.allowed(run["project_id"],run["cluster_id"])
        assets=[a for a in self.store.list("artifact") if a.get("run_id")==identifier and a.get("kind")=="cluster-result" and a["name"]==name]
        if not assets:raise ValueError("Collect the selected recorded result first")
        asset=assets[0];root=Path(run["directory"])/"results";target=contained(asset["path"],[root])
        if not target.is_file() or target.is_symlink() or digest(target)!=asset["sha256"]:raise ValueError("Collected result changed")
        result={"name":name,"size":asset["size"],"sha256":asset["sha256"],"artifact_id":asset["id"]}
        if asset["size"]>2*1024*1024:return {**result,"preview_available":False,"reason":"Result exceeds text preview bound"}
        data=target.read_bytes()
        if hashlib.sha256(data).hexdigest()!=asset["sha256"]:raise ValueError("Collected result changed while reading")
        try:
            if b"\0" in data:raise UnicodeError()
            text=data.decode("utf8")
        except UnicodeError:return {**result,"preview_available":False,"binary":True}
        return {**result,"preview_available":True,"text":text}

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
