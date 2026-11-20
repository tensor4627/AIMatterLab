"""Run the actual batch script with isolated Slurm/LSF command fixtures."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from studio_worker.compute.service import Service
from studio_worker.compute.ssh_service import scheduler_profile
from studio_worker.workspace import resource_workspace
from studio_worker.workspace.roadmap_execution import RoadmapExecutions


class IsolatedSchedulerTransport:
    def __init__(self, directory, family):
        self.calls = directory/'submissions'
        submit = 'sbatch' if family=='slurm' else 'bsub'
        launcher = directory/submit
        launcher.write_text('#!/bin/sh\nset -eu\npwd >> '+shlex.quote(str(self.calls))+
            ('\nbash job.sh\necho 101\n' if family=='slurm' else '\nbash -s\necho "Job <101> is submitted"\n'))
        launcher.chmod(0o700)
        for name in ['squeue','sacct','bjobs']:
            command = directory/name
            command.write_text('#!/bin/sh\nexit 0\n')
            command.chmod(0o700)
        self.path = str(directory)+':'+os.defpath

    def run(self, script, data=None, timeout=40):
        result = subprocess.run(['/bin/bash','-c',script],input=data,env={**os.environ,'PATH':self.path},
                                capture_output=True,timeout=timeout)
        if result.returncode:
            raise RuntimeError(result.stderr.decode())
        return result.stdout.decode()


class ClusterRoadmapTest(unittest.TestCase):
    def run_case(self, directory, family):
        root=Path(directory)
        worker_root=root/'worker'
        worker_root.mkdir()
        (worker_root/'ssh-service.json').write_text(json.dumps({'schema_version':1,'profile_id':'demo','role':'ssh-login-service'}))
        api=Service(worker_root,schedule=False)
        self.addCleanup(api.store.db.close)
        self.addCleanup(api.close)
        api.ssh_service_mode=True
        sched=IsolatedSchedulerTransport(root,family)
        api.clusters.transport=lambda profile:sched
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
        executor.advance(state['id'])
        state=executor.confirm(request)
        run_id=state['nodes']['analyze']['run_id']
        run=api.clusters.poll(run_id)
        self.assertEqual(run['status'],'succeeded',run.get('error'))
        executor=RoadmapExecutions(api)
        executor.advance(state['id'])
        done=executor.status({'execution_id':state['id'],'task_id':'task'})
        self.assertEqual(done['status'],'passed',done['nodes'])
        self.assertEqual(done['nodes']['analyze']['job_id'],'101')
        self.assertEqual(len(sched.calls.read_text().splitlines()),1)
        self.assertTrue(Path(done['goals'][0]['artifact']['path']).is_relative_to(Path(receipt['path'])))
        self.assertEqual(done['nodes']['analyze']['consumed'][0]['sha256'],review['snapshot']['initial']['xyz']['sha256'])

    def test_slurm_and_lsf_run_in_allocated_session_directory(self):
        def test_identity(root):
            return {'root':str(root),'hostname':'fixture','uid':os.getuid(),'machineId':'cluster-roadmap-test'}
        for family in ('slurm','lsf'):
            with self.subTest(family=family), tempfile.TemporaryDirectory() as directory, \
                    patch('studio_worker.compute.ssh_service.identity', test_identity), \
                    patch('studio_worker.workspace.resource_workspace.identity', test_identity):
                self.run_case(directory,family)
