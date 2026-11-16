"""Freeze a confirmed graph once and drive its invocation DAG on the worker."""
import csv
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import time

from studio_worker.compute.ssh_service import require_local_execution
from studio_worker.infrastructure.util import contained
from studio_worker.tools.adapters import Adapter, run_process_env
from studio_worker.tools.package_contract import encoded, sha
from studio_worker.transport.roadmap import validate_roadmap
from studio_worker.transport.task_schema import field_key
from studio_worker.workspace.layout import directory, new_run_directory
from studio_worker.workspace.roadmap_tools import TOOLS, FORMATS, accept_goal, consumed, file_identity, md_ports, check_md_parameters, md_velocity_source, tool_identity
from studio_worker.workspace.roadmap_group import bind_group


def exact(data, keys):
    if type(data) is not dict or set(data) != set(keys):
        raise ValueError("Exact roadmap execution request required")


def token(value):
    if type(value) is not str or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}",value):
        raise ValueError("Invalid workflow identity")
    return value


def field(parameters, path):
    field_key(path)
    value = parameters
    for part in path.split("."):
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value,list) and part.isascii() and part.isdecimal() and int(part)<len(value):
            value = value[int(part)]
        else:
            raise ValueError("Missing bound workflow parameter: "+path)
    return value


def bound_file(resource, parameters, roots):
    value = field(parameters, resource.get("field",""))
    files = value if isinstance(value,list) else [value]
    if resource.get("file_name"):
        files = [name for name in files if isinstance(name,str) and Path(name).name==resource["file_name"]]
    if len(files)!=1 or not isinstance(files[0],str) or not Path(files[0]).is_absolute():
        raise ValueError("One exact file is required for "+resource["label"])
    path = contained(files[0], roots)
    if not path.is_file():
        raise ValueError("Input is unavailable: "+resource["label"])
    return {"resource":resource["id"],"path":str(path),**file_identity(path)}


def freeze_file(asset, target):
    temp = target.with_name(".copy-"+secrets.token_hex(12))
    hasher = hashlib.sha256()
    try:
        with open(asset["path"],"rb") as source, temp.open("xb") as dest:
            while block := source.read(1024*1024):
                dest.write(block)
                hasher.update(block)
            dest.flush()
            os.fsync(dest.fileno())
        if hasher.hexdigest()!=asset["sha256"] or temp.stat().st_size!=asset["size"]:
            raise ValueError("Input changed after review: "+asset["resource"])
        temp.chmod(0o444)
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)


def step_parameters(step, parameters):
    if "parameter_field" in step:
        value = field(parameters, step["parameter_field"])
    elif step["tool"]=="gpumd.md":
        keys = ("steps","n_steps","time_step_fs","timestep_fs","temperature","temperature_K","temperature_k","ensemble","duration_ps","md")
        value = {key:parameters[key] for key in keys if key in parameters}
    else:
        value = {}
    if not isinstance(value,dict) or (step["tool"]=="trajectory.density" and value):
        raise ValueError("Unsupported invocation parameters on "+step["id"])
    return value


def compile_graph(service, data):
    require_local_execution(service)
    exact({key:value for key,value in data.items() if key not in ("node_environments","tool_group","workspace")}, ("task_id","name","original_request","revision","roadmap","parameters","target"))
    token(data["task_id"])
    if not isinstance(data["name"],str) or not isinstance(data["original_request"],str) or not isinstance(data["parameters"],dict):
        raise ValueError("Original workflow intent and parameter binding required")
    graph, target = data["roadmap"], data["target"]
    validate_roadmap(graph,field_key)
    exact(target,("project_id","environment_id","gpu","max_seconds"))
    if type(target["gpu"]) is not int or type(target["max_seconds"]) is not int:
        raise ValueError("Explicit deployment resources required")
    if not graph["outputs"] or not graph["steps"]:
        raise ValueError("Define the deliverables and their producing tools first")
    project = service.store.get("project",token(target["project_id"]))
    if project.get("authoring_only"):
        raise PermissionError("Select a compute project; an authoring workspace cannot run this graph")
    token(target["environment_id"])
    node_envs = data.get("node_environments",{})
    if not isinstance(node_envs,dict) or set(node_envs)-{s["id"] for s in graph["steps"]}:
        raise ValueError("Unknown per-node environment binding")
    roots = [*project["policy"]["input_roots"],str(service.root/"projects"/project["id"]/"inputs")]
    resources = {item["id"]:item for item in graph["resources"]}
    initial = {rid:bound_file(resources[rid],data["parameters"],roots) for rid in graph["inputs"]}
    producers = {binding["resource"]:(step,binding["port"]) for step in graph["steps"] for binding in step["outputs"]}
    groups = bind_group(graph,data.get("tool_group"))
    by_id = {node["id"]:node for node in graph["steps"]}
    ordered, visited, visiting, used = [], set(), set(), set()

    def visit(step):
        key = step["id"]
        if key in visiting:
            raise ValueError("Cyclic combined group and artifact dependencies")
        if key in visited:
            return
        visiting.add(key)
        for dependency in groups.get(key,{}).get("depends_on",[]):
            visit(by_id[dependency])
        for item in step["inputs"]:
            trace(item["resource"])
        visiting.remove(key)
        visited.add(key)
        ordered.append(step)

    def trace(rid):
        used.add(rid)
        if rid in initial:
            return
        if rid not in producers:
            raise ValueError("No producer for "+rid)
        step, _ = producers[rid]
        visit(step)

    for goal in graph["outputs"]:
        if goal not in producers:
            raise ValueError("A deliverable needs a producing invocation: "+goal)
        trace(goal)
    if len(visited)!=len(graph["steps"]) or set(initial)-used:
        raise ValueError("Resolve steps or initial inputs disconnected from the requested deliverables")
    steps, versions = [], {}
    for source in ordered:
        engine = source["tool"]
        if engine not in TOOLS:
            raise ValueError("No registered execution adapter for "+engine)
        tool = TOOLS[engine]
        if any(value!="potential" or engine!="gpumd.md" for value in source.get("runtime",{}).values()):
            raise ValueError("This workflow adapter does not bind the declared in-process component on "+source["id"])
        node_target = {**target,"environment_id":token(node_envs.get(source["id"],target["environment_id"]))}
        _, env = service.authorize({**node_target,"engine":engine})
        key = (engine,env["id"])
        if key not in versions:
            versions[key] = tool_identity(engine,env)
        ins = {p["port"]:p["resource"] for p in source["inputs"]}
        outs = {p["port"]:p["resource"] for p in source["outputs"]}
        if set(ins)!=set(tool["inputs"]) or not outs or set(outs)-set(tool["outputs"]):
            raise ValueError("Registered ports differ from invocation "+source["id"])
        filenames = {p:v[0] for p,v in tool["inputs"].items()}
        for port,rid in ins.items():
            if rid in producers:
                parent,parent_port = producers[rid]
                if TOOLS[parent["tool"]]["outputs"][parent_port][1] != tool["inputs"][port][1]:
                    raise ValueError("Incompatible artifact for "+source["id"]+"."+port)
        controls = []
        initialization = {}
        if engine=="gpumd.md":
            if ins["control"] not in initial:
                raise ValueError("This MD adapter requires the control file at confirmation")
            filenames["potential"], controls = md_ports(initial[ins["control"]],outs)
            if ins["structure"] in initial:
                initialization = md_velocity_source(initial[ins["structure"]]["path"],controls)
            if ins["potential"] not in initial:
                raise ValueError("This MD adapter requires a frozen self-contained potential")
            with open(initial[ins["potential"]]["path"],"rb") as file:
                potential_type = file.readline(4096).split(maxsplit=1)[0:1]
            if not potential_type or not re.fullmatch(rb"nep[34](?:_zbl)?|tersoff_1989|tersoff_1988",potential_type[0]):
                raise ValueError("This adapter requires a self-contained NEP3/NEP4 or Tersoff potential")
        for port,rid in outs.items():
            declared = resources[rid].get("format")
            actual = tool["outputs"][port][1]
            aliases = {"gpumd.thermo":{"text","txt"},"density.csv":{"csv"}}
            if declared and declared!=actual and declared not in aliases.get(actual,set()):
                raise ValueError("Declared output format differs from registered port: "+rid)
        parameters = step_parameters(source,data["parameters"])
        group_node = groups.get(source["id"],{})
        bound_parameters = group_node.get("parameters",{})
        if any(key in parameters and parameters[key]!=value for key,value in bound_parameters.items()):
            raise ValueError("Parameters differ from the frozen tool group")
        parameters = {**parameters,**bound_parameters}
        if controls:
            check_md_parameters(parameters,controls)
        argv = Adapter(engine).prepare({"engine":engine,"parameters":parameters,"inputs":dict.fromkeys(filenames.values()),
                                        "studio_workflow_binding":{"schema_version":2}},env)
        if engine=="gpumd.md" and argv!=[versions[key]["executable"]]:
            raise ValueError("Registered GPUMD command differs from its native file contract")
        process_environment = run_process_env({"engine":engine,"gpu":node_target["gpu"],"environment_snapshot":env,
                                              "studio_workflow_binding":{"schema_version":2}})
        steps.append({"id":source["id"],"label":source["label"],"tool":engine,"version":versions[key],"argv":argv,
                      "registered_function":group_node or None,"depends_on":group_node.get("depends_on",[]),
                      "environment":env,"environment_sha256":sha(encoded(env)),"process_environment":process_environment,"target":node_target,
                      "parameters":parameters,**({"native_controls":controls,"velocity_initialization":initialization or {"source":"upstream_structure"}} if controls else {}),
                      "inputs":{port:{"resource":rid,"name":filenames[port],
                                       "producer":({"step_id":producers[rid][0]["id"],"port":producers[rid][1]} if rid in producers else None)}
                                for port,rid in ins.items()},
                      "outputs":{port:{"resource":rid,"name":tool["outputs"][port][0],"format":tool["outputs"][port][1]} for port,rid in outs.items()}})
    return {"schema_version":1,"task_id":data["task_id"],"name":data["name"],"original_request":data["original_request"],
            "revision":data["revision"],"roadmap":graph,"task_parameters":data["parameters"],"target":target,"project_policy_sha256":sha(encoded(project["policy"])),
            "workspace":data.get("workspace"),"initial":initial,"steps":steps,"goals":[resources[key] for key in graph["outputs"]],
            **({"tool_group":data["tool_group"]} if groups else {})}


@dataclass(frozen=True)
class RoadmapContext:
    execution_id: str
    step_id: str
    token: object


def records(service, context):
    if not isinstance(context,RoadmapContext) or context.token is not service._tool_workflow_token:
        raise PermissionError("Worker-owned confirmed graph context required")
    state = service.store.get("roadmap-state",context.execution_id)
    snapshot = service.store.get("roadmap-snapshot",context.execution_id)["snapshot"]
    if sha(encoded(snapshot))!=state["snapshot_sha256"] or state["id"]!=context.execution_id:
        raise ValueError("Frozen graph identity changed")
    node = next(node for node in snapshot["steps"] if node["id"]==context.step_id)
    return state,snapshot,node,state["nodes"][context.step_id]


def binding(state, node):
    return {"schema_version":2,"workflow_id":state["task_id"],"execution_id":state["id"],"step_id":node["id"],
            "snapshot_sha256":state["snapshot_sha256"],"tool_version":node["version"]["version"]}


def prepare_binding(service, context, spec):
    state, _, node, active = records(service,context)
    if active["status"]!="preparing" or encoded(active["spec"])!=encoded(spec):
        raise PermissionError("Exact frozen invocation required")
    return binding(state,node)


def relative(execution_id):
    return "roadmap-executions/"+token(execution_id)


def run_directory(service,context,run_id):
    return new_run_directory(service.root,relative(context.execution_id)+"/steps/"+token(context.step_id),run_id)


def check_version(service,snapshot,node):
    project,environment = service.authorize({**node["target"],"engine":node["tool"]})
    registered_policy = service.store.get("project",project["id"])["policy"]
    if sha(encoded(registered_policy))!=snapshot["project_policy_sha256"] or environment!=node["environment"]:
        raise ValueError("Confirmed project policy or registered environment changed")
    if tool_identity(node["tool"],environment)!=node["version"]:
        raise ValueError("Frozen executable or tool implementation changed")


def check_run(service,state,node,active,run):
    if (run.get("studio_workflow_binding")!=binding(state,node) or run["request_hash"]!=active["request_hash"]
            or active.get("run_id") not in (None,run["id"]) or run["environment_snapshot"]!=node["environment"]
            or run["command"]!=node["argv"] or run["executable_snapshot"]["sha256"]!=node["version"]["executable_sha256"]
            or run_process_env(run)!=node["process_environment"]
            or Path(run["directory"])!=service.root/relative(state["id"])/"steps"/node["id"]/run["id"]):
        raise ValueError("Prepared run does not match the frozen node")
    actual = {a["name"]:(a["source"],a["sha256"],a["size"]) for a in run["snapshots"]}
    expected = {a["name"]:(a["path"],a["sha256"],a["size"]) for a in active["inputs"].values()}
    if actual!=expected:
        raise ValueError("Prepared input snapshot differs from its bound producer")


def assert_bound_run(service,run,context,phase):
    state,snapshot,node,active = records(service,context)
    if active["status"]!=phase:
        raise PermissionError("Confirmed graph phase required")
    check_version(service,snapshot,node)
    check_run(service,state,node,active,run)
    if phase=="validating":
        check_fresh_outputs(run,node)


def check_fresh_outputs(run,node):
    names = [ref["name"] for ref in node["outputs"].values()]
    consumer = TOOLS[node["tool"]].get("consumer_receipt")
    if consumer:
        names.append(consumer[1])
    for name in names:
        if os.path.lexists(Path(run["directory"])/"results"/name):
            raise ValueError("Output already exists before this invocation: "+name)


class RoadmapExecutions:
    def __init__(self,service):
        self.service = service
        self.store = service.store

    def preview(self,data):
        snapshot = compile_graph(self.service,data)
        return {"snapshot_sha256":sha(encoded(snapshot)),"snapshot":snapshot}

    def confirm(self,data):
        exact(data,("plan","snapshot_sha256"))
        expected = data["snapshot_sha256"]
        identifier = sha(encoded([token(data["plan"]["task_id"]),expected]))
        with self.service.tool_workflow_lock:
            if self.store.db_exists("roadmap-state",identifier):
                return self.status({"task_id":data["plan"]["task_id"],"execution_id":identifier})
            preview = self.preview(data["plan"])
            if expected!=preview["snapshot_sha256"]:
                raise ValueError("The reviewed graph, inputs or environment changed; review again")
            snapshot = preview["snapshot"]
            root = directory(self.service.root,relative(identifier)+"/inputs")
            from studio_worker.workspace.private_lineage import propagate, versions_for
            propagate(self.service,[asset["path"] for asset in snapshot["initial"].values()],snapshot["target"]["project_id"])
            private_versions = {}
            if self.store.list("private-cv-lineage"):
                private_versions = {rid:versions_for(self.service,[asset["path"]]) for rid,asset in snapshot["initial"].items()}
            for rid, asset in snapshot["initial"].items():
                freeze_file(asset,root/rid)
            state = {"id":identifier,"task_id":snapshot["task_id"],"snapshot_sha256":expected,
                     "confirmed_at":time.time(),"status":"running","nodes":{n["id"]:{"status":"pending"} for n in snapshot["steps"]},
                     "initial_private_versions":{rid:v for rid,v in private_versions.items() if v},
                     "artifacts":{},"goals":[accept_goal(g,None) for g in snapshot["goals"]]}
            self.store.put_many([("roadmap-snapshot",{"id":identifier,"snapshot":snapshot}),("roadmap-state",state)])
            return state

    def status(self,data):
        exact(data,("task_id","execution_id"))
        state = self.store.get("roadmap-state",token(data["execution_id"]))
        if state["task_id"]!=token(data["task_id"]):
            raise PermissionError("Execution belongs to another workflow")
        return state

    def list(self,data):
        exact(data,("task_id",))
        return [self.store.get("roadmap-state",key) for key in self.store.roadmap_ids(task_id=token(data["task_id"]))]

    def snapshot(self,data):
        state = self.status(data)
        snapshot = self.store.get("roadmap-snapshot",state["id"])["snapshot"]
        if sha(encoded(snapshot))!=state["snapshot_sha256"]:
            raise ValueError("Stored snapshot identity changed")
        return {"snapshot_sha256":state["snapshot_sha256"],"snapshot":snapshot}

    def _build(self,state,snapshot,node):
        inputs = {}
        for port,ref in node["inputs"].items():
            rid = ref["resource"]
            if ref["producer"]:
                asset = state["artifacts"][rid]
                producer = ref["producer"]
                if asset["producer"]!={"step_id":producer["step_id"],"port":producer["port"],"run_id":state["nodes"][producer["step_id"]]["run_id"]}:
                    raise ValueError("Cross-run or cross-port artifact substitution")
            else:
                asset = {**snapshot["initial"][rid],"path":str(self.service.root/relative(state["id"])/"inputs"/rid)}
            if file_identity(asset["path"])!={key:asset[key] for key in ("size","sha256")}:
                raise ValueError("Bound input changed: "+rid)
            inputs[port] = {**asset,"name":ref["name"]}
        for name,path in TOOLS[node["tool"]]["files"].items():
            inputs["$"+name] = {"resource":"$"+name,"name":name,"path":str(path.resolve()),**file_identity(path)}
        return inputs

    def _start(self,state,snapshot,node,active,context):
        service = self.service
        check_version(service,snapshot,node)
        inputs = self._build(state,snapshot,node)
        if node["tool"]=="gpumd.md":
            observed = md_velocity_source(inputs["structure"]["path"],node["native_controls"])
            expected = node["velocity_initialization"]
            if expected["source"]!="upstream_structure" and observed!=expected:
                raise ValueError("The frozen MD velocity initialization changed")
        spec = {**node["target"],"engine":node["tool"],"parameters":node["parameters"],"name":node["label"],
                "origin":"desktop","idempotency_key":"roadmap:"+sha(encoded([state["id"],node["id"]])),
                "inputs":{item["name"]:item["path"] for item in inputs.values()}}
        hashed = {**spec,"studio_workflow_binding":binding(state,node)}
        active.update(status="preparing",spec=spec,inputs=inputs,request_hash=sha(json.dumps(hashed,sort_keys=True).encode()))
        self.store.put("roadmap-state",state)
        run = service.prepare(spec,_workflow_context=context)
        check_run(service,state,node,active,run)
        active.update(run_id=run["id"],status="prepared")
        self.store.put("roadmap-state",state)
        return run

    def _submit(self,state,node,active,run,context):
        active.update(status="validating")
        self.store.put("roadmap-state",state)
        validated = self.service.validate(run["id"],_workflow_context=context)
        if validated["status"]!="ready" or validated["validation"].get("status")!="passed":
            raise ValueError(validated["validation"].get("message") or "Frozen invocation validation did not pass")
        active.update(status="submitting")
        self.store.put("roadmap-state",state)
        run = self.service.submit(run["id"],_workflow_context=context)
        active.update(status="submitted",run_status=run["status"])

    def _collect(self,state,node,active,run):
        check_run(self.service,state,node,active,run)
        self.service.verify_snapshot(run)
        receipt = run.get("exit") or {}
        claim = (run.get("launch_claim") or {}).get("token")
        if not claim or receipt.get("launch_claim")!=claim or receipt.get("exit_code")!=0:
            raise ValueError("Successful exit receipt for this exact run required")
        produced, errors = {}, []
        for port,ref in node["outputs"].items():
            path = Path(run["directory"])/"results"/ref["name"]
            try:
                observed = FORMATS[ref["format"]](path)
                produced[ref["resource"]] = {**ref,**observed,"path":str(path),"observed_at":time.time(),"producer":{"step_id":node["id"],"port":port,"run_id":run["id"]}}
            except (ValueError,OSError,KeyError,csv.Error,OverflowError) as exc:
                errors.append(port+": "+str(exc))
        active["consumed"] = consumed(run,active["inputs"],produced.values())
        state["artifacts"].update(produced)
        active.update(status="failed" if errors else "passed",run_status="succeeded",reason=" / ".join(errors) or None)

    def _advance_node(self,state,snapshot,node):
        active = state["nodes"][node["id"]]
        context = RoadmapContext(state["id"],node["id"],self.service._tool_workflow_token)
        if active["status"]=="pending":
            for dependency in node["depends_on"]:
                phase=state["nodes"][dependency]["status"]
                if phase!="passed":
                    if phase in ("failed","blocked","cancelled"):
                        active.update(status="blocked",reason="Unmet group prerequisite: "+dependency)
                    return
            for ref in node["inputs"].values():
                if ref["producer"] and ref["resource"] not in state["artifacts"]:
                    parent = state["nodes"][ref["producer"]["step_id"]]
                    if parent["status"] in ("failed","blocked","cancelled"):
                        active.update(status="blocked",reason="Required artifact unavailable: "+ref["resource"])
                    return
            run = self._start(state,snapshot,node,active,context)
        else:
            run = self.store.by_key(node["target"]["project_id"],active["spec"]["idempotency_key"])
            if not run:
                active.update(status="unknown",reason="No durable run receipt for the original preparation")
                return
            check_run(self.service,state,node,active,run)
            active["run_id"] = run["id"]
        if run["status"] in ("draft","ready"):
            if active["status"] in ("prepared","preparing","validating"):
                self._submit(state,node,active,run,context)
            else:
                active.update(status="unknown",reason="Submission unconfirmed; reconcile the original run")
        elif run["status"]=="succeeded":
            self._collect(state,node,active,run)
        elif run["status"] in ("failed","cancelled"):
            active.update(status=run["status"],run_status=run["status"],reason=run.get("launch_error") or run.get("error") or str(run.get("exit",{})))
        else:
            active.update(status="unknown" if run["status"]=="unknown" else "submitted",run_status=run["status"])

    def advance(self,key):
        with self.service.tool_workflow_lock:
            state = self.store.get("roadmap-state",key)
            if state["status"] not in ("running","unknown"):
                return
            snapshot = self.store.get("roadmap-snapshot",key)["snapshot"]
            if sha(encoded(snapshot))!=state["snapshot_sha256"]:
                state.update(status="failed",reason="Stored snapshot identity changed")
                self.store.put("roadmap-state",state)
                return
            before = encoded(state)
            for node in snapshot["steps"]:
                active = state["nodes"][node["id"]]
                if active["status"] in ("passed","failed","blocked","cancelled"):
                    continue
                try:
                    self._advance_node(state,snapshot,node)
                except (OSError,ValueError,KeyError,PermissionError,TypeError) as exc:
                    uncertain = active["status"] in ("preparing","submitting") and isinstance(exc,OSError) and not isinstance(exc,PermissionError)
                    active.update(status="unknown" if uncertain else "failed",reason=str(exc)[:2000])
            state["goals"] = [accept_goal(goal,state["artifacts"].get(goal["id"])) for goal in snapshot["goals"]]
            phases = {item["status"] for item in state["nodes"].values()}
            outcomes = {goal["status"] for goal in state["goals"]}
            if "unknown" in phases:
                state["status"] = "unknown"
            elif phases <= {"passed","failed","blocked","cancelled"}:
                state["status"] = ("failed" if phases!={"passed"} or outcomes & {"failed","unavailable"} else
                                   "needs_review" if "needs_review" in outcomes else "passed")
                state["finished_at"] = time.time()
            else:
                state["status"] = "running"
            if encoded(state)!=before:
                self.store.put("roadmap-state",state)

    def pump(self):
        for key in self.store.roadmap_ids(active=True):
            self.advance(key)
