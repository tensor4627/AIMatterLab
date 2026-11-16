"""Registered invocation/observation contracts used by the graph executor."""
import csv
import json
import math
from pathlib import Path
import shlex

from studio_worker.infrastructure.util import stable_file_snapshot
from studio_worker.tools import adapters, trajectory_density as density
from studio_worker.tools.package_contract import encoded, sha


def thermo(path):
    samples = 0
    width = None
    with density.ObservedLines(path) as source:
        while (line := source.line()):
            values = [density.finite(word) for word in line.split()]
            if len(values) not in (12, 18) or width not in (None, len(values)):
                raise ValueError("Incomplete GPUMD thermodynamic row")
            samples += 1
            width = len(values)
    if not samples:
        raise ValueError("Empty thermodynamic output")
    return {"sha256":source.sha.hexdigest(),"size":source.size,
            "facts":{"samples":samples,"columns":width,"fields":["temperature_K","kinetic_energy_eV","potential_energy_eV"]}}


def density_series(path):
    facts = {"samples":0,"fields":list(density.COLUMNS)}
    with density.ObservedLines(path) as source:
        rows = csv.reader(iter(source.line, ""))
        if tuple(next(rows, ())) != density.COLUMNS:
            raise ValueError("Density column names or units differ")
        for row in rows:
            time_fs, atoms, volume, number_density = map(density.finite, row)
            if (not atoms.is_integer() or atoms <= 0 or volume <= 0
                    or not math.isclose(atoms / volume, number_density, rel_tol=1e-12)
                    or facts.setdefault("atoms", int(atoms)) != atoms):
                raise ValueError("Invalid number density")
            density.time_sample(facts, time_fs)
    if not facts["samples"]:
        raise ValueError("Empty density output")
    return {"sha256":source.sha.hexdigest(),"size":source.size,"facts":facts}


# Ports describe files in the isolated invocation. Other groups may compose or
# repeat these functions. Adding a tool does not change scheduling or lineage.
FORMATS = {"extxyz":density.observe_xyz, "gpumd.thermo":thermo, "density.csv":density_series}
TOOLS = {
    "gpumd.md": {
        "inputs":{"structure":("model.xyz","extxyz"),"potential":(None,"potential"),"control":("run.in","gpumd.control")},
        "outputs":{"trajectory":("dump.xyz","extxyz"),"thermodynamics":("thermo.out","gpumd.thermo")},
        "files":{}, "executable":"gpumd",
    },
    "trajectory.density":{
        "inputs":{"trajectory":("trajectory.xyz","extxyz")}, "outputs":{"density":("density.csv","density.csv")},
        "files":{"density-analysis.py":Path(density.__file__)}, "executable":"python",
        "consumer_receipt":("trajectory","consumption.json"),
    },
}


def file_identity(path):
    observed = stable_file_snapshot(path)
    return {"size":observed["size"],"sha256":observed["sha256"]}


def tool_identity(engine, environment):
    tool = TOOLS[engine]
    exe = adapters.Adapter(engine).executable(environment, tool["executable"])
    path = Path(exe).resolve(strict=True)
    components = {name:file_identity(source)["sha256"] for name,source in tool["files"].items()}
    # Also pin the worker code that interprets the ports and parses the outputs.
    for source in (Path(__file__),Path(adapters.__file__),Path(density.__file__),Path(adapters.PACKAGE_ROOT)/"engine_contracts.json"):
        components[source.name] = file_identity(source)["sha256"]
    identity = {"tool":engine,"executable":exe,"resolved_executable":str(path),
                "executable_sha256":file_identity(path)["sha256"],"components":components}
    return {**identity,"version":sha(encoded(identity))}


def md_ports(control, outputs):
    # This file closure covers native single-potential runs. Constructs such as
    # includes, restarts with extra files, or separated dumps need a declared adapter.
    identity, raw = stable_file_snapshot(control["path"], include_bytes=True, max_bytes=2*1024*1024)
    if identity["sha256"] != control["sha256"]:
        raise ValueError("MD control file changed while composing the review")
    commands = [line.split("#",1)[0].split() for line in raw.decode().splitlines()]
    rows = [row for row in commands if row]
    supported = {"potential","time_step","velocity","ensemble","dump_thermo","dump_exyz","run"}
    for row in rows:
        if row[0] not in supported:
            raise ValueError("Unregistered GPUMD workflow input closure: "+row[0])
        if row[0] == "ensemble" and (len(row)<2 or row[1] not in ("nve","nvt_ber","nvt_nhc")):
            raise ValueError("Unregistered ensemble for this workflow input closure")
        if row[0] == "dump_exyz" and len(row)>5 and row[5]!="0":
            raise ValueError("Separate trajectory files need another output adapter")
    potentials = [row[1:] for row in rows if row[0]=="potential"]
    if len(potentials)!=1 or len(potentials[0])!=1:
        raise ValueError("A single named potential file is required")
    name = potentials[0][0]
    if (Path(name).name!=name or name in (".","..","run.in","model.xyz","thermo.out","dump.xyz")
            or any(c in name for c in "\\:\0")):
        raise ValueError("Unsafe or colliding potential filename in run.in")
    present = {row[0] for row in rows}
    if "run" not in present or any({"trajectory":"dump_exyz","thermodynamics":"dump_thermo"}[port] not in present for port in outputs):
        raise ValueError("The MD control file must enable all bound recording commands")
    return name, [" ".join(row) for row in rows]


def check_md_parameters(parameters, controls):
    nested = parameters.get("md",{})
    if not isinstance(nested,dict):
        raise ValueError("Expected MD parameter fields")
    records = [row.split() for row in controls]
    dt = None
    duration = 0.0
    steps = 0
    intervals, ensembles, temperatures = [], [], []
    ensemble = None
    for row in records:
        if row[0]=="time_step" and len(row)==2:
            dt = density.finite(row[1])
        elif row[0]=="ensemble":
            ensemble = row
        elif row[0]=="run":
            if len(row)!=2 or dt is None or dt<=0 or not ensemble or int(row[1])<=0:
                raise ValueError("Use explicit positive MD steps, time step and ensemble for each stage")
            count = int(row[1])
            steps += count
            duration += count*dt
            intervals.append(dt)
            ensembles.append(ensemble[1])
            temperatures.extend([density.finite(v) for v in ensemble[2:4]] if ensemble[1].startswith("nvt") else [None])
    for source in ({k:v for k,v in parameters.items() if k!="md"},nested):
        for name,value in source.items():
            if name in ("n_steps","steps"):
                matches = type(value) in (int,float) and steps==value
            elif name in ("time_step_fs","timestep_fs"):
                matches = type(value) in (int,float) and all(dt==value for dt in intervals)
            elif name in ("temperature","temperature_K","temperature_k"):
                matches = type(value) in (int,float) and bool(temperatures) and all(t==value for t in temperatures)
            elif name=="ensemble":
                matches = isinstance(value,str) and all(e==value.lower() or e.startswith(value.lower()+"_") for e in ensembles)
            elif name=="duration_ps":
                matches = type(value) in (int,float) and math.isclose(value,duration/1000,rel_tol=1e-12)
            else:
                raise ValueError("No native MD parameter check registered for "+name)
            if not matches:
                raise ValueError("Declared MD parameter differs from run.in: "+name)


def md_velocity_source(structure, controls):
    with Path(structure).open("rb") as stream:
        if int(stream.readline(64))<=0:
            raise ValueError("Expected an initial GPUMD structure")
        header = stream.readline(1024*1024+1)
    if len(header)>1024*1024:
        raise ValueError("Oversized structure header")
    metadata = dict(word.split("=",1) for word in shlex.split(header.decode().lower()) if "=" in word)
    properties = metadata.get("properties","").split(":")
    if ("vel","r","3") in zip(properties[::3],properties[1::3],properties[2::3]):
        return {"source":"structure","property":"vel:R:3"}
    seed = None
    seeds = []
    for command in controls:
        row = command.split()
        if row[0]=="velocity":
            seed = int(row[3]) if len(row)==4 and row[2]=="seed" else None
        if row[0]=="run":
            if seed is None:
                raise ValueError("Bind initial velocities in the structure or an explicit velocity seed before running MD")
            seeds.append(seed)
    return {"source":"control","seeds":seeds}


def consumed(run, inputs, facts):
    contract = TOOLS[run["engine"]].get("consumer_receipt")
    if not contract:
        return []
    port, filename = contract
    _, raw = stable_file_snapshot(Path(run["directory"])/"results"/filename, include_bytes=True, max_bytes=8192)
    result = json.loads(raw)
    asset = inputs[port]
    if (result.get("schema_version") != 1 or result.get("port") != port or result.get("sha256") != asset["sha256"]
            or result.get("bytes_read") != asset["size"] or any(result.get("samples")!=f["facts"]["samples"] for f in facts)):
        raise ValueError("Consumer read receipt differs from its frozen input or analyzed frame count")
    return [{"port":port,"resource":asset["resource"],"producer":asset.get("producer"),
             "sha256":result["sha256"],"bytes_read":result["bytes_read"],"samples":result["samples"]}]


def accept_goal(resource, artifact):
    outcome = {"resource":resource["id"],"label":resource["label"],"requirements":resource.get("requirements",[]),
               "artifact":artifact,"checks":[]}
    if not artifact:
        return {**outcome,"status":"unavailable","checks":[{"requirement":line,"status":"unavailable"} for line in outcome["requirements"]]}
    results = outcome["checks"]
    criteria = resource.get("checks",[])
    for requirement in outcome["requirements"]:
        if not any(check["requirement"]==requirement for check in criteria):
            results.append({"requirement":requirement,"status":"needs_review"})
    for check in criteria:
        observed, expected = artifact["facts"].get(check["fact"]), check["value"]
        op = check["op"]
        if op == "contains":
            passed = isinstance(observed,list) and expected in observed
        elif op in ("ge","le"):
            passed = type(observed) in (int,float) and type(expected) in (int,float) and (observed>=expected if op=="ge" else observed<=expected)
        else:
            passed = observed==expected
        results.append({**check,"observed":observed,"status":"passed" if passed else "failed"})
    states = {result["status"] for result in results}
    return {**outcome,"status":"failed" if "failed" in states else "needs_review" if "needs_review" in states else "passed"}
