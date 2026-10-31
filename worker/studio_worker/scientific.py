"""Executed in the registered engine interpreter, not the stdlib supervisor."""
import hashlib
import importlib
import json
import math
import subprocess
import sys
from collections import Counter
from pathlib import Path
if __package__:
    from .source_git_identity import git_identity, SourceGitError
else:
    from source_git_identity import git_identity, SourceGitError


def probe_modules(engine):
    """Import only the selected route; unrelated SDKs can have expensive startup."""
    if engine == "installation.check":
        return ()
    if engine is None:
        return ("torch", "cupy", "ase", "pygas", "pydyn", "hotpp")
    if engine.startswith("pydyn."):
        return ("torch", "cupy", "ase", "pydyn")
    if engine.startswith("hotpp."):
        return ("torch", "ase", "hotpp")
    if engine in ("gpumd.sampling", "pygas.build", "bias.validate") or engine.startswith("pygas."):
        return ("torch", "ase", "pygas")
    if engine in ("gpumd.md", "gpumd.neb") or engine.startswith("nep."):
        return ("torch", "ase")
    raise ValueError("Unsupported probe engine")


def probe(payload):
    report = {"platform": __import__("platform").platform(), "python": sys.version, "executable": sys.executable, "modules": {}, "repositories": {}}
    try:
        import resource
        report["process_limits"] = {name: list(resource.getrlimit(getattr(resource, key)))
            for name, key in (("address_space", "RLIMIT_AS"), ("data", "RLIMIT_DATA"), ("rss", "RLIMIT_RSS"), ("stack", "RLIMIT_STACK"))}
        print("Studio environment probe: process limits " + json.dumps(report["process_limits"]), file=sys.stderr, flush=True)
    except ImportError:
        report["process_limits_status"] = "not_run"
    modules = probe_modules(payload.get("engine"))
    report["scope"] = {"engine": payload.get("engine"), "modules": list(modules)}
    for name in modules:
        print("Studio environment probe: importing " + name, file=sys.stderr, flush=True)
        try:
            module = importlib.import_module("base" if name == "pygas" else name)
            report["modules"][name] = {"version": str(getattr(module, "__version__", "unknown")),
                                      "file": getattr(module, "__file__", None), "status": "passed"}
            if name == "pygas":
                selected=payload.get("repositories",{}).get("pygas")
                actual=Path(module.__file__).resolve() if getattr(module,"__file__",None) else None
                report["modules"][name]["registration_match"]=actual.is_relative_to(Path(selected).resolve()) if selected and actual else None
                report["pygas_capabilities"]={k:hasattr(module,k) for k in ("CVOnlyProcedure","MetaDProcedure","WTMetaDProcedure","OPESProcedure","export_model_bundle")}
                if selected and report["modules"][name]["registration_match"] is False:
                    report["modules"][name].update(status="blocked",error="Imported pyGAS differs from explicit registered source")
            if name == "torch":
                print("Studio environment probe: checking CUDA availability", file=sys.stderr, flush=True)
                report["cuda"] = module.version.cuda
                report["cuda_available"] = module.cuda.is_available()
                if report["cuda_available"]:
                    print("Studio environment probe: reading allocated GPU", file=sys.stderr, flush=True)
                    report["gpu"] = module.cuda.get_device_name(0)
        except Exception as exc:
            report["modules"][name] = {"status": "blocked", "error": str(exc)}
            print("Studio environment probe: " + name + " blocked: " + str(exc), file=sys.stderr, flush=True)
    if "pydyn" in modules:
        print("Studio environment probe: importing pydyn.sampling", file=sys.stderr, flush=True)
        try:
            from pydyn.sampling import PyGASForceModel
            report["pydyn_sampling"] = True
            sampling = Path(importlib.import_module("pydyn.sampling").__file__)
            report["pydyn_sampling_origin"] = str(sampling)
            source = sampling.parent / "upstream.json"
            report["pygas_upstream"] = json.loads(source.read_text()) if source.exists() else None
        except Exception as exc:
            report["pydyn_sampling"] = False
            report["sampling_error"] = str(exc)
    else:
        report["pydyn_sampling_status"] = "not_run"
    for name, path in payload.get("repositories", {}).items():
        item = {"path": path, "commit": None, "dirty": None, "status": "not_run"}
        report["repositories"][name] = item
        try:
            identity = git_identity(path)
            item.update(commit=identity['commit'],dirty=identity['dirty'],status='passed')
        except (SourceGitError,OSError,ValueError) as error:
            item.update(status=getattr(error,'status','not_run'),reason='Git source identity unavailable; explicit source metadata observation required')
    for item in report["modules"].values():
        source = item.get("file")
        if source and Path(source).is_file():
            try:
                if Path(source).stat().st_size <= 16 * 1024 * 1024:
                    item["source_sha256"] = hashlib.sha256(Path(source).read_bytes()).hexdigest()
            except OSError as exc:
                item["source_hash_status"] = "unknown"
    return report


def structure(payload):
    from ase.io import read
    atoms = read(payload["path"], index=int(payload.get("frame", 0)))
    if len(atoms) > 20000:
        raise ValueError("Structure preview limited to 20,000 atoms; select a smaller region")
    return {"positions": atoms.positions.tolist(), "symbols": atoms.get_chemical_symbols(), "numbers": atoms.numbers.tolist(),
            "cell": atoms.cell.array.tolist(), "pbc": atoms.pbc.tolist(), "n_atoms": len(atoms),
            "frame": payload.get("frame", 0)}


def dataset(payload):
    from ase.io import iread
    frames, elements, labels, fingerprints = 0, Counter(), Counter(), []
    for atoms in iread(payload["path"], index=":"):
        frames += 1
        elements.update(atoms.get_chemical_symbols())
        results = atoms.calc.results if atoms.calc else {}
        for label in ("energy", "forces", "stress", "virial"):
            if label in results or label in atoms.info or label in atoms.arrays:
                labels[label] += 1
        h = hashlib.sha256(atoms.numbers.tobytes() + atoms.positions.tobytes() + atoms.cell.array.tobytes())
        fingerprints.append(h.hexdigest())
    return {"frames": frames, "elements": dict(elements), "labels": dict(labels),
            "structure_hashes": fingerprints, "scope": "label inventory; reference provenance must be supplied"}


def regression(payload):
    directory = Path(payload["path"])
    split = payload.get("split", "test")
    result = {"split": split, "metrics": {}}
    for kind, columns, units, scale in (("energy", 1, "meV/atom", 1000),
                                       ("force", 3, "eV/Angstrom", 1),
                                       ("virial", 6, "eV/atom", 1)):
        path = directory / f"{kind}_{split}.out"
        if not path.exists():
            result["metrics"][kind] = {"status": "not_run"}
            continue
        squares, count = 0.0, 0
        for line in path.read_text().splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            values = [float(v) for v in line.split()]
            if len(values) != 2 * columns or not all(math.isfinite(v) for v in values):
                raise ValueError(f"Malformed {kind} prediction output")
            for prediction, reference in zip(values[:columns], values[columns:]):
                if kind == "virial" and reference == -1e6:
                    continue
                squares += (prediction - reference) ** 2
                count += 1
        result["metrics"][kind] = {"status": "passed" if count else "not_run", "count": count,
                                  "rmse": math.sqrt(squares / count) * scale if count else None,
                                  "units": units}
    return result


if __name__ == "__main__":
    from derivatives import check
    from neb_checks import validate as neb_validate
    from structure_tools import create, render, suggest
    operations = {"suggest":suggest,"create_structure":create,"render_pygas":render,"neb":neb_validate,"derivatives":check, "probe": probe, "structure": structure, "dataset": dataset, "regression": regression}
    import faulthandler
    if sys.argv[1] == "probe":
        faulthandler.enable()
        faulthandler.dump_traceback_later(45, repeat=False)
    try:
        print(json.dumps(operations[sys.argv[1]](json.load(sys.stdin)), allow_nan=False))
    finally:
        if sys.argv[1] == "probe":
            faulthandler.cancel_dump_traceback_later()
