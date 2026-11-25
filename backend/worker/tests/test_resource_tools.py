"""Use fixture schedulers and releases to exercise the actual resource tool API."""
import base64
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

from studio_worker.compute.service import Service
from studio_worker.compute.ssh_service import scheduler_profile
from studio_worker.tools.resource_tools import SETUP, execution_skill, resolve_invocation
from studio_worker.tools import resource_tool_git
from studio_worker.tools.resource_tool_manifest import file_receipt
from studio_worker.transport.routes import dispatch


def sha(value):
    return hashlib.sha256(value).hexdigest()


@unittest.skipUnless(os.name == 'posix', 'Linux same-host scheduler fixture')
class ResourceToolsTest(unittest.TestCase):
    def setUp(self):
        from test_cluster_roadmap import IsolatedSchedulerTransport
        from studio_worker.workspace import resource_workspace
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        service = Service(self.root/'worker',schedule=False)
        self.service = service
        self.addCleanup(service.store.db.close)
        self.addCleanup(service.close)
        service.ssh_service_mode=True
        (service.root/'ssh-service.json').write_text(json.dumps({'schema_version':1,'profile_id':'tool-fixture','role':'ssh-login-service'}))
        identity=lambda root:{'root':str(root),'hostname':'fixture','uid':os.getuid(),'machineId':'resource-tool-test'}
        for target in ('studio_worker.compute.ssh_service.identity','studio_worker.workspace.resource_workspace.identity'):
            substitute = patch(target,identity)
            substitute.start()
            self.addCleanup(substitute.stop)
        self.scheduler = IsolatedSchedulerTransport(self.root,'slurm')
        self.scheduler.install_command('sbatch', f'''[ "$#" -eq 2 ] && [ "$1" = --parsable ] && [ "$2" = job.sh ] || exit 2
printf '%s\\t%s\\n' "$$" "$PWD" >> {shlex.quote(str(self.scheduler.calls))}
/bin/bash -- "$2" >/dev/null 2>&1 || true
printf '%s;fixture\\n' "$$"
''')
        service.clusters.transport=lambda profile:self.scheduler
        workspace = self.root/'confirmed space'
        for name in ('software','workfile'):
            (workspace/name).mkdir(parents=True)
        self.workspace = workspace
        resource,profile,account,host = resource_workspace._actual_resource(service)
        self.source = {'resource_id':resource,'workspace_id':resource_workspace._digest(resource,str(workspace))}
        resource_workspace.register(service,{**self.source,'profile_id':profile,'root':str(workspace),'account':account,'host_identity':host})
        scheduler_profile(service,{'id':'slurm1','name':'Fixture scheduler','scheduler':'slurm','queue':'short',
            'environment':{'executables':{'python':sys.executable}},'limits':{'cpus':1,'gpus':0,'memory_mb':1024},
            'remote_root':str(self.root/'unused'),'read_roots':[str(self.root)]})
        self.before_project=self.call('list',self.source)
        service.register_project({'id':'research','name':'Fixture project','policy':{'input_roots':[str(workspace/'workfile')],
            'engines':['installation.check'],'clusters':['slurm1'],'environments':[],'max_seconds':30}})
        self.script = b'#!/bin/sh\n#SBATCH --time=1\nprintf \'{"result":"ok"}\\n\' > "$1"\n'
        self.definition = {'id':'example','name':'JSON example','version':'1.0','source':{'kind':'binary',
            'filename':'example.sh','executable':'example.sh','sha256':sha(self.script)},'interpreter':'bash',
            'argv':['{output:report}'],'inputs':{},'outputs':{'report':{'filename':'report.json','format':'json'}},
            'test':{'inputs':{},'max_seconds':10,'outputs':{'report':{'json_keys':['result'],'contains':'ok'}}}}

    def call(self, op, data, admin=True):
        return dispatch(self.service,'POST','/api/resource-tools/'+op,data,admin=admin)

    def plan(self, route, definition=None, request_id='fixture-01', **extra):
        return self.call('plan',{**self.source,'request_id':request_id,'route':route,
            'manifest':definition or self.definition,'project_id':'research','cluster_id':'slurm1',
            'environment_id':'cluster:slurm1',**extra})

    def ref(self, row):
        return {'resource_id':self.source['resource_id'],'setup_id':row['id']}

    def start(self, row):
        self.call('start',{**self.ref(row),'revision':row['revision'],'plan_sha256':row['plan_sha256']})

    def wait(self, row, statuses):
        deadline = time.monotonic()+10
        while time.monotonic()<deadline:
            latest = self.call('status',self.ref(row))
            if latest['status'] in statuses:
                return latest
            for phase in ('build','test'):
                run = latest.get(phase,{})
                if run.get('status') in ('queued','running','unknown'):
                    self.service.clusters.poll(run['run_id'])
            time.sleep(0.03)
        receipt=self.service.store.get(SETUP,row['id'])
        diag={}
        for phase in ('build','test'):
            if phase in receipt:
                run=self.service.clusters.raw(receipt[phase]['run_id'])
                directory=Path(run['remote_directory'])
                diag[phase]={'status':run['status'],'error':run.get('error'),'files':[
                    (name,(directory/name).read_text(errors='replace')[:1200])
                    for name in ('validation.stderr','console.log','exit.json') if (directory/name).is_file()]}
        self.fail((receipt['status'],diag))

    def submission_count(self):
        return len(self.scheduler.calls.read_text().splitlines()) if self.scheduler.calls.is_file() else 0

    def test_first_project_can_see_registered_scheduler_before_any_authorization_exists(self):
        self.assertEqual(self.before_project['targets'],[])
        self.assertEqual(self.before_project['workfile_root'],str(self.workspace/'workfile'))
        self.assertEqual(self.before_project['schedulers'],
            [{'id':'slurm1','name':'Fixture scheduler','scheduler':'slurm','queue_targets':False,'queue':'short'}])
        authorized=self.call('list',self.source)
        self.assertEqual([row['cluster_id'] for row in authorized['targets']],['slurm1'])

    def test_existing_classification_and_same_evidence_reuse(self):
        scripts = self.root/'existing'
        scripts.mkdir()
        for name in ('1.sh','2.sh'):
            (scripts/name).write_bytes(self.script)
        (scripts/'alias.sh').symlink_to(scripts/'1.sh')
        with self.assertRaises(PermissionError):
            self.call('discover',{**self.source,'directory':str(scripts)},admin=False)
        candidates = self.call('discover',{**self.source,'directory':str(scripts)})['candidates']
        self.assertEqual(len(candidates),1)
        candidate=candidates[0]
        self.assertEqual((candidate['scheduler'],candidate['count']),('slurm',2))
        definition=deepcopy(self.definition)
        definition['source']={'kind':'installed','executable':candidate['path']}
        pick={key:candidate[key] for key in ('path','sha256')}
        pending=self.plan('existing',definition,candidate=pick)
        with self.assertRaises(PermissionError):
            self.call('start',{**self.ref(pending),'revision':pending['revision'],'plan_sha256':pending['plan_sha256']},admin=False)
        self.assertEqual(self.submission_count(),0)
        self.start(pending)
        active=self.wait(pending,('active','failed'))
        self.assertEqual(active['status'],'active',active)
        self.assertEqual(active['test']['outputs']['report']['checks'],{key:'passed' for key in ('min_bytes','contains','json','json_keys')})
        skill=self.call('skill',self.ref(active))
        self.assertEqual(sha(skill['body'].encode()),skill['sha256'])
        invocation=resolve_invocation(self.service,'private.example',{},environment_id='cluster:slurm1',cluster_id='slurm1')
        self.assertEqual(invocation['outputs'],{'report':('report.json','json')})
        self.assertEqual(invocation['argv'][1:], [candidate['path'],'report.json'])
        self.assertIsNone(resolve_invocation(self.service,'private.example',{},environment_id='somewhere-else'))
        with self.assertRaises(PermissionError):
            self.call('status',{**self.ref(active),'resource_id':'f'*64})
        setup=self.plan('existing',definition,'fixture-02',candidate=pick,prior_run_id=active['test']['run_id'])
        self.start(setup)
        reused=self.wait(setup,('active','failed'))
        self.assertEqual(reused['status'],'active',reused)
        self.assertTrue(reused['test']['reused'])
        self.assertEqual(self.submission_count(),1)

        changed=deepcopy(definition)
        changed['test']['outputs']['report']['contains']='unobserved'
        setup=self.plan('existing',changed,'fixture-03',candidate=pick,prior_run_id=active['test']['run_id'])
        self.start(setup)
        failed=self.wait(setup,('active','failed'))
        self.assertEqual(failed['status'],'failed',failed)
        self.assertEqual(failed['test']['outputs']['report']['checks']['contains'],'failed')
        self.assertEqual(self.submission_count(),2)

    def test_release_fallback_resumes_partial_and_activates(self):
        definition=deepcopy(self.definition)
        definition['source']['url']='https://example.com/pinned-release.sh'
        with patch('studio_worker.tools.resource_tools.download',side_effect=ConnectionError('fixture network down')):
            setup=self.plan('fresh',definition)
            self.start(setup)
            row=self.wait(setup,('desktop_fallback','failed'))
            self.assertEqual(row['status'],'desktop_fallback',row)
        self.assertEqual(self.submission_count(),0)
        ticket={**self.ref(row),'sha256':sha(self.script),'size':len(self.script)}
        self.assertEqual(self.call('upload-offset',ticket),{'offset':0})
        offset=11
        chunk={**ticket,'offset':0,'chunk':base64.b64encode(self.script[:offset]).decode(),'chunk_sha256':sha(self.script[:offset])}
        self.assertEqual(self.call('upload-chunk',chunk),{'offset':offset})
        self.assertEqual(self.call('upload-chunk',chunk),{'offset':offset})
        self.assertEqual(self.call('upload-offset',ticket),{'offset':offset})
        with self.assertRaises(ValueError):
            self.call('upload-finish',ticket)
        self.call('upload-chunk',{**ticket,'offset':offset,'chunk':base64.b64encode(self.script[offset:]).decode(),
                                  'chunk_sha256':sha(self.script[offset:])})
        self.call('upload-finish',ticket)
        active=self.wait(row,('active','failed'))
        self.assertEqual(active['status'],'active',active)
        self.assertEqual(self.submission_count(),1)
        self.assertEqual((Path(active['install_root'])/'example.sh').read_bytes(),self.script)
        self.assertTrue((self.workspace/'software/.aimatterlab/tools/.git').is_dir())

    def test_selected_remote_file_and_actual_versioned_build(self):
        source = self.root/'source.sh'
        source.write_bytes(self.script)
        archive = self.root/'source.tar.gz'
        with tarfile.open(archive,'w:gz') as stream:
            stream.add(source,arcname='source.sh')
        payload = archive.read_bytes()
        definition=deepcopy(self.definition)
        definition['source']={'kind':'archive','filename':archive.name,'executable':'built.sh','sha256':sha(payload)}
        definition['build']={'steps':[{'command':'cp','args':['source.sh','built.sh']}],'max_seconds':12}
        setup=self.plan('custom',definition)
        self.start(setup)
        pending=self.wait(setup,('needs_file','failed'))
        self.assertEqual(pending['status'],'needs_file',pending)
        self.call('supply-remote',{**self.ref(pending),'revision':pending['revision'],'path':str(archive)})
        active=self.wait(setup,('active','failed'))
        self.assertEqual(active['status'],'active',active)
        self.assertEqual(active['build']['status'],'passed')
        self.assertEqual(self.submission_count(),2)
        self.assertEqual((Path(active['install_root'])/'built.sh').read_bytes(),self.script)

    def test_missing_git_installs_and_uses_the_pinned_resource_entrypoint(self):
        installed = shutil.which('git')
        self.assertIsNotNone(installed, 'Fixture requires a Git binary to put in a portable archive')
        archive=self.root/'git-portable.tar.gz'
        with tarfile.open(archive,'w:gz') as stream:
            stream.add(Path(installed).resolve(),arcname='bin/git')
        definition=deepcopy(self.definition)
        definition['source']['url']='https://example.org/example.sh'
        definition['git_bootstrap']={'kind':'archive','filename':archive.name,'executable':'bin/git',
            'sha256':sha(archive.read_bytes())}
        def destination(_url,path,expected):
            path.write_bytes(self.script)
            observed = file_receipt(path)
            self.assertEqual(observed['sha256'],expected)
            return observed
        original_run=resource_tool_git._run
        def no_module(command,**kwargs):
            if command[:2]==['/bin/bash','-lc']:
                raise FileNotFoundError('No site module in fixture')
            return original_run(command,**kwargs)
        with patch.object(resource_tool_git.shutil,'which',return_value=None), \
                patch.object(resource_tool_git,'_run',side_effect=no_module), \
                patch('studio_worker.tools.resource_tools.download',side_effect=destination):
            setup=self.plan('fresh',definition)
            self.start(setup)
            waiting=self.wait(setup,('needs_file','failed'))
            self.assertEqual(waiting['status'],'needs_file',waiting)
            self.assertEqual(waiting['supply'],'git')
            self.assertEqual(self.submission_count(),0)
            self.call('supply-remote',{**self.ref(waiting),'revision':waiting['revision'],'path':str(archive)})
            row=self.wait(setup,('active','failed'))
        self.assertEqual(row['status'],'active',row)
        persisted=self.service.store.get(SETUP,row['id'])
        self.assertEqual(persisted['git']['method'],'workspace-package')
        self.assertTrue(Path(persisted['git']['executable']).is_relative_to(self.workspace/'software/git'))
        registry=self.workspace/'software/.aimatterlab/tools'/(row['id']+'.json')
        self.assertEqual(json.loads(registry.read_text())['git']['executable'],persisted['git']['executable'])

    def test_unknown_scheduler_receipt_keeps_one_original_submission(self):
        launcher=self.root/'sbatch'
        launcher.write_text('#!/bin/sh\npwd >> '+shlex.quote(str(self.scheduler.calls))+'\nexit 1\n')
        source=self.root/'original.sh'
        source.write_bytes(self.script)
        definition=deepcopy(self.definition)
        definition['source']={'kind':'installed','executable':str(source)}
        setup=self.plan('custom',definition)
        self.start(setup)
        uncertain=self.wait(setup,('unknown','failed'))
        self.assertEqual(uncertain['status'],'unknown',uncertain)
        identifier=uncertain['test']['run_id']
        self.service.clusters.poll(identifier)
        for _ in range(10):
            current=self.call('status',self.ref(setup))
            self.assertEqual(current['test']['run_id'],identifier)
            time.sleep(0.02)
        self.assertEqual(self.submission_count(),1)

    def test_registered_python_entry_preserves_virtual_environment(self):
        runtime=self.root/'venv'
        subprocess.run([sys.executable,'-m','venv','--without-pip',str(runtime)],check=True,timeout=20)
        python=str(runtime/'bin/python')
        scheduler_profile(self.service,{'id':'slurm1','name':'Venv scheduler','scheduler':'slurm','queue':'short',
            'environment':{'executables':{'python':python}},'limits':{'cpus':1,'gpus':0,'memory_mb':1024},
            'remote_root':str(self.root/'unused'),'read_roots':[str(self.root)]})
        program=self.root/'venv-report.py'
        program.write_text('from pathlib import Path\nimport json, sys\nPath(sys.argv[1]).write_text(json.dumps({"prefix":sys.prefix}))\n')
        definition=deepcopy(self.definition)
        definition['source']={'kind':'installed','executable':str(program)}
        definition['interpreter']='python'
        definition['test']['outputs']={'report':{'contains':str(runtime),'json_keys':['prefix']}}
        setup=self.plan('custom',definition)
        self.start(setup)
        row=self.wait(setup,('active','failed'))
        self.assertEqual(row['status'],'active',row)
        invocation=resolve_invocation(self.service,'private.example',{},environment_id='cluster:slurm1')
        self.assertEqual(invocation['argv'][0],python)

    def test_activated_private_tool_feeds_a_scientific_node_across_worker_restart(self):
        from studio_worker.workspace import resource_workspace
        from studio_worker.workspace.roadmap_execution import RoadmapExecutions
        fixture = ('1\nTime=1 Lattice="2 0 0 0 2 0 0 0 2" pbc="T T T" '
                   'Properties=species:S:1:pos:R:3\nH 0 0 0\n')
        program=self.root/'xyz.py'
        program.write_text('from pathlib import Path\nimport sys\nPath(sys.argv[1]).write_text(' + repr(fixture) + ')\n')
        definition={'id':'write-frames','name':'Private frame writer','version':'1',
                    'source':{'kind':'installed','executable':str(program),'sha256':file_receipt(program)['sha256']},'interpreter':'python',
                    'argv':['{output:frames}'],'inputs':{},'outputs':{'frames':{'filename':'frames.xyz','format':'extxyz'}},
                    'test':{'inputs':{},'max_seconds':10,'outputs':{'frames':{'sha256':sha(fixture.encode())}}}}
        owner={'provider':'codex','thread_id':'two-steps'}
        graph={'schema_version':1,'inputs':[],'outputs':['frames','series'],
               'resources':[{'id':'frames','label':'Frames'},{'id':'series','label':'Number density'}],
               'steps':[{'id':'write','label':'Create frames','tool':'private.write-frames','inputs':[],
                         'outputs':[{'port':'frames','resource':'frames'}]},
                        {'id':'analyze','label':'Analyze frames','tool':'trajectory.density',
                         'inputs':[{'port':'trajectory','resource':'frames'}],
                         'outputs':[{'port':'density','resource':'series'}]}]}
        plan={'task_id':'private-graph','name':'Resource tool workflow','original_request':'Calculate number density','revision':1,
              'roadmap':graph,'parameters':{},'target':{'cluster_id':'slurm1','project_id':'research',
                'gpu':0,'resources':{'cpus':1,'gpus':0,'memory_mb':32},'max_seconds':20,'conversation':owner}}
        executor=RoadmapExecutions(self.service)
        missing=executor.preview(plan)
        self.assertEqual(missing['missing_tools'],[{'step_id':'write','tool':'private.write-frames','reason':'tool_not_configured'}])
        self.assertEqual(self.submission_count(),0)
        initial_engines=dispatch(self.service,'GET','/api/engines',{},admin=True)
        self.assertIn('installation.check',initial_engines)
        self.assertNotIn('private.write-frames',initial_engines)

        onboarding={'package_id':'write-frames','package_version':sha(b'frame-writer-package'),
                    'manifest_sha256':sha(b'registered definition'),'source_commit':'a'*40,
                    'function_id':'structure.fixture','reference_test_case_id':'write-one-frame',
                    'entrypoint':definition['source']['sha256'],'support':{}}
        with self.assertRaisesRegex(ValueError,'exact checked-out source or installed entrypoint'):
            self.plan('custom',definition,onboarding={**onboarding,'entrypoint':'f'*64})
        setup=self.plan('custom',definition,onboarding=onboarding)
        self.assertEqual(setup['onboarding'],onboarding)
        self.assertEqual(self.submission_count(),0)
        with self.assertRaisesRegex(ValueError,'already has a different reviewed plan'):
            self.plan('custom',definition,onboarding={**onboarding,'package_version':'e'*64})
        self.start(setup)
        active=self.wait(setup,('active','failed'))
        self.assertEqual(active['status'],'active',active)
        self.assertEqual(active['test']['onboarding'],onboarding)
        self.assertIn(onboarding['package_version'],self.call('skill',self.ref(active))['body'])
        test_run=self.service.clusters.raw(active['test']['run_id'])
        self.assertEqual(test_run['bound_invocation']['version']['onboarding'],onboarding)
        self.assertIn('private.write-frames',dispatch(self.service,'GET','/api/engines',{},admin=True))
        with self.assertRaises(PermissionError):
            executor.preview(plan)
        project=self.service.store.get('project','research')
        project['policy']['engines']+=['private.write-frames','trajectory.density']
        self.service.register_project(project)

        preview=executor.preview(plan)
        workspace=resource_workspace.session(self.service,{**self.source,'date':'2026-11-20',**owner},allocate=True)
        request={'plan':plan,'snapshot_sha256':preview['snapshot_sha256'],'workspace_receipt':workspace}
        state=executor.confirm(request)
        identifier=state['id']

        update=self.plan('custom',{**definition,'version':'2'},'fixture-update-02')
        self.start(update)
        newer=self.wait(update,('active','failed'))
        self.assertEqual(newer['status'],'active',newer)
        self.assertEqual(resolve_invocation(self.service,'private.write-frames',{})['activationId'],newer['activation_id'])

        executor.advance(identifier)
        state=executor.confirm(request)
        self.assertEqual(self.submission_count(),3)
        write_id=state['nodes']['write']['run_id']
        write=self.service.clusters.raw(write_id)
        self.assertEqual(write['bound_invocation']['version']['activation_id'],active['activation_id'])
        self.assertEqual(write['bound_invocation']['version']['onboarding'],onboarding)
        self.assertEqual(self.service.clusters.poll(write_id)['status'],'succeeded')

        # Only the worker database and the original scheduler survive.
        old=self.service
        old.close()
        old.store.db.close()
        reopened=Service(old.root,schedule=False)
        self.addCleanup(reopened.store.db.close)
        self.addCleanup(reopened.close)
        reopened.ssh_service_mode=True
        reopened.clusters.transport=lambda _profile:self.scheduler
        self.service=reopened
        executor=RoadmapExecutions(reopened)
        for _ in range(3):
            executor.advance(identifier)
        state=executor.status({'task_id':'private-graph','execution_id':identifier})
        self.assertEqual(state['nodes']['write']['run_id'],write_id)
        self.assertEqual(self.submission_count(),4)
        analysis=state['nodes']['analyze']['run_id']
        self.assertEqual(reopened.clusters.poll(analysis)['status'],'succeeded')
        for _ in range(3):
            executor.advance(identifier)
        done=executor.status({'task_id':'private-graph','execution_id':identifier})
        self.assertEqual(done['status'],'passed',done['nodes'])
        self.assertEqual(done['nodes']['analyze']['consumed'][0]['sha256'],sha(fixture.encode()))
        frames=next(goal['artifact'] for goal in done['goals'] if goal['resource']=='frames')
        self.assertEqual(frames['sha256'],sha(fixture.encode()))
        self.assertTrue(Path(frames['path']).is_relative_to(Path(workspace['path'])))
        self.assertEqual(self.submission_count(),4)

    def test_multi_function_isolation_and_strict_parameter_specs(self):
        from studio_worker.tools.resource_tools import ACTIVE, function_tool_id
        from studio_worker.workspace.roadmap_cluster import installation_available
        from studio_worker.workspace.roadmap_execution import RoadmapExecutions
        script_a = self.root / 'fn_a.py'
        script_b = self.root / 'fn_b.py'
        script_a.write_text(
            'import json, sys\nfrom pathlib import Path\n'
            'Path(sys.argv[3]).write_text(json.dumps({"fn":"a","steps":int(sys.argv[1]),"temp":float(sys.argv[2])}))\n'
        )
        script_b.write_text(
            'import json, sys\nfrom pathlib import Path\n'
            'Path(sys.argv[1]).write_text(json.dumps({"fn":"b"}))\n'
        )
        specs = {
            'steps': {'type': 'integer', 'required': True},
            'temperature': {'type': 'number', 'required': False, 'default': 300},
        }
        id_a = function_tool_id('suite', 'calc.a')
        id_b = function_tool_id('suite', 'calc.b')
        self.assertEqual(id_a, 'suite--calc-a')
        self.assertEqual(id_b, 'suite--calc-b')
        def_a = {
            'id': id_a, 'name': 'Suite A', 'version': '1',
            'source': {'kind': 'installed', 'executable': str(script_a), 'sha256': file_receipt(script_a)['sha256']},
            'interpreter': 'python',
            'argv': ['{param:steps}', '{param:temperature}', '{output:report}'],
            'parameter_specs': specs,
            'inputs': {}, 'outputs': {'report': {'filename': 'report.json', 'format': 'json'}},
            'test': {'inputs': {}, 'parameters': {'steps': 10, 'temperature': 500}, 'max_seconds': 10,
                     'outputs': {'report': {'json_keys': ['fn', 'steps', 'temp']}}},
        }
        ob_a = {
            'package_id': 'suite', 'package_version': sha(b'suite-v1'), 'manifest_sha256': sha(b'suite-manifest'),
            'source_commit': 'a' * 40, 'function_id': 'calc.a', 'reference_test_case_id': 'case-a',
            'entrypoint': def_a['source']['sha256'], 'support': {}, 'parameter_specs': specs,
        }
        def_b = {
            'id': id_b, 'name': 'Suite B', 'version': '1',
            'source': {'kind': 'installed', 'executable': str(script_b), 'sha256': file_receipt(script_b)['sha256']},
            'interpreter': 'python', 'argv': ['{output:report}'],
            'inputs': {}, 'outputs': {'report': {'filename': 'report.json', 'format': 'json'}},
            'test': {'inputs': {}, 'max_seconds': 10, 'outputs': {'report': {'json_keys': ['fn']}}},
        }
        ob_b = {
            'package_id': 'suite', 'package_version': sha(b'suite-v1'), 'manifest_sha256': sha(b'suite-manifest'),
            'source_commit': 'a' * 40, 'function_id': 'calc.b', 'reference_test_case_id': 'case-b',
            'entrypoint': def_b['source']['sha256'], 'support': {},
        }
        # Cannot override declared optional default or invent required defaults in setup parameters.
        with self.assertRaisesRegex(ValueError, 'Setup default differs'):
            self.plan('custom', {**def_a, 'parameters': {'temperature': 500}}, 'bad-default-01', onboarding=ob_a)
        with self.assertRaisesRegex(ValueError, 'Required parameter cannot declare a setup default'):
            self.plan('custom', {**def_a, 'parameters': {'steps': 10}}, 'bad-required-01', onboarding=ob_a)

        setup_a = self.plan('custom', def_a, 'suite-a-setup-01', onboarding=ob_a)
        self.start(setup_a)
        active_a = self.wait(setup_a, ('active', 'failed'))
        self.assertEqual(active_a['status'], 'active', active_a)

        # Cannot plan calc.b under calc.a's function-scoped ID (tool_onboarding blocks mismatch).
        with self.assertRaisesRegex(ValueError, 'package and setup IDs differ'):
            self.plan('custom', {**def_b, 'id': id_a}, 'suite-b-wrong-id', onboarding=ob_b)
        # Cannot plan two distinct functions under the same bare package ID either.
        bare_a = self.plan('custom', {**def_a, 'id': 'suite'}, 'suite-bare-a-01', onboarding=ob_a)
        self.assertEqual(bare_a['status'], 'planned')
        with self.assertRaisesRegex(ValueError, 'already assigned to another function'):
            self.plan('custom', {**def_b, 'id': 'suite'}, 'suite-bare-b-01', onboarding=ob_b)

        setup_b = self.plan('custom', def_b, 'suite-b-setup-01', onboarding=ob_b)
        self.start(setup_b)
        active_b = self.wait(setup_b, ('active', 'failed'))
        self.assertEqual(active_b['status'], 'active', active_b)

        # Availability discovery succeeds even though calc.a has a required parameter.
        project = self.service.store.get('project', 'research')
        project['policy']['engines'] += ['private.' + id_a, 'private.' + id_b]
        self.service.register_project(project)
        target = {'project_id': 'research', 'cluster_id': 'slurm1', 'resources': {'cpus': 1, 'gpus': 0, 'memory_mb': 32}}
        self.assertTrue(installation_available(self.service, target, 'private.' + id_a, None))

        # Formal invocation enforces required params, declared default (300, NOT test 500), and strict integer type.
        with self.assertRaisesRegex(ValueError, 'Missing required parameter: steps'):
            resolve_invocation(self.service, 'private.' + id_a, {}, environment_id='cluster:slurm1')
        with self.assertRaisesRegex(ValueError, 'Unknown or incompatible parameter: steps'):
            resolve_invocation(self.service, 'private.' + id_a, {'steps': 1.5}, environment_id='cluster:slurm1')
        with self.assertRaisesRegex(ValueError, 'Unknown or incompatible parameter: steps'):
            resolve_invocation(self.service, 'private.' + id_a, {'steps': True}, environment_id='cluster:slurm1')
        inv_a = resolve_invocation(self.service, 'private.' + id_a, {'steps': 4}, environment_id='cluster:slurm1')
        self.assertEqual(inv_a['argv'][-3:], ['4', '300', 'report.json'])
        inv_b = resolve_invocation(self.service, 'private.' + id_b, {}, environment_id='cluster:slurm1')
        self.assertEqual(inv_b['activationId'], active_b['activation_id'])

        # Legacy flat integer defaults also reject floats like 1.5.
        from studio_worker.tools.resource_tool_manifest import args_for
        legacy_manifest = {
            'inputs': {}, 'outputs': {'out': {'filename': 'out.txt', 'format': 'text'}},
            'parameters': {'steps': 10}, 'argv': ['{param:steps}', '{output:out}'],
        }
        with self.assertRaisesRegex(ValueError, 'Unknown or incompatible parameter: steps'):
            args_for(legacy_manifest, {'steps': 1.5})

        # Legacy DB with two functions sharing one engine ID fails closed instead of running the newest function.
        colliding = deepcopy(self.service.store.get(ACTIVE, active_b['activation_id']))
        colliding['id'] = sha(b'legacy-collision')
        colliding['engine'] = 'private.' + id_a
        colliding['activated_at'] = time.time() + 10
        self.service.store.put(ACTIVE, colliding)
        with self.assertRaisesRegex(ValueError, 'Multiple functions share engine'):
            resolve_invocation(self.service, 'private.' + id_a, {'steps': 4}, environment_id='cluster:slurm1')
        # An explicit frozen activation_id still resolves cleanly.
        frozen = resolve_invocation(self.service, 'private.' + id_a, {'steps': 4}, environment_id='cluster:slurm1', activation_id=active_a['activation_id'])
        self.assertEqual(frozen['activationId'], active_a['activation_id'])

    def test_git_blob_cross_platform_crlf_and_undeclared_helper_tampering(self):
        git = shutil.which('git')
        self.assertTrue(git)
        repo = self.root / 'git-tool-src'
        repo.mkdir()
        subprocess.run([git, 'init', '--quiet', '-b', 'main'], cwd=repo, check=True)
        subprocess.run([git, 'config', 'user.name', 'Test'], cwd=repo, check=True)
        subprocess.run([git, 'config', 'user.email', 'test@example.invalid'], cwd=repo, check=True)
        main_lf = b'import json, sys\nfrom pathlib import Path\nimport helper\nPath(sys.argv[1]).write_text(json.dumps({"value": helper.VALUE}))\n'
        helper_lf = b'VALUE = 42\n'
        (repo / 'run.py').write_bytes(main_lf)
        (repo / 'helper.py').write_bytes(helper_lf)
        subprocess.run([git, 'add', 'run.py', 'helper.py'], cwd=repo, check=True)
        subprocess.run([git, 'commit', '--quiet', '-m', 'Initial'], cwd=repo, check=True)
        commit = subprocess.check_output([git, 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
        entry_blob = subprocess.check_output([git, 'rev-parse', 'HEAD:run.py'], cwd=repo, text=True).strip()
        bundle = self.root / 'tool.bundle'
        subprocess.run([git, 'bundle', 'create', str(bundle), 'HEAD'], cwd=repo, check=True)
        # Simulate Windows CRLF working-tree SHA-256 while supplying the cross-platform Git blob OID.
        crlf_digest = sha(main_lf.replace(b'\n', b'\r\n'))
        self.assertNotEqual(crlf_digest, sha(main_lf))
        definition = {
            'id': 'helper-tool', 'name': 'Helper Tool', 'version': '1',
            'source': {'kind': 'git', 'url': 'https://github.com/example/helper-tool.git', 'commit': commit, 'executable': 'run.py'},
            'interpreter': 'python', 'argv': ['{output:report}'],
            'inputs': {}, 'outputs': {'report': {'filename': 'report.json', 'format': 'json'}},
            'test': {'inputs': {}, 'max_seconds': 10, 'outputs': {'report': {'contains': '42', 'json_keys': ['value']}}},
        }
        onboarding = {
            'package_id': 'helper-tool', 'package_version': sha(b'helper-pkg'), 'manifest_sha256': sha(b'helper-manifest'),
            'source_commit': commit, 'function_id': 'run', 'reference_test_case_id': 'smoke',
            'entrypoint': crlf_digest, 'entrypoint_git_object': entry_blob, 'support': {}, 'support_git_objects': {},
        }
        setup = self.plan('fresh', definition, 'git-helper-setup-01', onboarding=onboarding)
        staging = self.workspace / 'software' / '.aimatterlab' / 'setups' / setup['id']
        staging.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(bundle, staging / 'package.release')
        self.start(setup)
        active = self.wait(setup, ('active', 'failed'))
        self.assertEqual(active['status'], 'active', active)

        # Clean invocation resolves while helper.py is untouched.
        resolved = resolve_invocation(self.service, 'private.helper-tool', {}, environment_id='cluster:slurm1')
        self.assertIsNotNone(resolved)
        self.assertTrue(resolved['version'].get('install_tree_sha256'))

        # Modifying the undeclared sibling helper.py must invalidate activation immediately.
        install_root = Path(active['install_root'])
        (install_root / 'helper.py').write_bytes(b'VALUE = 999\n')
        with self.assertRaisesRegex(ValueError, 'supporting file changed'):
            resolve_invocation(self.service, 'private.helper-tool', {}, environment_id='cluster:slurm1')


class ExecutionSkillProvenanceTest(unittest.TestCase):
    def _fixture(self, source):
        return {
            'id': 'hotham',
            'name': 'HotHam',
            'version': '0.1.0',
            'source': source,
            'argv': ['--config', '{input:cfg}'],
            'inputs': {'cfg': {'filename': 'cfg.yaml', 'format': 'yaml'}},
            'outputs': {'log': {'filename': 'out.log', 'format': 'text'}},
        }

    def test_execution_skill_records_source_provenance_without_onboarding(self):
        target = {'environment_id': 'cluster:slurm1', 'cluster_id': 'slurm1'}
        version = {'tool_executable': '/opt/hotham/bin/hotham'}
        test_receipt = {'job_id': 'job-1'}
        git_skill = execution_skill(
            self._fixture({'kind': 'git', 'url': 'https://github.com/example/hotham.git', 'commit': 'b' * 40}),
            target, version, test_receipt, 'act123456789000',
        )
        self.assertIn('Source provenance: git `https://github.com/example/hotham.git` at commit `' + 'b' * 40 + '`.', git_skill['body'])
        self.assertNotIn('Registered delivery', git_skill['body'])
        self.assertEqual(git_skill['sha256'], sha(git_skill['body'].encode()))
        self.assertLessEqual(len(git_skill['body'].encode()), 16384)

        archive_digest = 'c' * 64
        archive_skill = execution_skill(
            self._fixture({'kind': 'archive', 'url': 'https://example.com/tool.tar.gz', 'sha256': archive_digest}),
            target, version, test_receipt, 'act123456789000',
        )
        self.assertIn('Source provenance: `archive` `https://example.com/tool.tar.gz` with SHA-256 `' + archive_digest + '`.', archive_skill['body'])

        installed_digest = 'd' * 64
        installed_skill = execution_skill(
            self._fixture({'kind': 'installed', 'executable': '/usr/local/bin/tool', 'sha256': installed_digest}),
            target, version, test_receipt, 'act123456789000',
        )
        self.assertIn('Source provenance: installed executable `/usr/local/bin/tool` (SHA-256 `' + installed_digest + '`).', installed_skill['body'])

    def test_execution_skill_preserves_registered_delivery_with_onboarding(self):
        target = {'environment_id': 'cluster:slurm1', 'cluster_id': 'slurm1'}
        version = {
            'tool_executable': '/opt/hotham/bin/hotham',
            'onboarding': {
                'package_id': 'hotham',
                'package_version': '1.0.0',
                'source_commit': 'a' * 40,
                'manifest_sha256': 'e' * 64,
                'function_id': 'hamiltonian.infer',
                'reference_test_case_id': 'smoke',
            },
        }
        skill = execution_skill(
            self._fixture({'kind': 'git', 'url': 'https://github.com/example/hotham.git', 'commit': 'a' * 40}),
            target, version, {'job_id': 'job-2'}, 'act123456789000',
        )
        self.assertIn('Registered delivery `hotham@1.0.0`, source commit `' + 'a' * 40 + '`', skill['body'])
        self.assertNotIn('Source provenance:', skill['body'])
        self.assertEqual(skill['sha256'], sha(skill['body'].encode()))

