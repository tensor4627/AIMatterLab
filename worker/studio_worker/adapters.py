"""Engine contracts: argv-only launch and explicit environment registrations."""
import os
import subprocess
import shutil
import sys
from pathlib import Path
from .util import run_json, digest
ENGINES = ("gpumd.md", "pydyn.md", "pygas.build", "bias.validate", "gpumd.sampling",
           "pydyn.sampling", "nep.train", "nep.eval", "nep.analyze", "hotpp.train", "hotpp.eval",
           "hotpp.export", "pygas.reweight", "pygas.opes-reweight")
SCIENTIFIC = Path(__file__).with_name("scientific.py")


def process_env(environment, gpu=None):
    env = os.environ.copy()
    if gpu is not None:
        env["CUDA_VISIBLE_DEVICES"] = str(gpu)
    paths = [str(Path(v).resolve()) for v in environment.get("repositories", {}).values() if v]
    env["PYTHONPATH"] = os.pathsep.join(paths + ([env["PYTHONPATH"]] if env.get("PYTHONPATH") else []))
    for key, value in environment.get("variables", {}).items():
        if key not in ("LD_LIBRARY_PATH", "LIBRARY_PATH", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
            raise ValueError("Unsupported loader variable: " + key)
        env[key] = str(value)
    return env


class Adapter:
    def __init__(self, engine):
        if engine not in ENGINES:
            raise ValueError("Unsupported engine")
        self.engine = engine

    def executable(self, environment, name):
        path = Path(environment.get("executables", {}).get(name, ""))
        if not path.is_absolute() or not path.is_file() or not os.access(path, os.X_OK):
            raise ValueError("Register an available absolute executable: " + name)
        return str(path)

    def runtime_check(self, environment):
        executable = {"gpumd.md":"gpumd", "gpumd.sampling":"gpu-sampling", "nep.train":"nep", "nep.eval":"nep"}.get(self.engine)
        if executable is None:
            return {"status":"not_run", "scope":"No native ELF loader check for this route"}
        target = self.executable(environment, executable)
        with open(target,"rb") as stream:
            if stream.read(4) != b"\x7fELF":
                return {"status":"not_run", "scope":"Registered wrapper; actual engine launch still required"}
        loader = shutil.which("ldd") or next((str(p) for p in (Path("/usr/bin/ldd"),Path("/bin/ldd")) if p.is_file()),None)
        if not loader:
            return {"status":"not_run", "scope":"Loader inspection unavailable; actual engine launch still required"}
        print("Studio validation: native ELF loader check started", file=sys.stderr, flush=True)
        result = subprocess.run([loader,target],env=process_env(environment),capture_output=True,text=True,timeout=60)
        output = result.stdout + result.stderr
        if "not a dynamic executable" in output or "statically linked" in output:
            return {"status":"not_run", "scope":"Static executable; actual engine launch still required"}
        if result.returncode or "not found" in output or "undefined symbol:" in output:
            raise ValueError("Native ELF loader incompatible in the actual target environment; code=" + str(result.returncode) + "; " + output[:6000])
        return {"status":"passed", "executable":target, "sha256":digest(target), "scope":"Target ELF library/version resolution only; dynamic symbols, CUDA/artifact/engine checks still required"}

    def probe(self, environment):
        runtime = self.runtime_check(environment)
        report = run_json(self.executable(environment, "python"), SCIENTIFIC, "probe",
                          {"engine": self.engine, "repositories": environment.get("repositories", {})},
                          process_env(environment), timeout=120)
        report["native_runtime"] = runtime
        return report

    @staticmethod
    def require(assets, names):
        missing = [name for name in names if name not in assets]
        if missing:
            raise ValueError("Missing inputs: " + ", ".join(missing))

    @staticmethod
    def parameters(p, names):
        missing = [name for name in names if p.get(name) in (None, "", [])]
        if missing:
            raise ValueError("Scientific choices required: " + ", ".join(missing))

    def bias_command(self, spec, environment):
        p = spec["parameters"]
        runtime = "pydyn" if self.engine=="pydyn.sampling" else "pygas"
        repo = environment.get("repositories", {}).get(runtime)
        if not repo:
            raise ValueError("Register the pyGAS repository for artifact validation")
        script = Path(repo) / "agents/skills/pygas-check-gpumd-contract/scripts/validate_model.py"
        if not script.is_file():
            raise ValueError("pyGAS contract validator unavailable")
        command = [self.executable(environment, "python"), str(script), p["bias_file"],
                   p["structure_file"], "--mode", {"static":"bias", "metad":"bias", "wtmetad":"bias", "bias":"bias", "cvonly":"cvonly", "opes":"opes"}[p["mode"]], "--cutoff", str(p["cutoff"]),
                   "--cv-size", str(p["cv_size"]), "--device", "cuda"]
        if p.get("validation_history"):
            self.require(spec["inputs"], (p["validation_history"],))
            command += ["--history", p["validation_history"]]
        if p.get("kernel_capacity"):
            command += ["--kernel-capacity", str(p["kernel_capacity"])]
        return command

    def prepare(self, spec, environment):
        assets, p, engine = spec["inputs"], spec.get("parameters", {}), self.engine
        if engine.endswith(".sampling"):
            walkers = p.get("sampling", {}).get("walkers", p.get("walkers", 1))
            if type(walkers) is not int or walkers != 1:
                raise ValueError("Single-job single-walker sampling only; multiple walkers are not implemented")
        if engine.startswith("gpumd."):
            self.require(assets, ("run.in", "model.xyz"))
            if engine.endswith("sampling"):
                self.require(assets, ("GAScfg.yaml",))
                self.parameters(p, ("bias_file", "structure_file", "cv_size", "cutoff", "mode"))
                self.require(assets, (p["bias_file"], p["structure_file"]))
            return [self.executable(environment, "gpu-sampling" if engine.endswith("sampling") else "gpumd")]
        if engine.startswith("pydyn."):
            self.require(assets, ("run.py",))
            if engine.endswith("sampling"):
                self.parameters(p, ("bias_file", "structure_file", "cv_size", "cutoff", "mode"))
                self.require(assets, (p["bias_file"], p["structure_file"]))
            return [self.executable(environment, "python"), "run.py"]
        if engine == "pygas.build":
            self.require(assets, ("build_bias.py",))
            self.parameters(p, ("family", "cv_definition", "cv_units", "atom_selection",
                                "pbc_convention", "cutoff", "output_file"))
            return [self.executable(environment, "python"), "build_bias.py"]
        if engine == "bias.validate":
            self.parameters(p, ("bias_file", "structure_file", "cv_size", "cutoff", "mode"))
            self.require(assets, (p["bias_file"], p["structure_file"]))
            return self.bias_command(spec, environment)
        if engine == "nep.analyze":
            self.require(assets, ("energy_test.out","force_test.out","evaluation.json"))
            script = Path(environment.get("skills",{}).get("nep-regression-rmse","")) / "scripts/plot_nep_regression.py"
            if not script.is_absolute() or not script.is_file():
                raise ValueError("Register the original nep-regression-rmse skill directory")
            return [self.executable(environment,"python"),str(script),"--prediction-dir",".","--outdir","regression","--splits","test"]
        if engine == "nep.eval":
            self.require(assets, ("nep.in","evaluation.xyz","nep.txt"))
            self.parameters(p,("dataset_role",))
            if "train.xyz" in assets or "test.xyz" in assets:
                raise ValueError("NEP evaluation uses evaluation.xyz, copied explicitly to native prediction input")
            return [self.executable(environment,"python"),str(Path(__file__).with_name("nep_predict.py")),
                    self.executable(environment,"nep"),p["dataset_role"]]
        if engine == "nep.train":
            self.require(assets, ("nep.in", "train.xyz", "test.xyz"))
            return [self.executable(environment, "nep")]
        if engine == "hotpp.train":
            self.require(assets, ("input.yaml",))
            command = [self.executable(environment, "hotpp"), "train", "-i", "input.yaml", "-o", "model"]
            if p.get("checkpoint"):
                self.require(assets, (p["checkpoint"],))
                command += ["--load_checkpoint", p["checkpoint"]]
            return command
        if engine == "hotpp.eval":
            self.parameters(p, ("model_file", "dataset_file"))
            self.require(assets, (p["model_file"], p["dataset_file"]))
            return [self.executable(environment, "hotpp"), "eval", "-m", p["model_file"],
                    "-d", p["dataset_file"], "--device", "cuda", "--datatype", p.get("datatype", "ase")]
        if engine == "hotpp.export":
            self.parameters(p, ("model_file", "symbols"))
            self.require(assets, (p["model_file"],))
            if not isinstance(p["symbols"], list) or not p["symbols"] or any(
                    not isinstance(s, str) or not s.isalpha() for s in p["symbols"]):
                raise ValueError("Explicit chemical-symbol array required")
            return [self.executable(environment, "hotpp"), "freeze", p["model_file"],
                    "-s", *p["symbols"], "-o", "infer.pt", "--double", "-d", "cuda"]
        if engine == "pygas.reweight":
            self.parameters(p, ("bias_file",))
            self.require(assets, (p["bias_file"], "GASGaussian.txt", "fes.yaml"))
            return [self.executable(environment, "pygas"), "reweight", p["bias_file"], "GASGaussian.txt", "fes.yaml"]
        self.require(assets, ("OPES_COLVAR", "fes.yaml"))
        return [self.executable(environment, "pygas"), "opes-reweight", "OPES_COLVAR", "fes.yaml"]

    def input_contract(self, spec, directory):
        """Compare declared simple GPUMD controls with the actual immutable input.

        Arbitrary Python drivers and undeclared controls are not semantically proven.
        """
        if not self.engine.startswith("gpumd."):
            return {"status":"not_run", "scope":"arbitrary driver semantics require actual input review"}
        p=spec.get("parameters", {}); p={**p, **p.get("md", {})}
        rows=[line.split("#")[0].split() for line in (Path(directory)/"run.in").read_text().splitlines()]
        checked=[]
        for key, command in (("steps","run"),("n_steps","run"),("time_step_fs","time_step")):
            if key not in p:continue
            values=[float(r[1]) for r in rows if len(r)>1 and r[0]==command]
            actual=sum(values) if command=="run" else values[-1] if values else None
            if not values or actual!=float(p[key]):raise ValueError("Declared scientific parameter differs from run.in: "+key)
            checked.append(key)
        if "temperature" in p:
            values=[float(v) for r in rows if len(r)>3 and r[0]=="ensemble" and r[1].startswith(("nvt","npt")) for v in r[2:4]]
            if not values or any(v!=float(p["temperature"]) for v in values):raise ValueError("Declared temperature differs from run.in")
            checked.append("temperature")
        return {"status":"passed" if checked else "not_run", "checked_fields":checked, "scope":"declared simple GPUMD input controls only"}

    def validate(self, spec, environment, directory, *, probe_report=None):
        # A provenance-only failure may be cached by local Service; the execution
        # gate must inspect the native loader again for every new validation.
        runtime = self.runtime_check(environment)
        p, directory = spec.get("parameters", {}), Path(directory)
        self.input_contract(spec,directory)
        if p.get("manifest_file"):
            import json
            self.require(spec["inputs"],(p["manifest_file"],p["bias_file"]))
            manifest=json.loads((directory/p["manifest_file"]).read_text())
            backend="aoti" if p["bias_file"].endswith(".pt2") else "torchscript"
            artifact=manifest.get("artifacts",{}).get(backend,{})
            if self.engine=="pydyn.sampling" and manifest.get("deployment_backend")!=backend:
                raise ValueError("PyDyn manifest backend differs from the explicitly selected bias")
            actual=(directory/p["bias_file"]).resolve()
            selected=(directory/artifact.get("path","")).resolve()
            if selected!=actual or directory.resolve() not in actual.parents or artifact.get("sha256")!=digest(actual):
                raise ValueError("Selected serialized bias does not match its manifest path and SHA256")
        if p.get("model_file", "").startswith("lammps-") and self.engine.startswith("pydyn"):
            raise ValueError("PyDyn requires atomic-number semantics: use an ase-* HotPP export")
        if self.engine in ("nep.train","nep.eval"):
            rows = [line.split("#")[0].split() for line in (directory / "nep.in").read_text().splitlines()]
            modes = [r[1] for r in rows if len(r) > 1 and r[0] == "prediction"]
            expected = "1" if self.engine == "nep.eval" else "0"
            if (modes[-1] if modes else "0") != expected:
                raise ValueError("NEP prediction mode does not match run type")
            if self.engine == "nep.eval":
                if p.get("dataset_role") not in ("independent_test","validation","train"):
                    raise ValueError("Explicit dataset role required")
                header=(directory/"nep.txt").read_text().splitlines()[:6]
                config={r[0]:r[1:] for r in rows if r}
                model={line.split()[0]:line.split()[1:] for line in header}
                defaults={"cutoff":["8","4"],"n_max":["6","6"],"basis_size":["6","6"],"l_max":["4","2","0"],"neuron":["30"]}
                for name,default in defaults.items():
                    target=model.get("ANN" if name=="neuron" else name, [])[:len(default)]
                    values=config.get(name,default)
                    if list(map(float,values[:len(default)])) != list(map(float,target)):
                        raise ValueError("Prediction architecture mismatch: "+name)
                if config.get("type") != header[0].split()[1:]:
                    raise ValueError("Prediction species order does not match the model")

        if self.engine.endswith("sampling") or self.engine == "bias.validate":
            print("Studio validation: serialized artifact ABI started", file=sys.stderr, flush=True)
            result = subprocess.run(self.bias_command(spec, environment), cwd=directory,
                                    env=process_env(environment, spec["gpu"]), text=True,
                                    capture_output=True, timeout=180)
            if result.returncode:
                raise ValueError(result.stderr[-6000:] or result.stdout[-6000:])
            print("Studio validation: serialized artifact ABI passed", file=sys.stderr, flush=True)
            if self.engine == "gpumd.sampling":
                from .science_checks import check_gascfg
                check_gascfg(directory, p)
            elif self.engine == "pydyn.sampling":
                # Only the trusted caller's fresh, same-invocation report may be reused.
                # This argument is never populated from run parameters or cached provenance.
                observed = self.probe(environment) if probe_report is None else probe_report
                if (observed.get("scope", {}).get("engine") != self.engine or
                        observed.get("executable") != self.executable(environment, "python")):
                    raise ValueError("Native sampling probe belongs to a different engine/interpreter")
                if observed.get("pydyn_sampling") is not True:
                    raise ValueError("Selected environment has no pydyn.sampling integration")
            derivatives = None
            if p["mode"] != "opes" and not p["bias_file"].endswith(".pt2"):
                payload = {**p, "engine":self.engine, "bias_file":str(directory / p["bias_file"]), "structure_file":str(directory / p["structure_file"])}
                if p.get("validation_history"):
                    payload["validation_history"] = str(directory / p["validation_history"])
                print("Studio validation: sampled force/virial check started", file=sys.stderr, flush=True)
                derivatives = run_json(self.executable(environment,"python"),SCIENTIFIC,"derivatives",payload,process_env(environment,spec["gpu"]),timeout=120)
                print("Studio validation: sampled force/virial check passed", file=sys.stderr, flush=True)
            return {"status": "passed", "native_runtime":runtime, "artifact_status":"passed", "scientific_status":"not_run", "output": result.stdout[-12000:], "derivatives":derivatives,
                    "scope": "serialized bias ABI and sampled finite differences; target-engine and restart parity require run evidence"}
        if self.engine == "pygas.build" and p.get("output_file", "").endswith(".pt2"):
            raise ValueError("AOTI needs explicit dual export and target-toolchain preflight")
        return {"status": "passed", "native_runtime":runtime, "scientific_status":"not_run", "scope": "input/executable contract; scientific run pending"}

    def launch(self, command, **kwargs):
        return subprocess.Popen(command, **kwargs)

    def poll(self, run):
        return run["status"]

    def cancel(self, run):
        from .util import alive
        import signal
        if alive(run.get("identity")):
            os.kill(run["identity"]["pid"], signal.SIGTERM)
            return True
        return False

    def collect(self, directory):
        from .util import digest
        return [{"name": str(p.relative_to(directory)), "size": p.stat().st_size, "sha256": digest(p)}
                for p in sorted(Path(directory).rglob("*")) if p.is_file() and not p.is_symlink()]
