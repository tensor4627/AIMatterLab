import sys, unittest, json, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.server import mcp_tool_call
from studio_worker.service import Service


class McpProtocol(unittest.TestCase):
    def test_malformed_and_unavailable_tools_never_dispatch(self):
        for params in (None, [], {}, {"name": "unknown"}, {"name": "submit_run"}, {"name": "validate_run"},
                       {"name": "present_task", "arguments": []}, {"name": "present_task", "arguments": {}},
                       {"name": "read_project_input", "arguments": {"project_id": {}, "name": "a"}}):
            with self.subTest(params=params), patch('studio_worker.server.dispatch') as dispatch:
                result = mcp_tool_call(None, params)
                self.assertTrue(result['isError']); dispatch.assert_not_called()
                failure = json.loads(result['content'][0]['text'])
                self.assertEqual(failure['status'], 'blocked'); self.assertFalse(failure['automatic_retry'])

    def test_real_catalog_read_still_uses_mcp_not_admin(self):
        with tempfile.TemporaryDirectory() as directory:
            service = Service(Path(directory), schedule=False)
            try:
                result = mcp_tool_call(service, {'name': 'list_projects'})
                self.assertFalse(result['isError'])
                self.assertEqual(json.loads(result['content'][0]['text']), [])
            finally:
                service.close(); service.store.db.close()

    def test_failure_after_dispatch_is_unconfirmed_without_retry(self):
        with patch('studio_worker.server.dispatch', side_effect=TimeoutError('status response timed out')) as dispatch:
            result = mcp_tool_call(None, {'name': 'run_status', 'arguments': {'run_id': 'existing'}})
            failure = json.loads(result['content'][0]['text'])
            self.assertEqual(dispatch.call_count, 1)
            self.assertFalse(dispatch.call_args.kwargs['admin'])
            self.assertEqual(failure['status'], 'unknown')
            self.assertFalse(failure['automatic_retry'])

    def test_reading_a_failed_job_is_a_successful_tool_result(self):
        with patch('studio_worker.server.dispatch', return_value={'id': 'existing', 'status': 'failed'}):
            self.assertFalse(mcp_tool_call(None, {'name': 'run_status', 'arguments': {'run_id': 'existing'}})['isError'])
