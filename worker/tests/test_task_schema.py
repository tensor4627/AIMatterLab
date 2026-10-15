import unittest
from studio_worker.task_schema import validate_task
from studio_worker.server import tools


class TaskSchema(unittest.TestCase):
    def payload(self):
        return {"task_id": "fixture", "name": "MD", "steps": [{"id": "md", "title": "MD", "fields": [
            {"key": "md.temperature", "label": "Temperature", "type": "number", "required": True, "unit": "K"}]}],
            "parameters": {"md": {"temperature": 300}}, "missing_fields": []}

    def test_structured_steps_and_legacy_steps(self):
        validate_task(self.payload())
        payload = self.payload()
        payload["steps"] = ["prepare", "review"]
        validate_task(payload)
        schema = next(v for v in tools() if v["name"] == "present_task")["inputSchema"]
        self.assertNotIn("offset", schema["properties"])
        self.assertNotIn("frame", schema["properties"])

    def test_unsafe_and_duplicate_fields(self):
        for key in ("__proto__.x", "md.constructor.x", "a..b"):
            payload = self.payload()
            payload["steps"][0]["fields"][0]["key"] = key
            with self.assertRaises(ValueError):
                validate_task(payload)
        payload = self.payload()
        payload["steps"][0]["fields"] *= 2
        with self.assertRaises(ValueError):
            validate_task(payload)

    def test_unknown_properties_and_bad_types(self):
        payload = self.payload()
        payload["steps"][0]["fields"][0]["required"] = "true"
        with self.assertRaises(ValueError):
            validate_task(payload)
        payload = self.payload()
        payload["steps"][0]["fields"][0]["unit"] = {}
        with self.assertRaises(ValueError):
            validate_task(payload)
        payload = self.payload()
        payload["offset"] = 0
        with self.assertRaises(ValueError):
            validate_task(payload)

    def test_legacy_prose_requirements_remain_data_not_paths(self):
        payload = self.payload()
        payload["missing_fields"] = ["md.structure_file", "确认 CV 原子编号与单位。", "__proto__.polluted"]
        validate_task(payload)
        for value in (None, 3, {}, "", "x" * 2001):
            payload["missing_fields"] = [value]
            with self.assertRaises(ValueError):
                validate_task(payload)
