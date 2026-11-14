import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.transport.mcp import tools


class McpSchemaCacheTest(unittest.TestCase):
    def test_tools_are_cached_but_callers_get_independent_copies(self):
        first, second = tools(), tools()
        self.assertEqual(first, second)
        self.assertIsNot(first, second)
        self.assertGreater(len(first), 20)
        original = first[0]["name"]
        first[0]["name"] = "mutated-copy"
        self.assertEqual(tools()[0]["name"], original)

    def test_tool_names_are_unique_and_stable_between_calls(self):
        names = [item["name"] for item in tools()]
        self.assertEqual(len(names), len(set(names)))
        self.assertIn("present_task", names)
        self.assertIn("submit_run", names)
        self.assertIn("validate_run", names)


if __name__ == "__main__":
    unittest.main()
