from studio_worker.infrastructure.remote_resources import validation_resources
"""SSH scheduler control; local worker owns records, schedulers own remote processes."""
import base64
import copy
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
from studio_worker.tools.adapters import Adapter, ENGINES, SUPPORTED_ENGINES
from studio_worker.infrastructure.util import atomic_json, contained, digest, leaf
from studio_worker.workspace.private_lineage import current_rows
from studio_worker.compute.bound_cluster import COMPUTE_CHECK, bound_batch_body, confinement_source, invocation, job_root, private_engine
from studio_worker.compute.run_rejection import run_preflight


def private_copy_rows(rows, local_paths, runs, root):
    """Rows whose owned project/run directories or exact paths this run selects."""
    selected = []
    for row in rows:
        own = Path(root) / 'projects' / str(row['project_id']) / 'inputs'
        directories = [own, *[Path(run['directory']) for run in runs if run['project_id'] == row['project_id']]]
        exact = {Path(value).resolve() for value in row.get('paths', [])}
        if any(source in exact or any(source == base or base in source.parents for base in directories)
               for source in local_paths):
            selected.append(row)
    return selected

TOKEN = re.compile(r"^[A-Za-z0-9_.@:/+-]+$")
LSF_QUEUE_TOKEN = re.compile(r"^[A-Za-z0-9_.@:/+!-]+$")
MARKER = "__STUDIO_JSON__"
TERMINAL = ("succeeded", "failed", "cancelled")
_SUBMISSION_REPLY_UNAVAILABLE = "Submission reply unavailable; reconcile only, never resubmit"

TRANSFER_CHUNK = 2 * 1024 * 1024
TRANSFER_TOTAL = 128 * 1024 * 1024
TRANSFER_FILES = 128
# Names verified against the GPUMD/GPU-Sampling output contracts; other outputs
# remain explicitly selectable relative to this run, rather than globbed.
DEFAULT_COLLECT = (
    "console.log", "environment.json", "validation.json", "execution-check.json", "exit.json",
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
CHUNK=2097152;TOTAL=134217728

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


def queue_word(value, scheduler, name="queue"):
    # Literal LSF queue identifiers can contain !. Do not widen account,
    # host, job-name or general path tokens, or strip an observed identifier.
    if scheduler != "lsf":
        return word(value, name)
    if not isinstance(value, str) or not value or len(value) > 256 or not LSF_QUEUE_TOKEN.fullmatch(value) or value.startswith("-"):
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


def target_limits(value):
    if not isinstance(value, dict) or set(value) != {"cpus", "gpus", "memory_mb", "max_seconds"}:
        raise ValueError("Queue target limits require cpus, gpus, memory_mb and max_seconds")
    for key in value:
        if type(value[key]) is not int or value[key] < (0 if key == "gpus" else 1):
            raise ValueError("Invalid queue target limit: " + key)
    return dict(value)


def target_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", value):
        raise ValueError("Invalid queue target ID")
    return value


def environment(value):
    if not isinstance(value, dict) or not isinstance(value.get("executables"), dict):
        raise ValueError("Register target environment executables")
    e = copy.deepcopy(value)
    for key in ("executables", "repositories", "variables"):
        if not isinstance(e.get(key, {}), dict):
            raise ValueError("Invalid target environment " + key)
    for path in [*e["executables"].values(), *e.get("repositories", {}).values()]:
        if not isinstance(path, str) or not path.startswith("/") or "\n" in path or "\0" in path:
            raise ValueError("Remote environment paths must be absolute")
    if not e["executables"].get("python"):
        raise ValueError("Register target Python")
    for key, value in e.get("variables", {}).items():
        if key not in ("LD_LIBRARY_PATH", "LIBRARY_PATH", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS") or not isinstance(value, (str, int)) or any(c in str(value) for c in ("\n", "\0", "\\n", "\\x00")):
            raise ValueError("Unsupported target loader variable")
    return e


def queue_targets(value, cluster_limits, scheduler=None):
    if not isinstance(value, list) or len(value) > 64:
        raise ValueError("Bounded explicit queue targets required")
    result, seen = [], set()
    for item in value:
        fields = {"id", "queue", "usage_class", "enabled", "engines", "environment", "activation", "limits", "account"}
        if not isinstance(item, dict) or set(item) - fields:
            raise ValueError("Unsupported queue target field")
        target = copy.deepcopy(item)
        identifier = target_id(target.get("id"))
        if identifier in seen:
            raise ValueError("Duplicate queue target ID")
        seen.add(identifier)
        queue_word(target.get("queue"), scheduler, "queue target queue")
        if target.get("usage_class") not in ("owned", "paid", "unknown") or type(target.get("enabled")) is not bool:
            raise ValueError("Explicit queue target usage class and enabled flag required")
        engines = target.get("engines")
        if not isinstance(engines, list) or not engines or any(engine not in SUPPORTED_ENGINES and not private_engine(engine) for engine in engines) or len(engines) != len(set(engines)):
            raise ValueError("Explicit supported queue target engines required")
        target["environment"] = environment(target.get("environment"))
        if not isinstance(target.get("activation"), str) or len(target["activation"]) > 8192 or "\0" in target["activation"]:
            raise ValueError("Explicit bounded queue target activation required")
        target["limits"] = target_limits(target.get("limits"))
        if any(target["limits"][key] > cluster_limits[key] for key in ("cpus", "gpus", "memory_mb")):
            raise ValueError("Queue target limits exceed cluster limits")
        if "account" in target:
            word(target["account"], "queue target scheduler account")
        result.append(target)
    return result


def queue_policy(value):
    fields = {"profile_version", "allowed_target_ids", "new_submission_order", "paid"}
    if not isinstance(value, dict) or set(value) - fields or type(value.get("profile_version")) is not int or value["profile_version"] < 1:
        raise ValueError("Explicit queue policy profile version required")
    policy = copy.deepcopy(value)
    for key in ("allowed_target_ids", "new_submission_order"):
        ids = policy.get(key)
        if not isinstance(ids, list) or len(ids) > 64 or any(not isinstance(identifier, str) for identifier in ids) or len(ids) != len(set(ids)):
            raise ValueError("Bounded unique queue policy target IDs required")
        for identifier in ids:
            target_id(identifier)
    if set(policy["allowed_target_ids"]) != set(policy["new_submission_order"]):
        raise ValueError("Queue policy order must contain exactly the allowed targets")
    paid = policy.get("paid", {})
    if not isinstance(paid, dict) or set(paid) - {"permitted", "conditions_known", "conditions", "limits"}:
        raise ValueError("Invalid paid queue policy")
    for flag in ("permitted", "conditions_known"):
        if flag in paid and type(paid[flag]) is not bool:
            raise ValueError("Explicit paid queue policy flags required")
    if "conditions" in paid and (not isinstance(paid["conditions"], str) or len(paid["conditions"]) > 2048 or "\0" in paid["conditions"]):
        raise ValueError("Bounded paid queue conditions required")
    if "limits" in paid:
        target_limits(paid["limits"])
    if paid.get("permitted") and (paid.get("conditions_known") is not True or not paid.get("conditions", "").strip() or "limits" not in paid):
        raise ValueError("Paid queues require known reviewed conditions and explicit limits")
    return policy


def policy_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def profile(value):
    p = dict(value)
    if isinstance(p.get("import_review"), dict) and p["import_review"].get("requires_review") is True:
        raise ValueError("Imported connection requires human review of its native route or authentication references")
    if p.get("scheduler") not in ("lsf", "slurm"):
        raise ValueError("Select LSF or Slurm")
    host, username = ssh_endpoint(p)
    p.update(host=host, username=username, target=username+"@"+host)
    port = p.get("port", 22)
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("Invalid SSH port")
    p["port"] = port
    p.setdefault('auth_mode', 'key')
    if p['auth_mode'] not in ('key', 'interactive'):
        raise ValueError('Select key/agent or private human authentication')
    for field in ('via', 'proxy_jump'):
        if not isinstance(p.get(field, []), list) or len(p.get(field, [])) > 8:
            raise ValueError('Bounded explicit SSH route required')
    if p['auth_mode'] == 'interactive' and p.get('via'):
        raise ValueError('Private human authentication does not support legacy remote via; review migration explicitly')
    if p['auth_mode'] == 'interactive':
        from studio_worker.compute.ssh_auth import reviewed_jumps, AuthError
        try:
            reviewed_jumps(p)
        except AuthError:
            raise ValueError('Controlled ProxyJump requires explicit user@host:port for every hop') from None
    else:
        # Legacy key/config aliases retain their existing grammar. Controlled
        # routes use reviewed_jumps directly, including complete bracketed IPv6.
        for hop in p.get('proxy_jump', []):
            if not isinstance(hop, str) or not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,255}', hop):
                raise ValueError('Invalid local ProxyJump hop')
    if p.get('identity_file') and (not isinstance(p['identity_file'], str) or any(c in p['identity_file'] for c in ('\n', '\r', '\0'))):
        raise ValueError('Invalid identity reference')
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
    if not isinstance(p.get("activation", ""), str) or len(p.get("activation", "")) > 8192 or "\0" in p.get("activation", ""):
        raise ValueError("Activation script exceeds limit")
    p["environment"] = environment(p.get("environment", {"executables": {"python": "/usr/bin/python3"}}))
    p.setdefault("lsf_memory_scope","per_slot")
    if p["lsf_memory_scope"] not in ("per_slot","per_job"):raise ValueError("Confirm LSF memory reservation semantics")
    p.setdefault("name", "SSH cluster")
    p.setdefault("limits", {"cpus": 64, "gpus": 8, "memory_mb": 262144})
    for k in ("cpus", "gpus", "memory_mb"):
        if type(p["limits"].get(k)) is not int or p["limits"][k] < 0:
            raise ValueError("Explicit resource limits required")
    if "queue_targets" in p:
        p["queue_targets"] = queue_targets(p["queue_targets"], p["limits"], p["scheduler"])
    return p


def public(p):
    value={k: p.get(k) for k in ("id", "name", "scheduler", "version", "queue", "environment", "limits", "activation", "probe", "lsf_memory_scope", "auth_mode")}
    if p.get('transport_kind') == 'ssh-service-local':
        value['transport_kind'] = 'ssh-service-local'
    if "queue_targets" in p:
        value["queue_targets"] = copy.deepcopy(p["queue_targets"])
    health=dict(p.get('connection_check') or {'status':'not_run','scope':'Connection has not been checked in this version'})
    if health.get('observed_at') and (health.get('version')!=p.get('version') or time.time()-health['observed_at']>900):health['status']='stale'
    value['connection_check']=health
    return value


class SSH:
    def __init__(self, p, auth=None):
        self.p, self.auth = p, auth

    def _key_args(self, script):
        """The same legacy key/agent/client route for both command paths."""
        p = self.p
        host, username = ssh_endpoint(p)
        args = [p["ssh_client"], "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
                "-o", "ConnectTimeout=12", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2"]
        if p.get('proxy_jump'):
            args += ['-J', ','.join(p['proxy_jump'])]
        if p.get("identity_file"):
            args += ["-i", p["identity_file"]]
        args += ["-l", username, "-p", str(p["port"])]
        remote = "bash -lc " + shlex.quote(script)
        for hop in reversed(p.get("via", [])):
            remote = "ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes " + shlex.quote(hop) + " " + shlex.quote(remote)
        args += [host, remote]
        return args

    def original_key_identity(self):
        """Bound this new read-only check during collection, including stderr."""
        from studio_worker.tools.source_git_identity import _bounded_process, SourceGitError
        try:
            result = _bounded_process(self._key_args('id -un'), env=None, timeout=25,
                                      stdout_limit=8192, stderr_limit=8192)
            if result.returncode:
                raise ConnectionError('Original SSH user check failed')
            return result.stdout
        except (OSError, subprocess.TimeoutExpired, SourceGitError):
            raise ConnectionError('Original SSH user check failed') from None

    def run(self, script, data=None, timeout=40):
        p = self.p
        if p.get('auth_mode', 'key') == 'interactive':
            if not self.auth:
                raise ConnectionError('needs_human_auth')
            return self.auth.execute(p, script, data=data, timeout=timeout)
        args = self._key_args(script)
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
    queue_word(r["queue"], p["scheduler"])
    if r.get("account"):
        word(r["account"], "scheduler account")
    if "qos" in r:
        if p["scheduler"] != "slurm" or not isinstance(r["qos"], str) or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", r["qos"]):
            raise ValueError("Invalid Slurm quality of service")
    r["seconds"] = int(seconds)
    return r


def scheduler_headers(run):
    p, r = run["cluster_snapshot"], run["resources"]
    name = run["job_name"]
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
        if r.get("qos"):
            header.append("#SBATCH --qos=" + r["qos"])
    else:
        header += [f"#BSUB -J {name}", f"#BSUB -q {r['queue']}", f"#BSUB -n {r['cpus']}",
                   f"#BSUB -W {math.ceil(r['seconds']/60)}", f"#BSUB -M {r['memory_mb']}MB",
                   f"#BSUB -R \"rusage[mem={math.ceil(r['memory_mb']/r['cpus']) if p.get('lsf_memory_scope','per_slot')=='per_slot' else r['memory_mb']}] span[hosts=1]\"", "#BSUB -o queue.out", "#BSUB -e queue.err", "#BSUB -env none"]
        if r["gpus"]:
            header.append(f'#BSUB -gpu "num={r["gpus"]}"')
        if r.get("account"):
            header.append("#BSUB -P " + r["account"])
    return header


def batch_script(run):
    p, r = run["cluster_snapshot"], run["resources"]
    remote = run["remote_directory"]
    header = scheduler_headers(run)
    python = shlex.quote(p["environment"]["executables"]["python"])

    remote_path='"$HOME"/'+shlex.quote(remote[2:]) if remote.startswith("~/") else shlex.quote(remote)
    receipt="import json,os,sys;json.dump({'nonce':"+repr(run["nonce"])+",'exit_code':int(sys.argv[1])},open('exit.tmp','w'));os.replace('exit.tmp','exit.json')"
    exports=["export "+key+"="+shlex.quote(str(value)) for key,value in p["environment"].get("variables",{}).items()]
    paths=list(p["environment"].get("repositories",{}).values())
    if paths:exports.append("export PYTHONPATH="+shlex.quote(":".join(paths))+':'+chr(36)+'{PYTHONPATH:-}')
    if run.get('bound_invocation'):
        return "\n".join(header + bound_batch_body(run, python, remote_path, exports, receipt)) + "\n"
    activation = (run.get('bound_invocation') or {}).get('activation')
    body=["set -u",'if [ "'+chr(36)+'{CUDA_VISIBLE_DEVICES+x}" = x ]; then _STUDIO_ASSIGNED_CUDA='+chr(36)+'CUDA_VISIBLE_DEVICES; _STUDIO_HAS_CUDA=1; fi',p.get("activation",""),activation or "",
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
    def __init__(self, service, transport=None):
        self.service, self.store = service, service.store
        self._auth, self._tunnels = None, None
        self.transport = transport or self._transport
        self.last_poll = 0
        self._next_poll = {}
        self._unknown_backoff = {}
        self._cancelling = set()
        self.prepare_lock = threading.RLock()
        self._private_init_lock = threading.RLock()

    @property
    def auth(self):
        with self._private_init_lock:
            if self._auth is None:
                from studio_worker.compute.ssh_auth import SSHAuth
                self._auth = SSHAuth(self.service)
        return self._auth

    @property
    def tunnels(self):
        with self._private_init_lock:
            if self._tunnels is None:
                from studio_worker.compute.ssh_tunnel import SSHTunnels
                self._tunnels = SSHTunnels(self.auth)
        return self._tunnels

    def _transport(self, p):
        if p.get('transport_kind') == 'ssh-service-local':
            from studio_worker.compute.ssh_service import SameHostTransport
            return SameHostTransport(self.service, p)
        # The immutable run snapshot reaches this factory unchanged. Never look up
        # a newer profile by id to resolve authentication for an old job.
        return SSH(p, self.auth if p.get('auth_mode', 'key') == 'interactive' else None)

    def close(self):
        if self._tunnels is not None:
            self._tunnels.close_all()
        if self._auth is not None:
            self._auth.close()

    def register(self, value):
        with self.store.lock:
            return self._register(value)

    def _register(self, value):
        if value.get('transport_kind') == 'ssh-service-local':
            from studio_worker.compute.ssh_service import assert_binding
            assert_binding(self.service, value)
        p = profile(value)
        p.setdefault("id", secrets.token_hex(10))
        leaf(p["id"])
        previous = next((x for x in self.store.list("cluster") if x["id"] == p["id"]), None)
        if previous is not None and "version" in value and (type(value["version"]) is not int or value["version"] != previous["version"]):
            raise ValueError("Cluster profile changed; reload before saving")
        p["version"] = (previous or {}).get("version", 0) + 1
        p.pop('probe',None);p.pop('connection_check',None)
        skill_root=self.service.root/"cluster-skills"/p["id"]/("v"+str(p["version"]))
        skill_root.mkdir(parents=True,exist_ok=True)
        skill_fields={k:p.get(k) for k in ("id","name","version","scheduler","queue","limits","lsf_memory_scope","environment")}
        if "queue_targets" in p:skill_fields["queue_targets"]=p["queue_targets"]
        source = (
            "# Cluster submission skill\n\n" + json.dumps(skill_fields, indent=2) + "\n\n"
            "Use only registered cluster IDs. Keep SSH addresses, ports, keys and model proxy credentials out of prompts and scripts. "
            "Probe the login node for connection and scheduler observations. Confirm queue and resource semantics with the user. "
            "Queue visibility never grants permission. For opt-in queue targets use the saved project cluster_queue_policies and exact "
            "profile version. Order applies to new submissions only. Within explicitly approved paid conditions and limits, reuse project "
            "authorization without a repeated paid permission prompt. Unknown or changed conditions require review. "
            "Use present_task to record workflow and parameters when this conversation owns the workflow and the tool is advertised. "
            "In ordinary chat, use the available compute tools for a clearly delegated independent job under current project and resource grants. "
            "Prepare immutable inputs, submit intentional new attempts, inspect results and repair failures within that delegation. "
            "Before launch, the compute node enforces frozen input identity and applicable bound-tool, required import and serialized-bias "
            "compatibility checks. Advisory scientific findings are recorded for review. Do not change project authorization. "
            "For an unknown run, reconcile receipts and scheduler job identity without resubmitting. Read bounded logs and assets through "
            "cluster tools.\n\n" + str(p.get("notes", ""))
        )
        (skill_root/"SKILL.md").write_text(source,encoding="utf8")
        self.store.put("cluster-version",{**p,"id":p["id"]+"-v"+str(p["version"])})
        self.store.put("cluster", p)
        return public(p)

    def allowed(self, project_id, cluster_id):
        project = self.store.get("project", project_id)
        if cluster_id not in project["policy"].get("clusters", []):
            raise PermissionError("Cluster is not authorized for this project")
        return project, self.store.get("cluster", cluster_id)

    def validate_project_policies(self, project):
        policies = project["policy"].get("cluster_queue_policies", {})
        if not isinstance(policies, dict) or len(policies) > 64:
            raise ValueError("Bounded cluster queue policies required")
        try:previous = self.store.get("project", project["id"])["policy"].get("cluster_queue_policies", {})
        except ValueError:previous = {}
        for cluster_id, value in policies.items():
            leaf(cluster_id)
            policy = queue_policy(value)
            # Preserve an unchanged stale policy on unrelated project edits. It
            # stays unusable for new preparation until explicitly reapproved.
            if previous.get(cluster_id) == value or not policy["allowed_target_ids"]:
                continue
            if cluster_id not in project["policy"].get("clusters", []):
                raise PermissionError("Queue policy requires an authorized cluster")
            current = self.store.get("cluster", cluster_id)
            if policy["profile_version"] != current["version"]:
                raise ValueError("Queue policy profile version changed; review the saved profile")
            if "queue_targets" not in current:
                raise ValueError("This profile has no opt-in queue targets")
            available = {target["id"] for target in current["queue_targets"]}
            if not set(policy["allowed_target_ids"]) <= available:
                raise ValueError("Queue policy references an unknown target")

    def select_queue_target(self, project, p, spec):
        requested = spec.get("resources", {})
        if not isinstance(requested, dict):
            raise ValueError("Explicit resource object required")
        if "queue_targets" not in p:
            if p["id"] in project["policy"].get("cluster_queue_policies", {}):
                raise PermissionError("Project queue policy still applies; explicitly review and remove it before using a legacy profile")
            if "queue_target_id" in requested:
                raise ValueError("This legacy profile has no opt-in queue targets")
            return p, resources(requested, p, spec["max_seconds"]), None, None
        value = project["policy"].get("cluster_queue_policies", {}).get(p["id"])
        if value is None:
            raise PermissionError("Project queue policy is not authorized; detected queues grant no permission")
        policy = queue_policy(value)
        if policy["profile_version"] != p["version"]:
            raise ValueError("Queue policy profile version changed; review the saved profile")
        targets = {target["id"]: target for target in p["queue_targets"]}
        explicit = requested.get("queue_target_id")
        if "queue_target_id" in requested:
            target_id(explicit)
            if explicit not in policy["allowed_target_ids"]:
                raise PermissionError("Explicit queue target is not authorized")
        order = [explicit] if explicit is not None else policy["new_submission_order"]
        failure = "No authorized compatible queue target within the approved limits"
        for identifier in order:
            target = targets.get(identifier)
            if target is None or not target["enabled"] or spec["engine"] not in target["engines"]:
                continue
            usage, paid = target["usage_class"], policy.get("paid", {})
            if usage == "unknown" or usage == "paid" and not (paid.get("permitted") and paid.get("conditions_known") and paid.get("conditions", "").strip() and paid.get("limits")):
                continue
            resolved = {**p, "queue":target["queue"], "environment":copy.deepcopy(target["environment"]),
                        "activation":target["activation"], "limits":dict(target["limits"])}
            chosen = {**requested, "queue":target["queue"], "queue_target_id":identifier}
            chosen.pop("account", None)
            if target.get("account"):chosen["account"] = target["account"]
            try:
                actual = resources(chosen, resolved, spec["max_seconds"])
                if spec["max_seconds"] > target["limits"]["max_seconds"]:
                    raise PermissionError("Duration exceeds queue target limit")
                if usage == "paid" and (any(actual[key] > paid["limits"][key] for key in ("cpus", "gpus", "memory_mb")) or spec["max_seconds"] > paid["limits"]["max_seconds"]):
                    raise PermissionError("Resources exceed approved paid queue limits")
            except PermissionError as error:
                failure = str(error)
                continue
            # An ordinary queue/account string cannot steer ordered selection
            # around a target grant. Explicit target rejection never substitutes.
            for field in ("queue", "account"):
                if field in requested and requested[field] != target.get(field, ""):
                    raise PermissionError("Resource " + field + " override differs from the authorized queue target")
            return resolved, actual, copy.deepcopy(target), copy.deepcopy(policy)
        raise PermissionError(failure)

    def validate_queue_snapshot(self, run, project, current):
        if "queue_target_snapshot" not in run:
            # Legacy snapshots are never migrated into a queue policy. Current
            # policy must nevertheless constrain every new dispatch, including
            # a legacy draft that predates an explicit queue-policy revocation.
            if current["id"] in project["policy"].get("cluster_queue_policies", {}):
                raise PermissionError("Project queue policy still applies; explicitly review and remove it before using a legacy draft")
            return
        spec = {**run, "resources":{**run["resources"], "queue_target_id":run["queue_target_snapshot"]["id"]}}
        resolved, actual, target, policy = self.select_queue_target(project, current, spec)
        if (target != run["queue_target_snapshot"] or policy_digest(policy) != run.get("queue_policy_digest") or
                policy != run.get("queue_policy_snapshot") or actual != run["resources"] or
                any(resolved[key] != run["cluster_snapshot"][key] for key in ("environment", "activation", "limits", "queue"))):
            raise ValueError("Queue target or project queue policy changed; create a new reviewed draft")

    def original_auth_source(self, identifier):
        """Resolve local immutable provenance, without polling or a current lease."""
        leaf(identifier)
        with self.store.lock:
            run = self.raw(identifier)
            if (run.get('id') != identifier or run.get('kind') != 'cluster-run' or
                    not isinstance(run.get('nonce'), str) or not 1 <= len(run['nonce']) <= 256 or
                    not isinstance(run.get('project_id'), str) or not isinstance(run.get('cluster_id'), str)):
                raise ValueError('Original cluster run identity unavailable')
            # The current policy remains authoritative; the current profile is
            # never substituted for the immutable routing snapshot below.
            self.allowed(run['project_id'], run['cluster_id'])
            snapshot = run.get('cluster_snapshot')
            if (not isinstance(snapshot, dict) or snapshot.get('id') != run['cluster_id'] or
                    type(snapshot.get('version')) is not int or snapshot['version'] < 1 or
                    snapshot.get('auth_mode', 'key') not in ('interactive', 'key')):
                raise ValueError('Original cluster snapshot unavailable')
            encoded = json.dumps(snapshot, sort_keys=True, separators=(',', ':'), allow_nan=False)
            receipt = {'runId': identifier, 'nonce': run['nonce'], 'projectId': run['project_id'],
                       'clusterId': run['cluster_id'], 'version': snapshot['version'],
                       'snapshotDigest': hashlib.sha256(encoded.encode()).hexdigest()}
            origin = {'kind': 'original-run', 'runId': identifier,
                      'runName': run.get('name', 'Original cluster run'), 'projectId': run['project_id'],
                      'clusterId': run['cluster_id'], 'version': snapshot['version']}
            return {'profile': json.loads(encoded), 'sourceReceipt': receipt, 'origin': origin}

    def original_key_check(self, snapshot):
        """Read-only legacy key/agent/via check; never register or update health."""
        if snapshot.get('auth_mode', 'key') != 'key':
            raise ValueError('Original key connection required')
        _host, username = ssh_endpoint(snapshot)
        output = self.transport(snapshot).original_key_identity()
        if not isinstance(output, str) or len(output.encode()) > 8192 or output.strip().splitlines() != [username]:
            raise ConnectionError('Original SSH user check failed')
        return {'status': 'passed'}

    def test_connection(self, value):
        p = profile(value)
        p['_check_started_at']=time.time()
        try:
            observed = self.transport(p).run("id -un", timeout=25).strip().splitlines()
            if not observed or observed[-1] != p["username"]:raise ConnectionError("Remote username differs; check the explicit SSH username")
            result={"status":"passed","username_matches":True,"scope":"SSH authentication only; scheduler, compute-node GPU and science not_run"}
        except Exception as exc:
            self._connection_result(p,{'status':'failed','reason':'SSH connection check failed; review username, authentication and network in private settings','error_type':type(exc).__name__})
            raise
        self._connection_result(p,result)
        return result

    def _connection_result(self, original, result, probe=None):
        if not original.get('id'):return
        with self.store.lock:
            try:current=self.store.get('cluster',original['id'])
            except ValueError:return  # An unsaved form has no authoritative health record.
            keys=('host','username','target','port','ssh_client','identity_file','via','version')
            if any(current.get(key)!=original.get(key) for key in keys):return
            if current.get('auth_mode','key')!=original.get('auth_mode','key') or current.get('proxy_jump',[])!=original.get('proxy_jump',[]):return
            started=original.get('_check_started_at',time.time())
            if current.get('connection_check',{}).get('attempted_at',0)>started:return
            current['connection_check']={**result,'observed_at':time.time(),'attempted_at':started,'version':current['version'],'compute_node_status':'not_run'}
            if probe is not None:current['probe']=probe
            elif result['status']=='failed':current.pop('probe',None)
            self.store.put('cluster',current)

    def probe(self, cluster_id):
        p = self.store.get("cluster", cluster_id)
        p['_check_started_at']=time.time()
        source = """
import os,pathlib,shutil,subprocess,pwd
out={'scope':'login-node observation; compute-node GPU and scientific validation not_run','scheduler':p['scheduler'],'selected_scheduler':p['scheduler'],'commands':{},'queues':[],'schedulers':{},'detected_schedulers':[],'python':os.sys.version.split()[0]}
out['username']=pwd.getpwuid(os.geteuid()).pw_name
for name in ['bsub','bjobs','bqueues','bkill','sbatch','squeue','sacct','sinfo','scancel','nvidia-smi','module']:
 out['commands'][name]=bool(shutil.which(name))
families={'lsf':(('bsub','bjobs','bqueues','bkill'),['bqueues','-noheader','-o','queue_name:80']),
          'slurm':(('sbatch','squeue','sacct','sinfo','scancel'),['sinfo','-h','-o','%P'])}
for family,(names,cmd) in families.items():
 entry={'commands':{name:out['commands'][name] for name in names},'queues':[],'queue_status':'blocked'}
 if all(out['commands'][name] for name in names[:2]):out['detected_schedulers'].append(family)
 if out['commands'].get(cmd[0]):
  try:
   result=subprocess.run(cmd,capture_output=True,text=True,timeout=12)
   entry['queue_status']='passed' if result.returncode==0 else 'blocked'
   if result.returncode==0:entry['queues']=list(dict.fromkeys(x.strip().rstrip('*') for x in result.stdout.splitlines() if x.strip()))[:100]
  except Exception:pass
 out['schedulers'][family]=entry
out['selected_scheduler_match']=p['scheduler'] in out['detected_schedulers']
selected=out['schedulers'][p['scheduler']]
out['queues']=selected['queues'];out['queue_status']=selected['queue_status']
out['executables']={k:{'exists':pathlib.Path(v).is_file(),'executable':os.access(v,os.X_OK)} for k,v in p['executables'].items()}
print('__STUDIO_JSON__'+json.dumps(out))
"""
        payload={"scheduler":p["scheduler"],"executables":p["environment"]["executables"]}
        script=python_script({**p,"environment":{"executables":{"python":"python3"}}},source,payload)
        try:
            result = parse_output(self.transport(p).run(script))
            if result.pop('username',None)!=p['username']:raise ConnectionError('Remote username differs; check the explicit SSH username')
            commands=('bsub','bjobs') if p['scheduler']=='lsf' else ('sbatch','squeue')
            scheduler='passed' if all(result.get('commands',{}).get(key) for key in commands) and result.get('queue_status')=='passed' else 'blocked'
            result.update(observed_at=time.time(),status='passed' if scheduler=='passed' else 'blocked',scheduler_status=scheduler,ssh_status='passed')
            self._connection_result(p,{'status':result['status'],'ssh_status':'passed','scheduler_status':scheduler,'scope':result['scope']},result)
            return result
        except Exception as exc:
            self._connection_result(p,{'status':'failed','reason':'Cluster discovery failed; check the saved SSH connection and login-node Python','error_type':type(exc).__name__})
            raise

    def skill(self,project_id,cluster_id):
        _,p=self.allowed(project_id,cluster_id)
        file=self.service.root/"cluster-skills"/p["id"]/("v"+str(p["version"]))/"SKILL.md"
        if not file.is_file():raise ValueError("Save the profile to register its versioned skill")
        return {"cluster_id":p["id"],"version":p["version"],"source":file.read_text("utf8")}

    def draft(self, data):
        _, current = self.allowed(data["project_id"], data["cluster_id"])
        proposal = data["proposal"]
        if not isinstance(proposal, dict) or any(k not in ("queue","activation","environment","limits","notes","lsf_memory_scope","queue_targets") for k in proposal):
            raise ValueError("Only reviewable environment/skill fields can be proposed")
        if "queue_targets" in proposal:
            queue_targets(proposal["queue_targets"], proposal.get("limits", current["limits"]), current["scheduler"])
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
        root = job_root(run).rstrip("/")
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

    def prepare_bound(self, spec, *, argv, version, inputs, output_root, owner, activation=None, writable_roots=()):
        """Internal API. The caller has verified the workspace, operation owner and selected template."""
        from studio_worker.compute.ssh_service import assert_binding
        _, profile = self.allowed(spec['project_id'], spec['cluster_id'])
        if profile.get('transport_kind') != 'ssh-service-local':
            raise PermissionError('Use the scheduler registered on this job service')
        assert_binding(self.service, profile)
        bound = invocation(argv, version, inputs, output_root, owner, activation, writable_roots)
        with self.prepare_lock:
            return self._prepare({**spec, 'inputs':{k:v['path'] for k,v in inputs.items()}}, bound=bound)

    @staticmethod
    def _revision_input_maps(run):
        remote = {asset["name"]: asset["source"] for asset in run["snapshots"]
                  if asset.get("source_kind") == "remote"}
        remote.update(run.get("remote_inputs", {}))
        local = run.get("local_inputs", {name: source for name, source in run["inputs"].items() if name not in remote})
        return local, remote

    @staticmethod
    def _copy_input(source, target, budget, expected=None):
        if not source.is_file():
            raise ValueError("Immutable input snapshot unavailable" if expected is not None else "Input unavailable")
        size = source.stat().st_size
        if size > budget:
            raise ValueError("Input total exceeds transfer bound")
        before = digest(source)
        if expected is not None and (before != expected["sha256"] or size != expected.get("size", size)):
            raise ValueError("Immutable input snapshot changed")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        if target.stat().st_size != size or digest(target) != before or source.stat().st_size != size or digest(source) != before:
            raise ValueError("Local input changed while creating snapshot")
        return before, size

    def _prepare(self, spec, *, bound=None, parent=None):
        spec = dict(spec)
        if 'bound_invocation' in spec:
            raise ValueError('Invocation bindings are worker-owned')
        if bound is not None:
            spec['bound_invocation'] = bound
        if "revision_of" in spec:
            raise ValueError("Revision identity is worker-owned; use the desktop revision route")
        if parent is not None:
            spec["revision_of"] = parent["id"]
        if any(key in spec for key in ("queue_target_snapshot", "queue_policy_snapshot", "queue_policy_digest", "queue_profile_version")):
            raise ValueError("Queue selection snapshots are worker-owned")
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
        if spec["engine"] not in project["policy"]["engines"] or (spec["engine"] not in SUPPORTED_ENGINES and not (bound and private_engine(spec["engine"]))):
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
            if "queue_target_snapshot" in previous and previous["status"] in ("draft", "ready"):
                if p["version"] != previous["cluster_snapshot"]["version"]:
                    raise ValueError("Cluster profile changed; create a new reviewed draft")
                self.validate_queue_snapshot(previous, project, p)
            return self.run(previous["id"])
        p, r, selected_target, selected_policy = self.select_queue_target(project, p, spec)
        if (spec["engine"].endswith("sampling") or spec["engine"] == "bias.validate") and r["gpus"] < 1:
            raise ValueError("Bias target validation requires a GPU allocation")
        roots = project["policy"]["input_roots"] + [str(self.service.root/"projects"/project["id"]/"inputs")]
        if bound:
            roots = [value['path'] for value in bound['inputs'].values()]
        inherited = {}
        if parent is not None:
            if parent["project_id"] != project["id"] or parent["status"] not in ("draft", "ready") or parent.get('managed_child'):
                raise PermissionError("Only an unsubmitted run in the same project may be revised")
            if parent.get("superseded_by"):
                raise PermissionError("The revision parent changed or was submitted; reload its current run")
            roots.append(parent["directory"])
            parent_local, parent_remote = self._revision_input_maps(parent)
            simulation = Path(parent["directory"]) / "simulation"
            same_target = parent["cluster_id"] == p["id"] and parent["cluster_snapshot"]["version"] == p["version"]
            for asset in parent["snapshots"]:
                name = asset["name"]
                source = simulation / name
                if name in local_inputs and name in parent_local and local_inputs[name] in (
                        parent_local[name], asset["source"], str(source), f"{parent['directory']}/simulation/{name}"):
                    local_inputs[name] = parent_local[name]
                elif not (same_target and name in remote_inputs and name in parent_remote and remote_inputs[name] == parent_remote[name]):
                    continue
                if source.is_symlink():
                    raise ValueError("Immutable input snapshot changed")
                inherited[name] = (contained(source, [simulation]), asset)
        # Adapter and compute-node gates must see the complete run filename map.
        spec["inputs"] = {**local_inputs, **remote_inputs}
        command = bound['argv'] if bound else PlanningAdapter(spec["engine"]).prepare(spec, p["environment"])
        # Private custom primitives are local-only in this generation. Reject
        # before any archive, local snapshot or SSH upload; do not imply a remote
        # private execution/access contract has been verified.
        local_sources = {name: contained(src, roots) for name, src in local_inputs.items() if name not in inherited}
        local_paths = list(local_sources.values())
        for name in local_inputs.keys() & inherited.keys():
            source, asset = inherited[name]
            local_paths.extend((source, Path(asset["source"])))
        if private_copy_rows(current_rows(self.service),local_paths,self.store.runs(),self.service.root):raise ValueError('Private custom CV source cannot be copied to a remote task before a remote access contract is implemented')
        identifier = secrets.token_hex(12)
        directory = self.service.root / "cluster-runs" / identifier
        (directory/"simulation").mkdir(parents=True)
        snapshots, total = [], 0
        persisted = False
        try:
            for name in (*local_inputs, *remote_inputs):
                dst = directory / "simulation" / name
                if name in inherited:
                    source, asset = inherited[name]
                    _, size = self._copy_input(source, dst, TRANSFER_TOTAL - total, asset)
                    snapshot = {**asset, "size":size, "source_kind":"remote" if name in remote_inputs else "local"}
                elif name in local_sources:
                    source = local_sources[name]
                    sha256, size = self._copy_input(source, dst, TRANSFER_TOTAL - total)
                    snapshot = {"name":name, "source":str(source), "source_kind":"local", "sha256":sha256, "size":size}
                else:
                    source = remote_inputs[name]
                    meta = self._download(p, source, p["read_roots"], dst, TRANSFER_TOTAL - total)
                    snapshot = {"name":name, "source":source, "source_kind":"remote", "cluster_id":p["id"],
                                "sha256":meta["sha256"], "size":meta["size"], "remote_identity":meta["identity"]}
                total += snapshot["size"]
                snapshots.append(snapshot)
            run = {**spec, "id":identifier, "kind":"cluster-run", "name":spec.get("name",spec["engine"]),
                   "request_hash":fingerprint, "directory":str(directory), "snapshots":snapshots, "command":command,
                   "local_inputs":local_inputs, "resources":r, "cluster_snapshot":p, "status":"draft", "validation":{"status":"not_run"},
                   "scientific_validation":{"status":"not_run"}, "nonce":secrets.token_hex(16),
                   "remote_directory":(bound['root'] if bound else p["remote_root"]).rstrip("/")+"/"+(prefix+"-" if prefix else "")+identifier,
                   "job_name":"gss-"+identifier, "job_id":None, "created_at":time.time(), "updated_at":time.time()}
            if selected_target is not None:
                run.update(queue_target_snapshot=selected_target, queue_policy_snapshot=selected_policy,
                           queue_policy_digest=policy_digest(selected_policy), queue_profile_version=p["version"])
            self.remote_name(run)
            run["script"] = batch_script(run)
            with self.store.lock:
                # Copying/downloading revision inputs can overlap submission of
                # the original draft. Never replace its real state with the
                # pre-transfer parent snapshot or publish a stale revision link.
                if parent:
                    current_parent = self.raw(parent["id"])
                    if (current_parent["status"] not in ("draft", "ready") or current_parent.get("superseded_by") or
                            current_parent.get("nonce") != parent.get("nonce") or current_parent["snapshots"] != parent["snapshots"]):
                        raise PermissionError("The revision parent changed or was submitted; reload its current run")
                    parent = current_parent
                for snapshot in snapshots:
                    (directory / "simulation" / snapshot["name"]).chmod(0o444)
                atomic_json(directory/"run.json", run)
                if parent:
                    parent = {**parent, "superseded_by": identifier, "updated_at": time.time()}
                    self.store.put_many([("cluster-run", run), ("cluster-run", parent)])
                    persisted = True
                    self.store.event(parent["id"], {"kind": "cluster-run", "state": parent["status"]})
                    atomic_json(Path(parent["directory"])/"run.json", parent)
                else:
                    self.store.put("cluster-run", run); persisted = True
            return self.run(identifier)
        except Exception:
            if not persisted: shutil.rmtree(directory)
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

    def save(self, r, *, related=(), **changes):
        # Keep the SQLite row and its diagnostic snapshot ordered across HTTP
        # requests and the background monitor (including the shared .tmp file).
        with self.store.lock:
            r.update(changes,updated_at=time.time())
            if related:
                self.store.put_many([("cluster-run", r), *related])
            else:
                self.store.put("cluster-run",r)
            self.store.event(r["id"],{"kind":"cluster-run","state":r["status"]})
            atomic_json(Path(r["directory"])/"run.json",r)
            return r

    def merge(self, identifier, **changes):
        """Re-read the current row before writing fields gathered by a long remote call."""
        with self.store.lock:
            return self.save(self.raw(identifier), **changes)

    def run(self, identifier):
        r = dict(self.raw(identifier))
        r["cluster"] = public(r.pop("cluster_snapshot"))
        return r

    def validate(self, identifier):
        r = self.raw(identifier)
        if r.get("managed_child"):
            raise PermissionError("Managed child plans are verified by their owning schedule")
        project,current=self.allowed(r["project_id"],r["cluster_id"])
        if r["engine"] not in project["policy"]["engines"] or r["max_seconds"]>project["policy"]["max_seconds"]:
            raise PermissionError("Current project policy no longer permits this draft")
        if current["version"]!=r["cluster_snapshot"]["version"]:
            raise ValueError("Cluster profile changed; create a new reviewed draft")
        self.validate_queue_snapshot(r, project, current)
        resources(r["resources"],current,r["max_seconds"])
        if r["status"] not in ("draft","ready"):
            raise ValueError("Submitted inputs are immutable")
        for asset in r["snapshots"]:
            if digest(Path(r["directory"])/"simulation"/asset["name"]) != asset["sha256"]:
                raise ValueError("Input snapshot changed")
        if r.get('bound_invocation'):
            bound = r['bound_invocation']
            if r['command'] != bound['argv'] or any(a['sha256'] != bound['inputs'][a['name']]['sha256'] for a in r['snapshots']):
                raise ValueError('Prepared run differs from its reviewed invocation')
        else:
            PlanningAdapter(r["engine"]).prepare(r,r["cluster_snapshot"]["environment"])
        resources(r["resources"],r["cluster_snapshot"],r["max_seconds"])
        # A concurrent submit may reserve/dispatch while input hashing is in
        # progress. Validation must never reopen an attempted run as ready.
        with self.store.lock:
            current=self.raw(identifier)
            if current["status"] not in ("draft","ready"):
                return self.run(identifier)
            if current.get("nonce")!=r.get("nonce") or current["snapshots"]!=r["snapshots"]:
                raise ValueError("Run snapshot changed during validation; reload before validating")
            self.save(current,status="ready",validation={"status":"passed","scope":"local immutable inputs and scheduler resource contract only; scientific checks run on execution node"})
        return self.run(identifier)

    def revise(self, identifier, changes):
        with self.prepare_lock:
            parent = self.raw(identifier)
            if parent.get("managed_child") or parent.get("bound_invocation"):
                raise PermissionError("Use the owning schedule to edit this operation")
            allowed = ("name", "engine", "max_seconds", "resources", "inputs", "remote_inputs", "directory_name", "parameters")
            if any(key not in allowed for key in changes):
                raise ValueError("Unsupported revision field")
            spec = {key:parent[key] for key in ("project_id", "cluster_id", *allowed) if key in parent}
            spec["inputs"], spec["remote_inputs"] = self._revision_input_maps(parent)
            spec.update(changes)
            spec["idempotency_key"] = secrets.token_hex(16)
            return self._prepare(spec, parent=parent)

    def archive(self, r):
        if r.get("managed_child"):
            from studio_worker.compute.managed_child import archive_child
            return archive_child(r)
        buffer = io.BytesIO()
        root = Path(r["directory"])
        validate = """import sys,json,os
from pathlib import Path
sys.path.insert(0,str(Path('.studio').resolve()))
from studio_worker.tools.adapters import Adapter
from studio_worker.util import atomic_json,digest,contained
r=json.load(open('.studio/run.json'))
environment=r['environment_snapshot']
import studio_worker.tools.adapters as a
_original=a.process_env
a.process_env=lambda environment,gpu=None:_original(environment,None)
for a in r['snapshots']:
 f=contained(Path('simulation')/a['name'],[Path('simulation')])
 if digest(f)!=a['sha256']:raise ValueError('Remote immutable input changed')
observed=None
report=None
try:
 print('AIMatterLab validation: environment probe started',file=sys.stderr,flush=True)
 observed=Adapter(r['engine']).probe(environment)
 print('AIMatterLab validation: environment probe finished',file=sys.stderr,flush=True)
 atomic_json('environment.json',observed)
 Adapter(r['engine']).prepare(r,environment)
 report=Adapter(r['engine']).validate(r,environment,Path('simulation').resolve(),probe_report=observed)
 atomic_json('validation.json',report)
except Exception as e:
 atomic_json('validation.json',{'status':'failed','message':str(e)})
if r['engine'].endswith('sampling') or r['engine']=='bias.validate':
 try:
  required=report if (report or {}).get('artifact_status')=='passed' else Adapter(r['engine']).validate(r,environment,Path('simulation').resolve(),probe_report=observed,execution_only=True)
  if required.get('artifact_status')!='passed':raise ValueError('Serialized artifact/target compatibility was not confirmed')
  atomic_json('execution-check.json',{'status':'passed','required':True,'report':required})
 except Exception as e:
  atomic_json('execution-check.json',{'status':'failed','required':True,'message':str(e)})
  raise
elif r['engine']=='pydyn.md':
 try:
  adapter=Adapter(r['engine'])
  required=adapter.pydyn_import_contract(environment,observed or adapter.probe(environment))
  atomic_json('execution-check.json',{'status':'passed','required':True,'report':required})
 except Exception as e:
  atomic_json('execution-check.json',{'status':'failed','required':True,'message':str(e)})
  raise
"""
        if r.get('bound_invocation'):
            validate = COMPUTE_CHECK + ('\n' + validate if r['engine'] in ENGINES else '')
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
            if r.get('bound_invocation'):
                add('.studio/workspace-confinement.py', confinement_source())
            for name, data in validation_resources():
                add(".studio/studio_worker/"+name,data)
        return buffer.getvalue()

    def submit(self, identifier, *, managed=None, timeout=90, monitor=None):
        scheduler = getattr(self.service, 'managed_schedules', None)

        def reviewed():
            r=self.raw(identifier)
            project,p=self.allowed(r["project_id"],r["cluster_id"])
            if monitor is not None:
                if scheduler is None:
                    raise PermissionError("Managed submission monitoring is unavailable")
                scheduler.submit_monitor_owner(r, monitor)
            if r.get("superseded_by"):raise ValueError("Review and submit the revised snapshot")
            if r["status"] in ("queued","running","unknown",*TERMINAL):
                return None,None
            if r["status"] not in ("draft","ready"):
                raise ValueError("Only an unsubmitted input snapshot can be submitted")
            if r.get("managed_child"):
                if scheduler is None or not scheduler.can_submit_child(r, managed):
                    raise PermissionError("Only the owning due schedule may submit this child")
                from studio_worker.compute.managed_child import validate_child
                validate_child(self.service, r)
            else:
                self.validate(identifier)
            busy=[x for x in self.store.list("cluster-run") if x["project_id"]==r["project_id"] and x["status"] in ("queued","running","unknown")]
            if len(busy)+sum(x["project_id"]==r["project_id"] and x["status"] in ("running","unknown") for x in self.store.runs())>=project["policy"]["max_concurrent"]:
                raise PermissionError("Project concurrency limit reached")
            return r,p

        with run_preflight():
            with self.store.lock:
                r,p=reviewed()
                if r is None:return self.run(identifier)
                interactive=self.transport==self._transport and r['cluster_snapshot'].get('auth_mode','key')=='interactive'
                snapshot=dict(r['cluster_snapshot']) if interactive else None
            if interactive:
                # Auth methods may acquire auth -> Store locks. Never invert that
                # ordering by checking authentication while holding Store.lock.
                self.auth.resolve(snapshot)
                with self.store.lock:
                    r,p=reviewed()
                    if r is None:return self.run(identifier)
                    if r['cluster_snapshot']!=snapshot:
                        raise ValueError('Reviewed cluster snapshot changed before submission')
                    p=r['cluster_snapshot']
        source="""
import pathlib,tarfile,sys,io,subprocess,os
root=pathlib.Path(p['root']).expanduser().resolve();root.mkdir(parents=True,exist_ok=True)
d=root/p.get('directory',p['id'])
if d.exists():raise ValueError('Run directory already exists; reconcile only')
d.mkdir()
(d/'simulation').mkdir()
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
        # Local archive construction makes no scheduler call. A failure here leaves
        # the reviewed draft ready, so the human can retry instead of reconciling an
        # "unknown" attempt that was never dispatched.
        with run_preflight():
            data=self.archive(r)
        with self.store.lock:
            # Archive/authentication may overlap another cluster submission, a
            # local dispatch or a policy edit. Recheck and reserve under the same
            # Store lock used by the local scheduler's final concurrency check.
            with run_preflight():
                r,p=reviewed()
                if r is None:return self.run(identifier)
                if interactive:
                    if r['cluster_snapshot']!=snapshot:
                        raise ValueError('Reviewed cluster snapshot changed before submission')
                    p=r['cluster_snapshot']
                if monitor is not None:
                    enrollment, related = scheduler.enrollment(scheduler.submit_monitor_owner(r, monitor))
            # This durable reservation is visible to both schedulers before any
            # remote side effect. Unknown attempts are never automatically replayed.
            if monitor is not None:
                self.save(r, related=related, status="unknown", submit_attempted=True, managed_schedule_parent=True,
                          managed_submit_monitor=enrollment)
            else:
                self.save(r,status="unknown",submit_attempted=True)
        try:
            result=parse_output(self.transport(p).run(python_script(p,source,{"root":job_root(r),"id":r["id"],"directory":self.remote_name(r),"nonce":r["nonce"],"scheduler":p["scheduler"]}),data=data,timeout=timeout))
            if result.get("nonce")!=r["nonce"] or not re.fullmatch(r"[0-9]+",result.get("job_id","")):
                raise ValueError("Invalid scheduler receipt")
            with self.store.lock:
                current=self.raw(identifier)
                if current["status"] not in TERMINAL:
                    changes={"job_id":result["job_id"]}
                    if current["status"]=="unknown" and not current.get("exit"):
                        changes["status"]="queued"
                    self.save(current,**changes)
        except Exception:
            with self.store.lock:
                current=self.raw(identifier)
                # A monitor may already have reconciled the scheduler receipt
                # while the submission reply was delayed or lost.
                if current["status"]=="unknown" and not current.get("job_id") and not current.get("exit"):
                    self.save(current,error=_SUBMISSION_REPLY_UNAVAILABLE)
        return self.run(identifier)

    def poll(self, identifier, *, managed=None, timeout=None):
        with self.store.lock:
            r=self.raw(identifier);self.allowed(r["project_id"],r["cluster_id"])
            scheduler = getattr(self.service, 'managed_schedules', None)
            if (r.get("managed_child") or r.get("managed_schedule_parent")) and (
                    scheduler is None or not scheduler.can_poll(r, managed)):
                return self.run(identifier)
            if r["status"] in ("draft","ready",*TERMINAL):
                return self.run(identifier)
            # Additive per-request ownership; legacy records need no migration.
            # Only the latest started poll may commit a success or failure reply.
            token=secrets.token_hex(16)
            self.save(r,observation_token=token,identity_verified=False)
        p=r["cluster_snapshot"]
        source="""
import pathlib,re,subprocess
d=pathlib.Path(p['root']).expanduser().resolve()/p.get('directory',p['id']);out={'job_id':p.get('job_id'),'state':'unknown'}
receipt=d/'.submission-receipt.json'
if receipt.exists():
 v=json.load(open(receipt))
 if v.get('nonce')==p['nonce'] and re.fullmatch(r'[0-9]+',str(v.get('job_id',''))):out['job_id']=str(v['job_id'])
if not out['job_id'] and (d/'.submit-attempt').exists() and (d/'.submit-attempt').read_text()==p['nonce']:
 if p['scheduler']=='lsf':
  found=subprocess.run(['bjobs','-a','-J',p['name'],'-l'],capture_output=True,text=True,timeout=15)
  import re
  matches=re.findall(r'Job\\s*<([0-9]+)>',found.stdout)
 else:
  found=subprocess.run(['squeue','-h','--name',p['name'],'-o','%i|%j'],capture_output=True,text=True,timeout=15)
  matches=[row.split('|')[0] for row in found.stdout.splitlines() if row.split('|')[-1].strip()==p['name']]
 if len(matches)==1 and re.fullmatch(r'[0-9]+',matches[0]):out['job_id']=matches[0]
if (d/'exit.json').exists():
 v=json.load(open(d/'exit.json'))
 if v.get('nonce')==p['nonce'] and type(v.get('exit_code')) is int:out['exit']=v
if (d/'validation.json').exists():out['validation']=json.load(open(d/'validation.json'))
if (d/'execution-check.json').exists():out['execution_check']=json.load(open(d/'execution-check.json'))
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
   if p['scheduler']=='lsf' and out['scheduler_state']=='EXIT' and re.search(r'(?:^|;)\\s*TERM_OWNER\\s*:',result.stdout,re.MULTILINE):
    out['cancelled_by_owner']=True
print('__STUDIO_JSON__'+json.dumps(out))
"""
        try:
            script=python_script(p,source,{"root":job_root(r),"id":r["id"],"directory":self.remote_name(r),"nonce":r["nonce"],"job_id":r["job_id"],"scheduler":p["scheduler"],"name":r["job_name"]})
            transport=self.transport(p)
            result=parse_output(transport.run(script) if timeout is None else transport.run(script,timeout=timeout))
            with self.store.lock:
                current=self.raw(identifier)
                if current.get("observation_token")!=token or current["status"] in TERMINAL:
                    return self.run(identifier)
                state=result.get("scheduler_state","unknown").upper()
                mapped={"PEND":"queued","PENDING":"queued","RUN":"running","RUNNING":"running","PSUSP":"queued","USUSP":"queued","SSUSP":"queued","CONFIGURING":"queued","COMPLETING":"running","EXIT":"failed","FAILED":"failed","TIMEOUT":"failed","OUT_OF_MEMORY":"failed","CANCELLED":"cancelled"}
                status=mapped.get(state,"unknown")
                receipt=result.get("exit") or current.get("exit")
                validation=result.get("validation",current.get("scientific_validation"))
                if receipt:
                    status="succeeded" if receipt["exit_code"]==0 else "failed"
                if (state=="CANCELLED" or result.get("cancelled_by_owner") is True) and (receipt or {}).get("exit_code")!=0:
                    status="cancelled"
                verified = result.get("identity_verified") is True
                job_id = result.get("job_id") or current["job_id"]
                # Recovering the original ID confirms submission even if its queue state is unknown.
                if job_id and current.get("error") == _SUBMISSION_REPLY_UNAVAILABLE:
                    current.pop("error")
                self.save(current,status=status,job_id=job_id,scheduler_state=state,connection_action=None,
                          scientific_validation=validation,execution_check=result.get('execution_check',current.get('execution_check')),exit=receipt,identity_verified=verified,
                          observed_at=time.time() if verified or receipt else current.get('observed_at'))
        except Exception as error:
            with self.store.lock:
                current=self.raw(identifier)
                if current.get("observation_token")!=token or current["status"] in TERMINAL:
                    return self.run(identifier)
                changes = {}
                if str(error) == 'needs_human_auth':
                    from studio_worker.compute.ssh_auth import AuthError
                    if isinstance(error, AuthError):
                        changes['connection_action'] = {'kind': 'authenticate_original_run',
                                                        'code': 'needs_human_auth', 'runId': r['id']}
                if current.get("error") != _SUBMISSION_REPLY_UNAVAILABLE:
                    changes["error"] = "SSH or scheduler state unavailable; no resubmission"
                self.save(current,status="unknown",**changes)
        return self.run(identifier)

    def cancel(self, identifier, *, managed=None, timeout=None, require_known=False):
        # Record the user's intent before even the status query can lose its
        # acknowledgement. Polling never proves the cancellation was delivered.
        with self.store.lock:
            with run_preflight():
                before=self.raw(identifier)
                self.allowed(before['project_id'],before['cluster_id'])
                if require_known and (before['status'] not in ('queued', 'running') or before.get('cancel_requested')):
                    raise ValueError('Original run status does not confirm a cancellable scheduler job')
                scheduler = getattr(self.service, 'managed_schedules', None)
                if before.get("managed_child") and (scheduler is None or not scheduler.can_cancel_child(before, managed)):
                    raise PermissionError("Stop the owning schedule to cancel its verified child")
                if before.get("managed_schedule_parent") and not before.get("managed_child") and scheduler is not None:
                    # The explicit run-cancel action is independent of stopping a schedule.
                    managed = scheduler.explicit_parent_cancel
                if before['status'] in TERMINAL or identifier in self._cancelling:return self.run(identifier)
                requested={"status":"requested", "requested_at":(before.get('cancellation') or {}).get('requested_at') or time.time(), "signal_sent":False}
            self.save(before,cancel_requested=True,cancellation=requested)
            self._cancelling.add(identifier)
        try:
            if managed is None and timeout is None and not require_known:
                return self._cancel_verified_job(identifier,requested)
            return self._cancel_verified_job(identifier,requested,managed=managed,timeout=timeout,require_known=require_known)
        finally:
            with self.store.lock:
                self._cancelling.discard(identifier)

    def _cancel_verified_job(self, identifier, requested, *, managed=None, timeout=None, require_known=False):
        observed=self.poll(identifier) if managed is None else self.poll(identifier,managed=managed,timeout=timeout)
        with self.store.lock:
            r=self.raw(identifier)
            self.allowed(r['project_id'],r['cluster_id'])
            if r['status'] in TERMINAL:return self.run(identifier)
            if require_known and (r['status'] not in ('queued', 'running') or observed['status'] not in ('queued', 'running')):
                self.save(r,cancellation={**requested,'status':'unconfirmed','message':'Original scheduler status could not be confirmed; no signal was sent'})
                raise ValueError('Original scheduler status could not be confirmed')
            if (not r.get("job_id") or not r.get("identity_verified") or not observed.get("identity_verified")
                    or r["job_id"]!=observed.get("job_id") or r.get("observation_token")!=observed.get("observation_token")):
                self.save(r,cancellation={**requested,"status":"unconfirmed","message":"Original scheduler identity is not verified; no cancellation command was sent"})
                raise ValueError("Cannot cancel an unverified scheduler identity")
            p=r["cluster_snapshot"]
            command=["bkill" if p["scheduler"]=="lsf" else "scancel",r["job_id"]]
            self.save(r,cancellation={**requested,"signal_sent":None})
        try:
            transport = self.transport(p)
            transport.run(shlex.join(command)) if timeout is None else transport.run(shlex.join(command),timeout=timeout)
        except Exception as exc:
            self.merge(identifier,cancellation={**requested,"status":"unconfirmed","signal_sent":None,"message":str(exc)[:300]})
            raise
        self.merge(identifier,cancellation={**requested,"signal_sent":True})
        return self.run(identifier)

    def read(self, identifier, name="console.log", offset=0, *, limit=262144, timeout=None):
        r=self.raw(identifier);self.allowed(r["project_id"],r["cluster_id"])
        if name not in ("console.log","queue.out","queue.err","validation.stdout","validation.stderr"):
            raise ValueError("Select a bounded known log")
        p=r["cluster_snapshot"]
        source="""
import pathlib
d=pathlib.Path(p['root']).expanduser().resolve()/p.get('directory',p['id']);f=(d/p['name']).resolve()
if d.resolve() not in f.parents:raise ValueError('Invalid log path')
text='';offset=0;present=f.is_file()
if present:
 with open(f,'rb') as stream:
  stream.seek(max(0,int(p['offset'])));text=stream.read(p['limit']).decode('utf8','replace');offset=stream.tell()
print('__STUDIO_JSON__'+json.dumps({'text':text,'offset':offset,'present':present}))
"""
        script=python_script(p,source,{"root":job_root(r),"id":r["id"],"directory":self.remote_name(r),"name":name,"offset":offset,"limit":limit})
        transport=self.transport(p)
        return parse_output(transport.run(script) if timeout is None else transport.run(script,timeout=timeout))


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
        now = time.time()
        if now - self.last_poll < 15:
            return
        self.last_poll = now
        runs = self.store.list("cluster-run")
        active = {r["id"] for r in runs if r["status"] in ("queued", "running", "unknown") and
                  not (r.get("managed_child") or r.get("managed_schedule_parent"))}
        for identifier in list(self._next_poll):
            if identifier not in active:
                self._next_poll.pop(identifier, None)
                self._unknown_backoff.pop(identifier, None)
        for r in runs:
            status = r["status"]
            if r.get("managed_child") or r.get("managed_schedule_parent"):
                continue
            if status not in ("queued", "running", "unknown"):
                continue
            if now < self._next_poll.get(r["id"], 0):
                continue
            try:
                observed = self.poll(r["id"])
                state = observed.get("status") if isinstance(observed, dict) else None
            except Exception:
                state = "unknown"
            # Unresolvable runs must not spin every cycle: bounded exponential backoff,
            # reset as soon as a poll produces a real state again.
            delay = 15
            if state == "unknown":
                delay = min(300, self._unknown_backoff.get(r["id"], 15) * 2)
                self._unknown_backoff[r["id"]] = delay
            else:
                self._unknown_backoff.pop(r["id"], None)
            self._next_poll[r["id"]] = time.time() + delay
