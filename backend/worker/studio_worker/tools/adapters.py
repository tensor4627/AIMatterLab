"""Engine contracts: argv-only launch and explicit environment registrations."""
import os
import subprocess
import shutil
import sys
from pathlib import Path
from studio_worker.infrastructure.util import run_json, digest
ENGINES = ("gpumd.neb", "gpumd.md", "pydyn.md", "pygas.build", "bias.validate", "gpumd.sampling",
           "pydyn.sampling", "nep.train", "nep.eval", "nep.analyze", "hotpp.train", "hotpp.eval",
           "hotpp.export", "pygas.reweight", "pygas.opes-reweight")
# Installer-only fixed scripts are not scientific engine choices or defaults.
SUPPORTED_ENGINES = ENGINES + ("installation.check",)
# Migration set: declaration-driven prepare is the default for routes whose production argv
# is parity-checked against this adapter. A declaration may replace only argv construction;
# the built-in adapter still validates inputs, parameters, walkers and numerical controls.
DEFAULT_DECLARATION_ENGINES = (
    "gpumd.md", "gpumd.sampling", "gpumd.neb", "nep.train", "nep.eval", "nep.analyze",
    "pydyn.md", "pydyn.sampling",
    "pygas.build", "bias.validate", "pygas.reweight", "pygas.opes-reweight",
    "hotpp.train", "hotpp.eval", "hotpp.export",
)
INSTALLATION_CHECKS = {
    "worker": "badf992b842e3a6dbcb29a009475f1f1e98e98f70efeb86c34e682305c7d0c13",
    "reference-md": "ef19e44d075637647263bf5ffff804d8ce70a8b6f890510a21953920f027e751",
}
PACKAGE_ROOT = Path(__file__).parent.parent
SCIENTIFIC = PACKAGE_ROOT / "scientific.py"


def process_env(environment, gpu=None):
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    if gpu is not None:
        env["CUDA_VISIBLE_DEVICES"] = str(gpu)
    paths = [str(Path(v).resolve()) for v in environment.get("repositories", {}).values() if v]
    env["PYTHONPATH"] = os.pathsep.join(paths + ([env["PYTHONPATH"]] if env.get("PYTHONPATH") else []))
    for key, value in environment.get("variables", {}).items():
        if key not in ("LD_LIBRARY_PATH", "LIBRARY_PATH", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS", "PYTHONDONTWRITEBYTECODE"):
            raise ValueError("Unsupported loader variable: " + key)
        if key=="PYTHONDONTWRITEBYTECODE" and str(value)!="1":raise ValueError("Scientific source bytecode writes are disabled")
        env[key] = str(value)
    return env


class Adapter:
    def __init__(self, engine):
        if engine not in SUPPORTED_ENGINES:
            raise ValueError("Unsupported engine")
        self.engine = engine

    def executable(self, environment, name):
        path = Path(environment.get("executables", {}).get(name, ""))
        if not path.is_absolute() or not path.is_file() or not os.access(path, os.X_OK):
            raise ValueError("Register an available absolute executable: " + name)
        return str(path)

    def runtime_check(self, environment):
        executable = {"gpumd.neb":"gpu-sampling", "gpumd.md":"gpumd", "gpumd.sampling":"gpu-sampling", "nep.train":"nep", "nep.eval":"nep"}.get(self.engine)
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

    def pydyn_import_contract(self, environment, observed=None):
        """Current required imports only; this is not model or numerical validation."""
        from studio_worker.tools.scientific import probe_modules
        observed = self.probe(environment) if observed is None else observed
        if not isinstance(observed, dict) or observed.get("status") == "blocked":
            detail = observed.get("error", "No current probe result") if isinstance(observed, dict) else "Invalid probe result"
            raise ValueError("PyDyn environment probe failed: " + str(detail)[:2000])
        scope = observed.get("scope")
        if (not isinstance(scope, dict) or scope.get("engine") != self.engine or
                observed.get("executable") != self.executable(environment, "python")):
            raise ValueError("PyDyn import probe belongs to a different engine/interpreter")
        modules = observed.get("modules")
        if not isinstance(modules, dict):
            raise ValueError("PyDyn import probe has no module observations")
        required = probe_modules(self.engine)
        missing = [name for name in required if not isinstance(modules.get(name), dict) or modules[name].get("status") != "passed"]
        if missing:
            details = "; ".join(name + ": " + str(modules.get(name, {}).get("error", "not available"))[:500]
                                for name in missing if isinstance(modules.get(name, {}), dict))
            raise ValueError("Required PyDyn runtime imports failed (" + ", ".join(missing) + "). " + details +
                             ". Configure the selected environment's dependencies or explicit source repositories before preparing a new run.")
        registered = environment.get("repositories", {}).get("pydyn")
        if registered:
            origin = modules["pydyn"].get("file")
            if not isinstance(origin, str) or not Path(origin).is_absolute() or not Path(origin).resolve().is_relative_to(Path(registered).resolve()):
                raise ValueError("Imported PyDyn differs from the explicitly registered source; verify the selected environment")
        return {"status": "passed", "modules": list(required),
                "scope": "Current required imports and registered PyDyn source only; model, numerical and engine-run checks remain separate"}

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

    def _declaration_binding(self, spec, environment):
        """Return the declaration-bound argv and source, or None for the built-in path."""
        mode = os.environ.get("STUDIO_DECLARATION_DRIVEN", "auto")
        if mode == "0":
            return None
        allowlist = os.environ.get("STUDIO_DECLARATION_ENGINES")
        if allowlist is not None:
            enabled = self.engine in [item.strip() for item in allowlist.split(",") if item.strip()]
        elif mode == "1":
            enabled = True
        else:
            enabled = self.engine in DEFAULT_DECLARATION_ENGINES
        if not enabled:
            return None
        from studio_worker.tools.declarations import bind_operation, find_declaration
        declaration = find_declaration(environment.get("repositories", {}), self.engine)
        if declaration is None:
            if os.environ.get("STUDIO_REQUIRE_TOOL_DECLARATIONS") == "1":
                raise ValueError("Tool declaration required for engine " + self.engine + "; register the tool source containing aimlab-tools/manifest.json")
            return None
        from studio_worker.tools import engine_contracts
        bound_spec = {**spec, "parameters": engine_contracts.transform_parameters(self.engine, spec.get("parameters", {}))}
        return {
            "argv": bind_operation(declaration, bound_spec, environment)["argv"],
            "spec": bound_spec,
            "declaration": declaration,
        }

    def _declaration_argv(self, spec, environment):
        """Declaration-driven production argv for the migration set; None means fallback built-in adapter."""
        binding = self._declaration_binding(spec, environment)
        return None if binding is None else binding["argv"]

    def prepare(self, spec, environment):
        """Prepare a production argv. A declaration may replace argv construction only.

        The built-in adapter path always validates required inputs, required/optional
        parameters, single-walker policy and numerical validation controls. When a
        declaration exists, those checks still run through the built-in path before the
        declaration-bound argv is returned, so a thinner declaration cannot silently
        accept an unprepared task.
        """
        binding = self._declaration_binding(spec, environment)
        if binding is not None:
            from studio_worker.tools import engine_contracts
            validation_environment = {**environment, "repositories": dict(environment.get("repositories") or {})}
            repository_key = engine_contracts.repository_key(binding["declaration"].get("tool_id"))
            if repository_key and repository_key not in validation_environment["repositories"]:
                validation_environment["repositories"][repository_key] = binding["declaration"]["repository"]
            self._builtin_prepare(binding["spec"], validation_environment)
            return binding["argv"]
        return self._builtin_prepare(spec, environment)

    def _builtin_prepare(self, spec, environment):
        assets, p, engine = spec["inputs"], spec.get("parameters", {}), self.engine
        if engine == "installation.check":
            if set(assets) != {"run.py"} or set(p) != {"installation_case"} or p["installation_case"] not in INSTALLATION_CHECKS:
                raise ValueError("Only shipped worker/reference installation cases are accepted")
            return [self.executable(environment, "python"), "run.py"]
        from studio_worker.tools.derivative_selection import validate_controls
        validate_controls(p,engine)
        if engine.endswith(".sampling"):
            walkers = p.get("sampling", {}).get("walkers", p.get("walkers", 1))
            if type(walkers) is not int or walkers != 1:
                raise ValueError("Single-job single-walker sampling only; multiple walkers are not implemented")
        if engine == "gpumd.neb":
            self.require(assets, ("run.in",))
            if p.get("bias_file") or p.get("manifest_file"):
                raise ValueError("Native NEB uses structures and potentials, not a bias artifact")
            return [self.executable(environment, "gpu-sampling")]
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
            registered = environment.get("repositories", {}).get("gpumd")
            if not registered:
                raise ValueError("Register the GPUMD tool source; nep.eval production helper tools/nep_predict.py is no longer shipped in Studio")
            script = Path(registered) / "tools" / "nep_predict.py"
            if not script.is_file():
                raise ValueError("The registered GPUMD tool source has no tools/nep_predict.py")
            return [self.executable(environment,"python"),str(script),
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
        if self.engine == "installation.check":
            import hashlib
            case = spec.get("parameters", {}).get("installation_case")
            script = Path(directory) / "run.py"
            # Normalize text newlines so Windows and Linux copies agree.
            actual = hashlib.sha256(script.read_text(encoding="utf-8").encode("utf-8")).hexdigest()
            if case not in INSTALLATION_CHECKS or actual != INSTALLATION_CHECKS[case]:
                raise ValueError("Installation check input differs from the shipped fixed example")
            return {"status": "passed", "case": case, "scope": "Exact shipped installation input only"}
        if self.engine == "gpumd.neb":
            from studio_worker.tools.neb_checks import contract
            return {"status":"passed", "neb":contract(directory,spec["inputs"],spec.get("parameters",{}).get("neb"))}
        if not self.engine.startswith("gpumd."):
            return {"status":"not_run", "scope":"arbitrary driver semantics require actual input review"}
        p=spec.get("parameters", {}); p={**p, **p.get("md", {})}
        rows=[line.split("#")[0].split() for line in (Path(directory)/"run.in").read_text().splitlines()]
        if self.engine in ("gpumd.md", "gpumd.sampling") and spec.get("parent_run"):
            if any(row and row[0] == "velocity" for row in rows):
                raise ValueError("GPUMD continuation input must not initialize velocity")
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

    def validate(self, spec, environment, directory, *, probe_report=None, cell_derivative_contract=None):
        # A provenance-only failure may be cached by local Service; the execution
        # gate must inspect the native loader again for every new validation.
        from studio_worker.tools.derivative_selection import validate_controls
        validate_controls(spec.get("parameters", {}), self.engine)
        runtime = self.runtime_check(environment)
        p, directory = spec.get("parameters", {}), Path(directory)
        self.input_contract(spec,directory)
        if self.engine == "installation.check":
            self.prepare(spec, environment)
            return {"status": "passed", "scientific_status": "not_run", "scope": "Fixed installation input contract; actual worker/reference run pending; not a PyDyn check"}
        if self.engine == "pygas.build":
            first=(directory/"build_bias.py").read_text(encoding="utf-8").splitlines()[0]
            if first.startswith("# studio-pygas-source: "):
                import json
                source=json.loads(first.split(": ",1)[1]);registered=environment.get("repositories",{}).get("pygas")
                binding=source.get('composition')
                if binding:
                    import hashlib
                    from studio_worker.workspace.composition_store import encoded
                    graph_path=directory/'workflow.json'
                    if binding.get('schema')!='studio.composition/1' or not graph_path.is_file():raise ValueError('Canonical graph/source binding unavailable')
                    graph=json.loads(graph_path.read_text(encoding='utf8'))
                    body=(directory/'build_bias.py').read_text(encoding='utf8').split('\n',1)[1]
                    for name,expected in binding.get('inputs',{}).items():
                        if not isinstance(name,str) or Path(name).name!=name:raise ValueError('Invalid canonical composition input binding')
                        self.require(spec['inputs'],(name,))
                        if digest(directory/name)!=expected:raise ValueError('Canonical composition selected input changed; rerender and review')
                    if hashlib.sha256(encoded(graph)).hexdigest()!=binding.get('graph_sha256') or hashlib.sha256(body.encode('utf8')).hexdigest()!=binding.get('body_sha256'):raise ValueError('Canonical graph/source pair changed; rerender together and review')
                io=source.get('io',{})
                if io.get('portable'):
                    self.require(spec['inputs'],tuple(io.get('inputs',[]))+(io['workflow'],))
                    if p.get('output_file') not in io.get('outputs',[]):raise ValueError('Declared build output differs from the actual generated source')
                    if any(name.endswith('.pt2') for name in io.get('outputs',[])):raise ValueError('AOTI needs explicit dual export and target-toolchain preflight')
                if not registered or Path(registered).resolve()!=Path(source["root"]).resolve():raise ValueError("Generated CV source differs from registered pyGAS environment; register the intended source explicitly")
                if digest(Path(registered)/"base/colvar.py")!=source["colvar_sha256"]:raise ValueError("pyGAS source changed after graph rendering; regenerate and review")
                for relative,expected in source.get("files",{}).items():
                    import re
                    if not re.fullmatch(r"(?:base/[A-Za-z0-9_]+|tools/(?:graph_workflow|cv_bias_gui_server))\.py",relative):raise ValueError("Invalid generated source manifest")
                    if digest(Path(registered)/relative)!=expected:raise ValueError("pyGAS source changed after graph rendering; regenerate and review")
        if self.engine == "gpumd.neb":
            report = run_json(self.executable(environment,"python"),SCIENTIFIC,"neb",
                {"directory":str(directory),"inputs":list(spec["inputs"]),"declared":p.get("neb")},
                process_env(environment,spec["gpu"]),timeout=60)
            return {**report,"native_runtime":runtime}
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
                from studio_worker.tools.science_checks import check_gascfg
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
            derivatives = {"status":"not_run", "reason":"OPES stateful finite-difference validation is not implemented; only serialized ABI/state checks were performed"} if p["mode"] == "opes" else None
            if p["mode"] != "opes" and not p["bias_file"].endswith(".pt2"):
                payload = {**p, "engine":self.engine, "bias_file":str(directory / p["bias_file"]), "structure_file":str(directory / p["structure_file"]), "_studio_cell_contract":cell_derivative_contract}
                if p.get("validation_history"):
                    payload["validation_history"] = str(directory / p["validation_history"])
                print("Studio validation: sampled force/virial check started", file=sys.stderr, flush=True)
                derivatives = run_json(self.executable(environment,"python"),SCIENTIFIC,"derivatives",payload,process_env(environment,spec["gpu"]),timeout=120)
                print("Studio validation: sampled force/virial check passed", file=sys.stderr, flush=True)
            return {"status": "passed", "native_runtime":runtime, "artifact_status":"passed", "scientific_status":"not_run", "output": result.stdout[-12000:], "derivatives":derivatives,
                    "scope": ("serialized OPES ABI/state checks only; finite differences not_run; target-engine and restart parity require run evidence" if p["mode"] == "opes" else "serialized bias ABI and sampled finite differences; target-engine and restart parity require run evidence")}
        if self.engine == "pygas.build" and p.get("output_file", "").endswith(".pt2"):
            raise ValueError("AOTI needs explicit dual export and target-toolchain preflight")
        if self.engine == "pydyn.md":
            imports = self.pydyn_import_contract(environment, probe_report)
            return {"status": "passed", "native_runtime": runtime, "runtime_imports": imports,
                    "scientific_status": "not_run", "scope": "input/executable and required PyDyn import contracts; scientific run pending"}
        return {"status": "passed", "native_runtime":runtime, "scientific_status":"not_run", "scope": "input/executable contract; scientific run pending"}

    def launch(self, command, **kwargs):
        return subprocess.Popen(command, **kwargs)

    def poll(self, run):
        return run["status"]

    def cancel(self, run):
        from studio_worker.infrastructure.util import alive
        import signal
        if alive(run.get("identity")):
            os.kill(run["identity"]["pid"], signal.SIGTERM)
            return True
        return False

    def collect(self, directory):
        from studio_worker.infrastructure.util import digest
        return [{"name": str(p.relative_to(directory)), "size": p.stat().st_size, "sha256": digest(p)}
                for p in sorted(Path(directory).rglob("*")) if p.is_file() and not p.is_symlink()]
