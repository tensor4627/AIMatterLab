import copy
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from studio_worker.compute.service import Service
from studio_worker.tools import trajectory_density
from studio_worker.transport.routes import dispatch
from studio_worker.workspace.group_contract import group_version
from studio_worker.workspace.roadmap_execution import RoadmapExecutions
from studio_worker.workspace.roadmap_tools import file_identity, check_md_parameters, md_velocity_source


class RoadmapExecutionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root/"input.xyz"
        self.source.write_text('1\nTime=1 Lattice="2 0 0 0 2 0 0 0 2" pbc="T T T" Properties=species:S:1:pos:R:3\nSi 1 0 0\n'
                               '1\nTime=2 Lattice="2 0 0 0 2 0 0 0 2" pbc="T T T" Properties=species:S:1:pos:R:3\nSi 0 1 0\n')
        self.service = Service(self.root/"worker",schedule=False)
        self.api = RoadmapExecutions(self.service)
        self.service.register_environment({"id":"cpu","name":"CPU","executables":{"python":sys.executable}})
        self.service.register_project({"id":"project","name":"Project","policy":{"input_roots":[str(self.root)],"environments":["cpu"],
                                      "engines":["trajectory.density"],"gpus":[0],"max_seconds":30,"max_concurrent":2}})
        self.graph={"schema_version":1,"inputs":["trajectory"],"outputs":["profile"],"resources":[
            {"id":"trajectory","label":"Trajectory","field":"file","basis":"user"},
            {"id":"profile","label":"Density","basis":"user","requirements":["two frames"],
             "checks":[{"requirement":"two frames","fact":"samples","op":"eq","value":2}]}],
            "steps":[{"id":"first","label":"Density","tool":"trajectory.density","inputs":[{"resource":"trajectory","port":"trajectory"}],
                      "outputs":[{"port":"density","resource":"profile"}]}]}
        self.body={"task_id":"task","name":"Test","original_request":"Analyze two frames","roadmap":self.graph,"parameters":{"file":str(self.source)},
                   "revision":1,"target":{"project_id":"project","environment_id":"cpu","gpu":0,"max_seconds":30}}

    def tearDown(self):
        self.service.close()
        self.service.store.db.close()
        self.temp.cleanup()

    def approve(self):
        digest=self.api.preview(self.body)["snapshot_sha256"]
        return self.api.confirm({"plan":self.body,"snapshot_sha256":digest})

    def finish(self,key):
        for _ in range(200):
            self.api.advance(key)
            self.service.tick()
            state=self.api.status({"task_id":"task","execution_id":key})
            if state["status"] not in ("running","unknown"):
                return state
            time.sleep(.03)
        self.fail("Workflow did not finish")

    def group(self):
        second=copy.deepcopy(self.graph["steps"][0])
        second.update(id="second",outputs=[{"port":"density","resource":"repeat"}])
        self.graph["steps"].insert(0,second)
        self.graph["resources"].append({"id":"repeat","label":"Repeat","basis":"user","requirements":["three frames"],
                                       "checks":[{"requirement":"three frames","fact":"samples","op":"ge","value":3}]})
        self.graph["outputs"].reverse()
        self.graph["outputs"].insert(0,"repeat")
        steps=[{"id":n["id"],"tool_id":"density","function_id":"profile","package_version":"a"*64,
                "inputs":{"trajectory":{"input_id":"trajectory"}}} for n in self.graph["steps"]]
        steps[0]["depends_on"]=["first"]
        definition={"schema_version":1,"id":"two-profiles","name":"Two profiles","inputs":[{"id":"trajectory"}],"steps":steps,
                    "outputs":[{"id":n["outputs"][0]["resource"],"step_id":n["id"],"port_id":"density"} for n in self.graph["steps"]]}
        text=json.dumps(definition)
        self.graph["tool_group"]={"id":definition["id"],"version":group_version(text)}
        feature={"engine":"trajectory.density","package_version":"a"*64,"source_commit":"b"*40,"manifest_sha256":"c"*64,
                 "command":["{python}","-I","{entrypoint}"],"entrypoint_sha256":file_identity(trajectory_density.__file__)["sha256"],"parameters":{}}
        self.body["tool_group"]={"definition_text":text,"features":{n["id"]:copy.deepcopy(feature) for n in steps}}

    def test_repeat_group_freezes_inputs_and_reports_each_requirement(self):
        self.group()
        self.graph["resources"][1]["requirements"].append("human interpretation")
        approval=self.api.preview(self.body)
        self.assertEqual([n["id"] for n in approval["snapshot"]["steps"]],["first","second"])
        state=self.approve()
        self.source.write_text("edited original")
        self.assertEqual(self.api.snapshot({"task_id":"task","execution_id":state["id"]}),approval)
        state=self.finish(state["id"])
        self.assertEqual(state["status"],"failed")
        self.assertEqual([g["status"] for g in state["goals"]],["failed","needs_review"])
        self.assertEqual([c["status"] for c in state["goals"][1]["checks"]],["needs_review","passed"])
        self.assertEqual({n["status"] for n in state["nodes"].values()},{"passed"})
        self.assertEqual(len(self.service.store.runs()),2)
        for n in state["nodes"].values():
            self.assertEqual(n["consumed"][0]["sha256"],approval["snapshot"]["initial"]["trajectory"]["sha256"])
        replay=self.api.confirm({"plan":self.body,"snapshot_sha256":approval["snapshot_sha256"]})
        self.assertEqual(replay["id"],state["id"])
        with self.assertRaises(PermissionError):self.api.status({"task_id":"another","execution_id":state["id"]})

    def test_changed_review_or_unregistered_group_never_starts(self):
        review=self.api.preview(self.body)
        self.source.write_text("changed")
        with self.assertRaisesRegex(ValueError,"changed"):
            self.api.confirm({"plan":self.body,"snapshot_sha256":review["snapshot_sha256"]})
        self.group()
        self.body["tool_group"]["features"]["first"]["command"]=["other"]
        with self.assertRaisesRegex(ValueError,"equivalent"):self.api.preview(self.body)
        self.assertEqual(self.service.store.runs(),[])
        self.assertEqual(self.service.store.list("roadmap-state"),[])

    def test_tampered_frozen_file_and_changed_environment_block(self):
        state=self.approve()
        path=self.service.root/"roadmap-executions"/state["id"]/"inputs"/"trajectory"
        path.chmod(0o600);path.write_text("swapped")
        self.api.advance(state["id"])
        self.assertEqual(self.service.store.get("roadmap-state",state["id"])["status"],"failed")
        self.body["revision"]=2
        state=self.approve()
        self.service.register_environment({"id":"cpu","name":"Changed","executables":{"python":sys.executable}})
        self.api.advance(state["id"])
        self.assertEqual(self.service.store.get("roadmap-state",state["id"])["status"],"failed")
        self.assertEqual(self.service.store.runs(),[])

    def test_wrong_consumer_hash_cannot_accept_successful_process(self):
        state=self.approve()
        self.api.advance(state["id"])
        run=self.service.store.runs()[0]
        for _ in range(160):
            self.service.tick()
            if self.service.store.run(run["id"])["status"]=="succeeded":break
            time.sleep(.03)
        self.assertEqual(self.service.store.run(run["id"])["status"],"succeeded")
        receipt=Path(run["directory"])/"results"/"consumption.json"
        item=json.loads(receipt.read_text());item["sha256"]="0"*64;receipt.write_text(json.dumps(item))
        state=self.finish(state["id"])
        self.assertEqual(state["goals"][0]["status"],"unavailable")
        self.assertIn("Consumer read receipt",state["nodes"]["first"]["reason"])

    def test_unknown_submission_and_public_calls_cannot_relaunch(self):
        with self.assertRaises(PermissionError):dispatch(self.service,"POST","/api/workflow/roadmap/confirm",{},False)
        state=self.approve()
        with patch.object(self.service,"submit",side_effect=OSError("reply lost")):
            self.api.advance(state["id"])
        with patch.object(self.service,"submit",side_effect=AssertionError("unknown resubmit")):
            for _ in range(3):self.api.advance(state["id"])
        saved=self.api.status({"task_id":"task","execution_id":state["id"]})
        self.assertEqual(saved["status"],"unknown")
        self.assertEqual(len(self.service.store.runs()),1)
        original=saved["nodes"]["first"]["run_id"]
        with self.assertRaises(PermissionError):self.service.submit(original)
        with self.assertRaises(PermissionError):self.service.revise(original,{}, {})

    def test_per_step_target_keeps_project_authorization(self):
        self.body["node_environments"]={"first":"unapproved"}
        with self.assertRaises(PermissionError):self.api.preview(self.body)
        self.body["node_environments"]={"other":"cpu"}
        with self.assertRaisesRegex(ValueError,"Unknown per-node"):self.api.preview(self.body)

    def test_review_checks_native_controls_and_explicit_initial_velocities(self):
        controls=["time_step 0.5","ensemble nve","velocity 300 seed 42","run 2"]
        check_md_parameters({"time_step_fs":.5,"md":{"duration_ps":.001,"ensemble":"NVE"}},controls)
        with self.assertRaisesRegex(ValueError,"differs"):check_md_parameters({"steps":3},controls)
        self.assertEqual(md_velocity_source(self.source,controls),{"source":"control","seeds":[42]})
        with self.assertRaisesRegex(ValueError,"explicit velocity seed"):md_velocity_source(self.source,["velocity 300","run 2"])
        self.source.write_text('1\nProperties=species:S:1:pos:R:3:vel:R:3\nSi 1 0 0 0 1 0\n')
        self.assertEqual(md_velocity_source(self.source,["run 2"])["source"],"structure")

    def test_failed_validation_or_a_preexisting_result_cannot_pass(self):
        state=self.approve()
        with patch.object(self.service,"validate",return_value={"status":"draft","validation":{"status":"failed","message":"bad control"}}):
            self.api.advance(state["id"])
        failed=self.api.status({"task_id":"task","execution_id":state["id"]})
        self.assertEqual(failed["nodes"]["first"]["reason"],"bad control")
        self.assertEqual(self.service.store.runs()[0]["status"],"draft")
        self.assertEqual(failed["goals"][0]["checks"],[{"requirement":"two frames","status":"unavailable"}])
        self.body["revision"]=2
        new=self.approve()
        self.api.advance(new["id"])
        current=self.api.status({"task_id":"task","execution_id":new["id"]})
        run=self.service.store.run(current["nodes"]["first"]["run_id"])
        (Path(run["directory"])/"results"/"density.csv").write_text("old output")
        failed=self.finish(new["id"])
        self.assertEqual(failed["status"],"failed")
        self.assertIn("already exists",failed["nodes"]["first"]["reason"])

    def test_private_versions_survive_the_initial_frozen_copy(self):
        bindings={"code_sha256":"c"*64,"parameters_sha256":"a"*64,"spec_sha256":"b"*64}
        self.service.store.put("private-cv-lineage",{"id":"entry-row","entry_id":"entry","workspace_id":"work","project_id":"project",
                              "paths":[str(self.source)],"bindings":bindings})
        state=self.approve()
        self.api.advance(state["id"])
        run=self.service.store.runs()[0]
        self.assertEqual(run["private_cv_versions"],[{"entry_id":"entry",**bindings}])
        self.assertEqual(run["private_cv_entries"],["entry"])
