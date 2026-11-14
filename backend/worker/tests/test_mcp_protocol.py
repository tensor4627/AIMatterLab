import sys, unittest, json, tempfile, io
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.server import mcp_tool_call
from studio_worker.service import Service
from studio_worker.transport.http_handler import handler_factory


class McpProtocol(unittest.TestCase):
    def initialize(self, *, credential='mcp', origin=None):
        calls=[];responses=[]
        def forbidden(*args,**kwargs):calls.append((args,kwargs));raise AssertionError('Initialize must not dispatch a tool or change project authorization')
        handler_type=handler_factory(None,{'admin':'synthetic-admin','mcp':'synthetic-mcp'},dispatch=forbidden,mcp_tool_call=forbidden,tools=forbidden)
        handler=handler_type.__new__(handler_type)
        request=json.dumps({'jsonrpc':'2.0','id':'initialize-test','method':'initialize','params':{}}).encode()
        handler.path='/mcp';handler.headers={'Authorization':'Bearer synthetic-'+credential,'Content-Length':str(len(request))}
        if origin is not None:handler.headers['Origin']=origin
        handler.rfile=io.BytesIO(request);handler.respond=lambda status,value=None:responses.append((status,value))
        handler.handle_request('POST')
        return responses,calls

    def test_http_initialize_preserves_delegated_iteration_and_explicit_no_run_limits(self):
        for credential in ('mcp','admin'):
            responses,calls=self.initialize(credential=credential)
            self.assertEqual(responses[0][0],200);self.assertEqual(calls,[])
            result=responses[0][1]['result'];self.assertEqual(result['capabilities'],{'tools':{}})
            instructions=result['instructions']
            for rule in ('existing project authorization','current user delegation','no-build, no-run and stop requests','without repeated approval','Serialized bias must be loaded in the actual target environment','AOTI must fail without fallback','Never automatically resubmit an unknown attempt'):
                self.assertIn(rule,instructions)
            self.assertNotIn('Only the desktop user',instructions);self.assertNotIn('review and stop',instructions)

    def test_http_initialize_cannot_bypass_credentials_or_browser_origin_boundary(self):
        for options,status in (({'credential':'untrusted'},401),({'origin':'https://outside.invalid'},403)):
            responses,calls=self.initialize(**options)
            self.assertEqual(responses[0][0],status);self.assertNotIn('result',responses[0][1]);self.assertEqual(calls,[])

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
