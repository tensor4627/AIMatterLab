import base64
import io
import zipfile
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from .adapters import Adapter, ENGINES, SUPPORTED_ENGINES, SCIENTIFIC, process_env
from .store import Store
from .runtime_service import RuntimeServiceMixin
from .util import alive, atomic_json, contained, digest, identity, leaf, run_json

TERMINAL = ("succeeded", "failed", "cancelled")


class Service(RuntimeServiceMixin):
    def __init__(self, root, schedule=True):
        self.store = Store(root)
        self.root = self.store.root
        if os.name == "posix":
            import fcntl
            self.authority_lock = open(self.root / "authority.lock", "a")
            try:
                fcntl.flock(self.authority_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except Exception:
                self.authority_lock.close()
                self.store.db.close()
                raise
        from .cluster import Clusters
        self.clusters = Clusters(self)
        self.stop_event = threading.Event()
        self.compute_setup_lock = threading.Lock()
        self.processes = {}
        self.provenance = {}
        for run in self.store.runs():
            if run["status"] == "validating":
                self.store.update(run, status="draft", validation={"status":"blocked","message":"Service restarted during validation; validate again"})
        if schedule:
            self.scheduler = threading.Thread(target=self.loop, daemon=True)
            self.scheduler.start()
            self.cluster_monitor=threading.Thread(target=self.cluster_loop,daemon=True)
            self.cluster_monitor.start()

    def register_project(self, value):
        value = dict(value)
        if not value.get("name"):
            raise ValueError("Project name required")
        value.setdefault("id", secrets.token_hex(8))
        leaf(value["id"])
        policy = value.setdefault("policy", {})
        for key, default in {"engines": list(ENGINES), "gpus": [0], "max_seconds": 3600,
                             "max_concurrent": 1, "input_roots": [], "environments": []}.items():
            policy.setdefault(key, default)
        if not policy["input_roots"] or any(not Path(p).is_absolute() for p in policy["input_roots"]):
            raise ValueError("Explicit absolute input roots required")
        if not isinstance(policy["gpus"], list) or not policy["gpus"] or any(
                not isinstance(g, int) or g < 0 for g in policy["gpus"]):
            raise ValueError("GPU IDs must be nonnegative integers")
        if int(policy["max_seconds"]) <= 0 or int(policy["max_concurrent"]) <= 0:
            raise ValueError("Resource limits must be positive")
        policy["max_seconds"] = int(policy["max_seconds"])
        policy["max_concurrent"] = int(policy["max_concurrent"])
        if any(e not in SUPPORTED_ENGINES for e in policy["engines"]):
            raise ValueError("Unsupported engine authorization")
        self.clusters.validate_project_policies(value)
        return self.store.put("project", value)

    def register_environment(self, value):
        with self.store.lock:
            return self._register_environment(value)

    def _register_environment(self, value):
        value = dict(value)
        draft_id=value.pop('setup_draft_id',None)
        draft=None
        if draft_id is not None:
            leaf(draft_id)
            draft=self.store.get('environment-draft',draft_id)
            if draft.get('status')!='draft':raise ValueError('This setup proposal has already been saved; read the current registered environment')
        if not value.get("name") or not isinstance(value.get("executables"), dict):
            raise ValueError("Environment name and absolute executable paths required")
        for path in [*value["executables"].values(), *value.get("repositories", {}).values(), *value.get("skills", {}).values()]:
            if not Path(path).is_absolute():
                raise ValueError("Environment paths must be absolute Linux paths")
        value.setdefault("id", secrets.token_hex(8))
        leaf(value["id"])
        value["provider"] = "wsl"
        if draft is not None:
            self.store.put_many([('environment',value),('environment-draft',{**draft,'status':'applied','environment_id':value['id'],'applied_at':time.time()})])
            return value
        return self.store.put("environment", value)

    def authorize(self, spec):
        project = self.store.get("project", spec["project_id"])
        policy = project["policy"]
        if spec["engine"] not in policy["engines"]:
            raise PermissionError("Engine is not authorized")
        if spec["environment_id"] not in policy["environments"]:
            raise PermissionError("Environment is not authorized")
        if spec["gpu"] not in policy["gpus"]:
            raise PermissionError("GPU is not authorized")
        if not 0 < int(spec["max_seconds"]) <= int(policy["max_seconds"]):
            raise PermissionError("Duration exceeds project authorization")
        return project, self.store.get("environment", spec["environment_id"])

    def prepare(self, spec):
        spec = dict(spec)
        for key in ("project_id", "environment_id", "engine", "inputs", "gpu", "max_seconds", "idempotency_key"):
            if key not in spec:
                raise ValueError("Missing " + key)
        if not isinstance(spec["idempotency_key"], str) or not 1 <= len(spec["idempotency_key"]) <= 128:
            raise ValueError("Bounded idempotency_key required")
        if not isinstance(spec["inputs"], dict) or not spec["inputs"]:
            raise ValueError("Explicit inputs required")
        spec["max_seconds"] = int(spec["max_seconds"])
        project, environment = self.authorize(spec)
        if spec.get("workflow_id") and self.store.get("workflow",spec["workflow_id"])["project_id"] != project["id"]:
            raise PermissionError("Workflow belongs to another project")
        roots = list(project["policy"]["input_roots"]) + [str(self.root / "projects" / project["id"] / "inputs")]
        if spec.get("parent_run"):
            parent = self.store.run(spec["parent_run"])
            if parent["project_id"] != project["id"] or parent["status"] not in TERMINAL:
                raise PermissionError("Invalid continuation parent")
            roots.append(parent["directory"])
        if spec.get("revision_of"):
            previous = self.store.run(spec["revision_of"])
            if previous["project_id"] != project["id"] or previous["status"] not in ("draft", "ready"):
                raise PermissionError("Only an unsubmitted run in the same project can be revised")
            roots.append(previous["directory"])
        request_hash = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()
        with self.store.lock:
            previous = self.store.by_key(spec["project_id"], spec["idempotency_key"])
            if previous:
                if previous["request_hash"] != request_hash:
                    raise ValueError("Idempotency key already used for a different request")
                return previous
            command = Adapter(spec["engine"]).prepare(spec, environment)
            from .private_lineage import propagate,check_producer,versions_for
            selected_paths=[]
            for input_name,input_source in spec['inputs'].items():
                self.input_name(input_name);candidate=contained(input_source,roots)
                if not candidate.is_file():raise ValueError('Input unavailable: '+input_name)
                selected_paths.append(str(candidate))
            check_producer(self,spec)
            private_entries=propagate(self,selected_paths,project['id'])
            private_versions=versions_for(self,selected_paths)
            identifier = secrets.token_hex(12)
            prefix = spec.get("directory_name", "")
            if prefix and (not isinstance(prefix, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", prefix)):
                raise ValueError("Invalid scoped working directory name")
            directory = self.root / "runs" / ((prefix+"-" if prefix else "")+identifier)
            (directory / "simulation").mkdir(parents=True)
            (directory / "results").mkdir()
            snapshots = []
            try:
                for name, source in spec["inputs"].items():
                    self.input_name(name)
                    path = contained(source, roots)
                    if not path.is_file():
                        raise ValueError("Input unavailable: " + name)
                    destination = directory / "simulation" / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    (directory / "results" / name).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(path, destination)
                    shutil.copyfile(destination, directory / "results" / name)
                    snapshots.append({"name": name, "source": str(path), "sha256": digest(destination),
                                      "size": destination.stat().st_size})
                    destination.chmod(0o444)
                input_contract = Adapter(spec["engine"]).input_contract(spec, directory / "simulation") if spec["engine"]=="gpumd.neb" else None
                run = {**spec, "id": identifier, "name": spec.get("name", spec["engine"]),
                       "request_hash": request_hash, "status": "draft", "validation": {"status": "not_run"},
                       "directory": str(directory), "snapshots": snapshots, "command": command,
                       **({"private_cv_entries":private_entries} if private_entries else {}),
                       **({"input_contract":input_contract} if input_contract is not None else {}),
                       "private_cv_versions":private_versions,
                       "seed": spec.get("parameters",{}).get("seed"),
                       "seed_note": "See immutable engine inputs; unspecified RNG defaults are not inferred",
                       "created_at": time.time(), "updated_at": time.time(),
                       "environment_snapshot": environment, "identity": None}
                atomic_json(directory / "reproduction.json", run)
                self.store.add_run(run)
                if spec.get("workflow_id"):
                    workflow=self.store.get("workflow",spec["workflow_id"])
                    workflow["run_ids"].append(run["id"])
                    self.store.put("workflow",workflow)
                return run
            except Exception:
                shutil.rmtree(directory)
                raise

    def input_file(self, identifier, name):
        run = self.store.run(identifier)
        if name not in {asset["name"] for asset in run["snapshots"]}:
            raise ValueError("Select a recorded immutable input")
        root = Path(run["directory"]) / "simulation"
        path = contained(root / name, [root])
        asset = next(x for x in run["snapshots"] if x["name"] == name)
        if digest(path) != asset["sha256"]:
            raise ValueError("Immutable snapshot changed")
        result = {"name":name, "size":path.stat().st_size, "sha256":asset["sha256"]}
        if result["size"] > 2 * 1024 * 1024:
            return {**result, "editable":False, "reason":"Input exceeds text review limit"}
        try:
            text = path.read_text(encoding="utf-8")
            if "\x00" in text:
                raise UnicodeError()
            return {**result, "editable":True, "text":text}
        except UnicodeError:
            return {**result, "editable":False, "reason":"Binary input; review SHA256 and source"}

    def revise(self, identifier, changes, edits):
        with self.store.lock:
            parent = self.store.run(identifier)
            allowed = ("name","engine","environment_id","gpu","max_seconds","inputs","parameters")
            spec = {k:parent[k] for k in ("project_id",*allowed) if k in parent}
            if any(k not in allowed and k != "idempotency_key" for k in changes):
                raise ValueError("Unsupported review field")
            spec.update({k:v for k,v in changes.items() if k in allowed})
            spec.update(revision_of=parent["id"], origin=parent.get("origin","desktop"),
                idempotency_key=changes["idempotency_key"])
            if not isinstance(edits,dict):
                raise ValueError("Explicit text edits required")
            prepared = self.store.by_key(spec["project_id"], spec["idempotency_key"])
            edit_hash = hashlib.sha256(json.dumps(edits, sort_keys=True).encode()).hexdigest()
            if prepared:
                if prepared.get("revision_of") != identifier or prepared.get("review_changes") != changes or prepared.get("review_edit_hash") != edit_hash:
                    raise ValueError("Idempotency key already used for different reviewed inputs")
                return prepared
            if parent["status"] not in ("draft", "ready"):
                raise ValueError("Submitted inputs cannot be revised")
            inputs = dict(spec["inputs"])
            staging = self.root / "projects" / parent["project_id"] / "inputs" / ("review-"+secrets.token_hex(12))
            staging.mkdir(parents=True)
            retained = False
            try:
                for name,content in edits.items():
                    self.input_name(name)
                    if name not in inputs or not isinstance(content,str) or len(content.encode()) > 2*1024*1024:
                        raise ValueError("Invalid reviewed text input")
                    target = staging / name
                    target.parent.mkdir(parents=True,exist_ok=True)
                    target.write_text(content,encoding="utf-8")
                    inputs[name] = str(target)
                spec["inputs"] = inputs
                run = self.prepare(spec)
                retained = True
                self.store.update(run, review_changes=changes, review_edit_hash=edit_hash)
                atomic_json(Path(run["directory"])/"reproduction.json",run)
                self.store.update(parent,status="cancelled",superseded_by=run["id"],cancel_reason="review_revision")
                return run
            finally:
                if not retained:
                    shutil.rmtree(staging)

    def verify_snapshot(self, run):
        for asset in run["snapshots"]:
            for folder in ("simulation", "results"):
                path = Path(run["directory"]) / folder / asset["name"]
                if not path.is_file() or digest(path) != asset["sha256"]:
                    raise ValueError("Input changed after preparation: " + asset["name"])

    def validate(self, identifier):
        with self.store.lock:
            run = self.store.run(identifier)
            if run["status"] not in ("draft", "ready"):
                raise ValueError("Only an unsubmitted run can be validated")
            self.authorize(run)
            self.store.update(run, status="validating")
        try:
            self.verify_snapshot(run)
            key = json.dumps({"engine":run["engine"], "environment":run["environment_snapshot"]}, sort_keys=True)
            current_probe = None
            if run["engine"] == "pydyn.md" or key not in self.provenance:
                try:
                    current_probe = Adapter(run["engine"]).probe(run["environment_snapshot"])
                except Exception as exc:
                    current_probe = {"status":"blocked", "error":str(exc)}
                self.provenance[key] = current_probe
            run["provenance"] = current_probe if run["engine"] == "pydyn.md" else self.provenance[key]
            from .cell_derivative_contract import derive as derive_cell_contract
            contract=derive_cell_contract(self,run)
            self.verify_snapshot(run)
            options = {"cell_derivative_contract": contract}
            if run["engine"] == "pydyn.md":
                # Reuse only this invocation's fresh observation, never cached provenance.
                options["probe_report"] = current_probe
            report = Adapter(run["engine"]).validate(run, run["environment_snapshot"],
                                                     Path(run["directory"]) / "results", **options)
            self.store.update(run, status="ready", validation=report)
        except Exception as exc:
            self.store.update(run, status="draft", validation={"status": "failed", "message": str(exc)})
        atomic_json(Path(run["directory"]) / "validation.json", run["validation"])
        return run

    def submit(self, identifier):
        with self.store.lock:
            run = self.store.run(identifier)
            if run["status"] in ("queued", "running", *TERMINAL):
                return run
            self.authorize(run)
            if run["status"] != "ready" or run["validation"]["status"] != "passed":
                raise ValueError("Successful validation required before submission")
            self.verify_snapshot(run)
            return self.store.update(run, status="queued")

    def cancel(self, identifier):
        with self.store.lock:
            run = self.store.run(identifier)
            self.authorize(run)
            if run["status"] == "queued":
                return self.store.update(run, status="cancelled")
            if run["status"] not in ("running", "unknown"):
                return run
            if not Adapter(run["engine"]).cancel(run):
                raise ValueError("Unknown process identity; no signal was sent")
            return self.store.update(run, cancel_requested=True)

    def tick(self):
        with self.store.lock:
            for run in self.store.runs():
                if run["status"] not in ("running", "unknown"):
                    continue
                directory = Path(run["directory"])
                receipt = directory / "exit.json"
                if receipt.exists():
                    result = json.loads(receipt.read_text())
                    state = "failed" if result.get("reason") == "time_limit" else (
                        "cancelled" if result["cancelled"] else "succeeded" if result["exit_code"] == 0 else "failed")
                    self.store.update(run, status=state, exit=result)
                    process = self.processes.pop(run["id"], None)
                    if process:
                        process.wait(timeout=2)
                    atomic_json(directory / "reproduction.json", run)
                elif alive(run.get("identity")):
                    if run["status"] == "unknown":
                        self.store.update(run, status="running")
                elif time.time() - run.get("started_at", 0) > 2:
                    self.store.update(run, status="unknown")
            runs = self.store.runs()
            busy = [r for r in runs if r["status"] in ("running", "unknown")]
            for run in reversed(runs):
                if run["status"] != "queued":
                    continue
                try:
                    project, _ = self.authorize(run)
                    if any(r["gpu"] == run["gpu"] for r in busy):
                        continue
                    if sum(r["project_id"] == run["project_id"] for r in busy)+sum(r["project_id"]==run["project_id"] and r["status"] in ("queued","running","unknown") for r in self.store.list("cluster-run")) >= project["policy"]["max_concurrent"]:
                        continue
                    self.verify_snapshot(run)
                    directory = Path(run["directory"])
                    atomic_json(directory / "launch.json", {"command": run["command"],
                                "environment": process_env(run["environment_snapshot"], run["gpu"]),
                                "max_seconds": run["max_seconds"]})
                    env = os.environ.copy()
                    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1])
                    process = subprocess.Popen([sys.executable, "-m", "studio_worker.runner", str(directory)],
                                               env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                               stderr=subprocess.DEVNULL, start_new_session=True)
                    self.processes[run["id"]] = process
                    self.store.update(run, status="running", identity=identity(process.pid), started_at=time.time())
                    busy.append(run)
                except Exception as exc:
                    self.store.update(run, status="failed", error=str(exc))

    def cluster_loop(self):
        while not self.stop_event.wait(15):
            try:
                self.clusters.tick()
            except Exception:
                self.store.event(None,{"kind":"cluster","error":"Remote monitor unavailable; state remains unknown"})

    def loop(self):
        while not self.stop_event.wait(0.3):
            try:
                self.tick()
            except Exception as exc:
                self.store.event(None, {"error": str(exc)})

    def close(self):
        self.stop_event.set()
        self.clusters.close()
        if hasattr(self, "scheduler"):
            self.scheduler.join(3)
        if hasattr(self, "authority_lock"):
            self.authority_lock.close()

    def collect(self, identifier):
        run = self.store.run(identifier)
        return {"run": run["id"], "artifacts": Adapter(run["engine"]).collect(
                Path(run["directory"]) / "results"), "validation": run["validation"]}

    def log(self, identifier, offset=0):
        run = self.store.run(identifier)
        path = Path(run["directory"]) / "console.log"
        if not path.exists():
            return {"text": "", "offset": 0}
        with open(path, "rb") as stream:
            stream.seek(min(max(0, int(offset)), path.stat().st_size))
            data = stream.read(256 * 1024)
            return {"text": data.decode("utf-8", "replace"), "offset": stream.tell()}

    def file(self, identifier, name, offset=0):
        run = self.store.run(identifier)
        root = Path(run["directory"]) / "results"
        path = contained(root / name, [root])
        if not path.is_file():
            raise ValueError("Artifact unavailable")
        if path.suffix.lower() in (".png",".jpg",".jpeg",".webp"):
            if path.stat().st_size > 4*1024*1024:
                raise ValueError("Image preview limit is 4 MiB")
            mime="image/png" if path.suffix.lower()==".png" else "image/webp" if path.suffix.lower()==".webp" else "image/jpeg"
            return {"name":name,"image":"data:"+mime+";base64,"+base64.b64encode(path.read_bytes()).decode(),"size":path.stat().st_size}
        with open(path, "rb") as stream:
            stream.seek(max(0, int(offset)))
            data = stream.read(256 * 1024)
            return {"name": name, "text": data.decode("utf-8", "replace"),
                    "offset": stream.tell(), "size": path.stat().st_size}

    def diagnose_tools(self):
        result=[]
        for environment in self.store.list("environment"):
            executables={k:{"status":"passed" if Path(v).is_file() and os.access(v,os.X_OK) else "blocked","scope":"Executable file availability only"} for k,v in environment["executables"].items()}
            repositories={k:{"status":"passed" if Path(v).is_dir() else "blocked","scope":"Source directory availability only"} for k,v in environment.get("repositories",{}).items()}
            result.append({"id":environment["id"],"name":environment["name"],"executables":executables,"repositories":repositories,"runtime_validation":"not_run","scientific_validation":"not_run"})
        return {"environments":result,"adapters":list(ENGINES),"pending_adapters":["torchnep.train","nepmaker","activemiao","external-dft"],"scope":"Read-only inventory. Probe exact routes separately; no calculation executed."}

    def authoring(self, data, operation):
        if operation=='render_pygas':
            from .pygas_composition import save
            result=save(self,data);result.pop('catalog',None);result.pop('assets',None);return result
        project=self.store.get("project",data["project_id"])
        if data["environment_id"] not in project["policy"]["environments"]:raise PermissionError("Environment is not authorized")
        environment=self.store.get("environment",data["environment_id"])
        payload={}
        if operation=="create_structure":
            recipe=dict(data["recipe"]);payload["recipe"]=recipe
            if recipe.get("kind")=="import":
                roots=project["policy"]["input_roots"]+[str(self.root/"projects"/project["id"]/"inputs")]
                payload["input_path"]=str(contained(recipe.pop("path"),roots))
            target=self.root/"projects"/project["id"]/"inputs"/("structure-"+secrets.token_hex(8)+".xyz")
            target.parent.mkdir(parents=True,exist_ok=True);payload["output_path"]=str(target)
        else:
            source=self.store.get("source-project",data["source_id"])
            if source["id"]!="pygas":raise ValueError("Select the pyGAS authoring source")
            payload={"source_root":source["root"],"graph":data["graph"]}
        result=run_json(environment["executables"]["python"],SCIENTIFIC,operation,payload,process_env(environment),timeout=90)
        if operation=="create_structure":
            if data.get("external_provenance"):result["provenance"]["external"]=data["external_provenance"]
            atomic_json(target.with_suffix(".provenance.json"),result["provenance"])
            result["artifact"]=self.store.put("artifact",{"id":secrets.token_hex(10),"project_id":project["id"],"name":target.name,"path":str(target),"kind":"structure","sha256":result["sha256"],"size":target.stat().st_size,"metadata":json.loads(json.dumps(result))})
        else:
            directory=self.root/"projects"/project["id"]/"inputs"/("cv-"+secrets.token_hex(8));directory.mkdir(parents=True)
            source_file=directory/"build_bias.py";graph_file=directory/"workflow.json"
            source_file.write_text(result["source"],encoding="utf-8");atomic_json(graph_file,result["graph"])
            result["files"]=[str(source_file),str(graph_file)]
            result["input_sha256"]={p.name:digest(p) for p in (source_file,graph_file)}
            result["source_preview"]="\n".join(result["source"].splitlines()[1:])[:1200]
            if not data.get("return_source",False):result.pop("source",None)
        return result

    def inspect(self, project_id, environment_id, path, kind="dataset", frame=0, intent=None):
        if kind not in ("dataset","structure","regression","suggest"):raise ValueError("inspect_asset supports structure/dataset/regression; use read_project_input for script/config/model metadata")
        project = self.store.get("project", project_id)
        if environment_id not in project["policy"]["environments"]:
            raise PermissionError("Environment is not authorized")
        environment = self.store.get("environment", environment_id)
        roots = project["policy"]["input_roots"] + [str(self.root / "projects" / project_id / "inputs")] + [r["directory"] for r in self.store.runs() if r["project_id"] == project_id]
        path = contained(path, roots)
        return run_json(environment["executables"]["python"], SCIENTIFIC, kind,
                        {"path": str(path), "frame": frame,"intent":intent or {}}, process_env(environment))

    @staticmethod
    def input_name(name):
        if not isinstance(name, str) or not name or "\\" in name or ":" in name or name.startswith("/") or len(name)>240:
            raise ValueError("Relative input filename required")
        for part in name.split("/"):
            leaf(part)
        return name

    def export(self, identifier):
        run = self.store.run(identifier)
        collected = self.collect(identifier)
        buffer = io.BytesIO()
        included, omitted, budget = [], [], 32 * 1024 * 1024
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for asset in run["snapshots"]:
                path = Path(run["directory"]) / "simulation" / asset["name"]
                if digest(path) != asset["sha256"]:
                    raise ValueError("Immutable input snapshot changed")
                if path.stat().st_size <= budget:
                    archive.write(path, "inputs/" + asset["name"])
                    included.append(asset["name"])
                    budget -= path.stat().st_size
                else:
                    omitted.append({**asset, "reason":"32 MiB bundle limit; supply original by hash"})
            archive.writestr("reproduction.json", json.dumps({"run":run, **collected,
                "exported_at":time.time(), "included_inputs":included, "omitted_inputs":omitted}, indent=2))
            archive.writestr("README.txt", "Inputs are immutable copies. Large inputs are listed by source and SHA256. Logs and output hashes are recorded; scientific validity is separate from process completion.")
        return {"base64":base64.b64encode(buffer.getvalue()).decode(), "omitted_inputs":omitted}

    def resume(self, identifier, parameters):
        run = self.store.run(identifier)
        if run["status"] not in TERMINAL:
            raise ValueError("A continuation requires a terminal parent")
        parameters = dict(parameters)
        inputs = {x["name"]:str(Path(run["directory"])/"simulation"/x["name"]) for x in run["snapshots"]}
        results = Path(run["directory"])/"results"
        names = parameters.get("checkpoint_files", [])
        for name in names:
            self.input_name(name)
            path = contained(results/name,[results])
            if not path.is_file():
                raise ValueError("Checkpoint unavailable")
            inputs[name] = str(path)
        if run["engine"] == "hotpp.train":
            checkpoint = parameters.get("checkpoint")
            if checkpoint not in inputs or checkpoint not in names:
                raise ValueError("Select an actual HotPP checkpoint")
            inputs["resume.ckpt"] = inputs.pop(checkpoint)
            parameters["checkpoint"] = "resume.ckpt"
            continuation = parameters.get("continuation_config")
            if not continuation:
                raise ValueError("Supply continuation_config with explicit additional training limits")
            project,_ = self.authorize(run)
            inputs["input.yaml"] = str(contained(continuation,project["policy"]["input_roots"]))
        elif run["engine"] in ("gpumd.md","gpumd.sampling"):
            if "restart.xyz" not in names:
                raise ValueError("GPUMD continuation requires restart.xyz")
            continuation = parameters.get("continuation_run_in")
            if not continuation:
                raise ValueError("Supply continuation_run_in explicitly; no implicit velocity or thermostat reset")
            project,_ = self.authorize(run)
            target = contained(continuation, project["policy"]["input_roots"])
            if any(line.split("#")[0].strip().startswith("velocity") for line in target.read_text().splitlines()):
                raise ValueError("Continuation input must preserve restart velocities")
            if run["engine"] == "gpumd.sampling" and run["parameters"]["mode"] != "static":
                raise ValueError("History-dependent GPUMD sampling requires an explicit workflow with its independent restart contract")
            inputs["run.in"] = str(target)
            inputs["model.xyz"] = inputs.pop("restart.xyz")
        elif run["engine"].startswith("pydyn."):
            continuation = parameters.get("continuation_script")
            if not continuation or not names:
                raise ValueError("Supply an explicit continuation_script and checkpoint files")
            project,_ = self.authorize(run)
            inputs["run.py"] = str(contained(continuation,project["policy"]["input_roots"]))
            if run["engine"] == "pydyn.sampling":
                manifest_name = parameters.get("paired_manifest")
                if manifest_name not in names:
                    raise ValueError("Explicit paired_manifest required")
                manifest = json.loads((results/manifest_name).read_text())
                if manifest.get("schema") != "pydyn-pygas-pair-v1":
                    raise ValueError("Unknown paired checkpoint schema")
                for entry in manifest["files"].values():
                    name = str(Path(manifest_name).parent/entry["path"])
                    self.input_name(name)
                    target = contained(results/name,[results])
                    if digest(target) != entry["sha256"]:
                        raise ValueError("Paired checkpoint hash mismatch")
                    inputs[name] = str(target)
        else:
            raise ValueError("This engine does not declare a checkpoint continuation")
        spec = {key:run[key] for key in ("project_id","environment_id","engine","gpu","max_seconds")}
        spec.update(inputs=inputs,parameters={**run.get("parameters",{}),**parameters},
            parent_run=run["id"],name=run["name"]+" 路 continuation",idempotency_key=parameters["idempotency_key"])
        return self.prepare(spec)
