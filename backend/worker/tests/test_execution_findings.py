"""Permission, execution and check evidence use independent persisted states."""
import base64
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.service import Service
from studio_worker.server import dispatch
from studio_worker.tools.adapters import Adapter, allocated_gpu, run_process_env
from studio_worker.infrastructure import util


class ExecutionFindings(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.inputs = self.root / 'inputs'; self.inputs.mkdir()
        (self.inputs / 'run.py').write_text("print('inert fixture')\n")
        self.service = Service(self.root / 'worker', schedule=False)
        self.environment = self.service.register_environment({'name':'fixture','executables':{'python':sys.executable}})
        self.project = self.service.register_project({'name':'fixture','policy':{'input_roots':[str(self.inputs)],'environments':[self.environment['id']]}})
        probe=patch.object(Adapter,'probe',return_value={'scope':{'engine':'pydyn.md'},'executable':sys.executable,'modules':{name:{'status':'passed','version':'synthetic-import-contract'} for name in ('torch','cupy','ase','pydyn')}})
        probe.start();self.addCleanup(probe.stop)

    def tearDown(self):
        self.service.close(); self.service.store.db.close(); self.temp.cleanup()

    def prepare(self):
        return self.service.prepare({'project_id':self.project['id'],'environment_id':self.environment['id'],'engine':'pydyn.md','gpu':0,'max_seconds':5,'inputs':{'run.py':str(self.inputs/'run.py')},'idempotency_key':'fixture'})

    def test_not_run_and_failed_advisory_checks_do_not_grant_or_revoke_permission(self):
        run = self.prepare()
        self.service.store.update(run, validation={'status':'failed','message':'numerical recommendation'})
        submitted = self.service.submit(run['id'])
        self.assertEqual(submitted['status'],'queued')
        self.assertEqual(submitted['validation']['status'],'failed')
        self.assertTrue(submitted['execution_check']['required'])
        self.assertEqual(submitted['execution_check']['status'],'passed')

    def test_existing_project_authorization_is_still_required(self):
        from studio_worker.transport.http_handler import error_result
        from studio_worker.transport.mcp import mcp_tool_call
        run = self.prepare()
        project=self.service.store.get('project',run['project_id']);project['policy']['engines']=[]
        self.service.store.put('project',project)
        with self.assertRaises(PermissionError) as rejected: self.service.submit(run['id'])
        self.assertEqual(error_result(rejected.exception)['operation_state'],'not_started')
        response=mcp_tool_call(self.service,{'name':'submit_run','arguments':{'run_id':run['id']}},dispatch=dispatch)
        reply=json.loads(response['content'][0]['text']);self.assertTrue(response['isError'])
        self.assertEqual((reply['status'],reply['code'],reply['operation_state']),('blocked','access_required','not_started'))
        self.assertEqual(self.service.store.run(run['id'])['status'],'draft')

    def test_unknown_attempt_is_never_queued_again(self):
        run=self.prepare();self.service.store.update(run,status='unknown',submit_attempted=True)
        self.assertEqual(self.service.submit(run['id'])['status'],'unknown')

    def test_serialized_bias_failure_remains_a_required_execution_failure(self):
        run=self.prepare();self.service.store.update(run,engine='pydyn.sampling',validation={'status':'failed','message':'FD advisory'})
        with patch.object(Adapter,'validate',side_effect=ValueError('AOTI incompatible; no fallback')) as check:
            with self.assertRaisesRegex(ValueError,'AOTI incompatible'): self.service.submit(run['id'])
        self.assertTrue(check.call_args.kwargs['execution_only'])
        actual=self.service.store.run(run['id'])
        self.assertEqual(actual['execution_check']['status'],'failed')
        self.assertEqual(actual['validation']['message'],'FD advisory')
        self.assertEqual(actual['status'],'draft')
        with patch.object(Adapter,'validate',return_value={'status':'passed','artifact_status':'passed','scientific_status':'not_run'}):
            retried=self.service.submit(run['id'])
        self.assertEqual(retried['status'],'queued');self.assertEqual(retried['execution_check']['status'],'passed')
        self.assertEqual(retried['validation']['status'],'failed')

    def test_bias_compatibility_can_pass_while_scientific_finding_stays_failed(self):
        run=self.prepare();self.service.store.update(run,engine='pydyn.sampling',validation={'status':'failed','message':'FD advisory'})
        report = {'status':'passed', 'artifact_status':'passed', 'scientific_status':'not_run', 'scope':'fixture serialized artifact and target checks',
                  'native_runtime':{'status':'not_run', 'scope':'No native ELF loader check for this route'}}
        with patch.object(Adapter,'validate',return_value=report):
            submitted=self.service.submit(run['id'])
        self.assertEqual(submitted['status'],'queued')
        self.assertEqual(submitted['validation']['status'],'failed')
        self.assertEqual(submitted['execution_check']['status'],'passed')
        bundle = dispatch(self.service, 'POST', '/api/run/export', {'run_id':run['id']}, True)
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(bundle['base64']))) as archive:
            manifest = json.loads(archive.read('reproduction.json'))
            self.assertEqual(manifest['execution']['execution_check']['report'], report)
            self.assertEqual(manifest['validation']['status'], 'failed')

    def test_actual_snapshot_mutation_is_not_advisory(self):
        run=self.prepare();path=Path(run['directory'])/'simulation/run.py';path.chmod(0o644);path.write_text('changed')
        with self.assertRaisesRegex(ValueError,'Input changed'):self.service.submit(run['id'])

    def native_run(self):
        binary=self.root/'owned-native-wrapper';binary.write_bytes(b'original executable');binary.chmod(0o700)
        environment=self.service.register_environment({'name':'native identity fixture','executables':{'gpumd':str(binary),'python':sys.executable}})
        project=self.service.register_project({'name':'native identity fixture','policy':{'input_roots':[str(self.inputs)],'environments':[environment['id']]}})
        (self.inputs/'run.in').write_text('run 1\n');(self.inputs/'model.xyz').write_text('1\nfixture\nH 0 0 0\n')
        run=self.service.prepare({'project_id':project['id'],'environment_id':environment['id'],'engine':'gpumd.md','gpu':0,'max_seconds':5,'inputs':{name:str(self.inputs/name) for name in ('run.in','model.xyz')},'idempotency_key':'native-fixture'})
        return binary,run

    def test_same_executable_path_replacement_is_detected_before_submission(self):
        binary,run=self.native_run();binary.write_bytes(b'replaced executable')
        with self.assertRaisesRegex(ValueError,'executable changed'):self.service.submit(run['id'])
        self.assertEqual(self.service.store.run(run['id'])['status'],'draft')

    def test_queued_executable_replacement_fails_before_process_creation(self):
        binary,run=self.native_run();self.service.submit(run['id']);binary.write_bytes(b'replaced executable')
        with patch('studio_worker.compute.scheduler.subprocess.Popen',side_effect=AssertionError('must not launch')) as launch:
            self.service.dispatch();launch.assert_not_called()
        actual=self.service.store.run(run['id']);self.assertEqual(actual['status'],'failed');self.assertIn('executable changed',actual['error'])

    def test_cpu_checks_have_no_gpu_reservation_or_cuda_visibility(self):
        cpu={'engine':'installation.check','gpu':0,'environment_snapshot':{}}
        self.assertIsNone(allocated_gpu(cpu))
        self.assertEqual(run_process_env(cpu)['CUDA_VISIBLE_DEVICES'],'')
        self.assertEqual(allocated_gpu({'engine':'pydyn.md','gpu':0}),0)

    def test_fixed_cpu_routes_prepare_with_empty_or_different_gpu_grants(self):
        check = Path(__file__).resolve().parents[3] / 'installation' / 'examples' / 'worker-smoke.py'
        (self.inputs / 'run.py').write_bytes(check.read_bytes())
        (self.inputs / 'trajectory.xyz').write_text('1\nLattice="1 0 0 0 1 0 0 0 1"\nH 0 0 0\n')
        engines = ['installation.check', 'trajectory.density']
        for gpus in ([], [2]):
            project = self.service.register_project({'name':'CPU preparation',
                'policy':{**self.project['policy'], 'engines':engines, 'gpus':gpus}})
            self.assertEqual(project['policy']['gpus'],gpus)
            for engine, input_name in zip(engines, ('run.py','trajectory.xyz')):
                with self.subTest(gpus=gpus, engine=engine):
                    run = self.service.prepare({'project_id':project['id'], 'environment_id':self.environment['id'],
                        'engine':engine, 'gpu':7, 'max_seconds':5, 'inputs':{input_name:str(self.inputs / input_name)},
                        'parameters':{'installation_case':'worker'} if engine == 'installation.check' else {},
                        'idempotency_key':engine})
                    self.assertEqual(run['status'],'draft')
                    self.assertEqual(run['gpu'],7)
                    self.assertIsNone(allocated_gpu(run))
                    self.assertEqual(run_process_env(run)['CUDA_VISIBLE_DEVICES'],'')

    def test_gpu_routes_require_exact_grants_and_reject_malformed_ordinals_and_policies(self):
        allowed = self.service.register_project({'name':'Explicit GPU 2','policy':{**self.project['policy'],'gpus':[2]}})
        empty = self.service.register_project({'name':'No local GPU','policy':{**self.project['policy'],'gpus':[]}})
        original = self.service.store.get('project',allowed['id'])
        for malformed in ('2', [True], [False], ['2'], [2.0], [-1], [2**53], None):
            with self.subTest(policy=malformed), self.assertRaisesRegex(ValueError,'GPU IDs'):
                self.service.register_project({**allowed,'policy':{**allowed['policy'],'gpus':malformed}})
        self.assertEqual(self.service.store.get('project',allowed['id']),original)
        spec={'project_id':allowed['id'],'environment_id':self.environment['id'],'engine':'pydyn.md','gpu':2,
              'max_seconds':5,'inputs':{'run.py':str(self.inputs/'run.py')},'idempotency_key':'exact-gpu'}
        self.assertEqual(self.service.prepare(spec)['gpu'],2)
        with self.assertRaisesRegex(PermissionError,'GPU is not authorized'):
            self.service.prepare({**spec,'gpu':0})
        with self.assertRaisesRegex(PermissionError,'GPU is not authorized'):
            self.service.prepare({**spec,'project_id':empty['id']})
        for engine in ('pydyn.md','trajectory.density'):
            for gpu in (True, False, '2', [], 2.0, -1, 2**53):
                with self.subTest(engine=engine, gpu=gpu), self.assertRaisesRegex(ValueError,'GPU ID'):
                    self.service.prepare({**spec,'engine':engine,'gpu':gpu})

    def test_live_artifact_list_does_not_hash_output_bytes(self):
        run=self.prepare();out=Path(run['directory'])/'results/trajectory.xyz';out.write_bytes(b'frame\n')
        with patch.object(util,'stable_file_snapshot',side_effect=AssertionError('listing must not hash')):
            listed=self.service.collect(run['id'])
        artifact=next(item for item in listed['artifacts'] if item['name']=='trajectory.xyz')
        self.assertNotIn('sha256',artifact);self.assertEqual(artifact['hash_status'],'not_run')
        snapshot=self.service.collect(run['id'],['trajectory.xyz'])
        self.assertEqual(next(item for item in snapshot['artifacts'] if item['name']=='trajectory.xyz')['sha256'],util.digest(out))

    def test_hash_snapshot_rejects_stat_hash_race(self):
        path=self.inputs/'run.py';before=path.stat()
        after=SimpleNamespace(**{name:getattr(before,name) for name in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns')});after.st_size+=1
        with patch.object(util.os,'fstat',side_effect=[before,after]):
            with self.assertRaisesRegex(ValueError,'changed while'):util.stable_file_snapshot(path)

    def test_export_includes_real_logs_and_truthful_file_manifest(self):
        run=self.prepare();root=Path(run['directory']);(root/'console.log').write_text('actual console\n');(root/'results/output.json').write_text('{"actual":true}')
        bundle=self.service.export(run['id'])
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(bundle['base64']))) as archive:
            manifest=json.loads(archive.read('reproduction.json'))
            self.assertEqual(manifest['run'],run['id'])
            self.assertEqual(manifest['execution']['command'],run['command'])
            self.assertEqual(manifest['execution']['snapshots'],run['snapshots'])
            self.assertEqual(manifest['execution']['environment']['id'],run['environment_id'])
            self.assertNotIn('launch_claim',manifest['execution'])
            self.assertIn('exit.json',{item['path'] for item in manifest['omitted_outputs']})
            self.assertEqual(archive.read('console.log'),b'actual console\n')
            self.assertEqual(archive.read('results/output.json'),b'{"actual":true}')
            for item in manifest['included_files']:
                self.assertEqual(util.hashlib.sha256(archive.read(item['path'])).hexdigest(),item['sha256'])

    def test_export_uses_persisted_probe_and_execution_check_separately_from_logs(self):
        run = self.prepare(); root = Path(run['directory'])
        modules = {name:{'status':'passed','version':'observed-import','file':f'/fixture/runtime/{name}.py'}
                   for name in ('torch', 'cupy', 'ase', 'pydyn')}
        observed = {'scope':{'engine':'pydyn.md','modules':list(modules)}, 'executable':sys.executable,
                    'modules':modules,'pygas_upstream':{'commit':'a'*40,'version':'1.0','token':'SYNTHETIC_UPSTREAM_SECRET'},
                    'repositories':{'pydyn':{'path':'/fixture/source','commit':'b'*40,'dirty':False,'status':'passed'}},
                    'process_limits':{'stack':[-1,-1]},'variables':{'PRIVATE_VALUE':'SYNTHETIC_ENV_SECRET'}}
        submit_probe = {**observed, 'modules':{**modules, 'pydyn':{**modules['pydyn'], 'version':'checked-at-submission'}}}
        request = {'run_id':run['id']}
        with patch.object(Adapter, 'probe', side_effect=[observed, submit_probe]) as probe:
            validated = dispatch(self.service, 'POST', '/api/run/validate', request, True)
            submitted = dispatch(self.service, 'POST', '/api/run/submit', request, True)
        self.assertEqual(probe.call_count, 2)
        self.assertEqual(validated['validation']['status'], 'passed')
        self.assertEqual(submitted['status'], 'queued')
        (root/'execution-check.json').write_text('{"status":"failed","fixture":"stale file"}', encoding='utf-8')
        bundle = dispatch(self.service, 'POST', '/api/run/export', request, True)
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(bundle['base64']))) as archive:
            manifest_bytes = archive.read('reproduction.json')
            manifest = json.loads(manifest_bytes)
            execution = manifest['execution']
            self.assertEqual(execution['provenance']['modules'], observed['modules'])
            self.assertEqual(execution['provenance']['repositories'], observed['repositories'])
            self.assertEqual(execution['provenance']['process_limits'], observed['process_limits'])
            check = execution['execution_check']
            self.assertEqual(check['status'], 'passed')
            self.assertTrue(check['required'])
            self.assertEqual(check['checked_at'], submitted['execution_check']['checked_at'])
            self.assertEqual(check['report']['modules'], list(modules))
            self.assertEqual(check['report']['provenance']['modules']['pydyn']['version'], 'checked-at-submission')
            self.assertEqual(manifest['validation']['scientific_status'], 'not_run')
            self.assertNotIn(b'SYNTHETIC_UPSTREAM_SECRET', manifest_bytes)
            self.assertNotIn(b'SYNTHETIC_ENV_SECRET', manifest_bytes)
            log = next(item for item in manifest['included_files'] if item['path']=='execution-check.json')
            self.assertEqual(log['sha256'], util.hashlib.sha256(archive.read(log['path'])).hexdigest())
            self.assertEqual(json.loads(archive.read(log['path']))['status'], 'failed')

    def test_export_preserves_failed_check_and_blocked_probe_with_bounded_diagnostics(self):
        run = self.prepare(); request = {'run_id':run['id']}
        detail = 'fixture import did not load; Authorization: Bearer SYNTHETIC_HEADER_SECRET '
        with patch.object(Adapter, 'probe', side_effect=[ValueError('fixture import did not load ' + 'x' * 13000), ValueError(detail)]):
            dispatch(self.service, 'POST', '/api/run/validate', request, True)
            with self.assertRaisesRegex(ValueError, 'fixture import did not load'):
                dispatch(self.service, 'POST', '/api/run/submit', request, True)
        saved_check = self.service.store.run(run['id'])['execution_check']
        bundle = dispatch(self.service, 'POST', '/api/run/export', request, True)
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(bundle['base64']))) as archive:
            manifest = json.loads(archive.read('reproduction.json'))
            execution = manifest['execution']
            self.assertEqual(execution['status'], 'draft')
            self.assertEqual(execution['provenance']['status'], 'blocked')
            self.assertTrue(execution['provenance']['error'].endswith('[truncated]'))
            check = execution['execution_check']
            self.assertEqual(check['status'], 'failed')
            self.assertEqual(check['checked_at'], saved_check['checked_at'])
            self.assertTrue(check['required'])
            self.assertIn('fixture import did not load', check['message'])
            self.assertIn('[redacted]', check['message'])
            self.assertNotIn('SYNTHETIC_HEADER_SECRET', json.dumps(manifest))
            self.assertNotIn('report', check)
            self.assertIn('execution-check.json', {item['path'] for item in manifest['omitted_outputs']})

    def test_export_distinguishes_unrecorded_evidence_from_a_recorded_not_run_check(self):
        _, run = self.native_run(); request = {'run_id':run['id']}
        legacy = dispatch(self.service, 'POST', '/api/run/export', request, True)
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(legacy['base64']))) as archive:
            execution = json.loads(archive.read('reproduction.json'))['execution']
            self.assertNotIn('execution_check', execution)
            self.assertNotIn('provenance', execution)
        submitted = dispatch(self.service, 'POST', '/api/run/submit', request, True)
        self.assertEqual(submitted['execution_check']['status'], 'not_run')
        observed = dispatch(self.service, 'POST', '/api/run/export', request, True)
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(observed['base64']))) as archive:
            execution = json.loads(archive.read('reproduction.json'))['execution']
            self.assertEqual(execution['execution_check'], submitted['execution_check'])
            self.assertNotIn('provenance', execution)

    def test_export_identifies_missing_inputs_and_still_refuses_modified_immutable_inputs(self):
        run=self.prepare();snapshot=run['snapshots'][0]
        path=Path(run['directory'])/'simulation'/snapshot['name']
        path.unlink()
        bundle=self.service.export(run['id'])
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(bundle['base64']))) as archive:
            manifest=json.loads(archive.read('reproduction.json'))
            self.assertEqual(manifest['included_inputs'],[])
            self.assertEqual(manifest['omitted_inputs'][0]['sha256'],snapshot['sha256'])
            self.assertEqual(manifest['omitted_inputs'][0]['hash_status'],'not_run')
        path.write_text('changed fixture')
        with self.assertRaisesRegex(ValueError,'Immutable input snapshot changed'):
            self.service.export(run['id'])

    def test_export_verifies_legacy_snapshot_without_a_recorded_size(self):
        run=self.prepare()
        run['snapshots'][0].pop('size')
        self.service.store.update(run,snapshots=run['snapshots'])
        bundle=self.service.export(run['id'])
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(bundle['base64']))) as archive:
            manifest=json.loads(archive.read('reproduction.json'))
            included=next(item for item in manifest['included_files'] if item['kind']=='input')
            self.assertEqual(included['sha256'],run['snapshots'][0]['sha256'])
            self.assertEqual(included['size'],len(archive.read(included['path'])))


if __name__=='__main__':unittest.main()
