#!/usr/bin/env python3
"""Read-only parity check: declaration-bound argv vs built-in adapter argv.

Run from the Studio checkout inside Linux/WSL with explicit repositories:

    python3 scripts/check-aimlab-parity.py --repos-root /mnt/d/data/software

The built-in baseline is forced with STUDIO_DECLARATION_DRIVEN=0. The declared side uses
the production default path (declarations are read from registered repositories only).
No engine is installed, launched or scientifically validated.
"""
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "worker"))

from studio_worker.tools import adapters  # noqa: E402

REPOSITORIES = {"gpumd": "GPUMD", "pygas": "pygas", "pydyn": "pydyn", "hotpp": "hotpp", "torchnep": "torchnep"}
EXECUTABLES = ("python", "gpumd", "gpu-sampling", "nep", "pygas", "hotpp")


def environment(repos_root):
    repos = {}
    for key, name in REPOSITORIES.items():
        path = Path(repos_root) / name
        if path.is_dir():
            repos[key] = str(path)
    skill_root = Path(tempfile.mkdtemp(prefix="aimlab-parity-skill-"))
    (skill_root / "scripts").mkdir()
    (skill_root / "scripts" / "plot_nep_regression.py").write_text("", encoding="utf-8")
    return {
        "executables": {name: sys.executable for name in EXECUTABLES},
        "repositories": repos,
        "skills": {"nep-regression-rmse": str(skill_root)},
    }


def files(*names):
    return {name: "/tasks/" + name for name in names}


def case(engine, inputs, parameters=None, label=None):
    return {"engine": engine, "inputs": inputs, "parameters": parameters or {}, "label": label or engine}


def cases():
    cases = [
        case("gpumd.md", files("run.in", "model.xyz")),
        case("gpumd.sampling", files("run.in", "model.xyz", "GAScfg.yaml", "bias.pt"),
             {"bias_file": "bias.pt", "structure_file": "model.xyz", "cv_size": 1, "cutoff": 5, "mode": "metad"}),
        case("gpumd.neb", files("run.in"), {"neb": {"optimizer": "fire", "max_steps": 30}}),
        case("nep.train", files("nep.in", "train.xyz", "test.xyz")),
        case("nep.eval", files("nep.in", "train.xyz", "nep.txt")),
        case("nep.analyze", files("energy_train.out", "force_train.out")),
        case("pydyn.md", files("run.py")),
        case("pydyn.sampling", files("run.py", "bias.pt", "model.xyz"),
             {"bias_file": "bias.pt", "structure_file": "model.xyz", "cv_size": 1, "cutoff": 5, "mode": "metad"}),
        case("pygas.build", files("build_bias.py"),
             {"family": "wtmetad", "cv_definition": "distance", "cv_units": "angstrom", "atom_selection": "all",
              "pbc_convention": "periodic", "cutoff": 5, "output_file": "bias.pt"}),
        case("pygas.reweight", files("bias.pt", "GASGaussian.txt", "fes.yaml"), {"bias_file": "bias.pt"}),
        case("pygas.opes-reweight", files("OPES_COLVAR", "fes.yaml")),
        case("hotpp.train", files("input.yaml")),
        case("hotpp.train", files("input.yaml", "best.ckpt"), {"checkpoint": "best.ckpt"}, "hotpp.train-checkpoint"),
        case("hotpp.eval", files("best.pt", "data.xyz"), {"model_file": "best.pt", "dataset_file": "data.xyz"}),
        case("hotpp.export", files("best.pt"), {"model_file": "best.pt", "symbols": ["C", "H"]}),
    ]
    for mode in ("static", "metad", "wtmetad", "bias"):
        cases.append(case("bias.validate", files("bias.pt", "model.xyz"),
                          {"bias_file": "bias.pt", "structure_file": "model.xyz", "cv_size": 1, "cutoff": 5, "mode": mode},
                          "bias.validate-" + mode))
    cases.append(case("bias.validate", files("bias.pt", "model.xyz", "history.txt"),
                      {"bias_file": "bias.pt", "structure_file": "model.xyz", "cv_size": 1, "cutoff": 5, "mode": "bias",
                       "validation_history": "history.txt", "kernel_capacity": 256}, "bias.validate-history"))
    return cases


def negative_cases():
    return [
        {"engine": "gpumd.md", "inputs": {}, "parameters": {}, "label": "gpumd.md-missing-inputs"},
        {"engine": "gpumd.sampling", "inputs": files("run.in", "model.xyz", "GAScfg.yaml"),
         "parameters": {"bias_file": "bias.pt", "structure_file": "model.xyz", "cv_size": 1, "cutoff": 5,
                        "mode": "metad", "walkers": 2}, "label": "gpumd.sampling-multiple-walkers"},
    ]


def prepare(engine, spec, env, *, declared):
    previous = {key: os.environ.get(key) for key in ("STUDIO_DECLARATION_DRIVEN", "STUDIO_REQUIRE_TOOL_DECLARATIONS")}
    try:
        if declared:
            os.environ.pop("STUDIO_DECLARATION_DRIVEN", None)
            os.environ.pop("STUDIO_REQUIRE_TOOL_DECLARATIONS", None)
        else:
            os.environ["STUDIO_DECLARATION_DRIVEN"] = "0"
            os.environ.pop("STUDIO_REQUIRE_TOOL_DECLARATIONS", None)
        return {"argv": adapters.Adapter(engine).prepare(spec, env), "error": None}
    except Exception as error:  # noqa: BLE001 - evidence report keeps the concrete failure
        return {"argv": None, "error": type(error).__name__ + ": " + str(error)}
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repos-root", required=True, help="Directory containing GPUMD, pygas, pydyn, hotpp and torchnep checkouts")
    parser.add_argument("--out", help="New JSON report path (optional)")
    options = parser.parse_args(argv)
    repos_root = Path(options.repos_root).resolve()
    if not repos_root.is_dir():
        raise SystemExit("aimlab_parity: --repos-root is not a directory")
    env = environment(repos_root)
    results, failures = [], []
    for spec in cases():
        baseline = prepare(spec["engine"], spec, env, declared=False)
        declared = prepare(spec["engine"], spec, env, declared=True)
        parity = baseline["error"] is None and declared["error"] is None and baseline["argv"] == declared["argv"]
        results.append({"label": spec["label"], "engine": spec["engine"], "parity": parity,
                        "baseline": baseline, "declared": declared})
        if not parity:
            failures.append(spec["label"])
    negatives = []
    for spec in negative_cases():
        baseline = prepare(spec["engine"], spec, env, declared=False)
        declared = prepare(spec["engine"], spec, env, declared=True)
        rejected = baseline["error"] is not None and declared["error"] is not None
        negatives.append({"label": spec["label"], "engine": spec["engine"], "rejected": rejected,
                          "baseline_error": baseline["error"], "declared_error": declared["error"]})
        if not rejected:
            failures.append(spec["label"] + "-not-rejected")
    report = {
        "schema_version": 1,
        "scope": "aimlab_declaration_adapter_parity",
        "status": "passed" if not failures else "failed",
        "repos_root": str(repos_root),
        "repositories": env["repositories"],
        "case_count": len(results),
        "parity_count": sum(1 for item in results if item["parity"]),
        "negative_count": len(negatives),
        "failures": failures,
        "results": results,
        "negative_results": negatives,
        "installation": {"status": "not_run"},
        "tests": {"status": "not_run"},
        "release": {"status": "not_run"},
    }
    text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if options.out:
        target = Path(options.out)
        if not target.is_absolute():
            raise SystemExit("aimlab_parity: --out must be an absolute path")
        if target.exists():
            raise SystemExit("aimlab_parity: --out must be a new file")
        target.write_text(text, encoding="utf-8")
    print(json.dumps({"status": report["status"], "case_count": report["case_count"],
                      "parity_count": report["parity_count"], "negative_count": report["negative_count"],
                      "failures": report["failures"]}, ensure_ascii=False))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
