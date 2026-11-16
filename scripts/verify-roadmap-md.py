"""Bounded, real GPUMD -> number density acceptance in a new isolated worker root."""
import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import random
import shutil
import socket
import subprocess
import sys
import time
from urllib import request, error

class LocalWorker:
    def __init__(self, root):
        self.root = root
        with socket.socket() as sock:
            sock.bind(("127.0.0.1",0))
            self.port = sock.getsockname()[1]
        self.proc = None
        self.log = (root.parent/"worker.log").open("ab")

    def start(self):
        env = {**os.environ,"PYTHONDONTWRITEBYTECODE":"1",
               "PYTHONPATH":str(Path(__file__).resolve().parents[1]/"backend"/"worker")}
        self.proc = subprocess.Popen([sys.executable,"-m","studio_worker.server","--root",str(self.root),
                                      "--port",str(self.port)],env=env,stdin=subprocess.DEVNULL,stdout=self.log,stderr=self.log)
        for _ in range(200):
            if self.proc.poll() is not None:
                raise RuntimeError("Isolated worker did not start; see worker.log")
            try:
                self.token = json.loads((self.root/"connection.json").read_text())["admin"]
                if self.api("/api/health")["root"]==str(self.root):
                    return
            except (OSError,ValueError):
                time.sleep(.05)
        raise RuntimeError("Isolated worker health timeout")

    def api(self, path, data=None):
        req=request.Request(f"http://127.0.0.1:{self.port}"+path, data=json.dumps(data).encode() if data is not None else None,
                            headers={"Authorization":"Bearer "+self.token,"Content-Type":"application/json"})
        try:
            with request.urlopen(req,timeout=120) as response:
                return json.load(response)
        except error.HTTPError as exc:
            raise RuntimeError(json.load(exc).get("error","Worker request failed")) from exc

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            self.proc.wait(timeout=10)


def plan(inputs):
    def boundary(key,label):
        return {"id":key,"label":label,"field":key,"basis":"user"}
    def goal(key,label,checks):
        return {"id":key,"label":label,"basis":"user","requirements":[row[0] for row in checks],
                "checks":[dict(requirement=r,fact=f,op=op,value=v) for r,f,op,v in checks]}
    def ports(**bindings):
        return [dict(port=p,resource=r) for p,r in bindings.items()]
    goals = [
        goal("frames","MD trajectory",[("10 frames","samples","eq",10),("512 atoms","atoms","eq",512),
             ("1 fs intervals","interval_fs","eq",1),("last frame at 10 fs","last_time_fs","eq",10)]),
        goal("thermo","Thermodynamic series",[("4 samples","samples","eq",4),("temperature in K","fields","contains","temperature_K")]),
        goal("densities","Per-frame atomic number density",[("10 density values","samples","eq",10),
             ("atoms per cubic Angstrom","fields","contains","number_density_per_angstrom3")])]
    roadmap={"schema_version":1,"resources":[boundary("structure","Silicon"),boundary("potential","Silicon potential"),
             boundary("control","MD control"),*goals],"inputs":["structure","potential","control"],"outputs":[x["id"] for x in goals],
             "steps":[dict(id="analysis",tool="trajectory.density",label="Number density",inputs=ports(trajectory="frames"),outputs=ports(density="densities")),
                      dict(id="md",tool="gpumd.md",parameter_field="md",label="Silicon MD",inputs=ports(structure="structure",potential="potential",control="control"),
                           outputs=ports(trajectory="frames",thermodynamics="thermo"))]}
    return dict(task_id="silicon-md-density",name="Silicon MD and number density",
                original_request="Run 20 NVE steps for 512 Si atoms at 0.5 fs. Deliver ten trajectory frames at 1 fs intervals through 10 fs, four thermodynamic temperature samples, and ten per-frame atomic number densities in atoms per cubic Angstrom.",
                roadmap=roadmap,revision={"parameters":1,"deployment":1},node_environments={"analysis":"analysis-cpu"},
                parameters={**inputs,"md":{"steps":20,"time_step_fs":0.5}},target=dict(project_id="silicon",environment_id="native",gpu=0,max_seconds=90))


def create_inputs(root,potential):
    root.mkdir()
    rng = random.Random(49)
    basis = [(0,0,0),(0,.5,.5),(.5,0,.5),(.5,.5,0),(.25,.25,.25),(.25,.75,.75),(.75,.25,.75),(.75,.75,.25)]
    atoms=[(5.43*(i+x),5.43*(j+y),5.43*(k+z)) for i in range(4) for j in range(4) for k in range(4) for x,y,z in basis]
    with (root/"model.xyz").open("x") as out:
        out.write(f'{len(atoms)}\nLattice="21.72 0 0 0 21.72 0 0 0 21.72" pbc="T T T" Properties=species:S:1:pos:R:3:vel:R:3\n')
        for atom in atoms:
            out.write("Si "+" ".join(f"{v:.8f}" for v in (*atom,*(rng.gauss(0,.0015) for _ in range(3))))+"\n")
    shutil.copyfile(potential,root/"potential.txt")
    (root/"run.in").write_text("potential potential.txt\ntime_step 0.5\nensemble nve\ndump_exyz 2 0 0\ndump_thermo 5\nrun 20\n")
    return {key:str(root/name) for key,name in (("structure","model.xyz"),("control","run.in"),("potential","potential.txt"))}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("root","gpumd","potential"):
        parser.add_argument("--"+name,type=Path,required=True)
    parser.add_argument("--desktop",action="store_true",help="Drive the production Windows Electron confirmation and receipt in an isolated profile")
    args=parser.parse_args()
    root=args.root.resolve()
    root.mkdir(parents=True,exist_ok=False)
    inputs=create_inputs(root/"inputs",args.potential)
    body=plan(inputs)
    service=LocalWorker(root/"worker")
    def call(path,data):
        return service.api("/api/workflow/roadmap/"+path,data)
    try:
        service.start()
        service.api("/api/environments",dict(id="native",name="Isolated registered binaries",executables={"gpumd":str(args.gpumd.resolve()),"python":sys.executable}))
        service.api("/api/environments",dict(id="analysis-cpu",name="Isolated analysis interpreter",executables={"python":sys.executable}))
        service.api("/api/projects",dict(id="silicon",name="Isolated MD analysis",policy=dict(input_roots=[str(root/"inputs")],
                                 engines=["gpumd.md","trajectory.density"],environments=["native","analysis-cpu"],gpus=[0],max_seconds=90,max_concurrent=1)))
        service.api("/api/tasks/present",dict(task_id=body["task_id"],name=body["name"],steps=["MD","Analysis"],parameters=body["parameters"],roadmap=body["roadmap"],missing_fields=[]))
        review=call("preview",body)
        (root/"review.json").write_text(json.dumps(review,indent=2))
        assert not service.api("/api/runs")
        if args.desktop:
            assert os.environ.get("WSL_DISTRO_NAME"),"Native acceptance requires Windows with WSL"
            script=Path(__file__).with_name("native-roadmap-execution-check.mjs").resolve()
            def windows_path(path):
                return subprocess.check_output(["wslpath","-w",str(path)],text=True).strip()
            subprocess.run(["node.exe",windows_path(script),windows_path(root),str(service.port),os.environ["WSL_DISTRO_NAME"]],check=True,timeout=170)
            result=json.loads((root/"desktop-result.json").read_text())
            run=call("status",{key:result[key] for key in ("task_id","execution_id")})
            md_id=run["nodes"]["md"]["run_id"]
        else:
            run,md_id=run_with_restart(service,call,body,review)
        (root/"receipt.json").write_text(json.dumps(run,indent=2))
        if run["status"]!="passed":
            raise RuntimeError(str({key:(node.get("status"),node.get("reason")) for key,node in run["nodes"].items()}))
        verify_outputs(service,root,run,md_id)
    finally:
        service.stop()
        service.log.close()


def run_with_restart(service,call,body,review):
    approved={"plan":body,"snapshot_sha256":review["snapshot_sha256"]}
    run=call("confirm",approved)
    assert call("confirm",approved)["id"]==run["id"]
    deadline=time.monotonic()+90
    md_id=None
    while time.monotonic()<deadline:
        rows=service.api("/api/runs")
        if rows:
            md=next(row for row in rows if row["engine"]=="gpumd.md")
            if (Path(md["directory"])/"child.json").is_file():
                md_id=md["id"]
                assert len(rows)==1
                break
            if md["status"] in ("failed","cancelled"):
                raise RuntimeError("MD did not launch: "+str(md.get("error") or md["status"]))
        time.sleep(.025)
    assert md_id,"MD supervisor did not start"
    service.stop()
    service.start()
    deadline=time.monotonic()+150
    while run["status"] in ("running","unknown") and time.monotonic()<deadline:
        time.sleep(.3)
        run=call("status",{"task_id":body["task_id"],"execution_id":run["id"]})
    return run,md_id


def verify_outputs(service,root,run,md_id):
    md,analysis=(service.api("/api/run/status",{"run_id":run["nodes"][node]["run_id"]}) for node in ("md","analysis"))
    trajectory=Path(md["directory"])/"results"/"dump.xyz"
    result=Path(analysis["directory"])/"results"
    actual=hashlib.sha256(trajectory.read_bytes()).hexdigest()
    downstream=next(item for item in analysis["snapshots"] if item["name"]=="trajectory.xyz")
    receipt=json.loads((result/"consumption.json").read_text())
    with (result/"density.csv").open() as stream:
        rows=list(csv.DictReader(stream))
    assert len(rows)==10 and all(math.isclose(float(row["volume_angstrom3"]),21.72**3,rel_tol=1e-8)
                                 and math.isclose(float(row["number_density_per_angstrom3"]),512/21.72**3,rel_tol=1e-8) for row in rows)
    assert actual==downstream["sha256"]==receipt["sha256"]==run["artifacts"]["frames"]["sha256"]
    assert md["id"]==md_id and analysis["environment_id"]=="analysis-cpu"
    assert Path(downstream["source"])==trajectory and run["nodes"]["analysis"]["consumed"][0]["producer"]["run_id"]==md["id"]
    assert len(service.api("/api/runs"))==2 and all(goal["status"]=="passed" for goal in run["goals"])
    print(json.dumps(dict(execution=run["id"],runs=[md["id"],analysis["id"]],sha256=actual,
                     goals=[(goal["resource"],goal["artifact"]["facts"]) for goal in run["goals"]],receipt=str(root/"receipt.json"))))


if __name__=="__main__":
    main()
