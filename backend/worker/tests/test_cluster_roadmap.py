"""Run the actual batch script with isolated Slurm/LSF command fixtures."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from studio_worker.compute import workspace_confinement
from studio_worker.compute.service import Service
from studio_worker.compute.ssh_service import scheduler_profile
from studio_worker.infrastructure.util import digest
from studio_worker.workspace import resource_workspace
from studio_worker.workspace.roadmap_execution import RoadmapExecutions


class IsolatedSchedulerTransport:
    def __init__(self, directory, family, *, lose_submit_reply=False):
        self.directory = directory
        self.calls = directory / 'submissions'
        self.calls.write_text('')
        self.submit_requests = 0
        self.lose_submit_reply = lose_submit_reply
        self.env = {**os.environ, 'PATH': str(directory) + ':' + os.defpath}
        commands = {
            'sbatch': ("[ \"$#\" -eq 2 ] && [ \"$1\" = --parsable ] && [ \"$2\" = job.sh ] || exit 2",
                       'cat -- "$2"', 'printf \'%s;fixture\\n\' "$$"'),
            'bsub': ("[ \"$#\" -eq 2 ] && [ \"$1\" = -env ] && [ \"$2\" = none ] || exit 2",
                     'cat', 'printf \'Job <%s> is submitted to queue <test>.\\n\' "$$"'),
        }
        submit = 'sbatch' if family == 'slurm' else 'bsub'
        # Submission accepts a script and returns its assigned job ID. Running
        # the accepted script later keeps allocation failures out of this reply.
        arguments, receive, reply = commands[submit]
        spool_prefix = shlex.quote(str(directory / 'queued-'))
        submission_log = shlex.quote(str(self.calls))
        self.install_command(submit, f'''{arguments}
{receive} > {spool_prefix}"$$.sh"
printf '%s\t%s\\n' "$$" "$PWD" >> {submission_log}
{reply}
''')
        self.install_command('bsub' if submit == 'sbatch' else 'sbatch', 'exit 2\n')
        # Leave queue history unavailable so reconciliation uses the stored receipt.
        for name in ('squeue', 'sacct', 'bjobs'):
            self.install_command(name, 'exit 0\n')

    def install_command(self, name, body):
        path = self.directory / name
        path.write_text('#!/bin/sh\nset -eu\n' + body)
        path.chmod(0o700)

    def run(self, script, data=None, timeout=40):
        if data is not None:
            self.submit_requests += 1
        result = subprocess.run(['/bin/bash', '-c', script], input=data, env=self.env,
                                capture_output=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError(result.stderr.decode())
        if data is not None and self.lose_submit_reply:
            raise ConnectionError('Fixture lost the reply after the scheduler accepted the job')
        return result.stdout.decode()

    def finish(self, job_id, directory):
        return subprocess.run(['/bin/bash', str(self.directory / f'queued-{job_id}.sh')], cwd=directory,
                              env=self.env, capture_output=True, text=True, timeout=45)


class ClusterRoadmapTest(unittest.TestCase):
    @contextmanager
    def fixture(self, family, *, lose_submit_reply=False):
        def fixture_identity(root):
            return {'root':str(root), 'hostname':'fixture', 'uid':os.getuid(), 'machineId':'cluster-roadmap-test'}

        with tempfile.TemporaryDirectory() as directory, \
                patch('studio_worker.compute.ssh_service.identity', fixture_identity), \
                patch('studio_worker.workspace.resource_workspace.identity', fixture_identity):
            root = Path(directory).resolve()
            worker_root = root / 'worker'
            worker_root.mkdir()
            (worker_root / 'ssh-service.json').write_text(json.dumps({
                'schema_version':1, 'profile_id':'demo', 'role':'ssh-login-service',
            }))
            yield root, IsolatedSchedulerTransport(root, family, lose_submit_reply=lose_submit_reply)

    @contextmanager
    def worker(self, root, scheduler):
        with patch.dict(os.environ, {'STUDIO_SSH_SERVICE_ROOT': str(root / 'worker')}):
            api = Service(root / 'worker', schedule=False)
        api.clusters.transport = lambda profile: scheduler
        try:
            yield api
        finally:
            api.close()
            api.store.db.close()

    def confinement_supported(self, root, scheduler):
        directory = root / 'confinement-probe'
        directory.mkdir()
        command = [sys.executable, '-I', str(Path(workspace_confinement.__file__).resolve()),
                   str(directory), str(directory), 'fixture:', '/bin/true']
        probe = subprocess.run(command, cwd=directory, env=scheduler.env, capture_output=True, text=True, timeout=15)
        if probe.returncode == 125:
            self.assertIn('AIMatterLab workspace confinement is unavailable on this host.', probe.stderr)
            return False
        self.assertEqual(probe.returncode, 0, probe.stderr)
        self.assertIn(probe.stdout.strip(), ('fixture:landlock', 'fixture:bubblewrap'))
        return True

    def submit_graph(self, api, root, family, sched):
        workspace=root/'user workspace'
        for name in ['software','workfile']:
            (workspace/name).mkdir(parents=True)
        rid,profile_id,account,host=resource_workspace._actual_resource(api)
        wid=resource_workspace._digest(rid,str(workspace))
        resource_workspace.register(api,dict(resource_id=rid,workspace_id=wid,profile_id=profile_id,
                                            root=str(workspace),account=account,host_identity=host))
        scheduler_profile(api,dict(id='test',name='Test scheduler',scheduler=family,queue='test',
            environment={'executables':{'python':sys.executable}},limits={'cpus':2,'gpus':0,'memory_mb':2048},
            remote_root=str(root/'other-runs'),read_roots=[str(root)]))
        api.register_project({'id':'research','name':'Research','policy':{'input_roots':[str(root)],
            'engines':['trajectory.density'],'clusters':['test'],'environments':[],'max_seconds':30}})
        xyz=root/'initial.xyz'
        xyz.write_text('1\nTime=1 Lattice="2 0 0 0 2 0 0 0 2" pbc="T T T" Properties=species:S:1:pos:R:3\nH 0 0 0\n')
        graph={'schema_version':1,'inputs':['xyz'],'outputs':['series'],
            'resources':[{'id':'xyz','label':'Coordinates','field':'source','basis':'user'},
                {'id':'series','label':'Number density','basis':'user','requirements':['one sample'],
                 'checks':[{'requirement':'one sample','fact':'samples','op':'eq','value':1}]}],
            'steps':[{'id':'analyze','label':'Analyze trajectory','tool':'trajectory.density',
                'inputs':[{'port':'trajectory','resource':'xyz'}],'outputs':[{'port':'density','resource':'series'}]}]}
        owner={'provider':'codex','thread_id':'thread-1'}
        plan={'task_id':'task','name':'Small workflow','original_request':'Calculate number density','revision':1,
            'roadmap':graph,'parameters':{'source':str(xyz)},'target':{'cluster_id':'test','project_id':'research',
                'gpu':0,'resources':{'cpus':1,'gpus':0,'memory_mb':32},'max_seconds':30,'conversation':owner}}
        executor=RoadmapExecutions(api)
        review=executor.preview(plan)
        self.assertEqual(list((workspace/'workfile').iterdir()),[])
        receipt=resource_workspace.session(api,{'resource_id':rid,'workspace_id':wid,'date':'2026-11-20',**owner},allocate=True)
        request={'plan':plan,'snapshot_sha256':review['snapshot_sha256'],'workspace_receipt':receipt}
        with self.assertRaises(PermissionError):
            executor.confirm({**request,'workspace_receipt':{**receipt,'thread_id':'different-thread'}})
        state=executor.confirm(request)
        frozen_sha = review['snapshot']['initial']['xyz']['sha256']
        xyz.write_text('Changed after confirmation\n')
        executor.advance(state['id'])
        state = executor.confirm(request)
        query = {'execution_id':state['id'], 'task_id':plan['task_id']}
        run = api.clusters.raw(state['nodes']['analyze']['run_id'])
        directory = Path(receipt['path']) / 'runs' / state['id'] / 'steps' / 'analyze' / run['id']
        self.assertEqual(Path(run['remote_directory']), directory)
        self.assertFalse((root / 'other-runs').exists())
        self.assertTrue(run['submit_attempted'])
        self.assertEqual(sched.submit_requests, 1)
        accepted = sched.calls.read_text().splitlines()
        self.assertEqual(len(accepted), 1, run.get('error'))
        job_id, submitted_from = accepted[0].split('\t', 1)
        self.assertRegex(job_id, r'^[0-9]+$')
        self.assertEqual(Path(submitted_from), directory)
        self.assertEqual((root / f'queued-{job_id}.sh').read_bytes(), (directory / 'job.sh').read_bytes())
        self.assertEqual(json.loads((directory / '.submission-receipt.json').read_text()),
                         {'id':run['id'], 'nonce':run['nonce'], 'job_id':job_id})
        self.assertEqual((directory / '.submit-attempt').read_text(), run['nonce'])
        self.assertFalse((directory / 'exit.json').exists())
        self.assertEqual(digest(directory / 'simulation' / 'trajectory.xyz'), frozen_sha)
        return query, run, job_id, frozen_sha

    def complete_graph(self, api, scheduler, query, original, job_id):
        directory = Path(original['remote_directory'])
        result = scheduler.finish(job_id, directory)
        exit_receipt = {'nonce':original['nonce'], 'exit_code':result.returncode}
        self.assertEqual(json.loads((directory / '.submission-receipt.json').read_text()),
                         {'id':original['id'], 'nonce':original['nonce'], 'job_id':job_id})
        self.assertEqual(json.loads((directory / 'exit.json').read_text()), exit_receipt)
        run = api.clusters.poll(original['id'])
        self.assertEqual(run['job_id'], job_id)
        self.assertEqual(run['exit'], exit_receipt)
        executor = RoadmapExecutions(api)
        executor.advance(query['execution_id'])
        done = executor.status(query)
        node = done['nodes']['analyze']
        self.assertEqual((node['run_id'], node['job_id'], node['directory']),
                         (original['id'], job_id, str(directory)))
        self.assertEqual(scheduler.submit_requests, 1)
        return result, run, done

    def fail_allocation(self, api, scheduler, query, submitted, job_id, supported):
        directory = Path(submitted['remote_directory'])
        if supported:
            staged = directory / 'simulation' / 'trajectory.xyz'
            staged.chmod(0o600)
            staged.write_text('Different bytes after submission\n')
        result, run, done = self.complete_graph(api, scheduler, query, submitted, job_id)
        diagnostics = (directory / 'validation.stderr').read_text()
        if supported:
            self.assertEqual(result.returncode, 1, diagnostics)
            self.assertIn('Frozen file differs in compute-node environment', diagnostics)
        else:
            self.assertEqual(result.returncode, 125, diagnostics)
            self.assertIn('AIMatterLab workspace confinement is unavailable on this host.', diagnostics)
        self.assertEqual(run['status'], 'failed')
        self.assertEqual(done['status'], 'failed', done['nodes'])
        self.assertFalse((directory / 'execution-check.json').exists())
        self.assertFalse((directory / 'console.log').exists())
        self.assertFalse((directory / 'simulation' / 'density.csv').exists())
        return run, done

    def test_slurm_and_lsf_run_in_allocated_session_directory(self):
        for family in ('slurm','lsf'):
            with self.subTest(family=family), self.fixture(family) as (root, scheduler), self.worker(root, scheduler) as api:
                if not self.confinement_supported(root, scheduler):
                    self.skipTest('Successful batch execution requires working workspace confinement')
                query, submitted, job_id, frozen_sha = self.submit_graph(api, root, family, scheduler)
                self.assertEqual((submitted['status'], submitted['job_id']), ('queued', job_id))
                result, run, done = self.complete_graph(api, scheduler, query, submitted, job_id)
                self.assertEqual(result.returncode, 0, (Path(run['remote_directory']) / 'validation.stderr').read_text())
                self.assertEqual(run['status'], 'succeeded', run.get('error'))
                self.assertEqual(run['execution_check']['status'], 'passed')
                self.assertEqual(done['status'], 'passed', done['nodes'])
                self.assertEqual(Path(done['goals'][0]['artifact']['path']),
                                 Path(run['remote_directory']) / 'simulation' / 'density.csv')
                self.assertEqual(done['nodes']['analyze']['consumed'][0]['sha256'], frozen_sha)

    def test_slurm_and_lsf_keep_the_receipt_when_allocation_validation_fails(self):
        for family in ('slurm', 'lsf'):
            with self.subTest(family=family), self.fixture(family) as (root, scheduler), self.worker(root, scheduler) as api:
                supported = self.confinement_supported(root, scheduler)
                query, submitted, job_id, _ = self.submit_graph(api, root, family, scheduler)
                self.assertEqual((submitted['status'], submitted['job_id']), ('queued', job_id))
                run, _ = self.fail_allocation(api, scheduler, query, submitted, job_id, supported)
                self.assertIsNone(run.get('error'))

    def test_slurm_and_lsf_reconcile_the_original_receipt_without_resubmitting(self):
        missing_reply = 'Submission reply unavailable; reconcile only, never resubmit'
        for family in ('slurm', 'lsf'):
            with self.subTest(family=family), self.fixture(family, lose_submit_reply=True) as (root, scheduler):
                supported = self.confinement_supported(root, scheduler)
                with self.worker(root, scheduler) as api:
                    query, submitted, job_id, _ = self.submit_graph(api, root, family, scheduler)
                    self.assertEqual((submitted['status'], submitted['job_id']), ('unknown', None))
                    self.assertEqual(submitted['error'], missing_reply)
                with self.worker(root, scheduler) as api:
                    executor = RoadmapExecutions(api)
                    executor.advance(query['execution_id'])
                    before = executor.status(query)
                    self.assertEqual(before['status'], 'unknown')
                    self.assertEqual(before['nodes']['analyze']['run_id'], submitted['id'])
                    self.assertIsNone(before['nodes']['analyze']['job_id'])
                    self.assertEqual(api.clusters.submit(submitted['id'])['status'], 'unknown')
                    self.assertEqual(api.clusters.raw(submitted['id'])['error'], missing_reply)

                    receipt = Path(submitted['remote_directory']) / '.submission-receipt.json'
                    valid_receipt = receipt.read_text()
                    receipt.write_text(json.dumps({**json.loads(valid_receipt), 'nonce':'different-attempt'}))
                    without_evidence = api.clusters.poll(submitted['id'])
                    self.assertEqual((without_evidence['status'], without_evidence['job_id'], without_evidence['error']),
                                     ('unknown', None, missing_reply))
                    with patch.object(scheduler, 'run', side_effect=ConnectionError('Fixture observation unavailable')):
                        disconnected = api.clusters.poll(submitted['id'])
                    self.assertEqual((disconnected['status'], disconnected['job_id'], disconnected['error']),
                                     ('unknown', None, missing_reply))

                    receipt.write_text(valid_receipt)
                    run = api.clusters.poll(submitted['id'])
                    self.assertEqual((run['status'], run['job_id'], run['nonce']), ('unknown', job_id, submitted['nonce']))
                    self.assertIsNone(run.get('error'))
                    self.assertIsNone(run.get('exit'))
                    executor.advance(query['execution_id'])
                    restored = executor.status(query)
                    self.assertEqual(restored['status'], 'unknown')
                    self.assertEqual(restored['nodes']['analyze']['run_id'], submitted['id'])
                    self.assertEqual(restored['nodes']['analyze']['job_id'], job_id)
                with self.worker(root, scheduler) as api:
                    saved = api.clusters.raw(submitted['id'])
                    self.assertEqual(saved['job_id'], job_id)
                    self.assertIsNone(saved.get('error'))
                    snapshot = json.loads((Path(saved['directory']) / 'run.json').read_text())
                    self.assertEqual(snapshot['job_id'], job_id)
                    self.assertIsNone(snapshot.get('error'))
                    run, done = self.fail_allocation(api, scheduler, query, submitted, job_id, supported)
                    self.assertIsNone(run.get('error'))
                    self.assertEqual(done['nodes']['analyze']['reason'], str(run['exit']))
                self.assertEqual(scheduler.submit_requests, 1)
                self.assertEqual(len(scheduler.calls.read_text().splitlines()), 1)

    def test_recovered_scheduler_poll_keeps_another_diagnostic(self):
        with self.fixture('slurm') as (root, scheduler), self.worker(root, scheduler) as api:
            _, submitted, job_id, _ = self.submit_graph(api, root, 'slurm', scheduler)
            with patch.object(scheduler, 'run', side_effect=ConnectionError('Fixture observation unavailable')):
                unavailable = api.clusters.poll(submitted['id'])
            self.assertEqual(unavailable['error'], 'SSH or scheduler state unavailable; no resubmission')
            restored = api.clusters.poll(submitted['id'])
            self.assertEqual(restored['job_id'], job_id)
            self.assertEqual(restored['error'], unavailable['error'])
