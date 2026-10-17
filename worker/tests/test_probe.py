"""Route-scoped discovery and diagnostics; no GPU/science success is simulated."""
import contextlib
import io
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.scientific import probe, probe_modules
from studio_worker.adapters import Adapter, process_env
from studio_worker.util import run_json


class Probe(unittest.TestCase):
    def test_native_route_does_not_import_standalone_or_trainers(self):
        self.assertEqual(probe_modules("pydyn.sampling"), ("torch", "cupy", "ase", "pydyn"))
        self.assertEqual(probe_modules("gpumd.sampling"), ("torch", "ase", "pygas"))
        self.assertEqual(probe_modules("hotpp.train"), ("torch", "ase", "hotpp"))

    def test_unrelated_sdks_are_not_imported_or_claimed(self):
        calls = []
        def load(name):
            calls.append(name)
            if name not in ("torch", "ase", "base"):
                raise AssertionError("Unrelated SDK import: " + name)
            return types.SimpleNamespace(__version__="fixture", __file__=None,
                version=types.SimpleNamespace(cuda=None), cuda=types.SimpleNamespace(is_available=lambda:False))
        with patch("studio_worker.scientific.importlib.import_module", side_effect=load), contextlib.redirect_stderr(io.StringIO()) as log:
            report = probe({"engine":"gpumd.sampling"})
        self.assertEqual(calls, ["torch", "ase", "base"])
        self.assertNotIn("pydyn", report["modules"])
        self.assertEqual(report["pydyn_sampling_status"], "not_run")
        self.assertNotIn("pydyn_sampling", report)
        self.assertIn("importing torch", log.getvalue())

    def test_native_origin_is_the_imported_sdk(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)/"__init__.py"
            source.write_text("# fixture")
            native = types.ModuleType("pydyn.sampling")
            native.__file__ = str(source)
            native.PyGASForceModel = object
            def load(name):
                if name == "pydyn.sampling":return native
                return types.SimpleNamespace(__version__="fixture", __file__=None,
                    version=types.SimpleNamespace(cuda=None), cuda=types.SimpleNamespace(is_available=lambda:False))
            with patch.dict(sys.modules, {"pydyn.sampling":native}), patch("studio_worker.scientific.importlib.import_module", side_effect=load), contextlib.redirect_stderr(io.StringIO()):
                report = probe({"engine":"pydyn.sampling"})
            self.assertTrue(report["pydyn_sampling"])
            self.assertEqual(report["pydyn_sampling_origin"], str(source))
            self.assertNotIn("pygas", report["modules"])

    def test_adapter_passes_selected_engine_and_bounded_cold_start(self):
        with patch("studio_worker.adapters.run_json", return_value={}) as run, patch.object(Adapter, "executable", return_value=sys.executable):
            Adapter("pydyn.sampling").probe({})
        self.assertEqual(run.call_args.args[3]["engine"], "pydyn.sampling")
        self.assertEqual(run.call_args.kwargs["timeout"], 120)

    def native_validation(self, evidence):
        adapter = Adapter("pydyn.sampling")
        spec = {"parameters":{"mode":"wtmetad", "bias_file":"bias.pt", "structure_file":"model.xyz"},"gpu":0}
        env = {"executables":{"python":sys.executable}}
        with patch.object(adapter,"input_contract"), patch.object(adapter,"bias_command",return_value=["fixture"]), patch.object(adapter,"probe") as probe_call, patch("studio_worker.adapters.subprocess.run",return_value=types.SimpleNamespace(returncode=0,stdout="ABI fixture",stderr="")), patch("studio_worker.adapters.run_json",return_value={"status":"passed"}) as derivatives:
            report = adapter.validate(spec,env,Path.cwd(),probe_report=evidence)
            probe_call.assert_not_called()
            self.assertEqual(derivatives.call_args.args[2], "derivatives")
            return report

    def test_same_invocation_probe_reuse_preserves_artifact_and_derivative_gates(self):
        evidence = {"executable":sys.executable,"scope":{"engine":"pydyn.sampling"},"pydyn_sampling":True}
        self.assertEqual(self.native_validation(evidence)["artifact_status"], "passed")

    def test_reuse_rejects_another_engine_interpreter_or_missing_native_capability(self):
        good = {"executable":sys.executable,"scope":{"engine":"pydyn.sampling"},"pydyn_sampling":True}
        for bad in ({**good,"scope":{"engine":"gpumd.sampling"}}, {**good,"executable":"/other/python"}, {**good,"pydyn_sampling":False}):
            with self.assertRaises(ValueError):self.native_validation(bad)

    def test_explicit_blas_thread_limits_reach_selected_interpreter(self):
        env = process_env({"variables":{"OPENBLAS_NUM_THREADS":1,"NUMEXPR_NUM_THREADS":"2"}})
        self.assertEqual(env["OPENBLAS_NUM_THREADS"], "1")
        self.assertEqual(env["NUMEXPR_NUM_THREADS"], "2")
        with self.assertRaises(ValueError):process_env({"variables":{"LD_PRELOAD":"unregistered.so"}})

    def test_missing_timed_out_or_non_git_provenance_is_explicit(self):
        import subprocess
        module = types.SimpleNamespace(__version__="fixture", __file__=None,
            version=types.SimpleNamespace(cuda=None), cuda=types.SimpleNamespace(is_available=lambda:False))
        cases = [(FileNotFoundError("git"), "blocked"), (subprocess.TimeoutExpired("git", 8), "unknown"), (types.SimpleNamespace(returncode=128,stdout="",stderr="not a checkout"), "not_run")]
        for result, expected in cases:
            with self.subTest(expected=expected), patch("studio_worker.scientific.subprocess.run") as git, patch("studio_worker.scientific.importlib.import_module",return_value=module), contextlib.redirect_stderr(io.StringIO()):
                if isinstance(result,Exception):git.side_effect=result
                else:git.return_value=result
                report=probe({"engine":"gpumd.sampling","repositories":{"pygas":"/registered-sdk"}})
                self.assertEqual(git.call_args.kwargs["timeout"],8)
                item=report["repositories"]["pygas"]
                self.assertEqual(item["status"],expected)
                self.assertIsNone(item["commit"])
                self.assertIsNone(item["dirty"])
                self.assertEqual(report["modules"]["pygas"]["status"],"passed")

    def test_native_loader_fails_before_sdk_import_on_missing_glibc(self):
        with tempfile.TemporaryDirectory() as folder:
            binary=Path(folder)/"gpu-sampling";binary.write_bytes(b"\x7fELFfixture")
            adapter=Adapter("gpumd.sampling")
            with patch.object(adapter,"executable",return_value=str(binary)), patch("studio_worker.adapters.shutil.which",return_value="/usr/bin/ldd"), patch("studio_worker.adapters.subprocess.run",return_value=types.SimpleNamespace(returncode=1,stdout="GLIBC_2.34 not found",stderr="")), patch("studio_worker.adapters.run_json") as sdk:
                with self.assertRaisesRegex(ValueError,"Native ELF loader incompatible.*GLIBC_2.34"):
                    adapter.probe({})
                sdk.assert_not_called()

    def test_wrappers_do_not_fabricate_native_loader_success(self):
        with tempfile.TemporaryDirectory() as folder:
            wrapper=Path(folder)/"wrapper";wrapper.write_text("#!/bin/sh\nexec registered-engine \"$@\"\n")
            adapter=Adapter("gpumd.sampling")
            with patch.object(adapter,"executable",return_value=str(wrapper)):
                self.assertEqual(adapter.runtime_check({})["status"],"not_run")

    def test_timeout_preserves_actual_subprocess_diagnostics(self):
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder)/"slow.py"
            script.write_text("import sys,time\nprint('importing actual-slow-sdk',file=sys.stderr,flush=True)\ntime.sleep(10)\n")
            with self.assertRaisesRegex(ValueError, "Scientific probe timed out.*actual-slow-sdk"):
                run_json(sys.executable, script, "probe", {}, timeout=1)

    def test_nonzero_exit_preserves_exit_code_and_both_streams(self):
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder)/"fail.py"
            script.write_text("import sys\nprint('stdout detail',flush=True)\nprint('stderr detail',file=sys.stderr,flush=True)\nsys.exit(7)\n")
            with self.assertRaisesRegex(ValueError, "code 7; stderr: stderr detail.*") as error:
                run_json(sys.executable,script,"probe",{})
            self.assertIn("stdout detail", str(error.exception))

    def test_diagnostics_do_not_corrupt_json_protocol(self):
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder)/"ok.py"
            script.write_text("import sys\nprint('progress',file=sys.stderr,flush=True)\nprint('{\"status\":\"not_run\"}')\n")
            self.assertEqual(run_json(sys.executable, script, "probe", {}), {"status":"not_run"})

if __name__ == "__main__":unittest.main()
