import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.service import Service
from studio_worker.util import identity
from studio_worker.server import dispatch, tools
from studio_worker.scientific import regression
from studio_worker.templates import build_bias


@unittest.skipUnless(os.name == "posix" and Path("/proc").exists(), "Linux/WSL process identities required")
class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.inputs = self.root / "inputs"
        self.inputs.mkdir()
        (self.inputs / "run.py").write_text("print('done',flush=True)\n")
        self.service = Service(self.root / "service", schedule=False)
        self.env = self.service.register_environment({"name": "test", "executables": {"python": sys.executable}})
        self.project = self.service.register_project({"name": "test", "policy": {
            "input_roots": [str(self.inputs)], "environments": [self.env["id"]]}})

    def tearDown(self):
        for run in self.service.store.runs():
            if run["status"] == "running":
                try:
                    self.service.cancel(run["id"])
                except Exception:
                    pass
        for _ in range(30):
            self.service.tick()
            if not any(r["status"] == "running" for r in self.service.store.runs()):
                break
            time.sleep(.1)
        self.service.close()
        self.service.store.db.close()
        self.tmp.cleanup()

    def spec(self, **changes):
        return {"project_id": self.project["id"], "environment_id": self.env["id"],
                "engine": "pydyn.md", "inputs": {"run.py": str(self.inputs / "run.py")},
                "gpu": 0, "max_seconds": 10, "idempotency_key": "test", **changes}

    def submit(self, **changes):
        run = self.service.prepare(self.spec(**changes))
        self.service.validate(run["id"])
        return self.service.submit(run["id"])

    def await_end(self, identifier):
        for _ in range(100):
            self.service.tick()
            run = self.service.store.run(identifier)
            if run["status"] in ("succeeded", "failed", "cancelled"):
                return run
            time.sleep(.05)
        self.fail("Supervisor did not produce a completion receipt")

    def test_idempotent_and_conflicting_requests(self):
        one = self.service.prepare(self.spec())
        self.assertEqual(one["id"], self.service.prepare(self.spec())["id"])
        with self.assertRaisesRegex(ValueError, "different request"):
            self.service.prepare(self.spec(name="different"))

    def test_resource_authorization(self):
        for changes in ({"gpu": 9}, {"max_seconds": 999999}, {"environment_id": "unknown"}):
            with self.assertRaises(PermissionError):
                self.service.prepare(self.spec(**changes))

    def test_input_path_and_project_traversal(self):
        with self.assertRaises(ValueError):
            self.service.prepare(self.spec(inputs={"run.py": "/etc/passwd"}))
        with self.assertRaises(ValueError):
            self.service.register_project({**self.project, "id": "../escape"})

    def test_snapshot_tampering_rejected(self):
        run = self.service.prepare(self.spec())
        path = Path(run["directory"]) / "results/run.py"
        path.write_text("print('modified')")
        self.assertEqual(self.service.validate(run["id"])["validation"]["status"], "failed")
        with self.assertRaises(ValueError):
            self.service.submit(run["id"])

    def test_input_validation_is_not_scientific_run_validation(self):
        run = self.service.prepare(self.spec())
        result = self.service.validate(run["id"])
        self.assertEqual(result["validation"]["status"], "passed")
        self.assertEqual(result["validation"]["scientific_status"], "not_run")
        self.assertIn("contract", result["validation"]["scope"])

    def test_validation_required(self):
        run = self.service.prepare(self.spec())
        with self.assertRaisesRegex(ValueError, "validation"):
            self.service.submit(run["id"])

    def test_receipt_and_logs(self):
        run = self.submit()
        result = self.await_end(run["id"])
        self.assertEqual(result["status"], "succeeded")
        self.assertIn("done", self.service.log(run["id"])["text"])
        self.assertTrue(self.service.collect(run["id"])["artifacts"])

    def test_same_gpu_serialized(self):
        (self.inputs / "run.py").write_text("import time;time.sleep(.7);print('done')\n")
        one = self.submit()
        two = self.submit(idempotency_key="two")
        self.service.tick()
        self.assertEqual(self.service.store.run(one["id"])["status"], "running")
        self.assertEqual(self.service.store.run(two["id"])["status"], "queued")
        self.await_end(one["id"])
        self.assertEqual(self.await_end(two["id"])["status"], "succeeded")

    def test_queued_cancel_never_launches(self):
        run = self.submit()
        self.assertEqual(self.service.cancel(run["id"])["status"], "cancelled")
        self.service.tick()
        self.assertFalse((Path(run["directory"]) / "launch.json").exists())

    def test_running_cancel_and_timeout(self):
        (self.inputs / "run.py").write_text("import time;time.sleep(60)\n")
        run = self.submit()
        self.service.tick()
        time.sleep(.3)
        self.service.cancel(run["id"])
        self.assertEqual(self.await_end(run["id"])["status"], "cancelled")
        run = self.submit(idempotency_key="timeout", max_seconds=1)
        self.assertEqual(self.await_end(run["id"])["status"], "failed")
        self.assertEqual(self.service.store.run(run["id"])["exit"]["reason"], "time_limit")

    def test_detached_supervisor_survives_service_recreation(self):
        (self.inputs / "run.py").write_text("import time;time.sleep(.5);print('survived')\n")
        run = self.submit()
        self.service.tick()
        self.service.close()
        old = self.service
        self.service = Service(self.root / "service", schedule=False)
        self.assertEqual(self.await_end(run["id"])["status"], "succeeded")
        old.processes[run["id"]].wait()
        old.store.db.close()

    def test_pid_reuse_never_signals_other_process(self):
        run = self.submit()
        unrelated = {"pid": os.getpid(), "start": "wrong", "boot": "wrong"}
        self.service.store.update(run, status="unknown", identity=unrelated)
        with self.assertRaisesRegex(ValueError, "identity"):
            self.service.cancel(run["id"])
        with self.assertRaises(ValueError):
            self.service.submit(run["id"])

    def test_mcp_cannot_validate_or_submit_even_with_valid_run(self):
        run = self.service.prepare(self.spec())
        for action in ('validate', 'submit'):
            with self.assertRaisesRegex(PermissionError, "Desktop review"):
                dispatch(self.service, "POST", "/api/run/"+action, {"run_id":run["id"]}, admin=False)
        names={tool['name'] for tool in tools()}
        self.assertNotIn('submit_run', names)
        self.assertNotIn('validate_run', names)
        self.assertEqual(self.service.store.run(run['id'])['status'], 'draft')
        dispatch(self.service, 'POST', '/api/run/validate', {'run_id':run['id']}, admin=True)
        approved=dispatch(self.service, 'POST', '/api/run/submit', {'run_id':run['id']}, admin=True)
        self.assertEqual(approved['status'], 'queued')

    def test_review_edits_are_new_snapshots_and_require_revalidation(self):
        parent=self.service.prepare(self.spec())
        self.service.validate(parent['id'])
        changes={'inputs':{'run.py':str(Path(parent['directory'])/'simulation/run.py')},
                 'parameters':{'seed':27},'idempotency_key':'reviewed'}
        child=self.service.revise(parent['id'],changes,{'run.py':"print('reviewed')\n"})
        self.assertEqual(child['status'],'draft')
        self.assertEqual(child['validation']['status'],'not_run')
        self.assertEqual(child['revision_of'],parent['id'])
        self.assertEqual(self.service.store.run(parent['id'])['superseded_by'],child['id'])
        self.assertEqual(self.service.store.run(parent['id'])['status'],'cancelled')
        self.assertTrue(Path(child['inputs']['run.py']).is_file())
        self.assertEqual(self.service.input_file(parent['id'],'run.py')['text'],"print('done',flush=True)\n")
        self.assertEqual(self.service.input_file(child['id'],'run.py')['text'],"print('reviewed')\n")
        self.assertEqual(self.service.revise(parent['id'],changes,{'run.py':"print('reviewed')\n"})['id'],child['id'])
        with self.assertRaises(ValueError):
            self.service.revise(parent['id'],changes,{'run.py':'different'})
        with self.assertRaisesRegex(ValueError,'validation'):
            self.service.submit(child['id'])
        self.service.validate(child['id']);self.service.submit(child['id'])
        self.assertEqual(self.await_end(child['id'])['status'],'succeeded')
        self.assertIn('reviewed',self.service.log(child['id'])['text'])
        with self.assertRaisesRegex(ValueError,'different reviewed inputs'):
            self.service.revise(child['id'],changes,{'run.py':"print('reviewed')\n"})
        with self.assertRaisesRegex(ValueError,'Submitted'):
            self.service.revise(child['id'],{**changes,'idempotency_key':'submitted-revision'},{})

    def test_mcp_cannot_change_authorization(self):
        with self.assertRaises(PermissionError):
            dispatch(self.service, "POST", "/api/projects", self.project, admin=False)

    def test_single_scheduler_authority(self):
        with self.assertRaises(BlockingIOError):
            Service(self.root / "service", schedule=False)

    def test_registered_python_symlink_preserves_virtual_environment(self):
        from studio_worker.adapters import Adapter
        link = self.inputs / "python"
        link.symlink_to(sys.executable)
        result = Adapter("pydyn.md").executable({"executables":{"python":str(link)}}, "python")
        self.assertEqual(result, str(link))

    def test_export_contains_immutable_input_and_no_launch_credentials(self):
        import io, base64, zipfile
        run = self.submit()
        self.assertEqual(self.await_end(run["id"])["status"], "succeeded")
        bundle = self.service.export(run["id"])
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(bundle["base64"]))) as archive:
            self.assertEqual(archive.read("inputs/run.py"), b"print('done',flush=True)\n")
            self.assertNotIn("launch.json", archive.namelist())

    def test_nested_inputs_and_traversal(self):
        spec = self.spec(inputs={"run.py":str(self.inputs/"run.py"),"checkpoint/md.pt":str(self.inputs/"run.py")})
        run = self.service.prepare(spec)
        self.assertTrue((Path(run["directory"])/"simulation/checkpoint/md.pt").exists())
        with self.assertRaises(ValueError):
            self.service.prepare(self.spec(inputs={"run.py":str(self.inputs/"run.py"),"../outside":str(self.inputs/"run.py")},idempotency_key="traverse"))

    def test_hotpp_resume_keeps_checkpoint_outside_output_directory(self):
        environment = self.service.register_environment({**self.env,
            "executables": {"python": sys.executable, "hotpp": sys.executable}})
        (self.inputs / "input.yaml").write_text("maxStep: 3\n")
        parent = self.service.prepare(self.spec(engine="hotpp.train",
            inputs={"input.yaml": str(self.inputs / "input.yaml")}))
        checkpoint = Path(parent["directory"]) / "results/model/best.ckpt"
        checkpoint.parent.mkdir()
        checkpoint.write_bytes(b"optimizer-state-fixture")
        self.service.store.update(parent, status="succeeded")
        parameters = {"checkpoint_files": ["model/best.ckpt"],
            "checkpoint": "model/best.ckpt", "idempotency_key": "continue"}
        with self.assertRaisesRegex(ValueError, "continuation_config"):
            self.service.resume(parent["id"], parameters)
        config = self.inputs / "continue.yaml"
        config.write_text("maxStep: 6\n")
        continued = self.service.resume(parent["id"], {**parameters,
            "continuation_config": str(config)})
        names = {asset["name"] for asset in continued["snapshots"]}
        self.assertIn("resume.ckpt", names)
        self.assertNotIn("model/best.ckpt", names)
        self.assertEqual(continued["parameters"]["checkpoint"], "resume.ckpt")
        self.assertEqual((Path(continued["directory"]) / "simulation/input.yaml").read_text(), "maxStep: 6\n")
        self.assertEqual(continued["command"][-2:], ["--load_checkpoint", "resume.ckpt"])

    def test_pygrad_export_contract(self):
        run = self.service.prepare(self.spec(parameters={"model_file": "lammps-infer.pt"}))
        self.assertEqual(self.service.validate(run["id"])["validation"]["status"], "failed")


class ScientificMetadata(unittest.TestCase):
    def test_missing_virial_labels_not_scored(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "energy_test.out").write_text("1 2\n3 3\n")
            Path(directory, "virial_test.out").write_text("0 0 0 0 0 0 -1e6 -1e6 -1e6 -1e6 -1e6 -1e6\n")
            result = regression({"path": directory})
            self.assertAlmostEqual(result["metrics"]["energy"]["rmse"], 1000 / 2 ** .5)
            self.assertEqual(result["metrics"]["virial"]["status"], "not_run")

    def test_bias_requires_explicit_atoms_and_parameters(self):
        with self.assertRaises(ValueError):
            build_bias({"family": "wtmetad"})
        source = build_bias({"family": "umbrella", "atom_i": 0, "atom_j": 1,
                             "center": 2.0, "force_constant": 1.0, "output_file": "model.pt"})
        compile(source, "generated.py", "exec")
        self.assertIn("torch.jit.load", source)


if __name__ == "__main__":
    unittest.main()

class SamplingMultiplicity(unittest.TestCase):
    def test_multiple_walkers_rejected_for_both_routes(self):
        from studio_worker.adapters import Adapter
        for engine in ("gpumd.sampling", "pydyn.sampling"):
            with self.assertRaisesRegex(ValueError, "single-walker"):
                Adapter(engine).prepare({"inputs":{}, "parameters":{"sampling":{"walkers":2}}}, {})

class ScientificInputControls(unittest.TestCase):
    def test_declared_gpumd_controls_must_match_actual_inputs(self):
        from studio_worker.adapters import Adapter
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/"run.in").write_text("time_step 0.5\nensemble nvt_bdp 300 300 100\nrun 100\n")
            a=Adapter("gpumd.sampling")
            self.assertEqual(a.input_contract({"parameters":{"steps":100,"temperature":300,"time_step_fs":0.5}},root)["status"],"passed")
            with self.assertRaisesRegex(ValueError,"differs"):
                a.input_contract({"parameters":{"steps":200}},root)
