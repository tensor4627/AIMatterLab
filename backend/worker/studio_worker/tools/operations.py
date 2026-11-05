"""ToolOperationsMixin: implementation extracted from the legacy Service API."""
from studio_worker.infrastructure.paths import WORKER_ROOT
import base64
from copy import deepcopy
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
from studio_worker.tools.adapters import Adapter, ENGINES, SUPPORTED_ENGINES, SCIENTIFIC, process_env
from studio_worker.infrastructure.store import Store
from studio_worker.compute.runtime_service import RuntimeServiceMixin
from studio_worker.infrastructure.util import alive, atomic_json, contained, digest, identity, leaf, run_json

TERMINAL = ("succeeded", "failed", "cancelled")


class ToolOperationsMixin:
    def diagnose_tools(self):
        result=[]
        for environment in self.store.list("environment"):
            executables={k:{"status":"passed" if Path(v).is_file() and os.access(v,os.X_OK) else "blocked","scope":"Executable file availability only"} for k,v in environment["executables"].items()}
            repositories={k:{"status":"passed" if Path(v).is_dir() else "blocked","scope":"Source directory availability only"} for k,v in environment.get("repositories",{}).items()}
            result.append({"id":environment["id"],"name":environment["name"],"executables":executables,"repositories":repositories,"runtime_validation":"not_run","scientific_validation":"not_run"})
        return {"environments":result,"adapters":list(ENGINES),"pending_adapters":["torchnep.train","nepmaker","activemiao","external-dft"],"scope":"Read-only inventory. Probe exact routes separately; no calculation executed."}

    def authoring(self, data, operation):
        if operation=='render_pygas':
            from studio_worker.workspace.pygas_composition import save
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
