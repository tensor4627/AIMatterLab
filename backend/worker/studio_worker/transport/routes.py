"""Authenticated admin/public route policy and domain dispatch; no independent state."""
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


def parse_gpu_rows(text):
    """Parse `nvidia-smi --format=csv,noheader,nounits` rows defensively.

    Row names may contain commas in theory, so only the five documented columns are
    required; non-numeric counters (e.g. MIG "[N/A]") become null instead of failing
    the whole inventory.
    """
    def counter(value):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    rows = []
    for line in (text or '').splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [part.strip() for part in line.split(',')]
        if len(parts) < 5:
            raise ValueError('Unparseable nvidia-smi output')
        identifier = counter(parts[0])
        if identifier is None:
            raise ValueError('Unparseable nvidia-smi output')
        name = ', '.join(parts[1:-3]).strip()
        if not name:
            raise ValueError('Unparseable nvidia-smi output')
        rows.append({'id': identifier, 'name': name, 'memory_used': counter(parts[-3]),
                     'memory_total': counter(parts[-2]), 'utilization': counter(parts[-1])})
    return rows


def gpu_inventory(run=subprocess.run):
    """Best-effort local GPU inventory; an unavailable driver is an empty list, not an API 500."""
    try:
        result = run(["nvidia-smi", "--query-gpu=index,name,memory.used,memory.total,utilization.gpu",
                      "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return []
    if result.returncode:
        return []
    return parse_gpu_rows(result.stdout)


def dispatch(service, method, path, data, admin=False):
    if path.startswith('/api/workflow/roadmap/'):
        if method!='POST' or not admin:
            raise PermissionError('Desktop workflow confirmation channel required')
        from studio_worker.workspace.roadmap_execution import RoadmapExecutions
        controller=RoadmapExecutions(service)
        operations={'preview':controller.preview,'confirm':controller.confirm,'status':controller.status,'list':controller.list,'snapshot':controller.snapshot}
        operation=operations.get(path.removeprefix('/api/workflow/roadmap/'))
        if operation is None:raise ValueError('Unknown roadmap operation')
        return operation(data)
    store = service.store
    if method == 'POST' and path in ('/api/runs/prepare', '/api/run/validate', '/api/run/submit', '/api/run/resume', '/api/run/revise'):
        from studio_worker.compute.ssh_service import require_local_execution
        require_local_execution(service)
    if path == '/api/ssh-service/scheduler':
        if method != 'POST' or not admin:
            raise PermissionError('Desktop human scheduler registration required')
        from studio_worker.compute.ssh_service import scheduler_profile
        return scheduler_profile(service, data)
    if path in ('/api/workflow/tool-group/create', '/api/workflow/prepare-step', '/api/workflow/execute-step', '/api/workflow/status', '/api/workflow/read'):
        if method != 'POST' or not admin: raise PermissionError('Desktop human tool-workflow channel required')
        from studio_worker.workspace.tool_workflows import ToolWorkflows
        operation = {'/api/workflow/tool-group/create': 'create', '/api/workflow/prepare-step': 'prepare', '/api/workflow/execute-step': 'execute', '/api/workflow/status': 'status', '/api/workflow/read': 'read'}[path]
        return getattr(ToolWorkflows(service), operation)(data)
    if path == '/api/tool-guidance/state':
        if method != 'POST' or not admin:
            raise PermissionError('Desktop guidance metadata channel required')
        from studio_worker.tools.guidance_state import guidance_state
        return guidance_state(service, data)
    if path in ('/api/tool-package/register', '/api/tool-configuration/project/create', '/api/tool-configuration/plan', '/api/tool-configuration/execute', '/api/tool-configuration/status', '/api/tool-configuration/activate', '/api/tool-execution-skill/read'):
        if method != 'POST' or not admin:
            raise PermissionError('Desktop human tool configuration channel required')
        from studio_worker.tools.configurations import ToolConfigurations
        operation = {'/api/tool-package/register': 'register', '/api/tool-configuration/project/create': 'create_project', '/api/tool-configuration/plan': 'plan', '/api/tool-configuration/execute': 'execute', '/api/tool-configuration/status': 'status', '/api/tool-configuration/activate': 'activate', '/api/tool-execution-skill/read': 'read'}[path]
        return getattr(ToolConfigurations(service), operation)(data)
    if method == "GET":
        if path == "/api/health":
            value = {"name": "gpu-sampling-studio", "product_name": "AIMatterLab", "version": "0.18.8", "root": str(service.root), "runtime":str(WORKER_ROOT), "execution_policy":"desktop-review-v1", "tool_configuration_schema":1, "tool_workflow_schema":1}
            if not getattr(service,'ssh_service_mode',False):
                value["roadmap_execution_schema"]=1
            if getattr(service, 'ssh_service_mode', False):
                from studio_worker.compute.ssh_service import identity
                host = identity(service.root)
                value.update(hostname=host['hostname'], uid=host['uid'], machineId=host['machineId'],
                             hostIdentity={k: host[k] for k in ('hostname', 'uid', 'machineId')},
                             home=str(Path.home().resolve()), runtime_id=WORKER_ROOT.name,
                             port=getattr(service, 'listen_port', None), worker_role='ssh-login-service', ssh_service=True, local_execution=False)
            return value
        if path == "/api/tools/status":
            return service.diagnose_tools()
        if path == "/api/compute/readiness":
            from studio_worker.compute.compute_setup import readiness
            return readiness(service)
        if path == '/api/environments/drafts':return store.list('environment-draft')
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
            return gpu_inventory()
        if path == "/api/task-parameters":
            return store.list("task-parameters")
        if path == "/api/clusters":
            from studio_worker.compute.cluster import public
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
    if path == '/api/environment-api/read':
        if not admin:raise PermissionError('Selected target API inspection requires the main-owned context channel')
        from studio_worker.tools.environment_api import inspect,ApiReadError
        try:return inspect(service,data)
        except (ApiReadError,ValueError,OSError,KeyError,TypeError,SyntaxError,subprocess.SubprocessError) as error:
            return {'status':'blocked','code':getattr(error,'code','source_read_failed'),'message':str(error)[:2000],'operation_state':'read_started','automatic_retry':False,'next_step':'Use the current observed exact target and advertised finite API IDs; obtain a normal explicit environment check if provenance is missing. No installation or grant is inferred.'}
    if path == '/api/environments/discover':
        from studio_worker.compute.compute_setup import discover
        return discover(service, data.get('force', False) if admin else False)
    if path == '/api/environments/adopt':
        if not admin:raise PermissionError('Only the desktop may register discovered environments')
        from studio_worker.compute.compute_setup import adopt
        return adopt(service,data)
    if path == '/api/environments/draft':
        from studio_worker.compute.compute_setup import draft
        return draft(service,data.get('proposal'))
    if path.startswith('/api/custom-cv/'):
        if not admin:raise PermissionError('Custom CV approval, sharing and CPU checks require the desktop user')
        from studio_worker.workspace.custom_cv_graph import controller,attach
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
        from studio_worker.tools.engine_contracts import describe
        return describe(data["engine"])
    if path in ("/api/authoring/context","/api/authoring/adopt"):
        if not admin:raise PermissionError("Only desktop can bind draft workspaces or adopt inputs")
        from studio_worker.workspace.authoring_workspace import ensure,adopt
        return (ensure if path.endswith("context") else adopt)(service,data)
    if path in ('/api/studio-workspace/create','/api/studio-workspace/read','/api/studio-workspace/import','/api/studio-workspace/retain'):
        if method!='POST':raise ValueError('Use typed workspace POST actions')
        if not admin:raise PermissionError('Only the desktop can choose workspaces or import assets')
        from studio_worker.workspace.workspace_layout import create,describe,import_asset,retain_inputs
        if path.endswith('/create'):return create(service,data)
        if path.endswith('/import'):return import_asset(service,data)
        if path.endswith('/retain'):return retain_inputs(service,data)
        return describe(service,service.store.get('project',data['project_id'])) if data.get('project_id') else [describe(service,p) for p in service.store.list('project') if p.get('studio_workspace')]
    if path=="/api/source-projects":
        if not admin:raise PermissionError("Only desktop can register authoring sources")
        from studio_worker.tools.source_projects import inspect_source
        value={"id":data["id"],"root":str(Path(data["root"]).resolve()),"commit":data.get("commit"),"dirty":data.get("dirty")}
        from studio_worker.tools.archive_guard import guidance_read_allowed
        inspect_source(value,read_guard=lambda path:guidance_read_allowed(service,path))
        return store.put("source-project",value)
    if path=='/api/pygas/catalog':
        from studio_worker.tools.pygas_catalog import catalog
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
        from studio_worker.workspace.pygas_composition import response,save,initialize
        if path.endswith('initialize'):return initialize(service,data)
        return response(service,data) if path.endswith('read') else save(service,data,normalize=path.endswith('normalize'))
    if path=="/api/source-project/inspect":
        from studio_worker.tools.source_projects import inspect_source
        from studio_worker.tools.archive_guard import guidance_read_allowed
        return inspect_source(store.get("source-project",data["source_id"]),data.get("symbols"),data.get("api_symbols"),read_guard=lambda path:guidance_read_allowed(service,path))
    if path=="/api/structures/import-material":
        if not admin:raise PermissionError("External database provenance must come from desktop")
        return service.authoring(data,"create_structure")
    if path in ("/api/structures/create","/api/pygas/render"):
        if data.get("repair") and not admin:raise PermissionError("Partial graph/source repair requires the explicit desktop action")
        return service.authoring(data,"create_structure" if path.endswith("create") else "render_pygas")
    if path=="/api/tasks/present":
        leaf(data["task_id"])
        validate_task(data)
        draft = {"id":data["task_id"], "kind":"task-parameters", "name":data["name"],
                 "parameters":data["parameters"], "steps":data["steps"], "missing_fields":data["missing_fields"], "status":"draft"}
        if "roadmap" in data:
            draft["roadmap"] = data["roadmap"]
        return store.put_task_parameters(draft)
    if path.startswith('/api/cluster/auth/') or path.startswith('/api/cluster/tunnel/'):
        if not admin:
            raise PermissionError('Private SSH authentication requires the desktop human pane')
        from studio_worker.compute.ssh_auth import AuthError
        group, operation = path.rsplit('/', 2)[-2:]
        allowed = {'auth': ('plan', 'start', 'read', 'input', 'resize', 'finish'),
                   'tunnel': ('plan', 'start', 'status', 'close')}
        if operation not in allowed.get(group, ()):
            raise ValueError('Unsupported private SSH operation')
        try:
            controller = service.clusters.auth if group == 'auth' else service.clusters.tunnels
            result = getattr(controller, operation)(data)
            if group == 'auth' and operation == 'plan' and service.clusters._tunnels is not None:
                result['tunnels'] = service.clusters.tunnels.for_session(result['sessionId'])
            return result
        except AuthError as exc:
            raise ValueError(str(exc)) from None
        except Exception:
            raise ValueError('private_ssh_operation_failed') from None
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
        from studio_worker.compute.run_environment_identity import run_environment_identity
        return run_environment_identity(store,data)
    if path == "/api/run/input":
        return service.input_file(data["run_id"], data["name"])
    if path == "/api/run/reconcile":
        return service.resolve_unknown(data["run_id"])
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
        if action == "collect":
            return service.collect(identifier, data.get("names"))
        if action in ("validate", "submit", "cancel"):
            return getattr(service, action)(identifier)
    if path == "/api/structures/suggest":
        return service.inspect(data["project_id"],data["environment_id"],data["path"],"suggest",intent=data.get("intent",{}))
    if path == "/api/inspect":
        return service.inspect(data["project_id"], data["environment_id"], data["path"],
                               data.get("kind", "dataset"), data.get("frame", 0))
    if path == "/api/templates/bias":
        raise ValueError("Legacy native-code bias template retired; compose the actual registered pyGAS library graph with render_pygas_workflow")
    if path == "/api/workspace/materialize" and method == "POST":
        from studio_worker.workspace.workspace_materialize import materialize_input
        return materialize_input(service,data,admin)
    if path in ("/api/workspace/read","/api/workspace/write"):
        from studio_worker.workspace.workspace_io import read_input,write_input
        return read_input(service,data) if path.endswith('read') else write_input(service,data,admin)
    raise ValueError("Unknown route")
