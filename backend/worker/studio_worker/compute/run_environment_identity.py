"""Admin-only immutable run environment identity. No caller snapshot or state mutation.
The interpreter field is the configured invocation; observed sys.executable is a separate runtime-guide fact.
"""
import re
from studio_worker.compute.runtime_guides import fingerprint

def run_environment_identity(store,data):
    if not isinstance(data,dict) or set(data)!={"run_id"} or not isinstance(data["run_id"],str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}",data["run_id"]) or data["run_id"] in (".",".."):
        raise ValueError("An exact existing opaque run_id is required")
    with store.lock:
        run=store.run(data["run_id"])
        snapshot=run.get("environment_snapshot")
        if not isinstance(snapshot,dict) or snapshot.get("id")!=run.get("environment_id") or not isinstance(snapshot.get("executables"),dict) or not isinstance(snapshot["executables"].get("python"),str):
            raise ValueError("Complete immutable run environment snapshot unavailable")
        return {"kind":"immutable-run-environment-identity-v1","run_id":run["id"],"project_id":run["project_id"],"environment_id":run["environment_id"],"engine":run["engine"],"configuration_sha256":fingerprint(snapshot),"interpreter":snapshot["executables"]["python"]}
