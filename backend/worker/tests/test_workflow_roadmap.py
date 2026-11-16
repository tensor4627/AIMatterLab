import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from studio_worker.infrastructure.store import Store
from studio_worker.transport.mcp import mcp_tool_call, tools
from studio_worker.transport.routes import dispatch


class WorkflowRoadmap(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.service = SimpleNamespace(store=Store(self.tmp.name))
        self.addCleanup(lambda: self.service.store.db.close())
        fixture = Path(__file__).resolve().parents[3] / "tests/fixtures/workflow-roadmap.json"
        self.plan = json.loads(fixture.read_text(encoding="utf-8"))
        self.base = dict(task_id="roadmap-test", name="MD", parameters={}, steps=["MD"], missing_fields=[])

    def present(self, **changes):
        return mcp_tool_call(self.service, {"name": "present_task", "arguments": {**self.base, **changes}}, dispatch=dispatch)

    def read(self):
        return dispatch(self.service, "GET", "/api/task-parameters", {})[0]

    def test_mcp_roundtrip_persistence_and_legacy_update(self):
        schema = next(tool["inputSchema"] for tool in tools() if tool["name"] == "present_task")
        self.assertIn("roadmap", schema["properties"])
        self.assertNotIn("roadmap", schema["required"])
        result = self.present(roadmap=self.plan)
        self.assertFalse(result["isError"], result)
        self.assertEqual(json.loads(result["content"][0]["text"])["roadmap"], self.plan)
        self.assertFalse(self.present(name="Manual parameter update")["isError"])
        self.service.store.db.close()
        self.service.store = Store(self.tmp.name)
        self.assertEqual(self.read()["roadmap"], self.plan)
        self.assertEqual(self.read()["name"], "Manual parameter update")
        self.assertEqual(self.read()["status"], "draft")

    def test_invalid_replacement_preserves_the_previous_form_and_graph(self):
        self.assertFalse(self.present(roadmap=self.plan)["isError"])
        before = self.read()
        for mutate in (lambda p: p["inputs"].append("bad-id"),
                       lambda p: p["steps"][2]["inputs"][0].update(resource="report"),
                       lambda p: p["steps"][0]["outputs"][0].update(resource="frames"),
                       lambda p: p["resources"][0].update(field="__proto__.x"),
                       lambda p: p["steps"][0].update(status="passed")):
            changed = copy.deepcopy(self.plan)
            mutate(changed)
            self.assertTrue(self.present(name="Invalid replacement", roadmap=changed)["isError"])
            self.assertEqual(self.read(), before)

    def test_partial_goal_and_old_payload(self):
        self.assertFalse(self.present()["isError"])
        self.assertNotIn("roadmap", self.read())
        self.plan["steps"] = []
        self.assertFalse(self.present(roadmap=self.plan)["isError"])
        self.assertEqual(self.read()["roadmap"]["outputs"], ["frames", "thermo", "report"])
