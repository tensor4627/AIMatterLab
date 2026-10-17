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
from .templates import build_bias
from .task_schema import STEP_SCHEMA, validate_task
from .util import leaf, atomic_json, digest, contained

TOOL_ROUTES = {
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
 "generate_bias": ("POST", "/api/templates/bias", {"parameters": "object"}),
 "write_project_input": ("POST", "/api/workspace/write", {"project_id": "string", "name": "string", "content": "string"}),
 "read_run_input": ("POST", "/api/run/input", {"run_id":"string", "name":"string"}),
 "read_artifact": ("POST", "/api/run/file", {"run_id": "string", "name": "string"})
}
DESCRIPTIONS = {
 "present_task":"Fill the central Studio task page using the task_id supplied in context. Update this conversation-owned workflow in place. Prefer structured steps {id,title,description,tool,fields:[{key,label,type,required,unit,options}]} with stable IDs and dot-path keys into nested parameters. Record actual scientific parameters, file paths and missing fields. This creates no calculation and cannot claim validation. Call this before giving a calculation design or updating parameters.",
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
        if name != "present_task":
            for key in ("offset", "frame"):
                schema["properties"][key] = {"type": "integer", "minimum": 0}
        result.append({"name": name, "description": DESCRIPTIONS.get(name, name.replace("_", " ")),
                       "inputSchema": schema,
                       "annotations": {"readOnlyHint": method == "GET" or name in (
                           "probe_environment", "run_status", "read_log", "collect_artifacts", "inspect_asset", "read_artifact"),
                                       "destructiveHint": name == "cancel_run"}})
    return result


def dispatch(service, method, path, data, admin=False):
    store = service.store
    if method == "GET":
        if path == "/api/health":
            return {"name": "gpu-sampling-studio", "version": "0.12.0", "root": str(service.root), "runtime":str(Path(__file__).resolve().parents[1]), "execution_policy":"desktop-review-v1"}
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
    if path == "/api/probe":
        environment = store.get("environment", data["environment_id"])
        return Adapter("pydyn.md").probe(environment)
    if path == "/api/runs/prepare":
        spec = dict(data["spec"])
        spec["origin"] = "desktop" if admin else "agent"
        return service.prepare(spec)
    if path == "/api/run/revise":
        if not admin:
            raise PermissionError("Only the desktop user can revise reviewed inputs")
        return service.revise(data["run_id"], data["spec"], data.get("edits", {}))
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
    if path == "/api/inspect":
        return service.inspect(data["project_id"], data["environment_id"], data["path"],
                               data.get("kind", "dataset"), data.get("frame", 0))
    if path == "/api/templates/bias":
        return {"source": build_bias(data["parameters"]), "validation": "not_run"}
    if path == "/api/workspace/write":
        project = store.get("project", data["project_id"])
        name = leaf(data["name"])
        if not isinstance(data["content"], str) or len(data["content"]) > 2 * 1024 * 1024:
            raise ValueError("Input source exceeds 2 MiB")
        root = service.root / "projects" / project["id"] / "inputs"
        root.mkdir(parents=True, exist_ok=True)
        target = root / name
        if target.is_symlink():
            raise ValueError("Symlink input targets are not allowed")
        target.write_text(data["content"], encoding="utf-8")
        return {"path": str(target), "name": name}
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
                                 "serverInfo": {"name": "gpusampling", "version": "0.12.0"},
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
                        params = data["params"]
                        method_, route, _ = TOOL_ROUTES[params["name"]]
                        try:
                            result = dispatch(service, method_, route, params.get("arguments", {}), admin=False)
                            value = {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}],
                                     "isError": False}
                        except Exception as exc:
                            value = {"content": [{"type": "text", "text": str(exc)}], "isError": True}
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
