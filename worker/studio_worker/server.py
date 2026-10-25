import re
import argparse
import hmac
import json
import os
import secrets
import sys
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from .adapters import Adapter, ENGINES
from .service import Service
from .runtime_projection import result_for_agent
from .templates import build_bias
from .task_schema import STEP_SCHEMA, validate_task
from .util import leaf, atomic_json, digest, contained

TOOL_ROUTES = {
 "describe_engine":("POST","/api/engine/describe",{"engine":"string"}),
 "diagnose_tools":("GET","/api/tools/status",{}),
 "suggest_parameters":("POST","/api/structures/suggest",{"project_id":"string","environment_id":"string","path":"string","intent":"object"}),
 "list_source_projects":("GET","/api/source-projects",{}),
 "inspect_source_project":("POST","/api/source-project/inspect",{"source_id":"string"}),
 "create_structure":("POST","/api/structures/create",{"project_id":"string","environment_id":"string","recipe":"object"}),
 "read_runtime_guide":("POST","/api/runtime-guide",{"environment_id":"string"}),
 "inspect_pygas_catalog":("POST","/api/pygas/catalog",{"source_id":"string"}),
 "render_pygas_workflow":("POST","/api/pygas/render",{"project_id":"string","environment_id":"string","source_id":"string","graph":"object"}),
 "collect_cluster_artifacts":("POST","/api/cluster/collect",{"run_id":"string"}),
 "read_cluster_input":("POST","/api/cluster/input",{"run_id":"string","name":"string"}),
 "read_cluster_result":("POST","/api/cluster/result",{"run_id":"string","name":"string"}),
 "present_task":("POST","/api/tasks/present",{"task_id":"string","name":"string","steps":"array","parameters":"object","missing_fields":"array"}),
 "read_cluster_skill":("POST","/api/cluster/skill",{"project_id":"string","cluster_id":"string"}),
 "cluster_browse":("POST","/api/cluster/browse",{"project_id":"string","cluster_id":"string","relative":"string"}),
 "list_clusters":("GET","/api/clusters",{}),
 "probe_cluster":("POST","/api/cluster/probe",{"cluster_id":"string"}),
 "draft_cluster_setup":("POST","/api/cluster/draft",{"project_id":"string","cluster_id":"string","proposal":"object"}),
 "prepare_cluster_run":("POST","/api/cluster/prepare",{"spec":"object"}),
 "cluster_run_status":("POST","/api/cluster/status",{"run_id":"string"}),
 "cluster_read_log":("POST","/api/cluster/log",{"run_id":"string"}),
 "list_workflows":("GET","/api/workflows",{}), "create_workflow":("POST","/api/workflows",{"project_id":"string","name":"string","steps":"array"}),
 "list_projects": ("GET", "/api/projects", {}), "list_environments": ("GET", "/api/environments", {}),
 "list_runs": ("GET", "/api/runs", {}), "probe_environment": ("POST", "/api/probe", {"environment_id": "string"}),
 "prepare_run": ("POST", "/api/runs/prepare", {"spec": "object"}),
 "validate_run": ("POST", "/api/run/validate", {"run_id": "string"}),
 "submit_run": ("POST", "/api/run/submit", {"run_id": "string"}),
 "cancel_run": ("POST", "/api/run/cancel", {"run_id": "string"}),
 "run_status": ("POST", "/api/run/status", {"run_id": "string"}),
 "read_log": ("POST", "/api/run/log", {"run_id": "string"}),
 "collect_artifacts": ("POST", "/api/run/collect", {"run_id": "string"}),
 "resume_run": ("POST", "/api/run/resume", {"run_id": "string", "parameters": "object"}),
 "inspect_asset": ("POST", "/api/inspect", {"project_id": "string", "environment_id": "string", "path": "string", "kind": "string"}),
 "read_project_input": ("POST", "/api/workspace/read", {"project_id":"string","name":"string"}),
 "write_project_input": ("POST", "/api/workspace/write", {"project_id": "string", "name": "string", "content": "string"}),
 "read_run_input": ("POST", "/api/run/input", {"run_id":"string", "name":"string"}),
 "read_artifact": ("POST", "/api/run/file", {"run_id": "string", "name": "string"})
}
DESCRIPTIONS = {
 "read_runtime_guide":"Read the selected registered environment and engine runtime receipt recorded by an actual probe. Returns observed execution paths, versions and source/capability identities, or explicit stale/blocked/not_run. Does not install, import, execute, switch versions or modify job state. Ordinary calculations reuse this instead of rereading installation instructions.",
 "inspect_pygas_catalog":"Read actual registered pyGAS GUI CV/bias/switch/neighbor constructor names, exact required/default parameters and source-bound editor/shape semantics. Without classes returns a compact class index; request up to four exact names for their typed parameter lists. Use these real library definitions before composing a graph; this is source inspection, never artifact/runtime/numerical proof.",
 "describe_engine":"Read the real Studio adapter parameter contract: required input basenames, canonical flat API keys, explicit nested aliases and valid modes. Use before publishing scientific workflows; technical wrapper fields are Agent responsibilities, not user questions. This is discovery only, never engine/artifact validation. parameters.validation is reserved for declared numerical FD controls; put runtime/scope/review diagnostics in step descriptions or a separate saved review manifest, not editable controls.",
 "read_project_input":"Read bounded text or binary metadata/SHA256 from project-owned inputs or existing authorized project roots. name accepts an owned relative path (including cv-*/build_bias.py) or authorized absolute Linux input path. Use for Python/JSON/config/model inputs; binary models are never deserialized. No interpreter needed. Use the returned sha256 as expected_sha256 when updating an existing input.",
 "write_project_input":"Save actual text in the project inputs root using safe relative names including nested cv-*/build_bias.py. Existing changed input requires expected_sha256 from read_project_input; on conflict re-read. Returns actual saved path/hash; never builds or executes.",
 "inspect_asset":"Inspect an ASE structure/dataset or existing NEP regression output directory (kind=structure, dataset or regression). For script/config/JSON text or binary model metadata use read_project_input; model runtime validation is a separate reviewed stage.",
 "diagnose_tools":"Inspect registered environments, actual executable/source availability and adapter coverage. Filesystem presence is not runtime/scientific validation. Use probe_environment with the exact engine for real imports/loader checks.",
 "suggest_parameters":"Use ASE structure facts and labeled conservative pilot defaults to propose parameters with source/confidence, preserving supplied intent. Does not invent a CV, phase or production settings. Returns geometry-derived peptide phi/psi atom candidates with zero/one-based order and ASE angle references, plus technical dtype/format/history-capacity defaults when supplied. Never guess indices from molecule names. Returns only unresolved high-uncertainty scientific choices for discussion.",
 "probe_environment":"Probe the explicitly selected engine in its registered Python/native runtime. Optional engine defaults to legacy pydyn.md; pass the actual route (gpumd.sampling, pygas.build, hotpp.train, etc). No branch or environment switching.",
 "inspect_source_project":"Read the registered public catalog and source-hashed graph/Studio I/O contract. Optional symbols (up to four exact public class names) returns bounded AST method bodies, e.g. PairwiseDistanceMean forward/MIC/output rank. No arbitrary file path, import or execution. read_project_input reads project assets, not source repositories. Inspect actual CV output shape and supported reduce semantics before collecting scalar CVs; prose alone is not executable.",
 "create_structure":"Create and register an ASE structure asset from a bounded declarative recipe. kind bulk (name, optional crystalstructure/a/cubic); molecule (name, optional vacuum); surface (bulk kwargs, indices, layers, vacuum); explicit (symbols, positions, cell, pbc); import (authorized path). Optional repeat [nx,ny,nz]. Returns validated reloaded extxyz, preview, provenance and inferred facts. Authoring only; never runs MD/relaxation.",
 "render_pygas_workflow":"Validate a saved graph against the actual pyGAS catalog and render executable build source using its graph compiler. Save the canonical graph and executable build_bias.py directly as project inputs; return their paths, hashes and a bounded preview to avoid copying long code through chat. Does not execute or build the artifact. graph.settings must include atoms_path (actual structure) and pt_path (requested output artifact); Studio snapshots their basenames and sets workflow_path=workflow.json. Read inspect_source_project.graph_contract including studio_io and reduction/output-shape rules first. Include returned files and the source structure in a pygas.build task for human execution.",
 "present_task":"Fill the central Studio task page using the task_id supplied in context. Update this conversation-owned workflow in place. Prefer structured steps {id,title,description,tool,fields:[{key,label,type,required,unit,options}]} with stable IDs and dot-path keys into nested parameters. Put critical CV/bias parameters first; secondary settings can use advanced:true and a scalar default plus traceable default_source. Defaults are display guidance, not actual input edits. Record actual scientific parameters, file paths and missing fields. This creates no calculation and cannot claim validation. Call this before giving a calculation design or updating parameters. Do not create required editable fields for runtime/scope/status notes or empty missing-information lists. Reserved parameters.validation accepts only describe_engine numerical controls; review explanations belong in step descriptions or a saved review manifest.",
 "prepare_cluster_run":"Prepare a local immutable SSH/LSF/Slurm run draft and its batch script. No upload or submission. Stop for desktop review.",
 "draft_cluster_setup":"Propose queue, modules, engine paths and submission skill changes for user review. Cannot change SSH details or authorization.",
 "prepare_run": "Create an immutable run from explicit assets and scientific parameters. Returns a draft for desktop user review. Stop and wait for the user to click Execute; never validate or submit it. Never infer scientific choices.",
 "validate_run": "Validate the copied inputs and serialized bias in the registered target environment.",
 "submit_run": "Submit a validated run within the project's existing resource authorization. Idempotent; never resubmit unknown runs.",
 "resume_run": "Create a new continuation for supported GPUMD MD or HotPP training checkpoints. PyDyn and static GPUMD sampling require explicit continuation input; PyDyn sampling checks paired manifest hashes.",
 "generate_bias": "Generate static pyGAS pair-distance Python source from explicit zero-based atom indices, full PBC and bias parameters. Does not build or validate it."
}


def tools():
    result = []
    for name, (method, route, properties) in TOOL_ROUTES.items():
        if name in ("validate_run", "submit_run"):
            continue
        schema = {"type": "object", "properties": {k: {"type": v} for k, v in properties.items()},
                  "required": list(properties)}
        if name=="inspect_pygas_catalog":
            schema["properties"]["classes"]={"type":"array","items":{"type":"string","pattern":"^[A-Za-z_][A-Za-z0-9_]*$","maxLength":128},"maxItems":4,"uniqueItems":True}
            schema["additionalProperties"]=False
        if name=="render_pygas_workflow":
            schema["properties"].update({"workspace_id":{"type":"string","maxLength":128},"path":{"type":"string","maxLength":4096},"expected":{"type":"object"},"catalog_files":{"type":"object"}})
        if name=="inspect_source_project":schema["properties"]["symbols"]={"type":"array","items":{"type":"string","pattern":"^[A-Za-z_][A-Za-z0-9_]*$","maxLength":128},"maxItems":4,"uniqueItems":True}
        if name=="describe_engine":schema["properties"]["engine"]={"type":"string","enum":list(ENGINES)}
        if name in ("probe_environment","read_runtime_guide"):schema["properties"]["engine"]={"type":"string","enum":list(ENGINES)}
        if name == "present_task":
            schema["properties"]["steps"]={"type":"array","items":STEP_SCHEMA}
            schema["properties"]["missing_fields"]={"type":"array","items":{"type":"string"}}
            schema["additionalProperties"]=False
        if name == "prepare_run":
            schema["properties"]["spec"] = {"type":"object", "required":["project_id","environment_id","engine","gpu","max_seconds","inputs","idempotency_key"],
                "properties":{"project_id":{"type":"string"},"environment_id":{"type":"string"},"engine":{"type":"string","enum":list(ENGINES)},"gpu":{"type":"integer","minimum":0},"max_seconds":{"type":"integer","minimum":1},"inputs":{"type":"object","additionalProperties":{"type":"string"}},"idempotency_key":{"type":"string"},"parameters":{"type":"object"},"name":{"type":"string"}}}
        if name=="prepare_cluster_run":
            schema["properties"]["spec"]={"type":"object","required":["project_id","cluster_id","engine","max_seconds","inputs","resources","idempotency_key"],
                "properties":{"project_id":{"type":"string"},"cluster_id":{"type":"string"},"engine":{"type":"string","enum":list(ENGINES)},"max_seconds":{"type":"integer","minimum":1},
                "inputs":{"type":"object","additionalProperties":{"type":"string"}},"parameters":{"type":"object"},"name":{"type":"string"},"idempotency_key":{"type":"string"},
                "resources":{"type":"object","required":["queue","cpus","gpus","memory_mb"],"properties":{"queue":{"type":"string"},"cpus":{"type":"integer","minimum":1},"gpus":{"type":"integer","minimum":0},"memory_mb":{"type":"integer","minimum":1},"account":{"type":"string"}}}}}
        if name=="write_project_input":schema["properties"]["expected_sha256"]={"type":"string","pattern":"^[0-9a-f]{64}$"}
        if name=="inspect_asset":schema["properties"]["kind"]={"type":"string","enum":["structure","dataset","regression"]}
        if name != "present_task":
            for key in ("offset", "frame"):
                schema["properties"][key] = {"type": "integer", "minimum": 0}
        result.append({"name": name, "description": DESCRIPTIONS.get(name, name.replace("_", " ")),
                       "inputSchema": schema,
                       "annotations": {"readOnlyHint": method == "GET" or name in (
                           "describe_engine", "read_project_input", "inspect_source_project", "inspect_pygas_catalog", "read_runtime_guide", "suggest_parameters", "probe_environment", "run_status", "read_log", "collect_artifacts", "inspect_asset", "read_artifact"),
                                       "destructiveHint": name == "cancel_run"}})
    return result


def mcp_tool_call(service, params):
    """Keep recoverable call errors on MCP; never retry or expand desktop grants."""
    started = False
    try:
        if not isinstance(params, dict) or not isinstance(params.get("name"), str):
            raise ValueError("Provide a tool name and an arguments object")
        name = params["name"]
        definition = next((item for item in tools() if item["name"] == name), None)
        if definition is None:
            raise ValueError("Unknown tool. Read tools/list and use an exact available name")
        arguments = params.get("arguments", {})
        if not isinstance(arguments, dict):
            raise ValueError("Tool arguments must be an object")
        schema = definition["inputSchema"]
        missing = [key for key in schema.get("required", []) if key not in arguments]
        if missing:
            raise ValueError("Missing required fields: " + ", ".join(missing))
        types = {"string": str, "object": dict, "array": list, "integer": int}
        for key, value in arguments.items():
            expected = schema["properties"].get(key, {}).get("type")
            if expected in types and (not isinstance(value, types[expected]) or expected == "integer" and isinstance(value, bool)):
                raise ValueError("Invalid field " + key + ": expected " + expected)
        method, route, _ = TOOL_ROUTES[name]
        started = True
        result = result_for_agent(name, dispatch(service, method, route, arguments, admin=False))
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}], "isError": False}
    except Exception as exc:
        failure = {"status": "unknown" if started else "blocked", "code": "tool_error" if started else "invalid_input",
                   "message": str(exc)[:4000], "operation_state": "unconfirmed" if started else "not_started", "automatic_retry": False,
                   "next_step": "Read the current workflow or run status before another write; do not replay an unconfirmed operation." if started else
                   "Read the available tool schema and current workflow. Fill technical fields from registered context; ask only for unresolved scientific choices."}
        return {"content": [{"type": "text", "text": json.dumps(failure, ensure_ascii=False)}], "isError": True}


def dispatch(service, method, path, data, admin=False):
    store = service.store
    if method == "GET":
        if path == "/api/health":
            return {"name": "gpu-sampling-studio", "version": "0.18.1", "root": str(service.root), "runtime":str(Path(__file__).resolve().parents[1]), "execution_policy":"desktop-review-v1"}
        if path == "/api/tools/status":
            return service.diagnose_tools()
        if path == "/api/source-projects":
            return store.list("source-project")
        if path == "/api/projects":
            return store.list("project")
        if path == "/api/environments":
            return store.list("environment")
        if path == "/api/workflows":
            return store.list("workflow")
        if path == "/api/assets":
            return store.list("artifact")
        if path == "/api/gpu":
            result = subprocess.run(["nvidia-smi", "--query-gpu=index,name,memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10)
            if result.returncode:
                raise ValueError(result.stderr)
            return [{"id":int(v[0]),"name":v[1],"memory_used":int(v[2]),"memory_total":int(v[3]),"utilization":int(v[4])} for v in [line.split(", ") for line in result.stdout.strip().splitlines()]]
        if path == "/api/task-parameters":
            return store.list("task-parameters")
        if path == "/api/clusters":
            from .cluster import public
            return [public(p) for p in store.list("cluster")]
        if path == "/api/cluster-runs":
            return [service.clusters.run(r["id"]) for r in store.list("cluster-run")]
        if path == "/api/cluster-drafts":
            return store.list("cluster-draft")
        if path == "/api/runs":
            return store.runs()
        if path == "/api/events":
            return store.events(data.get("after", 0))
        if path == "/api/engines":
            return list(ENGINES)
    if path in ("/api/projects", "/api/environments") and method == "POST":
        if not admin:
            raise PermissionError("Only the desktop user can change authorization/environments")
        return service.register_project(data) if path.endswith("projects") else service.register_environment(data)
    if method != "POST":
        raise ValueError("Unknown route")
    if path.startswith('/api/custom-cv/'):
        if not admin:raise PermissionError('Custom CV approval, sharing and CPU checks require the desktop user')
        from .custom_cv_graph import controller,attach
        action=path.removeprefix('/api/custom-cv/')
        if action=='access'and not service.store.list('private-cv-lineage'):return {'blocked_project_ids':[],'blocked_run_ids':[],'blocked_paths':[],'bindings':[]}
        custom=controller(service)
        if action=='read':return custom.read(data)
        if action=='save':return custom.save(data)
        if action in ('approve-formula','approve-code','sharing'):return custom.action(action,data)
        if action=='validate':return custom.validate(data)
        if action=='status':return custom.status(data)
        if action=='reuse':return custom.reuse(data)
        if action=='provider-read':return custom.provider_status(data,body=True)
        if action=='provider-status':return custom.provider_status(data)
        if action=='attach':return attach(service,data)
        if action=='access':return custom.access(data.get('provider'))
        raise ValueError('Unknown private CV action')
    if path=="/api/engine/describe":
        from .engine_contracts import describe
        return describe(data["engine"])
    if path in ("/api/authoring/context","/api/authoring/adopt"):
        if not admin:raise PermissionError("Only desktop can bind draft workspaces or adopt inputs")
        from .authoring_workspace import ensure,adopt
        return (ensure if path.endswith("context") else adopt)(service,data)
    if path=="/api/source-projects":
        if not admin:raise PermissionError("Only desktop can register authoring sources")
        from .source_projects import inspect_source
        value={"id":data["id"],"root":str(Path(data["root"]).resolve()),"commit":data.get("commit"),"dirty":data.get("dirty")}
        inspect_source(value)
        return store.put("source-project",value)
    if path=='/api/pygas/catalog':
        from .pygas_catalog import catalog
        source=store.get('source-project',data['source_id'])
        if source['id']!='pygas':raise ValueError('Select the registered pyGAS source')
        result=catalog(source)
        if data.get('all'):
            if not admin:raise PermissionError('Full editor catalog is desktop-owned; request selected classes')
            return result
        names=data.get('classes',[])
        if not isinstance(names,list) or len(names)>4 or any(not isinstance(n,str) or len(n)>128 or re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',n) is None for n in names):raise ValueError('Choose up to four exact catalog classes')
        index={kind:[{'name':item['name'],'output_size':item.get('output_size'),'graph_support':item.get('semantics',{}).get('graph_support'),'source':item['source']} for item in entries] for kind,entries in result['catalog'].items()}
        if not names:return {**result,'catalog':index,'detail':'Class index only; request exact classes to obtain required/default parameter definitions'}
        selected={kind:[item for item in entries if item['name'] in names] for kind,entries in result['catalog'].items()}
        if set(names)!={item['name'] for entries in selected.values() for item in entries}:raise ValueError('Unknown registered class')
        return {**result,'catalog':selected}
    if path in ('/api/pygas/composition/read','/api/pygas/composition/save','/api/pygas/composition/normalize','/api/pygas/composition/initialize'):
        if not admin:raise PermissionError('Desktop conversation binding required; Agent uses render_pygas_workflow with its workspace_id and current hashes')
        from .pygas_composition import response,save,initialize
        if path.endswith('initialize'):return initialize(service,data)
        return response(service,data) if path.endswith('read') else save(service,data,normalize=path.endswith('normalize'))
    if path=="/api/source-project/inspect":
        from .source_projects import inspect_source
        return inspect_source(store.get("source-project",data["source_id"]),data.get("symbols"))
    if path=="/api/structures/import-material":
        if not admin:raise PermissionError("External database provenance must come from desktop")
        return service.authoring(data,"create_structure")
    if path in ("/api/structures/create","/api/pygas/render"):
        if data.get("repair") and not admin:raise PermissionError("Partial graph/source repair requires the explicit desktop action")
        return service.authoring(data,"create_structure" if path.endswith("create") else "render_pygas")
    if path=="/api/tasks/present":
        leaf(data["task_id"])
        validate_task(data)
        return store.put("task-parameters",{"id":data["task_id"],"kind":"task-parameters","name":data["name"],"parameters":data["parameters"],"steps":data["steps"],"missing_fields":data["missing_fields"],"status":"draft"})
    if path=="/api/clusters":
        if not admin:raise PermissionError("Only the desktop user can register cluster connections")
        return service.clusters.register(data)
    if path=="/api/cluster/test":
        if not admin:raise PermissionError("Connection testing is private to the desktop user")
        return service.clusters.test_connection(data["connection"])
    if path=="/api/cluster/profile":
        if not admin:raise PermissionError("Connection details are private")
        return store.get("cluster",data["cluster_id"])
    if path=="/api/cluster/probe":
        return service.clusters.probe(data["cluster_id"])
    if path=="/api/cluster/draft":
        return service.clusters.draft(data)
    if path=="/api/cluster/input":
        return service.clusters.input_file(data["run_id"],data["name"])
    if path=="/api/cluster/collect":
        return service.clusters.collect(data["run_id"],data.get("names"))
    if path=="/api/cluster/result":
        return service.clusters.result_file(data["run_id"],data["name"])
    if path=="/api/cluster/prepare":
        return service.clusters.prepare(data["spec"])
    if path=="/api/cluster/skill":
        return service.clusters.skill(data["project_id"],data["cluster_id"])
    if path=="/api/cluster/browse":
        return service.clusters.browse(data["project_id"],data["cluster_id"],data.get("relative",""),data.get("root_index",0),data.get("offset",0))
    if path=="/api/cluster/revise":
        if not admin:raise PermissionError("Desktop revision required")
        return service.clusters.revise(data["run_id"],data["changes"])
    if path in ("/api/cluster/validate","/api/cluster/submit","/api/cluster/cancel"):
        if not admin:raise PermissionError("Desktop cluster review required")
        return getattr(service.clusters,path.rsplit("/",1)[-1])(data["run_id"])
    if path=="/api/cluster/status":
        return service.clusters.poll(data["run_id"])
    if path=="/api/cluster/log":
        return service.clusters.read(data["run_id"],data.get("name","console.log"),data.get("offset",0))
    if path == "/api/workflows":
        store.get("project",data["project_id"])
        if not isinstance(data.get("steps"),list) or not data.get("name"):
            raise ValueError("Workflow name and explicit step descriptions required")
        return store.put("workflow",{"id":secrets.token_hex(10),"project_id":data["project_id"],"name":data["name"],"steps":data["steps"],"run_ids":[]})
    if path == "/api/assets":
        project = store.get("project", data["project_id"])
        if data["environment_id"] not in project["policy"]["environments"]:
            raise PermissionError("Environment is not authorized")
        target = contained(data["path"], project["policy"]["input_roots"] + [str(service.root / "projects" / project["id"] / "inputs")] + [r["directory"] for r in store.runs() if r["project_id"] == project["id"]])
        metadata = service.inspect(data["project_id"], data["environment_id"], str(target), data["kind"]) if data["kind"] in ("dataset", "structure") else {}
        return store.put("artifact", {"id":secrets.token_hex(10), "project_id":project["id"], "name":target.name, "path":str(target), "kind":data["kind"], "sha256":digest(target), "size":target.stat().st_size, "metadata":metadata})
    if path == "/api/runtime-guide":
        return service.read_runtime_guide(data)
    if path == "/api/probe":
        return service.probe(data)
    if path == "/api/runs/prepare":
        spec = dict(data["spec"])
        spec["origin"] = "desktop" if admin else "agent"
        return service.prepare(spec)
    if path == "/api/run/revise":
        if not admin:
            raise PermissionError("Only the desktop user can revise reviewed inputs")
        return service.revise(data["run_id"], data["spec"], data.get("edits", {}))
    if path == "/api/run/environment-identity":
        if not admin:raise PermissionError("Only the desktop human review can read immutable run environment identity")
        from .run_environment_identity import run_environment_identity
        return run_environment_identity(store,data)
    if path == "/api/run/input":
        return service.input_file(data["run_id"], data["name"])
    if path in ("/api/run/submit", "/api/run/validate") and not admin:
        raise PermissionError("Desktop review required: click Confirm and Execute in the task page")
    if path.startswith("/api/run/"):
        action, identifier = path.rsplit("/", 1)[1], data["run_id"]
        if action == "status":
            return store.run(identifier)
        if action == "log":
            return service.log(identifier, data.get("offset", 0))
        if action == "file":
            return service.file(identifier, data["name"], data.get("offset", 0))
        if action == "export":
            return service.export(identifier)
        if action == "resume":
            return service.resume(identifier, data["parameters"])
        if action in ("validate", "submit", "cancel", "collect"):
            return getattr(service, action)(identifier)
    if path == "/api/structures/suggest":
        return service.inspect(data["project_id"],data["environment_id"],data["path"],"suggest",intent=data.get("intent",{}))
    if path == "/api/inspect":
        return service.inspect(data["project_id"], data["environment_id"], data["path"],
                               data.get("kind", "dataset"), data.get("frame", 0))
    if path == "/api/templates/bias":
        raise ValueError("Legacy native-code bias template retired; compose the actual registered pyGAS library graph with render_pygas_workflow")
    if path == "/api/workspace/materialize" and method == "POST":
        from .workspace_materialize import materialize_input
        return materialize_input(service,data,admin)
    if path in ("/api/workspace/read","/api/workspace/write"):
        from .workspace_io import read_input,write_input
        return read_input(service,data) if path.endswith('read') else write_input(service,data,admin)
    raise ValueError("Unknown route")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="~/.local/state/gpu-sampling-studio")
    parser.add_argument("--port", type=int, default=8767)
    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o700)
    if os.name != "posix":
        raise RuntimeError("The job service requires Linux/WSL process identities")
    import fcntl
    lock = open(root / "service.lock", "a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    secrets_path = root / "connection.json"
    if not secrets_path.exists():
        atomic_json(secrets_path, {"admin": secrets.token_urlsafe(32), "mcp": secrets.token_urlsafe(32)})
    secrets_path.chmod(0o600)
    tokens = json.loads(secrets_path.read_text())
    service = Service(root)
    # Generated inputs are intrinsically owned by each project, not user-grantable cross-project paths.
    original_authorize = service.authorize
    def authorize(spec):
        project, environment = original_authorize(spec)
        policy = dict(project["policy"])
        policy["input_roots"] = policy["input_roots"] + [str(root / "projects" / project["id"] / "inputs")]
        return {**project, "policy": policy}, environment
    service.authorize = authorize

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def respond(self, status, value=None):
            body = b"" if value is None else json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self.handle_request("GET")

        def do_POST(self):
            self.handle_request("POST")

        def handle_request(self, method):
            if self.headers.get("Origin"):
                return self.respond(403, {"error": "Browser origins are not permitted"})
            auth = self.headers.get("Authorization", "")
            admin = hmac.compare_digest(auth, "Bearer " + tokens["admin"])
            mcp = hmac.compare_digest(auth, "Bearer " + tokens["mcp"])
            if not (admin or mcp):
                return self.respond(401, {"error": "Authentication required"})
            parsed = urlparse(self.path)
            try:
                if method == "POST":
                    length = int(self.headers.get("Content-Length", 0))
                    if not 0 < length <= 4 * 1024 * 1024:
                        return self.respond(413, {"error": "Bounded JSON body required"})
                    data = json.loads(self.rfile.read(length))
                else:
                    data = {k: v[0] for k, v in parse_qs(parsed.query).items()}
                if parsed.path == "/mcp":
                    if method == "GET":
                        return self.respond(405)
                    operation = data.get("method")
                    if "id" not in data:
                        return self.respond(202)
                    if operation == "initialize":
                        value = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}},
                                 "serverInfo": {"name": "gpusampling", "version": "0.18.1"},
                                 "instructions": "Use existing project authorization. Missing scientific choices must be collected. Prepare drafts for desktop review and stop. Only the desktop user can validate and submit with Confirm and Execute. Scientific jobs continue independently once submitted."}
                    elif operation == "resources/list":
                        value = {"resources": []}
                    elif operation == "resources/templates/list":
                        value = {"resourceTemplates": []}
                    elif operation == "ping":
                        value = {}
                    elif operation == "tools/list":
                        value = {"tools": tools()}
                    elif operation == "tools/call":
                        value = mcp_tool_call(service, data.get("params"))
                    else:
                        return self.respond(200, {"jsonrpc": "2.0", "id": data["id"],
                                                  "error": {"code": -32601, "message": "Method not found"}})
                    return self.respond(200, {"jsonrpc": "2.0", "id": data["id"], "result": value})
                if mcp:
                    return self.respond(403, {"error": "MCP credential is restricted to /mcp"})
                self.respond(200, dispatch(service, method, parsed.path, data, admin=admin))
            except PermissionError as exc:
                self.respond(403, {"error": str(exc)})
            except (ValueError, KeyError, TypeError) as exc:
                self.respond(400, {"error": str(exc)})
            except Exception as exc:
                self.respond(500, {"error": str(exc)})

    try:
        ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
    finally:
        service.close()


if __name__ == "__main__":
    main()
