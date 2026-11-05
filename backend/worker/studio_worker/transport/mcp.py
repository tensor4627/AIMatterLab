"""MCP schemas, bounded protocol errors and Agent-facing projections."""
from studio_worker.infrastructure.paths import WORKER_ROOT
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
from studio_worker.tools.adapters import Adapter, ENGINES
from studio_worker.compute.service import Service
from studio_worker.transport.runtime_projection import result_for_agent
from studio_worker.tools.templates import build_bias
from studio_worker.transport.task_schema import STEP_SCHEMA, validate_task
from studio_worker.infrastructure.util import leaf, atomic_json, digest, contained

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
 "compute_readiness": ("GET", "/api/compute/readiness", {}),
 "discover_local_environments": ("POST", "/api/environments/discover", {}),
 "draft_local_environment": ("POST", "/api/environments/draft", {"proposal":"object"}),
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
 "compute_readiness":"Read local environment registrations, observed CUDA and saved cluster connection health without private SSH endpoints. Reuse installed software. Missing registration is a setup issue, never proof software is absent. No grant or job submission.",
 "draft_local_environment":"Propose an existing local interpreter, native engine paths, selected source roots and loader variables for review in Compute environments. Use actual observed paths, preserve separate PyDyn/core/sampling environments. The user reviews structured fields and saves; this tool cannot register, install, grant or execute anything.",
 "discover_local_environments":"Read-only bounded discovery of existing Python/GPU software in standard local locations and explicitly bound source roots. Returns candidate identities for the desktop setup page; cannot register environments, install packages or change project authorization.",
 "read_runtime_guide":"Read the selected registered environment and engine runtime receipt recorded by an actual probe. Returns observed versions and source/capability identity metadata, or explicit stale/blocked/not_run. Three source/module path families are withheld as role+SHA identities; exact paths remain worker-owned. This metadata view is not the raw receipt. Does not install, import, execute, switch versions or modify job state. Ordinary calculations reuse this instead of rereading installation instructions.",
 "inspect_pygas_catalog":"Read actual registered pyGAS GUI CV/bias/switch/neighbor constructor names, exact required/default parameters and source-bound editor/shape semantics. Without classes returns a compact class index; request up to four exact names for their typed parameter lists. Use these real library definitions before composing a graph; this is source inspection, never artifact/runtime/numerical proof.",
 "describe_engine":"Read the real Studio adapter parameter contract: required input basenames, canonical flat API keys, explicit nested aliases and valid modes. Use before publishing scientific workflows; technical wrapper fields are Agent responsibilities, not user questions. This is discovery only, never engine/artifact validation. parameters.validation is reserved for declared numerical FD controls; put runtime/scope/review diagnostics in step descriptions or a separate saved review manifest, not editable controls.",
 "read_project_input":"Read bounded text or binary metadata/SHA256 from project-owned inputs or existing authorized project roots. name accepts an owned relative path (including cv-*/build_bias.py) or authorized absolute Linux input path. Use for Python/JSON/config/model inputs; binary models are never deserialized. No interpreter needed. Use the returned sha256 as expected_sha256 when updating an existing input.",
 "write_project_input":"Save actual text in the project inputs root using safe relative names including nested cv-*/build_bias.py. Existing changed input requires expected_sha256 from read_project_input; on conflict re-read. Returns actual saved path/hash; never builds or executes.",
 "inspect_asset":"Inspect an ASE structure/dataset or existing NEP regression output directory (kind=structure, dataset or regression). For script/config/JSON text or binary model metadata use read_project_input; model runtime validation is a separate reviewed stage.",
 "diagnose_tools":"Inspect registered environments, actual executable/source availability and adapter coverage. Filesystem presence is not runtime/scientific validation. Use probe_environment with the exact engine for real imports/loader checks.",
 "suggest_parameters":"Use ASE structure facts and labeled conservative pilot defaults to propose parameters with source/confidence, preserving supplied intent. Does not invent a CV, phase or production settings. Returns geometry-derived peptide phi/psi atom candidates with zero/one-based order and ASE angle references, plus technical dtype/format/history-capacity defaults when supplied. Never guess indices from molecule names. Returns only unresolved high-uncertainty scientific choices for discussion.",
 "probe_environment":"Probe the explicitly selected engine in its registered Python/native runtime. Optional engine defaults to legacy pydyn.md; pass the actual route (gpumd.sampling, pygas.build, hotpp.train, etc). No branch or environment switching.",
 "inspect_source_project":"Read the registered public catalog and source-hashed graph/Studio I/O contract. For hotpp/pydyn omit symbols and read public_api_contract; request up to four advertised exact source-qualified IDs with api_symbols for bounded method source or explicitly advertised HotPP train.py DefaultPara tree/helpers, not arbitrary files or complete configuration semantics. Qualified output symbol_id values are identities, not symbols selectors. Optional symbols selects up to four exact pyGAS class names and returns bounded AST method bodies, e.g. PairwiseDistanceMean forward/MIC/output rank. No arbitrary file path, import or execution. read_project_input reads project assets, not source repositories. Inspect actual CV output shape and supported reduce semantics before collecting scalar CVs; prose alone is not executable.",
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
        if name=="inspect_source_project":schema["properties"]["symbols"]={"description":"pyGAS class names only; for hotpp/pydyn omit symbols. Qualified public_api_contract symbol_id values are output identities, not input selectors.","type":"array","items":{"type":"string","pattern":"^[A-Za-z_][A-Za-z0-9_]*$","maxLength":128},"maxItems":4,"uniqueItems":True}
        if name=="inspect_source_project":schema["properties"]["api_symbols"]={"type":"array","items":{"type":"string","maxLength":256},"maxItems":4,"uniqueItems":True,"description":"HotPP/PyDyn only: exact current public_api_contract symbol_id values, max4; total code/default description bytes at most16KiB. Never pass file paths or use project input readers for source."}
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
                           "compute_readiness", "discover_local_environments", "describe_engine", "read_project_input", "inspect_source_project", "inspect_pygas_catalog", "read_runtime_guide", "suggest_parameters", "probe_environment", "run_status", "read_log", "collect_artifacts", "inspect_asset", "read_artifact"),
                                       "destructiveHint": name == "cancel_run"}})
    return result


def mcp_tool_call(service, params, *, dispatch):
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
        if name == "inspect_source_project" and "symbols" in arguments:
            symbols = arguments["symbols"]
            if not isinstance(symbols, list) or len(symbols)>4 or any(not isinstance(item,str) or len(item)>128 or re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',item) is None for item in symbols) or len(set(symbols))!=len(symbols):
                source_id=arguments.get("source_id")
                failure={"status":"blocked","code":"invalid_input","message":"symbols accepts up to four unique unqualified pyGAS class names. For hotpp/pydyn omit symbols and read public_api_contract; qualified symbol_id is an output identity, not a selector.","operation_state":"not_started","automatic_retry":False,"next_step":"Use the suggested Studio scientific tool call after reviewing these arguments. Do not discover other MCP resources or replay writes."}
                if source_id in ("pygas","pydyn","hotpp","gpumd","torchnep"):failure["suggested_call"]={"name":"inspect_source_project","arguments":{"source_id":source_id}}
                return {"content":[{"type":"text","text":json.dumps(failure,ensure_ascii=False)}],"isError":True}
        types = {"string": str, "object": dict, "array": list, "integer": int}
        for key, value in arguments.items():
            expected = schema["properties"].get(key, {}).get("type")
            if expected in types and (not isinstance(value, types[expected]) or expected == "integer" and isinstance(value, bool)):
                raise ValueError("Invalid field " + key + ": expected " + expected)
        if name == "inspect_source_project" and "api_symbols" in arguments:
            from studio_worker.tools.software_contracts import inspect_contract
            source=service.store.get("source-project",arguments["source_id"])
            inspect_contract(source,api_symbols=arguments["api_symbols"]) # Read-only selector gate before dispatch; authoritative handler repeats it.
        method, route, _ = TOOL_ROUTES[name]
        started = True
        result = result_for_agent(name, dispatch(service, method, route, arguments, admin=False),arguments)
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}], "isError": False}
    except Exception as exc:
        from studio_worker.compute.ssh_auth import AuthError
        if isinstance(exc, AuthError):
            failure = {'status': 'needs_human_auth', 'code': 'needs_human_auth',
                       'message': 'Open private authentication in the desktop cluster connection page.',
                       'automatic_retry': False, 'operation_state': 'unconfirmed' if started else 'not_started',
                       'next_step': 'The human must authenticate the saved connection, then inspect existing run status. Never resend an unknown submission.'}
            return {'content': [{'type': 'text', 'text': json.dumps(failure)}], 'isError': True}
        if isinstance(params,dict) and params.get("name")=="inspect_source_project":
            failure={"status":"blocked","code":"source_read_failed" if started else "invalid_input","message":str(exc)[:4000],"operation_state":"read_started" if started else "not_started","automatic_retry":False,"next_step":"This is read-only source inspection, not an unknown write. Request current advertised identities with the suggested Studio call; split api_symbols into smaller selections (max4 and16KiB code/default trees). Do not read source via project-input tools or discover other MCP resources."}
            arguments=params.get("arguments",{})
            source_id=arguments.get("source_id") if isinstance(arguments,dict) else None
            if source_id in ("pygas","pydyn","hotpp","gpumd","torchnep"):failure["suggested_call"]={"name":"inspect_source_project","arguments":{"source_id":source_id}}
            return {"content":[{"type":"text","text":json.dumps(failure,ensure_ascii=False)}],"isError":True}
        if isinstance(params,dict) and params.get("name")=="read_project_input":
            failure={"status":"blocked","code":"input_read_failed" if started else "invalid_input","message":str(exc)[:4000],"operation_state":"read_started" if started else "not_started","automatic_retry":False,"read_scope":"existing_authorized_project_inputs_only","next_step":"This input read was rejected or failed, not an unknown write. Check the current authorized input path and offset. Library software source uses list_source_projects then inspect_source_project with an existing source ID/API selector; do not read it through project-input tools or expand project roots/grants.","source_metadata_call":{"name":"list_source_projects","arguments":{}}}
            return {"content":[{"type":"text","text":json.dumps(failure,ensure_ascii=False)}],"isError":True}
        failure = {"status": "unknown" if started else "blocked", "code": "tool_error" if started else "invalid_input",
                   "message": str(exc)[:4000], "operation_state": "unconfirmed" if started else "not_started", "automatic_retry": False,
                   "next_step": "Read the current workflow or run status before another write; do not replay an unconfirmed operation." if started else
                   "Read the available tool schema and current workflow. Fill technical fields from registered context; ask only for unresolved scientific choices."}
        return {"content": [{"type": "text", "text": json.dumps(failure, ensure_ascii=False)}], "isError": True}
